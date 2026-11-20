//! Xuất log + báo cáo HTML/CSV sau cài.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportEntry {
    pub time: String,
    pub id: String,
    pub name: String,
    /// install | upgrade | uninstall
    pub action: String,
    /// packages | winget | direct | registry | -
    pub source: String,
    pub success: bool,
    pub message: String,
}

pub fn csv_escape(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

pub fn to_csv(entries: &[ReportEntry]) -> String {
    // BOM để Excel đọc đúng tiếng Việt
    let mut out = String::from("\u{feff}Thời gian,Mã,Tên,Hành động,Nguồn,Kết quả,Ghi chú\r\n");
    for e in entries {
        let row = [
            e.time.as_str(),
            e.id.as_str(),
            e.name.as_str(),
            e.action.as_str(),
            e.source.as_str(),
            if e.success { "Thành công" } else { "Thất bại" },
            e.message.as_str(),
        ]
            .iter()
            .map(|c| csv_escape(c))
            .collect::<Vec<_>>()
            .join(",");
        out.push_str(&row);
        out.push_str("\r\n");
    }
    out
}

pub fn to_html(entries: &[ReportEntry], title: &str) -> String {
    let ok = entries.iter().filter(|e| e.success).count();
    let rows: String = entries
        .iter()
        .map(|e| {
            format!(
                "<tr class=\"{}\"><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>\n",
                if e.success { "ok" } else { "fail" },
                html_escape(&e.time),
                html_escape(&e.name),
                html_escape(&e.action),
                html_escape(&e.source),
                if e.success { "Thành công" } else { "Thất bại" },
                html_escape(&e.message)
            )
        })
        .collect();
    format!(
        "<!doctype html><html lang=\"vi\"><head><meta charset=\"utf-8\"><title>{t}</title><style>\
body{{font-family:Segoe UI,sans-serif;margin:32px;color:#111827}}h1{{font-size:20px}}\
table{{border-collapse:collapse;width:100%}}th,td{{border-bottom:1px solid #e5e7eb;padding:8px 10px;text-align:left;font-size:13px}}\
th{{background:#f3f4f6}}tr.ok td:nth-child(5){{color:#15803d;font-weight:600}}tr.fail td:nth-child(5){{color:#b91c1c;font-weight:600}}\
</style></head><body><h1>{t}</h1><p>Tổng: {n} · Thành công: {ok} · Thất bại: {f}</p>\
<table><tr><th>Thời gian</th><th>Phần mềm</th><th>Hành động</th><th>Nguồn</th><th>Kết quả</th><th>Ghi chú</th></tr>\n{rows}</table></body></html>",
        t = html_escape(title),
        n = entries.len(),
        ok = ok,
        f = entries.len() - ok,
        rows = rows
    )
}

/// Ghi cả CSV, HTML và log; trả đường dẫn file HTML.
pub fn write_reports(dir: &Path, entries: &[ReportEntry]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let html = dir.join(format!("report-{stamp}.html"));
    std::fs::write(&html, to_html(entries, "Báo cáo cài đặt AllSoft Desktop")).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("report-{stamp}.csv")), to_csv(entries)).map_err(|e| e.to_string())?;
    let log: String = entries
        .iter()
        .map(|e| format!("[{}] {} {} via {}: {} - {}\n", e.time, e.action, e.id, e.source, if e.success { "OK" } else { "FAIL" }, e.message))
        .collect();
    std::fs::write(dir.join(format!("report-{stamp}.log")), log).map_err(|e| e.to_string())?;
    Ok(html)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(msg: &str, ok: bool) -> ReportEntry {
        ReportEntry { time: "t".into(), id: "a".into(), name: "A".into(), action: "install".into(), source: "winget".into(), success: ok, message: msg.into() }
    }

    #[test]
    fn csv_escaping() {
        assert_eq!(csv_escape("a,b"), "\"a,b\"");
        assert_eq!(csv_escape("a\"b"), "\"a\"\"b\"");
        assert_eq!(csv_escape("ok"), "ok");
        let csv = to_csv(&[entry("lỗi, nặng", false)]);
        assert!(csv.contains("\"lỗi, nặng\"") && csv.contains("Thất bại"));
    }

    #[test]
    fn html_escapes_and_counts() {
        let h = to_html(&[entry("<script>", true), entry("x", false)], "T");
        assert!(h.contains("&lt;script&gt;") && !h.contains("<script>"));
        assert!(h.contains("Thành công: 1") && h.contains("Thất bại: 1"));
    }
}
