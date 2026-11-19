//! Phát hiện phần mềm đã cài: Registry Uninstall keys + winget list/upgrade + cấu hình máy trạm.
use crate::catalog::{App, Catalog};
use crate::winget;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::net::UdpSocket;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Debug, Clone, Default)]
pub struct RegEntry {
    pub name: String,
    pub version: String,
    pub uninstall: String,
    pub quiet: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppState {
    pub id: String,
    /// "installed" | "update" | "missing"
    pub status: String,
    pub installed_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemSpecs {
    pub hostname: String,
    pub ip_address: String,
    pub os_caption: String,
    pub cpu_name: String,
    pub cpu_threads: u32,
    pub ram_used_gb: f64,
    pub ram_total_gb: f64,
    pub ram_percent: u32,
    pub disk_free_gb: f64,
    pub disk_total_gb: f64,
    pub disk_percent: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledProgram {
    pub name: String,
    pub version: String,
    pub publisher: String,
    pub install_date: String,
    pub install_location: String,
    pub uninstall_string: String,
    pub quiet_uninstall_string: String,
    pub estimated_size_mb: f64,
    pub catalog_app_id: Option<String>,
}

const UNINSTALL: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
const UNINSTALL_32: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

pub fn read_registry() -> Vec<RegEntry> {
    let mut list = Vec::new();
    for (hive, path) in [
        (HKEY_LOCAL_MACHINE, UNINSTALL),
        (HKEY_LOCAL_MACHINE, UNINSTALL_32),
        (HKEY_CURRENT_USER, UNINSTALL),
    ] {
        let Ok(root) = RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else { continue };
        for sub in root.enum_keys().flatten() {
            let Ok(k) = root.open_subkey_with_flags(&sub, KEY_READ) else { continue };
            let Ok(name) = k.get_value::<String, _>("DisplayName") else { continue };
            list.push(RegEntry {
                name,
                version: k.get_value("DisplayVersion").unwrap_or_default(),
                uninstall: k.get_value("UninstallString").unwrap_or_default(),
                quiet: k.get_value("QuietUninstallString").unwrap_or_default(),
            });
        }
    }
    list
}

pub fn find_entry<'a>(app: &App, entries: &'a [RegEntry]) -> Option<&'a RegEntry> {
    let wanted: Vec<String> = app.detect.display_names.iter().map(|s| s.to_lowercase()).collect();
    if wanted.is_empty() {
        return None;
    }
    entries.iter().find(|e| {
        let n = e.name.to_lowercase();
        wanted.iter().any(|w| n.contains(w))
    })
}

fn registry_key_exists(path: &str) -> bool {
    let (hive_name, rest) = path.split_once('\\').unwrap_or((path, ""));
    let hive = match hive_name.to_uppercase().as_str() {
        "HKLM" | "HKEY_LOCAL_MACHINE" => HKEY_LOCAL_MACHINE,
        "HKCU" | "HKEY_CURRENT_USER" => HKEY_CURRENT_USER,
        _ => return false,
    };
    RegKey::predef(hive).open_subkey_with_flags(rest, KEY_READ).is_ok()
}

fn expand_env(p: &str) -> String {
    let mut out = p.to_string();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "APPDATA", "ProgramData", "SystemRoot"] {
        if let Ok(v) = std::env::var(var) {
            out = out.replace(&format!("%{var}%"), &v);
        }
    }
    out
}

/// So sánh phiên bản dạng "1.2.3" (bỏ tiền tố v, phần không phải số coi là 0).
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let parse = |s: &str| -> Vec<u64> {
        s.trim().trim_start_matches(['v', 'V']).split(['.', '-', '+'])
            .map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0))
            .collect()
    };
    let (mut x, mut y) = (parse(a), parse(b));
    let n = x.len().max(y.len());
    x.resize(n, 0);
    y.resize(n, 0);
    x.cmp(&y)
}

