//! Module 2: Dọn rác hệ thống tùy chọn theo 3 mức an toàn (Xanh / Vàng / Đỏ).
//! An toàn tuyệt đối: bỏ qua file đang bị khóa (skipped_locked), không bao giờ panic,
//! hỗ trợ hủy ngay lập tức qua AtomicBool, và luôn khởi động lại wuauserv khi dọn Windows Update Cache.

use crate::{emit_tool_progress, util};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanerScanResult {
    pub id: String,
    pub files_count: u64,
    pub size_bytes: u64,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanerItemOutcome {
    pub id: String,
    pub name: String,
    pub freed_bytes: u64,
    pub deleted_files: u64,
    pub skipped_locked: u64,
    /// "ok" | "partial" | "skipped" | "error" | "cancelled"
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanerRunResult {
    pub cancelled: bool,
    pub total_freed_bytes: u64,
    pub total_deleted_files: u64,
    pub total_skipped_locked: u64,
    pub outcomes: Vec<CleanerItemOutcome>,
}

pub const ALL_TARGET_IDS: &[&str] = &[
    "user_temp",
    "win_temp",
    "recycle_bin",
    "thumb_shader_cache",
    "win_update_cache",
    "prefetch",
    "browser_cache",
    "dism_component_cleanup",
    "old_system_logs",
    "old_memory_dumps",
];

fn canonical_id(id: &str) -> &str {
    match id {
        "windows_temp" => "win_temp",
        "windows_update_cache" => "win_update_cache",
        "memory_dumps" => "old_memory_dumps",
        other => other,
    }
}

fn target_display_name(id: &str) -> &'static str {
    match canonical_id(id) {
        "user_temp" => "Thư mục tạm người dùng (%TEMP%)",
        "win_temp" => "Thư mục tạm Windows (C:\\Windows\\Temp)",
        "recycle_bin" => "Thùng rác (Recycle Bin)",
        "thumb_shader_cache" => "Thumbnail & Shader Cache",
        "win_update_cache" => "Windows Update Download Cache",
        "prefetch" => "Windows Prefetch",
        "browser_cache" => "Cache trình duyệt (Chrome / Edge / Cốc Cốc)",
        "dism_component_cleanup" => "DISM StartComponentCleanup (WinSxS)",
        "old_system_logs" => "Log hệ thống cũ (> 14 ngày)",
        "old_memory_dumps" => "Memory Dump BSOD cũ",
        _ => "Mục không xác định",
    }
}

fn local_app_data() -> Option<PathBuf> {
    std::env::var("LOCALAPPDATA").ok().filter(|s| !s.is_empty()).map(PathBuf::from)
}

/// Lấy danh sách thư mục `Cache\Cache_Data` và `Code Cache` của Chrome, Edge, Cốc Cốc.
/// TUYỆT ĐỐI KHÔNG chạm vào Cookies, Login Data, History, Bookmarks.
fn browser_cache_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Some(local) = local_app_data() else {
        return dirs;
    };
    let roots = [
        local.join("Google").join("Chrome").join("User Data"),
        local.join("Microsoft").join("Edge").join("User Data"),
        local.join("CocCoc").join("Browser").join("User Data"),
    ];
    for root in roots {
        let Ok(rd) = fs::read_dir(&root) else { continue };
        for entry in rd.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            if !ft.is_dir() || ft.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let is_profile = name.eq_ignore_ascii_case("Default")
                || name.to_lowercase().starts_with("profile ")
                || name.eq_ignore_ascii_case("Guest Profile");
            if !is_profile {
                continue;
            }
            let prof_path = entry.path();
            let cache_data = prof_path.join("Cache").join("Cache_Data");
            if cache_data.is_dir() {
                dirs.push(cache_data);
            }
            let code_cache = prof_path.join("Code Cache");
            if code_cache.is_dir() {
                dirs.push(code_cache);
            }
        }
    }
    dirs
}

