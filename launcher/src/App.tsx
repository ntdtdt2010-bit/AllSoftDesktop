import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type InstalledProgram, type SystemSpecs } from "./api";
import { CleanerTab } from "./components/CleanerTab";
import { DiagnosticsTab } from "./components/DiagnosticsTab";
import { PrinterTab } from "./components/PrinterTab";
import { UninstallerTab } from "./components/UninstallerTab";
import type { AppState, Catalog, CatalogApp, Progress, UpdateInfo } from "./types";

const BADGE: Record<string, { text: string; cls: string }> = {
  installed: {
    text: "Đã cài",
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-200/90",
  },
  update: {
    text: "Cập nhật",
    cls: "bg-[#FAF3DF] text-[#8A6D1F] ring-[#DFC992]",
  },
  missing: {
    text: "Chưa cài",
    cls: "bg-stone-100 text-stone-600 ring-stone-200",
  },
};

type ActiveTab = "catalog" | "diagnostics" | "cleaner" | "printer" | "uninstaller";

function readInitialTab(): ActiveTab {
  if (typeof window !== "undefined") {
    const t = new URLSearchParams(window.location.search).get("tab")?.toLowerCase();
    if (t === "diagnostics") return "diagnostics";
    if (t === "cleaner") return "cleaner";
    if (t === "printer" || t === "printers") return "printer";
    if (t === "uninstaller" || t === "inventory" || t === "installed") return "uninstaller";
  }
  return "catalog";
}

