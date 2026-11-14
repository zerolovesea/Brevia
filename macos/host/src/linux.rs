use serde_json::{json, Value};
use std::error::Error;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use std::os::fd::AsRawFd;
use std::os::unix::net::UnixDatagram;
use tauri::AppHandle;

// Resolve relative to the open profile even when its absolute path exceeds sun_path.
fn activation_path() -> std::io::Result<(std::fs::File, std::path::PathBuf)> {
    let root = crate::preferences::profile().ok_or(std::io::ErrorKind::NotFound)?;
    let directory = std::fs::File::open(root)?;
    let path = format!("/proc/self/fd/{}/activate.sock", directory.as_raw_fd());
    Ok((directory, path.into()))
}

pub fn activate_peer() -> bool {
    activation_path()
        .and_then(|(_directory, path)| UnixDatagram::unbound()?.send_to(b"show", path))
        .is_ok()
}

// Only the process holding the profile lock can replace the socket after a crash.
pub fn watch_activation(app: &AppHandle) -> std::io::Result<()> {
    let (_directory, path) = activation_path()?;
    match std::fs::remove_file(&path) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(e),
    }
    let socket = UnixDatagram::bind(path)?;
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0; 16];
        while let Ok(n) = socket.recv(&mut buf) {
            if &buf[..n] == b"show" {
                crate::control::notify(&handle, json!({"host":"app.activate"}));
            }
        }
    });
    Ok(())
}
pub fn watch_sleep(app: &AppHandle) {
    use tauri::Manager;
    let connection = match gio::bus_get_sync(gio::BusType::System, gio::Cancellable::NONE) {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!("Cannot monitor Linux suspend: {error}");
            return;
        }
    };
    let handle = app.clone();
    connection.signal_subscribe(
        Some("org.freedesktop.login1"),
        Some("org.freedesktop.login1.Manager"),
        Some("PrepareForSleep"),
        Some("/org/freedesktop/login1"),
        None,
        gio::DBusSignalFlags::NONE,
        move |_, _, _, _, _, parameters| {
            if parameters.get::<(bool,)>() == Some((true,)) {
                crate::control::notify(&handle, json!({"host":"app.suspend"}));
            }
        },
    );
    app.manage(connection);
}

pub fn open(target: &str) -> Result<(), Box<dyn Error>> {
    let mut child = Command::new("xdg-open")
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

pub fn dispatch(method: &str, args: &Value) -> Result<Value, Box<dyn Error>> {
    if method == "window.printPDF" {
        use base64::Engine;
        let helper = std::env::current_exe()?
            .parent()
            .ok_or("Missing application directory")?
            .join("../lib/Brevia/control/brevia-print");
        let path = std::fs::canonicalize(args["path"].as_str().ok_or("Missing print file")?)?;
        let result = Command::new(helper).arg(path).output()?;
        if !result.status.success() || !result.stdout.starts_with(b"%PDF-") {
            return Err("PDF export failed".into());
        }
        return Ok(json!(
            base64::engine::general_purpose::STANDARD.encode(result.stdout)
        ));
    }
    if method == "shell.copyText" {
        let text = args["text"].as_str().ok_or("Missing text")?;
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
        let mut command = Command::new(if wayland { "wl-copy" } else { "xclip" });
        if !wayland {
            command.args(["-selection", "clipboard"]);
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()?;
        let write_result = child
            .stdin
            .take()
            .ok_or("Missing clipboard input")?
            .write_all(text.as_bytes());
        let status = child.wait()?;
        write_result?;
        if !status.success() {
            return Err("Clipboard write failed".into());
        }
        return Ok(json!(true));
    }
    let mut command = Command::new("zenity");
    if let Some(title) = args["title"].as_str() {
        command.arg(format!("--title={title}"));
    }
    match method {
        "dialog.open" | "dialog.save" => {
            let save = method == "dialog.save";
            command.arg("--file-selection");
            let props = args["properties"].as_array();
            let has = |s: &str| props.is_some_and(|p| p.iter().any(|x| x == s));
            if save {
                command.args(["--save", "--confirm-overwrite"]);
            } else if has("openDirectory") {
                command.arg("--directory");
            }
            if has("multiSelections") {
                command.args(["--multiple", "--separator=\n"]);
            }
            if let Some(path) = args["defaultPath"].as_str() {
                command.arg(format!("--filename={path}"));
            }
            for filter in args["filters"].as_array().into_iter().flatten() {
                let globs: Vec<_> = filter["extensions"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(|s| {
                        if s == "*" {
                            "*".to_owned()
                        } else {
                            format!("*.{s}")
                        }
                    })
                    .collect();
                command.arg(format!(
                    "--file-filter={} | {}",
                    filter["name"].as_str().unwrap_or(""),
                    globs.join(" ")
                ));
            }
            let output = command.output()?;
            if output.status.code() == Some(1) {
                return Ok(if save {
                    json!({"canceled":true})
                } else {
                    json!({"canceled":true,"filePaths":[]})
                });
            }
            if !output.status.success() {
                return Err("Could not open file chooser".into());
            }
            let text = String::from_utf8(output.stdout)?;
            let value = text.strip_suffix('\n').unwrap_or(&text);
            if !has("multiSelections") && !Path::new(value).is_absolute() {
                return Err("Invalid selection".into());
            }
            Ok(if save {
                json!({"canceled":false,"filePath":value})
            } else if has("multiSelections") {
                json!({"canceled":false,"filePaths":value.lines().collect::<Vec<_>>()})
            } else {
                json!({"canceled":false,"filePaths":[value]})
            })
        }
        "dialog.message" => {
            let labels: Vec<_> = args["buttons"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            let cancel = args["cancelId"].as_i64().unwrap_or(-1);
            command.args(["--no-markup", "--text"]).arg(format!(
                "{}\n{}",
                args["message"].as_str().unwrap_or("Brevia"),
                args["detail"].as_str().unwrap_or("")
            ));
            if labels.len() <= 1 {
                command.arg("--info");
            } else {
                command.arg("--question");
                let default = args["defaultId"].as_u64().unwrap_or(0) as usize;
                let ok = labels.get(default).ok_or("Invalid default button")?;
                command.arg(format!("--ok-label={ok}"));
                if cancel >= 0 {
                    command.arg(format!(
                        "--cancel-label={}",
                        labels.get(cancel as usize).ok_or("Invalid cancel button")?
                    ));
                }
                for (i, label) in labels.iter().enumerate() {
                    if i != default && i as i64 != cancel {
                        command.arg(format!("--extra-button={label}"));
                    }
                }
            }
            let out = command.output()?;
            let extra = String::from_utf8(out.stdout)?;
            let selection = if let Some(i) = labels.iter().position(|s| *s == extra.trim_end()) {
                i as i64
            } else if out.status.success() {
                args["defaultId"].as_i64().unwrap_or(0)
            } else if out.status.code() == Some(1) {
                cancel
            } else {
                return Err("Could not open message dialog".into());
            };
            Ok(json!({"response":selection}))
        }
        _ => Err(format!("Unsupported Linux operation: {method}").into()),
    }
}
