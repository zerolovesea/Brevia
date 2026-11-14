use crate::control::{notify, Control};
use crate::Lifecycle;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::{json, Value};
#[cfg(target_os = "macos")]
use sha2::{Digest, Sha256};
use std::error::Error;
#[cfg(target_os = "macos")]
use std::ffi::{c_char, c_void, CStr, CString};
use std::path::Path;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::atomic::Ordering;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

type NativeResult = Result<Value, Box<dyn Error>>;

#[cfg(target_os = "macos")]
extern "C" {
    fn brevia_appkit(name: *const c_char, args: *const c_char, window: *mut c_void) -> *mut c_char;
    fn brevia_free(response: *mut c_char);
    pub fn brevia_watch_sleep(notify: extern "C" fn());
}

#[cfg(target_os = "macos")]
fn system_operation(method: &str, args: &Value, window: Option<&WebviewWindow>) -> NativeResult {
    let mut args = args.clone();
    if method == "window.printPDF" {
        args["brand"] = Value::from(include_str!("../../../frontend/assets/brevia-logo.svg"));
    }
    let method = CString::new(method)?;
    let args = CString::new(serde_json::to_vec(&args)?)?;
    let window = window
        .map(|w| w.ns_window())
        .transpose()?
        .unwrap_or(std::ptr::null_mut());
    let response = unsafe { brevia_appkit(method.as_ptr(), args.as_ptr(), window) };
    if response.is_null() {
        return Err("AppKit response failed".into());
    }
    let parsed = unsafe { serde_json::from_slice::<Value>(CStr::from_ptr(response).to_bytes()) };
    unsafe { brevia_free(response) };
    let parsed = parsed?;
    if let Some(error) = parsed["error"].as_str() {
        return Err(error.into());
    }
    Ok(parsed["result"].clone())
}

#[cfg(windows)]
fn system_operation(method: &str, args: &Value, window: Option<&WebviewWindow>) -> NativeResult {
    crate::windows::dispatch(method, args, window)
}

#[cfg(target_os = "linux")]
fn system_operation(method: &str, args: &Value, _window: Option<&WebviewWindow>) -> NativeResult {
    crate::linux::dispatch(method, args)
}
fn local_page(url: &tauri::Url, page: &str) -> bool {
    let origin = if cfg!(windows) {
        matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost")
    } else {
        url.scheme() == "tauri" && url.host_str() == Some("localhost")
    };
    origin
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && (url.path() == format!("/{page}")
            || (page == "index.html" && matches!(url.path(), "" | "/")))
}

fn shortcut_key(accelerator: &str) -> String {
    accelerator
        .replace(
            "CommandOrControl",
            if cfg!(target_os = "macos") {
                "Super"
            } else {
                "Control"
            },
        )
        .replace(
            "CmdOrCtrl",
            if cfg!(target_os = "macos") {
                "Super"
            } else {
                "Control"
            },
        )
        .replace("Command", "Super")
}

pub fn show_fatal(message: &str) {
    let _ = system_operation(
        "dialog.message",
        &json!({"message":"Brevia", "detail":message}),
        None,
    );
}

fn window_bounds(window: &WebviewWindow) -> NativeResult {
    let scale = window.scale_factor()?;
    let pos = window.outer_position()?.to_logical::<f64>(scale);
    let size = window.outer_size()?.to_logical::<f64>(scale);
    Ok(json!({"x":pos.x,"y":pos.y,"width":size.width,"height":size.height}))
}

fn can_open_web_link(page: &str, url: &tauri::Url) -> bool {
    page == "index.html" && matches!(url.scheme(), "https" | "http")
}

fn open_web_link(page: &str, url: &tauri::Url) {
    if can_open_web_link(page, url) {
        let address = url.as_str().to_owned();
        std::thread::spawn(move || {
            #[cfg(target_os = "macos")]
            let _ = Command::new("/usr/bin/open").arg(address).status();
            #[cfg(target_os = "linux")]
            let _ = crate::linux::open(&address);
            #[cfg(windows)]
            let _ = crate::windows::open(&address, false);
        });
    }
}

