import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { DiagnosticItem, DiagnosticReport, DiagnosticSeverity, TaskProgress } from "../types";

interface DiagnosticsTabProps {
  isAdmin: boolean;
  onNotify: (msg: string) => void;
}

const SEVERITY_STYLE: Record<
  DiagnosticSeverity,
  {
    label: string;
    icon: string;
    cardBorder: string;
    cardBg: string;
    badgeCls: string;
    dotCls: string;
    titleCls: string;
  }
> = {
  critical: {
    label: "Nghiêm trọng",
    icon: "🔴",
    cardBorder: "border-red-200/90",
    cardBg: "bg-red-50/40",
    badgeCls: "bg-red-100 text-red-800 ring-red-200",
    dotCls: "bg-red-500",
    titleCls: "text-red-900",
  },
  warning: {
    label: "Cảnh báo",
    icon: "🟡",
    cardBorder: "border-amber-200/90",
    cardBg: "bg-amber-50/35",
    badgeCls: "bg-amber-100 text-amber-800 ring-amber-200",
    dotCls: "bg-amber-500",
    titleCls: "text-amber-950",
  },
  ok: {
    label: "Ổn định",
    icon: "🟢",
    cardBorder: "border-emerald-200/80",
    cardBg: "bg-emerald-50/25",
    badgeCls: "bg-emerald-100 text-emerald-800 ring-emerald-200",
    dotCls: "bg-emerald-500",
    titleCls: "text-emerald-950",
  },
};

