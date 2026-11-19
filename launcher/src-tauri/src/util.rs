//! Tiện ích chung: chạy tiến trình không hiện cửa sổ, kiểu kết quả cài đặt.
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Kết quả một bước cài/gỡ thành công.
#[derive(Debug, Clone, Default)]
pub struct InstallOutcome {
    pub reboot: bool,
    pub note: String,
}

pub fn cmd(program: &str) -> Command {
    let mut c = Command::new(program);
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// Chạy lệnh, trả (exit code, stdout+stderr).
pub fn run_capture(program: &str, args: &[String]) -> Result<(i32, String), String> {
    let out = cmd(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Không chạy được '{program}': {e}"))?;
    let mut text = String::from_utf8_lossy(&out.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok((out.status.code().unwrap_or(-1), text))
}

/// Chạy lệnh qua `cmd /C "<dòng lệnh>"` (dùng cho chuỗi UninstallString trong Registry).
pub fn run_cmdline(line: &str) -> Result<i32, String> {
    let status = cmd("cmd")
        .arg("/C")
        .raw_arg(format!("\"{line}\""))
        .stdin(Stdio::null())
        .status()
        .map_err(|e| format!("Không chạy được lệnh gỡ: {e}"))?;
    Ok(status.code().unwrap_or(-1))
}

pub fn now_string() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}
