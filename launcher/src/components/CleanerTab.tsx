import { useEffect, useMemo, useState } from "react";
import { api, CLEANER_TARGETS } from "../api";
import type {
  CleanerLevel,
  CleanerRunResult,
  CleanerScanItem,
  CleanerScanResult,
  CleanerTargetMeta,
  TaskProgress,
} from "../types";

interface CleanerTabProps {
  isAdmin: boolean;
  onNotify: (msg: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 0.1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${Math.max(1, Math.round(kb))} KB`;
}

const LEVEL_CONFIG: Record<
  CleanerLevel,
  {
    title: string;
    subtitle: string;
    icon: string;
    headerBg: string;
    border: string;
    badge: string;
  }
> = {
  green: {
    title: "Cơ bản (An toàn tuyệt đối)",
    subtitle: "Các thư mục tạm & thùng rác có thể xóa thường xuyên, mặc định đã chọn sẵn.",
    icon: "🟢",
    headerBg: "bg-emerald-50/70",
    border: "border-emerald-200/80",
    badge: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  },
  yellow: {
    title: "Trung bình (Bộ đệm & Cập nhật)",
    subtitle: "Giải phóng dung lượng lớn từ Windows Update & Cache trình duyệt (không ảnh hưởng dữ liệu đăng nhập).",
    icon: "🟡",
    headerBg: "bg-amber-50/70",
    border: "border-amber-200/80",
    badge: "bg-amber-100 text-amber-800 ring-amber-200",
  },
  red: {
    title: "Chuyên sâu (Hệ thống & Nâng cao)",
    subtitle: "Tác động tới kho thành phần WinSxS, nhật ký hệ thống cũ hoặc tệp Memory Dump BSOD.",
    icon: "🔴",
    headerBg: "bg-red-50/60",
    border: "border-red-200/80",
    badge: "bg-red-100 text-red-800 ring-red-200",
  },
};

export function CleanerTab({ isAdmin, onNotify }: CleanerTabProps) {
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () => new Set(CLEANER_TARGETS.filter((t) => t.defaultChecked).map((t) => t.id))
  );
  const [scanResult, setScanResult] = useState<CleanerScanResult | null>(null);
  const [runResult, setRunResult] = useState<CleanerRunResult | null>(null);
  const [busyMode, setBusyMode] = useState<"idle" | "scanning" | "cleaning">("idle");
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [pendingRedTarget, setPendingRedTarget] = useState<CleanerTargetMeta | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api
      .onTaskProgress((p) => {
        if (p.module === "cleaner") {
          setProgress(p);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  const scanMap = useMemo(() => {
    const map = new Map<string, CleanerScanItem>();
    scanResult?.items.forEach((it) => map.set(it.id, it));
    return map;
  }, [scanResult]);

  const selectedScanSummary = useMemo(() => {
    if (!scanResult) return { bytes: 0, files: 0 };
    let bytes = 0;
    let files = 0;
    for (const id of checkedIds) {
      const it = scanMap.get(id);
      if (it) {
        bytes += it.size_bytes;
        files += it.file_count;
      }
    }
    return { bytes, files };
  }, [scanResult, checkedIds, scanMap]);

  function handleToggleTarget(target: CleanerTargetMeta) {
    if (busyMode !== "idle") return;
    if (checkedIds.has(target.id)) {
      setCheckedIds((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      return;
    }
    // BẮT BUỘC: Mức Đỏ phải xác nhận cảnh báo trước khi cho phép tích
    if (target.level === "red") {
      setPendingRedTarget(target);
      return;
    }
    setCheckedIds((prev) => new Set(prev).add(target.id));
  }

  function confirmRedTarget() {
    if (!pendingRedTarget) return;
    setCheckedIds((prev) => new Set(prev).add(pendingRedTarget.id));
    setPendingRedTarget(null);
  }

  async function handleScan() {
    if (busyMode !== "idle") return;
    setBusyMode("scanning");
    setRunResult(null);
    setProgress({ module: "cleaner", step: "Đang quét thử dung lượng các hạng mục…", percent: 8 });
    try {
      const allIds = CLEANER_TARGETS.map((t) => t.id);
      const res = await api.scanCleanerTargets(allIds);
      setScanResult(res);
      onNotify(`Quét thử hoàn tất! Có thể dọn sạch các mục đã chọn ở Bước 2.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onNotify(msg);
    } finally {
      setBusyMode("idle");
    }
  }

  async function handleClean() {
    if (busyMode !== "idle" || !scanResult || checkedIds.size === 0) return;
    setBusyMode("cleaning");
    setRunResult(null);
    setProgress({ module: "cleaner", step: "Đang bắt đầu dọn dẹp an toàn…", percent: 5 });
    try {
      const res = await api.runCleaner([...checkedIds]);
      setRunResult(res);
      if (res.cancelled) {
        onNotify(
          `Đã dừng dọn rác: giải phóng ${formatBytes(res.freed_bytes)} (${res.deleted_files.toLocaleString("vi-VN")} tệp).`
        );
      } else {
        onNotify(
          `Dọn rác hoàn tất: giải phóng ${formatBytes(res.freed_bytes)} · xóa ${res.deleted_files.toLocaleString("vi-VN")} tệp!`
        );
      }
      // Cập nhật lại dung lượng các mục đã dọn về 0 để trực quan
      if (!res.cancelled) {
        setScanResult((prev) => {
          if (!prev) return prev;
          const updated = prev.items.map((item) =>
            checkedIds.has(item.id) ? { ...item, size_bytes: 0, file_count: 0 } : item
          );
          return {
            ...prev,
            items: updated,
            total_bytes: updated.reduce((s, i) => s + i.size_bytes, 0),
            total_files: updated.reduce((s, i) => s + i.file_count, 0),
          };
        });
      }
    } catch (err) {
      onNotify(`Lỗi khi dọn rác: ${err}`);
    } finally {
      setBusyMode("idle");
    }
  }

  async function handleCancel() {
    await api.cancelActiveTask();
    onNotify("Đã gửi lệnh hủy tác vụ dọn rác.");
  }

  const levels: CleanerLevel[] = ["green", "yellow", "red"];
  const canClean = busyMode === "idle" && scanResult !== null && checkedIds.size > 0;

  return (
    <div key="tab-cleaner" className="tab-panel-enter flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
      {/* ADMIN WARNING BANNER */}
      {!isAdmin && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>
              <strong>Thiếu quyền Administrator:</strong> Các mục hệ thống như <code>Windows\Temp</code>, <code>Windows Update Cache</code>, <code>Prefetch</code> và <code>DISM</code> cần chạy AllSoft Desktop với quyền <strong>Run as Administrator</strong>.
            </span>
          </div>
        </div>
      )}

      {/* TOP 2-STEP ACTION TOOLBAR */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#EAE2CE] bg-white px-4 py-3 shadow-[0_2px_10px_-4px_rgba(43,43,43,0.04)]">
        <div className="flex flex-wrap items-center gap-2.5">
          {busyMode === "idle" ? (
            <>
              <button
                type="button"
                onClick={handleScan}
                className="rounded-xl border border-[#DFC992] bg-[#FAF3DF] px-4 py-2 text-xs font-bold text-[#8A6D1F] shadow-xs transition-all duration-150 hover:bg-[#F3E6C3] active:scale-[0.98]"
              >
                🔍 1. Quét thử tính dung lượng
              </button>

              <button
                type="button"
                onClick={handleClean}
                disabled={!canClean}
                title={
                  !scanResult
                    ? "Hãy bấm '1. Quét thử tính dung lượng' trước khi dọn dẹp"
                    : checkedIds.size === 0
                    ? "Chọn ít nhất 1 hạng mục để dọn"
                    : "Bắt đầu dọn các mục đã chọn"
                }
                className="rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] px-4 py-2 text-xs font-bold text-white shadow-sm transition-all duration-150 hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                🧹 2. Dọn dẹp ngay ({checkedIds.size} mục)
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-[#DFC992] bg-[#FAF3DF]/70 px-3.5 py-1.5">
              <div className="w-60 sm:w-80">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[#8A6D1F]">
                  <span className="truncate pr-2">{progress?.step ?? "Đang xử lý…"}</span>
                  <span className="shrink-0 font-mono">{progress?.percent ?? 0}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#EFE9D8]">
                  <div
                    className="progress-smooth h-full rounded-full bg-gradient-to-r from-[#C5A044] to-[#9A7B2C]"
                    style={{ width: `${Math.min(100, Math.max(4, progress?.percent ?? 8))}%` }}
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
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {scanResult && (
            <div className="rounded-xl border border-[#DFC992] bg-[#FAF6EC] px-3 py-1.5 text-xs">
              <span className="text-[#6E6450]">Dự kiến giải phóng: </span>
              <strong className="font-mono font-extrabold text-[#9A7B2C]">
                {formatBytes(selectedScanSummary.bytes)}
              </strong>
              <span className="ml-1.5 text-[11px] text-[#7A6F58]">
                ({selectedScanSummary.files.toLocaleString("vi-VN")} tệp)
              </span>
            </div>
          )}

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
      </div>

      {/* CLEAN RESULT REPORT BANNER */}
      {runResult && (
        <div className="mb-3.5 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-950 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 font-bold">
              <span className="text-base">{runResult.cancelled ? "⏹️" : "✅"}</span>
              <span>
                {runResult.cancelled ? "Đã dừng dọn rác giữa chừng:" : "Báo cáo tổng kết dọn rác:"}
              </span>
              <span className="rounded-lg bg-white px-2.5 py-0.5 font-mono text-emerald-800 ring-1 ring-emerald-200">
                Đã giải phóng {formatBytes(runResult.freed_bytes)}
              </span>
              <span className="rounded-lg bg-white px-2.5 py-0.5 font-mono text-[#2B2B2B] ring-1 ring-emerald-200">
                Đã xóa {runResult.deleted_files.toLocaleString("vi-VN")} tệp
              </span>
              <span className="rounded-lg bg-white px-2.5 py-0.5 font-mono text-[#6E6450] ring-1 ring-emerald-200">
                Bỏ qua {runResult.skipped_locked_files} tệp đang khóa an toàn
              </span>
            </div>
          </div>
          {runResult.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-6 text-[11px] text-emerald-900">
              {runResult.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 3 COLOR-CODED GROUPS (10 TARGETS) */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 pb-2">
        {levels.map((level) => {
          const cfg = LEVEL_CONFIG[level];
          const groupTargets = CLEANER_TARGETS.filter((t) => t.level === level);
          return (
            <section
              key={level}
              className={`overflow-hidden rounded-2xl border ${cfg.border} bg-white shadow-[0_2px_10px_-4px_rgba(43,43,43,0.04)]`}
            >
              <div className={`flex flex-wrap items-center justify-between gap-2 border-b ${cfg.border} ${cfg.headerBg} px-4 py-2.5`}>
                <div>
                  <h3 className="flex items-center gap-2 text-xs font-bold text-[#2B2B2B]">
                    <span>{cfg.icon}</span>
                    <span>{cfg.title}</span>
                  </h3>
                  <p className="mt-0.5 text-[11px] text-[#6E6450]">{cfg.subtitle}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${cfg.badge}`}>
                  {groupTargets.filter((t) => checkedIds.has(t.id)).length}/{groupTargets.length} đã chọn
                </span>
              </div>

              <div className="divide-y divide-[#F2ECE0]">
                {groupTargets.map((target) => {
                  const isChecked = checkedIds.has(target.id);
                  const stat = scanMap.get(target.id);
                  return (
                    <label
                      key={target.id}
                      onClick={(e) => {
                        e.preventDefault();
                        handleToggleTarget(target);
                      }}
                      className={`flex cursor-pointer items-start gap-3.5 px-4 py-3 transition-colors ${
                        isChecked ? "bg-[#FAF3DF]/45" : "hover:bg-[#FDFBF7]"
                      } ${busyMode !== "idle" ? "pointer-events-none opacity-60" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        readOnly
                        className="mt-0.5 h-4 w-4 cursor-pointer rounded accent-[#B5943B]"
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-[#2B2B2B]">{target.name}</span>
                          {target.level === "red" && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                              Cần xác nhận
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-[#6E6450]">{target.description}</p>
                        {target.note && (
                          <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-[#FAF6EC] px-2 py-0.5 text-[11px] font-semibold text-[#8A6D1F] ring-1 ring-[#EAE2CE]">
                            🛡️ {target.note}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        {stat ? (
                          <>
                            <div className="font-mono text-xs font-bold text-[#2B2B2B]">
                              {formatBytes(stat.size_bytes)}
                            </div>
                            <div className="font-mono text-[10px] text-[#7A6F58]">
                              {stat.file_count.toLocaleString("vi-VN")} tệp
                            </div>
                          </>
                        ) : (
                          <span className="text-[11px] italic text-[#948973]">Chưa quét</span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* RED LEVEL CONFIRMATION MODAL */}
      {pendingRedTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-xl ring-1 ring-red-200">
                🔴
              </div>
              <div>
                <h3 className="text-sm font-bold text-red-900">
                  Cảnh báo hạng mục Chuyên sâu
                </h3>
                <p className="text-xs font-semibold text-[#5C5446]">{pendingRedTarget.name}</p>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-red-200/80 bg-red-50/50 p-3 text-xs leading-relaxed text-red-900">
              {pendingRedTarget.warning}
            </div>

            <p className="mt-3 text-[11px] text-[#6E6450]">
              Bạn có chắc chắn hiểu rõ tác động và muốn tích chọn hạng mục này không?
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingRedTarget(null)}
                className="rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] px-3.5 py-2 text-xs font-semibold text-[#5C5446] hover:bg-stone-100 active:scale-[0.98]"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={confirmRedTarget}
                className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 active:scale-[0.98]"
              >
                Tôi hiểu, cho phép chọn
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
