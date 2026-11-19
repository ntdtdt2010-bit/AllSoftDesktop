//! Module 3: Clean Uninstaller (kiểu Your Uninstaller 7.5).
//! Chạy trình gỡ gốc -> Quét tàn dư file/thư mục & Registry -> Tự động backup `.reg` trước khi xóa.
//! Tích hợp Blacklist bảo vệ tuyệt đối các thư mục/khóa hệ thống Windows.

use crate::{emit_tool_progress, util};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use winreg::enums::*;
use winreg::{HKEY, RegKey};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeftoverItem {
    pub id: String,
    /// "folder" | "file" | "registry"
    pub kind: String,
    pub path: String,
    pub size_bytes: u64,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeftoverCleanResult {
    pub backup_reg_path: Option<String>,
    pub removed_count: u32,
    pub freed_bytes: u64,
    pub skipped_count: u32,
    pub errors: Vec<String>,
}

/// Danh sách tên đoạn đường dẫn / khóa Registry CẤM TUYỆT ĐỐI quét hoặc xóa.
const BLACKLISTED_SEGMENTS: &[&str] = &[
    "windows",
    "system32",
    "syswow64",
    "microsoft",
    "common files",
    "drivers",
    "windowsapps",
    "boot",
    "recovery",
    "winsxs",
    "program files",
    "program files (x86)",
    "programdata",
    "appdata",
    "users",
    "policies",
    "classes",
    "currentversion",
    "wow6432node",
    "controlset",
    "hardware",
    "sam",
    "security",
    "system",
];

fn is_blacklisted_segment(seg: &str) -> bool {
    let low = seg.trim().to_lowercase();
    BLACKLISTED_SEGMENTS.iter().any(|&b| b == low)
}

/// Kiểm tra đường dẫn file/thư mục có nằm trong Blacklist bảo vệ hoặc quá nông (nguy hiểm) không.
/// Trả về `true` nếu BỊ CẤM (tuyệt đối không được xóa).
pub fn is_blacklisted_path(path: &str) -> bool {
    let norm = path.trim().trim_matches('"').replace('/', "\\");
    let norm = norm.trim_end_matches('\\');
    if norm.len() < 4 {
        return true;
    }

    let bytes = norm.as_bytes();
    if !(bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\') {
        return true;
    }

    let rest = &norm[3..];
    let parts: Vec<String> = rest
        .split('\\')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect();

    // Không bao giờ xóa gốc ổ (0) hoặc thư mục cấp 1 (1) như C:\Windows, C:\Users, C:\Program Files
    if parts.len() < 2 {
        return true;
    }

    // Chặn tuyệt đối các vùng hệ điều hành nhạy cảm
    let first = parts[0].as_str();
    if matches!(first, "windows" | "boot" | "recovery" | "$recycle.bin" | "system volume information") {
        return true;
    }

    // Chặn nếu bất kỳ đoạn nào là vùng hệ thống trọng yếu
    for p in &parts {
        if matches!(
            p.as_str(),
            "windows" | "system32" | "syswow64" | "winsxs" | "drivers" | "windowsapps" | "common files" | "boot" | "recovery"
        ) {
            return true;
        }
    }

    // Kiểm tra độ sâu tối thiểu theo từng thư mục gốc
    if first == "users" {
        // Phải tối thiểu: Users\<user>\AppData\Local\<app> (5 đoạn) hoặc Users\<user>\<dir>\<app> (4 đoạn)
        if parts.len() < 4 {
            return true;
        }
        if parts.get(2).map(|s| s.as_str()) == Some("appdata") {
            if parts.len() < 5 {
                return true;
            }
            // Không xóa thư mục Microsoft / Windows bên trong AppData\Local|Roaming
            if let Some(app_seg) = parts.get(4) {
                if is_blacklisted_segment(app_seg) {
                    return true;
                }
            }
        }
    } else if matches!(first, "program files" | "program files (x86)" | "programdata") {
        // Phải tối thiểu: Program Files\<app> (2 đoạn) và <app> không thuộc blacklist
        if parts.len() < 2 {
            return true;
        }
        if let Some(app_seg) = parts.get(1) {
            if is_blacklisted_segment(app_seg) {
                return true;
            }
        }
    }

    // Tên thư mục/tệp cuối cùng tuyệt đối không được trùng blacklist
    if let Some(last) = parts.last() {
        if is_blacklisted_segment(last) {
            return true;
        }
    }

    false
}

/// Kiểm tra đường dẫn khóa Registry có nằm trong Blacklist bảo vệ hay không.
/// Trả về `true` nếu BỊ CẤM (tuyệt đối không được xóa).
pub fn is_blacklisted_reg(reg_path: &str) -> bool {
    let norm = reg_path.trim().replace('/', "\\");
    let norm = norm.trim_end_matches('\\');
    let Some((hive, sub)) = norm.split_once('\\') else {
        return true;
    };

    let hive_up = hive.to_uppercase();
    if !matches!(
        hive_up.as_str(),
        "HKCU" | "HKEY_CURRENT_USER" | "HKLM" | "HKEY_LOCAL_MACHINE"
    ) {
        return true;
    }

    let parts: Vec<String> = sub
        .split('\\')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect();

    // Chỉ cho phép xóa khóa con nằm sâu bên trong SOFTWARE
    if parts.is_empty() || parts[0] != "software" {
        return true;
    }

    let target_idx = if parts.get(1).map(|s| s.as_str()) == Some("wow6432node") {
        // HKLM\SOFTWARE\WOW6432Node\<App> => tối thiểu 3 đoạn
        if parts.len() < 3 {
            return true;
        }
        2
    } else {
        // HKLM\SOFTWARE\<App> hoặc HKCU\Software\<App> => tối thiểu 2 đoạn
        if parts.len() < 2 {
            return true;
        }
        1
    };

    // Khóa ngay dưới SOFTWARE (hoặc WOW6432Node) tuyệt đối không được nằm trong Blacklist
    if is_blacklisted_segment(&parts[target_idx]) {
        return true;
    }

    // Khóa cuối cùng cũng không được nằm trong Blacklist
    if let Some(last) = parts.last() {
        if is_blacklisted_segment(last) {
            return true;
        }
    }

    // Không chứa các nhánh nhạy cảm ở bất kỳ đâu
    for p in &parts[target_idx..] {
        if matches!(
            p.as_str(),
            "microsoft" | "windows" | "policies" | "classes" | "currentversion" | "controlset" | "hardware" | "sam" | "security" | "system"
        ) {
            return true;
        }
    }

    false
}

/// 1. Chạy trình gỡ cài đặt gốc của phần mềm bằng `cmd /C` (hoặc chuẩn hóa `msiexec /x`) và chờ hoàn tất.
pub fn run_native_uninstaller(uninstall_cmd: String) -> Result<String, String> {
    let raw = uninstall_cmd.trim().to_string();
    if raw.is_empty() {
        return Err("Lệnh gỡ cài đặt trống.".into());
    }

    let cmdline = if raw.to_lowercase().contains("msiexec") {
        if let Some(start) = raw.find('{') {
            if let Some(rel_end) = raw[start..].find('}') {
                let end = start + rel_end;
                format!("msiexec /x {}", &raw[start..=end])
            } else {
                raw
            }
        } else {
            raw
        }
    } else {
        raw
    };

    let out = util::cmd("cmd")
        .arg("/C")
        .raw_arg(format!("\"{cmdline}\""))
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Không thể khởi chạy trình gỡ cài đặt: {e}"))?;

    let code = out.status.code().unwrap_or(-1);
    match code {
        0 => Ok("Trình gỡ cài đặt gốc đã hoàn tất (mã 0).".into()),
        3010 | 1641 => Ok(format!("Trình gỡ cài đặt gốc đã hoàn tất, khuyến nghị khởi động lại máy (mã {code}).")),
        1602 => Err("Người dùng đã hủy quá trình gỡ cài đặt (mã 1602).".into()),
        _ => Err(format!("Trình gỡ cài đặt kết thúc với mã {code}.")),
    }
}

/// Tạo từ khóa khớp an toàn từ tên phần mềm (loại bỏ số phiên bản, ký tự đặc biệt, từ quá ngắn/blacklist).
fn extract_match_tokens(app_name: &str) -> Vec<String> {
    let cleaned = app_name.trim().to_lowercase();
    let mut tokens = Vec::new();
    if cleaned.len() >= 3 && !is_blacklisted_segment(&cleaned) {
        tokens.push(cleaned.clone());
    }

    // Cắt phần trước số phiên bản hoặc ngoặc đơn: ví dụ "Foxit PDF Reader 2024 (x64)" -> "foxit pdf reader"
    let base: String = cleaned
        .split(['(', '['])
        .next()
        .unwrap_or("")
        .split_whitespace()
        .take_while(|w| {
            !w.chars().next().is_some_and(|c| c.is_ascii_digit())
                && !w.starts_with('v')
                || w.len() > 2 && w.chars().skip(1).any(|c| c.is_ascii_alphabetic())
        })
        .collect::<Vec<&str>>()
        .join(" ");
    let base = base.trim().to_string();
    if base.len() >= 4 && !is_blacklisted_segment(&base) && !tokens.contains(&base) {
        tokens.push(base.clone());
    }

    // Bản không khoảng trắng (ví dụ "UltraViewer", "7-Zip")
    let compact: String = base.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if compact.len() >= 5 && !is_blacklisted_segment(&compact) && !tokens.contains(&compact) {
        tokens.push(compact);
    }

    tokens
}

fn name_matches_tokens(candidate: &str, tokens: &[String]) -> bool {
    let low = candidate.trim().to_lowercase();
    if low.len() < 3 || is_blacklisted_segment(&low) {
        return false;
    }
    let compact_cand: String = low.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    for tok in tokens {
        if low == *tok || low.contains(tok.as_str()) {
            return true;
        }
        if tok.len() >= 5 && compact_cand == *tok {
            return true;
        }
    }
    false
}

fn publisher_matches(candidate: &str, publisher: &str) -> bool {
    let pub_low = publisher.trim().to_lowercase();
    let cand_low = candidate.trim().to_lowercase();
    if pub_low.len() < 3 || cand_low.len() < 3 || is_blacklisted_segment(&cand_low) || is_blacklisted_segment(&pub_low) {
        return false;
    }
    // Bỏ qua các tên hãng quá rộng
    if pub_low.contains("microsoft") || pub_low.contains("windows") {
        return false;
    }
    cand_low == pub_low || pub_low.starts_with(&cand_low) || cand_low.starts_with(&pub_low)
}

fn calc_dir_size(path: &Path, cancel: &Arc<AtomicBool>, depth: u8) -> u64 {
    if depth > 8 || cancel.load(Ordering::SeqCst) {
        return 0;
    }
    let mut total = 0u64;
    let Ok(rd) = fs::read_dir(path) else { return 0 };
    for entry in rd.flatten() {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_file() {
            if let Ok(m) = entry.metadata() {
                total = total.saturating_add(m.len());
            }
        } else if ft.is_dir() {
            total = total.saturating_add(calc_dir_size(&entry.path(), cancel, depth + 1));
        }
    }
    total
}

fn push_leftover(
    items: &mut Vec<LeftoverItem>,
    seen: &mut HashSet<String>,
    next_id: &mut u32,
    kind: &str,
    path: String,
    size_bytes: u64,
    reason: String,
) {
    let key = format!("{}:{}", kind, path.to_lowercase());
    if seen.insert(key) {
        items.push(LeftoverItem {
            id: format!("lo-{}", *next_id),
            kind: kind.to_string(),
            path,
            size_bytes,
            reason,
        });
        *next_id += 1;
    }
}

/// 2. Quét tàn dư (thư mục gốc, Program Files, AppData, ProgramData và Registry HKCU/HKLM).
pub fn scan_leftovers(
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
    app_name: String,
    publisher: String,
    install_location: String,
) -> Result<Vec<LeftoverItem>, String> {
    let tokens = extract_match_tokens(&app_name);
    if tokens.is_empty() && install_location.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut items: Vec<LeftoverItem> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut next_id = 1u32;

    // Bước 1: Kiểm tra thư mục cài đặt gốc (`install_location`)
    emit_tool_progress(app, "uninstaller", "Kiểm tra thư mục cài đặt", 1, 3, 20, "Đang kiểm tra thư mục cài đặt gốc…");
    let loc = install_location.trim().trim_matches('"');
    if !loc.is_empty() && !is_blacklisted_path(loc) {
        let p = Path::new(loc);
        if p.exists() {
            let (kind, size) = if p.is_dir() {
                ("folder", calc_dir_size(p, cancel, 0))
            } else {
                ("file", fs::metadata(p).map(|m| m.len()).unwrap_or(0))
            };
            push_leftover(
                &mut items,
                &mut seen,
                &mut next_id,
                kind,
                loc.to_string(),
                size,
                "Thư mục cài đặt gốc còn sót lại".into(),
            );
        }
    }

    if cancel.load(Ordering::SeqCst) {
        return Ok(items);
    }

    // Bước 2: Quét các thư mục ứng dụng phổ biến
    emit_tool_progress(app, "uninstaller", "Quét tệp tàn dư", 2, 3, 55, "Đang quét Program Files, AppData và ProgramData…");
    let env_roots = [
        ("ProgramFiles", "Tàn dư trong Program Files"),
        ("ProgramFiles(x86)", "Tàn dư trong Program Files (x86)"),
        ("LOCALAPPDATA", "Tàn dư trong AppData\\Local"),
        ("APPDATA", "Tàn dư trong AppData\\Roaming"),
        ("ProgramData", "Tàn dư trong ProgramData"),
    ];

    for (var, reason_label) in env_roots {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let Ok(root_str) = std::env::var(var) else { continue };
        let root_path = PathBuf::from(&root_str);
        let Ok(rd) = fs::read_dir(&root_path) else { continue };

        for entry in rd.flatten() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let Ok(ft) = entry.file_type() else { continue };
            if !ft.is_dir() || ft.is_symlink() {
                continue;
            }
            let dir_name = entry.file_name().to_string_lossy().to_string();
            let full_path = entry.path();
            let full_str = full_path.to_string_lossy().to_string();

            if name_matches_tokens(&dir_name, &tokens) && !is_blacklisted_path(&full_str) {
                let sz = calc_dir_size(&full_path, cancel, 0);
                push_leftover(
                    &mut items,
                    &mut seen,
                    &mut next_id,
                    "folder",
                    full_str,
                    sz,
                    format!("{reason_label} (khớp tên ứng dụng)"),
                );
            } else if publisher_matches(&dir_name, &publisher) {
                // Quét thêm 1 cấp bên trong thư mục nhà phát hành (vd: Foxit Software\Foxit PDF Reader)
                if let Ok(sub_rd) = fs::read_dir(&full_path) {
                    for sub in sub_rd.flatten() {
                        if cancel.load(Ordering::SeqCst) {
                            break;
                        }
                        let Ok(sub_ft) = sub.file_type() else { continue };
                        if !sub_ft.is_dir() || sub_ft.is_symlink() {
                            continue;
                        }
                        let sub_name = sub.file_name().to_string_lossy().to_string();
                        let sub_path = sub.path();
                        let sub_str = sub_path.to_string_lossy().to_string();
                        if name_matches_tokens(&sub_name, &tokens) && !is_blacklisted_path(&sub_str) {
                            let sz = calc_dir_size(&sub_path, cancel, 0);
                            push_leftover(
                                &mut items,
                                &mut seen,
                                &mut next_id,
                                "folder",
                                sub_str,
                                sz,
                                format!("{reason_label} (trong thư mục hãng {dir_name})"),
                            );
                        }
                    }
                }
            }
        }
    }

    if cancel.load(Ordering::SeqCst) {
        return Ok(items);
    }

    // Bước 3: Quét khóa Registry tàn dư trong HKCU\Software, HKLM\SOFTWARE, HKLM\SOFTWARE\WOW6432Node
    emit_tool_progress(app, "uninstaller", "Quét Registry tàn dư", 3, 3, 85, "Đang quét khóa Registry tàn dư…");
    let reg_roots: &[(HKEY, &str, &str)] = &[
        (HKEY_CURRENT_USER, "HKCU", "Software"),
        (HKEY_LOCAL_MACHINE, "HKLM", "SOFTWARE"),
        (HKEY_LOCAL_MACHINE, "HKLM", r"SOFTWARE\WOW6432Node"),
    ];

    for &(hive, hive_prefix, base_sub) in reg_roots {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let Ok(root_key) = RegKey::predef(hive).open_subkey_with_flags(base_sub, KEY_READ) else {
            continue;
        };
        for sub_name in root_key.enum_keys().flatten() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let full_reg = format!("{hive_prefix}\\{base_sub}\\{sub_name}");
            if name_matches_tokens(&sub_name, &tokens) && !is_blacklisted_reg(&full_reg) {
                push_leftover(
                    &mut items,
                    &mut seen,
                    &mut next_id,
                    "registry",
                    full_reg,
                    0,
                    "Khóa Registry khớp tên ứng dụng".into(),
                );
            } else if publisher_matches(&sub_name, &publisher) {
                if let Ok(pub_key) = root_key.open_subkey_with_flags(&sub_name, KEY_READ) {
                    for app_sub in pub_key.enum_keys().flatten() {
                        let nested_reg = format!("{hive_prefix}\\{base_sub}\\{sub_name}\\{app_sub}");
                        if name_matches_tokens(&app_sub, &tokens) && !is_blacklisted_reg(&nested_reg) {
                            push_leftover(
                                &mut items,
                                &mut seen,
                                &mut next_id,
                                "registry",
                                nested_reg,
                                0,
                                format!("Khóa Registry con trong nhánh hãng {sub_name}"),
                            );
                        }
                    }
                }
            }
        }
    }

    emit_tool_progress(
        app,
        "uninstaller",
        "Hoàn tất quét",
        3,
        3,
        100,
        &format!("Tìm thấy {} mục tàn dư an toàn có thể dọn.", items.len()),
    );

    Ok(items)
}

