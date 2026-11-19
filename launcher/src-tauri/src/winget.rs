//! winget: bootstrap, install/upgrade/uninstall, map exit code.
use crate::util::{run_capture, InstallOutcome};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Install,
    Upgrade,
    Uninstall,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Success,
    /// Đã cài sẵn -> coi là thành công
    AlreadyInstalled,
    /// Không có bản mới -> coi là thành công
    NoUpgrade,
    /// Gỡ nhưng không tìm thấy -> coi là thành công
    NotFound,
    RebootRequired,
    Failed,
}

impl Outcome {
    pub fn is_ok(self) -> bool {
        self != Outcome::Failed
    }
}

const PACKAGE_ALREADY_INSTALLED: i32 = 0x8A15_0061u32 as i32;
const INSTALL_ALREADY_INSTALLED: i32 = 0x8A15_010Du32 as i32;
const UPDATE_NOT_APPLICABLE: i32 = 0x8A15_002Bu32 as i32;
const NO_APPLICABLE_UPGRADE: i32 = 0x8A15_010Eu32 as i32;
const NO_APPLICATIONS_FOUND: i32 = 0x8A15_0014u32 as i32;

pub fn map_exit_code(action: Action, code: i32) -> Outcome {
    match code {
        0 => Outcome::Success,
        3010 | 1641 => Outcome::RebootRequired,
        PACKAGE_ALREADY_INSTALLED | INSTALL_ALREADY_INSTALLED => Outcome::AlreadyInstalled,
        UPDATE_NOT_APPLICABLE | NO_APPLICABLE_UPGRADE => match action {
            Action::Uninstall => Outcome::Failed,
            _ => Outcome::NoUpgrade,
        },
        NO_APPLICATIONS_FOUND if action == Action::Uninstall => Outcome::NotFound,
        _ => Outcome::Failed,
    }
}

pub fn build_args(action: Action, id: &str, scope: Option<&str>) -> Vec<String> {
    let verb = match action {
        Action::Install => "install",
        Action::Upgrade => "upgrade",
        Action::Uninstall => "uninstall",
    };
    let mut a: Vec<String> = [verb, "--id", id, "--exact", "--silent", "--accept-source-agreements", "--disable-interactivity"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if action != Action::Uninstall {
        a.push("--accept-package-agreements".into());
        if let Some(s) = scope {
            a.push("--scope".into());
            a.push(s.into());
        }
    }
    a
}

pub fn is_available() -> bool {
    matches!(run_capture("winget", &["--version".to_string()]), Ok((0, _)))
}

/// Đảm bảo có winget; nếu thiếu thử đăng ký App Installer.
pub fn bootstrap() -> bool {
    if is_available() {
        return true;
    }
    let script = "Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe";
    let _ = run_capture("powershell", &["-NoProfile".into(), "-Command".into(), script.into()]);
    is_available()
}

pub fn run(action: Action, id: &str, scope: Option<&str>) -> Result<InstallOutcome, String> {
    if !bootstrap() {
        return Err("Máy chưa có winget (App Installer)".into());
    }
    let (code, out) = run_capture("winget", &build_args(action, id, scope))?;
    let outcome = map_exit_code(action, code);
    if outcome.is_ok() {
        let note = match outcome {
            Outcome::AlreadyInstalled => "Đã cài sẵn",
            Outcome::NoUpgrade => "Không có bản mới",
            Outcome::NotFound => "Không tìm thấy (đã gỡ)",
            _ => "",
        };
        Ok(InstallOutcome { reboot: outcome == Outcome::RebootRequired, note: note.into() })
    } else {
        let tail: String = out.lines().rev().filter(|l| !l.trim().is_empty()).take(2).collect::<Vec<_>>().join(" | ");
        Err(format!("winget lỗi (mã {code:#x}): {tail}"))
    }
}

/// `winget list` / `winget upgrade` -> văn bản thô (rỗng nếu lỗi).
pub fn query(verb: &str) -> String {
    match run_capture("winget", &[verb.into(), "--accept-source-agreements".into(), "--disable-interactivity".into()]) {
        Ok((_, text)) => text,
        Err(_) => String::new(),
    }
}

pub fn output_has_id(output: &str, id: &str) -> bool {
    output.lines().any(|l| l.split_whitespace().any(|t| t.eq_ignore_ascii_case(id)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_code_mapping() {
        assert_eq!(map_exit_code(Action::Install, 0), Outcome::Success);
        assert_eq!(map_exit_code(Action::Install, 0x8A150061u32 as i32), Outcome::AlreadyInstalled);
        assert_eq!(map_exit_code(Action::Upgrade, 0x8A15002Bu32 as i32), Outcome::NoUpgrade);
        assert_eq!(map_exit_code(Action::Uninstall, 0x8A150014u32 as i32), Outcome::NotFound);
        assert_eq!(map_exit_code(Action::Install, 3010), Outcome::RebootRequired);
        assert_eq!(map_exit_code(Action::Install, 1), Outcome::Failed);
        assert_eq!(map_exit_code(Action::Install, 0x8A150014u32 as i32), Outcome::Failed);
        assert!(Outcome::AlreadyInstalled.is_ok() && Outcome::NoUpgrade.is_ok());
        assert!(!Outcome::Failed.is_ok());
    }

    #[test]
    fn args_building() {
        let a = build_args(Action::Install, "X.Y", Some("machine"));
        assert!(a.windows(2).any(|w| w == ["--id", "X.Y"]));
        assert!(a.windows(2).any(|w| w == ["--scope", "machine"]));
        let u = build_args(Action::Uninstall, "X.Y", Some("machine"));
        assert!(!u.contains(&"--scope".to_string()));
    }

    #[test]
    fn id_in_output() {
        let out = "Name  Id  Version\n---\nWinRAR  RARLab.WinRAR  7.01\n";
        assert!(output_has_id(out, "rarlab.winrar"));
        assert!(!output_has_id(out, "RARLab.Win"));
    }
}