pub fn detect_one(app: &App, entries: &[RegEntry], winget_list: &str, winget_upgrade: &str) -> AppState {
    let entry = find_entry(app, entries);
    let by_other = app.detect.registry_keys.iter().any(|k| registry_key_exists(k))
        || app.detect.install_paths.iter().any(|p| std::path::Path::new(&expand_env(p)).exists());
    let winget_id = app.winget.as_ref().map(|w| w.id.as_str());
    let by_winget = winget_id.is_some_and(|id| winget::output_has_id(winget_list, id));

    let installed = entry.is_some() || by_other || by_winget;
    let version = entry.map(|e| e.version.clone()).filter(|v| !v.is_empty());
    let mut status = if installed { "installed" } else { "missing" };
    if installed {
        let wg_update = winget_id.is_some_and(|id| winget::output_has_id(winget_upgrade, id));
        let pinned_update = app.version != "latest"
            && !app.version.is_empty()
            && version.as_deref().is_some_and(|v| compare_versions(v, &app.version) == Ordering::Less);
        if wg_update || pinned_update {
            status = "update";
        }
    }
    AppState { id: app.id.clone(), status: status.into(), installed_version: version }
}

pub fn detect_all(apps: &[App]) -> Vec<AppState> {
    let entries = read_registry();
    let (list, upgrade) = if winget::is_available() {
        (winget::query("list"), winget::query("upgrade"))
    } else {
        (String::new(), String::new())
    };
    apps.iter().map(|a| detect_one(a, &entries, &list, &upgrade)).collect()
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

pub fn collect_system_specs() -> SystemSpecs {
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "WORKSTATION".into());

    let ip_address = UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("8.8.8.8:80")?;
            s.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".into());

    let cpu_name = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(r"HARDWARE\Description\System\CentralProcessor\0", KEY_READ)
        .and_then(|k| k.get_value::<String, _>("ProcessorNameString"))
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "Unknown Processor".into());

    let cpu_threads = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);

    let os_caption = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", KEY_READ)
        .map(|k| {
            let mut product: String = k.get_value("ProductName").unwrap_or_else(|_| "Windows".into());
            let build: u32 = k
                .get_value::<String, _>("CurrentBuildNumber")
                .ok()
                .and_then(|b| b.parse().ok())
                .unwrap_or(0);
            if build >= 22000 && product.contains("Windows 10") {
                product = product.replace("Windows 10", "Windows 11");
            }
            let display_ver: String = k
                .get_value("DisplayVersion")
                .or_else(|_| k.get_value("ReleaseId"))
                .unwrap_or_default();
            if display_ver.is_empty() {
                product
            } else {
                format!("{product} ({display_ver})")
            }
        })
        .unwrap_or_else(|_| "Windows Workstation".into());

    let mut ram_total_gb = 16.0;
    let mut ram_used_gb = 6.4;
    let mut ram_percent = 40u32;
    let mut disk_free_gb = 120.0;
    let mut disk_total_gb = 256.0;
    let mut disk_percent = 53u32;

    let ps_script = "$os = Get-CimInstance Win32_OperatingSystem; $d = Get-PSDrive C; \"$($os.TotalVisibleMemorySize)|$($os.FreePhysicalMemory)|$($d.Used)|$($d.Free)\"";
    if let Ok((0, out)) = crate::util::run_capture(
        "powershell",
        &["-NoProfile".into(), "-NonInteractive".into(), "-Command".into(), ps_script.into()],
    ) {
        let line = out.lines().rev().find(|l| l.contains('|')).unwrap_or("").trim();
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 4 {
            let total_kb: u64 = parts[0].trim().parse().unwrap_or(0);
            let free_kb: u64 = parts[1].trim().parse().unwrap_or(0);
            let used_bytes: u64 = parts[2].trim().parse().unwrap_or(0);
            let free_bytes: u64 = parts[3].trim().parse().unwrap_or(0);

            if total_kb > 0 {
                let used_kb = total_kb.saturating_sub(free_kb);
                ram_total_gb = round1(total_kb as f64 / (1024.0 * 1024.0));
                ram_used_gb = round1(used_kb as f64 / (1024.0 * 1024.0));
                ram_percent = ((used_kb as f64 / total_kb as f64) * 100.0).round() as u32;
            }
            let total_bytes = used_bytes.saturating_add(free_bytes);
            if total_bytes > 0 {
                disk_free_gb = round1(free_bytes as f64 / (1024.0 * 1024.0 * 1024.0));
                disk_total_gb = round1(total_bytes as f64 / (1024.0 * 1024.0 * 1024.0));
                disk_percent = ((used_bytes as f64 / total_bytes as f64) * 100.0).round() as u32;
            }
        }
    }

    SystemSpecs {
        hostname,
        ip_address,
        os_caption,
        cpu_name,
        cpu_threads,
        ram_used_gb,
        ram_total_gb,
        ram_percent,
        disk_free_gb,
        disk_total_gb,
        disk_percent,
    }
}

