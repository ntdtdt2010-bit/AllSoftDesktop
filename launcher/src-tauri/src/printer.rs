//! Module 4: Cứu hộ Máy in (Print Spooler Rescue, Vá lỗi chia sẻ máy in LAN 0x0000011b / 0x00000709 / 0x00000bcb,
//! Dò máy chủ chia sẻ máy in qua SMB cổng 445 và kết nối nhanh máy in mạng).
//!
//! Nguyên tắc an toàn:
//! - Dùng RAII guard đảm bảo dịch vụ `Spooler` LUÔN được khởi động lại kể cả khi có lỗi hay bị hủy.
//! - BẮT BUỘC tự động backup các khóa Registry liên quan ra `Backups\reg_printer_<YYYYMMDD_HHMMSS>.reg`
//!   trước khi ghi bất kỳ thay đổi nào vào Registry.

use crate::{emit_tool_progress, util};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use winreg::enums::*;
use winreg::RegKey;

const SPOOL_PRINTERS_DIR: &str = r"C:\Windows\System32\spool\PRINTERS";

const KEY_CONTROL_PRINT: &str = r"SYSTEM\CurrentControlSet\Control\Print";
const KEY_PRINTERS_RPC: &str = r"SOFTWARE\Policies\Microsoft\Windows NT\Printers\RPC";
const KEY_POINT_AND_PRINT: &str = r"SOFTWARE\Policies\Microsoft\Windows NT\Printers\PointAndPrint";
const KEY_LANMAN_WORKSTATION: &str = r"SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterInfo {
    pub name: String,
    pub driver_name: String,
    pub port_name: String,
    pub is_network: bool,
    pub is_default: bool,
    pub status: String,
    pub jobs_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterFixState {
    pub id: String,
    pub name: String,
    pub error_codes: String,
    pub description: String,
    pub applied: bool,
    pub risk_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterStatusReport {
    pub spooler_status: String,
    pub stuck_jobs_count: u32,
    pub stuck_files_count: u32,
    pub printers: Vec<PrinterInfo>,
    pub share_fixes: Vec<PrinterFixState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpoolerRescueResult {
    pub cleared_files: u32,
    pub spooler_restarted: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterFixResult {
    pub applied_ids: Vec<String>,
    pub backup_reg_path: Option<String>,
    pub spooler_restarted: bool,
    pub message: String,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrinterHostProbe {
    pub host_ip: String,
    pub reachable_smb: bool,
    pub latency_ms: u64,
    pub shared_printers: Vec<String>,
    pub message: String,
}

/// Chạy PowerShell ẩn cửa sổ với UTF-8 stdout sạch (không trộn stderr vào JSON).
fn run_ps_stdout(script: &str) -> Result<String, String> {
    let full = format!(
        "$OutputEncoding = [System.Text.UTF8Encoding]::new($false); \
         [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); \
         {script}"
    );
    let out = util::cmd("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &full,
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Không chạy được PowerShell: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Parse đầu ra `ConvertTo-Json` của PowerShell (xử lý cả Object đơn lẫn Array).
fn parse_ps_json_array(stdout: &str) -> Vec<Value> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let start = trimmed.find(['[', '{']).unwrap_or(0);
    let slice = &trimmed[start..];
    match serde_json::from_str::<Value>(slice) {
        Ok(Value::Array(arr)) => arr,
        Ok(obj @ Value::Object(_)) => vec![obj],
        _ => Vec::new(),
    }
}

fn json_str(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn json_u32(v: &Value, key: &str) -> u32 {
    match v.get(key) {
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0) as u32,
        Some(Value::String(s)) => s.trim().parse::<u32>().unwrap_or(0),
        _ => 0,
    }
}

fn json_bool(v: &Value, key: &str) -> bool {
    match v.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

fn normalize_printer_status(raw: &str) -> String {
    match raw.trim() {
        "" => "Unknown".into(),
        "0" => "Normal".into(),
        "1" => "Paused".into(),
        "2" => "Error".into(),
        "3" => "PendingDeletion".into(),
        "4" => "PaperJam".into(),
        "5" => "PaperOut".into(),
        "6" => "ManualFeed".into(),
        "7" => "PaperProblem".into(),
        "8" => "Offline".into(),
        "9" => "IOActive".into(),
        "10" => "Busy".into(),
        "11" => "Printing".into(),
        "12" => "OutputBinFull".into(),
        "13" => "NotAvailable".into(),
        "14" => "Waiting".into(),
        "15" => "Processing".into(),
        "16" => "Initializing".into(),
        "17" => "WarmingUp".into(),
        "18" => "TonerLow".into(),
        "19" => "NoToner".into(),
        "20" => "PagePunt".into(),
        "21" => "UserIntervention".into(),
        "22" => "OutOfMemory".into(),
        "23" => "DoorOpen".into(),
        other => other.to_string(),
    }
}

fn get_spooler_status() -> String {
    let script = "(Get-Service -Name Spooler -ErrorAction SilentlyContinue).Status.ToString()";
    match run_ps_stdout(script) {
        Ok(out) => {
            let s = out.trim();
            if s.is_empty() {
                "Unknown".into()
            } else {
                s.to_string()
            }
        }
        Err(_) => "Unknown".into(),
    }
}

fn is_spool_queue_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("shd") || e.eq_ignore_ascii_case("spl"))
}

fn count_stuck_spool_files() -> u32 {
    let dir = Path::new(SPOOL_PRINTERS_DIR);
    let Ok(rd) = fs::read_dir(dir) else {
        return 0;
    };
    let mut count = 0u32;
    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_file() && is_spool_queue_file(&entry.path()) {
            count = count.saturating_add(1);
        }
    }
    count
}

fn read_hklm_dword(subkey: &str, value_name: &str) -> Option<u32> {
    let key = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(subkey, KEY_READ)
        .ok()?;
    key.get_value::<u32, _>(value_name).ok()
}

fn collect_share_fixes() -> Vec<PrinterFixState> {
    let fix_11b = read_hklm_dword(KEY_CONTROL_PRINT, "RpcAuthnLevelPrivacyEnabled") == Some(0);
    let fix_709 = read_hklm_dword(KEY_PRINTERS_RPC, "RpcUseNamedPipeProtocol") == Some(1);
    let fix_bcb =
        read_hklm_dword(KEY_POINT_AND_PRINT, "RestrictDriverInstallationToAdministrators")
            == Some(0);
    let fix_guest = read_hklm_dword(KEY_LANMAN_WORKSTATION, "AllowInsecureGuestAuth") == Some(1);

    vec![
        PrinterFixState {
            id: "fix_0x0000011b".into(),
            name: "Vá lỗi chia sẻ máy in mạng 0x0000011b".into(),
            error_codes: "0x0000011b".into(),
            description: "Đặt RpcAuthnLevelPrivacyEnabled = 0 trong HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print để khắc phục lỗi chặn in mạng LAN sau bản vá Windows.".into(),
            applied: fix_11b,
            risk_note: "Giảm yêu cầu mã hóa RPC mức riêng tư cho dịch vụ in ấn (chỉ nên bật trong mạng LAN nội bộ tin cậy).".into(),
        },
        PrinterFixState {
            id: "fix_0x00000709".into(),
            name: "Vá lỗi kết nối RPC trên Windows 11 22H2+ (0x00000709)".into(),
            error_codes: "0x00000709, 0x00000bc4".into(),
            description: "Bật RpcUseNamedPipeProtocol = 1 trong HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Printers\\RPC để chuyển RPC sang Named Pipes.".into(),
            applied: fix_709,
            risk_note: "Cho phép kết nối máy in mạng qua giao thức Named Pipes thay vì RPC over TCP mặc định.".into(),
        },
        PrinterFixState {
            id: "fix_0x00000bcb".into(),
            name: "Vá lỗi chặn cài Driver Point & Print (0x00000bcb)".into(),
            error_codes: "0x00000bcb, 0x000006ba".into(),
            description: "Đặt RestrictDriverInstallationToAdministrators = 0 để cho phép máy trạm tải driver trực tiếp từ máy chủ chia sẻ máy in.".into(),
            applied: fix_bcb,
            risk_note: "Cho phép người dùng không phải Admin tự động cài driver máy in từ máy chủ chia sẻ trong mạng LAN.".into(),
        },
        PrinterFixState {
            id: "fix_lan_share_firewall".into(),
            name: "Bật Insecure Guest Auth & mở Firewall chia sẻ máy in".into(),
            error_codes: "Guest Auth / Firewall LAN".into(),
            description: "Đặt AllowInsecureGuestAuth = 1 cho LanmanWorkstation và mở nhóm quy tắc tường lửa 'File and Printer Sharing'.".into(),
            applied: fix_guest,
            risk_note: "Cho phép truy cập chia sẻ SMB không mật khẩu (Guest) và mở cổng File & Printer Sharing trên Windows Firewall.".into(),
        },
    ]
}

fn list_printers() -> Vec<PrinterInfo> {
    let script = r#"
$def = $null
try {
  $def = (Get-CimInstance -ClassName Win32_Printer -Filter "Default=True" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Name)
} catch {}
$list = Get-Printer -ErrorAction SilentlyContinue | Select-Object Name,DriverName,PortName,Type,PrinterStatus,JobCount,@{N='IsDefault';E={$_.Name -eq $def}}
if ($list) {
  $list | ConvertTo-Json -Depth 3 -Compress
}
"#;
    let Ok(raw) = run_ps_stdout(script) else {
        return Vec::new();
    };
    let rows = parse_ps_json_array(&raw);
    let mut printers = Vec::with_capacity(rows.len());
    for row in rows {
        let name = json_str(&row, "Name");
        if name.is_empty() {
            continue;
        }
        let driver_name = json_str(&row, "DriverName");
        let port_name = json_str(&row, "PortName");
        let type_str = json_str(&row, "Type");
        let status = normalize_printer_status(&json_str(&row, "PrinterStatus"));
        let jobs_count = json_u32(&row, "JobCount");
        let is_default = json_bool(&row, "IsDefault");
        let is_network = type_str.eq_ignore_ascii_case("Connection")
            || type_str == "1"
            || name.starts_with(r"\\")
            || port_name.starts_with(r"\\");

        printers.push(PrinterInfo {
            name,
            driver_name,
            port_name,
            is_network,
            is_default,
            status,
            jobs_count,
        });
    }
    printers
}

/// 1. Quét toàn diện trạng thái Print Spooler, hàng đợi kẹt, danh sách máy in và 4 bản vá chia sẻ LAN.
pub fn scan_printer_status() -> Result<PrinterStatusReport, String> {
    let spooler_status = get_spooler_status();
    let stuck_files_count = count_stuck_spool_files();
    let printers = list_printers();
    let stuck_jobs_count = printers
        .iter()
        .fold(0u32, |acc, p| acc.saturating_add(p.jobs_count));
    let share_fixes = collect_share_fixes();

    Ok(PrinterStatusReport {
        spooler_status,
        stuck_jobs_count,
        stuck_files_count,
        printers,
        share_fixes,
    })
}

/// RAII guard đảm bảo dịch vụ `Spooler` LUÔN được khởi động lại (`net start spooler`)
/// ngay cả khi có lỗi giữa chừng, panic hoặc người dùng bấm Hủy.
struct SpoolerGuard {
    restarted: bool,
}

impl SpoolerGuard {
    fn stop() -> Self {
        let _ = util::cmd("net")
            .args(["stop", "spooler"])
            .stdin(Stdio::null())
            .output();
        Self { restarted: false }
    }

    fn restart_now(mut self) -> bool {
        let ok = start_spooler_service();
        self.restarted = true;
        ok
    }
}

impl Drop for SpoolerGuard {
    fn drop(&mut self) {
        if !self.restarted {
            let _ = start_spooler_service();
            self.restarted = true;
        }
    }
}

fn start_spooler_service() -> bool {
    let _ = util::cmd("net")
        .args(["start", "spooler"])
        .stdin(Stdio::null())
        .output();
    get_spooler_status().eq_ignore_ascii_case("Running")
}

/// 2. Cứu hộ kẹt lệnh in: Dừng Spooler -> Xóa tệp .SHD/.SPL -> Khởi động lại Spooler (RAII guard).
pub fn rescue_print_spooler(
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
) -> Result<SpoolerRescueResult, String> {
    if cancel.load(Ordering::SeqCst) {
        emit_tool_progress(app, "printer", "Đã hủy", 0, 3, 100, "Đã hủy cứu hộ Print Spooler.");
        return Ok(SpoolerRescueResult {
            cleared_files: 0,
            spooler_restarted: get_spooler_status().eq_ignore_ascii_case("Running"),
            message: "Đã hủy trước khi thực thi.".into(),
        });
    }

    emit_tool_progress(
        app,
        "printer",
        "Dừng Print Spooler",
        1,
        3,
        20,
        "Đang tạm dừng dịch vụ Print Spooler (net stop spooler)…",
    );
    let guard = SpoolerGuard::stop();

    if cancel.load(Ordering::SeqCst) {
        let restarted = guard.restart_now();
        emit_tool_progress(
            app,
            "printer",
            "Đã hủy",
            3,
            3,
            100,
            "Đã hủy và khởi động lại Print Spooler an toàn.",
        );
        return Ok(SpoolerRescueResult {
            cleared_files: 0,
            spooler_restarted: restarted,
            message: "Đã dừng tác vụ theo yêu cầu và khởi động lại Print Spooler.".into(),
        });
    }

    emit_tool_progress(
        app,
        "printer",
        "Xóa lệnh in kẹt",
        2,
        3,
        55,
        "Đang dọn các tệp .SHD / .SPL trong C:\\Windows\\System32\\spool\\PRINTERS…",
    );

    let mut cleared_files = 0u32;
    let mut skipped_locked = 0u32;
    let spool_dir = Path::new(SPOOL_PRINTERS_DIR);
    if let Ok(rd) = fs::read_dir(spool_dir) {
        for entry in rd.flatten() {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            let Ok(ft) = entry.file_type() else { continue };
            if !ft.is_file() {
                continue;
            }
            let path = entry.path();
            if !is_spool_queue_file(&path) {
                continue;
            }
            match fs::remove_file(&path) {
                Ok(_) => cleared_files = cleared_files.saturating_add(1),
                Err(_) => skipped_locked = skipped_locked.saturating_add(1),
            }
        }
    }

    emit_tool_progress(
        app,
        "printer",
        "Khởi động lại Spooler",
        3,
        3,
        85,
        "Đang khởi động lại dịch vụ Print Spooler (net start spooler)…",
    );
    let spooler_restarted = guard.restart_now();
    let was_cancelled = cancel.load(Ordering::SeqCst);

    let message = if was_cancelled {
        format!(
            "Đã hủy giữa chừng (đã xóa {cleared_files} tệp kẹt). Print Spooler {}.",
            if spooler_restarted { "đã chạy lại bình thường" } else { "chưa khởi động lại được (cần quyền Admin)" }
        )
    } else if skipped_locked > 0 {
        format!(
            "Đã xóa {cleared_files} tệp hàng đợi in, bỏ qua {skipped_locked} tệp đang bị khóa (có thể cần quyền Administrator). Print Spooler {}.",
            if spooler_restarted { "đã khởi động lại" } else { "chưa chạy lại được" }
        )
    } else {
        format!(
            "Đã dọn sạch {cleared_files} tệp hàng đợi in (.SHD/.SPL) và {}.",
            if spooler_restarted { "khởi động lại Print Spooler thành công" } else { "chưa khởi động lại được Print Spooler (cần quyền Admin)" }
        )
    };

    emit_tool_progress(
        app,
        "printer",
        if was_cancelled { "Đã hủy" } else { "Hoàn tất" },
        3,
        3,
        100,
        &message,
    );

    Ok(SpoolerRescueResult {
        cleared_files,
        spooler_restarted,
        message,
    })
}

/// Tạo thư mục `Backups` cạnh file `.exe`, fallback `%LOCALAPPDATA%\AllSoftDesktop\Backups`.
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

fn write_utf16le_reg(path: &Path, content: &str) -> Result<(), String> {
    let mut out = Vec::with_capacity(2 + content.len() * 2);
    out.push(0xFF);
    out.push(0xFE);
    for unit in content.encode_utf16() {
        out.extend_from_slice(&unit.to_le_bytes());
    }
    fs::write(path, out).map_err(|e| format!("Không ghi được tệp backup Registry: {e}"))
}

fn backup_printer_registry_keys(fix_ids: &[String]) -> Result<String, String> {
    let backup_dir = resolve_backup_dir()?;
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let final_path = backup_dir.join(format!("reg_printer_{ts}.reg"));

    let mut keys_to_export: Vec<&str> = Vec::new();
    for id in fix_ids {
        let target = match id.as_str() {
            "fix_0x0000011b" => r"HKLM\SYSTEM\CurrentControlSet\Control\Print",
            "fix_0x00000709" => r"HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Printers\RPC",
            "fix_0x00000bcb" => r"HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Printers\PointAndPrint",
            "fix_lan_share_firewall" => r"HKLM\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters",
            _ => continue,
        };
        if !keys_to_export.contains(&target) {
            keys_to_export.push(target);
        }
    }

    if keys_to_export.is_empty() {
        return Err("Không có mã bản vá hợp lệ nào để sao lưu và áp dụng.".into());
    }

    let mut combined = String::from("Windows Registry Editor Version 5.00\r\n\r\n");
    combined.push_str(&format!(
        "; AllSoft Desktop - Backup Registry May in truoc khi va ({ts})\r\n\r\n"
    ));

    for (idx, reg_key) in keys_to_export.iter().enumerate() {
        let tmp_file = std::env::temp_dir().join(format!("allsoft_printer_bak_{ts}_{idx}.reg"));
        let tmp_str = tmp_file.to_string_lossy().to_string();

        let export_ok = util::cmd("reg.exe")
            .args(["export", reg_key, &tmp_str, "/y"])
            .stdin(Stdio::null())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if export_ok {
            let text = read_reg_file_text(&tmp_file)?;
            let body = text
                .trim_start_matches('\u{feff}')
                .strip_prefix("Windows Registry Editor Version 5.00")
                .unwrap_or(&text)
                .trim();
            if !body.is_empty() {
                combined.push_str(body);
                combined.push_str("\r\n\r\n");
            }
        } else {
            // Khóa Policy (RPC / PointAndPrint) thường chưa tồn tại trước lần vá đầu tiên -> ghi nhận rõ trong file backup
            combined.push_str(&format!(
                "; Khoa chua ton tai truoc khi ap dung ban va: {reg_key}\r\n[-{reg_key}]\r\n\r\n"
            ));
        }
        let _ = fs::remove_file(&tmp_file);
    }

    write_utf16le_reg(&final_path, &combined)?;
    Ok(final_path.to_string_lossy().to_string())
}

fn set_hklm_dword(subkey: &str, value_name: &str, value: u32) -> Result<(), String> {
    let (key, _) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .create_subkey(subkey)
        .map_err(|e| format!("Không thể mở/tạo khóa HKLM\\{subkey} (cần quyền Administrator): {e}"))?;
    key.set_value(value_name, &value)
        .map_err(|e| format!("Không thể ghi giá trị {value_name} trong HKLM\\{subkey}: {e}"))?;
    Ok(())
}

/// 3. Tự động sao lưu Registry ra `Backups\reg_printer_<YYYYMMDD_HHMMSS>.reg`, áp dụng các bản vá máy in mạng
/// và khởi động lại dịch vụ Print Spooler.
pub fn apply_printer_share_fixes(
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
    fix_ids: Vec<String>,
) -> Result<PrinterFixResult, String> {
    if fix_ids.is_empty() {
        return Err("Chưa chọn bản vá nào để áp dụng.".into());
    }

    let total_steps = (fix_ids.len() + 2) as u32;
    emit_tool_progress(
        app,
        "printer",
        "Sao lưu Registry",
        1,
        total_steps,
        15,
        "Đang tự động sao lưu các khóa Registry máy in ra tệp .reg…",
    );

    // BẮT BUỘC backup trước khi sửa bất kỳ khóa Registry nào
    let backup_path = backup_printer_registry_keys(&fix_ids)?;

    let mut applied_ids: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    for (idx, fix_id) in fix_ids.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            errors.push("Đã dừng áp dụng bản vá theo yêu cầu.".into());
            break;
        }
        let step = (idx + 2) as u32;
        let pct = 20 + ((idx as u32 + 1) * 60) / (fix_ids.len().max(1) as u32);
        emit_tool_progress(
            app,
            "printer",
            "Đang áp dụng bản vá",
            step,
            total_steps,
            pct,
            &format!("Đang áp dụng bản vá: {fix_id}"),
        );

        match fix_id.as_str() {
            "fix_0x0000011b" => {
                match set_hklm_dword(KEY_CONTROL_PRINT, "RpcAuthnLevelPrivacyEnabled", 0) {
                    Ok(_) => applied_ids.push(fix_id.clone()),
                    Err(e) => errors.push(format!("[fix_0x0000011b] {e}")),
                }
            }
            "fix_0x00000709" => {
                match set_hklm_dword(KEY_PRINTERS_RPC, "RpcUseNamedPipeProtocol", 1) {
                    Ok(_) => applied_ids.push(fix_id.clone()),
                    Err(e) => errors.push(format!("[fix_0x00000709] {e}")),
                }
            }
            "fix_0x00000bcb" => {
                match set_hklm_dword(
                    KEY_POINT_AND_PRINT,
                    "RestrictDriverInstallationToAdministrators",
                    0,
                ) {
                    Ok(_) => applied_ids.push(fix_id.clone()),
                    Err(e) => errors.push(format!("[fix_0x00000bcb] {e}")),
                }
            }
            "fix_lan_share_firewall" => {
                let mut reg_ok = false;
                match set_hklm_dword(KEY_LANMAN_WORKSTATION, "AllowInsecureGuestAuth", 1) {
                    Ok(_) => reg_ok = true,
                    Err(e) => errors.push(format!("[fix_lan_share_firewall] {e}")),
                }
                let fw_res = util::run_capture(
                    "netsh",
                    &[
                        "advfirewall".into(),
                        "firewall".into(),
                        "set".into(),
                        "rule".into(),
                        "group=File and Printer Sharing".into(),
                        "new".into(),
                        "enable=Yes".into(),
                    ],
                );
                match fw_res {
                    Ok((0, _)) => {}
                    Ok((code, out)) => {
                        errors.push(format!(
                            "[fix_lan_share_firewall] Mở Firewall trả mã {code}: {}",
                            out.trim()
                        ));
                    }
                    Err(e) => {
                        errors.push(format!("[fix_lan_share_firewall] Không chạy được netsh: {e}"));
                    }
                }
                if reg_ok {
                    applied_ids.push(fix_id.clone());
                }
            }
            other => {
                errors.push(format!("Mã bản vá không được hỗ trợ: {other}"));
            }
        }
    }

    emit_tool_progress(
        app,
        "printer",
        "Khởi động lại Spooler",
        total_steps,
        total_steps,
        90,
        "Đang khởi động lại dịch vụ Print Spooler để áp dụng thay đổi…",
    );

    let spooler_restarted = if !applied_ids.is_empty() {
        let guard = SpoolerGuard::stop();
        guard.restart_now()
    } else {
        get_spooler_status().eq_ignore_ascii_case("Running")
    };

    let message = if applied_ids.is_empty() {
        "Không áp dụng được bản vá nào (hãy chạy AllSoft Desktop với quyền Administrator).".into()
    } else if errors.is_empty() {
        format!(
            "Đã sao lưu Registry và áp dụng thành công {} bản vá. Print Spooler {}.",
            applied_ids.len(),
            if spooler_restarted { "đã khởi động lại" } else { "chưa khởi động lại được" }
        )
    } else {
        format!(
            "Đã áp dụng {}/{} bản vá (có {} cảnh báo/lỗi). Đã lưu bản sao lưu Registry.",
            applied_ids.len(),
            fix_ids.len(),
            errors.len()
        )
    };

    emit_tool_progress(app, "printer", "Hoàn tất", total_steps, total_steps, 100, &message);

    Ok(PrinterFixResult {
        applied_ids,
        backup_reg_path: Some(backup_path),
        spooler_restarted,
        message,
        errors,
    })
}

fn sanitize_host(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_start_matches('\\').trim();
    let host = trimmed.split('\\').next().unwrap_or("").trim();
    if host.is_empty() {
        return Err("Vui lòng nhập địa chỉ IP hoặc tên máy chủ chia sẻ máy in.".into());
    }
    if host.len() > 253
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':'))
    {
        return Err("Địa chỉ IP hoặc tên máy chủ không hợp lệ.".into());
    }
    Ok(host.to_string())
}

