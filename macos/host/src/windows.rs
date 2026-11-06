use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{error::Error, path::Path, sync::mpsc, time::Duration};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use webview2_com::{
    Microsoft::Web::WebView2::Win32::*, NavigationCompletedEventHandler,
    PrintToPdfCompletedHandler, ProcessFailedEventHandler, WebResourceRequestedEventHandler,
};
use windows::{
    core::{w, Interface, BOOL, PCWSTR, PWSTR},
    Win32::{
        Foundation::*,
        System::{
            Com::*, DataExchange::*, JobObjects::*, LibraryLoader::*, Memory::*, Threading::*,
        },
        UI::{
            Controls::*,
            Shell::{Common::COMDLG_FILTERSPEC, *},
            WindowsAndMessaging::*,
        },
    },
};

type NativeResult = Result<Value, Box<dyn Error>>;
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

struct Com;
impl Com {
    fn new() -> windows::core::Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        }
        Ok(Self)
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

pub fn open(value: &str, reveal: bool) -> Result<(), Box<dyn Error>> {
    if value.contains('\0') {
        return Err("Invalid path or URL".into());
    }
    let value = wide(value);
    unsafe {
        if reveal {
            let _com = Com::new()?;
            let mut pidl = std::ptr::null_mut();
            SHParseDisplayName(PCWSTR(value.as_ptr()), None, &mut pidl, 0, None)?;
            let result = SHOpenFolderAndSelectItems(pidl, None, 0);
            CoTaskMemFree(Some(pidl.cast()));
            result?;
        } else if ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(value.as_ptr()),
            None,
            None,
            SW_SHOWNORMAL,
        )
        .0 as isize
            <= 32
        {
            return Err("Windows could not open this item".into());
        }
    }
    Ok(())
}

unsafe fn shell_path(item: &IShellItem) -> windows::core::Result<String> {
    let value = item.GetDisplayName(SIGDN_FILESYSPATH)?;
    let result = value.to_string();
    CoTaskMemFree(Some(value.0.cast()));
    Ok(result?)
}

fn file_dialog(save: bool, args: &Value, owner: Option<HWND>) -> NativeResult {
    let _com = Com::new()?;
    unsafe {
        let dialog: IFileDialog = CoCreateInstance(
            if save {
                &FileSaveDialog
            } else {
                &FileOpenDialog
            },
            None,
            CLSCTX_INPROC_SERVER,
        )?;
        let props = args["properties"].as_array();
        let has = |name| props.is_some_and(|p| p.iter().any(|v| v == name));
        let mut flags = dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR;
        if save {
            flags |= FOS_OVERWRITEPROMPT;
        } else {
            flags |= FOS_FILEMUSTEXIST;
            if has("openDirectory") {
                flags |= FOS_PICKFOLDERS;
            }
            if has("multiSelections") {
                flags |= FOS_ALLOWMULTISELECT;
            }
        }
        dialog.SetOptions(flags)?;
        if let Some(title) = args["title"].as_str() {
            dialog.SetTitle(PCWSTR(wide(title).as_ptr()))?;
        }
        if let Some(label) = args["buttonLabel"].as_str() {
            dialog.SetOkButtonLabel(PCWSTR(wide(label).as_ptr()))?;
        }
        let filters: Vec<_> = args["filters"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|filter| {
                let extensions: Vec<_> = filter["extensions"]
                    .as_array()?
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|s| format!("*.{s}"))
                    .collect();
                if extensions.is_empty() {
                    return None;
                }
                Some((
                    wide(filter["name"].as_str().unwrap_or("Files")),
                    wide(&extensions.join(";")),
                ))
            })
            .collect();
        let specs: Vec<_> = filters
            .iter()
            .map(|(name, pattern)| COMDLG_FILTERSPEC {
                pszName: PCWSTR(name.as_ptr()),
                pszSpec: PCWSTR(pattern.as_ptr()),
            })
            .collect();
        if !specs.is_empty() && !has("openDirectory") {
            dialog.SetFileTypes(&specs)?;
        }
        if let Some(value) = args["defaultPath"].as_str() {
            let path = Path::new(value);
            let folder = if path.is_dir() {
                Some(path)
            } else {
                path.parent().filter(|p| p.is_dir())
            };
            if let Some(folder) = folder {
                let item: IShellItem = SHCreateItemFromParsingName(
                    PCWSTR(wide(&folder.to_string_lossy()).as_ptr()),
                    None,
                )?;
                dialog.SetFolder(&item)?;
            }
            if save && !path.is_dir() {
                if let Some(name) = path.file_name() {
                    dialog.SetFileName(PCWSTR(wide(&name.to_string_lossy()).as_ptr()))?;
                }
                if let Some(ext) = path.extension() {
                    dialog.SetDefaultExtension(PCWSTR(wide(&ext.to_string_lossy()).as_ptr()))?;
                }
            }
        }
        if let Err(error) = dialog.Show(owner) {
            if error.code() == windows::core::HRESULT::from_win32(ERROR_CANCELLED.0) {
                return Ok(if save {
                    json!({"canceled":true})
                } else {
                    json!({"canceled":true,"filePaths":[]})
                });
            }
            return Err(error.into());
        }
        if save {
            return Ok(json!({"canceled":false,"filePath":shell_path(&dialog.GetResult()?)?}));
        }
        let items = dialog.cast::<IFileOpenDialog>()?.GetResults()?;
        let paths: Vec<_> = (0..items.GetCount()?)
            .map(|i| shell_path(&items.GetItemAt(i)?))
            .collect::<windows::core::Result<_>>()?;
        Ok(json!({"canceled":false,"filePaths":paths}))
    }
}

