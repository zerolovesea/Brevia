mod control;
mod native;
mod preferences;
mod update;

use base64::Engine;
use control::{notify, Control};
use serde_json::{json, Value};
use std::fs::{File, OpenOptions};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, RunEvent, WebviewWindow};

struct Lifecycle {
    quitting: AtomicBool,
    instance_lock: std::sync::Mutex<Option<File>>,
}
static APP: OnceLock<AppHandle> = OnceLock::new();

extern "C" fn will_sleep() {
    if let Some(app) = APP.get() {
        notify(app, json!({"host":"app.suspend"}));
    }
}

fn permitted(label: &str, channel: &str) -> bool {
    if channel.starts_with("host.") || channel == "meeting.audio" {
        return false;
    }
    match label {
        "main" => true,
        "recording-capsule" => matches!(
            channel,
            "desktop.state" | "desktop.expand" | "desktop.move" | "desktop.action" | "desktop.show"
        ),
        "floating-caption" => matches!(
            channel,
            "floating-caption.close"
                | "floating-caption.move"
                | "floating-caption.set-always-on-top"
        ),
        _ => false,
    }
}

#[tauri::command]
async fn desktop_invoke(
    window: WebviewWindow,
    channel: String,
    payload: Value,
) -> Result<Value, Value> {
    if !permitted(window.label(), &channel) {
        return Err(json!("Invalid window command"));
    }
    let app = window.app_handle();
    let state = app.state::<Control>();
    // WK 的 File 不暴露磁盘路径，只有宿主收到的最近一次拖入可充当选择。
    if channel == "meeting.select-audio" {
        if let Some(path) = payload.get("path") {
            let mut dropped = state.drop_path.lock().unwrap();
            if path.as_str().map(Path::new) != dropped.as_deref() || dropped.is_none() {
                return Err(json!("Select or drop an audio file first"));
            }
            dropped.take();
        }
    }
    state.request(window.label(), &channel, payload).await
}

fn instance_lock() -> Result<Option<File>, Box<dyn std::error::Error>> {
    let dir = preferences::profile().ok_or("No application support directory")?;
    std::fs::create_dir_all(&dir)?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join("webkit.lock"))?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(e)) => Err(e.into()),
    }
}

fn main() {
    extern "C" {
        fn brevia_activate_running_peer(legacy_only: bool) -> i32;
    }
    if std::env::var_os("BREVIA_DATA_DIR").is_none()
        && unsafe { brevia_activate_running_peer(true) } == 1
    {
        return;
    }
    let _lock = match instance_lock() {
        Ok(Some(lock)) => lock,
        Ok(None) => {
            unsafe {
                brevia_activate_running_peer(false);
            }
            return;
        }
        Err(e) => {
            eprintln!("Brevia cannot acquire its instance lock: {e}");
            std::process::exit(1);
        }
    };
    let app = tauri::Builder::default()
        .manage(Lifecycle{quitting: AtomicBool::new(false), instance_lock: std::sync::Mutex::new(Some(_lock))})
        .manage(update::State::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .on_web_content_process_terminate(|view| {
            notify(view.app_handle(), json!({"host":"window.crashed", "label":view.label()}));
            let _ = view.reload();
        })
        .invoke_handler(tauri::generate_handler![desktop_invoke, preferences::confirm_preferences])
        .register_asynchronous_uri_scheme_protocol("brevia-note", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                let meeting = request.uri().host().unwrap_or("");
                let name = request.uri().path().trim_start_matches('/');
                let payload = json!({"meeting_id":meeting, "filename":name});
                let result = app.state::<Control>().request("host","host.note-image",payload).await;
                let data = result.ok().and_then(|v|{
                    let kind=v["type"].as_str()?;
                    if !matches!(kind,"image/png"|"image/jpeg"|"image/gif"|"image/webp") {return None;}
                    Some((kind.to_owned(),base64::engine::general_purpose::STANDARD.decode(v["base64"].as_str()?).ok()?))
                });
                let response = match data {
                    Some((kind,bytes))=>tauri::http::Response::builder().header("Content-Type",kind).body(bytes),
                    None=>tauri::http::Response::builder().status(404).body(Vec::new()),
                };
                responder.respond(response.unwrap());
            });
        })
        .setup(|app| {
            let _ = APP.set(app.handle().clone());
            unsafe {native::brevia_watch_sleep(will_sleep);}
            Control::start(app.handle())?;
            if let Ok(Some(m)) = app.primary_monitor() {
                let pos=m.work_area().position.to_logical::<f64>(m.scale_factor());
                let size=m.work_area().size.to_logical::<f64>(m.scale_factor());
                notify(app.handle(),json!({"host":"screen.workArea","bounds":{"x":pos.x,"y":pos.y,"width":size.width,"height":size.height}}));
            }
            Ok(())
        })
        .build(tauri::generate_context!()).expect("Brevia host startup failed");
    app.run(|handle, event| match event {
        RunEvent::ExitRequested {
            api, code: None, ..
        } if !handle.state::<Lifecycle>().quitting.load(Ordering::Acquire) => {
            api.prevent_exit();
            notify(handle, json!({"host":"app.quit"}));
        }
        RunEvent::Reopen { .. } => notify(handle, json!({"host":"app.activate"})),
        RunEvent::Exit => {
            handle
                .state::<Lifecycle>()
                .quitting
                .store(true, Ordering::Release);
            handle.state::<Control>().shutdown();
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restricts_internal_commands_and_overlay_origins() {
        assert!(!permitted("main", "host.note-image"));
        assert!(!permitted("main", "meeting.audio"));
        assert!(!permitted("recording-capsule", "meeting.delete"));
        assert!(permitted("recording-capsule", "desktop.action"));
        assert!(!permitted("floating-caption", "summary.config.get"));
        assert!(permitted("main", "meeting.list"));
    }
}