/// Tạo thư mục `Backups` cạnh file `.exe`, fallback `%LOCALAPPDATA%\AllSoftDesktop\Backups` nếu không ghi được.
fn resolve_backup_dir() -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("Backups");
            if fs::create_dir_all(&candidate).is_ok() {
                let probe = candidate.join(".write_test");
                if fs::write(&probe, b"ok").is_ok() {
                    let _ = fs::remove_file(&probe);
                    return Ok(candidate);
                }
            }
        }
    }
    let fallback = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("AllSoftDesktop")
        .join("Backups");
    fs::create_dir_all(&fallback).map_err(|e| format!("Không thể tạo thư mục Backups: {e}"))?;
    Ok(fallback)
}

fn sanitize_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(40)
        .collect();
    let trimmed = s.trim_matches('_');
    if trimmed.is_empty() {
        "app".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Đọc tệp `.reg` (UTF-16LE BOM từ `reg.exe export` hoặc UTF-8) thành `String`.
fn read_reg_file_text(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Không đọc được tệp backup tạm: {e}"))?;
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        Ok(String::from_utf16_lossy(&u16s))
    } else {
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }
}

/// Ghi tệp `.reg` chuẩn Windows (UTF-16LE kèm BOM `FF FE`).
fn write_utf16le_reg(path: &Path, content: &str) -> Result<(), String> {
    let mut out = Vec::with_capacity(2 + content.len() * 2);
    out.push(0xFF);
    out.push(0xFE);
    for unit in content.encode_utf16() {
        out.extend_from_slice(&unit.to_le_bytes());
    }
    fs::write(path, out).map_err(|e| format!("Không ghi được tệp backup Registry: {e}"))
}