fn message_dialog(args: &Value, owner: Option<HWND>) -> NativeResult {
    let labels: Vec<_> = args["buttons"]
        .as_array()
        .map(|v| v.iter().map(|v| wide(v.as_str().unwrap_or("OK"))).collect())
        .unwrap_or_else(|| vec![wide("OK")]);
    let cancel = args["cancelId"]
        .as_u64()
        .filter(|n| (*n as usize) < labels.len())
        .map(|n| n as i32);
    let buttons: Vec<_> = labels
        .iter()
        .enumerate()
        .map(|(i, label)| TASKDIALOG_BUTTON {
            nButtonID: if cancel == Some(i as i32) {
                IDCANCEL.0
            } else {
                100 + i as i32
            },
            pszButtonText: PCWSTR(label.as_ptr()),
        })
        .collect();
    let title = wide(args["title"].as_str().unwrap_or("Brevia"));
    let message = wide(args["message"].as_str().unwrap_or("Brevia"));
    let detail = wide(args["detail"].as_str().unwrap_or(""));
    let config = TASKDIALOGCONFIG {
        cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
        hwndParent: owner.unwrap_or_default(),
        dwFlags: TDF_SIZE_TO_CONTENT
            | if cancel.is_some() {
                TDF_ALLOW_DIALOG_CANCELLATION
            } else {
                TASKDIALOG_FLAGS(0)
            },
        pszWindowTitle: PCWSTR(title.as_ptr()),
        pszMainInstruction: PCWSTR(message.as_ptr()),
        pszContent: PCWSTR(detail.as_ptr()),
        cButtons: buttons.len() as u32,
        pButtons: buttons.as_ptr(),
        nDefaultButton: buttons
            .get(args["defaultId"].as_u64().unwrap_or(0) as usize)
            .map_or(100, |b| b.nButtonID),
        ..Default::default()
    };
    let mut selected = 0;
    unsafe {
        TaskDialogIndirect(&config, Some(&mut selected), None, None)?;
    }
    Ok(
        json!({"response":if selected == IDCANCEL.0 { cancel.unwrap_or(-1) } else { selected - 100 }}),
    )
}

fn copy_text(value: &str, owner: Option<HWND>) -> NativeResult {
    let text = wide(value);
    unsafe {
        OpenClipboard(owner)?;
        struct Clipboard;
        impl Drop for Clipboard {
            fn drop(&mut self) {
                unsafe {
                    let _ = CloseClipboard();
                }
            }
        }
        let _clipboard = Clipboard;
        let memory = GlobalAlloc(GMEM_MOVEABLE, text.len() * 2)?;
        let address = GlobalLock(memory);
        if address.is_null() {
            let _ = GlobalFree(Some(memory));
            return Err(windows::core::Error::from_thread().into());
        }
        std::ptr::copy_nonoverlapping(text.as_ptr(), address.cast(), text.len());
        let _ = GlobalUnlock(memory);
        let result = EmptyClipboard().and_then(|_| SetClipboardData(13, Some(HANDLE(memory.0))));
        if result.is_err() {
            let _ = GlobalFree(Some(memory));
        }
        result?;
    }
    Ok(json!(true))
}

