//! Self-update qua GitHub Releases.
use crate::detect::compare_versions;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current: String,
    pub latest: String,
    pub url: String,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    compare_versions(latest, current) == Ordering::Greater
}

pub fn check(repo: &str, current: &str) -> Result<UpdateInfo, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(15))
        .user_agent("AllSoftDesktop-Launcher")
        .build()
        .map_err(|e| e.to_string())?;
    let rel: Release = client
        .get(format!("https://api.github.com/repos/{repo}/releases/latest"))
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    let latest = rel.tag_name.trim_start_matches(['v', 'V']).to_string();
    Ok(UpdateInfo { available: is_newer(&latest, current), current: current.into(), latest, url: rel.html_url })
}

/// Tải bộ cài mới vào Temp và chạy nó (người gọi sẽ thoát ứng dụng).
pub fn download_and_run(url: &str, on_progress: &mut dyn FnMut(f64)) -> Result<(), String> {
    let dest = std::env::temp_dir().join("AllSoftDesktop-Setup.exe");
    crate::direct::download(url, &dest, on_progress)?;
    crate::util::cmd(&dest.to_string_lossy()).spawn().map_err(|e| format!("Không chạy được bộ cài: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_detection() {
        assert!(is_newer("1.0.1", "1.0.0"));
        assert!(is_newer("v1.10.0", "1.9.9"));
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("0.9", "1.0.0"));
    }
}