/// Đệ quy đếm file & dung lượng theo bộ lọc `predicate`, bỏ qua symlink và tôn trọng `cancel`.
fn scan_dir_with_filter<F>(
    dir: &Path,
    cancel: &Arc<AtomicBool>,
    predicate: &F,
    files: &mut u64,
    bytes: &mut u64,
) where
    F: Fn(&Path, &fs::Metadata) -> bool,
{
    if cancel.load(Ordering::SeqCst) {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        if ft.is_dir() {
            scan_dir_with_filter(&path, cancel, predicate, files, bytes);
        } else if ft.is_file() {
            if let Ok(meta) = entry.metadata() {
                if predicate(&path, &meta) {
                    *files = files.saturating_add(1);
                    *bytes = bytes.saturating_add(meta.len());
                }
            }
        }
    }
}

/// Đệ quy xóa file trong thư mục theo bộ lọc `predicate`.
/// File bị khóa sẽ tăng `skipped_locked` và bỏ qua an toàn, không bao giờ panic.
fn clean_dir_with_filter<F>(
    dir: &Path,
    remove_empty_subdirs: bool,
    cancel: &Arc<AtomicBool>,
    predicate: &F,
    freed: &mut u64,
    deleted: &mut u64,
    skipped_locked: &mut u64,
) where
    F: Fn(&Path, &fs::Metadata) -> bool,
{
    if cancel.load(Ordering::SeqCst) {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        if cancel.load(Ordering::SeqCst) {
            return;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        if ft.is_dir() {
            clean_dir_with_filter(
                &path,
                remove_empty_subdirs,
                cancel,
                predicate,
                freed,
                deleted,
                skipped_locked,
            );
            if remove_empty_subdirs && !cancel.load(Ordering::SeqCst) {
                let _ = fs::remove_dir(&path);
            }
        } else if ft.is_file() {
            let Ok(meta) = entry.metadata() else {
                *skipped_locked = skipped_locked.saturating_add(1);
                continue;
            };
            if !predicate(&path, &meta) {
                continue;
            }
            let len = meta.len();
            match fs::remove_file(&path) {
                Ok(_) => {
                    *deleted = deleted.saturating_add(1);
                    *freed = freed.saturating_add(len);
                }
                Err(_) => {
                    *skipped_locked = skipped_locked.saturating_add(1);
                }
            }
        }
    }
}

fn is_older_than_days(meta: &fs::Metadata, days: u64) -> bool {
    let Ok(modified) = meta.modified() else { return false };
    let Ok(elapsed) = SystemTime::now().duration_since(modified) else { return false };
    elapsed >= Duration::from_secs(days * 24 * 60 * 60)
}

fn is_old_log_file(path: &Path, meta: &fs::Metadata) -> bool {
    let ext_ok = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("log") || e.eq_ignore_ascii_case("etl"));
    ext_ok && is_older_than_days(meta, 14)
}

fn is_thumbcache_file(path: &Path, _meta: &fs::Metadata) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| {
            let low = n.to_lowercase();
            low.starts_with("thumbcache_") && low.ends_with(".db")
        })
}

fn is_dmp_file(path: &Path, _meta: &fs::Metadata) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("dmp"))
}

fn scan_recycle_bin(cancel: &Arc<AtomicBool>) -> (u64, u64, Option<String>) {
    if cancel.load(Ordering::SeqCst) {
        return (0, 0, None);
    }
    let script = r#"
$totalSize = [uint64]0
$totalCount = [uint64]0
$shell = New-Object -ComObject Shell.Application -ErrorAction SilentlyContinue
if ($shell) {
  $rb = $shell.NameSpace(0xA)
  if ($rb) {
    foreach ($item in $rb.Items()) {
      $totalCount++
      try { $totalSize += [uint64]$item.Size } catch {}
    }
  }
}
"$totalCount|$totalSize"
"#;
    if let Ok((0, out)) = util::run_capture(
        "powershell",
        &[
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-Command".into(),
            script.into(),
        ],
    ) {
        if let Some(line) = out.lines().rev().find(|l| l.contains('|')) {
            let parts: Vec<&str> = line.trim().split('|').collect();
            if parts.len() >= 2 {
                let count = parts[0].trim().parse::<u64>().unwrap_or(0);
                let size = parts[1].trim().parse::<u64>().unwrap_or(0);
                return (count, size, None);
            }
        }
    }
    // Fallback quét trực tiếp C:\$Recycle.Bin
    let mut files = 0u64;
    let mut bytes = 0u64;
    scan_dir_with_filter(Path::new(r"C:\$Recycle.Bin"), cancel, &|_, _| true, &mut files, &mut bytes);
    (files, bytes, None)
}