export default function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [origin, setOrigin] = useState("");
  const [states, setStates] = useState<Record<string, AppState>>({});
  const [specs, setSpecs] = useState<SystemSpecs | null>(null);
  const [installedPrograms, setInstalledPrograms] = useState<InstalledProgram[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean>(true);
  const [activeTab, setActiveTabState] = useState<ActiveTab>(readInitialTab);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [packagesDir, setPackagesDir] = useState("");
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const setActiveTab = (tab: ActiveTab) => {
    setActiveTabState(tab);
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", tab);
        window.history.replaceState(null, "", url.toString());
      } catch {
        // ignore history error
      }
    }
  };

  const notify = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 4200);
  };

  const refreshStates = useCallback(async () => {
    setScanning(true);
    try {
      const [list, progs, hw] = await Promise.all([
        api.detect(),
        api.listInstalledPrograms(),
        api.systemSpecs(),
      ]);
      setStates(Object.fromEntries(list.map((s) => [s.id, s])));
      setInstalledPrograms(progs);
      setSpecs(hw);
    } catch (e) {
      notify(`Không quét được trạng thái: ${e}`);
    } finally {
      setScanning(false);
    }
  }, []);

  const scanPackages = useCallback(async (dir: string) => {
    if (!dir) return;
    try {
      setOfflineIds(new Set(await api.scanPackages(dir)));
    } catch {
      setOfflineIds(new Set());
    }
  }, []);

  useEffect(() => {
    let un: (() => void) | undefined;
    (async () => {
      un = await api.onProgress((p) => setProgress((prev) => ({ ...prev, [p.id]: p })));
      try {
        const [payload, dir, cli, hw, progs, adminFlag] = await Promise.all([
          api.catalog(),
          api.defaultPackagesDir(),
          api.cliArgs(),
          api.systemSpecs(),
          api.listInstalledPrograms(),
          api.checkAdmin(),
        ]);
        setCatalog(payload.catalog);
        setOrigin(payload.origin);
        setPackagesDir(dir);
        setSpecs(hw);
        setInstalledPrograms(progs);
        setIsAdmin(adminFlag);
        scanPackages(dir);
        refreshStates();
        api.checkUpdate().then(setUpdate).catch(() => {});
        if (cli.profile) {
          const p = payload.catalog.profiles.find((x) => x.id === cli.profile);
          if (p) {
            setProfile(p.id);
            setSelected(new Set(p.apps));
          }
        }
        if (cli.auto && cli.profile && !autoStarted.current) {
          autoStarted.current = true;
          const p = payload.catalog.profiles.find((x) => x.id === cli.profile);
          if (p) run(p.apps, false);
        }
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => un?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => (catalog?.apps ?? []).filter((a) => !a.hidden), [catalog]);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? visible.filter((a) => (a.name + " " + a.description + " " + a.category).toLowerCase().includes(q))
      : visible;
  }, [visible, query]);

  const groups = useMemo(() => {
    const m = new Map<string, CatalogApp[]>();
    filteredCatalog.forEach((a) => m.set(a.category, [...(m.get(a.category) ?? []), a]));
    return [...m.entries()];
  }, [filteredCatalog]);

  const toggle = (id: string) => {
    setProfile(null);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const pickProfile = (id: string | null) => {
    setProfile(id);
    const p = catalog?.profiles.find((x) => x.id === id);
    setSelected(new Set(p ? p.apps : []));
  };

  async function run(ids: string[], upgrade: boolean) {
    if (!ids.length || busy) return;
    setBusy(true);
    setProgress({});
    try {
      const failed = await api.install(ids, packagesDir || null, upgrade);
      notify(failed ? `Hoàn tất, ${failed} mục lỗi — xem báo cáo` : "Đã cài đặt & đồng bộ hoàn tất!");
    } catch (e) {
      notify(String(e));
    }
    setBusy(false);
    refreshStates();
  }

  async function removeCatalogApp(app: CatalogApp) {
    if (busy) return;
    setBusy(true);
    setUninstallingId(app.id);
    try {
      await api.uninstall(app.id);
      notify(`Đã gỡ cài đặt ${app.name}`);
    } catch (e) {
      notify(`Gỡ lỗi: ${e}`);
    }
    setUninstallingId(null);
    setBusy(false);
    refreshStates();
  }

  async function chooseDir() {
    const d = await api.pickFolder();
    if (d) {
      setPackagesDir(d);
      scanPackages(d);
    }
  }

  async function exportWorkstationInventory() {
    if (!specs) return;
    try {
      const path = await api.exportInventoryReport(specs, installedPrograms);
      await api.openPath(path);
      notify(`Đã xuất kiểm kê máy trạm (${installedPrograms.length} phần mềm): ${path}`);
    } catch (e) {
      notify(`Xuất báo cáo lỗi: ${e}`);
    }
  }

  async function report() {
    try {
      const path = await api.exportReport();
      await api.openPath(path);
      notify(`Đã xuất báo cáo cài đặt: ${path}`);
    } catch (e) {
      notify(String(e));
    }
  }

  const prog = Object.values(progress);
  const total = prog[0]?.total ?? 0;
  const finished = prog.filter((p) => p.stage === "done" || p.stage === "error" || p.stage === "skipped").length;
  const overall = total ? Math.round((finished / total) * 100) : 0;
  const nameOf = (id: string) => catalog?.apps.find((a) => a.id === id)?.name ?? id;
  const updatable = visible.filter((a) => states[a.id]?.status === "update").map((a) => a.id);
  const installedCatalogCount = visible.filter((a) => states[a.id]?.status === "installed" || states[a.id]?.status === "update").length;

  if (error) {
    return (
      <div className="p-10 text-red-700 bg-[#FDFBF7]">
        Không tải được catalog: {error}
      </div>
    );
  }
  if (!catalog) {
    return (
      <div className="grid h-full place-items-center bg-[#FDFBF7] text-[#7A6F58]">
        Đang khởi tạo AllSoft Desktop…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#FDFBF7] text-[#2B2B2B]">
      {/* TOP HEADER — Royal Gold & Frosted Glass */}
      <header className="header-glass sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[#EAE2CE]/90 px-6 py-3 shadow-[0_4px_20px_-6px_rgba(181,148,59,0.12)]">
        <div className="flex items-center gap-3.5">
          <img
            src="./logo.png"
            alt="Mr. Dương Creative X Technology"
            className="w-[200px] min-w-[200px] h-auto shrink-0 object-contain select-none"
          />
          <span className="h-7 w-px shrink-0 bg-[#E5D9BE]" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-bold tracking-tight text-[#2B2B2B]">
              {catalog.launcher.name}
            </h1>
            <span className="rounded-md border border-[#E2CFA1] bg-[#FAF3DF] px-2 py-0.5 text-[11px] font-semibold text-[#8A6D1F]">
              v{catalog.launcher.version}
            </span>
            {origin === "cache" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Offline (bản lưu)
              </span>
            )}
          </div>
        </div>

        {/* NAVIGATION 5 TABS */}
        <nav
          aria-label="Chuyển đổi phân hệ AllSoft Desktop"
          className="flex flex-wrap items-center gap-1 rounded-xl border border-[#EAE2CE] bg-[#FDFBF7]/90 p-1 shadow-[inset_0_1px_2px_rgba(43,43,43,0.03)]"
        >
          <button
            type="button"
            onClick={() => setActiveTab("catalog")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-[0.98] ${
              activeTab === "catalog"
                ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-sm"
                : "text-[#5C5446] hover:bg-[#F5EFE0] hover:text-[#2B2B2B]"
            }`}
          >
            <span>📦 Danh mục Chuẩn</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                activeTab === "catalog" ? "bg-white/20 text-white" : "bg-[#EAE2CE]/80 text-[#6E6450]"
              }`}
            >
              {visible.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("diagnostics")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-[0.98] ${
              activeTab === "diagnostics"
                ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-sm"
                : "text-[#5C5446] hover:bg-[#F5EFE0] hover:text-[#2B2B2B]"
            }`}
          >
            <span>🩺 Chẩn đoán</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("cleaner")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-[0.98] ${
              activeTab === "cleaner"
                ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-sm"
                : "text-[#5C5446] hover:bg-[#F5EFE0] hover:text-[#2B2B2B]"
            }`}
          >
            <span>🧹 Dọn rác</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("printer")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-[0.98] ${
              activeTab === "printer"
                ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-sm"
                : "text-[#5C5446] hover:bg-[#F5EFE0] hover:text-[#2B2B2B]"
            }`}
          >
            <span>🖨️ Cứu hộ máy in</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("uninstaller")}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-[0.98] ${
              activeTab === "uninstaller"
                ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-sm"
                : "text-[#5C5446] hover:bg-[#F5EFE0] hover:text-[#2B2B2B]"
            }`}
          >
            <span>🗑️ Gỡ cài đặt</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                activeTab === "uninstaller" ? "bg-white/20 text-white" : "bg-[#EAE2CE]/80 text-[#6E6450]"
              }`}
            >
              {installedPrograms.length}
            </span>
          </button>
        </nav>

        {/* SEARCH & UPDATE */}
        <div className="flex items-center gap-2.5">
          {update?.available && (
            <button
              type="button"
              onClick={() => api.applyUpdate().catch((e) => notify(String(e)))}
              className="rounded-lg border border-[#DFC992] bg-[#FAF3DF] px-3 py-1.5 text-xs font-semibold text-[#8A6D1F] transition-all duration-150 hover:bg-[#F3E6C3] active:scale-[0.98]"
            >
              Có bản mới {update.latest} — Cập nhật
            </button>
          )}
          {(activeTab === "catalog" || activeTab === "uninstaller") && (
            <div className="relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  activeTab === "catalog"
                    ? "Tìm trong danh mục chuẩn…"
                    : "Tìm phần mềm, hãng phát hành…"
                }
                className="w-56 rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] pl-3.5 pr-8 py-1.5 text-xs text-[#2B2B2B] placeholder-[#948973] outline-none transition-all focus:border-[#B5943B] focus:bg-white focus:ring-2 focus:ring-[#B5943B]/15"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#948973] transition hover:text-[#2B2B2B] active:scale-95"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* SYSTEM HARDWARE & NETWORK SPECS BAR */}
      {specs && (
        <section
          aria-label="Thông số cấu hình máy trạm"
          className="grid grid-cols-1 gap-2.5 border-b border-[#EAE2CE] bg-gradient-to-r from-[#FAF6EC] via-[#FDFBF7] to-[#FAF6EC] px-6 py-2.5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {/* CPU */}
          <div className="card-lift flex items-center gap-3 rounded-xl border border-[#EAE2CE] bg-white px-3.5 py-2 shadow-[0_1px_3px_rgba(43,43,43,0.03)]">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FAF3DF] text-sm font-bold text-[#9A7B2C] ring-1 ring-[#E5D3A7]">
              CPU
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8A7E66]">
                  Vi xử lý trung tâm
                </span>
                <span className="rounded bg-[#FAF3DF] px-1.5 py-0.2 text-[10px] font-semibold text-[#8A6D1F]">
                  {specs.cpu_threads} luồng
                </span>
              </div>
              <p className="truncate text-xs font-semibold text-[#2B2B2B]" title={`${specs.cpu_name} · ${specs.cpu_threads} luồng`}>
                {specs.cpu_name} · {specs.cpu_threads} luồng
              </p>
            </div>
          </div>

          {/* RAM */}
          <div className="card-lift flex items-center gap-3 rounded-xl border border-[#EAE2CE] bg-white px-3.5 py-2 shadow-[0_1px_3px_rgba(43,43,43,0.03)]">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FAF3DF] text-xs font-bold text-[#9A7B2C] ring-1 ring-[#E5D3A7]">
              RAM
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#2B2B2B]">
                  RAM: {specs.ram_used_gb.toFixed(1)} / {specs.ram_total_gb.toFixed(1)} GB
                </span>
                <span className="text-[11px] font-bold text-[#9A7B2C]">({specs.ram_percent}%)</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#EFE9D8]">
                <div
                  className="progress-smooth h-full rounded-full bg-gradient-to-r from-[#C5A044] to-[#9A7B2C]"
                  style={{ width: `${Math.min(100, Math.max(5, specs.ram_percent))}%` }}
                />
              </div>
            </div>
          </div>

          {/* DISK C: */}
          <div className="card-lift flex items-center gap-3 rounded-xl border border-[#EAE2CE] bg-white px-3.5 py-2 shadow-[0_1px_3px_rgba(43,43,43,0.03)]">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FAF3DF] text-xs font-bold text-[#9A7B2C] ring-1 ring-[#E5D3A7]">
              SSD
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#2B2B2B]">
                  Ổ {specs.disk_drive} Trống {specs.disk_free_gb} / {specs.disk_total_gb} GB
                </span>
                <span className="text-[11px] font-semibold text-[#7A6F58]">
                  {specs.disk_used_percent}% dùng
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#EFE9D8]">
                <div
                  className="progress-smooth h-full rounded-full bg-gradient-to-r from-[#2B2B2B] to-[#B5943B]"
                  style={{ width: `${Math.min(100, Math.max(5, specs.disk_used_percent))}%` }}
                />
              </div>
            </div>
          </div>

          {/* HOSTNAME / IP / OS */}
          <div className="card-lift flex items-center gap-3 rounded-xl border border-[#EAE2CE] bg-white px-3.5 py-2 shadow-[0_1px_3px_rgba(43,43,43,0.03)]">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2B2B2B] text-xs font-bold text-[#DFC068]">
              LAN
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1 text-xs">
                <span className="truncate font-bold text-[#2B2B2B]" title={specs.hostname}>
                  Hostname: {specs.hostname}
                </span>
                <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#2B2B2B]">
                  {specs.local_ip}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-[#6E6450]" title={specs.os_version}>
                {specs.os_version}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* MAIN WORKSPACE */}
      {activeTab === "catalog" ? (
        <div key="tab-catalog" className="tab-panel-enter flex min-h-0 flex-1">
          {/* LEFT SIDEBAR: PROFILES */}
          <aside className="w-68 shrink-0 overflow-y-auto border-r border-[#EAE2CE] bg-white px-4 py-4">
            <div className="mb-2.5 flex items-center justify-between px-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#8A7E66]">
                Vai trò máy (Profile)
              </p>
              <span className="text-[11px] font-semibold text-[#9A7B2C]">
                {catalog.profiles.length} gói
              </span>
            </div>
            <div className="space-y-1.5">
              {catalog.profiles.map((p) => {
                const isSelected = profile === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickProfile(isSelected ? null : p.id)}
                    className={`w-full rounded-xl border px-3.5 py-2.5 text-left transition-all duration-150 active:scale-[0.98] ${
                      isSelected
                        ? "border-[#B5943B] bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-md"
                        : "border-transparent bg-[#FDFBF7] text-[#2B2B2B] hover:border-[#EAE2CE] hover:bg-[#FAF3DF]/60"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{p.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isSelected
                            ? "bg-white/20 text-white"
                            : "bg-[#EAE2CE]/70 text-[#6E6450]"
                        }`}
                      >
                        {p.apps.length} PM
                      </span>
                    </div>
                    <div
                      className={`mt-1 line-clamp-2 text-xs ${
                        isSelected ? "text-[#FDFBF7]/90" : "text-[#6E6450]"
                      }`}
                    >
                      {p.description}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* QUICK STATS IN SIDEBAR */}
            <div className="mt-5 rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#8A7E66]">
                Tình trạng chuẩn hoá
              </p>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg bg-white p-1.5 ring-1 ring-[#EAE2CE]">
                  <div className="text-sm font-bold text-emerald-700">{installedCatalogCount}</div>
                  <div className="text-[10px] text-[#6E6450]">Đã có</div>
                </div>
                <div className="rounded-lg bg-white p-1.5 ring-1 ring-[#EAE2CE]">
                  <div className="text-sm font-bold text-[#9A7B2C]">{updatable.length}</div>
                  <div className="text-[10px] text-[#6E6450]">Cần nâng</div>
                </div>
                <div className="rounded-lg bg-white p-1.5 ring-1 ring-[#EAE2CE]">
                  <div className="text-sm font-bold text-[#2B2B2B]">{selected.size}</div>
                  <div className="text-[10px] text-[#6E6450]">Đang chọn</div>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-1.5 border-t border-[#EAE2CE] px-2 pt-3.5 text-xs">
              <button
                type="button"
                onClick={() => setSelected(new Set(visible.map((a) => a.id)))}
                className="block font-semibold text-[#9A7B2C] transition hover:underline active:scale-[0.98]"
              >
                ✓ Chọn tất cả ({visible.length} phần mềm)
              </button>
              <button
                type="button"
                onClick={() => pickProfile(null)}
                className="block text-[#6E6450] transition hover:text-[#2B2B2B] hover:underline active:scale-[0.98]"
              >
                ✕ Bỏ chọn toàn bộ
              </button>
              <button
                type="button"
                onClick={refreshStates}
                disabled={scanning}
                className="block text-[#6E6450] transition hover:text-[#2B2B2B] hover:underline active:scale-[0.98] disabled:opacity-50"
              >
                {scanning ? "⟳ Đang quét lại máy trạm…" : "⟳ Quét lại trạng thái máy"}
              </button>
            </div>
          </aside>

          {/* RIGHT MAIN: STANDARD CATALOG CHECKLIST */}
          <main className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
            {groups.map(([cat, apps], groupIdx) => (
              <section key={cat} className="mb-5">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[#8A6D1F]">
                    {cat}
                  </h2>
                  <span className="text-[11px] text-[#8A7E66]">{apps.length} phần mềm</span>
                </div>
                <div className="space-y-2">
                  {apps.map((a, idx) => {
                    const st = states[a.id];
                    const b = BADGE[st?.status ?? "missing"];
                    const p = progress[a.id];
                    const isChecked = selected.has(a.id);
                    return (
                      <div
                        key={a.id}
                        style={{ animationDelay: `${(groupIdx * 3 + idx) * 25}ms` }}
                        className={`stagger-item card-lift flex items-center gap-3.5 rounded-2xl border px-4 py-3 shadow-[0_2px_10px_-4px_rgba(43,43,43,0.04)] ${
                          isChecked
                            ? "border-[#DFC992] bg-[#FAF3DF]/45"
                            : "border-[#EAE2CE] bg-white hover:bg-[#FFFDF9]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggle(a.id)}
                          disabled={busy}
                          className="h-4 w-4 cursor-pointer rounded accent-[#B5943B]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-semibold text-[#2B2B2B]">
                              {a.name}
                            </span>
                            {offlineIds.has(a.id) && (
                              <span className="rounded border border-[#DFC992] bg-[#FAF3DF] px-1.5 py-0.5 text-[10px] font-bold text-[#8A6D1F]">
                                OFFLINE SẴN
                              </span>
                            )}
                            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-[#6E6450]">
                              {a.source === "winget" ? "Winget" : "Gói trực tiếp"}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-[#6E6450]">
                            {p && p.stage !== "done" ? (
                              <span
                                className={
                                  p.stage === "error"
                                    ? "font-medium text-red-600"
                                    : "font-medium text-[#9A7B2C]"
                                }
                              >
                                {p.message}
                              </span>
                            ) : (
                              a.description
                            )}
                          </p>
                          {p?.stage === "running" && p.percent != null && (
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#EFE9D8]">
                              <div
                                className="progress-smooth h-full rounded-full bg-gradient-to-r from-[#C5A044] to-[#9A7B2C]"
                                style={{ width: `${p.percent}%` }}
                              />
                            </div>
                          )}
                        </div>
                        <span className="hidden font-mono text-xs font-medium text-[#6E6450] sm:block">
                          {st?.installed_version ?? ""}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${b.cls}`}
                        >
                          {b.text}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeCatalogApp(a)}
                          disabled={
                            busy ||
                            st?.status === "missing" ||
                            st == null ||
                            a.uninstall.mode === "none"
                          }
                          className="w-16 rounded-lg border border-red-200/80 px-2.5 py-1 text-xs font-semibold text-red-700 transition-all duration-150 hover:bg-red-50 active:scale-[0.98] disabled:invisible"
                        >
                          {uninstallingId === a.id ? "…" : "Gỡ"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {!groups.length && (
              <p className="py-20 text-center text-sm text-[#8A7E66]">
                Không tìm thấy phần mềm chuẩn phù hợp với từ khoá "{query}".
              </p>
            )}
          </main>
        </div>
      ) : activeTab === "diagnostics" ? (
        <DiagnosticsTab isAdmin={isAdmin} onNotify={notify} />
      ) : activeTab === "cleaner" ? (
        <CleanerTab isAdmin={isAdmin} onNotify={notify} />
      ) : activeTab === "printer" ? (
        <PrinterTab isAdmin={isAdmin} onNotify={notify} />
      ) : (
        <UninstallerTab
          isAdmin={isAdmin}
          programs={installedPrograms}
          query={query}
          scanning={scanning}
          onRefresh={refreshStates}
          onExportInventory={exportWorkstationInventory}
          onNotify={notify}
        />
      )}

      {/* PROGRESS BAR */}
      {activeTab === "catalog" && (busy || prog.length > 0) && (
        <div className="border-t border-[#EAE2CE] bg-white px-6 py-2.5">
          <div className="mb-1 flex justify-between text-xs font-medium text-[#6E6450]">
            <span>
              {busy
                ? "Đang xử lý: " +
                  (prog
                    .filter((p) => p.stage === "running")
                    .map((p) => nameOf(p.id))
                    .join(", ") || "…")
                : "Tiến trình cài đặt tự động (Silent) hoàn tất"}
            </span>
            <span className="font-semibold text-[#9A7B2C]">
              {finished}/{total} gói · {overall}%
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#EFE9D8]">
            <div
              className="progress-smooth h-full rounded-full bg-gradient-to-r from-[#C5A044] to-[#9A7B2C]"
              style={{ width: `${overall}%` }}
            />
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-[#EAE2CE] bg-white/95 px-6 py-3 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2.5 text-xs text-[#6E6450]">
          <button
            type="button"
            onClick={chooseDir}
            className="shrink-0 rounded-xl border border-[#DFC992] bg-[#FAF3DF] px-3 py-1.5 font-semibold text-[#8A6D1F] transition-all duration-150 hover:bg-[#F3E6C3] active:scale-[0.98]"
          >
            📁 Thư mục packages…
          </button>
          <span className="truncate font-mono text-[11px] text-[#2B2B2B]" title={packagesDir}>
            {packagesDir}
          </span>
          <span className="shrink-0 rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-[#5C5446]">
            {offlineIds.size} gói offline
          </span>
          <span className="text-[#D4C39A]" aria-hidden="true">·</span>
          <span className="shrink-0 text-[11px] font-medium text-[#8A7E66]">
            © 2026 Created By Mr. Dương
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={exportWorkstationInventory}
            className="rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] px-3.5 py-2 text-xs font-semibold text-[#2B2B2B] transition-all duration-150 hover:border-[#B5943B] hover:bg-[#FAF3DF]/60 active:scale-[0.98]"
          >
            Xuất kiểm kê máy trạm
          </button>
          <button
            type="button"
            onClick={report}
            className="rounded-xl border border-[#EAE2CE] bg-white px-3.5 py-2 text-xs font-semibold text-[#5C5446] transition-all duration-150 hover:bg-stone-50 active:scale-[0.98]"
          >
            Xuất báo cáo
          </button>
          <button
            type="button"
            onClick={() => run(updatable, true)}
            disabled={busy || !updatable.length}
            className="rounded-xl border border-[#DFC992] bg-[#FAF3DF] px-3.5 py-2 text-xs font-bold text-[#8A6D1F] transition-all duration-150 hover:bg-[#F3E6C3] active:scale-[0.98] disabled:opacity-40"
          >
            Cập nhật ({updatable.length})
          </button>
          <button
            type="button"
            onClick={() => run([...selected], false)}
            disabled={busy || !selected.size}
            className="rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] px-5 py-2 text-xs font-bold text-white shadow-md transition-all duration-150 hover:brightness-105 active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? "Đang cài đặt…" : `Cài đặt (${selected.size})`}
          </button>
        </div>
      </footer>

      {toast && (
        <div className="toast-enter fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-[#DFC992] bg-[#2B2B2B] px-4 py-2.5 text-xs font-semibold text-[#FAF3DF] shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
