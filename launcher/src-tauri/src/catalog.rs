//! Catalog: tải apps.json online -> lưu cache offline -> dự phòng bản đóng gói sẵn.
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;

pub const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/ntdtdt2010-bit/AllSoftDesktop/main/catalog/apps.json";
const BUNDLED: &str = include_str!("../../../catalog/apps.json");
const CACHE_FILE: &str = "apps.cache.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub catalog_version: u32,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub repo: String,
    #[serde(default)]
    pub site_url: String,
    pub launcher: LauncherInfo,
    #[serde(default)]
    pub profiles: Vec<Profile>,
    pub apps: Vec<App>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LauncherInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub release_url: String,
    #[serde(default)]
    pub downloads: Downloads,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Downloads {
    #[serde(default)]
    pub windows: String,
    #[serde(default)]
    pub windows_portable: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub apps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct App {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub hidden: bool,
    /// "winget" | "direct"
    pub source: String,
    #[serde(default)]
    pub winget: Option<WingetSpec>,
    #[serde(default)]
    pub direct: Option<DirectSpec>,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub uninstall: UninstallSpec,
    #[serde(default)]
    pub changelog_url: Option<String>,
    #[serde(default)]
    pub docs_slug: Option<String>,
    #[serde(default)]
    pub offline_filename: Option<String>,
    #[serde(default)]
    pub detect: DetectSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WingetSpec {
    pub id: String,
    #[serde(default)]
    pub scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectSpec {
    pub url: String,
    #[serde(default = "default_installer_type")]
    pub installer_type: String,
    #[serde(default)]
    pub silent_args: Vec<String>,
    #[serde(default)]
    pub sha256: Option<String>,
}

fn default_installer_type() -> String {
    "exe".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstallSpec {
    /// "winget" | "registry" | "none"
    #[serde(default = "default_uninstall_mode")]
    pub mode: String,
    #[serde(default)]
    pub args: Vec<String>,
}

fn default_uninstall_mode() -> String {
    "none".into()
}

impl Default for UninstallSpec {
    fn default() -> Self {
        Self { mode: default_uninstall_mode(), args: vec![] }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DetectSpec {
    #[serde(default)]
    pub display_names: Vec<String>,
    #[serde(default)]
    pub registry_keys: Vec<String>,
    #[serde(default)]
    pub install_paths: Vec<String>,
}

pub fn parse_catalog(text: &str) -> Result<Catalog, String> {
    let text = text.trim_start_matches('\u{feff}');
    let cat: Catalog = serde_json::from_str(text).map_err(|e| format!("Catalog không hợp lệ: {e}"))?;
    if cat.apps.is_empty() {
        return Err("Catalog không có ứng dụng nào".into());
    }
    Ok(cat)
}

fn fetch_online() -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(6))
        .timeout(Duration::from_secs(15))
        .user_agent("AllSoftDesktop-Launcher")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(CATALOG_URL).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().map_err(|e| e.to_string())
}

/// Trả về (catalog, nguồn: "online" | "cache" | "bundled").
pub fn load(cache_dir: &Path) -> (Catalog, &'static str) {
    let cache_path = cache_dir.join(CACHE_FILE);
    if let Ok(text) = fetch_online() {
        if let Ok(cat) = parse_catalog(&text) {
            let _ = std::fs::create_dir_all(cache_dir);
            let _ = std::fs::write(&cache_path, &text);
            return (cat, "online");
        }
    }
    if let Ok(text) = std::fs::read_to_string(&cache_path) {
        if let Ok(cat) = parse_catalog(&text) {
            return (cat, "cache");
        }
    }
    (parse_catalog(BUNDLED).expect("catalog đóng gói sẵn phải hợp lệ"), "bundled")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bundled_catalog() {
        let cat = parse_catalog(BUNDLED).unwrap();
        assert_eq!(cat.catalog_version, 2);
        assert!(cat.apps.iter().any(|a| a.source == "direct" && a.direct.is_some()));
        assert!(cat.apps.iter().any(|a| a.winget.is_some()));
        assert!(!cat.profiles.is_empty());
    }

    #[test]
    fn parse_minimal_and_bom() {
        let s = "\u{feff}{\"catalog_version\":2,\"launcher\":{},\"apps\":[{\"id\":\"a\",\"name\":\"A\",\"source\":\"winget\"}]}";
        let cat = parse_catalog(s).unwrap();
        assert_eq!(cat.apps[0].uninstall.mode, "none");
        assert!(cat.apps[0].dependencies.is_empty());
    }

    #[test]
    fn reject_invalid() {
        assert!(parse_catalog("{}").is_err());
        assert!(parse_catalog("{\"catalog_version\":2,\"launcher\":{},\"apps\":[]}").is_err());
    }

    #[test]
    fn profiles_reference_existing_apps() {
        let cat = parse_catalog(BUNDLED).unwrap();
        for p in &cat.profiles {
            for id in &p.apps {
                assert!(cat.apps.iter().any(|a| &a.id == id), "profile {} thiếu app {}", p.id, id);
            }
        }
    }
}
