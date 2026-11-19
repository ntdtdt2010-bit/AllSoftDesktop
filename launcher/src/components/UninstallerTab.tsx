import { useEffect, useMemo, useState } from "react";
import { api, type InstalledProgram } from "../api";
import type { LeftoverCleanResult, LeftoverItem, LeftoverScanResult, TaskProgress } from "../types";

interface UninstallerTabProps {
  isAdmin: boolean;
  programs: InstalledProgram[];
  query: string;
  scanning: boolean;
  onRefresh: () => void;
  onExportInventory: () => void;
  onNotify: (msg: string) => void;
}

type InventoryFilter = "all" | "external" | "standard";
type WizardStep = 1 | 2 | 3 | "done";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  if (mb >= 0.1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function UninstallerTab({
  isAdmin,
  programs,
  query,
  scanning,
  onRefresh,
  onExportInventory,
  onNotify,
}: UninstallerTabProps) {
  const [inventoryFilter, setInventoryFilter] = useState<InventoryFilter>("all");

  // 3-Step Clean Uninstall Wizard state
  const [targetProgram, setTargetProgram] = useState<InstalledProgram | null>(null);
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [step1DoneMsg, setStep1DoneMsg] = useState<string | null>(null);
  const [leftoverScan, setLeftoverScan] = useState<LeftoverScanResult | null>(null);
  const [selectedLeftoverIds, setSelectedLeftoverIds] = useState<Set<string>>(new Set());
  const [cleanResult, setCleanResult] = useState<LeftoverCleanResult | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    api
      .onTaskProgress((p) => {
        if (p.module === "uninstaller") {
          setProgress(p);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  const counts = useMemo(() => {
    const total = programs.length;
    const standard = programs.filter((p) => p.in_catalog).length;
    const external = total - standard;
    return { total, standard, external };
  }, [programs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return programs.filter((item) => {
      if (inventoryFilter === "standard" && !item.in_catalog) return false;
      if (inventoryFilter === "external" && item.in_catalog) return false;
      if (!q) return true;
      return (item.name + " " + item.publisher + " " + item.version).toLowerCase().includes(q);
    });
  }, [programs, inventoryFilter, query]);

  const totalSizeMb = useMemo(
    () => programs.reduce((acc, p) => acc + (p.size_mb || 0), 0),
    [programs]
  );

  function openWizard(prog: InstalledProgram) {
    setTargetProgram(prog);
    setWizardStep(1);
    setWizardBusy(false);
    setProgress(null);
    setStep1DoneMsg(null);
    setLeftoverScan(null);
    setSelectedLeftoverIds(new Set());
    setCleanResult(null);
  }

  function closeWizard() {
    if (wizardBusy) return;
    setTargetProgram(null);
  }

  async function handleCancelWizardTask() {
    await api.cancelActiveTask();
    onNotify("Đã gửi lệnh hủy tác vụ gỡ cài đặt.");
  }

  async function runStep1Native() {
    if (!targetProgram || wizardBusy) return;
    setWizardBusy(true);
    setProgress({ module: "uninstaller", step: "Đang khởi chạy trình gỡ cài đặt gốc…", percent: 12 });
    try {
      const res = await api.runNativeUninstaller(targetProgram);
      if (res.cancelled) {
        onNotify(res.message);
        setWizardBusy(false);
        return;
      }
      setStep1DoneMsg(res.message);
      setWizardBusy(false);
      // Tự động chuyển sang Bước 2 và quét tàn dư
      await runStep2Scan(targetProgram);
    } catch (e) {
      onNotify(`Lỗi khi chạy trình gỡ gốc: ${e}`);
      setWizardBusy(false);
    }
  }

  async function runStep2Scan(prog: InstalledProgram) {
    setWizardStep(2);
    setWizardBusy(true);
    setProgress({ module: "uninstaller", step: "Đang quét tàn dư File & Registry…", percent: 10 });
    try {
      const scan = await api.scanLeftovers(prog);
      setLeftoverScan(scan);
      setSelectedLeftoverIds(new Set(scan.items.filter((i) => i.safe_to_delete).map((i) => i.id)));
      setWizardStep(3);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onNotify(msg);
      setWizardStep(1);
    } finally {
      setWizardBusy(false);
    }
  }

  function toggleLeftover(id: string) {
    setSelectedLeftoverIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runStep3Clean() {
    if (!targetProgram || !leftoverScan || wizardBusy) return;
    const chosen: LeftoverItem[] = leftoverScan.items.filter((i) => selectedLeftoverIds.has(i.id));
    setWizardBusy(true);
    setProgress({ module: "uninstaller", step: "Đang sao lưu Registry & xóa tàn dư đã chọn…", percent: 15 });
    try {
      const res = await api.cleanLeftovers(targetProgram, chosen);
      setCleanResult(res);
      setWizardStep("done");
      onNotify(
        res.cancelled
          ? "Đã dừng xóa tàn dư theo yêu cầu."
          : `Đã gỡ sạch "${targetProgram.name}" (${res.deleted_files_count} thư mục/tệp, ${res.deleted_registry_count} khóa Registry).`
      );
      onRefresh();
    } catch (e) {
      onNotify(`Lỗi xóa tàn dư: ${e}`);
    } finally {
      setWizardBusy(false);
    }
  }

  const fileLeftovers = useMemo(
    () => (leftoverScan?.items ?? []).filter((i) => i.kind !== "registry"),
    [leftoverScan]
  );
  const regLeftovers = useMemo(
    () => (leftoverScan?.items ?? []).filter((i) => i.kind === "registry"),
    [leftoverScan]
  );

  return (
    <div key="tab-uninstaller" className="tab-panel-enter flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4">
      {/* ADMIN WARNING BANNER */}
      {!isAdmin && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>
              <strong>Thiếu quyền Administrator:</strong> Việc gỡ phần mềm hệ thống và dọn khóa <code>HKLM\SOFTWARE</code> yêu cầu chạy AllSoft Desktop với quyền <strong>Run as Administrator</strong>.
            </span>
          </div>
        </div>
      )}

      {/* FILTER & INVENTORY TOOLBAR */}
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#EAE2CE] bg-white px-4 py-3 shadow-[0_2px_10px_-4px_rgba(43,43,43,0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setInventoryFilter("all")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.98] ${
              inventoryFilter === "all"
                ? "bg-[#2B2B2B] text-[#DFC068] shadow-sm"
                : "bg-[#FDFBF7] text-[#5C5446] ring-1 ring-[#EAE2CE] hover:bg-[#FAF3DF]"
            }`}
          >
            Tất cả ({counts.total})
          </button>
          <button
            type="button"
            onClick={() => setInventoryFilter("external")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.98] ${
              inventoryFilter === "external"
                ? "bg-[#2B2B2B] text-[#DFC068] shadow-sm"
                : "bg-[#FDFBF7] text-[#5C5446] ring-1 ring-[#EAE2CE] hover:bg-[#FAF3DF]"
            }`}
          >
            Ngoài danh mục ({counts.external})
          </button>
          <button
            type="button"
            onClick={() => setInventoryFilter("standard")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-[0.98] ${
              inventoryFilter === "standard"
                ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-sm"
                : "bg-[#FAF3DF]/70 text-[#8A6D1F] ring-1 ring-[#DFC992] hover:bg-[#FAF3DF]"
            }`}
          >
            Thuộc chuẩn AllSoft ({counts.standard})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isAdmin ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              🛡️ Đã cấp quyền Admin
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
              ⚠️ Chưa có quyền Admin
            </span>
          )}
          <span className="hidden text-xs text-[#6E6450] xl:inline">
            Tổng ước tính:{" "}
            <strong className="font-semibold text-[#2B2B2B]">
              {(totalSizeMb / 1024).toFixed(2)} GB
            </strong>
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={scanning}
            className="rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] px-3 py-1.5 text-xs font-semibold text-[#2B2B2B] transition-all duration-150 hover:bg-[#FAF3DF] active:scale-[0.98] disabled:opacity-50"
          >
            {scanning ? "Đang quét…" : "⟳ Quét lại Registry"}
          </button>
          <button
            type="button"
            onClick={onExportInventory}
            className="rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all duration-150 hover:brightness-105 active:scale-[0.98]"
          >
            📋 Xuất kiểm kê máy trạm
          </button>
        </div>
      </div>

      {/* INSTALLED SOFTWARE LIST TABLE */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[#EAE2CE] bg-white shadow-[0_2px_12px_-4px_rgba(43,43,43,0.05)]">
        <div className="sticky top-0 z-10 grid grid-cols-12 gap-3 border-b border-[#EAE2CE] bg-[#FAF6EC] px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[#7A6F58]">
          <div className="col-span-4">Tên phần mềm & Phân loại</div>
          <div className="col-span-2">Phiên bản</div>
          <div className="col-span-2">Nhà phát hành</div>
          <div className="col-span-1 text-right">Ngày cài</div>
          <div className="col-span-1 text-right">Dung lượng</div>
          <div className="col-span-2 text-right">Thao tác</div>
        </div>

        <div className="divide-y divide-[#F2ECE0]">
          {filtered.map((item, idx) => (
            <div
              key={item.id}
              style={{ animationDelay: `${Math.min(idx * 18, 250)}ms` }}
              className="stagger-item card-lift grid grid-cols-12 items-center gap-3 px-4 py-2.5 text-xs hover:bg-[#FAF3DF]/35"
            >
              <div className="col-span-4 flex min-w-0 items-center gap-3">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    item.in_catalog
                      ? "bg-gradient-to-br from-[#C5A044] to-[#9A7B2C] text-white shadow-xs"
                      : "bg-stone-100 text-[#5C5446] ring-1 ring-stone-200"
                  }`}
                >
                  {item.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-[#2B2B2B]" title={item.name}>
                      {item.name}
                    </span>
                    {item.in_catalog ? (
                      <span className="shrink-0 rounded-full bg-[#FAF3DF] px-2 py-0.5 text-[10px] font-bold text-[#8A6D1F] ring-1 ring-inset ring-[#DFC992]">
                        Chuẩn AllSoft
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
                        Ngoài danh mục
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="col-span-2 truncate font-mono text-xs font-medium text-[#5C5446]">
                {item.version}
              </div>

              <div className="col-span-2 truncate text-xs text-[#6E6450]" title={item.publisher}>
                {item.publisher}
              </div>

              <div className="col-span-1 text-right font-mono text-[11px] text-[#7A6F58]">
                {item.install_date}
              </div>

              <div className="col-span-1 text-right font-mono text-xs font-semibold text-[#2B2B2B]">
                {item.size_mb >= 1024
                  ? `${(item.size_mb / 1024).toFixed(2)} GB`
                  : `${item.size_mb.toFixed(1)} MB`}
              </div>

              <div className="col-span-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => openWizard(item)}
                  className="whitespace-nowrap rounded-lg bg-gradient-to-r from-[#EA580C] to-[#DC2626] px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
                >
                  🗑️ Gỡ cài đặt
                </button>
              </div>
            </div>
          ))}

          {!filtered.length && (
            <div className="py-16 text-center text-sm text-[#8A7E66]">
              Không có phần mềm nào khớp với bộ lọc hiện tại.
            </div>
          )}
        </div>
      </div>

      {/* 3-STEP CLEAN UNINSTALL WIZARD MODAL */}
      {targetProgram && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
          <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#DFC992] bg-white shadow-2xl">
            {/* WIZARD HEADER */}
            <div className="flex items-center justify-between border-b border-[#EAE2CE] bg-[#FAF6EC] px-5 py-3.5">
              <div>
                <h3 className="text-sm font-bold text-[#2B2B2B]">
                  🗑️ Gỡ sạch phần mềm (3 bước) — {targetProgram.name}
                </h3>
                <p className="text-[11px] text-[#6E6450]">
                  {targetProgram.publisher} · v{targetProgram.version}
                </p>
              </div>
              <button
                type="button"
                onClick={closeWizard}
                disabled={wizardBusy}
                className="rounded-lg px-2 py-1 text-xs font-bold text-[#7A6F58] hover:bg-[#EFE7D4] hover:text-[#2B2B2B] disabled:opacity-40"
              >
                ✕
              </button>
            </div>

            {/* STEP INDICATOR */}
            <div className="grid grid-cols-3 gap-2 border-b border-[#EAE2CE] bg-[#FDFBF7] px-5 py-2.5 text-[11px] font-bold">
              {[
                { num: 1 as const, label: "1. Chạy trình gỡ gốc" },
                { num: 2 as const, label: "2. Quét tàn dư File & Reg" },
                { num: 3 as const, label: "3. Chọn xóa & Backup .reg" },
              ].map((s) => {
                const isDone = wizardStep === "done" || (typeof wizardStep === "number" && wizardStep > s.num);
                const isCurrent = wizardStep === s.num;
                return (
                  <div
                    key={s.num}
                    className={`flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-1.5 ${
                      isCurrent
                        ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-xs"
                        : isDone
                        ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                        : "bg-white text-[#8A7E66] ring-1 ring-[#EAE2CE]"
                    }`}
                  >
                    <span>{isDone ? "✓" : s.num}</span>
                    <span className="truncate">{s.label.slice(3)}</span>
                  </div>
                );
              })}
            </div>

            {/* WIZARD BODY */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-xs">
              {/* PROGRESS BAR WHEN BUSY */}
              {wizardBusy && progress && (
                <div className="mb-4 rounded-xl border border-[#DFC992] bg-[#FAF3DF]/70 p-3.5">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[#8A6D1F]">
                    <span>{progress.step}</span>
                    <span className="font-mono">{progress.percent}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#EFE9D8]">
                    <div
                      className="progress-smooth h-full rounded-full bg-gradient-to-r from-[#C5A044] to-[#9A7B2C]"
                      style={{ width: `${Math.min(100, Math.max(5, progress.percent))}%` }}
                    />
                  </div>
                  <div className="mt-2.5 flex justify-end">
                    <button
                      type="button"
                      onClick={handleCancelWizardTask}
                      className="rounded-lg border border-red-200 bg-white px-3 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50 active:scale-[0.98]"
                    >
                      ✕ Hủy tác vụ
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 1 */}
              {wizardStep === 1 && (
                <div className="space-y-3">
                  <p className="leading-relaxed text-[#4F473B]">
                    AllSoft Desktop sẽ chạy trình gỡ cài đặt chính chủ (<code>UninstallString</code>) của phần mềm trước để gỡ sạch các dịch vụ và liên kết hệ thống đúng quy chuẩn Windows.
                  </p>

                  <div className="rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#8A7E66]">
                      Lệnh gỡ cài đặt gốc (UninstallString)
                    </div>
                    <div className="mt-1 break-all font-mono text-[11px] text-[#2B2B2B] select-text">
                      {targetProgram.uninstall_string || "(Không có lệnh UninstallString trong Registry)"}
                    </div>
                  </div>

                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-[11px] text-emerald-900">
                    🛡️ <strong>Lá chắn an toàn:</strong> Sau khi trình gỡ gốc hoàn tất, Bước 2 sẽ tự động quét tàn dư kèm Blacklist chống xóa nhầm <code>Windows / System32 / Microsoft / Drivers</code> và chỉ xóa các mục bạn xác nhận tick chọn.
                  </div>
                </div>
              )}

              {/* STEP 2 */}
              {wizardStep === 2 && (
                <div className="space-y-3 py-4 text-center">
                  <div className="text-3xl">🔍</div>
                  <p className="text-sm font-bold text-[#2B2B2B]">
                    Đang quét tàn dư File & Registry…
                  </p>
                  {step1DoneMsg && (
                    <p className="text-xs font-medium text-emerald-700">✓ {step1DoneMsg}</p>
                  )}
                  <div className="mx-auto max-w-md rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 text-[11px] text-emerald-900">
                    🛡️ Đã kích hoạt Blacklist chống xóa nhầm <strong>Windows / System32 / Microsoft / Drivers</strong>
                  </div>
                </div>
              )}

              {/* STEP 3 */}
              {wizardStep === 3 && leftoverScan && (
                <div className="space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2 text-[11px] text-emerald-900">
                    <span>
                      🛡️ <strong>Đã kích hoạt Blacklist bảo vệ:</strong> {leftoverScan.protected_scopes.join(" · ")}
                    </span>
                    <span className="font-mono font-bold">
                      Tìm thấy {leftoverScan.items.length} mục tàn dư
                    </span>
                  </div>

                  <div className="rounded-xl border border-[#DFC992] bg-[#FAF3DF]/70 px-3.5 py-2 text-[11px] text-[#8A6D1F]">
                    💾 <strong>Sao lưu tự động:</strong> Toàn bộ khóa Registry được tick chọn sẽ tự động sao lưu thành file <code>.reg</code> trong thư mục <code>Backups\</code> trước khi xóa.
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-[#5C5446]">
                      Đã chọn <strong className="text-[#9A7B2C]">{selectedLeftoverIds.size}/{leftoverScan.items.length}</strong> mục để xóa
                    </span>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedLeftoverIds(new Set(leftoverScan.items.map((i) => i.id)))}
                        className="font-semibold text-[#9A7B2C] hover:underline"
                      >
                        Chọn tất cả
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedLeftoverIds(new Set())}
                        className="text-[#6E6450] hover:underline"
                      >
                        Bỏ chọn tất cả
                      </button>
                    </div>
                  </div>

                  {/* FILE / FOLDER LEFTOVERS */}
                  {fileLeftovers.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-[#EAE2CE]">
                      <div className="border-b border-[#EAE2CE] bg-[#FAF6EC] px-3 py-1.5 text-[11px] font-bold text-[#7A6F58]">
                        📁 Thư mục & Tệp tàn dư ({fileLeftovers.length})
                      </div>
                      <div className="divide-y divide-[#F2ECE0]">
                        {fileLeftovers.map((it) => {
                          const checked = selectedLeftoverIds.has(it.id);
                          return (
                            <label
                              key={it.id}
                              className={`flex cursor-pointer items-start gap-2.5 px-3 py-2 ${
                                checked ? "bg-[#FAF3DF]/40" : "hover:bg-[#FDFBF7]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLeftover(it.id)}
                                className="mt-0.5 h-3.5 w-3.5 accent-[#B5943B]"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-mono text-[11px] font-semibold text-[#2B2B2B]" title={it.path}>
                                  {it.path}
                                </div>
                                <div className="text-[10px] text-[#6E6450]">{it.detail}</div>
                              </div>
                              <span className="shrink-0 font-mono text-[11px] font-semibold text-[#8A6D1F]">
                                {formatBytes(it.size_bytes)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* REGISTRY LEFTOVERS */}
                  {regLeftovers.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-[#EAE2CE]">
                      <div className="border-b border-[#EAE2CE] bg-[#FAF6EC] px-3 py-1.5 text-[11px] font-bold text-[#7A6F58]">
                        🗝️ Khóa Registry tàn dư ({regLeftovers.length})
                      </div>
                      <div className="divide-y divide-[#F2ECE0]">
                        {regLeftovers.map((it) => {
                          const checked = selectedLeftoverIds.has(it.id);
                          return (
                            <label
                              key={it.id}
                              className={`flex cursor-pointer items-start gap-2.5 px-3 py-2 ${
                                checked ? "bg-[#FAF3DF]/40" : "hover:bg-[#FDFBF7]"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleLeftover(it.id)}
                                className="mt-0.5 h-3.5 w-3.5 accent-[#B5943B]"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-mono text-[11px] font-semibold text-[#2B2B2B]" title={it.path}>
                                  {it.path}
                                </div>
                                <div className="text-[10px] text-[#6E6450]">{it.detail}</div>
                              </div>
                              <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                Backup .reg
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STEP DONE */}
              {wizardStep === "done" && cleanResult && (
                <div className="space-y-3 py-2">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-emerald-950">
                    <div className="text-sm font-bold">
                      ✅ Hoàn tất gỡ sạch "{targetProgram.name}"!
                    </div>
                    <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-white p-2.5 ring-1 ring-emerald-200">
                        <div className="font-mono text-base font-extrabold text-emerald-700">
                          {cleanResult.deleted_files_count}
                        </div>
                        <div className="text-[10px] text-[#6E6450]">Thư mục/Tệp đã xóa</div>
                      </div>
                      <div className="rounded-xl bg-white p-2.5 ring-1 ring-emerald-200">
                        <div className="font-mono text-base font-extrabold text-[#9A7B2C]">
                          {cleanResult.deleted_registry_count}
                        </div>
                        <div className="text-[10px] text-[#6E6450]">Khóa Registry đã xóa</div>
                      </div>
                      <div className="rounded-xl bg-white p-2.5 ring-1 ring-emerald-200">
                        <div className="font-mono text-base font-extrabold text-[#2B2B2B]">
                          {formatBytes(cleanResult.freed_bytes)}
                        </div>
                        <div className="text-[10px] text-[#6E6450]">Dung lượng giải phóng</div>
                      </div>
                    </div>
                  </div>

                  {cleanResult.reg_backup_path && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#DFC992] bg-[#FAF6EC] px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#8A6D1F]">
                          💾 File sao lưu Registry (.reg) đã tạo
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[11px] font-semibold text-[#2B2B2B] select-text">
                          {cleanResult.reg_backup_path}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => api.openPath(cleanResult.reg_backup_path!).catch(() => {})}
                        className="shrink-0 rounded-lg border border-[#DFC992] bg-white px-2.5 py-1 text-[11px] font-bold text-[#8A6D1F] hover:bg-[#FAF3DF] active:scale-[0.98]"
                      >
                        Mở vị trí file
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* WIZARD FOOTER ACTIONS */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EAE2CE] bg-[#FDFBF7] px-5 py-3">
              {wizardStep === 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => runStep2Scan(targetProgram)}
                    disabled={wizardBusy}
                    className="text-xs font-semibold text-[#8A6D1F] hover:underline disabled:opacity-40"
                  >
                    Bỏ qua Bước 1 → Chỉ quét tàn dư
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={closeWizard}
                      disabled={wizardBusy}
                      className="rounded-xl border border-[#EAE2CE] bg-white px-3.5 py-2 text-xs font-semibold text-[#5C5446] hover:bg-stone-50 disabled:opacity-40"
                    >
                      Đóng
                    </button>
                    <button
                      type="button"
                      onClick={runStep1Native}
                      disabled={wizardBusy}
                      className="rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] px-4 py-2 text-xs font-bold text-white shadow-sm hover:brightness-105 active:scale-[0.98] disabled:opacity-40"
                    >
                      {wizardBusy ? "Đang gỡ gốc…" : "▶ Bắt đầu gỡ cài đặt gốc"}
                    </button>
                  </div>
                </>
              )}

              {wizardStep === 2 && (
                <div className="ml-auto">
                  <button
                    type="button"
                    onClick={closeWizard}
                    disabled={wizardBusy}
                    className="rounded-xl border border-[#EAE2CE] bg-white px-3.5 py-2 text-xs font-semibold text-[#5C5446] disabled:opacity-40"
                  >
                    Đóng
                  </button>
                </div>
              )}

              {wizardStep === 3 && (
                <>
                  <button
                    type="button"
                    onClick={closeWizard}
                    disabled={wizardBusy}
                    className="rounded-xl border border-[#EAE2CE] bg-white px-3.5 py-2 text-xs font-semibold text-[#5C5446] hover:bg-stone-50 disabled:opacity-40"
                  >
                    Giữ nguyên & Đóng
                  </button>
                  <button
                    type="button"
                    onClick={runStep3Clean}
                    disabled={wizardBusy || selectedLeftoverIds.size === 0}
                    className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 active:scale-[0.98] disabled:opacity-40"
                  >
                    {wizardBusy ? "Đang sao lưu & xóa…" : `🧹 Xóa các mục đã chọn (${selectedLeftoverIds.size})`}
                  </button>
                </>
              )}

              {wizardStep === "done" && (
                <button
                  type="button"
                  onClick={closeWizard}
                  className="ml-auto rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] px-5 py-2 text-xs font-bold text-white shadow-sm hover:brightness-105 active:scale-[0.98]"
                >
                  Hoàn tất & Đóng
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
