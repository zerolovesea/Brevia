use rusty_leveldb::{in_memory, DB};
use serde_json::{Map, Value};
use std::error::Error;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

const KEYS: &[&str] = &[
    "brevia-theme",
    "brevia-language",
    "brevia-preferred-refined-model",
    "brevia-onboarding-complete",
    "brevia-update-policy",
    "brevia-china-model-source",
    "brevia-active-workspace",
];
const SNAPSHOT_LIMIT: u64 = 64 * 1024 * 1024;

pub fn profile() -> Option<PathBuf> {
    std::env::var_os("BREVIA_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(|h| PathBuf::from(h).join("Library/Application Support/Brevia"))
        })
}

fn snapshot(dir: &Path) -> Result<Map<String, Value>, Box<dyn Error>> {
    let mut options = in_memory();
    options.create_if_missing = false;
    options.paranoid_checks = true;
    let memory = Path::new("brevia-preferences");
    let mut remaining = SNAPSHOT_LIMIT;
    // LevelDB 恢复 WAL 时会写入：只有内存副本能被库修改。
    for entry in fs::read_dir(dir)? {
        let file = entry?;
        let name = file.file_name();
        let name = name.to_str().ok_or("Invalid database file name")?;
        if !(name == "CURRENT"
            || name.starts_with("MANIFEST-")
            || name.ends_with(".log")
            || name.ends_with(".ldb")
            || name.ends_with(".sst"))
        {
            continue;
        }
        if !file.file_type()?.is_file() {
            return Err("Invalid database file".into());
        }
        let mut output = options.env.open_writable_file(&memory.join(name))?;
        let bytes = io::copy(
            &mut File::open(file.path())?.take(remaining + 1),
            &mut output,
        )?;
        remaining = remaining
            .checked_sub(bytes)
            .ok_or("Legacy profile exceeds snapshot limit")?;
    }
    let mut db = DB::open(memory, options)?;
    let mut values = Map::new();
    for key in KEYS {
        let mut encoded = b"_file://\0\x01".to_vec();
        encoded.extend_from_slice(key.as_bytes());
        if let Some(value) = db.get(&encoded).filter(|v| v.len() <= 32 * 1024) {
            let text = match value.split_first() {
                Some((1, s)) => Some(s.iter().map(|&c| char::from(c)).collect()),
                Some((0, s)) if s.len() % 2 == 0 => String::from_utf16(
                    &s.chunks_exact(2)
                        .map(|c| u16::from_le_bytes([c[0], c[1]]))
                        .collect::<Vec<_>>(),
                )
                .ok(),
                _ => None,
            };
            if let Some(text) = text {
                values.insert((*key).into(), Value::String(text));
            }
        }
    }
    Ok(values)
}

pub fn initialization() -> Option<String> {
    let profile = profile()?;
    if profile.join("webkit-preferences-imported").exists() {
        return None;
    }
    let path = profile.join("Local Storage/leveldb");
    if !path.is_dir() {
        return None;
    }
    // 旧缓存损坏不应阻碍访问 SQLite 会议。
    let values = std::panic::catch_unwind(|| snapshot(&path)).ok()?.ok()?;
    let json = serde_json::to_string(&values).ok()?;
    Some(format!(
        r#"(() => {{ try {{
        const flag = 'brevia-webkit-settings-imported';
        if (!localStorage.getItem(flag)) {{
            for (const [key, value] of Object.entries({json})) {{
                if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
            }}
            localStorage.setItem(flag, '1');
        }}
        window.__TAURI__.core.invoke('confirm_preferences').catch(() => {{}});
    }} catch {{}} }})();"#
    ))
}

#[tauri::command]
pub fn confirm_preferences(window: tauri::WebviewWindow) {
    if window.label() == "main" {
        if let Some(path) = profile() {
            let _ = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(path.join("webkit-preferences-imported"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn imports_only_allowed_file_origin_preferences_without_touching_source() {
        let dir = tempfile::tempdir().unwrap();
        let opts = in_memory();
        let path = Path::new("fixture");
        {
            let mut db = DB::open(path, opts.clone()).unwrap();
            db.put(b"_file://\0\x01brevia-theme", b"\x01dark").unwrap();
            db.put(b"_file://\0\x01brevia-language", b"\x00e\0n\0")
                .unwrap();
            db.put(b"_file://\0\x01brevia-summary-config", b"\x01test-only")
                .unwrap();
            db.put(
                b"_https://other.test\0\x01brevia-update-policy",
                b"\x01other",
            )
            .unwrap();
            db.flush().unwrap();
        }
        for file in opts.env.children(path).unwrap() {
            let mut source = opts.env.open_sequential_file(&path.join(&file)).unwrap();
            let mut dest = File::create(dir.path().join(file)).unwrap();
            io::copy(&mut source, &mut dest).unwrap();
            dest.flush().unwrap();
        }
        let original = fs::read(dir.path().join("CURRENT")).unwrap();
        let values = snapshot(dir.path()).unwrap();
        assert_eq!(values.len(), 2);
        assert_eq!(values["brevia-theme"], "dark");
        assert_eq!(values["brevia-language"], "en");
        assert_eq!(fs::read(dir.path().join("CURRENT")).unwrap(), original);
    }
}