fn scan_one_target(raw_id: &str, cancel: &Arc<AtomicBool>) -> CleanerScanResult {
    let mut files = 0u64;
    let mut bytes = 0u64;
    let mut note: Option<String> = None;

    match canonical_id(raw_id) {
        "user_temp" => {
            let dir = std::env::temp_dir();
            scan_dir_with_filter(&dir, cancel, &|_, _| true, &mut files, &mut bytes);
        }
        "win_temp" => {
            scan_dir_with_filter(Path::new(r"C:\Windows\Temp"), cancel, &|_, _| true, &mut files, &mut bytes);
        }
        "recycle_bin" => {
            let (f, b, n) = scan_recycle_bin(cancel);
            files = f;
            bytes = b;
            note = n;
        }
        "thumb_shader_cache" => {
            if let Some(local) = local_app_data() {
                let explorer = local.join("Microsoft").join("Windows").join("Explorer");
                scan_dir_with_filter(&explorer, cancel, &is_thumbcache_file, &mut files, &mut bytes);
                let d3d = local.join("D3DSCache");
                scan_dir_with_filter(&d3d, cancel, &|_, _| true, &mut files, &mut bytes);
                let nv = local.join("NVIDIA").join("DXCache");
                scan_dir_with_filter(&nv, cancel, &|_, _| true, &mut files, &mut bytes);
            }
        }
        "win_update_cache" => {
            scan_dir_with_filter(
                Path::new(r"C:\Windows\SoftwareDistribution\Download"),
                cancel,
                &|_, _| true,
                &mut files,
                &mut bytes,
            );
            note = Some("Tự động tạm dừng & bật lại dịch vụ wuauserv khi dọn".into());
        }
        "prefetch" => {
            let dir = Path::new(r"C:\Windows\Prefetch");
            if fs::read_dir(dir).is_err() {
                note = Some("Cần quyền Administrator để đọc/dọn Prefetch".into());
            } else {
                scan_dir_with_filter(dir, cancel, &|_, _| true, &mut files, &mut bytes);
            }
        }
        "browser_cache" => {
            for d in browser_cache_dirs() {
                scan_dir_with_filter(&d, cancel, &|_, _| true, &mut files, &mut bytes);
            }
            note = Some("Chỉ quét Cache_Data & Code Cache — giữ nguyên Cookies/Mật khẩu/Lịch sử".into());
        }
        "dism_component_cleanup" => {
            note = Some("Cần chạy DISM (quyền Admin) để phân tích & dọn kho WinSxS".into());
        }
        "old_system_logs" => {
            scan_dir_with_filter(
                Path::new(r"C:\Windows\Logs"),
                cancel,
                &is_old_log_file,
                &mut files,
                &mut bytes,
            );
            note = Some("Chỉ quét tệp .log / .etl cũ hơn 14 ngày".into());
        }
        "old_memory_dumps" => {
            let full_dump = Path::new(r"C:\Windows\MEMORY.DMP");
            if let Ok(meta) = fs::metadata(full_dump) {
                if meta.is_file() {
                    files += 1;
                    bytes = bytes.saturating_add(meta.len());
                }
            }
            scan_dir_with_filter(
                Path::new(r"C:\Windows\Minidump"),
                cancel,
                &is_dmp_file,
                &mut files,
                &mut bytes,
            );
        }
        _ => {
            note = Some("Mục dọn rác không được hỗ trợ".into());
        }
    }

    CleanerScanResult {
        id: raw_id.to_string(),
        files_count: files,
        size_bytes: bytes,
        note,
    }
}

