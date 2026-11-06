use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

type Reply = Result<Value, Value>;

#[cfg(windows)]
fn node_path(path: PathBuf) -> PathBuf {
    use std::path::{Component, Prefix};
    let mut components = path.components();
    let mut ordinary = match components.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::VerbatimDisk(drive) => PathBuf::from(format!("{}:", char::from(drive))),
            Prefix::VerbatimUNC(server, share) => PathBuf::from(r"\\").join(server).join(share),
            _ => return path,
        },
        _ => return path,
    };
    ordinary.extend(components);
    // Node 22 的模块解析不接受 verbatim 路径（nodejs/node#62446）。
    // 仅在 Win32 拼法仍指向同一位置时去掉前缀，避免改变特殊文件名的含义。
    if let (Ok(original), Ok(resolved)) = (
        std::fs::canonicalize(&path),
        std::fs::canonicalize(&ordinary),
    ) {
        if original == resolved {
            return ordinary;
        }
    }
    path
}

pub struct Control {
    stdin: Mutex<Option<ChildStdin>>,
    replies: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    next: AtomicU64,
    pub drop_path: Mutex<Option<PathBuf>>,
    #[cfg(windows)]
    _job: crate::windows::ProcessJob,
}

impl Control {
    pub fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let resources = app.path().resource_dir()?;
        #[cfg(windows)]
        let resources = node_path(resources);
        #[cfg(windows)]
        let resources = if resources.join("resources/control/control.cjs").is_file() {
            resources.join("resources")
        } else {
            resources
        };
        let bundled = resources.join("control/control.cjs").is_file();
        let locate = |key: &str, name: &str| -> Result<PathBuf, String> {
            let path = if bundled {
                resources.join("control").join(name)
            } else {
                std::env::var_os(key)
                    .map(PathBuf::from)
                    .ok_or_else(|| format!("Missing {key}"))?
            };
            #[cfg(windows)]
            let path = node_path(path);
            Ok(path)
        };
        let mut command = Command::new(locate(
            "BREVIA_CONTROL_NODE",
            if cfg!(windows) { "node.exe" } else { "node" },
        )?);
        command
            .arg(locate("BREVIA_CONTROL_ENTRY", "control.cjs")?)
            .args(
                std::env::args()
                    .skip(1)
                    .filter(|arg| arg == "--reset-onboarding" || arg == "--background"),
            )
            .env("BREVIA_RESOURCES", &resources)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
            command.env("BREVIA_WAIT_FOR_HOST", "1");
        }
        let mut child = command.spawn()?;
        #[cfg(windows)]
        let job = match crate::windows::ProcessJob::new(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let stdout = child.stdout.take().ok_or("control stdout")?;
        app.manage(Self {
            stdin: Mutex::new(child.stdin.take()),
            replies: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            drop_path: Mutex::new(None),
            #[cfg(windows)]
            _job: job,
        });
        #[cfg(windows)]
        app.state::<Control>().send(&json!({"host":"ready"}))?;

        // 原生操作按发送顺序执行；读取侧必须保持畅通，才能同时完成前端请求。
        let (native_tx, native_rx) = mpsc::channel::<Value>();
        let handle = app.clone();
        std::thread::spawn(move || {
            for msg in native_rx {
                let result = crate::native::dispatch(&handle, &msg);
                let mut reply = json!({"native":msg["native"]});
                match result {
                    Ok(value) => reply["result"] = value,
                    Err(error) => reply["error"] = json!(error.to_string()),
                }
                let _ = handle.state::<Control>().send(&reply);
            }
        });
        let handle = app.clone();
        std::thread::spawn(move || {
            let state = handle.state::<Control>();
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                    eprintln!("Invalid Brevia control response");
                    continue;
                };
                if let Some(id) = msg["id"].as_u64() {
                    if let Some(reply) = state.replies.lock().unwrap().remove(&id) {
                        let result = match msg.get("error") {
                            Some(error) => Err(error.clone()),
                            None => Ok(msg["result"].clone()),
                        };
                        let _ = reply.send(result);
                    }
                } else if msg.get("native").is_some() {
                    if msg["method"]
                        .as_str()
                        .is_some_and(|s| s.starts_with("update."))
                    {
                        let app = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            let result =
                                crate::update::run(&app, msg["method"].as_str().unwrap()).await;
                            let reply = match result {
                                Ok(value) => json!({"native":msg["native"],"result":value}),
                                Err(error) => json!({"native":msg["native"],"error":error}),
                            };
                            let _ = app.state::<Control>().send(&reply);
                        });
                        continue;
                    }
                    if native_tx.send(msg).is_err() {
                        break;
                    }
                } else if let Some(event) = msg.get("event") {
                    if let Some(label) = msg["target"].as_str() {
                        let _ = handle.emit_to(label, "brevia:event", event);
                    } else {
                        let _ = handle.emit("brevia:event", event);
                    }
                }
            }
            state.shutdown();
            let result = child.wait();
            eprintln!("Brevia control exited: {result:?}");
            if !handle
                .state::<crate::Lifecycle>()
                .quitting
                .load(Ordering::Acquire)
            {
                // 控制进程退出后不能让用户继续在已失联的录音界面操作。
                crate::native::show_fatal(
                    "Brevia’s background service stopped. Reopen Brevia to recover your meeting.",
                );
                handle.exit(1);
            }
        });
        Ok(())
    }

    pub fn send(&self, value: &Value) -> std::io::Result<()> {
        let mut line = serde_json::to_vec(value)?;
        line.push(b'\n');
        self.stdin
            .lock()
            .unwrap()
            .as_mut()
            .ok_or(std::io::ErrorKind::BrokenPipe)?
            .write_all(&line)
    }

    pub async fn request(&self, label: &str, channel: &str, payload: Value) -> Reply {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.replies.lock().unwrap().insert(id, tx);
        if let Err(e) =
            self.send(&json!({ "id":id, "label":label, "channel":channel, "payload":payload }))
        {
            self.replies.lock().unwrap().remove(&id);
            return Err(json!(e.to_string()));
        }
        rx.await.map_err(|_| json!("Brevia control disconnected"))?
    }

    pub fn shutdown(&self) {
        self.stdin.lock().unwrap().take();
        self.replies.lock().unwrap().clear();
    }
}

pub fn notify(app: &AppHandle, event: Value) {
    if let Some(control) = app.try_state::<Control>() {
        let _ = control.send(&event);
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn node_starts_a_canonicalized_windows_entry() {
        let temp = tempfile::tempdir().unwrap();
        let entry = temp.path().join("控制入口 with spaces.cjs");
        std::fs::write(&entry, "process.stdout.write('ready')").unwrap();
        let canonical = std::fs::canonicalize(&entry).unwrap();
        let output = Command::new("node")
            .arg(node_path(canonical))
            .output()
            .unwrap();
        assert!(output.status.success(), "{:?}", output.stderr);
        assert_eq!(output.stdout, b"ready");
    }
}