fn match_catalog_app(program_name: &str, catalog: &Catalog) -> Option<String> {
    let lower = program_name.to_lowercase();
    for app in &catalog.apps {
        if app
            .detect
            .display_names
            .iter()
            .any(|d| !d.trim().is_empty() && lower.contains(&d.to_lowercase()))
        {
            return Some(app.id.clone());
        }
    }
    None
}

pub fn list_all_installed_programs(catalog: &Catalog) -> Vec<InstalledProgram> {
    let mut programs = Vec::new();
    let mut seen = HashSet::new();

    for (hive, path) in [
        (HKEY_LOCAL_MACHINE, UNINSTALL),
        (HKEY_LOCAL_MACHINE, UNINSTALL_32),
        (HKEY_CURRENT_USER, UNINSTALL),
    ] {
        let Ok(root) = RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else { continue };
        for sub in root.enum_keys().flatten() {
            let Ok(k) = root.open_subkey_with_flags(&sub, KEY_READ) else { continue };
            if k.get_value::<u32, _>("SystemComponent").unwrap_or(0) == 1 {
                continue;
            }
            let Ok(raw_name) = k.get_value::<String, _>("DisplayName") else { continue };
            let name = raw_name.trim().to_string();
            if name.is_empty() {
                continue;
            }
            let version = k.get_value::<String, _>("DisplayVersion").unwrap_or_default().trim().to_string();
            let dedup_key = format!("{}|{}", name.to_lowercase(), version.to_lowercase());
            if !seen.insert(dedup_key) {
                continue;
            }
            let publisher = k.get_value::<String, _>("Publisher").unwrap_or_default().trim().to_string();
            let install_date = k.get_value::<String, _>("InstallDate").unwrap_or_default().trim().to_string();
            let install_location = k
                .get_value::<String, _>("InstallLocation")
                .unwrap_or_default()
                .trim()
                .trim_matches('"')
                .to_string();
            let uninstall_string = k.get_value::<String, _>("UninstallString").unwrap_or_default().trim().to_string();
            let quiet_uninstall_string = k
                .get_value::<String, _>("QuietUninstallString")
                .unwrap_or_default()
                .trim()
                .to_string();
            let size_kb = k.get_value::<u32, _>("EstimatedSize").unwrap_or(0);
            let estimated_size_mb = round1(size_kb as f64 / 1024.0);
            let catalog_app_id = match_catalog_app(&name, catalog);

            programs.push(InstalledProgram {
                name,
                version,
                publisher,
                install_date,
                install_location,
                uninstall_string,
                quiet_uninstall_string,
                estimated_size_mb,
                catalog_app_id,
            });
        }
    }

    programs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    programs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::parse_catalog;

    #[test]
    fn version_compare() {
        assert_eq!(compare_versions("1.0.0", "1.0.0"), Ordering::Equal);
        assert_eq!(compare_versions("1.2", "1.10"), Ordering::Less);
        assert_eq!(compare_versions("v2.0.1", "2.0"), Ordering::Greater);
        assert_eq!(compare_versions("1.0", "1.0.0"), Ordering::Equal);
    }

    #[test]
    fn match_registry_names() {
        let cat = parse_catalog(include_str!("../../../catalog/apps.json")).unwrap();
        let app = cat.apps.iter().find(|a| a.id == "vnegp-agent").unwrap();
        let entries = vec![
            RegEntry { name: "Foo".into(), ..Default::default() },
            RegEntry { name: "VNeGP Client Agent 2.0.1".into(), version: "2.0.1".into(), ..Default::default() },
        ];
        assert_eq!(find_entry(app, &entries).unwrap().version, "2.0.1");
        let st = detect_one(app, &entries, "", "");
        assert_eq!(st.status, "installed");
        let old = vec![RegEntry { name: "VNeGP Client Agent".into(), version: "1.0".into(), ..Default::default() }];
        assert_eq!(detect_one(app, &old, "", "").status, "update");
        assert_eq!(detect_one(app, &[], "", "").status, "missing");
    }
}