fn create_window(app: &AppHandle, label: &str, args: &Value) -> NativeResult {
    let page = match label {
        "main" => "index.html",
        "floating-caption" => "floating-caption.html",
        "recording-capsule" => "recording-capsule.html",
        "meeting-prompt" => "meeting-prompt.html",
        _ => return Err("Unknown window".into()),
    };
    let supplied = args["page"].as_str().unwrap_or(page);
    let name = supplied;
    if Path::new(name).file_name().and_then(|s| s.to_str()) != Some(page) {
        return Err("Unknown page".into());
    }
    let target = if page == "index.html" && args["query"]["resetOnboarding"] == "1" {
        format!("{page}?resetOnboarding=1")
    } else {
        page.to_string()
    };
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(target.into()))
        .initialization_script(format!(
            "window.__BREVIA_PLATFORM__ = {:?};",
            if cfg!(windows) {
                "win32"
            } else if cfg!(target_os = "macos") {
                "darwin"
            } else {
                "linux"
            }
        ))
        .initialization_script(include_str!("../../bridge.js").replace(
            "/* BREVIA_PRELOAD */",
            include_str!("../../../desktop/preload.js"),
        ))
        .on_navigation(move |url| {
            let local = local_page(url, page);
            if !local {
                open_web_link(page, url);
            }
            local
        })
        .on_new_window(move |url, _| {
            open_web_link(page, &url);
            NewWindowResponse::Deny
        })
        .on_page_load(|window, load| {
            if load.event() == PageLoadEvent::Finished {
                notify(
                    window.app_handle(),
                    json!({"host":"window.loaded","label":window.label()}),
                );
            }
        })
        .title("Brevia")
        .inner_size(
            args["width"].as_f64().unwrap_or(1200.),
            args["height"].as_f64().unwrap_or(800.),
        )
        .visible(args["visible"].as_bool().unwrap_or(true))
        .resizable(args["resizable"].as_bool().unwrap_or(true));
    if label == "main" {
        if let Some(script) = crate::preferences::initialization() {
            builder = builder.initialization_script(script);
        }
        #[cfg(target_os = "macos")]
        {
            builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
        }
    } else {
        builder = builder
            .decorations(false)
            .shadow(false)
            .skip_taskbar(true)
            .focused(false)
            .always_on_top(args["alwaysOnTop"].as_bool().unwrap_or(true))
            .transparent(args["transparent"].as_bool().unwrap_or(true))
            .background_color(tauri::window::Color(0, 0, 0, 0));
        #[cfg(target_os = "macos")]
        {
            builder = builder
                .accept_first_mouse(true)
                .visible_on_all_workspaces(true);
        }
    }
    if let (Some(x), Some(y)) = (args["x"].as_f64(), args["y"].as_f64()) {
        builder = builder.position(x, y);
    }
    if let (Some(w), Some(h)) = (args["minWidth"].as_f64(), args["minHeight"].as_f64()) {
        builder = builder.min_inner_size(w, h);
    }
    #[cfg(target_os = "macos")]
    if let Some(profile) = std::env::var_os("BREVIA_DATA_DIR") {
        // 每个显式资料目录使用自己的持久 WebKit 存储。
        let digest = Sha256::digest(profile.as_encoded_bytes());
        builder = builder.data_store_identifier(digest[..16].try_into().unwrap());
    }
    #[cfg(windows)]
    if let Some(profile) = crate::preferences::profile() {
        builder = builder.data_directory(profile.join("WebView2"));
    }
    let window = builder.build()?;
    #[cfg(windows)]
    crate::windows::watch_webview(&window)?;
    #[cfg(target_os = "macos")]
    if label == "main" {
        extern "C" {
            fn brevia_watch_minimize(window: *mut c_void, notify: extern "C" fn(bool));
        }
        extern "C" fn changed(minimized: bool) {
            if let Some(app) = crate::APP.get() {
                notify(
                    app,
                    json!({"host":if minimized {"window.minimize"} else {"window.restore"},"label":"main"}),
                );
            }
        }
        unsafe {
            brevia_watch_minimize(window.ns_window()?, changed);
        }
    }
    let handle = app.clone();
    let label = label.to_owned();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            notify(&handle, json!({"host":"window.close","label":label}));
        }
        WindowEvent::Focused(focus) => notify(
            &handle,
            json!({"host":if *focus {"window.focus"} else {"window.blur"},"label":label}),
        ),
        WindowEvent::Destroyed => notify(&handle, json!({"host":"window.closed","label":label})),
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            #[cfg(windows)]
            if label == "main" && matches!(event, WindowEvent::Resized(_)) {
                if let Some(window) = handle.get_webview_window(&label) {
                    if let Ok(minimized) = window.is_minimized() {
                        notify(&handle, json!({"host":if minimized {"window.minimize"} else {"window.restore"},"label":label}));
                    }
                }
            }
            if let Some(bounds) = handle
                .get_webview_window(&label)
                .and_then(|w| window_bounds(&w).ok())
            {
                notify(
                    &handle,
                    json!({"host":"window.bounds","label":label,"bounds":bounds}),
                );
            }
        }
        WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) if label == "main" => {
            if let Some(path) = paths.first().filter(|p| p.is_file()) {
                *handle.state::<Control>().drop_path.lock().unwrap() = Some(path.to_owned());
                let _ = handle.emit_to(
                    "main",
                    "brevia:event",
                    json!({"type":"native.drop","payload":{"path":path}}),
                );
            }
        }
        _ => {}
    });
    Ok(json!(true))
}

