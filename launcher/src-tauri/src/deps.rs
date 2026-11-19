//! Dependency: sắp xếp thứ tự cài (dependency trước) + kiểm tra VC++/.NET 8/Node.
use crate::catalog::App;
use crate::util::run_capture;
use std::collections::HashSet;
use winreg::enums::*;
use winreg::RegKey;

/// Trả danh sách id theo thứ tự cài: mọi dependency đứng trước app phụ thuộc, không trùng lặp.
pub fn resolve_order(apps: &[App], ids: &[String]) -> Result<Vec<String>, String> {
    fn visit(
        apps: &[App],
        id: &str,
        done: &mut HashSet<String>,
        stack: &mut Vec<String>,
        out: &mut Vec<String>,
    ) -> Result<(), String> {
        if done.contains(id) {
            return Ok(());
        }
        if stack.iter().any(|s| s == id) {
            return Err(format!("Vòng lặp dependency: {} -> {id}", stack.join(" -> ")));
        }
        let app = apps.iter().find(|a| a.id == id).ok_or_else(|| format!("Không có ứng dụng '{id}' trong catalog"))?;
        stack.push(id.to_string());
        for d in &app.dependencies {
            visit(apps, d, done, stack, out)?;
        }
        stack.pop();
        done.insert(id.to_string());
        out.push(id.to_string());
        Ok(())
    }
    let (mut done, mut stack, mut out) = (HashSet::new(), Vec::new(), Vec::new());
    for id in ids {
        visit(apps, id, &mut done, &mut stack, &mut out)?;
    }
    Ok(out)
}

/// Kiểm tra nhanh các nền tảng đặc biệt. `None` = không có luật riêng (dùng detect chung).
pub fn builtin_check(dep_id: &str) -> Option<bool> {
    match dep_id {
        "vcredist-x64" => Some(
            RegKey::predef(HKEY_LOCAL_MACHINE)
                .open_subkey_with_flags(r"SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64", KEY_READ)
                .and_then(|k| k.get_value::<u32, _>("Installed"))
                .map(|v| v == 1)
                .unwrap_or(false),
        ),
        "dotnet-desktop-8" => Some(
            run_capture("dotnet", &["--list-runtimes".into()])
                .map(|(_, out)| out.contains("Microsoft.WindowsDesktop.App 8."))
                .unwrap_or(false),
        ),
        "nodejs-lts" => Some(matches!(run_capture("node", &["--version".into()]), Ok((0, _)))),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::parse_catalog;

    fn cat(json_apps: &str) -> Vec<App> {
        let s = format!("{{\"catalog_version\":2,\"launcher\":{{}},\"apps\":[{json_apps}]}}");
        parse_catalog(&s).unwrap().apps
    }
    fn app(id: &str, deps: &str) -> String {
        format!("{{\"id\":\"{id}\",\"name\":\"{id}\",\"source\":\"winget\",\"dependencies\":[{deps}]}}")
    }

    #[test]
    fn deps_come_first_without_duplicates() {
        let apps = cat(&[app("a", "\"b\",\"c\""), app("b", "\"c\""), app("c", "")].join(","));
        let order = resolve_order(&apps, &["a".into(), "b".into()]).unwrap();
        assert_eq!(order, vec!["c", "b", "a"]);
    }

    #[test]
    fn detects_cycle_and_missing() {
        let apps = cat(&[app("a", "\"b\""), app("b", "\"a\"")].join(","));
        assert!(resolve_order(&apps, &["a".into()]).unwrap_err().contains("Vòng lặp"));
        assert!(resolve_order(&apps, &["zzz".into()]).is_err());
    }

    #[test]
    fn real_catalog_order() {
        let apps = parse_catalog(include_str!("../../../catalog/apps.json")).unwrap().apps;
        let o = resolve_order(&apps, &["vnpt-ca".into()]).unwrap();
        assert_eq!(o, vec!["vcredist-x64", "vnpt-ca"]);
    }
}
