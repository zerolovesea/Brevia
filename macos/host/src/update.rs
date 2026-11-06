use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[cfg(target_os = "macos")]
const FEED: &str =
    "https://github.com/zerolovesea/Brevia/releases/latest/download/latest-webkit.json";
#[cfg(windows)]
const FEED: &str =
    "https://github.com/zerolovesea/Brevia/releases/latest/download/latest-windows.json";
const PUBLIC_KEY: Option<&str> = option_env!("BREVIA_NATIVE_UPDATE_PUBKEY");

#[derive(Default)]
pub struct State(Mutex<Option<(Update, Option<Vec<u8>>)>>);

pub async fn run(app: &AppHandle, method: &str) -> Result<Value, String> {
    let Some(key) = PUBLIC_KEY.filter(|s| !s.trim().is_empty()) else {
        return if method == "update.check" {
            Ok(json!({"status":"unsupported"}))
        } else {
            Err("Native update signing is not configured".into())
        };
    };
    let state = app.state::<State>();
    let mut pending = state.0.lock().await;
    match method {
        "update.check" => {
            // 已校验的下载属于本次安装，其他窗口的检查不能替换它。
            if !matches!(pending.as_ref(), Some((_, Some(_)))) {
                let updater = app
                    .updater_builder()
                    .pubkey(key)
                    .endpoints(vec![FEED.parse().unwrap()])
                    .map_err(|e| e.to_string())?
                    .timeout(Duration::from_secs(180))
                    .build()
                    .map_err(|e| e.to_string())?;
                let result = tokio::time::timeout(Duration::from_secs(30), updater.check())
                    .await
                    .map_err(|_| "Update check timed out".to_string())?
                    .map_err(|e| e.to_string())?;
                *pending = result.map(|update| (update, None));
            }
            match pending.as_ref() {
                Some((u, _)) => Ok(
                    json!({"status":"available","version":u.version,"releaseDate":u.raw_json["pub_date"]}),
                ),
                None => Ok(json!({"status":"current"})),
            }
        }
        "update.download" => {
            let (update, bytes) = pending.as_mut().ok_or("Check for a native update first")?;
            if update.download_url.scheme() != "https" {
                return Err("Invalid update URL".into());
            }
            if bytes.is_none() {
                let mut received = 0usize;
                let start = Instant::now();
                let mut last = start;
                *bytes = Some(update.download(|chunk,total| {
                    received += chunk;
                    if last.elapsed() >= Duration::from_millis(120) || total == Some(received as u64) {
                        last=Instant::now();
                        let percent = total.filter(|n|*n > 0).map_or(0.,|n|100.*received as f64/n as f64);
                        let _ = app.emit_to("main","brevia:event",json!({"type":"update.download-progress","payload":{"transferred":received,"total":total,"percent":percent,"bytesPerSecond":received as f64 / start.elapsed().as_secs_f64().max(0.001)}}));
                    }
                }, ||{}).await.map_err(|e|e.to_string())?);
            }
            Ok(json!(true))
        }
        "update.install" => {
            let (update, bytes) = pending.as_ref().ok_or("No pending update")?;
            let bytes = bytes
                .as_ref()
                .ok_or("Update has not finished downloading")?;
            update.install(bytes).map_err(|e| e.to_string())?;
            pending.take();
            Ok(json!(true))
        }
        _ => Err("Unknown native update operation".into()),
    }
}