/// Quét ước lượng dung lượng rác cho danh sách `target_ids` (nếu rỗng -> quét toàn bộ 10 mục).
pub fn scan_targets(
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
    target_ids: &[String],
) -> Vec<CleanerScanResult> {
    let targets: Vec<String> = if target_ids.is_empty() {
        ALL_TARGET_IDS.iter().map(|s| (*s).to_string()).collect()
    } else {
        target_ids.to_vec()
    };

    let total = targets.len() as u32;
    let mut results = Vec::with_capacity(targets.len());

    for (idx, id) in targets.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            emit_tool_progress(app, "cleaner", "Đã hủy quét", idx as u32, total, 100, "Đã dừng quét theo yêu cầu.");
            break;
        }
        let step_num = (idx + 1) as u32;
        let pct = if total > 0 { ((step_num - 1) * 100) / total } else { 0 };
        emit_tool_progress(
            app,
            "cleaner",
            "Đang quét rác",
            step_num,
            total,
            pct,
            &format!("Đang quét: {}", target_display_name(id)),
        );
        results.push(scan_one_target(id, cancel));
    }

    if !cancel.load(Ordering::SeqCst) {
        emit_tool_progress(app, "cleaner", "Hoàn tất quét", total, total, 100, "Đã hoàn tất phân tích dung lượng rác.");
    }

    results
}

/// RAII guard đảm bảo dịch vụ `wuauserv` LUÔN được khởi động lại (`net start wuauserv`)
/// sau khi dọn `Windows Update Cache`, kể cả khi có lỗi hoặc người dùng bấm Hủy.
struct WuauservGuard {
    stopped: bool,
}

impl WuauservGuard {
    fn stop() -> Self {
        let ok = util::cmd("net")
            .args(["stop", "wuauserv"])
            .stdin(Stdio::null())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        Self { stopped: ok }
    }
}

impl Drop for WuauservGuard {
    fn drop(&mut self) {
        // Luôn gọi net start wuauserv kể cả khi lệnh stop trước đó báo đã dừng sẵn
        let _ = util::cmd("net")
            .args(["start", "wuauserv"])
            .stdin(Stdio::null())
            .output();
        let _ = self.stopped;
    }
}

