//! Module 1: Chẩn đoán hệ thống (Event Viewer, Reliability Monitor, Minidump BSOD,
//! Sức khỏe ổ cứng / S.M.A.R.T, Driver lỗi, và xuất báo cáo Markdown sạch cho AI).

use crate::detect::{collect_system_specs, SystemSpecs};
use crate::{emit_tool_progress, util};
use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::SystemTime;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticItem {
    pub id: String,
    pub category: String,
    /// "critical" | "warning" | "ok"
    pub severity: String,
    pub code: String,
    pub title: String,
    pub detail: String,
    pub count: u32,
    pub last_seen: String,
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsSummary {
    pub critical: usize,
    pub warning: usize,
    pub ok: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticsReport {
    pub scanned_at: String,
    pub is_admin: bool,
    pub cancelled: bool,
    pub summary: DiagnosticsSummary,
    pub items: Vec<DiagnosticItem>,
    pub ai_markdown: String,
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    let cleaned = s.replace(['\r', '\n', '\t'], " ");
    let trimmed = cleaned.trim();
    if trimmed.chars().count() <= max_chars {
        trimmed.to_string()
    } else {
        let cut: String = trimmed.chars().take(max_chars).collect();
        format!("{cut}…")
    }
}

fn format_system_time(st: SystemTime) -> String {
    let dt: DateTime<Local> = st.into();
    dt.format("%Y-%m-%d %H:%M:%S").to_string()
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

fn json_i64(v: &Value, key: &str) -> i64 {
    match v.get(key) {
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse::<i64>().unwrap_or(0),
        _ => 0,
    }
}

fn json_u64(v: &Value, key: &str) -> u64 {
    match v.get(key) {
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse::<u64>().unwrap_or(0),
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

/// Bước 1: Quét Event Viewer (7 ngày gần nhất, Critical/Error trên System & Application) và khử trùng lặp.
fn scan_event_viewer() -> Vec<DiagnosticItem> {
    let script = r#"
$events = Get-WinEvent -FilterHashtable @{LogName=@('System','Application'); Level=@(1,2); StartTime=(Get-Date).AddDays(-7)} -MaxEvents 250 -ErrorAction SilentlyContinue
if ($events) {
  $events | ForEach-Object {
    $msg = if ($_.Message) { ($_.Message -replace '[\r\n\t]+', ' ').Trim() } else { '' }
    if ($msg.Length -gt 240) { $msg = $msg.Substring(0, 240) }
    [PSCustomObject]@{
      Provider = $_.ProviderName
      Id       = [int]$_.Id
      Level    = [int]$_.Level
      Time     = $_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')
      Message  = $msg
    }
  } | ConvertTo-Json -Depth 3 -Compress
}
"#;

    let raw = match run_ps_stdout(script) {
        Ok(s) => s,
        Err(e) => {
            return vec![DiagnosticItem {
                id: "ev-err".into(),
                category: "Event Viewer".into(),
                severity: "warning".into(),
                code: "PS-ERR".into(),
                title: "Không thể đọc nhật ký Event Viewer".into(),
                detail: e,
                count: 1,
                last_seen: util::now_string(),
                recommendation: "Thử chạy AllSoft Desktop với quyền Administrator.".into(),
            }];
        }
    };

    let rows = parse_ps_json_array(&raw);
    if rows.is_empty() {
        return vec![DiagnosticItem {
            id: "ev-ok".into(),
            category: "Event Viewer".into(),
            severity: "ok".into(),
            code: "OK".into(),
            title: "Event Viewer (7 ngày) không ghi nhận lỗi nghiêm trọng".into(),
            detail: "Không có sự kiện mức Critical hoặc Error trong nhật ký System & Application 7 ngày qua.".into(),
            count: 0,
            last_seen: util::now_string(),
            recommendation: "Hệ thống vận hành ổn định.".into(),
        }];
    }

    struct AggEvent {
        provider: String,
        event_id: i64,
        min_level: i64,
        count: u32,
        last_seen: String,
        sample_msg: String,
    }

    let mut map: HashMap<(String, i64), AggEvent> = HashMap::new();
    for row in rows {
        let provider = json_str(&row, "Provider");
        if provider.is_empty() {
            continue;
        }
        let event_id = json_i64(&row, "Id");
        let level = json_i64(&row, "Level");
        let time = json_str(&row, "Time");
        let msg = json_str(&row, "Message");

        let key = (provider.to_lowercase(), event_id);
        map.entry(key)
            .and_modify(|e| {
                e.count = e.count.saturating_add(1);
                if level > 0 && (e.min_level == 0 || level < e.min_level) {
                    e.min_level = level;
                }
                if time > e.last_seen {
                    e.last_seen = time.clone();
                    if !msg.is_empty() {
                        e.sample_msg = msg.clone();
                    }
                }
            })
            .or_insert(AggEvent {
                provider,
                event_id,
                min_level: level,
                count: 1,
                last_seen: time,
                sample_msg: msg,
            });
    }

    let mut items = Vec::new();
    for (_, ev) in map {
        let p_low = ev.provider.to_lowercase();
        let (severity, title, rec) = classify_event(&p_low, &ev.provider, ev.event_id, ev.min_level);
        let code = format!("{} {}", ev.provider, ev.event_id);
        let detail = if ev.sample_msg.is_empty() {
            format!("Nguồn: {} · Event ID {} · Xuất hiện {} lần trong 7 ngày qua.", ev.provider, ev.event_id, ev.count)
        } else {
            truncate_chars(&ev.sample_msg, 220)
        };
        items.push(DiagnosticItem {
            id: format!("ev-{}-{}", p_low.replace(' ', "-"), ev.event_id),
            category: "Event Viewer".into(),
            severity: severity.into(),
            code,
            title,
            detail,
            count: ev.count,
            last_seen: ev.last_seen,
            recommendation: rec.into(),
        });
    }

    items
}

fn classify_event(p_low: &str, provider: &str, id: i64, level: i64) -> (&'static str, String, &'static str) {
    if p_low.contains("kernel-power") && id == 41 {
        return (
            "critical",
            "Mất nguồn đột ngột / Khởi động lại bất ngờ (Kernel-Power 41)".into(),
            "Kiểm tra bộ nguồn (PSU), dây điện/UPS, nhiệt độ CPU/GPU và chạy kiểm tra RAM (Windows Memory Diagnostic).",
        );
    }
    if (p_low.contains("bugcheck") || p_low.contains("wer-systemerrorreporting")) && id == 1001 {
        return (
            "critical",
            "Màn hình xanh BSOD (BugCheck 1001)".into(),
            "Kiểm tra file Minidump, cập nhật driver card đồ họa/chipset và kiểm tra lỗi RAM.",
        );
    }
    if p_low == "disk" && matches!(id, 7 | 11 | 51) {
        return (
            "critical",
            format!("Lỗi đọc/ghi vật lý ổ cứng (Disk {id})"),
            "SAO LƯU DỮ LIỆU NGAY! Kiểm tra cáp SATA/khe NVMe và theo dõi chỉ số S.M.A.R.T của ổ cứng.",
        );
    }
    if p_low == "ntfs" && id == 55 {
        return (
            "critical",
            "Lỗi cấu trúc hệ thống tệp NTFS (NTFS 55)".into(),
            "Sao lưu dữ liệu quan trọng và chạy lệnh `chkdsk /f` trên phân vùng bị lỗi.",
        );
    }
    if p_low.contains("application error") && id == 1000 {
        return (
            "warning",
            "Ứng dụng bị đóng đột ngột (Application Error 1000)".into(),
            "Cập nhật hoặc cài đặt lại phần mềm bị crash; kiểm tra xung đột với phần mềm diệt virus hoặc Visual C++ Runtime.",
        );
    }
    if level == 1 {
        return (
            "critical",
            format!("Lỗi nghiêm trọng từ {provider} (ID {id})"),
            "Kiểm tra chi tiết sự cố và dán báo cáo Markdown cho AI để chẩn đoán sâu hơn.",
        );
    }
    (
        "warning",
        format!("Lỗi hệ thống/ứng dụng: {provider} (ID {id})"),
        "Theo dõi nếu lỗi lặp lại nhiều lần; cập nhật Windows và phần mềm liên quan.",
    )
}

/// Bước 2: Kiểm tra BSOD Minidump (`C:\Windows\Minidump`) & Reliability Monitor (`Win32_ReliabilityRecords`).
fn scan_reliability_and_bsod(is_admin: bool) -> Vec<DiagnosticItem> {
    let mut items = Vec::new();

    // 2a. Kiểm tra C:\Windows\Minidump
    let minidump_dir = Path::new(r"C:\Windows\Minidump");
    if minidump_dir.exists() {
        match std::fs::read_dir(minidump_dir) {
            Ok(rd) => {
                let mut dumps: Vec<(String, SystemTime)> = Vec::new();
                for entry in rd.flatten() {
                    let path = entry.path();
                    let is_dmp = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| e.eq_ignore_ascii_case("dmp"));
                    if is_dmp {
                        let mtime = entry
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .unwrap_or(SystemTime::UNIX_EPOCH);
                        let name = entry.file_name().to_string_lossy().to_string();
                        dumps.push((name, mtime));
                    }
                }
                if !dumps.is_empty() {
                    dumps.sort_by(|a, b| b.1.cmp(&a.1));
                    let last_seen = format_system_time(dumps[0].1);
                    let sample_names: Vec<String> = dumps.iter().take(5).map(|d| d.0.clone()).collect();
                    items.push(DiagnosticItem {
                        id: "bsod-minidump".into(),
                        category: "BSOD / Minidump".into(),
                        severity: "critical".into(),
                        code: "MINIDUMP".into(),
                        title: format!("Phát hiện {} tệp Memory Dump (BSOD)", dumps.len()),
                        detail: format!("Các tệp gần nhất trong C:\\Windows\\Minidump: {}", sample_names.join(", ")),
                        count: dumps.len() as u32,
                        last_seen,
                        recommendation: "Máy từng bị màn hình xanh (BSOD). Nên kiểm tra RAM bằng Windows Memory Diagnostic và cập nhật driver phần cứng.".into(),
                    });
                } else {
                    items.push(DiagnosticItem {
                        id: "bsod-ok".into(),
                        category: "BSOD / Minidump".into(),
                        severity: "ok".into(),
                        code: "OK".into(),
                        title: "Không phát hiện tệp BSOD Minidump".into(),
                        detail: "Thư mục C:\\Windows\\Minidump không chứa tệp .dmp nào.".into(),
                        count: 0,
                        last_seen: util::now_string(),
                        recommendation: "Không ghi nhận sự cố màn hình xanh gần đây.".into(),
                    });
                }
            }
            Err(_) => {
                items.push(DiagnosticItem {
                    id: "bsod-perm".into(),
                    category: "BSOD / Minidump".into(),
                    severity: "warning".into(),
                    code: "ACCESS-DENIED".into(),
                    title: "Không thể truy cập C:\\Windows\\Minidump".into(),
                    detail: if is_admin {
                        "Thư mục Minidump bị giới hạn quyền đọc.".into()
                    } else {
                        "Cần chạy ứng dụng với quyền Administrator để kiểm tra tệp BSOD Minidump.".into()
                    },
                    count: 1,
                    last_seen: util::now_string(),
                    recommendation: "Mở lại AllSoft Desktop bằng 'Run as Administrator' để kiểm tra đầy đủ.".into(),
                });
            }
        }
    } else {
        items.push(DiagnosticItem {
            id: "bsod-ok".into(),
            category: "BSOD / Minidump".into(),
            severity: "ok".into(),
            code: "OK".into(),
            title: "Không có tệp BSOD Minidump".into(),
            detail: "Chưa phát sinh thư mục C:\\Windows\\Minidump (hệ thống chưa ghi nhận dump màn hình xanh).".into(),
            count: 0,
            last_seen: util::now_string(),
            recommendation: "Tình trạng ổn định.".into(),
        });
    }

    // 2b. Reliability Monitor (Win32_ReliabilityRecords, 7 ngày gần nhất)
    let script = r#"
$since = (Get-Date).AddDays(-7)
$recs = Get-CimInstance -ClassName Win32_ReliabilityRecords -ErrorAction SilentlyContinue |
  Where-Object { $_.TimeGenerated -ge $since -and ($_.SourceName -match 'Application Error|Windows Error Reporting|BugCheck|Kernel-Power|Microsoft-Windows-WER|Application Hang') } |
  Select-Object -First 150 SourceName, ProductName, EventIdentifier, TimeGenerated, Message
if ($recs) {
  $recs | ForEach-Object {
    $msg = if ($_.Message) { ($_.Message -replace '[\r\n\t]+', ' ').Trim() } else { '' }
    if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) }
    [PSCustomObject]@{
      Source  = $_.SourceName
      Product = $_.ProductName
      Id      = [int]$_.EventIdentifier
      Time    = if ($_.TimeGenerated) { $_.TimeGenerated.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
      Message = $msg
    }
  } | ConvertTo-Json -Depth 3 -Compress
}
"#;

    if let Ok(raw) = run_ps_stdout(script) {
        let rows = parse_ps_json_array(&raw);
        struct AggRel {
            source: String,
            product: String,
            event_id: i64,
            count: u32,
            last_seen: String,
            sample_msg: String,
        }
        let mut map: HashMap<(String, String), AggRel> = HashMap::new();
        for row in rows {
            let source = json_str(&row, "Source");
            let product = json_str(&row, "Product");
            let event_id = json_i64(&row, "Id");
            let time = json_str(&row, "Time");
            let msg = json_str(&row, "Message");
            let key = (source.to_lowercase(), product.to_lowercase());
            map.entry(key)
                .and_modify(|e| {
                    e.count = e.count.saturating_add(1);
                    if time > e.last_seen {
                        e.last_seen = time.clone();
                        if !msg.is_empty() {
                            e.sample_msg = msg.clone();
                        }
                    }
                })
                .or_insert(AggRel {
                    source,
                    product,
                    event_id,
                    count: 1,
                    last_seen: time,
                    sample_msg: msg,
                });
        }

        for (_, rel) in map {
            let s_low = rel.source.to_lowercase();
            let severity = if s_low.contains("bugcheck") || s_low.contains("kernel-power") {
                "critical"
            } else {
                "warning"
            };
            let target = if rel.product.is_empty() {
                rel.source.clone()
            } else {
                rel.product.clone()
            };
            items.push(DiagnosticItem {
                id: format!("rel-{}-{}", s_low.replace(' ', "-"), rel.event_id),
                category: "Reliability Monitor".into(),
                severity: severity.into(),
                code: format!("REL-{}", rel.event_id),
                title: format!("Sự cố độ ổn định: {target}"),
                detail: if rel.sample_msg.is_empty() {
                    format!("Nguồn: {} · Lặp lại {} lần trong 7 ngày qua.", rel.source, rel.count)
                } else {
                    truncate_chars(&rel.sample_msg, 200)
                },
                count: rel.count,
                last_seen: rel.last_seen,
                recommendation: "Kiểm tra bản cập nhật mới nhất của phần mềm hoặc Windows Update.".into(),
            });
        }
    }

    items
}

/// Bước 3: Kiểm tra sức khỏe ổ cứng (Win32_DiskDrive, S.M.A.R.T) & phân vùng trống < 15%.
fn scan_disk_health() -> Vec<DiagnosticItem> {
    let mut items = Vec::new();
    let now = util::now_string();

    // 3a. Win32_DiskDrive + MSStorageDriver_FailurePredictStatus
    let disk_script = r#"
$drives = Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | ForEach-Object {
  [PSCustomObject]@{
    Kind   = 'drive'
    Model  = $_.Model
    Status = $_.Status
    Size   = [uint64]$_.Size
  }
}
$smart = Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue | ForEach-Object {
  [PSCustomObject]@{
    Kind           = 'smart'
    InstanceName   = $_.InstanceName
    PredictFailure = [bool]$_.PredictFailure
    Reason         = [int]$_.Reason
  }
}
$vols = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | ForEach-Object {
  [PSCustomObject]@{
    Kind       = 'vol'
    DeviceID   = $_.DeviceID
    VolumeName = $_.VolumeName
    FreeSpace  = [uint64]$_.FreeSpace
    Size       = [uint64]$_.Size
  }
}
@($drives) + @($smart) + @($vols) | Where-Object { $_ -ne $null } | ConvertTo-Json -Depth 3 -Compress
"#;

    let mut any_disk_issue = false;
    let mut checked_vols = 0u32;

    if let Ok(raw) = run_ps_stdout(disk_script) {
        let rows = parse_ps_json_array(&raw);
        for row in rows {
            match json_str(&row, "Kind").as_str() {
                "drive" => {
                    let model = json_str(&row, "Model");
                    let status = json_str(&row, "Status");
                    if !status.is_empty() && !status.eq_ignore_ascii_case("OK") {
                        any_disk_issue = true;
                        items.push(DiagnosticItem {
                            id: format!("disk-status-{}", model.to_lowercase().replace(' ', "-")),
                            category: "Ổ cứng & S.M.A.R.T".into(),
                            severity: "critical".into(),
                            code: format!("DISK-{status}"),
                            title: format!("Trạng thái ổ cứng bất thường: {model}"),
                            detail: format!("Win32_DiskDrive báo Status = '{status}' (không phải OK)."),
                            count: 1,
                            last_seen: now.clone(),
                            recommendation: "SAO LƯU DỮ LIỆU NGAY! Kiểm tra sức khỏe ổ đĩa bằng công cụ hãng hoặc thay thế ổ cứng.".into(),
                        });
                    }
                }
                "smart" => {
                    if json_bool(&row, "PredictFailure") {
                        any_disk_issue = true;
                        let inst = json_str(&row, "InstanceName");
                        let reason = json_i64(&row, "Reason");
                        items.push(DiagnosticItem {
                            id: format!("smart-fail-{reason}"),
                            category: "Ổ cứng & S.M.A.R.T".into(),
                            severity: "critical".into(),
                            code: format!("SMART-{reason}"),
                            title: "Cảnh báo S.M.A.R.T: Ổ cứng có nguy cơ hỏng!".into(),
                            detail: format!("Thiết bị {inst} báo PredictFailure = True (Reason: {reason})."),
                            count: 1,
                            last_seen: now.clone(),
                            recommendation: "KHẨN CẤP: Sao lưu toàn bộ dữ liệu sang ổ khác và lên kế hoạch thay ổ cứng ngay lập tức.".into(),
                        });
                    }
                }
                "vol" => {
                    let dev = json_str(&row, "DeviceID");
                    let vol_name = json_str(&row, "VolumeName");
                    let free = json_u64(&row, "FreeSpace");
                    let total = json_u64(&row, "Size");
                    if total == 0 {
                        continue;
                    }
                    checked_vols += 1;
                    let free_pct = (free as f64 / total as f64) * 100.0;
                    let free_gb = free as f64 / (1024.0 * 1024.0 * 1024.0);
                    let total_gb = total as f64 / (1024.0 * 1024.0 * 1024.0);

                    if free_pct < 5.0 {
                        any_disk_issue = true;
                        items.push(DiagnosticItem {
                            id: format!("vol-low-{}", dev.replace(':', "")),
                            category: "Ổ cứng & S.M.A.R.T".into(),
                            severity: "critical".into(),
                            code: "DISK-FULL".into(),
                            title: format!("Phân vùng {dev} sắp hết dung lượng ({free_pct:.1}% trống)"),
                            detail: format!(
                                "Ổ {dev} ({vol_name}) chỉ còn trống {free_gb:.1} GB / {total_gb:.1} GB."
                            ),
                            count: 1,
                            last_seen: now.clone(),
                            recommendation: "Dùng tab Dọn rác hệ thống hoặc di chuyển dữ liệu lớn để giải phóng ít nhất 15% dung lượng trống.".into(),
                        });
                    } else if free_pct < 15.0 {
                        any_disk_issue = true;
                        items.push(DiagnosticItem {
                            id: format!("vol-warn-{}", dev.replace(':', "")),
                            category: "Ổ cứng & S.M.A.R.T".into(),
                            severity: "warning".into(),
                            code: "DISK-LOW".into(),
                            title: format!("Phân vùng {dev} dung lượng trống thấp ({free_pct:.1}%)"),
                            detail: format!(
                                "Ổ {dev} ({vol_name}) còn trống {free_gb:.1} GB / {total_gb:.1} GB (< 15%)."
                            ),
                            count: 1,
                            last_seen: now.clone(),
                            recommendation: "Nên dọn tệp tạm/thùng rác bằng tab Dọn rác hệ thống để giữ máy chạy mượt.".into(),
                        });
                    }
                }
                _ => {}
            }
        }
    }

    if !any_disk_issue {
        items.push(DiagnosticItem {
            id: "disk-ok".into(),
            category: "Ổ cứng & S.M.A.R.T".into(),
            severity: "ok".into(),
            code: "OK".into(),
            title: "Ổ cứng & dung lượng các phân vùng đều khỏe mạnh".into(),
            detail: format!("Đã kiểm tra {checked_vols} phân vùng cố định: trạng thái OK, S.M.A.R.T bình thường, dung lượng trống ≥ 15%."),
            count: 0,
            last_seen: now,
            recommendation: "Không cần hành động.".into(),
        });
    }

    items
}

/// Bước 4: Kiểm tra Driver lỗi (`Win32_PnPEntity` có `ConfigManagerErrorCode != 0`).
fn scan_broken_drivers() -> Vec<DiagnosticItem> {
    let script = r#"
$devs = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
  Where-Object { $_.ConfigManagerErrorCode -ne $null -and $_.ConfigManagerErrorCode -ne 0 } |
  Select-Object Name, DeviceID, ConfigManagerErrorCode
if ($devs) {
  $devs | ForEach-Object {
    [PSCustomObject]@{
      Name     = $_.Name
      DeviceID = $_.DeviceID
      Code     = [int]$_.ConfigManagerErrorCode
    }
  } | ConvertTo-Json -Depth 3 -Compress
}
"#;
    let now = util::now_string();
    let Ok(raw) = run_ps_stdout(script) else {
        return Vec::new();
    };
    let rows = parse_ps_json_array(&raw);
    if rows.is_empty() {
        return vec![DiagnosticItem {
            id: "drv-ok".into(),
            category: "Driver thiết bị".into(),
            severity: "ok".into(),
            code: "OK".into(),
            title: "Tất cả Driver thiết bị đang hoạt động bình thường".into(),
            detail: "Không phát hiện thiết bị phần cứng nào báo mã lỗi trong Device Manager.".into(),
            count: 0,
            last_seen: now,
            recommendation: "Driver hệ thống ổn định.".into(),
        }];
    }

    let mut items = Vec::new();
    for (idx, row) in rows.iter().enumerate() {
        let name = json_str(row, "Name");
        let dev_id = json_str(row, "DeviceID");
        let code = json_i64(row, "Code");
        let display_name = if name.is_empty() { dev_id.clone() } else { name };
        let (severity, desc, rec) = match code {
            22 => (
                "warning",
                "Thiết bị đang bị vô hiệu hóa (Code 22).",
                "Nếu cần sử dụng thiết bị này, hãy bật lại (Enable) trong Device Manager.",
            ),
            28 => (
                "warning",
                "Chưa cài đặt Driver cho thiết bị (Code 28).",
                "Chạy Windows Update hoặc tải driver chính hãng từ nhà sản xuất máy tính.",
            ),
            10 | 43 => (
                "critical",
                "Thiết bị không thể khởi động hoặc báo lỗi phần cứng/driver (Code 10/43).",
                "Cài đặt lại driver mới nhất; nếu vẫn lỗi hãy kiểm tra kết nối vật lý hoặc phần cứng.",
            ),
            _ => (
                "warning",
                "Thiết bị báo mã lỗi trong Device Manager.",
                "Mở Device Manager kiểm tra thuộc tính thiết bị và cập nhật lại driver.",
            ),
        };
        items.push(DiagnosticItem {
            id: format!("drv-err-{idx}-{code}"),
            category: "Driver thiết bị".into(),
            severity: severity.into(),
            code: format!("CM-{code}"),
            title: format!("Driver lỗi (Code {code}): {display_name}"),
            detail: format!("{desc} DeviceID: {dev_id}"),
            count: 1,
            last_seen: now.clone(),
            recommendation: rec.into(),
        });
    }
    items
}

/// Bước 5: Sinh báo cáo Markdown sạch gọn để người dùng copy dán thẳng cho AI chẩn đoán.
fn build_ai_markdown(
    specs: &SystemSpecs,
    scanned_at: &str,
    is_admin: bool,
    cancelled: bool,
    summary: &DiagnosticsSummary,
    items: &[DiagnosticItem],
) -> String {
    let mut md = String::new();
    md.push_str("# Báo cáo Chẩn đoán Hệ thống (AllSoft Desktop)\n\n");
    md.push_str(&format!("- **Thời điểm quét:** {scanned_at}\n"));
    md.push_str(&format!(
        "- **Quyền thực thi:** {}\n",
        if is_admin { "Administrator" } else { "Người dùng thường (chưa có quyền Admin)" }
    ));
    if cancelled {
        md.push_str("- **Trạng thái:** Đã hủy giữa chừng (kết quả chưa đầy đủ)\n");
    }
    md.push_str(&format!(
        "- **Tổng quan:** 🔴 {} Nghiêm trọng | 🟡 {} Cảnh báo | 🟢 {} Ổn định\n\n",
        summary.critical, summary.warning, summary.ok
    ));

    md.push_str("## Thông tin máy trạm\n");
    md.push_str("| Thông số | Giá trị |\n|---|---|\n");
    md.push_str(&format!("| Tên máy (Hostname) | `{}` |\n", specs.hostname));
    md.push_str(&format!("| Hệ điều hành | {} |\n", specs.os_caption));
    md.push_str(&format!("| CPU | {} ({} luồng) |\n", specs.cpu_name, specs.cpu_threads));
    md.push_str(&format!(
        "| RAM | {:.1} / {:.1} GB ({}%) |\n",
        specs.ram_used_gb, specs.ram_total_gb, specs.ram_percent
    ));
    md.push_str(&format!(
        "| Ổ hệ thống (C:) | Trống {:.1} / {:.1} GB (đã dùng {}%) |\n\n",
        specs.disk_free_gb, specs.disk_total_gb, specs.disk_percent
    ));

    let sections = [
        ("critical", "## 🔴 Lỗi Nghiêm trọng (Critical)"),
        ("warning", "## 🟡 Cảnh báo (Warning)"),
        ("ok", "## 🟢 Trạng thái Ổn định (OK)"),
    ];

    for (sev, heading) in sections {
        let group: Vec<&DiagnosticItem> = items.iter().filter(|i| i.severity == sev).collect();
        if group.is_empty() {
            continue;
        }
        md.push_str(heading);
        md.push('\n');
        md.push_str("| Nhóm | Mã | Sự cố | Số lần | Lần cuối | Chi tiết |\n");
        md.push_str("|---|---|---|---:|---|---|\n");
        for it in group {
            let clean_title = it.title.replace('|', "/");
            let clean_detail = truncate_chars(&it.detail, 140).replace('|', "/");
            md.push_str(&format!(
                "| {} | `{}` | {} | {} | {} | {} |\n",
                it.category, it.code, clean_title, it.count, it.last_seen, clean_detail
            ));
        }
        md.push('\n');
    }

    md.push_str("---\n");
    md.push_str("*Gợi ý câu hỏi cho AI: Dựa vào báo cáo trên, hãy phân tích nguyên nhân gốc rễ các lỗi Critical/Warning và hướng dẫn các bước khắc phục an toàn theo thứ tự ưu tiên.*\n");
    md
}

fn severity_rank(sev: &str) -> u8 {
    match sev {
        "critical" => 0,
        "warning" => 1,
        _ => 2,
    }
}

pub fn run_diagnostics(app: &AppHandle, cancel: &Arc<AtomicBool>, is_admin: bool) -> DiagnosticsReport {
    let scanned_at = util::now_string();
    let mut items: Vec<DiagnosticItem> = Vec::new();
    let mut cancelled = false;

    // Bước 1: Event Viewer
    if cancel.load(Ordering::SeqCst) {
        cancelled = true;
    } else {
        emit_tool_progress(app, "diagnostics", "Event Viewer", 1, 5, 10, "Đang quét Event Viewer 7 ngày gần nhất…");
        items.extend(scan_event_viewer());
    }

    // Bước 2: Reliability Monitor & BSOD Minidump
    if !cancelled && cancel.load(Ordering::SeqCst) {
        cancelled = true;
    } else if !cancelled {
        emit_tool_progress(app, "diagnostics", "BSOD & Reliability", 2, 5, 35, "Đang kiểm tra Minidump BSOD & Reliability Monitor…");
        items.extend(scan_reliability_and_bsod(is_admin));
    }

    // Bước 3: Ổ cứng & S.M.A.R.T
    if !cancelled && cancel.load(Ordering::SeqCst) {
        cancelled = true;
    } else if !cancelled {
        emit_tool_progress(app, "diagnostics", "Ổ cứng & S.M.A.R.T", 3, 5, 60, "Đang kiểm tra sức khỏe ổ cứng và dung lượng trống…");
        items.extend(scan_disk_health());
    }

    // Bước 4: Driver lỗi
    if !cancelled && cancel.load(Ordering::SeqCst) {
        cancelled = true;
    } else if !cancelled {
        emit_tool_progress(app, "diagnostics", "Driver thiết bị", 4, 5, 80, "Đang kiểm tra thiết bị và Driver lỗi…");
        items.extend(scan_broken_drivers());
    }

    // Bước 5: Tổng hợp & sinh Markdown cho AI
    emit_tool_progress(app, "diagnostics", "Tổng hợp báo cáo", 5, 5, 95, "Đang tổng hợp báo cáo Markdown cho AI…");

    items.sort_by(|a, b| {
        severity_rank(&a.severity)
            .cmp(&severity_rank(&b.severity))
            .then_with(|| b.count.cmp(&a.count))
    });

    let summary = DiagnosticsSummary {
        critical: items.iter().filter(|i| i.severity == "critical").count(),
        warning: items.iter().filter(|i| i.severity == "warning").count(),
        ok: items.iter().filter(|i| i.severity == "ok").count(),
    };

    let specs = collect_system_specs();
    let ai_markdown = build_ai_markdown(&specs, &scanned_at, is_admin, cancelled, &summary, &items);

    emit_tool_progress(
        app,
        "diagnostics",
        if cancelled { "Đã hủy" } else { "Hoàn tất" },
        5,
        5,
        100,
        if cancelled { "Quá trình chẩn đoán đã được dừng theo yêu cầu." } else { "Đã hoàn tất chẩn đoán hệ thống." },
    );

    DiagnosticsReport {
        scanned_at,
        is_admin,
        cancelled,
        summary,
        items,
        ai_markdown,
    }
}

/// Mở công cụ kiểm tra RAM gốc của Windows (`mdsched.exe`).
pub fn launch_memory_diagnostic() -> Result<(), String> {
    Command::new("mdsched.exe")
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Không thể mở Windows Memory Diagnostic (mdsched.exe): {e}"))
}
