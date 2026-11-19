//! Offline/USB: quét thư mục packages/ cạnh exe, ưu tiên cài từ đó.
use crate::catalog::App;
use std::path::{Path, PathBuf};

pub fn default_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("packages")))
        .unwrap_or_else(|| PathBuf::from("packages"))
}

fn collect(dir: &Path, depth: u8, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                collect(&p, depth - 1, out);
            }
        } else if p
            .extension()
            .is_some_and(|x| x.eq_ignore_ascii_case("exe") || x.eq_ignore_ascii_case("msi"))
        {
            out.push(p);
        }
    }
}

pub fn scan(dir: &Path) -> Vec<PathBuf> {
    let mut v = Vec::new();
    collect(dir, 2, &mut v);
    v.sort();
    v
}

/// Khớp file với app: tên bắt đầu bằng id/winget-id, hoặc trùng tên file trong download_url.
pub fn find_package<'a>(files: &'a [PathBuf], app: &App) -> Option<&'a PathBuf> {
    let id = app.id.to_lowercase();
    let wid = app.winget.as_ref().map(|w| w.id.to_lowercase());
    let url_name = app
        .direct
        .as_ref()
        .and_then(|d| d.url.rsplit('/').next().map(str::to_lowercase));
    files.iter().find(|f| {
        let name = f.file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        let stem = f.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        stem.starts_with(&id)
            || wid.as_ref().is_some_and(|w| stem.starts_with(w))
            || url_name.as_ref().is_some_and(|u| &name == u)
    })
}

/// Danh sách id app có sẵn gói offline.
pub fn available_ids(files: &[PathBuf], apps: &[App]) -> Vec<String> {
    apps.iter().filter(|a| find_package(files, a).is_some()).map(|a| a.id.clone()).collect()
}

/// Tham số silent: ưu tiên của direct, mặc định /S cho exe.
pub fn silent_args(app: &App, path: &Path) -> Vec<String> {
    if let Some(d) = &app.direct {
        if !d.silent_args.is_empty() {
            return d.silent_args.clone();
        }
    }
    if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
        vec!["/S".into()]
    } else {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::parse_catalog;

    #[test]
    fn match_files() {
        let apps = parse_catalog(include_str!("../../../catalog/apps.json")).unwrap().apps;
        let files = vec![
            PathBuf::from("D:/packages/WinRAR-x64-701.exe"),
            PathBuf::from("D:/packages/VNeGP-Client-Agent-2.0.1.exe"),
            PathBuf::from("D:/packages/random.exe"),
        ];
        let by = |id: &str| apps.iter().find(|a| a.id == id).unwrap();
        assert!(find_package(&files, by("winrar")).is_some());
        assert!(find_package(&files, by("vnegp-agent")).is_some());
        assert!(find_package(&files, by("coccoc")).is_none());
        assert_eq!(available_ids(&files, &apps).len(), 2);
    }

    #[test]
    fn scan_missing_dir_is_empty() {
        assert!(scan(Path::new("Z:/khong/ton/tai")).is_empty());
    }
}