fn menu_item(app: &AppHandle, item: &Value) -> Result<MenuItemKind<Wry>, Box<dyn Error>> {
    if item["type"] == "separator" {
        return Ok(MenuItemKind::Predefined(PredefinedMenuItem::separator(
            app,
        )?));
    }
    let text = item["label"].as_str().unwrap_or("");
    let id = item["id"].as_str().unwrap_or(text);
    let enabled = item["enabled"].as_bool().unwrap_or(true);
    if let Some(items) = item["items"].as_array() {
        let submenu = Submenu::new(app, text, enabled)?;
        for child in items {
            submenu.append(&menu_item(app, child)?)?;
        }
        Ok(MenuItemKind::Submenu(submenu))
    } else if let Some(checked) = item["checked"].as_bool() {
        Ok(MenuItemKind::Check(CheckMenuItem::with_id(
            app,
            id,
            text,
            enabled,
            checked,
            None::<&str>,
        )?))
    } else {
        Ok(MenuItemKind::MenuItem(MenuItem::with_id(
            app,
            id,
            text,
            enabled,
            None::<&str>,
        )?))
    }
}

pub fn dispatch(app: &AppHandle, msg: &Value) -> NativeResult {
    let method = msg["method"].as_str().ok_or("Missing native method")?;
    let a = &msg["args"];
    let label = a["label"].as_str().unwrap_or("main");
    let window = app.get_webview_window(label);
    let win = || window.as_ref().ok_or("Window closed");
    let text = |key: &str| a[key].as_str().ok_or("Missing argument");
    match method {
        "window.create" => return create_window(app, label, a),
        "window.show" => win()?.show()?,
        "window.restore" => win()?.unminimize()?,
        "window.setZoom" => win()?.set_zoom(a["factor"].as_f64().ok_or("Missing zoom factor")?)?,
        "window.hide" => win()?.hide()?,
        "window.close" => win()?.destroy()?,
        "window.focus" => win()?.set_focus()?,
        "window.startDragging" => win()?.start_dragging()?,
        "window.setEnabled" => {
            win()?.set_enabled(a["value"].as_bool().ok_or("Missing enabled")?)?
        }
        "window.setTitle" => win()?.set_title(text("title")?)?,
        "window.setAlwaysOnTop" => win()?.set_always_on_top(
            a["alwaysOnTop"]
                .as_bool()
                .or_else(|| a["value"].as_bool())
                .ok_or("Missing alwaysOnTop")?,
        )?,
        "window.getBounds" => return window_bounds(win()?),
        "window.setBounds" => {
            let b = a.get("bounds").unwrap_or(a);
            if label == "recording-capsule" {
                return system_operation(method, b, window.as_ref());
            }
            if let (Some(w), Some(h)) = (b["width"].as_f64(), b["height"].as_f64()) {
                win()?.set_size(LogicalSize::new(w, h))?;
            }
            if let (Some(x), Some(y)) = (b["x"].as_f64(), b["y"].as_f64()) {
                win()?.set_position(LogicalPosition::new(x, y))?;
            }
        }
        "screen.workArea" => {
            let monitor = window
                .and_then(|w| w.current_monitor().ok().flatten())
                .or(app.primary_monitor()?)
                .ok_or("No display")?;
            let area = monitor.work_area();
            let pos = area.position.to_logical::<f64>(monitor.scale_factor());
            let size = area.size.to_logical::<f64>(monitor.scale_factor());
            return Ok(json!({"x":pos.x,"y":pos.y,"width":size.width,"height":size.height}));
        }
        "dialog.open" | "dialog.save" | "dialog.message" | "shell.copyText" | "shell.share"
        | "window.printPDF" => return system_operation(method, a, window.as_ref()),
        "shell.openExternal" | "shell.openPath" | "shell.showItem" => {
            #[cfg(target_os = "macos")]
            let mut open = Command::new("/usr/bin/open");
            if method == "shell.openExternal" {
                let url = tauri::Url::parse(text("url")?)?;
                if !matches!(
                    url.scheme(),
                    "https" | "http" | "mailto" | "x-apple.systempreferences" | "ms-settings"
                ) {
                    return Err("Unsupported URL".into());
                }
                #[cfg(target_os = "macos")]
                open.arg(url.as_str());
                #[cfg(target_os = "linux")]
                crate::linux::open(url.as_str())?;
                #[cfg(windows)]
                crate::windows::open(url.as_str(), false)?;
            } else {
                let path = Path::new(text("path")?);
                if !path.is_absolute() {
                    return Err("Expected absolute path".into());
                }
                #[cfg(target_os = "macos")]
                {
                    if method == "shell.showItem" {
                        open.arg("-R");
                    }
                    open.arg(path);
                }
                #[cfg(target_os = "linux")]
                crate::linux::open(
                    if method == "shell.showItem" {
                        path.parent().unwrap_or(path)
                    } else {
                        path
                    }
                    .to_str()
                    .ok_or("Invalid path")?,
                )?;
                #[cfg(windows)]
                crate::windows::open(text("path")?, method == "shell.showItem")?;
            }
            #[cfg(target_os = "macos")]
            if !open.status()?.success() {
                return Err("macOS could not open this item".into());
            }
        }
        "file.url" => {
            let path = std::fs::canonicalize(text("path")?)?;
            if !path.is_file() {
                return Err("Expected audio file".into());
            }
            app.asset_protocol_scope().allow_file(&path)?;
            return Ok(json!(format!(
                "{}{}",
                if cfg!(windows) {
                    "http://asset.localhost/"
                } else {
                    "asset://localhost/"
                },
                utf8_percent_encode(path.to_str().ok_or("Invalid path")?, NON_ALPHANUMERIC)
            )));
        }
        "tray.set" => {
            if a["visible"] == false {
                app.remove_tray_by_id("brevia");
                return Ok(json!(true));
            }
            let menu = Menu::new(app)?;
            for item in a["items"].as_array().into_iter().flatten() {
                menu.append(&menu_item(app, item)?)?;
            }
            let tray = match app.tray_by_id("brevia") {
                Some(tray) => {
                    tray.set_menu(Some(menu))?;
                    tray
                }
                None => TrayIconBuilder::with_id("brevia")
                    .icon(tauri::include_image!(
                        "../../desktop/assets/trayTemplate.png"
                    ))
                    .icon_as_template(cfg!(target_os = "macos"))
                    .menu(&menu)
                    .on_menu_event(|app, event| {
                        notify(app, json!({"host":"tray.click","id":event.id().as_ref()}))
                    })
                    .build(app)?,
            };
            if let Some(title) = a["title"].as_str() {
                tray.set_title(Some(title))?;
            }
            if let Some(tip) = a["tooltip"].as_str() {
                tray.set_tooltip(Some(tip))?;
            }
        }
        "shortcut.register" | "shortcut.unregister" => {
            let accelerator = text("accelerator")?.to_owned();
            let shortcut = shortcut_key(&accelerator);
            if method == "shortcut.register" {
                app.global_shortcut()
                    .on_shortcut(shortcut.as_str(), move |app, _, event| {
                        if event.state == ShortcutState::Pressed {
                            notify(app, json!({"host":"shortcut","accelerator":accelerator}));
                        }
                    })?;
            } else {
                app.global_shortcut().unregister(shortcut.as_str())?;
            }
        }
        "app.quit" | "app.relaunch" => {
            app.state::<Lifecycle>()
                .quitting
                .store(true, Ordering::Release);
            if method == "app.relaunch" {
                // LaunchServices 会先启动新版再结束旧版，此时副进程已经清理完毕。
                app.state::<Lifecycle>()
                    .instance_lock
                    .lock()
                    .unwrap()
                    .take();
                app.restart();
            } else {
                app.exit(0);
            }
        }
        _ => return Err(format!("Unsupported native operation: {method}").into()),
    }
    Ok(json!(true))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_application_documents_receive_the_bridge() {
        let base = if cfg!(windows) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        };
        assert!(local_page(
            &format!("{base}/index.html?resetOnboarding=1")
                .parse()
                .unwrap(),
            "index.html"
        ));
        for suffix in ["/floating-caption.html", "/other.html", "/index.html/extra"] {
            assert!(!local_page(
                &format!("{base}{suffix}").parse().unwrap(),
                "index.html"
            ));
        }
        assert!(!local_page(
            &"https://tauri.localhost.evil.test/index.html"
                .parse()
                .unwrap(),
            "index.html"
        ));
        assert!(!local_page(
            &"http://tauri.localhost:8080/index.html".parse().unwrap(),
            "index.html"
        ));
    }
    #[test]
    fn external_web_links_only_open_from_the_main_document() {
        let link = "https://example.org/".parse().unwrap();
        assert!(can_open_web_link("index.html", &link));
        assert!(!can_open_web_link(
            "index.html",
            &"file:///tmp/a".parse().unwrap()
        ));
        for page in [
            "floating-caption.html",
            "recording-capsule.html",
            "meeting-prompt.html",
        ] {
            assert!(!can_open_web_link(page, &link));
            assert!(!local_page(&link, page));
        }
    }
    #[test]
    fn command_or_control_uses_the_platform_modifier() {
        assert_eq!(
            shortcut_key("CommandOrControl+Shift+R"),
            if cfg!(windows) {
                "Control+Shift+R"
            } else {
                "Super+Shift+R"
            }
        );
    }
}