fn print_pdf(app: &AppHandle, source: &Path) -> NativeResult {
    let source = std::fs::canonicalize(source)?;
    if !source.is_file() {
        return Err("Missing print document".into());
    }
    let id = format!(
        "print-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    );
    let destination = std::env::temp_dir().join(format!("brevia-{id}.pdf"));
    // 打印窗无前端桥、无脚本且只能导航到当前离线导出页面。
    let url = tauri::Url::from_file_path(&source).map_err(|_| "Invalid print path")?;
    let allowed = url.clone();
    let mut builder =
        WebviewWindowBuilder::new(app, id, WebviewUrl::External("about:blank".parse()?))
            .visible(false)
            .skip_taskbar(true)
            .on_navigation(move |u| *u == allowed || u.as_str() == "about:blank")
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    if let Some(profile) = crate::preferences::profile() {
        builder = builder.data_directory(profile.join("WebView2"));
    }
    let window = builder.build()?;
    struct PrintWindow(WebviewWindow);
    impl Drop for PrintWindow {
        fn drop(&mut self) {
            let _ = self.0.destroy();
        }
    }
    let window = PrintWindow(window);
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let output = destination.clone();
    window.0.with_webview(move |webview| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let core = webview.controller().CoreWebView2()?;
            core.Settings()?.SetIsScriptEnabled(false)?;
            core.AddWebResourceRequestedFilter(
                w!("http://*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            )?;
            core.AddWebResourceRequestedFilter(
                w!("https://*"),
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            )?;
            let environment = webview.environment();
            let mut resource_token = 0;
            core.add_WebResourceRequested(
                &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        args.SetResponse(&environment.CreateWebResourceResponse(
                            None::<&IStream>,
                            403,
                            w!("Offline export"),
                            w!(""),
                        )?)?;
                    }
                    Ok(())
                })),
                &mut resource_token,
            )?;
            core.cast::<ICoreWebView2_7>()?;
            let settings = webview
                .environment()
                .cast::<ICoreWebView2Environment6>()?
                .CreatePrintSettings()?;
            settings.SetPageWidth(8.2677)?;
            settings.SetPageHeight(11.6929)?;
            settings.SetMarginTop(0.45)?;
            settings.SetMarginBottom(0.45)?;
            settings.SetMarginLeft(0.39)?;
            settings.SetMarginRight(0.39)?;
            settings.SetShouldPrintBackgrounds(true)?;
            let sender = tx.clone();
            let target = output.to_string_lossy().to_string();
            let expected = url.to_string();
            let mut token = 0;
            core.add_NavigationCompleted(
                &NavigationCompletedEventHandler::create(Box::new(move |sender_view, args| {
                    let Some(view) = sender_view else {
                        return Ok(());
                    };
                    let mut current = PWSTR::null();
                    view.Source(&mut current)?;
                    let address = current.to_string();
                    CoTaskMemFree(Some(current.0.cast()));
                    if address? != expected {
                        return Ok(());
                    }
                    let mut success = BOOL(0);
                    if let Some(args) = args {
                        args.IsSuccess(&mut success)?;
                    }
                    if !success.as_bool() {
                        let _ = sender.send(Err("Unable to load print document".into()));
                        return Ok(());
                    }
                    let done = sender.clone();
                    let result = view.cast::<ICoreWebView2_7>()?.PrintToPdf(
                        PCWSTR(wide(&target).as_ptr()),
                        &settings,
                        &PrintToPdfCompletedHandler::create(Box::new(move |result, success| {
                            let _ = done.send(result.map_err(|e| e.to_string()).and_then(|_| {
                                if success {
                                    Ok(())
                                } else {
                                    Err("PDF export failed".into())
                                }
                            }));
                            Ok(())
                        })),
                    );
                    if let Err(error) = result {
                        let _ = sender.send(Err(error.to_string()));
                    }
                    Ok(())
                })),
                &mut token,
            )?;
            core.Navigate(PCWSTR(wide(url.as_str()).as_ptr()))?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = tx.send(Err(error.to_string()));
        }
    })?;
    let bytes: Result<Vec<u8>, Box<dyn Error>> = match rx.recv_timeout(Duration::from_secs(60)) {
        Ok(Ok(())) => std::fs::read(&destination).map_err(Into::into),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => Err("Timed out preparing PDF".into()),
    };
    drop(window);
    let _ = std::fs::remove_file(destination);
    Ok(json!(
        base64::engine::general_purpose::STANDARD.encode(bytes?)
    ))
}

pub fn dispatch(method: &str, args: &Value, window: Option<&WebviewWindow>) -> NativeResult {
    let owner = window.map(|w| w.hwnd()).transpose()?;
    match method {
        "dialog.open" => file_dialog(false, args, owner),
        "dialog.save" => file_dialog(true, args, owner),
        "dialog.message" => message_dialog(args, owner),
        "shell.copyText" => copy_text(args["text"].as_str().ok_or("Missing text")?, owner),
        "window.printPDF" => print_pdf(
            window.ok_or("Window closed")?.app_handle(),
            Path::new(args["path"].as_str().ok_or("Missing print file")?),
        ),
        _ => Err(format!("Unsupported Windows operation: {method}").into()),
    }
}

pub struct ProcessJob(HANDLE);
unsafe impl Send for ProcessJob {}
unsafe impl Sync for ProcessJob {}
impl ProcessJob {
    pub fn new(child: &std::process::Child) -> Result<Self, Box<dyn Error>> {
        use std::os::windows::io::AsRawHandle;
        unsafe {
            let job = Self(CreateJobObjectW(None, None)?);
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&limits) as u32,
            )?;
            AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle()))?;
            Ok(job)
        }
    }
}
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