fn clean_one_target(raw_id: &str, cancel: &Arc<AtomicBool>) -> CleanerItemOutcome {
    let name = target_display_name(raw_id).to_string();
    let mut freed = 0u64;
    let mut deleted = 0u64;
    let mut skipped_locked = 0u64;

    if cancel.load(Ordering::SeqCst) {
        return CleanerItemOutcome {
            id: raw_id.to_string(),
            name,
            freed_bytes: 0,
            deleted_files: 0,
            skipped_locked: 0,
            status: "cancelled".into(),
            message: "Đã hủy trước khi thực thi.".into(),
        };
    }

    match canonical_id(raw_id) {
        "user_temp" => {
            let dir = std::env::temp_dir();
            clean_dir_with_filter(&dir, true, cancel, &|_, _| true, &mut freed, &mut deleted, &mut skipped_locked);
        }
        "win_temp" => {
            clean_dir_with_filter(
                Path::new(r"C:\Windows\Temp"),
                true,
                cancel,
                &|_, _| true,
                &mut freed,
                &mut deleted,
                &mut skipped_locked,
            );
        }
        "recycle_bin" => {
            let (est_files, est_bytes, _) = scan_recycle_bin(cancel);
            if cancel.load(Ordering::SeqCst) {
                return CleanerItemOutcome {
                    id: raw_id.to_string(),
                    name,
                    freed_bytes: 0,
                    deleted_files: 0,
                    skipped_locked: 0,
                    status: "cancelled".into(),
                    message: "Đã hủy khi chuẩn bị dọn Thùng rác.".into(),
                };
            }
            let res = util::run_capture(
                "powershell",
                &[
                    "-NoProfile".into(),
                    "-NonInteractive".into(),
                    "-ExecutionPolicy".into(),
                    "Bypass".into(),
                    "-Command".into(),
                    "Clear-RecycleBin -Force -ErrorAction SilentlyContinue".into(),
                ],
            );
            return match res {
                Ok((0, _)) => CleanerItemOutcome {
                    id: raw_id.to_string(),
                    name,
                    freed_bytes: est_bytes,
                    deleted_files: est_files,
                    skipped_locked: 0,
                    status: "ok".into(),
                    message: format!("Đã làm trống Thùng rác ({est_files} mục)."),
                },
                Ok((code, err)) => CleanerItemOutcome {
                    id: raw_id.to_string(),
                    name,
                    freed_bytes: 0,
                    deleted_files: 0,
                    skipped_locked: 0,
                    status: "error".into(),
                    message: format!("Clear-RecycleBin trả mã {code}: {}", err.trim()),
                },
                Err(e) => CleanerItemOutcome {
                    id: raw_id.to_string(),
                    name,
                    freed_bytes: 0,
                    deleted_files: 0,
                    skipped_locked: 0,
                    status: "error".into(),
                    message: e,
                },
            };
        }
        "thumb_shader_cache" => {
            if let Some(local) = local_app_data() {
                let explorer = local.join("Microsoft").join("Windows").join("Explorer");
                clean_dir_with_filter(
                    &explorer,
                    false,
                    cancel,
                    &is_thumbcache_file,
                    &mut freed,
                    &mut deleted,
                    &mut skipped_locked,
                );
                let d3d = local.join("D3DSCache");
                clean_dir_with_filter(&d3d, true, cancel, &|_, _| true, &mut freed, &mut deleted, &mut skipped_locked);
                let nv = local.join("NVIDIA").join("DXCache");
                clean_dir_with_filter(&nv, true, cancel, &|_, _| true, &mut freed, &mut deleted, &mut skipped_locked);
            }
        }
        "win_update_cache" => {
            let _guard = WuauservGuard::stop();
            clean_dir_with_filter(
                Path::new(r"C:\Windows\SoftwareDistribution\Download"),
                true,
                cancel,
                &|_, _| true,
                &mut freed,
                &mut deleted,
                &mut skipped_locked,
            );
            // _guard tự động chạy `net start wuauserv` ngay khi ra khỏi scope này!
        }
        "prefetch" => {
            clean_dir_with_filter(
                Path::new(r"C:\Windows\Prefetch"),
                false,
                cancel,
                &|_, _| true,
                &mut freed,
                &mut deleted,
                &mut skipped_locked,
            );
        }
        "browser_cache" => {
            for d in browser_cache_dirs() {
                if cancel.load(Ordering::SeqCst) {
                    break;
                }
                clean_dir_with_filter(&d, true, cancel, &|_, _| true, &mut freed, &mut deleted, &mut skipped_locked);
            }
        }
        "dism_component_cleanup" => {
            let res = util::run_capture(
                "Dism.exe",
                &[
                    "/online".into(),
                    "/Cleanup-Image".into(),
                    "/StartComponentCleanup".into(),
                ],
            );
            return match res {
                Ok((0, _)) => CleanerItemOutcome {
                    id: raw_id.to_string(),
                    name,
                    freed_bytes: 0,
                    deleted_files: 0,
                    skipped_locked: 0,
                    status: "ok".into(),
                    message: "Đã chạy DISM /StartComponentCleanup thu gọn WinSxS thành công.".into(),
                },
                Ok((code, out)) => CleanerItemOutcome {
                    id: raw_id.to_string(),
                    name,
                    freed_bytes: 0,
                    deleted_files: 0,
                    skipped_locked: 0,
                    status: "error".into(),
                    message: format!("DISM trả mã lỗi {code} (cần quyền Admin). {}", out.lines().last().unwrap_or("").trim()),
                },
                Err(e) => CleanerItemOutcome {
                    id: raw_id.to_string(),
                    name,
                    freed_bytes: 0,
                    deleted_files: 0,
                    skipped_locked: 0,
                    status: "error".into(),
                    message: e,
                },
            };
        }
        "old_system_logs" => {
            clean_dir_with_filter(
                Path::new(r"C:\Windows\Logs"),
                false,
                cancel,
                &is_old_log_file,
                &mut freed,
                &mut deleted,
                &mut skipped_locked,
            );
        }
        "old_memory_dumps" => {
            let full_dump = Path::new(r"C:\Windows\MEMORY.DMP");
            if let Ok(meta) = fs::metadata(full_dump) {
                if meta.is_file() {
                    let len = meta.len();
                    match fs::remove_file(full_dump) {
                        Ok(_) => {
                            deleted += 1;
                            freed = freed.saturating_add(len);
                        }
                        Err(_) => {
                            skipped_locked += 1;
                        }
                    }
                }
            }
            clean_dir_with_filter(
                Path::new(r"C:\Windows\Minidump"),
                false,
                cancel,
                &is_dmp_file,
                &mut freed,
                &mut deleted,
                &mut skipped_locked,
            );
        }
        _ => {
            return CleanerItemOutcome {
                id: raw_id.to_string(),
                name,
                freed_bytes: 0,
                deleted_files: 0,
                skipped_locked: 0,
                status: "skipped".into(),
                message: "Mục dọn rác không tồn tại.".into(),
            };
        }
    }

    let was_cancelled = cancel.load(Ordering::SeqCst);
    let (status, message) = if was_cancelled {
        (
            "cancelled".to_string(),
            format!("Đã dừng giữa chừng (đã xóa {deleted} tệp, bỏ qua {skipped_locked} tệp đang khóa)."),
        )
    } else if skipped_locked > 0 && deleted > 0 {
        (
            "partial".to_string(),
            format!("Đã xóa {deleted} tệp, bỏ qua an toàn {skipped_locked} tệp đang được sử dụng."),
        )
    } else if skipped_locked > 0 && deleted == 0 {
        (
            "skipped".to_string(),
            format!("Bỏ qua {skipped_locked} tệp đang bị khóa hoặc cần quyền Administrator."),
        )
    } else {
        (
            "ok".to_string(),
            format!("Đã dọn sạch {deleted} tệp."),
        )
    };

    CleanerItemOutcome {
        id: raw_id.to_string(),
        name,
        freed_bytes: freed,
        deleted_files: deleted,
        skipped_locked,
        status,
        message,
    }
}

