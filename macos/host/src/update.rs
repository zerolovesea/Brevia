use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

fn feed_name(os: &str, backend: Option<&str>) -> Option<&'static str> {
    match (os, backend.unwrap_or("cpu")) {
        ("macos", _) => Some("latest-webkit.json"),
        ("windows", "cpu") => Some("latest-windows.json"),
        ("windows", "cuda") => Some("latest-windows-cuda.json"),
        ("linux", "cpu") => Some("latest-linux-cpu.json"),
        ("linux", "cuda") => Some("latest-linux-cuda.json"),
        _ => None,
    }
}

const PUBLIC_KEY: Option<&str> = option_env!("BREVIA_NATIVE_UPDATE_PUBKEY");

const MIRROR: &str = "https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/";

fn mirror_package(endpoint: &tauri::Url, package: &tauri::Url) -> Result<tauri::Url, String> {
    if !endpoint.as_str().starts_with(MIRROR) {
        return Ok(package.clone());
    }
    let name = package
        .path_segments()
        .and_then(|mut parts| parts.next_back())
        .filter(|name| {
            name.starts_with("Brevia-")
                && name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
        .ok_or("Invalid mirrored update filename")?;
    endpoint.join(name).map_err(|e| e.to_string())
}

const MAX_PACKAGE: usize = 512 * 1024 * 1024;

async fn read_bounded(
    client: &reqwest::Client,
    url: tauri::Url,
    limit: usize,
    timeout: Duration,
    mut progress: impl FnMut(usize, Option<u64>),
) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url)
        .timeout(timeout)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let total = response.content_length();
    if total.is_some_and(|size| size > limit as u64) {
        return Err("Update exceeds download limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if chunk.len() > limit - bytes.len() {
            return Err("Update exceeds download limit".into());
        }
        bytes.extend_from_slice(&chunk);
        progress(bytes.len(), total);
    }
    Ok(bytes)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .user_agent("Brevia-updater")
        .read_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

#[derive(Default)]
pub struct State(Mutex<Option<(Update, Option<Vec<u8>>)>>);

pub async fn run(app: &AppHandle, method: &str) -> Result<Value, String> {
    let (Some(key), Some(feed)) = (
        PUBLIC_KEY.filter(|s| !s.trim().is_empty()),
        feed_name(std::env::consts::OS, option_env!("BREVIA_BUILD_BACKEND")),
    ) else {
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
                let endpoints: Vec<tauri::Url> = [
                    format!(
                        "https://github.com/zerolovesea/Brevia/releases/latest/download/{feed}"
                    ),
                    format!(
                        "https://modelscope.cn/models/zyaztec/brevia-release/resolve/master/{feed}"
                    ),
                ]
                .iter()
                .map(|url| url.parse().unwrap())
                .collect();
                let updater = app
                    .updater_builder()
                    .pubkey(key)
                    .endpoints(endpoints.clone())
                    .map_err(|e| e.to_string())?
                    .build()
                    .map_err(|e| e.to_string())?;
                let http = client()?;
                let mut result = Err("Missing update endpoint".to_string());
                for endpoint in endpoints {
                    result = read_bounded(
                        &http,
                        endpoint.clone(),
                        64 * 1024,
                        Duration::from_secs(12),
                        |_, _| {},
                    )
                    .await
                    .and_then(|data| serde_json::from_slice(&data).map_err(|e| e.to_string()))
                    .and_then(|manifest| {
                        let mut result = updater
                            .restore_update(manifest)
                            .map_err(|e| e.to_string())?;
                        if let Some(update) = &mut result {
                            update.download_url = mirror_package(&endpoint, &update.download_url)?;
                        }
                        Ok(result)
                    });
                    if result.is_ok() {
                        break;
                    }
                }
                *pending = result?.map(|update| (update, None));
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
                let start = Instant::now();
                let mut last = start;
                let data = read_bounded(&client()?, update.download_url.clone(), MAX_PACKAGE,
                    Duration::from_secs(3600), |received, total| {
                        if last.elapsed() >= Duration::from_millis(120) || total == Some(received as u64) {
                            last = Instant::now();
                            let percent = total.filter(|n| *n > 0).map_or(0., |n| 100. * received as f64 / n as f64);
                            let _ = app.emit_to("main", "brevia:event", json!({"type":"update.download-progress","payload":{"transferred":received,"total":total,"percent":percent,"bytesPerSecond":received as f64 / start.elapsed().as_secs_f64().max(0.001)}}));
                        }
                    }).await?;
                update.verify(&data).map_err(|e| e.to_string())?;
                *bytes = Some(data);
            }
            Ok(json!(true))
        }
        "update.discard" => {
            if let Some((_, bytes)) = pending.as_mut() {
                *bytes = None;
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

#[cfg(test)]
mod tests {
    use super::feed_name;

    #[test]
    fn mirror_keeps_the_asset_filename_and_uses_its_own_origin() {
        let endpoint = tauri::Url::parse(super::MIRROR)
            .unwrap()
            .join("latest-linux-cuda.json")
            .unwrap();
        let asset = tauri::Url::parse("https://github.com/zerolovesea/Brevia/releases/download/v2.0.4/Brevia-2.0.4-amd64-cuda.deb").unwrap();
        assert_eq!(
            super::mirror_package(&endpoint, &asset).unwrap().as_str(),
            format!("{}Brevia-2.0.4-amd64-cuda.deb", super::MIRROR)
        );
        assert!(super::mirror_package(&endpoint, &asset.join("Brevia-%2Fother").unwrap()).is_err());
    }

    #[test]
    fn rejects_oversized_fixed_and_chunked_updates() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        use std::time::Duration;

        for (response, allowed) in [
            ("Content-Length: 4\r\n\r\ndata", true),
            ("Content-Length: 5\r\n\r\n12345", false),
            (
                "Transfer-Encoding: chunked\r\n\r\n3\r\n123\r\n2\r\n45\r\n0\r\n\r\n",
                false,
            ),
        ] {
            let socket = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/", socket.local_addr().unwrap())
                .parse()
                .unwrap();
            let server = std::thread::spawn(move || {
                let (mut connection, _) = socket.accept().unwrap();
                connection.read(&mut [0; 2048]).unwrap();
                write!(
                    connection,
                    "HTTP/1.1 200 OK\r\nConnection: close\r\n{response}"
                )
                .unwrap();
            });
            let http = reqwest::Client::builder().no_proxy().build().unwrap();
            let result = tauri::async_runtime::block_on(super::read_bounded(
                &http,
                url,
                4,
                Duration::from_secs(3),
                |_, _| {},
            ));
            server.join().unwrap();
            if allowed {
                assert_eq!(result.unwrap(), b"data");
            } else {
                assert_eq!(result.unwrap_err(), "Update exceeds download limit");
            }
        }
    }

    #[test]
    fn release_channels_follow_the_installed_package() {
        assert_eq!(feed_name("windows", None), Some("latest-windows.json"));
        assert_eq!(
            feed_name("windows", Some("cuda")),
            Some("latest-windows-cuda.json")
        );
        assert_eq!(
            feed_name("linux", Some("cpu")),
            Some("latest-linux-cpu.json")
        );
        assert_eq!(
            feed_name("linux", Some("cuda")),
            Some("latest-linux-cuda.json")
        );
        assert_eq!(feed_name("linux", Some("unknown")), None);
    }
}
