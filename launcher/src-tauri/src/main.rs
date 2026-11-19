// Ẩn cửa sổ console ở bản release trên Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod catalog;
mod cleaner;
mod deps;
mod detect;
mod diagnostics;
mod direct;
mod offline;
mod printer;
mod report;
mod uninstaller;
mod updater;
mod util;
mod winget;

use catalog::{App, Catalog};
use report::ReportEntry;
use serde::Serialize;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use util::InstallOutcome;

pub struct CancelState(pub Arc<AtomicBool>);

#[derive(Debug, Clone, Serialize)]
pub struct ToolProgress {
    pub module: String, // "diagnostics" | "cleaner" | "uninstaller" | "printer"
    pub step: String,
    pub current: u32,
    pub total: u32,
    pub percent: u32,
    pub detail: String,
}

pub fn emit_tool_progress(
    app: &AppHandle,
    module: &str,
    step: &str,
    current: u32,
    total: u32,
    percent: u32,
    detail: &str,
) {
    let _ = app.emit(
        "tool-progress",
        ToolProgress {
            module: module.to_string(),
            step: step.to_string(),
            current,
            total,
            percent: percent.min(100),
            detail: detail.to_string(),
        },
    );
}

fn is_elevated_admin() -> bool {
    util::cmd("net")
        .arg("session")
        .stdin(Stdio::null())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[derive(Default)]
struct AppData {
    catalog: Mutex<Option<Catalog>>,
    log: Mutex<Vec<ReportEntry>>,
}

#[derive(Serialize, Clone)]
struct Progress {
    id: String,
    /// running | done | error | skipped
    stage: String,
    message: String,
    percent: Option<f64>,
    index: usize,
    total: usize,
}

#[derive(Serialize)]
struct CatalogPayload {
    catalog: Catalog,
    origin: String,
}

#[derive(Serialize)]
struct CliArgs {
    profile: Option<String>,
    auto: bool,
}

fn emit(app: &AppHandle, id: &str, stage: &str, msg: &str, percent: Option<f64>, index: usize, total: usize) {
    let _ = app.emit(
        "progress",
        Progress { id: id.into(), stage: stage.into(), message: msg.into(), percent, index, total },
    );
}

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("AllSoftDesktop"))
}

fn current_catalog(state: &AppData) -> Result<Catalog, String> {
    state.catalog.lock().unwrap().clone().ok_or_else(|| "Catalog chưa được tải".to_string())
}

fn record(state: &AppData, app: &App, action: &str, source: &str, res: &Result<InstallOutcome, String>) {
    let (success, message) = match res {
        Ok(o) => (true, if o.note.is_empty() { "OK".to_string() } else { o.note.clone() }),
        Err(e) => (false, e.clone()),
    };
    state.log.lock().unwrap().push(ReportEntry {
        time: util::now_string(),
        id: app.id.clone(),
        name: app.name.clone(),
        action: action.into(),
        source: source.into(),
        success,
        message,
    });
}

/// Thứ tự nguồn: packages/ -> winget -> download_url. Trả (nguồn đã dùng, kết quả).
fn install_one(
    handle: &AppHandle,
    app: &App,
    files: &[PathBuf],
    upgrade: bool,
    idx: usize,
    total: usize,
) -> (&'static str, Result<InstallOutcome, String>) {
    let id = app.id.as_str();
    // 1. Offline
    if let Some(pkg) = offline::find_package(files, app) {
        emit(handle, id, "running", "Cài từ thư mục packages…", None, idx, total);
        let args = offline::silent_args(app, pkg);
        let kind = pkg.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
        match direct::run_installer(pkg, &kind, &args) {
            Ok(o) => return ("packages", Ok(o)),
            Err(e) => emit(handle, id, "running", &format!("Gói offline lỗi ({e}), thử nguồn khác…"), None, idx, total),
        }
    }
    // 2. winget
    let mut winget_err = None;
    if let Some(w) = &app.winget {
        emit(handle, id, "running", "Đang cài bằng winget…", None, idx, total);
        let action = if upgrade { winget::Action::Upgrade } else { winget::Action::Install };
        match winget::run(action, &w.id, w.scope.as_deref()) {
            Ok(o) => return ("winget", Ok(o)),
            Err(e) => winget_err = Some(e),
        }
    }
    // 3. download_url
    if let Some(d) = &app.direct {
        if let Some(e) = &winget_err {
            emit(handle, id, "running", &format!("{e}. Chuyển sang tải trực tiếp…"), None, idx, total);
        } else {
            emit(handle, id, "running", "Đang tải trình cài đặt…", Some(0.0), idx, total);
        }
        let tmp = std::env::temp_dir().join("AllSoftDesktop");
        let h = handle.clone();
        let mut last = -10.0;
        let res = direct::install_direct(d, &tmp, &mut |p| {
            if p - last >= 2.0 {
                last = p;
                emit(&h, id, "running", &format!("Đang tải… {p:.0}%"), Some(p), idx, total);
            }
        });
        return ("direct", res);
    }
    ("-", Err(winget_err.unwrap_or_else(|| "Không có nguồn cài đặt phù hợp".into())))
}