/// Thực thi dọn rác cho danh sách `target_ids` đã chọn.
pub fn run_clean(
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
    target_ids: &[String],
) -> CleanerRunResult {
    let total = target_ids.len() as u32;
    let mut outcomes = Vec::with_capacity(target_ids.len());
    let mut total_freed = 0u64;
    let mut total_deleted = 0u64;
    let mut total_skipped = 0u64;
    let mut cancelled = false;

    for (idx, id) in target_ids.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            break;
        }
        let step_num = (idx + 1) as u32;
        let pct = if total > 0 { ((step_num - 1) * 100) / total } else { 0 };
        emit_tool_progress(
            app,
            "cleaner",
            "Đang dọn rác",
            step_num,
            total,
            pct,
            &format!("Đang dọn: {}", target_display_name(id)),
        );

        let outcome = clean_one_target(id, cancel);
        total_freed = total_freed.saturating_add(outcome.freed_bytes);
        total_deleted = total_deleted.saturating_add(outcome.deleted_files);
        total_skipped = total_skipped.saturating_add(outcome.skipped_locked);
        if outcome.status == "cancelled" {
            cancelled = true;
        }
        outcomes.push(outcome);
        if cancelled {
            break;
        }
    }

    emit_tool_progress(
        app,
        "cleaner",
        if cancelled { "Đã hủy" } else { "Hoàn tất" },
        total,
        total,
        100,
        if cancelled {
            "Quá trình dọn rác đã dừng theo yêu cầu."
        } else {
            "Đã hoàn tất dọn rác hệ thống."
        },
    );

    CleanerRunResult {
        cancelled,
        total_freed_bytes: total_freed,
        total_deleted_files: total_deleted,
        total_skipped_locked: total_skipped,
        outcomes,
    }
}