export function DiagnosticsTab({ isAdmin, onNotify }: DiagnosticsTabProps) {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [filter, setFilter] = useState<"all" | DiagnosticSeverity>("all");
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [showMemModal, setShowMemModal] = useState(false);
  const [launchingMem, setLaunchingMem] = useState(false);

  // Lắng nghe tiến trình realtime từ backend / Preview Mode
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api.onTaskProgress((p) => {
      if (p.module === "diagnostics") {
        setProgress(p);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // Tự động nạp sẵn kết quả mẫu ở chế độ Preview trình duyệt để quan sát trực quan ngay
  useEffect(() => {
    const isPreview = typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);
    if (isPreview && !report && !running) {
      let alive = true;
      // Nạp nhanh dữ liệu mẫu lần đầu mà không khóa UI
      api.runDiagnostics().then((res) => {
        if (alive) {
          setReport(res);
          setProgress(null);
        }
      }).catch(() => {});
      return () => {
        alive = false;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRunScan() {
    if (running) return;
    setRunning(true);
    setProgress({ module: "diagnostics", step: "Đang khởi tạo bộ chẩn đoán hệ thống…", percent: 5 });
    try {
      const res = await api.runDiagnostics();
      setReport(res);
      onNotify(
        `Chẩn đoán hoàn tất: ${res.critical_count} nghiêm trọng · ${res.warning_count} cảnh báo · ${res.ok_count} ổn định.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg);
    } finally {
      setRunning(false);
    }
  }

  async function handleCancel() {
    await api.cancelActiveTask();
    onNotify("Đã gửi lệnh hủy tác vụ chẩn đoán.");
  }

  async function handleCopyMarkdown() {
    if (!report?.ai_markdown) {
      onNotify("Chưa có báo cáo chẩn đoán để sao chép.");
      return;
    }
    try {
      await navigator.clipboard.writeText(report.ai_markdown);
      onNotify("Đã sao chép báo cáo chẩn đoán kỹ thuật (Markdown)!");
    } catch {
      // Fallback textarea copy
      const ta = document.createElement("textarea");
      ta.value = report.ai_markdown;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      onNotify("Đã sao chép báo cáo chẩn đoán kỹ thuật (Markdown)!");
    }
  }

  async function confirmLaunchMemoryDiagnostic() {
    setLaunchingMem(true);
    try {
      const msg = await api.launchMemoryDiagnostic();
      setShowMemModal(false);
      onNotify(msg);
    } catch (e) {
      onNotify(`Không mở được mdsched.exe: ${e}`);
    } finally {
      setLaunchingMem(false);
    }
  }

  const filteredItems = useMemo<DiagnosticItem[]>(() => {
    if (!report) return [];
    if (filter === "all") return report.items;
    return report.items.filter((i) => i.severity === filter);
  }, [report, filter]);

  const groupedItems = useMemo(() => {
    const order: DiagnosticSeverity[] = ["critical", "warning", "ok"];
    return order
      .map((sev) => ({
        severity: sev,
        items: filteredItems.filter((i) => i.severity === sev),
      }))
      .filter((g) => g.items.length > 0);
  }, [filteredItems]);

  return (
    <div key="tab-diagnostics" className="tab-panel-enter flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
      {/* ADMIN WARNING BANNER IF NOT ELEVATED */}
      {!isAdmin && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>
              <strong>Thiếu quyền Administrator:</strong> Một số nguồn log bảo mật, S.M.A.R.T và Minidump có thể bị hạn chế. Hãy chạy AllSoft Desktop bằng quyền <strong>Run as Administrator</strong> để chẩn đoán đầy đủ.
            </span>
          </div>
        </div>
      )}

      {/* TOP CONTROL BAR */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#EAE2CE] bg-white px-4 py-3 shadow-[0_2px_10px_-4px_rgba(43,43,43,0.04)]">
        <div className="flex flex-wrap items-center gap-2.5">
          {!running ? (
            <button
              type="button"
              onClick={handleRunScan}
              className="rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] px-4 py-2 text-xs font-bold text-white shadow-sm transition-all duration-150 hover:brightness-105 active:scale-[0.98]"
            >
              🩺 Quét chẩn đoán hệ thống
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-[#DFC992] bg-[#FAF3DF]/70 px-3.5 py-1.5">
              <div className="w-56 sm:w-72">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[#8A6D1F]">
                  <span className="truncate pr-2">{progress?.step ?? "Đang quét…"}</span>
                  <span className="shrink-0 font-mono">{progress?.percent ?? 0}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#EFE9D8]">
                  <div
                    className="progress-smooth h-full rounded-full bg-gradient-to-r from-[#C5A044] to-[#9A7B2C]"
                    style={{ width: `${Math.min(100, Math.max(4, progress?.percent ?? 10))}%` }}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-bold text-red-700 transition hover:bg-red-50 active:scale-[0.98]"
              >
                ✕ Hủy tác vụ
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowMemModal(true)}
            disabled={running}
            className="rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] px-3.5 py-2 text-xs font-semibold text-[#2B2B2B] transition-all duration-150 hover:border-[#B5943B] hover:bg-[#FAF3DF]/70 active:scale-[0.98] disabled:opacity-50"
          >
            🧠 Kiểm tra RAM (mdsched.exe)
          </button>

          <button
            type="button"
            onClick={handleCopyMarkdown}
            disabled={!report || running}
            className="rounded-xl bg-[#2B2B2B] px-4 py-2 text-xs font-bold text-[#DFC068] shadow-sm transition-all duration-150 hover:bg-[#3A3A3A] active:scale-[0.98] disabled:opacity-40"
          >
            📋 Sao chép báo cáo kỹ thuật
          </button>
        </div>

        <div className="flex items-center gap-2.5 text-xs">
          {isAdmin ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              🛡️ Đã cấp quyền Admin
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
              ⚠️ Chưa có quyền Admin
            </span>
          )}
          {report && (
            <span className="hidden text-[11px] text-[#7A6F58] sm:inline">
              Quét lúc <strong className="font-mono text-[#2B2B2B]">{report.scanned_at}</strong>
            </span>
          )}
        </div>
      </div>

      {/* SUMMARY FILTER CARDS (CRITICAL / WARNING / OK) */}
      <div className="mb-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {(["critical", "warning", "ok"] as DiagnosticSeverity[]).map((sev) => {
          const st = SEVERITY_STYLE[sev];
          const count =
            sev === "critical"
              ? report?.critical_count ?? 0
              : sev === "warning"
              ? report?.warning_count ?? 0
              : report?.ok_count ?? 0;
          const active = filter === sev;
          return (
            <button
              key={sev}
              type="button"
              onClick={() => setFilter(active ? "all" : sev)}
              className={`card-lift flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-all active:scale-[0.98] ${
                active
                  ? "border-[#B5943B] bg-[#FAF3DF]/70 ring-2 ring-[#B5943B]/25"
                  : `${st.cardBorder} bg-white hover:bg-[#FFFDF9]`
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">{st.icon}</span>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-[#6E6450]">
                    {sev === "critical"
                      ? "Nghiêm trọng (Critical)"
                      : sev === "warning"
                      ? "Cảnh báo (Warning)"
                      : "Ổn định (OK)"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#8A7E66]">
                    {active ? "Đang lọc nhóm này · Bấm để xem tất cả" : "Bấm để lọc nhanh danh sách"}
                  </div>
                </div>
              </div>
              <span className={`rounded-xl px-3 py-1 font-mono text-lg font-extrabold ring-1 ring-inset ${st.badgeCls}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* MAIN DIAGNOSTIC RESULTS */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {!report ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#DFC992] bg-white py-16 text-center">
            <div className="text-3xl">🩺</div>
            <p className="mt-2 text-sm font-bold text-[#2B2B2B]">
              Sẵn sàng chẩn đoán sức khỏe Windows
            </p>
            <p className="mt-1 max-w-md text-xs text-[#6E6450]">
              Quét nhanh Event Viewer (Kernel-Power 41, BugCheck 1001, Disk 7/11/51, NTFS 55, App Error 1000), tệp Minidump BSOD, dung lượng ổ cứng và Driver PnP lỗi.
            </p>
            <button
              type="button"
              onClick={handleRunScan}
              className="mt-4 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] px-5 py-2 text-xs font-bold text-white shadow-sm hover:brightness-105 active:scale-[0.98]"
            >
              Bắt đầu quét ngay
            </button>
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            {groupedItems.map(({ severity, items }) => {
              const st = SEVERITY_STYLE[severity];
              return (
                <section key={severity} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#8A6D1F]">
                      <span>{st.icon}</span>
                      <span>
                        {st.label} ({items.length})
                      </span>
                    </h3>
                    {filter !== "all" && (
                      <button
                        type="button"
                        onClick={() => setFilter("all")}
                        className="text-[11px] font-semibold text-[#9A7B2C] hover:underline"
                      >
                        Hiển thị tất cả
                      </button>
                    )}
                  </div>

                  {items.map((item) => (
                    <div
                      key={item.id}
                      className={`card-lift rounded-2xl border ${st.cardBorder} bg-white p-4 shadow-[0_2px_10px_-4px_rgba(43,43,43,0.04)]`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ring-1 ring-inset ${st.badgeCls}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${st.dotCls}`} />
                              {item.event_id ?? item.source}
                            </span>
                            <span className="rounded bg-[#FAF3DF] px-2 py-0.5 text-[10px] font-semibold text-[#8A6D1F]">
                              {item.category}
                            </span>
                            {item.count > 0 && (
                              <span className="rounded-full bg-[#2B2B2B] px-2 py-0.5 font-mono text-[10px] font-bold text-[#DFC068]">
                                ×{item.count} lần
                              </span>
                            )}
                          </div>
                          <h4 className={`mt-1.5 text-sm font-bold ${st.titleCls}`}>{item.title}</h4>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] text-[#7A6F58]">
                          Gần nhất: {item.last_seen}
                        </span>
                      </div>

                      <p className="mt-2 text-xs leading-relaxed text-[#4F473B]">{item.summary}</p>

                      {item.details && (
                        <div className="mt-2 rounded-lg bg-[#FDFBF7] px-2.5 py-1.5 font-mono text-[11px] text-[#6E6450] ring-1 ring-[#EAE2CE]">
                          {item.details}
                        </div>
                      )}

                      <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-[#FAF6EC] px-3 py-2 text-xs text-[#5C5446]">
                        <span className="shrink-0 font-bold text-[#8A6D1F]">💡 Khuyến nghị:</span>
                        <span>{item.recommendation}</span>
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}

            {/* COLLAPSIBLE AI MARKDOWN PREVIEW */}
            <div className="rounded-2xl border border-[#EAE2CE] bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setShowMarkdown((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-bold text-[#2B2B2B] transition hover:bg-[#FAF6EC]"
              >
                <span className="flex items-center gap-2">
                  <span>📄 Xem trước báo cáo kỹ thuật (Markdown)</span>
                  <span className="rounded bg-[#FAF3DF] px-2 py-0.5 text-[10px] font-semibold text-[#8A6D1F]">
                    Đã khử trùng lặp sự kiện · Định dạng chuẩn phân tích
                  </span>
                </span>
                <span className="text-[#8A6D1F]">{showMarkdown ? "▲ Thu gọn" : "▼ Mở rộng"}</span>
              </button>
              {showMarkdown && (
                <div className="border-t border-[#EAE2CE] bg-[#2B2B2B] p-4">
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[#FAF3DF] select-text">
                    {report.ai_markdown}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* MEMORY DIAGNOSTIC CONFIRM MODAL */}
      {showMemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl border border-[#DFC992] bg-white p-5 shadow-2xl">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FAF3DF] text-xl ring-1 ring-[#DFC992]">
                🧠
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#2B2B2B]">
                  Windows Memory Diagnostic (mdsched.exe)
                </h3>
                <p className="text-[11px] text-[#7A6F58]">Công cụ kiểm tra lỗi thanh RAM chính chủ của Microsoft</p>
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-[#5C5446]">
              Công cụ này sẽ hiển thị tùy chọn <strong>Khởi động lại ngay để kiểm tra RAM</strong> hoặc <strong>Kiểm tra ở lần khởi động tiếp theo</strong>. Hãy lưu các tài liệu đang mở trước khi chọn khởi động lại.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowMemModal(false)}
                className="rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] px-3.5 py-2 text-xs font-semibold text-[#5C5446] hover:bg-stone-100 active:scale-[0.98]"
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={confirmLaunchMemoryDiagnostic}
                disabled={launchingMem}
                className="rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] px-4 py-2 text-xs font-bold text-white shadow-sm hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
              >
                {launchingMem ? "Đang mở…" : "Mở mdsched.exe ngay"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