fn listener_name() -> Vec<u16> {
    let profile = crate::preferences::profile().unwrap_or_default();
    wide(&format!(
        "BreviaNative-{:x}",
        Sha256::digest(profile.as_os_str().as_encoded_bytes())
    ))
}

pub fn activate_peer(legacy_only: bool) -> bool {
    unsafe extern "system" fn legacy(hwnd: HWND, result: LPARAM) -> BOOL {
        let mut class = [0u16; 128];
        let size = GetClassNameW(hwnd, &mut class);
        if String::from_utf16_lossy(&class[..size as usize]) != "Chrome_WidgetWin_1" {
            return BOOL(1);
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == GetCurrentProcessId() {
            return BOOL(1);
        }
        if let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut path = vec![0u16; 32768];
            let mut length = path.len() as u32;
            let ok = QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(path.as_mut_ptr()),
                &mut length,
            );
            let _ = CloseHandle(process);
            if ok.is_ok()
                && Path::new(&String::from_utf16_lossy(&path[..length as usize]))
                    .file_name()
                    .is_some_and(|s| s.eq_ignore_ascii_case("Brevia.exe"))
            {
                let _ = ShowWindow(hwnd, SW_RESTORE);
                let _ = SetForegroundWindow(hwnd);
                *(result.0 as *mut bool) = true;
                return BOOL(0);
            }
        }
        BOOL(1)
    }
    unsafe {
        if legacy_only {
            let mut found = false;
            let _ = EnumWindows(Some(legacy), LPARAM((&mut found as *mut bool) as isize));
            return found;
        }
        let class = listener_name();
        for _ in 0..20 {
            if let Ok(window) = FindWindowW(PCWSTR(class.as_ptr()), None) {
                let _ = PostMessageW(Some(window), WM_APP + 1, WPARAM(0), LPARAM(0));
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    false
}

pub fn watch_system(app: &AppHandle, _sleep: extern "C" fn()) -> Result<(), Box<dyn Error>> {
    unsafe extern "system" fn receive(hwnd: HWND, message: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        if let Some(app) = crate::APP.get() {
            if message == WM_POWERBROADCAST && w.0 == PBT_APMSUSPEND as usize {
                crate::control::notify(app, json!({"host":"app.suspend"}));
            }
            if message == WM_APP + 1 {
                crate::control::notify(app, json!({"host":"app.activate"}));
                return LRESULT(0);
            }
        }
        DefWindowProcW(hwnd, message, w, l)
    }
    let _ = app;
    let class = listener_name();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || unsafe {
        let result = (|| -> windows::core::Result<()> {
            let instance = GetModuleHandleW(None)?;
            let wc = WNDCLASSW {
                lpfnWndProc: Some(receive),
                hInstance: instance.into(),
                lpszClassName: PCWSTR(class.as_ptr()),
                ..Default::default()
            };
            if RegisterClassW(&wc) == 0 {
                return Err(windows::core::Error::from_thread());
            }
            // 隐藏顶层窗口接收系统广播；message-only 窗口不会收到睡眠通知。
            let window = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                PCWSTR(class.as_ptr()),
                w!("Brevia native lifecycle"),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                None,
                None,
                Some(instance.into()),
                None,
            )?;
            let _ = tx.send(Ok(()));
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = DestroyWindow(window);
            Ok(())
        })();
        if let Err(error) = result {
            let _ = tx.send(Err(error.to_string()));
        }
    });
    rx.recv_timeout(Duration::from_secs(5))??;
    Ok(())
}

pub fn watch_webview(window: &WebviewWindow) -> Result<(), Box<dyn Error>> {
    let app = window.app_handle().clone();
    let label = window.label().to_owned();
    window.with_webview(move |platform| unsafe {
        if let Ok(view) = platform.controller().CoreWebView2() {
            let mut token = 0;
            let _ = view.add_ProcessFailed(
                &ProcessFailedEventHandler::create(Box::new(move |view, _| {
                    crate::control::notify(&app, json!({"host":"window.crashed", "label":label}));
                    if let Some(view) = view {
                        let _ = view.Reload();
                    }
                    Ok(())
                })),
                &mut token,
            );
        }
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closing_the_job_terminates_its_control_process() {
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        let mut child = Command::new("cmd.exe")
            .args(["/D", "/Q"])
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let job = ProcessJob::new(&child).unwrap();
        assert!(child.try_wait().unwrap().is_none());
        drop(job);
        for _ in 0..100 {
            if child.try_wait().unwrap().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let _ = child.kill();
        let _ = child.wait();
        panic!("Job close left the background process running");
    }
}