#[tauri::command]
async fn get_catalog(handle: AppHandle, state: State<'_, AppData>) -> Result<CatalogPayload, String> {
    let dir = data_dir(&handle);
    let (cat, origin) = tauri::async_runtime::spawn_blocking(move || catalog::load(&dir))
        .await
        .map_err(|e| e.to_string())?;
    *state.catalog.lock().unwrap() = Some(cat.clone());
    Ok(CatalogPayload { catalog: cat, origin: origin.to_string() })
}

#[tauri::command]
async fn detect_states(state: State<'_, AppData>) -> Result<Vec<detect::AppState>, String> {
    let apps = current_catalog(&state)?.apps;
    tauri::async_runtime::spawn_blocking(move || detect::detect_all(&apps))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_system_specs() -> Result<detect::SystemSpecs, String> {
    tauri::async_runtime::spawn_blocking(detect::collect_system_specs)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_installed_programs(
    handle: AppHandle,
    state: State<'_, AppData>,
) -> Result<Vec<detect::InstalledProgram>, String> {
    let cat = match current_catalog(&state) {
        Ok(c) => c,
        Err(_) => {
            let dir = data_dir(&handle);
            let (loaded, _) = catalog::load(&dir);
            *state.catalog.lock().unwrap() = Some(loaded.clone());
            loaded
        }
    };
    tauri::async_runtime::spawn_blocking(move || detect::list_all_installed_programs(&cat))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn uninstall_program(uninstall_cmd: String) -> Result<(), String> {
    let raw = uninstall_cmd.trim().to_string();
    if raw.is_empty() {
        return Err("Lệnh gỡ cài đặt trống".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
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
        let code = util::run_cmdline(&cmdline)?;
        match direct::is_success_code(code) {
            Some(_) => Ok(()),
            None if code == 0 => Ok(()),
            None => Err(format!("Lệnh gỡ trả mã lỗi {code}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_apps(
    handle: AppHandle,
    state: State<'_, AppData>,
    ids: Vec<String>,
    packages_dir: Option<String>,
    upgrade: bool,
) -> Result<usize, String> {
    let cat = current_catalog(&state)?;
    let order = deps::resolve_order(&cat.apps, &ids)?;
    let pkg_dir = packages_dir.map(PathBuf::from).unwrap_or_else(offline::default_dir);
    let h = handle.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let data = h.state::<AppData>();
        let files = offline::scan(&pkg_dir);
        let registry = detect::read_registry();
        let total = order.len();
        let mut failed = 0usize;
        for (i, id) in order.iter().enumerate() {
            let Some(app) = cat.apps.iter().find(|a| &a.id == id) else { continue };
            let requested = ids.contains(id);
            // Dependency chưa được yêu cầu: bỏ qua nếu đã thoả.
            if !requested {
                let ok = deps::builtin_check(id)
                    .unwrap_or_else(|| detect::find_entry(app, &registry).is_some());
                if ok {
                    emit(&h, id, "skipped", "Dependency đã có sẵn", None, i, total);
                    continue;
                }
            }
            emit(&h, id, "running", "Bắt đầu…", None, i, total);
            let (source, res) = install_one(&h, app, &files, upgrade && requested, i, total);
            let action = if upgrade { "upgrade" } else { "install" };
            record(&data, app, action, source, &res);
            match res {
                Ok(o) => emit(&h, id, "done", if o.reboot { "Xong (cần khởi động lại)" } else { "Hoàn tất" }, Some(100.0), i, total),
                Err(e) => {
                    failed += 1;
                    emit(&h, id, "error", &e, None, i, total);
                    // Dependency lỗi thì các app phụ thuộc có thể hỏng, nhưng vẫn tiếp tục để báo cáo đầy đủ.
                }
            }
        }
        failed
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn uninstall_app(handle: AppHandle, state: State<'_, AppData>, id: String) -> Result<(), String> {
    let cat = current_catalog(&state)?;
    let app = cat.apps.iter().find(|a| a.id == id).cloned().ok_or("Không có ứng dụng trong catalog")?;
    let h = handle.clone();
    let a2 = app.clone();
    emit(&handle, &id, "running", "Đang gỡ…", None, 0, 1);
    let res = tauri::async_runtime::spawn_blocking(move || {
        let app = a2;
        let try_registry = || -> Result<InstallOutcome, String> {
            let entries = detect::read_registry();
            let e = detect::find_entry(&app, &entries).ok_or("Không tìm thấy mục gỡ cài đặt trong Registry")?;
            direct::uninstall_registry(e, &app.uninstall.args)
        };
        let r = match app.uninstall.mode.as_str() {
            "winget" => match &app.winget {
                Some(w) => winget::run(winget::Action::Uninstall, &w.id, None).or_else(|e| try_registry().map_err(|_| e)),
                None => try_registry(),
            },
            "registry" => try_registry(),
            _ => Err("Phần mềm này không hỗ trợ gỡ từ Launcher".into()),
        };
        let source = if app.uninstall.mode == "winget" { "winget" } else { "registry" };
        record(&h.state::<AppData>(), &app, "uninstall", source, &r);
        r
    })
    .await
    .map_err(|e| e.to_string())?;
    match res {
        Ok(_) => {
            emit(&handle, &id, "done", "Đã gỡ", Some(100.0), 0, 1);
            Ok(())
        }
        Err(e) => {
            emit(&handle, &id, "error", &e, None, 0, 1);
            Err(e)
        }
    }
}

#[tauri::command]
fn default_packages_dir() -> String {
    offline::default_dir().to_string_lossy().to_string()
}

/// Trả id các app có gói offline trong thư mục.
#[tauri::command]
fn scan_packages(state: State<'_, AppData>, dir: String) -> Result<Vec<String>, String> {
    let cat = current_catalog(&state)?;
    let files = offline::scan(&PathBuf::from(dir));
    Ok(offline::available_ids(&files, &cat.apps))
}

#[tauri::command]
fn export_report(handle: AppHandle, state: State<'_, AppData>) -> Result<String, String> {
    let entries = state.log.lock().unwrap().clone();
    if entries.is_empty() {
        return Err("Chưa có thao tác nào để báo cáo".into());
    }
    let path = report::write_reports(&data_dir(&handle).join("reports"), &entries)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    util::cmd("explorer").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn cli_args() -> CliArgs {
    let args: Vec<String> = std::env::args().collect();
    let profile = args
        .iter()
        .position(|a| a == "--profile")
        .and_then(|i| args.get(i + 1).cloned())
        .or_else(|| args.iter().find_map(|a| a.strip_prefix("--profile=").map(String::from)));
    CliArgs { profile, auto: args.iter().any(|a| a == "--auto") }
}

#[tauri::command]
async fn check_update(state: State<'_, AppData>) -> Result<updater::UpdateInfo, String> {
    let repo = current_catalog(&state)?.repo;
    let current = env!("CARGO_PKG_VERSION").to_string();
    tauri::async_runtime::spawn_blocking(move || updater::check(&repo, &current))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn apply_update(handle: AppHandle, state: State<'_, AppData>) -> Result<(), String> {
    let url = current_catalog(&state)?.launcher.downloads.windows;
    let h = handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        updater::download_and_run(&url, &mut |p| emit(&h, "launcher", "running", &format!("Đang tải bản cập nhật… {p:.0}%"), Some(p), 0, 1))
    })
    .await
    .map_err(|e| e.to_string())??;
    handle.exit(0);
    Ok(())
}

#[tauri::command]
fn check_admin() -> bool {
    is_elevated_admin()
}

#[tauri::command]
fn cancel_active_task(state: State<'_, CancelState>) {
    state.0.store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn run_diagnostics(
    handle: AppHandle,
    cancel: State<'_, CancelState>,
) -> Result<diagnostics::DiagnosticsReport, String> {
    let flag = cancel.0.clone();
    flag.store(false, Ordering::SeqCst);
    let h = handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let admin = is_elevated_admin();
        diagnostics::run_diagnostics(&h, &flag, admin)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn launch_memory_diagnostic() -> Result<(), String> {
    diagnostics::launch_memory_diagnostic()
}

#[tauri::command]
async fn scan_cleaner_targets(
    handle: AppHandle,
    cancel: State<'_, CancelState>,
    target_ids: Vec<String>,
) -> Result<Vec<cleaner::CleanerScanResult>, String> {
    let flag = cancel.0.clone();
    flag.store(false, Ordering::SeqCst);
    let h = handle.clone();
    tauri::async_runtime::spawn_blocking(move || cleaner::scan_targets(&h, &flag, &target_ids))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_cleaner(
    handle: AppHandle,
    cancel: State<'_, CancelState>,
    target_ids: Vec<String>,
) -> Result<cleaner::CleanerRunResult, String> {
    let flag = cancel.0.clone();
    flag.store(false, Ordering::SeqCst);
    let h = handle.clone();
    tauri::async_runtime::spawn_blocking(move || cleaner::run_clean(&h, &flag, &target_ids))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_native_uninstaller(uninstall_cmd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || uninstaller::run_native_uninstaller(uninstall_cmd))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_leftovers(
    handle: AppHandle,
    cancel: State<'_, CancelState>,
    app_name: String,
    publisher: String,
    install_location: String,
) -> Result<Vec<uninstaller::LeftoverItem>, String> {
    let flag = cancel.0.clone();
    flag.store(false, Ordering::SeqCst);
    let h = handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        uninstaller::scan_leftovers(&h, &flag, app_name, publisher, install_location)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_leftovers(
    handle: AppHandle,
    cancel: State<'_, CancelState>,
    app_name: String,
    items: Vec<uninstaller::LeftoverItem>,
) -> Result<uninstaller::LeftoverCleanResult, String> {
    let flag = cancel.0.clone();
    flag.store(false, Ordering::SeqCst);
    let h = handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        uninstaller::remove_leftovers(&h, &flag, app_name, items)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan_printer_status() -> Result<printer::PrinterStatusReport, String> {
    tauri::async_runtime::spawn_blocking(printer::scan_printer_status)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn rescue_print_spooler(
    handle: AppHandle,
    cancel: State<'_, CancelState>,
) -> Result<printer::SpoolerRescueResult, String> {
    let flag = cancel.0.clone();
    flag.store(false, Ordering::SeqCst);
    let h = handle.clone();
    tauri::async_runtime::spawn_blocking(move || printer::rescue_print_spooler(&h, &flag))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn apply_printer_share_fixes(
    handle: AppHandle,
    cancel: State<'_, CancelState>,
    fix_ids: Vec<String>,
) -> Result<printer::PrinterFixResult, String> {
    let flag = cancel.0.clone();
    flag.store(false, Ordering::SeqCst);
    let h = handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        printer::apply_printer_share_fixes(&h, &flag, fix_ids)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn probe_printer_host(host_ip: String) -> Result<printer::PrinterHostProbe, String> {
    tauri::async_runtime::spawn_blocking(move || printer::probe_printer_host(host_ip))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn connect_shared_printer(unc_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || printer::connect_shared_printer(unc_path))
        .await
        .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppData::default())
        .manage(CancelState(Arc::new(AtomicBool::new(false))))
        .invoke_handler(tauri::generate_handler![
            get_catalog,
            detect_states,
            get_system_specs,
            list_installed_programs,
            uninstall_program,
            install_apps,
            uninstall_app,
            default_packages_dir,
            scan_packages,
            export_report,
            open_path,
            cli_args,
            check_update,
            apply_update,
            check_admin,
            cancel_active_task,
            run_diagnostics,
            launch_memory_diagnostic,
            scan_cleaner_targets,
            run_cleaner,
            run_native_uninstaller,
            scan_leftovers,
            remove_leftovers,
            scan_printer_status,
            rescue_print_spooler,
            apply_printer_share_fixes,
            probe_printer_host,
            connect_shared_printer
        ])
        .run(tauri::generate_context!())
        .expect("lỗi khi chạy AllSoft Desktop");
}