fn parse_reg_hive_subkey(reg_path: &str) -> Option<(HKEY, String)> {
    let norm = reg_path.trim().replace('/', "\\");
    let norm = norm.trim_end_matches('\\');
    let (hive_str, sub) = norm.split_once('\\')?;
    let hive = match hive_str.to_uppercase().as_str() {
        "HKCU" | "HKEY_CURRENT_USER" => HKEY_CURRENT_USER,
        "HKLM" | "HKEY_LOCAL_MACHINE" => HKEY_LOCAL_MACHINE,
        _ => return None,
    };
    Some((hive, sub.to_string()))
}

/// 3. Xóa các mục tàn dư đã chọn: TỰ ĐỘNG BACKUP `.reg` trước khi xóa bất kỳ khóa Registry nào
/// và kiểm tra lại Blacklist 1 lần nữa trước khi gọi xóa.
pub fn remove_leftovers(
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
    app_name: String,
    items: Vec<LeftoverItem>,
) -> Result<LeftoverCleanResult, String> {
    let mut backup_reg_path: Option<String> = None;
    let mut backed_up_keys: HashSet<String> = HashSet::new();
    let mut removed_count = 0u32;
    let mut freed_bytes = 0u64;
    let mut skipped_count = 0u32;
    let mut errors: Vec<String> = Vec::new();

    // Bước A: Nếu có bất kỳ item `registry` nào hợp lệ -> Backup ra `.reg` TRƯỚC KHI XÓA!
    let reg_items: Vec<&LeftoverItem> = items
        .iter()
        .filter(|i| i.kind == "registry" && !is_blacklisted_reg(&i.path))
        .collect();

    if !reg_items.is_empty() {
        emit_tool_progress(
            app,
            "uninstaller",
            "Sao lưu Registry",
            1,
            items.len().max(1) as u32,
            10,
            "Đang tự động sao lưu khóa Registry ra tệp .reg…",
        );

        match resolve_backup_dir() {
            Ok(backup_dir) => {
                let ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
                let safe_app = sanitize_filename(&app_name);
                let final_reg_path = backup_dir.join(format!("reg_{safe_app}_{ts}.reg"));
                let mut combined = String::from("Windows Registry Editor Version 5.00\r\n\r\n");

                for (idx, item) in reg_items.iter().enumerate() {
                    let tmp_file = std::env::temp_dir().join(format!("allsoft_reg_bak_{ts}_{idx}.reg"));
                    let tmp_str = tmp_file.to_string_lossy().to_string();

                    let export_ok = util::cmd("reg.exe")
                        .args(["export", &item.path, &tmp_str, "/y"])
                        .stdin(Stdio::null())
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false);

                    if export_ok {
                        match read_reg_file_text(&tmp_file) {
                            Ok(text) => {
                                // Bỏ dòng header đầu tiên "Windows Registry Editor Version 5.00" để gộp sạch
                                let body = text
                                    .trim_start_matches('\u{feff}')
                                    .strip_prefix("Windows Registry Editor Version 5.00")
                                    .unwrap_or(&text)
                                    .trim();
                                if !body.is_empty() {
                                    combined.push_str(body);
                                    combined.push_str("\r\n\r\n");
                                    backed_up_keys.insert(item.path.to_lowercase());
                                }
                            }
                            Err(e) => {
                                errors.push(format!("Không đọc được backup của '{}': {e}", item.path));
                            }
                        }
                    } else {
                        errors.push(format!(
                            "Không thể sao lưu khóa '{}' (bỏ qua xóa để đảm bảo an toàn).",
                            item.path
                        ));
                    }
                    let _ = fs::remove_file(&tmp_file);
                }

                if !backed_up_keys.is_empty() {
                    if let Err(e) = write_utf16le_reg(&final_reg_path, &combined) {
                        // Ghi tệp backup thất bại -> xóa sạch danh sách backed_up_keys để KHÔNG xóa Registry nào!
                        backed_up_keys.clear();
                        errors.push(format!("Ghi tệp backup .reg thất bại ({e}), đã hủy xóa Registry để bảo vệ hệ thống."));
                    } else {
                        backup_reg_path = Some(final_reg_path.to_string_lossy().to_string());
                    }
                }
            }
            Err(e) => {
                errors.push(format!("{e} — đã hủy xóa các khóa Registry để đảm bảo an toàn."));
            }
        }
    }

    // Bước B: Xóa từng mục sau khi kiểm tra lại Blacklist lần cuối
    let total = items.len() as u32;
    for (idx, item) in items.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            errors.push("Quá trình xóa tàn dư đã bị dừng theo yêu cầu.".into());
            break;
        }
        let step_num = (idx + 1) as u32;
        let pct = if total > 0 { 15 + ((step_num * 80) / total) } else { 95 };
        emit_tool_progress(
            app,
            "uninstaller",
            "Đang dọn tàn dư",
            step_num,
            total,
            pct,
            &format!("Đang xử lý: {}", item.path),
        );

        match item.kind.as_str() {
            "folder" => {
                if is_blacklisted_path(&item.path) {
                    skipped_count += 1;
                    errors.push(format!("Bị chặn bởi Blacklist an toàn: {}", item.path));
                    continue;
                }
                let p = Path::new(&item.path);
                if !p.exists() {
                    continue;
                }
                let sz = if item.size_bytes > 0 {
                    item.size_bytes
                } else {
                    calc_dir_size(p, cancel, 0)
                };
                match fs::remove_dir_all(p) {
                    Ok(_) => {
                        removed_count += 1;
                        freed_bytes = freed_bytes.saturating_add(sz);
                    }
                    Err(e) => {
                        skipped_count += 1;
                        errors.push(format!("Không thể xóa thư mục '{}': {e}", item.path));
                    }
                }
            }
            "file" => {
                if is_blacklisted_path(&item.path) {
                    skipped_count += 1;
                    errors.push(format!("Bị chặn bởi Blacklist an toàn: {}", item.path));
                    continue;
                }
                let p = Path::new(&item.path);
                if !p.exists() {
                    continue;
                }
                let sz = fs::metadata(p).map(|m| m.len()).unwrap_or(item.size_bytes);
                match fs::remove_file(p) {
                    Ok(_) => {
                        removed_count += 1;
                        freed_bytes = freed_bytes.saturating_add(sz);
                    }
                    Err(e) => {
                        skipped_count += 1;
                        errors.push(format!("Không thể xóa tệp '{}': {e}", item.path));
                    }
                }
            }
            "registry" => {
                if is_blacklisted_reg(&item.path) {
                    skipped_count += 1;
                    errors.push(format!("Khóa Registry bị chặn bởi Blacklist an toàn: {}", item.path));
                    continue;
                }
                if !backed_up_keys.contains(&item.path.to_lowercase()) {
                    skipped_count += 1;
                    continue;
                }
                if let Some((hive, subkey)) = parse_reg_hive_subkey(&item.path) {
                    match RegKey::predef(hive).delete_subkey_all(&subkey) {
                        Ok(_) => {
                            removed_count += 1;
                        }
                        Err(e) => {
                            skipped_count += 1;
                            errors.push(format!("Không thể xóa khóa Registry '{}': {e}", item.path));
                        }
                    }
                } else {
                    skipped_count += 1;
                    errors.push(format!("Đường dẫn Registry không hợp lệ: {}", item.path));
                }
            }
            _ => {
                skipped_count += 1;
            }
        }
    }

    emit_tool_progress(
        app,
        "uninstaller",
        "Hoàn tất",
        total,
        total,
        100,
        &format!("Đã dọn {removed_count} mục tàn dư (bỏ qua {skipped_count})."),
    );

    Ok(LeftoverCleanResult {
        backup_reg_path,
        removed_count,
        freed_bytes,
        skipped_count,
        errors,
    })
}