fn parse_net_view_printers(output: &str) -> Vec<String> {
    let mut printers = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('-')
            || trimmed.starts_with("Shared resources")
            || trimmed.starts_with("Share name")
            || trimmed.starts_with("The command completed")
        {
            continue;
        }
        // Dòng điển hình của `net view \\host`:
        // "HP LaserJet P1102   Print   HP LaserJet Professional P1102"
        // Tách theo cụm >= 2 khoảng trắng hoặc tìm token "Print"
        let lower = trimmed.to_lowercase();
        if let Some(pos) = lower.find("  print") {
            let share_name = trimmed[..pos].trim();
            if !share_name.is_empty() {
                printers.push(share_name.to_string());
            }
            continue;
        }
        let cols: Vec<&str> = trimmed.split_whitespace().collect();
        if cols.len() >= 2 && cols[1].eq_ignore_ascii_case("Print") {
            printers.push(cols[0].to_string());
        }
    }
    printers
}

/// 4. Kiểm tra kết nối SMB (TCP cổng 445, timeout 2 giây) và liệt kê các máy in đang chia sẻ trên máy chủ LAN.
pub fn probe_printer_host(host_ip: String) -> Result<PrinterHostProbe, String> {
    let clean_host = sanitize_host(&host_ip)?;
    let start = Instant::now();

    let addrs: Vec<_> = match (clean_host.as_str(), 445u16).to_socket_addrs() {
        Ok(iter) => iter.collect(),
        Err(e) => {
            return Ok(PrinterHostProbe {
                host_ip: clean_host,
                reachable_smb: false,
                latency_ms: start.elapsed().as_millis() as u64,
                shared_printers: Vec::new(),
                message: format!("Không phân giải được địa chỉ máy chủ: {e}"),
            });
        }
    };

    let timeout = Duration::from_secs(2);
    let mut reachable_smb = false;
    for addr in addrs {
        if TcpStream::connect_timeout(&addr, timeout).is_ok() {
            reachable_smb = true;
            break;
        }
    }
    let latency_ms = start.elapsed().as_millis() as u64;

    if !reachable_smb {
        return Ok(PrinterHostProbe {
            host_ip: clean_host.clone(),
            reachable_smb: false,
            latency_ms,
            shared_printers: Vec::new(),
            message: format!(
                "Không thể kết nối cổng SMB 445 tới '{clean_host}' (máy chủ đang tắt, khác lớp mạng hoặc bị chặn Firewall)."
            ),
        });
    }

    let mut seen = HashSet::new();
    let mut shared_printers = Vec::new();

    // Cách 1: PowerShell Get-Printer -ComputerName <host>
    let ps_script = format!(
        "Get-Printer -ComputerName '{clean_host}' -ErrorAction SilentlyContinue | \
         Where-Object {{ $_.Shared -eq $true }} | \
         ForEach-Object {{ if ($_.ShareName) {{ $_.ShareName }} else {{ $_.Name }} }} | \
         ConvertTo-Json -Compress"
    );
    if let Ok(raw) = run_ps_stdout(&ps_script) {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            match serde_json::from_str::<Value>(trimmed) {
                Ok(Value::Array(arr)) => {
                    for v in arr {
                        if let Some(s) = v.as_str() {
                            let s = s.trim();
                            if !s.is_empty() && seen.insert(s.to_lowercase()) {
                                shared_printers.push(s.to_string());
                            }
                        }
                    }
                }
                Ok(Value::String(s)) => {
                    let s = s.trim();
                    if !s.is_empty() && seen.insert(s.to_lowercase()) {
                        shared_printers.push(s.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    // Cách 2 (fallback): net view \\<host>
    if shared_printers.is_empty() {
        let unc_host = format!(r"\\{clean_host}");
        if let Ok((0, out)) = util::run_capture("net", &["view".into(), unc_host]) {
            for p in parse_net_view_printers(&out) {
                if seen.insert(p.to_lowercase()) {
                    shared_printers.push(p);
                }
            }
        }
    }

    let message = if shared_printers.is_empty() {
        format!(
            "Đã kết nối SMB 445 tới '{clean_host}' ({latency_ms} ms) nhưng chưa thấy máy in nào đang chia sẻ (hoặc cần xác thực / bật bản vá Guest Auth)."
        )
    } else {
        format!(
            "Kết nối SMB tới '{clean_host}' thành công ({latency_ms} ms) — tìm thấy {} máy in đang chia sẻ.",
            shared_printers.len()
        )
    };

    Ok(PrinterHostProbe {
        host_ip: clean_host,
        reachable_smb: true,
        latency_ms,
        shared_printers,
        message,
    })
}

/// 5. Kết nối nhanh máy in chia sẻ qua đường dẫn UNC (`\\IP_HOAC_TEN_MAY\TenMayIn`).
pub fn connect_shared_printer(unc_path: String) -> Result<String, String> {
    let trimmed = unc_path.trim().to_string();
    if !trimmed.starts_with(r"\\") {
        return Err("Đường dẫn máy in chia sẻ phải bắt đầu bằng \\\\ (ví dụ: \\\\192.168.1.10\\CanonLBP2900).".into());
    }
    let rest = &trimmed[2..];
    let mut parts = rest.splitn(2, '\\');
    let host = parts.next().unwrap_or("").trim();
    let share = parts.next().unwrap_or("").trim();
    if host.is_empty() || share.is_empty() {
        return Err("Đường dẫn UNC chưa đầy đủ, cần có cả tên máy chủ và tên máy in chia sẻ (\\\\host\\share).".into());
    }
    if trimmed.chars().any(|c| c.is_control() || matches!(c, '"' | '&' | '|' | ';' | '`')) {
        return Err("Đường dẫn UNC chứa ký tự không hợp lệ.".into());
    }

    let out = util::cmd("rundll32.exe")
        .args(["printui.dll,PrintUIEntry", "/in", "/n", &trimmed])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Không thể chạy rundll32 printui.dll: {e}"))?;

    if out.status.success() {
        Ok(format!("Đã kết nối máy in chia sẻ '{trimmed}' thành công."))
    } else {
        let code = out.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("Kết nối máy in '{trimmed}' không thành công (mã {code}). Hãy kiểm tra tên chia sẻ hoặc áp dụng các bản vá 0x0000011b / 0x00000709."))
        } else {
            Err(format!("Kết nối máy in '{trimmed}' lỗi (mã {code}): {stderr}"))
        }
    }
}
