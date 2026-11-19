//! Tải trực tiếp + kiểm SHA-256 + chạy installer silent; gỡ qua Registry.
use crate::catalog::DirectSpec;
use crate::detect::RegEntry;
use crate::util::{run_cmdline, InstallOutcome};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// `expected` None/rỗng -> bỏ qua kiểm tra (catalog chưa có hash).
pub fn verify(path: &Path, expected: Option<&str>) -> Result<(), String> {
    let Some(exp) = expected.map(str::trim).filter(|s| !s.is_empty()) else { return Ok(()) };
    let actual = sha256_file(path).map_err(|e| format!("Không đọc được file để kiểm SHA-256: {e}"))?;
    if actual.eq_ignore_ascii_case(exp) {
        Ok(())
    } else {
        Err(format!("SHA-256 không khớp (mong đợi {exp}, thực tế {actual})"))
    }
}

pub fn download(url: &str, dest: &Path, on_progress: &mut dyn FnMut(f64)) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Chỉ cho phép tải qua HTTPS".into());
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(3600))
        .user_agent("AllSoftDesktop-Launcher")
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().map_err(|e| format!("Tải thất bại: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Tải thất bại: HTTP {}", resp.status()));
    }
    let total = resp.content_length();
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let part = dest.with_extension("part");
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let (mut got, mut buf) = (0u64, [0u8; 65536]);
    loop {
        let n = resp.read(&mut buf).map_err(|e| format!("Lỗi khi tải: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        if let Some(t) = total.filter(|t| *t > 0) {
            on_progress(got as f64 / t as f64 * 100.0);
        }
    }
    drop(file);
    std::fs::rename(&part, dest).map_err(|e| e.to_string())
}

pub fn is_success_code(code: i32) -> Option<bool> {
    match code {
        0 => Some(false),
        3010 | 1641 => Some(true), // cần khởi động lại
        _ => None,
    }
}

/// Chạy file cài đặt (exe/msi) ở chế độ silent.
pub fn run_installer(path: &Path, installer_type: &str, args: &[String]) -> Result<InstallOutcome, String> {
    let is_msi = installer_type.eq_ignore_ascii_case("msi")
        || path.extension().is_some_and(|e| e.eq_ignore_ascii_case("msi"));
    let status = if is_msi {
        let mut a = vec!["/i".to_string(), path.to_string_lossy().to_string(), "/qn".into(), "/norestart".into()];
        a.extend_from_slice(args);
        crate::util::cmd("msiexec").args(a).status()
    } else {
        crate::util::cmd(&path.to_string_lossy()).args(args).status()
    }
    .map_err(|e| format!("Không chạy được installer: {e}"))?;
    let code = status.code().unwrap_or(-1);
    match is_success_code(code) {
        Some(reboot) => Ok(InstallOutcome { reboot, note: "Cần khởi động lại".into() }),
        None if code == 0 => Ok(InstallOutcome::default()),
        None => Err(format!("Installer trả mã lỗi {code}")),
    }
}

/// Tải -> kiểm SHA-256 -> cài.
pub fn install_direct(spec: &DirectSpec, tmp_dir: &Path, on_progress: &mut dyn FnMut(f64)) -> Result<InstallOutcome, String> {
    let name = spec.url.rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or("installer.exe");
    let dest = tmp_dir.join(name);
    download(&spec.url, &dest, on_progress)?;
    if let Err(e) = verify(&dest, spec.sha256.as_deref()) {
        let _ = std::fs::remove_file(&dest);
        return Err(e);
    }
    let r = run_installer(&dest, &spec.installer_type, &spec.silent_args);
    let _ = std::fs::remove_file(&dest);
    r
}

/// Dựng dòng lệnh gỡ từ Registry; MSI -> `msiexec /x {GUID} /qn`.
pub fn build_uninstall_cmdline(entry: &RegEntry, extra: &[String]) -> Option<String> {
    let base = if !entry.quiet.trim().is_empty() { entry.quiet.trim() } else { entry.uninstall.trim() };
    if base.is_empty() {
        return None;
    }
    if base.to_lowercase().contains("msiexec") {
        let start = base.find('{')?;
        let end = base[start..].find('}')? + start;
        return Some(format!("msiexec /x {} /qn /norestart", &base[start..=end]));
    }
    if !entry.quiet.trim().is_empty() || extra.is_empty() {
        return Some(base.to_string());
    }
    Some(format!("{base} {}", extra.join(" ")))
}

pub fn uninstall_registry(entry: &RegEntry, extra: &[String]) -> Result<InstallOutcome, String> {
    let line = build_uninstall_cmdline(entry, extra).ok_or("Không có lệnh gỡ trong Registry")?;
    let code = run_cmdline(&line)?;
    match is_success_code(code) {
        Some(reboot) => Ok(InstallOutcome { reboot, note: "Cần khởi động lại".into() }),
        None if code == 0 => Ok(InstallOutcome::default()),
        None => Err(format!("Lệnh gỡ trả mã lỗi {code}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_vector() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    #[test]
    fn verify_file_hash() {
        let p = std::env::temp_dir().join("allsoft_sha_test.bin");
        std::fs::write(&p, b"abc").unwrap();
        let good = "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD";
        assert!(verify(&p, Some(good)).is_ok());
        assert!(verify(&p, Some("deadbeef")).unwrap_err().contains("không khớp"));
        assert!(verify(&p, None).is_ok());
        assert!(verify(&p, Some("  ")).is_ok());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn success_codes() {
        assert_eq!(is_success_code(0), Some(false));
        assert_eq!(is_success_code(3010), Some(true));
        assert_eq!(is_success_code(5), None);
    }

    #[test]
    fn uninstall_cmdline() {
        let msi = RegEntry { uninstall: "MsiExec.exe /I{ABC-123}".into(), ..Default::default() };
        assert_eq!(build_uninstall_cmdline(&msi, &[]).unwrap(), "msiexec /x {ABC-123} /qn /norestart");
        let exe = RegEntry { uninstall: "\"C:\\x\\unins.exe\"".into(), ..Default::default() };
        assert_eq!(build_uninstall_cmdline(&exe, &["/S".into()]).unwrap(), "\"C:\\x\\unins.exe\" /S");
        assert!(build_uninstall_cmdline(&RegEntry::default(), &[]).is_none());
    }

    #[test]
    fn rejects_http() {
        let p = std::env::temp_dir().join("x.bin");
        assert!(download("http://example.com/a.exe", &p, &mut |_| {}).is_err());
    }
}
