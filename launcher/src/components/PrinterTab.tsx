import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  PrinterFixResult,
  PrinterHostProbe,
  PrinterStatusReport,
  SpoolerRescueResult,
  TaskProgress,
} from "../types";

interface PrinterTabProps {
  isAdmin: boolean;
  onNotify: (msg: string) => void;
}

type BusyAction = null | "scanning" | "rescuing" | "patching" | "probing" | "connecting";

function isSpoolerRunning(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === "running" || s.includes("đang chạy") || s === "started";
}

function formatSpoolerLabel(status: string): string {
  const s = status.trim().toLowerCase();
  if (s === "running" || s.includes("đang chạy") || s === "started") return "Đang chạy";
  if (s === "stopped" || s.includes("đã dừng")) return "Đã dừng";
  if (s === "paused" || s.includes("tạm dừng")) return "Tạm dừng";
  return status || "Không xác định";
}

export function PrinterTab({ isAdmin, onNotify }: PrinterTabProps) {
  const [report, setReport] = useState<PrinterStatusReport | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [selectedFixIds, setSelectedFixIds] = useState<Set<string>>(new Set());
  const [rescueResult, setRescueResult] = useState<SpoolerRescueResult | null>(null);
  const [fixResult, setFixResult] = useState<PrinterFixResult | null>(null);

  const [hostIp, setHostIp] = useState("192.168.1.50");
  const [hostProbe, setHostProbe] = useState<PrinterHostProbe | null>(null);
  const [connectingUnc, setConnectingUnc] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api
      .onTaskProgress((p) => {
        if (p.module === "printer") {
          setProgress(p);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  const syncDefaultFixes = useCallback((data: PrinterStatusReport) => {
    setSelectedFixIds((prev) => {
      if (prev.size > 0) {
        const validIds = new Set(data.share_fixes.map((f) => f.id));
        const kept = new Set([...prev].filter((id) => validIds.has(id)));
        if (kept.size > 0) return kept;
      }
      const unapplied = data.share_fixes.filter((f) => !f.applied).map((f) => f.id);
      return new Set(unapplied.length > 0 ? unapplied : data.share_fixes.map((f) => f.id));
    });
  }, []);

  const loadStatus = useCallback(
    async (silent = false) => {
      setBusyAction("scanning");
      if (!silent) {
        setProgress({ module: "printer", step: "Đang quét trạng thái Print Spooler & máy in…", percent: 10 });
      }
      try {
        const data = await api.scanPrinterStatus();
        setReport(data);
        syncDefaultFixes(data);
        if (!silent) {
          onNotify(
            `Đã cập nhật: ${data.printers.length} máy in · ${data.stuck_jobs_count} lệnh kẹt (${data.stuck_files_count} tệp .SPL/.SHD).`
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!silent) onNotify(msg);
      } finally {
        setBusyAction(null);
        setProgress(null);
      }
    },
    [onNotify, syncDefaultFixes]
  );

  useEffect(() => {
    loadStatus(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCancelTask() {
    await api.cancelActiveTask();
    onNotify("Đã gửi lệnh hủy tác vụ máy in.");
  }

  async function handleRescueSpooler() {
    if (busyAction !== null) return;
    setBusyAction("rescuing");
    setRescueResult(null);
    setProgress({ module: "printer", step: "Đang dừng Spooler & xả lệnh in bị kẹt…", percent: 12 });
    try {
      const res = await api.rescuePrintSpooler();
      setRescueResult(res);
      onNotify(res.message);
      const refreshed = await api.scanPrinterStatus();
      setReport(refreshed);
      syncDefaultFixes(refreshed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg);
    } finally {
      setBusyAction(null);
      setProgress(null);
    }
  }

  function toggleFix(id: string) {
    if (busyAction !== null) return;
    setSelectedFixIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleApplyFixes() {
    if (busyAction !== null || selectedFixIds.size === 0) return;
    setBusyAction("patching");
    setFixResult(null);
    setProgress({ module: "printer", step: "Đang sao lưu Registry (.reg) & áp dụng bản vá Share máy in…", percent: 10 });
    try {
      const res = await api.applyPrinterShareFixes([...selectedFixIds]);
      setFixResult(res);
      onNotify(res.message);
      const refreshed = await api.scanPrinterStatus();
      setReport(refreshed);
      const remaining = refreshed.share_fixes.filter((f) => !f.applied).map((f) => f.id);
      setSelectedFixIds(new Set(remaining));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg);
    } finally {
      setBusyAction(null);
      setProgress(null);
    }
  }

  async function handleProbeHost() {
    if (busyAction !== null) return;
    const trimmed = hostIp.trim();
    if (!trimmed) {
      onNotify("Vui lòng nhập địa chỉ IP hoặc tên máy chủ share máy in (VD: 192.168.1.50).");
      return;
    }
    setBusyAction("probing");
    setHostProbe(null);
    setProgress({ module: "printer", step: `Đang kiểm tra cổng 445 (SMB) tới ${trimmed}…`, percent: 15 });
    try {
      const res = await api.probePrinterHost(trimmed);
      setHostProbe(res);
      onNotify(res.message);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg);
    } finally {
      setBusyAction(null);
      setProgress(null);
    }
  }

  async function handleConnectShared(uncPath: string) {
    if (busyAction !== null) return;
    setBusyAction("connecting");
    setConnectingUnc(uncPath);
    setProgress({ module: "printer", step: `Đang kết nối máy in mạng ${uncPath}…`, percent: 25 });
    try {
      const msg = await api.connectSharedPrinter(uncPath);
      onNotify(msg);
      const refreshed = await api.scanPrinterStatus();
      setReport(refreshed);
      syncDefaultFixes(refreshed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg);
    } finally {
      setBusyAction(null);
      setConnectingUnc(null);
      setProgress(null);
    }
  }

  const printerStats = useMemo(() => {
    const printers = report?.printers ?? [];
    const lanCount = printers.filter((p) => p.is_network).length;
    const localCount = printers.length - lanCount;
    return { total: printers.length, lanCount, localCount };
  }, [report]);

  const installedUncSet = useMemo(() => {
    const s = new Set<string>();
    (report?.printers ?? []).forEach((p) => {
      s.add(p.name.toLowerCase());
      s.add(p.port.toLowerCase());
    });
    return s;
  }, [report]);

  const spoolerUp = report ? isSpoolerRunning(report.spooler_status) : true;
  const hasStuck = (report?.stuck_jobs_count ?? 0) > 0 || (report?.stuck_files_count ?? 0) > 0;
  const appliedFixCount = (report?.share_fixes ?? []).filter((f) => f.applied).length;
  const isBusy = busyAction !== null;

  return (
    <div key="tab-printer" className="tab-panel-enter flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
      {/* ADMIN WARNING BANNER */}
      {!isAdmin && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>
              <strong>Thiếu quyền Administrator:</strong> Dừng/khởi động lại dịch vụ <code>Print Spooler</code>, xóa tệp kẹt trong <code>System32\spool\PRINTERS</code> và vá Registry Share máy in yêu cầu chạy AllSoft Desktop bằng quyền <strong>Run as Administrator</strong>.
            </span>
          </div>
        </div>
      )}

      {/* ACTIVE TASK PROGRESS BAR WITH CANCEL */}
      {isBusy && progress && (
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#DFC992] bg-[#FAF3DF]/80 px-4 py-2.5 shadow-xs">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#8A6D1F]">
              <span className="truncate">{progress.step}</span>
              <span className="shrink-0 font-mono font-bold">{progress.percent}%</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#EFE9D8]">
              <div
                className="progress-smooth h-full rounded-full bg-gradient-to-r from-[#EA580C] via-[#C5A044] to-[#9A7B2C]"
                style={{ width: `${Math.min(100, Math.max(6, progress.percent))}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancelTask}
            className="shrink-0 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 transition hover:bg-red-50 active:scale-[0.98]"
          >
            ✕ Hủy tác vụ
          </button>
        </div>
      )}

      {/* SCROLLABLE MAIN WORKSPACE */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-2">
        {/* ============================================================
            KHU VỰC 1: CỨU HỘ NHANH TREO LỆNH IN (NỔI BẬT TRÊN CÙNG)
           ============================================================ */}
        <section className="rounded-2xl border border-[#DFC992] bg-white p-4 shadow-[0_3px_14px_-4px_rgba(181,148,59,0.14)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-[#2B2B2B]">
                <span>🖨️ Cứu hộ nhanh Treo lệnh in & Print Spooler</span>
                {hasStuck && (
                  <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-bold text-red-700 ring-1 ring-inset ring-red-200">
                    Phát hiện kẹt lệnh in!
                  </span>
                )}
              </h2>
              <p className="mt-0.5 text-xs text-[#6E6450]">
                Tự động dừng dịch vụ Print Spooler, xóa sạch tệp hàng đợi lỗi (<code>.SPL / .SHD</code>) và khởi động lại ngay trong 1 click.
              </p>
            </div>
            {isAdmin ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                🛡️ Đã cấp quyền Admin
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                ⚠️ Chưa có quyền Admin
              </span>
            )}
          </div>

          {/* 3 STATUS CARDS */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {/* Card 1: Print Spooler Service */}
            <div
              className={`card-lift flex items-center justify-between rounded-xl border px-4 py-3 ${
                spoolerUp
                  ? "border-emerald-200/90 bg-emerald-50/40"
                  : "border-red-200/90 bg-red-50/50"
              }`}
            >
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#6E6450]">
                  Dịch vụ Print Spooler
                </div>
                <div
                  className={`mt-1 flex items-center gap-1.5 text-sm font-extrabold ${
                    spoolerUp ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      spoolerUp ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  {report ? formatSpoolerLabel(report.spooler_status) : "Đang kiểm tra…"}
                </div>
                <div className="mt-0.5 text-[11px] text-[#7A6F58]">Windows Spooler Service</div>
              </div>
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ring-1 ${
                  spoolerUp
                    ? "bg-white text-emerald-700 ring-emerald-200"
                    : "bg-white text-red-700 ring-red-200"
                }`}
              >
                {spoolerUp ? "⚙️" : "⛔"}
              </div>
            </div>

            {/* Card 2: Stuck Print Jobs */}
            <div
              className={`card-lift flex items-center justify-between rounded-xl border px-4 py-3 ${
                hasStuck
                  ? "border-red-300 bg-red-50/65 shadow-[0_2px_10px_-4px_rgba(220,38,38,0.18)]"
                  : "border-emerald-200/90 bg-emerald-50/35"
              }`}
            >
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#6E6450]">
                  Lệnh in đang kẹt
                </div>
                <div
                  className={`mt-1 font-mono text-base font-extrabold ${
                    hasStuck ? "text-red-700" : "text-emerald-700"
                  }`}
                >
                  {report ? `${report.stuck_jobs_count} lệnh kẹt` : "—"}
                </div>
                <div className={`mt-0.5 text-[11px] font-medium ${hasStuck ? "text-red-700/90" : "text-[#7A6F58]"}`}>
                  {report
                    ? `${report.stuck_files_count} tệp .SPL/.SHD trong Spool`
                    : "Đang quét hàng đợi…"}
                </div>
              </div>
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ring-1 ${
                  hasStuck
                    ? "bg-red-600 text-white ring-red-500"
                    : "bg-white text-emerald-700 ring-emerald-200"
                }`}
              >
                {hasStuck ? "🚨" : "✅"}
              </div>
            </div>

            {/* Card 3: Printers Count */}
            <div className="card-lift flex items-center justify-between rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] px-4 py-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#6E6450]">
                  Số máy in trên máy
                </div>
                <div className="mt-1 font-mono text-base font-extrabold text-[#2B2B2B]">
                  {report ? `${printerStats.total} máy in` : "—"}
                </div>
                <div className="mt-0.5 text-[11px] text-[#7A6F58]">
                  {printerStats.lanCount} máy in LAN · {printerStats.localCount} USB / Cục bộ
                </div>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FAF3DF] text-lg text-[#9A7B2C] ring-1 ring-[#DFC992]">
                🖨️
              </div>
            </div>
          </div>

          {/* 1-CLICK RESCUE ACTION BAR */}
          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5 border-t border-[#F2ECE0] pt-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleRescueSpooler}
                disabled={isBusy}
                className="rounded-xl bg-gradient-to-r from-[#EA580C] to-[#DC2626] px-5 py-2.5 text-xs font-bold text-white shadow-md transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busyAction === "rescuing"
                  ? "⟳ Đang xả lệnh kẹt & khởi động lại Spooler…"
                  : "🖨️ Xả lệnh kẹt & Khởi động lại Spooler (1-Click)"}
              </button>

              <button
                type="button"
                onClick={() => loadStatus(false)}
                disabled={isBusy}
                className="rounded-xl border border-[#DFC992] bg-[#FAF3DF] px-4 py-2.5 text-xs font-bold text-[#8A6D1F] transition-all duration-150 hover:bg-[#F3E6C3] active:scale-[0.98] disabled:opacity-45"
              >
                {busyAction === "scanning" ? "Đang quét…" : "🔄 Quét lại"}
              </button>
            </div>

            <span className="text-[11px] text-[#7A6F58]">
              An toàn 100% — Không xóa Driver hay cấu hình máy in đã cài
            </span>
          </div>

          {/* RESCUE RESULT BANNER */}
          {rescueResult && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/75 px-3.5 py-2.5 text-xs text-emerald-950">
              <div className="flex items-center gap-2 font-semibold">
                <span className="text-base">✅</span>
                <span>{rescueResult.message}</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="rounded-md bg-white px-2 py-0.5 font-bold text-emerald-800 ring-1 ring-emerald-200">
                  Đã xóa {rescueResult.cleared_files} tệp .SPL/.SHD
                </span>
                {rescueResult.spooler_restarted && (
                  <span className="rounded-md bg-white px-2 py-0.5 font-bold text-[#8A6D1F] ring-1 ring-[#DFC992]">
                    Spooler đã khởi động lại
                  </span>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ============================================================
            KHU VỰC 2: BỘ VÁ LỖI SHARE MÁY IN MẠNG LAN (WINDOWS 10/11)
           ============================================================ */}
        <section className="overflow-hidden rounded-2xl border border-[#EAE2CE] bg-white shadow-[0_2px_10px_-4px_rgba(43,43,43,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EAE2CE] bg-[#FAF6EC] px-4 py-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-[#2B2B2B]">
                <span>🛡️ Bộ Vá lỗi Share Máy in Mạng LAN (Windows 10/11)</span>
              </h2>
              <p className="mt-0.5 text-xs text-[#6E6450]">
                Khắc phục triệt để các mã lỗi kinh điển khi kết nối máy in chia sẻ qua mạng nội bộ bệnh viện / văn phòng.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-[#8A6D1F] ring-1 ring-[#DFC992]">
              Đã áp dụng {appliedFixCount}/{report?.share_fixes.length ?? 4} bản vá
            </span>
          </div>

          <div className="p-4">
            {/* REGISTRY BACKUP SAFETY NOTICE */}
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#DFC992] bg-[#FAF3DF]/70 px-3.5 py-2 text-xs text-[#8A6D1F]">
              <span className="text-sm">💾</span>
              <span>
                <strong>Bảo vệ an toàn Registry:</strong> Tự động sao lưu khóa Registry thành tệp <code>.reg</code> trong thư mục <code>Backups\</code> trước khi áp dụng.
              </span>
            </div>

            {/* 4 SHARE FIXES CHECKLIST */}
            <div className="divide-y divide-[#F2ECE0] overflow-hidden rounded-xl border border-[#EAE2CE]">
              {(report?.share_fixes ?? []).map((fix) => {
                const isChecked = selectedFixIds.has(fix.id);
                return (
                  <label
                    key={fix.id}
                    className={`flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors ${
                      isChecked ? "bg-[#FAF3DF]/45" : "bg-white hover:bg-[#FDFBF7]"
                    } ${isBusy ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleFix(fix.id)}
                      disabled={isBusy}
                      className="mt-0.5 h-4 w-4 cursor-pointer rounded accent-[#B5943B]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-[#2B2B2B] px-2 py-0.5 font-mono text-[11px] font-bold text-[#DFC068]">
                          {fix.code}
                        </span>
                        <span className="text-xs font-bold text-[#2B2B2B]">{fix.title}</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[#5C5446]">{fix.description}</p>
                      {fix.risk_note && (
                        <p className="mt-1 text-[11px] text-[#8A6D1F]">
                          ℹ️ {fix.risk_note}
                        </p>
                      )}
                      {fix.reg_path && (
                        <p className="mt-1 truncate font-mono text-[10px] text-[#8A7E66]" title={fix.reg_path}>
                          Key: {fix.reg_path}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {fix.applied ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          ✓ Đã áp dụng
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600 ring-1 ring-inset ring-stone-200">
                          Chưa áp dụng
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            {/* FOOTER ACTIONS FOR FIXES */}
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    setSelectedFixIds(new Set((report?.share_fixes ?? []).map((f) => f.id)))
                  }
                  className="font-semibold text-[#9A7B2C] hover:underline disabled:opacity-40"
                >
                  Chọn tất cả ({report?.share_fixes.length ?? 0})
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    setSelectedFixIds(
                      new Set((report?.share_fixes ?? []).filter((f) => !f.applied).map((f) => f.id))
                    )
                  }
                  className="font-semibold text-[#6E6450] hover:text-[#2B2B2B] hover:underline disabled:opacity-40"
                >
                  Chỉ chọn mục chưa áp dụng
                </button>
              </div>

              <button
                type="button"
                onClick={handleApplyFixes}
                disabled={isBusy || selectedFixIds.size === 0}
                className="rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] px-5 py-2 text-xs font-bold text-white shadow-sm transition-all duration-150 hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyAction === "patching"
                  ? "Đang sao lưu & áp dụng bản vá…"
                  : `🛡️ Áp dụng các bản vá đã chọn (${selectedFixIds.size})`}
              </button>
            </div>

            {/* FIX RESULT + BACKUP .REG BANNER */}
            {fixResult && (
              <div className="mt-3.5 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-950">
                <div className="flex flex-wrap items-center justify-between gap-2 font-bold">
                  <span>✅ {fixResult.message}</span>
                  {fixResult.spooler_restarted && (
                    <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                      Print Spooler đã khởi động lại
                    </span>
                  )}
                </div>

                {fixResult.backup_reg_path && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#DFC992] bg-[#FAF6EC] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[#8A6D1F]">
                        💾 Tệp sao lưu Registry (.reg) đã lưu tại
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] font-semibold text-[#2B2B2B] select-text">
                        {fixResult.backup_reg_path}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => api.openPath(fixResult.backup_reg_path!).catch(() => {})}
                      className="shrink-0 rounded-lg border border-[#DFC992] bg-white px-2.5 py-1 text-[11px] font-bold text-[#8A6D1F] hover:bg-[#FAF3DF] active:scale-[0.98]"
                    >
                      Mở vị trí file
                    </button>
                  </div>
                )}

                {fixResult.errors.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-red-700">
                    {fixResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ============================================================
            KHU VỰC 3: KIỂM TRA & KẾT NỐI MÁY CHỦ SHARE + DANH SÁCH MÁY IN
           ============================================================ */}
        <section className="space-y-4">
          {/* 3A: PROBE PRINTER HOST & QUICK CONNECT */}
          <div className="overflow-hidden rounded-2xl border border-[#EAE2CE] bg-white shadow-[0_2px_10px_-4px_rgba(43,43,43,0.04)]">
            <div className="border-b border-[#EAE2CE] bg-[#FAF6EC] px-4 py-3">
              <h2 className="text-sm font-bold text-[#2B2B2B]">
                🌐 Kiểm tra & Kết nối nhanh Máy chủ Share Máy in (LAN · TCP 445)
              </h2>
              <p className="mt-0.5 text-xs text-[#6E6450]">
                Nhập địa chỉ IP hoặc tên máy tính đang cắm máy in share để kiểm tra thông mạng SMB cổng 445 và kết nối nhanh chỉ với 1 click.
              </p>
            </div>

            <div className="p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleProbeHost();
                }}
                className="flex flex-wrap items-center gap-2.5"
              >
                <div className="relative min-w-[220px] flex-1">
                  <input
                    type="text"
                    value={hostIp}
                    onChange={(e) => setHostIp(e.target.value)}
                    disabled={isBusy}
                    placeholder="Nhập IP máy chủ share (VD: 192.168.1.50)"
                    className="w-full rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] px-3.5 py-2 font-mono text-xs text-[#2B2B2B] placeholder-[#948973] outline-none transition-all focus:border-[#B5943B] focus:bg-white focus:ring-2 focus:ring-[#B5943B]/15"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isBusy || !hostIp.trim()}
                  className="rounded-xl bg-[#2B2B2B] px-4 py-2 text-xs font-bold text-[#DFC068] shadow-sm transition-all duration-150 hover:bg-[#3A3A3A] active:scale-[0.98] disabled:opacity-45"
                >
                  {busyAction === "probing"
                    ? "Đang kiểm tra cổng 445…"
                    : "🔍 Kiểm tra cổng 445 & Tìm máy in"}
                </button>
              </form>

              {/* PROBE RESULTS */}
              {hostProbe && (
                <div className="mt-3.5 space-y-2.5">
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
                      hostProbe.reachable_smb
                        ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
                        : "border-red-200 bg-red-50/70 text-red-900"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <span>{hostProbe.reachable_smb ? "✅" : "❌"}</span>
                      <span>{hostProbe.message}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="rounded-md bg-white px-2 py-0.5 font-bold text-[#2B2B2B] ring-1 ring-black/10">
                        Host: {hostProbe.host_ip}
                      </span>
                      {hostProbe.latency_ms !== null && (
                        <span className="rounded-md bg-white px-2 py-0.5 font-bold text-emerald-700 ring-1 ring-emerald-200">
                          Độ trễ: {hostProbe.latency_ms} ms
                        </span>
                      )}
                    </div>
                  </div>

                  {hostProbe.shared_printers.length > 0 && (
                    <div className="divide-y divide-[#F2ECE0] overflow-hidden rounded-xl border border-[#EAE2CE]">
                      {hostProbe.shared_printers.map((sp) => {
                        const alreadyConnected = installedUncSet.has(sp.unc_path.toLowerCase());
                        const isConnectingThis = connectingUnc === sp.unc_path;
                        return (
                          <div
                            key={sp.unc_path}
                            className="flex flex-wrap items-center justify-between gap-3 bg-[#FDFBF7]/70 px-4 py-2.5 text-xs hover:bg-[#FAF3DF]/35"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-bold text-[#2B2B2B]">🖨️ {sp.name}</span>
                                <span className="rounded bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-[#8A6D1F] ring-1 ring-[#EAE2CE]">
                                  {sp.unc_path}
                                </span>
                              </div>
                              {sp.remark && (
                                <p className="mt-0.5 text-[11px] text-[#6E6450]">{sp.remark}</p>
                              )}
                            </div>

                            {alreadyConnected ? (
                              <span className="shrink-0 rounded-lg bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                                ✓ Đã kết nối
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleConnectShared(sp.unc_path)}
                                disabled={isBusy}
                                className="shrink-0 rounded-lg bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] px-3.5 py-1.5 text-[11px] font-bold text-white shadow-xs transition-all duration-150 hover:brightness-105 active:scale-[0.98] disabled:opacity-45"
                              >
                                {isConnectingThis ? "Đang kết nối…" : "+ Kết nối ngay"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 3B: INSTALLED PRINTERS TABLE */}
          <div className="overflow-hidden rounded-2xl border border-[#EAE2CE] bg-white shadow-[0_2px_10px_-4px_rgba(43,43,43,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EAE2CE] bg-[#FAF6EC] px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-[#2B2B2B]">
                  📋 Danh sách Máy in hiện có trên máy trạm ({printerStats.total})
                </h2>
              </div>
              <span className="text-[11px] font-semibold text-[#7A6F58]">
                LAN: {printerStats.lanCount} · USB/Cục bộ: {printerStats.localCount}
              </span>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[740px]">
                <div className="grid grid-cols-12 gap-3 border-b border-[#EAE2CE] bg-[#FDFBF7] px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[#7A6F58]">
                  <div className="col-span-3">Tên máy in</div>
                  <div className="col-span-3">Driver</div>
                  <div className="col-span-2">Cổng / IP</div>
                  <div className="col-span-1 text-center">Loại</div>
                  <div className="col-span-1 text-center">Lệnh in</div>
                  <div className="col-span-2 text-right">Trạng thái</div>
                </div>

                <div className="divide-y divide-[#F2ECE0]">
                  {(report?.printers ?? []).map((p, idx) => {
                    const stuck = p.job_count > 0;
                    return (
                      <div
                        key={`${p.name}-${idx}`}
                        className={`grid grid-cols-12 items-center gap-3 px-4 py-2.5 text-xs ${
                          stuck ? "bg-red-50/35" : "hover:bg-[#FAF3DF]/30"
                        }`}
                      >
                        <div className="col-span-3 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-semibold text-[#2B2B2B]" title={p.name}>
                              {p.name}
                            </span>
                            {p.is_default && (
                              <span className="shrink-0 rounded-full bg-[#FAF3DF] px-2 py-0.5 text-[10px] font-bold text-[#8A6D1F] ring-1 ring-inset ring-[#DFC992]">
                                Mặc định
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="col-span-3 truncate text-[#5C5446]" title={p.driver}>
                          {p.driver}
                        </div>

                        <div className="col-span-2 truncate font-mono text-[11px] text-[#6E6450]" title={p.port}>
                          {p.port}
                        </div>

                        <div className="col-span-1 flex justify-center">
                          {p.is_network ? (
                            <span className="rounded-md bg-[#2B2B2B] px-2 py-0.5 text-[10px] font-bold text-[#DFC068]">
                              LAN
                            </span>
                          ) : (
                            <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-[#5C5446] ring-1 ring-stone-200">
                              USB
                            </span>
                          )}
                        </div>

                        <div className="col-span-1 text-center font-mono">
                          {stuck ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-extrabold text-red-700 ring-1 ring-inset ring-red-200">
                              {p.job_count}
                            </span>
                          ) : (
                            <span className="text-[#8A7E66]">0</span>
                          )}
                        </div>

                        <div className="col-span-2 flex justify-end">
                          {stuck ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-bold text-red-700 ring-1 ring-inset ring-red-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                              {p.status}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {p.status}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {report && report.printers.length === 0 && (
                    <div className="py-10 text-center text-xs text-[#8A7E66]">
                      Chưa phát hiện máy in nào được cài trên máy trạm này.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
