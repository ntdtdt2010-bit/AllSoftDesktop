import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppState,
  Catalog,
  CatalogPayload,
  CleanerRunResult,
  CleanerScanItem,
  CleanerScanResult,
  CleanerTargetMeta,
  CliArgs,
  DiagnosticItem,
  DiagnosticReport,
  DiagnosticSeverity,
  InstalledProgram,
  LeftoverCleanResult,
  LeftoverItem,
  LeftoverScanResult,
  PrinterFixResult,
  PrinterHostProbe,
  PrinterInfo,
  PrinterShareFix,
  PrinterStatusReport,
  Progress,
  SharedPrinterCandidate,
  SpoolerRescueResult,
  TaskProgress,
  UpdateInfo,
} from "./types";

export type { InstalledProgram };

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const CLEANER_TARGETS: CleanerTargetMeta[] = [
  // MỨC XANH — CƠ BẢN (AN TOÀN 100%, MẶC ĐỊNH TICK SẴN)
  {
    id: "user_temp",
    name: "Thư mục tạm người dùng (%TEMP%)",
    level: "green",
    description: "Xóa các tệp tạm do phần mềm tạo ra trong phiên làm việc của tài khoản hiện tại.",
    defaultChecked: true,
  },
  {
    id: "windows_temp",
    name: "Thư mục tạm hệ thống (C:\\Windows\\Temp)",
    level: "green",
    description: "Dọn các tệp cài đặt và tệp đệm hệ thống không còn sử dụng.",
    defaultChecked: true,
  },
  {
    id: "recycle_bin",
    name: "Thùng rác Windows (Recycle Bin)",
    level: "green",
    description: "Làm trống toàn bộ tệp đã xóa nằm trong Thùng rác để giải phóng dung lượng ngay.",
    defaultChecked: true,
  },
  {
    id: "thumb_shader_cache",
    name: "Cache hình thu nhỏ & DirectX Shader",
    level: "green",
    description: "Xóa bộ đệm ảnh thu nhỏ Explorer (Thumbnail) và bộ đệm đồ họa DirectX Shader cũ.",
    defaultChecked: true,
  },
  // MỨC VÀNG — TRUNG BÌNH (LƯU Ý NHỎ)
  {
    id: "windows_update_cache",
    name: "Windows Update Download Cache",
    level: "yellow",
    description: "Xóa gói cập nhật cũ trong SoftwareDistribution\\Download. Tự động tạm dừng & bật lại dịch vụ wuauserv an toàn.",
    note: "Tự động tạm dừng & bật lại wuauserv an toàn",
    defaultChecked: false,
  },
  {
    id: "prefetch",
    name: "Bộ nhớ đệm khởi động (C:\\Windows\\Prefetch)",
    level: "yellow",
    description: "Làm mới dữ liệu tăng tốc khởi động ứng dụng cũ. Windows sẽ tự tái tạo lại sau vài lần mở phần mềm.",
    note: "Lần mở ứng dụng kế tiếp có thể chậm hơn 1-2 giây",
    defaultChecked: false,
  },
  {
    id: "browser_cache",
    name: "Chỉ xóa Cache trình duyệt (Chrome / Edge / Cốc Cốc)",
    level: "yellow",
    description: "Xóa tệp đệm trang web (Cache/Code Cache/GPUCache) để nhẹ ổ đĩa.",
    note: "CAM KẾT: KHÔNG xóa Cookies, Mật khẩu, Lịch sử duyệt web hay Dấu trang",
    defaultChecked: false,
  },
  // MỨC ĐỎ — CHUYÊN SÂU (CẢNH BÁO TRƯỚC KHI TICK)
  {
    id: "dism_component_cleanup",
    name: "Dọn kho thành phần Windows (DISM StartComponentCleanup)",
    level: "red",
    description: "Chạy Dism /Online /Cleanup-Image /StartComponentCleanup để thu gọn thư mục WinSxS.",
    warning: "Sau khi chạy DISM StartComponentCleanup, bạn sẽ KHÔNG thể gỡ (rollback) các bản cập nhật Windows đã cài trước đó. Quá trình có thể mất 2–5 phút.",
    defaultChecked: false,
  },
  {
    id: "old_system_logs",
    name: "Log hệ thống & ứng dụng cũ (> 14 ngày)",
    level: "red",
    description: "Xóa các tệp nhật ký Windows Logs, CBS, DISM cũ hơn 14 ngày.",
    warning: "Việc xóa log hệ thống cũ sẽ khiến bạn không thể tra cứu lại nhật ký sự cố của hơn 14 ngày trước đó.",
    defaultChecked: false,
  },
  {
    id: "memory_dumps",
    name: "File Memory Dump BSOD cũ (Minidump / MEMORY.DMP)",
    level: "red",
    description: "Xóa các tệp kết xuất bộ nhớ khi máy bị màn hình xanh (BSOD) để giải phóng hàng trăm MB đến vài GB.",
    warning: "Nếu máy đang gặp lỗi màn hình xanh (BSOD) cần phân tích nguyên nhân, hãy chạy Tab Chẩn đoán lỗi và copy báo cáo trước khi xóa tệp Memory Dump.",
    defaultChecked: false,
  },
];

export interface SystemSpecs {
  cpu_name: string;
  cpu_threads: number;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  disk_drive: string;
  disk_free_gb: number;
  disk_total_gb: number;
  disk_used_percent: number;
  hostname: string;
  local_ip: string;
  os_version: string;
}

const MOCK_SYSTEM_SPECS: SystemSpecs = {
  cpu_name: "Intel Core i5-12400",
  cpu_threads: 12,
  ram_used_gb: 6.4,
  ram_total_gb: 16.0,
  ram_percent: 40,
  disk_drive: "C:",
  disk_free_gb: 148,
  disk_total_gb: 512,
  disk_used_percent: 71,
  hostname: "BV-KHAMBENH-01",
  local_ip: "192.168.1.105",
  os_version: "Windows 11 Pro 23H2",
};

const MOCK_CATALOG: Catalog = {
  catalog_version: 2,
  updated_at: "2026-11-10T00:00:00Z",
  repo: "ntdtdt2010-bit/AllSoftDesktop",
  launcher: {
    name: "AllSoft Desktop",
    version: "2.8.0",
  },
  profiles: [
    { id: "office", name: "Máy Văn phòng", description: "Trình duyệt, Office, nén file, hỗ trợ từ xa, chụp màn hình.", apps: ["coccoc", "onlyoffice", "winrar", "ultraviewer", "lightshot"] },
    { id: "accounting", name: "Máy Kế toán", description: "Bộ Văn phòng + chữ ký số VNPT-CA + VNeGP.", apps: ["coccoc", "onlyoffice", "winrar", "ultraviewer", "vnpt-ca", "vnegp-agent"] },
    { id: "reception", name: "Máy Lễ tân", description: "Bộ cơ bản + driver máy in hoá đơn và máy in màu.", apps: ["coccoc", "ultraviewer", "xprinter-driver", "epson-l8050"] },
    { id: "technician", name: "Máy Kỹ thuật", description: "Công cụ kiểm tra phần cứng và hỗ trợ.", apps: ["cpu-z", "ultraviewer", "winrar", "lightshot"] },
  ],
  apps: [
    {
      id: "coccoc",
      name: "Cốc Cốc",
      description: "Trình duyệt web tối ưu cho người Việt.",
      category: "Trình duyệt",
      hidden: false,
      source: "winget",
      version: "latest",
      dependencies: [],
      uninstall: { mode: "winget", args: [] },
      changelog_url: "https://coccoc.com",
    },
    {
      id: "onlyoffice",
      name: "ONLYOFFICE Desktop Editors",
      description: "Bộ soạn thảo văn bản, bảng tính, trình chiếu tương thích MS Office.",
      category: "Văn phòng",
      hidden: false,
      source: "winget",
      version: "latest",
      dependencies: [],
      uninstall: { mode: "winget", args: [] },
      changelog_url: "https://github.com/ONLYOFFICE/DesktopEditors/releases",
    },
    {
      id: "winrar",
      name: "WinRAR",
      description: "Nén và giải nén RAR/ZIP.",
      category: "Tiện ích",
      hidden: false,
      source: "winget",
      version: "latest",
      dependencies: [],
      uninstall: { mode: "winget", args: [] },
      changelog_url: "https://www.rarlab.com/rarnew.htm",
    },
    {
      id: "ultraviewer",
      name: "UltraViewer",
      description: "Điều khiển máy tính từ xa, hỗ trợ kỹ thuật.",
      category: "Hỗ trợ từ xa",
      hidden: false,
      source: "winget",
      version: "latest",
      dependencies: [],
      uninstall: { mode: "winget", args: [] },
      changelog_url: "https://www.ultraviewer.net",
    },
    {
      id: "lightshot",
      name: "Lightshot",
      description: "Chụp màn hình nhanh bằng phím PrtSc.",
      category: "Tiện ích",
      hidden: false,
      source: "winget",
      version: "latest",
      dependencies: [],
      uninstall: { mode: "winget", args: [] },
      changelog_url: "https://app.prntscr.com",
    },
    {
      id: "cpu-z",
      name: "CPU-Z",
      description: "Xem thông tin CPU, RAM, mainboard.",
      category: "Kỹ thuật",
      hidden: false,
      source: "winget",
      version: "latest",
      dependencies: [],
      uninstall: { mode: "winget", args: [] },
      changelog_url: "https://www.cpuid.com/softwares/cpu-z.html",
    },
    {
      id: "vnpt-ca",
      name: "VNPT-CA Token Manager",
      description: "Driver và trình quản lý chữ ký số VNPT-CA (USB Token).",
      category: "Chữ ký số",
      hidden: false,
      source: "direct",
      version: "1.0.0",
      dependencies: ["vcredist-x64"],
      uninstall: { mode: "registry", args: ["/S"] },
      changelog_url: "https://github.com/ntdtdt2010-bit/AllSoftDesktop/releases/tag/apps-v1",
    },
    {
      id: "vnegp-agent",
      name: "VNeGP Client Agent",
      description: "Phần mềm hỗ trợ ký số trên Hệ thống mạng đấu thầu quốc gia.",
      category: "Chữ ký số",
      hidden: false,
      source: "direct",
      version: "2.0.1",
      dependencies: ["dotnet-desktop-8"],
      uninstall: { mode: "registry", args: ["/VERYSILENT", "/NORESTART"] },
      changelog_url: "https://github.com/ntdtdt2010-bit/AllSoftDesktop/releases/tag/apps-v1",
    },
    {
      id: "xprinter-driver",
      name: "XPrinter Driver 8.2",
      description: "Driver máy in nhiệt/hoá đơn XPrinter (ghim bản 8.2).",
      category: "Driver",
      hidden: false,
      source: "direct",
      version: "8.2",
      dependencies: [],
      uninstall: { mode: "registry", args: ["/VERYSILENT"] },
      changelog_url: "https://github.com/ntdtdt2010-bit/AllSoftDesktop/releases/tag/apps-v1",
    },
    {
      id: "epson-l8050",
      name: "EPSON L8050 Driver",
      description: "Driver máy in màu EPSON L8050 Series.",
      category: "Driver",
      hidden: false,
      source: "direct",
      version: "1.0.0",
      dependencies: [],
      uninstall: { mode: "registry", args: [] },
      changelog_url: "https://github.com/ntdtdt2010-bit/AllSoftDesktop/releases/tag/apps-v1",
    },
    {
      id: "vcredist-x64",
      name: "Visual C++ Redistributable 2015-2022 (x64)",
      description: "Thư viện runtime C++ cho nhiều phần mềm.",
      category: "Nền tảng",
      hidden: true,
      source: "winget",
      version: "latest",
      dependencies: [],
      uninstall: { mode: "none", args: [] },
      changelog_url: "https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist",
    },
    {
      id: "dotnet-desktop-8",
      name: ".NET Desktop Runtime 8",
      description: "Nền tảng .NET 8 cho ứng dụng Windows.",
      category: "Nền tảng",
      hidden: true,
      source: "winget",
      version: "latest",
      dependencies: [],
      uninstall: { mode: "none", args: [] },
      changelog_url: "https://dotnet.microsoft.com/download/dotnet/8.0",
    },
    {
      id: "nodejs-lts",
      name: "Node.js LTS",
      description: "Nền tảng JavaScript runtime.",
      category: "Nền tảng",
      hidden: true,
      source: "winget",
      version: "latest",
      dependencies: [],
      uninstall: { mode: "winget", args: [] },
      changelog_url: "https://nodejs.org/en/blog/release",
    },
  ],
};

let mockStates: AppState[] = [
  { id: "coccoc", status: "installed", installed_version: "132.0.290" },
  { id: "onlyoffice", status: "update", installed_version: "8.1.0 → 8.2.2" },
  { id: "winrar", status: "installed", installed_version: "7.01.0" },
  { id: "ultraviewer", status: "installed", installed_version: "6.6.108" },
  { id: "lightshot", status: "missing", installed_version: null },
  { id: "cpu-z", status: "missing", installed_version: null },
  { id: "vnpt-ca", status: "installed", installed_version: "1.0.0" },
  { id: "vnegp-agent", status: "update", installed_version: "2.0.0 → 2.0.1" },
  { id: "xprinter-driver", status: "installed", installed_version: "8.2" },
  { id: "epson-l8050", status: "missing", installed_version: null },
];

let mockInstalledPrograms: InstalledProgram[] = [
  {
    id: "his-vnpt",
    name: "Phần mềm Quản lý Bệnh viện HIS-VNPT v4.2",
    version: "4.2.18",
    publisher: "VNPT IT · Trung tâm CNTT Y tế",
    install_date: "12/09/2026",
    size_mb: 386.0,
    in_catalog: false,
    uninstall_string: "C:\\Program Files\\VNPT\\HIS\\unins000.exe",
  },
  {
    id: "coccoc-installed",
    name: "Cốc Cốc",
    version: "132.0.290",
    publisher: "Cốc Cốc Co., Ltd",
    install_date: "14/08/2026",
    size_mb: 342.5,
    in_catalog: true,
    catalog_id: "coccoc",
    uninstall_string: "winget uninstall Coccoc.Coccoc",
  },
  {
    id: "onlyoffice-installed",
    name: "ONLYOFFICE Desktop Editors",
    version: "8.1.0",
    publisher: "Ascensio System SIA",
    install_date: "20/06/2026",
    size_mb: 518.0,
    in_catalog: true,
    catalog_id: "onlyoffice",
    uninstall_string: "winget uninstall ONLYOFFICE.DesktopEditors",
  },
  {
    id: "ms-office-ltsc",
    name: "Microsoft Office LTSC Professional Plus 2021",
    version: "16.0.14332.20763",
    publisher: "Microsoft Corporation",
    install_date: "15/03/2026",
    size_mb: 2450.0,
    in_catalog: false,
    uninstall_string: "C:\\Program Files\\Common Files\\Microsoft Shared\\ClickToRun\\OfficeClickToRun.exe",
  },
  {
    id: "zalo-pc",
    name: "Zalo PC 24.10.1",
    version: "24.10.1",
    publisher: "VNG Corporation",
    install_date: "18/10/2026",
    size_mb: 284.0,
    in_catalog: false,
    uninstall_string: "%LocalAppData%\\Programs\\Zalo\\Uninstall Zalo.exe",
  },
  {
    id: "google-chrome",
    name: "Google Chrome 131.0",
    version: "131.0.6778.86",
    publisher: "Google LLC",
    install_date: "02/11/2026",
    size_mb: 412.6,
    in_catalog: false,
    uninstall_string: "C:\\Program Files\\Google\\Chrome\\Application\\131.0.6778.86\\Installer\\setup.exe --uninstall",
  },
  {
    id: "vnpt-ca-installed",
    name: "VNPT-CA Token Manager",
    version: "1.0.0",
    publisher: "Tập đoàn Bưu chính Viễn thông Việt Nam (VNPT)",
    install_date: "01/09/2026",
    size_mb: 45.2,
    in_catalog: true,
    catalog_id: "vnpt-ca",
    uninstall_string: "C:\\Program Files (x86)\\VNPT-CA\\TokenManager\\unins000.exe /S",
  },
  {
    id: "viettel-ca",
    name: "Viettel-CA Token Manager",
    version: "5.2.1",
    publisher: "Tập đoàn Công nghiệp - Viễn thông Quân đội (Viettel)",
    install_date: "22/08/2026",
    size_mb: 52.4,
    in_catalog: false,
    uninstall_string: "C:\\Program Files (x86)\\Viettel-CA\\unins000.exe",
  },
  {
    id: "kaspersky-es",
    name: "Kaspersky Endpoint Security 12.6",
    version: "12.6.0.438",
    publisher: "AO Kaspersky Lab",
    install_date: "05/04/2026",
    size_mb: 680.5,
    in_catalog: false,
    uninstall_string: "MsiExec.exe /I{7911E943-32CC-45D0-A29C-56E6B7622755}",
  },
  {
    id: "winrar-installed",
    name: "WinRAR",
    version: "7.01.0",
    publisher: "win.rar GmbH",
    install_date: "10/05/2026",
    size_mb: 11.4,
    in_catalog: true,
    catalog_id: "winrar",
    uninstall_string: "C:\\Program Files\\WinRAR\\uninstall.exe",
  },
  {
    id: "ultraviewer-installed",
    name: "UltraViewer",
    version: "6.6.108",
    publisher: "DucFabulous Co., Ltd",
    install_date: "02/07/2026",
    size_mb: 8.6,
    in_catalog: true,
    catalog_id: "ultraviewer",
    uninstall_string: "C:\\Program Files (x86)\\UltraViewer\\unins000.exe",
  },
  {
    id: "teamviewer-15",
    name: "TeamViewer 15.58",
    version: "15.58.4",
    publisher: "TeamViewer Germany GmbH",
    install_date: "25/09/2026",
    size_mb: 146.2,
    in_catalog: false,
    uninstall_string: "C:\\Program Files\\TeamViewer\\uninstall.exe",
  },
  {
    id: "foxit-reader",
    name: "Foxit PDF Reader 2024",
    version: "2024.3.0.26795",
    publisher: "Foxit Software Inc.",
    install_date: "19/07/2026",
    size_mb: 325.8,
    in_catalog: false,
    uninstall_string: "C:\\Program Files (x86)\\Foxit Software\\Foxit PDF Reader\\unins000.exe",
  },
  {
    id: "unikey-nt",
    name: "Unikey NT 4.6 RC2",
    version: "4.6.2",
    publisher: "Pham Kim Long",
    install_date: "15/03/2026",
    size_mb: 2.1,
    in_catalog: false,
    uninstall_string: "C:\\Program Files\\UniKey\\uninstall.exe",
  },
  {
    id: "7zip-installed",
    name: "7-Zip 24.08",
    version: "24.08.00.0",
    publisher: "Igor Pavlov",
    install_date: "30/08/2026",
    size_mb: 5.4,
    in_catalog: false,
    uninstall_string: "C:\\Program Files\\7-Zip\\Uninstall.exe",
  },
  {
    id: "canon-lbp2900",
    name: "Canon LBP2900 Driver",
    version: "R1.50.03",
    publisher: "Canon Inc.",
    install_date: "03/05/2026",
    size_mb: 29.4,
    in_catalog: false,
    uninstall_string: "C:\\Program Files\\Canon\\CAPT Printer Driver\\CNAB4UN.EXE",
  },
  {
    id: "vcredist-2015-2022",
    name: "Visual C++ Redistributable 2015-2022",
    version: "14.40.33810",
    publisher: "Microsoft Corporation",
    install_date: "12/04/2026",
    size_mb: 36.8,
    in_catalog: true,
    catalog_id: "vcredist-x64",
    uninstall_string: "MsiExec.exe /X{36F68A90-239C-34DF-B58C-64B30153CE35}",
  },
  {
    id: "dotnet-runtime-8",
    name: ".NET Desktop Runtime 8.0.10",
    version: "8.0.10.34115",
    publisher: "Microsoft Corporation",
    install_date: "09/10/2026",
    size_mb: 214.5,
    in_catalog: false,
    uninstall_string: "MsiExec.exe /X{8B219029-984F-49E9-A8C0-9761F823D859}",
  },
];

function normalizeSystemSpecs(raw: Record<string, unknown> | null | undefined): SystemSpecs {
  if (!raw || typeof raw !== "object") return MOCK_SYSTEM_SPECS;
  const cpuName = String(raw.cpu_name ?? raw.cpu_model ?? raw.cpu ?? MOCK_SYSTEM_SPECS.cpu_name);
  const cpuThreads = Number(raw.cpu_threads ?? raw.cpu_cores ?? raw.threads ?? MOCK_SYSTEM_SPECS.cpu_threads);
  const ramUsed = Number(raw.ram_used_gb ?? raw.ram_used ?? MOCK_SYSTEM_SPECS.ram_used_gb);
  const ramTotal = Number(raw.ram_total_gb ?? raw.ram_total ?? MOCK_SYSTEM_SPECS.ram_total_gb);
  const ramPercent = Number(
    raw.ram_percent ?? (ramTotal > 0 ? Math.round((ramUsed / ramTotal) * 100) : MOCK_SYSTEM_SPECS.ram_percent)
  );
  const diskFree = Number(raw.disk_free_gb ?? raw.disk_free ?? MOCK_SYSTEM_SPECS.disk_free_gb);
  const diskTotal = Number(raw.disk_total_gb ?? raw.disk_total ?? MOCK_SYSTEM_SPECS.disk_total_gb);
  const diskUsedPercent = Number(
    raw.disk_used_percent ??
      (diskTotal > 0 ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : MOCK_SYSTEM_SPECS.disk_used_percent)
  );
  return {
    cpu_name: cpuName,
    cpu_threads: cpuThreads,
    ram_used_gb: Math.round(ramUsed * 10) / 10,
    ram_total_gb: Math.round(ramTotal * 10) / 10,
    ram_percent: ramPercent,
    disk_drive: String(raw.disk_drive ?? raw.drive ?? "C:"),
    disk_free_gb: Math.round(diskFree),
    disk_total_gb: Math.round(diskTotal),
    disk_used_percent: diskUsedPercent,
    hostname: String(raw.hostname ?? raw.computer_name ?? MOCK_SYSTEM_SPECS.hostname),
    local_ip: String(raw.local_ip ?? raw.ip ?? raw.lan_ip ?? MOCK_SYSTEM_SPECS.local_ip),
    os_version: String(raw.os_version ?? raw.os ?? MOCK_SYSTEM_SPECS.os_version),
  };
}

let progressListeners: Array<(p: Progress) => void> = [];

export const api = {
  catalog: async (): Promise<CatalogPayload> =>
    isTauri()
      ? invoke<CatalogPayload>("get_catalog")
      : { catalog: MOCK_CATALOG, origin: "online" },

  detect: async (): Promise<AppState[]> =>
    isTauri() ? invoke<AppState[]>("detect_states") : [...mockStates],

  systemSpecs: async (): Promise<SystemSpecs> => {
    if (isTauri()) {
      try {
        const res = await invoke<Record<string, unknown>>("get_system_specs");
        return normalizeSystemSpecs(res);
      } catch {
        return MOCK_SYSTEM_SPECS;
      }
    }
    return MOCK_SYSTEM_SPECS;
  },

  listInstalledPrograms: async (): Promise<InstalledProgram[]> => {
    if (isTauri()) {
      try {
        const list = await invoke<Array<Record<string, unknown>>>("list_installed_programs");
        if (Array.isArray(list) && list.length > 0) {
          return list.map((item, idx) => {
            const catId = item.catalog_app_id ?? item.catalog_id;
            return {
              id: String(item.id ?? item.key ?? `prog-${idx}`),
              name: String(item.name ?? item.display_name ?? "Không rõ tên"),
              version: String(item.version ?? item.display_version ?? "—"),
              publisher: String(item.publisher ?? "Không rõ nhà phát hành"),
              install_date: String(item.install_date ?? "—"),
              size_mb: Number(
                item.estimated_size_mb ??
                  item.size_mb ??
                  (item.estimated_size_kb ? Number(item.estimated_size_kb) / 1024 : 0)
              ),
              in_catalog: Boolean(item.in_catalog ?? item.is_standard ?? Boolean(catId)),
              catalog_id: catId ? String(catId) : null,
              install_location: String(item.install_location ?? ""),
              uninstall_string: item.uninstall_string ? String(item.uninstall_string) : null,
              quiet_uninstall_string: item.quiet_uninstall_string ? String(item.quiet_uninstall_string) : null,
            };
          });
        }
      } catch {
        // Fallback to mockInstalledPrograms if backend command not registered
      }
    }
    return [...mockInstalledPrograms];
  },

  uninstallProgram: async (program: InstalledProgram): Promise<void> => {
    if (isTauri()) {
      try {
        await invoke<void>("uninstall_program", {
          uninstallCmd: program.uninstall_string || program.quiet_uninstall_string || "",
        });
        return;
      } catch (err) {
        if (program.catalog_id) {
          await invoke<void>("uninstall_app", { id: program.catalog_id });
          return;
        }
        throw err;
      }
    }
    await new Promise((r) => setTimeout(r, 350));
    mockInstalledPrograms = mockInstalledPrograms.filter((p) => p.id !== program.id);
    if (program.catalog_id) {
      mockStates = mockStates.map((s) =>
        s.id === program.catalog_id ? { ...s, status: "missing", installed_version: null } : s
      );
    }
  },

  exportInventoryReport: async (specs: SystemSpecs, programs: InstalledProgram[]): Promise<string> => {
    if (isTauri()) {
      try {
        return await invoke<string>("export_inventory_report", { specs, programs });
      } catch {
        try {
          return await invoke<string>("export_report");
        } catch {
          // fallthrough
        }
      }
    }
    const payload = {
      exported_at: new Date().toISOString(),
      created_by: "Mr. Dương · Creative X Technology",
      workstation: specs,
      summary: {
        total_installed: programs.length,
        standard_allsoft: programs.filter((p) => p.in_catalog).length,
        external_software: programs.filter((p) => !p.in_catalog).length,
      },
      installed_programs: programs,
    };
    if (typeof window !== "undefined" && typeof Blob !== "undefined") {
      try {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `kiem-ke-may-tram-${specs.hostname}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        // ignore download error in headless preview
      }
    }
    return `C:\\AllSoftDesktop\\logs\\inventory-${specs.hostname}-2026-11-10.json`;
  },

  install: async (ids: string[], packagesDir: string | null, upgrade: boolean): Promise<number> => {
    if (isTauri()) return invoke<number>("install_apps", { ids, packagesDir, upgrade });
    const total = ids.length;
    for (let i = 0; i < total; i++) {
      const id = ids[i];
      progressListeners.forEach((cb) =>
        cb({ id, stage: "running", message: "Đang tải và cài đặt silent…", percent: 60, index: i + 1, total })
      );
      await new Promise((r) => setTimeout(r, 250));
      progressListeners.forEach((cb) =>
        cb({ id, stage: "done", message: "Đã cài đặt hoàn tất", percent: 100, index: i + 1, total })
      );
      mockStates = mockStates.map((s) =>
        s.id === id
          ? { ...s, status: "installed", installed_version: s.installed_version?.split(" → ").pop() ?? "latest" }
          : s
      );
    }
    return 0;
  },

  uninstall: async (id: string): Promise<void> => {
    if (isTauri()) return invoke<void>("uninstall_app", { id });
    mockStates = mockStates.map((s) => (s.id === id ? { ...s, status: "missing", installed_version: null } : s));
    mockInstalledPrograms = mockInstalledPrograms.filter((p) => p.catalog_id !== id);
  },

  defaultPackagesDir: async (): Promise<string> =>
    isTauri() ? invoke<string>("default_packages_dir") : "C:\\AllSoftDesktop\\packages",

  scanPackages: async (dir: string): Promise<string[]> =>
    isTauri()
      ? invoke<string[]>("scan_packages", { dir })
      : ["coccoc", "winrar", "vnpt-ca", "vnegp-agent", "xprinter-driver"],

  exportReport: async (): Promise<string> =>
    isTauri() ? invoke<string>("export_report") : "C:\\AllSoftDesktop\\logs\\install-report-2026-11-10.json",

  openPath: async (path: string): Promise<void> =>
    isTauri() ? invoke<void>("open_path", { path }) : undefined,

  cliArgs: async (): Promise<CliArgs> =>
    isTauri() ? invoke<CliArgs>("cli_args") : { profile: "office", auto: false },

  checkUpdate: async (): Promise<UpdateInfo> =>
    isTauri()
      ? invoke<UpdateInfo>("check_update")
      : { available: false, current: "2.8.0", latest: "2.8.0", url: "https://github.com/ntdtdt2010-bit/AllSoftDesktop/releases/latest" },

  applyUpdate: async (): Promise<void> =>
    isTauri() ? invoke<void>("apply_update") : undefined,

  pickFolder: async (): Promise<string | null> => {
    if (!isTauri()) return "C:\\AllSoftDesktop\\packages";
    const r = await open({ directory: true, multiple: false });
    return typeof r === "string" ? r : null;
  },

  onProgress: async (cb: (p: Progress) => void): Promise<UnlistenFn> => {
    if (isTauri()) return listen<Progress>("progress", (e) => cb(e.payload));
    progressListeners.push(cb);
    setTimeout(() => {
      cb({ id: "coccoc", stage: "done", message: "Đã cài đặt hoàn tất", percent: 100, index: 1, total: 5 });
      cb({ id: "onlyoffice", stage: "done", message: "Đã cài đặt hoàn tất", percent: 100, index: 2, total: 5 });
      cb({ id: "winrar", stage: "done", message: "Đã cài đặt hoàn tất", percent: 100, index: 3, total: 5 });
      cb({ id: "ultraviewer", stage: "done", message: "Đã cài đặt hoàn tất", percent: 100, index: 4, total: 5 });
      cb({ id: "lightshot", stage: "running", message: "Đang cài đặt silent (winget)… 68%", percent: 68, index: 5, total: 5 });
    }, 50);
    return () => {
      progressListeners = progressListeners.filter((x) => x !== cb);
    };
  },

  // ===== SHARED: ADMIN CHECK, CANCEL & TASK PROGRESS =====
  checkAdmin: async (): Promise<boolean> => {
    if (isTauri()) {
      try {
        const res = await invoke<boolean | { is_admin?: boolean }>("check_admin");
        if (typeof res === "boolean") return res;
        return Boolean(res?.is_admin);
      } catch {
        return false;
      }
    }
    if (typeof window !== "undefined") {
      const flag = new URLSearchParams(window.location.search).get("admin");
      if (flag === "0" || flag === "false") return false;
    }
    return true;
  },

  cancelActiveTask: async (): Promise<void> => {
    previewTaskCancelled = true;
    if (isTauri()) {
      try {
        await invoke<void>("cancel_active_task");
      } catch {
        // ignore if no active backend task
      }
    }
  },

  onTaskProgress: async (cb: (p: TaskProgress) => void): Promise<UnlistenFn> => {
    if (isTauri()) {
      return listen<TaskProgress>("tool-progress", (e) => cb(e.payload));
    }
    taskProgressListeners.push(cb);
    return () => {
      taskProgressListeners = taskProgressListeners.filter((x) => x !== cb);
    };
  },

  // ===== MODULE 1: DIAGNOSTICS =====
  runDiagnostics: async (): Promise<DiagnosticReport> => {
    previewTaskCancelled = false;
    if (isTauri()) {
      const raw = await invoke<Record<string, unknown>>("run_diagnostics");
      return normalizeDiagnosticReport(raw);
    }
    const steps: Array<{ step: string; percent: number }> = [
      { step: "Đọc Windows Event Log (System — Kernel-Power, BugCheck, Disk, NTFS)…", percent: 20 },
      { step: "Quét Application Event Log (App Error 1000, Crash lặp lại)…", percent: 42 },
      { step: "Kiểm tra tệp Minidump BSOD trong C:\\Windows\\Minidump…", percent: 64 },
      { step: "Kiểm tra dung lượng ổ đĩa, S.M.A.R.T & thiết bị PnP Driver lỗi…", percent: 84 },
      { step: "Khử trùng lặp sự kiện & tổng hợp báo cáo Markdown cho AI…", percent: 96 },
    ];
    for (const s of steps) {
      if (previewTaskCancelled) {
        emitTaskProgress({ module: "diagnostics", step: "Đã hủy tác vụ chẩn đoán", percent: s.percent, cancelled: true });
        throw new Error("Tác vụ chẩn đoán đã được người dùng hủy.");
      }
      emitTaskProgress({ module: "diagnostics", step: s.step, percent: s.percent });
      await sleepCancelable(420);
    }
    if (previewTaskCancelled) {
      emitTaskProgress({ module: "diagnostics", step: "Đã hủy tác vụ chẩn đoán", percent: 100, cancelled: true });
      throw new Error("Tác vụ chẩn đoán đã được người dùng hủy.");
    }
    emitTaskProgress({ module: "diagnostics", step: "Hoàn tất chẩn đoán hệ thống", percent: 100, done: true });
    return buildMockDiagnosticReport();
  },

  launchMemoryDiagnostic: async (): Promise<string> => {
    if (isTauri()) {
      await invoke<void>("launch_memory_diagnostic");
      return "Đã khởi chạy Windows Memory Diagnostic (mdsched.exe).";
    }
    return "Chế độ Preview: Đã mô phỏng gọi mdsched.exe (Windows Memory Diagnostic).";
  },

  // ===== MODULE 2: CLEANER =====
  scanCleanerTargets: async (ids: string[]): Promise<CleanerScanResult> => {
    previewTaskCancelled = false;
    if (isTauri()) {
      const targetIds = ids.length ? ids : CLEANER_TARGETS.map((t) => t.id);
      const raw = await invoke<
        Array<{ id: string; files_count: number; size_bytes: number; note?: string | null }>
      >("scan_cleaner_targets", { targetIds });
      const byId = new Map(raw.map((r) => [r.id, r]));
      const items: CleanerScanItem[] = CLEANER_TARGETS.map((t) => {
        const hit = byId.get(t.id);
        return {
          id: t.id,
          size_bytes: hit?.size_bytes ?? 0,
          file_count: hit?.files_count ?? 0,
          accessible: true,
          note: hit?.note ?? t.note ?? null,
        };
      });
      const selectedSet = new Set(targetIds);
      const total_bytes = items.filter((i) => selectedSet.has(i.id)).reduce((s, i) => s + i.size_bytes, 0);
      const total_files = items.filter((i) => selectedSet.has(i.id)).reduce((s, i) => s + i.file_count, 0);
      return {
        scanned_at: new Date().toLocaleTimeString("vi-VN"),
        total_bytes,
        total_files,
        items,
      };
    }
    const steps = [
      { step: "Đang quét %TEMP%, Windows\\Temp & Thùng rác…", percent: 28 },
      { step: "Đang tính dung lượng Thumbnail, DirectX Shader & Prefetch…", percent: 55 },
      { step: "Đang đo Windows Update Cache & Cache trình duyệt…", percent: 80 },
      { step: "Đang kiểm tra WinSxS, Log cũ > 14 ngày & Memory Dump…", percent: 95 },
    ];
    for (const s of steps) {
      if (previewTaskCancelled) {
        emitTaskProgress({ module: "cleaner", step: "Đã hủy quét thử", percent: s.percent, cancelled: true });
        throw new Error("Đã hủy quét thử dung lượng rác.");
      }
      emitTaskProgress({ module: "cleaner", step: s.step, percent: s.percent });
      await sleepCancelable(360);
    }
    emitTaskProgress({ module: "cleaner", step: "Hoàn tất quét thử dung lượng", percent: 100, done: true });

    const items: CleanerScanItem[] = CLEANER_TARGETS.map((t) => {
      const m = MOCK_CLEANER_SCAN[t.id] ?? { size_bytes: 0, file_count: 0 };
      return {
        id: t.id,
        size_bytes: m.size_bytes,
        file_count: m.file_count,
        accessible: true,
        note: t.note ?? null,
      };
    });
    const selectedSet = new Set(ids.length ? ids : CLEANER_TARGETS.map((t) => t.id));
    const total_bytes = items.filter((i) => selectedSet.has(i.id)).reduce((s, i) => s + i.size_bytes, 0);
    const total_files = items.filter((i) => selectedSet.has(i.id)).reduce((s, i) => s + i.file_count, 0);
    return {
      scanned_at: new Date().toLocaleTimeString("vi-VN"),
      total_bytes,
      total_files,
      items,
    };
  },

  runCleaner: async (ids: string[]): Promise<CleanerRunResult> => {
    previewTaskCancelled = false;
    if (isTauri()) {
      const raw = await invoke<{
        cancelled: boolean;
        total_freed_bytes: number;
        total_deleted_files: number;
        total_skipped_locked: number;
        outcomes: Array<{
          id: string;
          name: string;
          freed_bytes: number;
          deleted_files: number;
          skipped_locked: number;
          status: string;
          message: string;
        }>;
      }>("run_cleaner", { targetIds: ids });
      return {
        freed_bytes: raw.total_freed_bytes,
        deleted_files: raw.total_deleted_files,
        skipped_locked_files: raw.total_skipped_locked,
        cancelled: raw.cancelled,
        notes: raw.outcomes.map((o) => `${o.name}: ${o.message}`),
      };
    }
    let freed_bytes = 0;
    let deleted_files = 0;
    let skipped_locked_files = 0;
    const notes: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const meta = CLEANER_TARGETS.find((t) => t.id === id);
      const pct = Math.round(((i + 0.5) / Math.max(1, ids.length)) * 100);
      if (previewTaskCancelled) {
        emitTaskProgress({ module: "cleaner", step: "Đã dừng dọn rác theo yêu cầu", percent: pct, cancelled: true });
        return { freed_bytes, deleted_files, skipped_locked_files, cancelled: true, notes };
      }
      emitTaskProgress({
        module: "cleaner",
        step: `Đang dọn: ${meta?.name ?? id}…`,
        percent: pct,
      });
      await sleepCancelable(420);
      if (previewTaskCancelled) {
        emitTaskProgress({ module: "cleaner", step: "Đã dừng dọn rác theo yêu cầu", percent: pct, cancelled: true });
        return { freed_bytes, deleted_files, skipped_locked_files, cancelled: true, notes };
      }
      const stat = MOCK_CLEANER_SCAN[id] ?? { size_bytes: 0, file_count: 0 };
      const locked = id === "user_temp" || id === "windows_temp" ? 3 : id === "browser_cache" ? 2 : 0;
      freed_bytes += Math.max(0, stat.size_bytes - locked * 64 * 1024);
      deleted_files += Math.max(0, stat.file_count - locked);
      skipped_locked_files += locked;
      if (id === "windows_update_cache") {
        notes.push("Đã tạm dừng dịch vụ wuauserv, dọn SoftwareDistribution\\Download và khởi động lại dịch vụ an toàn.");
      }
      if (id === "browser_cache") {
        notes.push("Chỉ xóa Cache trình duyệt — giữ nguyên 100% Cookies, Mật khẩu và Lịch sử.");
      }
      if (id === "dism_component_cleanup") {
        notes.push("DISM /StartComponentCleanup hoàn tất thu gọn kho WinSxS.");
      }
    }
    emitTaskProgress({ module: "cleaner", step: "Hoàn tất dọn rác hệ thống", percent: 100, done: true });
    return { freed_bytes, deleted_files, skipped_locked_files, cancelled: false, notes };
  },

  // ===== MODULE 3: CLEAN UNINSTALLER (3 STEPS) =====
  runNativeUninstaller: async (program: InstalledProgram): Promise<{ cancelled: boolean; message: string }> => {
    previewTaskCancelled = false;
    if (isTauri()) {
      const cmd = program.uninstall_string || program.quiet_uninstall_string;
      if (!cmd) {
        throw new Error("Không tìm thấy lệnh gỡ cài đặt gốc hợp lệ.");
      }
      const msg = await invoke<string>("run_native_uninstaller", { uninstallCmd: cmd });
      return {
        cancelled: false,
        message: msg || `Trình gỡ cài đặt gốc của "${program.name}" đã hoàn tất.`,
      };
    }
    const steps = [
      { step: `Khởi chạy trình gỡ gốc cho ${program.name}…`, percent: 30 },
      { step: "Đang chờ tiến trình gỡ cài đặt gốc hoàn tất…", percent: 72 },
      { step: "Xác nhận gỡ cài đặt gốc thành công", percent: 100 },
    ];
    for (const s of steps) {
      if (previewTaskCancelled) {
        emitTaskProgress({ module: "uninstaller", step: "Đã hủy gỡ cài đặt gốc", percent: s.percent, cancelled: true });
        return { cancelled: true, message: "Đã hủy chạy trình gỡ cài đặt gốc." };
      }
      emitTaskProgress({ module: "uninstaller", step: s.step, percent: s.percent, done: s.percent === 100 });
      await sleepCancelable(450);
    }
    return { cancelled: false, message: `Trình gỡ cài đặt gốc của "${program.name}" đã hoàn tất.` };
  },

  scanLeftovers: async (program: InstalledProgram): Promise<LeftoverScanResult> => {
    previewTaskCancelled = false;
    if (isTauri()) {
      const raw = await invoke<
        Array<{ id: string; kind: "file" | "folder" | "registry"; path: string; size_bytes: number; reason: string }>
      >("scan_leftovers", {
        appName: program.name,
        publisher: program.publisher,
        installLocation: program.install_location ?? "",
      });
      const items: LeftoverItem[] = raw.map((r) => ({
        id: r.id,
        kind: r.kind,
        path: r.path,
        size_bytes: r.size_bytes ?? 0,
        detail: r.reason || "Tàn dư phần mềm",
        safe_to_delete: true,
      }));
      return {
        program_name: program.name,
        scanned_at: new Date().toLocaleTimeString("vi-VN"),
        blacklist_active: true,
        protected_scopes: ["Windows", "System32", "Microsoft", "Common Files", "Drivers"],
        items,
      };
    }
    const steps = [
      { step: "Kích hoạt Blacklist bảo vệ Windows / System32 / Microsoft / Drivers…", percent: 25 },
      { step: "Đang quét tàn dư tại Program Files, AppData & ProgramData…", percent: 58 },
      { step: "Đang rà soát khóa Registry còn sót tại HKCU & HKLM\\Software…", percent: 88 },
    ];
    for (const s of steps) {
      if (previewTaskCancelled) {
        emitTaskProgress({ module: "uninstaller", step: "Đã hủy quét tàn dư", percent: s.percent, cancelled: true });
        throw new Error("Đã hủy quét tàn dư.");
      }
      emitTaskProgress({ module: "uninstaller", step: s.step, percent: s.percent });
      await sleepCancelable(380);
    }
    emitTaskProgress({ module: "uninstaller", step: "Hoàn tất quét tàn dư File & Registry", percent: 100, done: true });
    return buildMockLeftovers(program);
  },

  cleanLeftovers: async (program: InstalledProgram, items: LeftoverItem[]): Promise<LeftoverCleanResult> => {
    previewTaskCancelled = false;
    if (isTauri()) {
      const rustItems = items.map((i) => ({
        id: i.id,
        kind: i.kind,
        path: i.path,
        size_bytes: i.size_bytes ?? 0,
        reason: i.detail || "",
      }));
      const raw = await invoke<{
        backup_reg_path: string | null;
        removed_count: number;
        freed_bytes: number;
        skipped_count: number;
        errors: string[];
      }>("remove_leftovers", {
        appName: program.name,
        items: rustItems,
      });
      const regCount = items.filter((i) => i.kind === "registry").length;
      const fileCount = Math.max(0, raw.removed_count - regCount);
      return {
        deleted_files_count: fileCount,
        deleted_registry_count: Math.min(regCount, raw.removed_count),
        freed_bytes: raw.freed_bytes,
        skipped_count: raw.skipped_count,
        reg_backup_path: raw.backup_reg_path,
        cancelled: false,
      };
    }
    const hasRegistry = items.some((i) => i.kind === "registry");
    const slug = program.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
    const reg_backup_path = hasRegistry
      ? `C:\\AllSoftDesktop\\Backups\\reg-backup-${slug}-2026-11-19.reg`
      : null;

    if (hasRegistry) {
      emitTaskProgress({ module: "uninstaller", step: `Đang sao lưu Registry ra ${reg_backup_path}…`, percent: 35 });
      await sleepCancelable(420);
      if (previewTaskCancelled) {
        return { deleted_files_count: 0, deleted_registry_count: 0, freed_bytes: 0, skipped_count: 0, reg_backup_path, cancelled: true };
      }
    }

    emitTaskProgress({ module: "uninstaller", step: "Đang xóa các tệp, thư mục và khóa Registry đã chọn…", percent: 78 });
    await sleepCancelable(420);
    if (previewTaskCancelled) {
      return { deleted_files_count: 0, deleted_registry_count: 0, freed_bytes: 0, skipped_count: 0, reg_backup_path, cancelled: true };
    }

    const fileItems = items.filter((i) => i.kind !== "registry");
    const regItems = items.filter((i) => i.kind === "registry");
    const freed_bytes = fileItems.reduce((sum, i) => sum + i.size_bytes, 0);

    // Gỡ khỏi danh sách mock trong Preview Mode
    mockInstalledPrograms = mockInstalledPrograms.filter((p) => p.id !== program.id);
    if (program.catalog_id) {
      mockStates = mockStates.map((s) =>
        s.id === program.catalog_id ? { ...s, status: "missing", installed_version: null } : s
      );
    }

    emitTaskProgress({ module: "uninstaller", step: "Đã dọn sạch tàn dư an toàn", percent: 100, done: true });
    return {
      deleted_files_count: fileItems.length,
      deleted_registry_count: regItems.length,
      freed_bytes,
      skipped_count: 0,
      reg_backup_path,
      cancelled: false,
    };
  },

  // ===== MODULE 4: PRINTER RESCUE & LAN SHARE FIX =====
  scanPrinterStatus: async (): Promise<PrinterStatusReport> => {
    previewTaskCancelled = false;
    if (isTauri()) {
      const raw = await invoke<Record<string, unknown>>("scan_printer_status");
      return normalizePrinterStatusReport(raw);
    }
    const steps = [
      { step: "Đang kiểm tra trạng thái dịch vụ Print Spooler…", percent: 25 },
      { step: "Đang quét hàng đợi lệnh in & tệp .SPL/.SHD trong Spool\\PRINTERS…", percent: 55 },
      { step: "Đang đọc danh sách máy in & trạng thái 4 bản vá Share mạng LAN…", percent: 88 },
    ];
    for (const s of steps) {
      if (previewTaskCancelled) {
        emitTaskProgress({ module: "printer", step: "Đã hủy quét trạng thái máy in", percent: s.percent, cancelled: true });
        throw new Error("Đã hủy quét trạng thái máy in.");
      }
      emitTaskProgress({ module: "printer", step: s.step, percent: s.percent });
      await sleepCancelable(240);
    }
    emitTaskProgress({ module: "printer", step: "Hoàn tất kiểm tra hệ thống máy in", percent: 100, done: true });
    return cloneMockPrinterStatus();
  },

  rescuePrintSpooler: async (): Promise<SpoolerRescueResult> => {
    previewTaskCancelled = false;
    if (isTauri()) {
      return invoke<SpoolerRescueResult>("rescue_print_spooler");
    }
    const steps = [
      { step: "Bước 1/3: Đang dừng dịch vụ Print Spooler (net stop spooler)…", percent: 28 },
      { step: "Bước 2/3: Đang xóa các tệp .SPL / .SHD bị kẹt trong C:\\Windows\\System32\\spool\\PRINTERS…", percent: 65 },
      { step: "Bước 3/3: Đang khởi động lại dịch vụ Print Spooler (net start spooler)…", percent: 92 },
    ];
    for (const s of steps) {
      if (previewTaskCancelled) {
        emitTaskProgress({ module: "printer", step: "Đã hủy tác vụ cứu hộ máy in", percent: s.percent, cancelled: true });
        throw new Error("Đã hủy tác vụ cứu hộ Print Spooler.");
      }
      emitTaskProgress({ module: "printer", step: s.step, percent: s.percent });
      await sleepCancelable(420);
    }
    const cleared = mockPrinterState.stuck_files_count;
    mockPrinterState = {
      ...mockPrinterState,
      spooler_status: "Running",
      stuck_jobs_count: 0,
      stuck_files_count: 0,
      printers: mockPrinterState.printers.map((p) => ({
        ...p,
        job_count: 0,
        status: "Sẵn sàng",
      })),
    };
    emitTaskProgress({ module: "printer", step: "Cứu hộ Print Spooler hoàn tất!", percent: 100, done: true });
    return {
      cleared_files: cleared,
      spooler_restarted: true,
      message:
        cleared > 0
          ? `Đã xả sạch ${cleared} tệp lệnh in bị kẹt (.SPL/.SHD) và khởi động lại Print Spooler thành công.`
          : "Đã khởi động lại dịch vụ Print Spooler sạch sẽ (không có tệp lệnh in nào bị kẹt).",
    };
  },

  applyPrinterShareFixes: async (fixIds: string[]): Promise<PrinterFixResult> => {
    previewTaskCancelled = false;
    if (isTauri()) {
      return invoke<PrinterFixResult>("apply_printer_share_fixes", { fixIds });
    }
    const backupPath = "C:\\AllSoftDesktop\\Backups\\printer-share-backup-2026-11-19.reg";
    const steps = [
      { step: `Đang sao lưu khóa Registry ra ${backupPath}…`, percent: 25 },
      { step: `Đang áp dụng ${fixIds.length} bản vá Share máy in mạng LAN (Windows 10/11)…`, percent: 62 },
      { step: "Đang khởi động lại Print Spooler để áp dụng cấu hình mới…", percent: 90 },
    ];
    for (const s of steps) {
      if (previewTaskCancelled) {
        emitTaskProgress({ module: "printer", step: "Đã hủy áp dụng bản vá Share máy in", percent: s.percent, cancelled: true });
        throw new Error("Đã hủy áp dụng bản vá Share máy in.");
      }
      emitTaskProgress({ module: "printer", step: s.step, percent: s.percent });
      await sleepCancelable(400);
    }
    const appliedSet = new Set(fixIds);
    mockPrinterState = {
      ...mockPrinterState,
      spooler_status: "Running",
      share_fixes: mockPrinterState.share_fixes.map((f) =>
        appliedSet.has(f.id) ? { ...f, applied: true } : f
      ),
    };
    emitTaskProgress({ module: "printer", step: "Đã áp dụng bản vá Share máy in hoàn tất", percent: 100, done: true });
    return {
      applied_ids: [...fixIds],
      backup_reg_path: backupPath,
      spooler_restarted: true,
      message: `Đã áp dụng thành công ${fixIds.length} bản vá Share máy in mạng LAN và khởi động lại Print Spooler.`,
      errors: [],
    };
  },

  probePrinterHost: async (hostIp: string): Promise<PrinterHostProbe> => {
    previewTaskCancelled = false;
    const target = hostIp.trim().replace(/^\\+/, "").split("\\")[0] || "";
    if (!target) {
      throw new Error("Vui lòng nhập địa chỉ IP hoặc tên máy chủ share máy in (VD: 192.168.1.50).");
    }
    if (isTauri()) {
      const raw = await invoke<Record<string, unknown>>("probe_printer_host", { hostIp: target });
      return normalizePrinterHostProbe(raw, target);
    }
    const steps = [
      { step: `Đang kiểm tra kết nối TCP cổng 445 (SMB) tới ${target}…`, percent: 40 },
      { step: `Đang liệt kê danh sách máy in đang chia sẻ trên \\\\${target}…`, percent: 82 },
    ];
    for (const s of steps) {
      if (previewTaskCancelled) {
        emitTaskProgress({ module: "printer", step: "Đã hủy kiểm tra máy chủ máy in", percent: s.percent, cancelled: true });
        throw new Error("Đã hủy kiểm tra máy chủ máy in.");
      }
      emitTaskProgress({ module: "printer", step: s.step, percent: s.percent });
      await sleepCancelable(360);
    }
    emitTaskProgress({ module: "printer", step: `Hoàn tất dò máy chủ ${target}`, percent: 100, done: true });
    const shared_printers: SharedPrinterCandidate[] = [
      {
        name: "Canon LBP2900",
        share_name: "Canon LBP2900",
        unc_path: `\\\\${target}\\Canon LBP2900`,
        remark: "Phòng Hành chính · Laser trắng đen A4",
      },
      {
        name: "HP LaserJet Pro M404dn",
        share_name: "HP_M404dn",
        unc_path: `\\\\${target}\\HP_M404dn`,
        remark: "Phòng Kế toán · In 2 mặt tự động",
      },
      {
        name: "XPrinter XP-80C (Hóa đơn)",
        share_name: "XPrinter_XP80C",
        unc_path: `\\\\${target}\\XPrinter_XP80C`,
        remark: "Quầy Thu ngân · Khổ giấy nhiệt 80mm",
      },
    ];
    return {
      host_ip: target,
      reachable_smb: true,
      latency_ms: target === "192.168.1.50" ? 2 : 4,
      shared_printers,
      message: `Kết nối SMB cổng 445 tới ${target} thông suốt — tìm thấy ${shared_printers.length} máy in đang chia sẻ.`,
    };
  },

  connectSharedPrinter: async (uncPath: string): Promise<string> => {
    previewTaskCancelled = false;
    const cleanUnc = uncPath.trim();
    if (!cleanUnc) {
      throw new Error("Đường dẫn máy in UNC không hợp lệ.");
    }
    if (isTauri()) {
      return invoke<string>("connect_shared_printer", { uncPath: cleanUnc });
    }
    emitTaskProgress({ module: "printer", step: `Đang kết nối máy in mạng ${cleanUnc}…`, percent: 55 });
    await sleepCancelable(420);
    if (previewTaskCancelled) {
      emitTaskProgress({ module: "printer", step: "Đã hủy kết nối máy in", percent: 55, cancelled: true });
      throw new Error("Đã hủy kết nối máy in.");
    }
    const exists = mockPrinterState.printers.some(
      (p) => p.name.toLowerCase() === cleanUnc.toLowerCase() || p.port.toLowerCase() === cleanUnc.toLowerCase()
    );
    if (!exists) {
      const shareName = cleanUnc.split("\\").filter(Boolean).pop() || cleanUnc;
      mockPrinterState = {
        ...mockPrinterState,
        printers: [
          ...mockPrinterState.printers,
          {
            name: cleanUnc,
            driver: `${shareName} Network Driver`,
            port: cleanUnc,
            is_network: true,
            is_default: false,
            job_count: 0,
            status: "Sẵn sàng",
            shared: true,
            share_name: shareName,
          },
        ],
      };
    }
    emitTaskProgress({ module: "printer", step: `Đã kết nối ${cleanUnc}`, percent: 100, done: true });
    return `Đã kết nối máy in mạng ${cleanUnc} thành công!`;
  },
};

// ===== PREVIEW MODE HELPERS & REALISTIC MOCK DATA =====
let previewTaskCancelled = false;
let taskProgressListeners: Array<(p: TaskProgress) => void> = [];

function emitTaskProgress(p: TaskProgress) {
  taskProgressListeners.forEach((cb) => cb(p));
}

function sleepCancelable(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const step = 40;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += step;
      if (previewTaskCancelled || elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, step);
  });
}

const MOCK_CLEANER_SCAN: Record<string, { size_bytes: number; file_count: number }> = {
  user_temp: { size_bytes: 482 * 1024 * 1024, file_count: 1284 },
  windows_temp: { size_bytes: 164 * 1024 * 1024, file_count: 342 },
  recycle_bin: { size_bytes: 890 * 1024 * 1024, file_count: 67 },
  thumb_shader_cache: { size_bytes: 215 * 1024 * 1024, file_count: 418 },
  windows_update_cache: { size_bytes: 1420 * 1024 * 1024, file_count: 95 },
  prefetch: { size_bytes: 46 * 1024 * 1024, file_count: 238 },
  browser_cache: { size_bytes: 635 * 1024 * 1024, file_count: 4820 },
  dism_component_cleanup: { size_bytes: 2150 * 1024 * 1024, file_count: 1420 },
  old_system_logs: { size_bytes: 128 * 1024 * 1024, file_count: 194 },
  memory_dumps: { size_bytes: 540 * 1024 * 1024, file_count: 2 },
};

function buildMockDiagnosticReport(): DiagnosticReport {
  const items: DiagnosticItem[] = [
    {
      id: "diag-kp41",
      severity: "critical",
      category: "Nguồn điện & Nhân hệ thống",
      source: "Microsoft-Windows-Kernel-Power",
      event_id: "Kernel-Power 41",
      title: "Máy tính tắt đột ngột không đúng quy trình (Kernel-Power 41)",
      count: 3,
      last_seen: "19/11/2026 08:42",
      summary: "Hệ thống khởi động lại mà không tắt nguồn sạch (BugcheckCode 0x0). Thường do sụt áp nguồn PSU, mất điện đột ngột hoặc lỗi RAM/driver.",
      recommendation: "Kiểm tra dây nguồn/UPS máy trạm, cập nhật BIOS/Chipset và chạy Windows Memory Diagnostic (mdsched.exe) để loại trừ lỗi thanh RAM.",
      details: "EventID=41 · Level=Critical · TaskCategory=63 · PowerButtonTimestamp=0",
    },
    {
      id: "diag-disk51",
      severity: "warning",
      category: "Ổ cứng & Lưu trữ",
      source: "Disk",
      event_id: "Disk 51",
      title: "Cảnh báo lỗi đọc/ghi phân trang trên thiết bị lưu trữ (Disk 51)",
      count: 2,
      last_seen: "18/11/2026 16:15",
      summary: "Phát hiện lỗi trong thao tác paging trên \\Device\\Harddisk0\\DR0. Có thể do cáp SATA lỏng hoặc SSD bắt đầu xuống cấp.",
      recommendation: "Sao lưu dữ liệu quan trọng, kiểm tra lại cáp kết nối ổ cứng và chạy lệnh 'chkdsk C: /scan' bằng quyền Administrator.",
      details: "EventID=51 · Device=\\Device\\Harddisk0\\DR0",
    },
    {
      id: "diag-pnp-printer",
      severity: "warning",
      category: "Thiết bị & Driver PnP",
      source: "PnP Device Manager",
      event_id: "PnP Code 28",
      title: "Driver thiết bị ngoại vi chưa hoàn chỉnh (EPSON L8050 Series)",
      count: 1,
      last_seen: "19/11/2026 09:10",
      summary: "Thiết bị USB Printing Support báo mã lỗi CM_PROB_FAILED_INSTALL (Code 28) — thiếu trình điều khiển chuẩn.",
      recommendation: "Mở Tab 'Danh mục Chuẩn' của AllSoft Desktop để cài lại gói Driver EPSON L8050 chính thức.",
      details: "InstanceId=USB\\VID_04B8&PID_11B2\\58343138 · ConfigManagerErrorCode=28",
    },
    {
      id: "diag-app1000",
      severity: "warning",
      category: "Ứng dụng (Application Log)",
      source: "Application Error",
      event_id: "App Error 1000",
      title: "Ứng dụng HIS-VNPT.exe đóng đột ngột (ucrtbase.dll)",
      count: 4,
      last_seen: "18/11/2026 14:22",
      summary: "Mô-đun lỗi ucrtbase.dll (Exception 0xc0000409). Thường xảy ra khi thiếu bản vá Visual C++ Redistributable mới nhất.",
      recommendation: "Cập nhật Visual C++ Redistributable 2015-2022 (x64) và kiểm tra bản vá mới nhất của HIS-VNPT.",
      details: "Faulting application: HIS-VNPT.exe v4.2.18 · Faulting module: ucrtbase.dll",
    },
    {
      id: "diag-minidump",
      severity: "ok",
      category: "Màn hình xanh (BSOD Minidump)",
      source: "Windows Minidump",
      event_id: "BugCheck 1001",
      title: "Không phát hiện file Minidump BSOD mới trong 14 ngày qua",
      count: 0,
      last_seen: "19/11/2026 10:40",
      summary: "Thư mục C:\\Windows\\Minidump sạch, chưa ghi nhận sự cố màn hình xanh gần đây.",
      recommendation: "Tiếp tục duy trì cập nhật driver ổn định.",
    },
    {
      id: "diag-disk-space",
      severity: "ok",
      category: "Dung lượng phân vùng hệ thống",
      source: "Storage Health",
      event_id: "Disk Space OK",
      title: "Ổ hệ thống C: còn trống 148 GB / 512 GB (29% trống — Đạt chuẩn)",
      count: 0,
      last_seen: "19/11/2026 10:40",
      summary: "Dung lượng trống trên 15%, đảm bảo Windows Update và pagefile vận hành ổn định.",
      recommendation: "Có thể dùng Tab 'Dọn rác' định kỳ mỗi tháng để giải phóng thêm 1–3 GB bộ đệm.",
    },
    {
      id: "diag-smart",
      severity: "ok",
      category: "Sức khỏe ổ đĩa & NTFS",
      source: "NTFS / S.M.A.R.T",
      event_id: "NTFS 55 OK",
      title: "Không phát hiện lỗi cấu trúc NTFS 55 hay cảnh báo S.M.A.R.T hỏng ổ",
      count: 0,
      last_seen: "19/11/2026 10:40",
      summary: "Trạng thái PredictFailure = False trên tất cả ổ đĩa vật lý.",
      recommendation: "Trạng thái phần cứng ổ đĩa ổn định.",
    },
  ];

  const critical_count = items.filter((i) => i.severity === "critical").length;
  const warning_count = items.filter((i) => i.severity === "warning").length;
  const ok_count = items.filter((i) => i.severity === "ok").length;

  const ai_markdown = [
    "# Báo cáo Chẩn đoán Máy trạm — AllSoft Desktop",
    "",
    "## 1. Cấu hình máy trạm",
    `- **Hostname:** ${MOCK_SYSTEM_SPECS.hostname} (${MOCK_SYSTEM_SPECS.local_ip})`,
    `- **Hệ điều hành:** ${MOCK_SYSTEM_SPECS.os_version}`,
    `- **CPU:** ${MOCK_SYSTEM_SPECS.cpu_name} (${MOCK_SYSTEM_SPECS.cpu_threads} luồng)`,
    `- **RAM:** ${MOCK_SYSTEM_SPECS.ram_used_gb} / ${MOCK_SYSTEM_SPECS.ram_total_gb} GB (${MOCK_SYSTEM_SPECS.ram_percent}%)`,
    `- **Ổ hệ thống:** ${MOCK_SYSTEM_SPECS.disk_drive} trống ${MOCK_SYSTEM_SPECS.disk_free_gb}/${MOCK_SYSTEM_SPECS.disk_total_gb} GB`,
    "",
    `## 2. Tổng quan sự cố (Đã khử trùng lặp)`,
    `- 🔴 Nghiêm trọng: **${critical_count}** | 🟡 Cảnh báo: **${warning_count}** | 🟢 Ổn định: **${ok_count}**`,
    "",
    "## 3. Chi tiết lỗi cần phân tích",
    ...items
      .filter((i) => i.severity !== "ok")
      .map(
        (i, idx) =>
          `### ${idx + 1}. [${i.severity.toUpperCase()}] ${i.event_id ?? i.source} — ${i.title} (×${i.count} lần · Gần nhất: ${i.last_seen})\n- **Tóm tắt:** ${i.summary}\n- **Chi tiết kỹ thuật:** \`${i.details ?? "N/A"}\`\n- **Khuyến nghị sơ bộ:** ${i.recommendation}`
      ),
    "",
    "---",
    "*Hãy phân tích nguyên nhân gốc rễ các lỗi trên và đề xuất các bước khắc phục cụ thể cho kỹ thuật viên IT Windows.*",
  ].join("\n");

  return {
    scanned_at: new Date().toLocaleTimeString("vi-VN"),
    is_admin: true,
    critical_count,
    warning_count,
    ok_count,
    items,
    ai_markdown,
  };
}

function buildMockLeftovers(program: InstalledProgram): LeftoverScanResult {
  const cleanName = program.name.replace(/\s+v?\d[\d.]*.*$/i, "").trim() || program.name;
  const shortDir = cleanName.replace(/[^a-zA-Z0-9\s-]/g, "").trim() || "AppData";
  const pubDir = program.publisher.split(/[·,(]/)[0].trim().replace(/[^a-zA-Z0-9\s-]/g, "") || shortDir;

  const items: LeftoverItem[] = [
    {
      id: "lo-folder-1",
      kind: "folder",
      path: `C:\\Users\\Admin\\AppData\\Local\\${shortDir}`,
      size_bytes: 28.4 * 1024 * 1024,
      detail: "Thư mục bộ nhớ đệm và cấu hình cục bộ còn sót sau khi gỡ",
      safe_to_delete: true,
    },
    {
      id: "lo-folder-2",
      kind: "folder",
      path: `C:\\Users\\Admin\\AppData\\Roaming\\${shortDir}`,
      size_bytes: 6.2 * 1024 * 1024,
      detail: "Tệp thiết lập người dùng & log ứng dụng cũ",
      safe_to_delete: true,
    },
    {
      id: "lo-folder-3",
      kind: "folder",
      path: `C:\\ProgramData\\${pubDir}\\${shortDir}`,
      size_bytes: 12.8 * 1024 * 1024,
      detail: "Dữ liệu dùng chung còn sót trong ProgramData",
      safe_to_delete: true,
    },
    {
      id: "lo-reg-1",
      kind: "registry",
      path: `HKCU\\Software\\${pubDir}\\${shortDir}`,
      size_bytes: 0,
      detail: "Khóa cấu hình người dùng hiện tại (sẽ backup .reg trước khi xóa)",
      safe_to_delete: true,
    },
    {
      id: "lo-reg-2",
      kind: "registry",
      path: `HKLM\\SOFTWARE\\${pubDir}\\${shortDir}`,
      size_bytes: 0,
      detail: "Khóa đăng ký phần mềm cấp hệ thống (sẽ backup .reg trước khi xóa)",
      safe_to_delete: true,
    },
  ];

  return {
    program_name: program.name,
    scanned_at: new Date().toLocaleTimeString("vi-VN"),
    blacklist_active: true,
    protected_scopes: ["C:\\Windows", "C:\\Windows\\System32", "Microsoft", "Drivers"],
    items,
  };
}

let mockPrinterState: PrinterStatusReport = {
  spooler_status: "Running",
  stuck_jobs_count: 3,
  stuck_files_count: 4,
  printers: [
    {
      name: "XPrinter XP-58IIH (Quầy tiếp đón)",
      driver: "XPrinter XP-58IIH Driver 8.2",
      port: "USB001",
      is_network: false,
      is_default: true,
      job_count: 2,
      status: "Kẹt lệnh in (2)",
      shared: false,
      share_name: null,
    },
    {
      name: "EPSON L8050 Series",
      driver: "EPSON L8050 Series",
      port: "USB002",
      is_network: false,
      is_default: false,
      job_count: 0,
      status: "Sẵn sàng",
      shared: true,
      share_name: "EPSON_L8050",
    },
    {
      name: "\\\\192.168.1.50\\Canon LBP2900",
      driver: "Canon LBP2900 (CAPT)",
      port: "\\\\192.168.1.50\\Canon LBP2900",
      is_network: true,
      is_default: false,
      job_count: 1,
      status: "Kẹt lệnh in (1)",
      shared: true,
      share_name: "Canon LBP2900",
    },
    {
      name: "Microsoft Print to PDF",
      driver: "Microsoft Print To PDF",
      port: "PORTPROMPT:",
      is_network: false,
      is_default: false,
      job_count: 0,
      status: "Sẵn sàng",
      shared: false,
      share_name: null,
    },
  ],
  share_fixes: [
    {
      id: "fix_0x0000011b",
      code: "0x0000011b",
      title: "Vá lỗi 0x0000011b — Chặn kết nối máy in Share (KB5005565)",
      description:
        "Đặt RpcAuthnLevelPrivacyEnabled = 0 trong HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print để khắc phục lỗi không kết nối được máy in chia sẻ trên mạng nội bộ.",
      applied: false,
      reg_path: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print",
    },
    {
      id: "fix_0x00000709",
      code: "0x00000709 / 0x00000040",
      title: "Vá lỗi 0x00000709 & 0x00000040 — RPC Named Pipes (Win 11 22H2+)",
      description:
        "Bật RpcUseNamedPipeProtocol = 1 và cấu hình Policies\\Microsoft\\Windows NT\\Printers\\RPC để kết nối mượt máy in share từ Windows 11 22H2/23H2/24H2.",
      applied: false,
      reg_path: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Printers\\RPC",
    },
    {
      id: "fix_0x00000bcb",
      code: "0x00000bcb",
      title: "Vá lỗi 0x00000bcb — Cài Driver máy in Share (Point and Print)",
      description:
        "Đặt RestrictDriverInstallationToAdministrators = 0 để cho phép máy trạm tự nhận Driver khi kết nối máy in chia sẻ từ máy chủ LAN.",
      applied: true,
      reg_path: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Printers\\PointAndPrint",
    },
    {
      id: "fix_lan_share_firewall",
      code: "Tường lửa LAN & Guest Auth",
      title: "Mở Tường lửa File & Printer Sharing + Cho phép Guest LAN",
      description:
        "Kích hoạt quy tắc Firewall nhóm 'File and Printer Sharing' (TCP 445/139) và bật AllowInsecureGuestAuth = 1 trong LanmanWorkstation cho mạng nội bộ.",
      applied: false,
      reg_path: "HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanWorkstation\\Parameters",
    },
  ],
};

function cloneMockPrinterStatus(): PrinterStatusReport {
  return {
    ...mockPrinterState,
    printers: mockPrinterState.printers.map((p) => ({ ...p })),
    share_fixes: mockPrinterState.share_fixes.map((f) => ({ ...f })),
  };
}

function normalizePrinterStatusReport(raw: Record<string, unknown>): PrinterStatusReport {
  const rawPrinters = Array.isArray(raw.printers) ? raw.printers : [];
  const printers: PrinterInfo[] = rawPrinters.map((item) => {
    const p = (item ?? {}) as Record<string, unknown>;
    const name = String(p.name ?? p.printer_name ?? "Máy in không tên");
    const port = String(p.port ?? p.port_name ?? "—");
    const isNetwork =
      typeof p.is_network === "boolean"
        ? p.is_network
        : typeof p.network === "boolean"
        ? p.network
        : name.startsWith("\\\\") || port.startsWith("\\\\") || /^(\d{1,3}\.){3}\d{1,3}/.test(port);
    const jobCount = Number(p.jobs_count ?? p.job_count ?? p.jobs ?? p.stuck_jobs ?? 0);
    const rawStatus = String(p.status ?? p.printer_status ?? (jobCount > 0 ? `Kẹt lệnh in (${jobCount})` : "Sẵn sàng"));
    const status =
      rawStatus.toLowerCase() === "normal"
        ? jobCount > 0
          ? `Kẹt lệnh in (${jobCount})`
          : "Sẵn sàng"
        : rawStatus;
    return {
      name,
      driver: String(p.driver_name ?? p.driver ?? "—"),
      port: port,
      is_network: isNetwork,
      is_default: Boolean(p.is_default ?? p.default ?? false),
      job_count: Number.isFinite(jobCount) ? jobCount : 0,
      status,
      shared: Boolean(p.shared ?? false),
      share_name: p.share_name ? String(p.share_name) : null,
    };
  });

  const rawFixes = Array.isArray(raw.share_fixes) ? raw.share_fixes : [];
  const share_fixes: PrinterShareFix[] = rawFixes.map((item, idx) => {
    const f = (item ?? {}) as Record<string, unknown>;
    const id = String(f.id ?? `fix-${idx}`);
    const title = String(f.name ?? f.title ?? id);
    return {
      id,
      code: String(f.error_codes ?? f.code ?? f.error_code ?? f.badge ?? id),
      title,
      description: String(f.description ?? f.detail ?? ""),
      applied: Boolean(f.applied ?? f.is_applied ?? false),
      risk_note: f.risk_note ? String(f.risk_note) : null,
      reg_path: f.reg_path ? String(f.reg_path) : null,
    };
  });

  return {
    spooler_status: String(raw.spooler_status ?? "Unknown"),
    stuck_jobs_count: Number(raw.stuck_jobs_count ?? 0),
    stuck_files_count: Number(raw.stuck_files_count ?? 0),
    printers,
    share_fixes,
  };
}

function normalizePrinterHostProbe(raw: Record<string, unknown>, fallbackHost: string): PrinterHostProbe {
  const host_ip = String(raw.host_ip ?? fallbackHost);
  const rawList = Array.isArray(raw.shared_printers) ? raw.shared_printers : [];
  const shared_printers: SharedPrinterCandidate[] = rawList.map((entry) => {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      const unc = trimmed.startsWith("\\\\") ? trimmed : `\\\\${host_ip}\\${trimmed}`;
      const shareName = unc.split("\\").filter(Boolean).pop() || trimmed;
      return { name: shareName, share_name: shareName, unc_path: unc };
    }
    const obj = (entry ?? {}) as Record<string, unknown>;
    const shareName = String(obj.share_name ?? obj.name ?? "SharedPrinter");
    const uncPath = String(obj.unc_path ?? (shareName.startsWith("\\\\") ? shareName : `\\\\${host_ip}\\${shareName}`));
    return {
      name: String(obj.name ?? shareName),
      share_name: shareName,
      unc_path: uncPath,
      remark: obj.remark ? String(obj.remark) : undefined,
    };
  });

  return {
    host_ip,
    reachable_smb: Boolean(raw.reachable_smb),
    latency_ms: raw.latency_ms == null ? null : Number(raw.latency_ms),
    shared_printers,
    message: String(raw.message ?? ""),
  };
}

function normalizeDiagnosticReport(raw: Record<string, unknown>): DiagnosticReport {
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items: DiagnosticItem[] = rawItems.map((entry, idx) => {
    const it = (entry ?? {}) as Record<string, unknown>;
    const rawSev = String(it.severity ?? "ok").toLowerCase();
    const severity: DiagnosticSeverity =
      rawSev === "critical" || rawSev === "warning" || rawSev === "ok" ? rawSev : "ok";
    const rawEventId = it.event_id ?? it.code ?? null;
    return {
      id: String(it.id ?? `diag-${idx}`),
      category: String(it.category ?? "Hệ thống"),
      severity,
      source: String(it.source ?? it.code ?? "System"),
      event_id: rawEventId != null && String(rawEventId) !== "" ? String(rawEventId) : null,
      title: String(it.title ?? "Sự kiện hệ thống"),
      count: Number(it.count ?? 0),
      last_seen: String(it.last_seen ?? "—"),
      summary: String(it.summary ?? it.detail ?? ""),
      recommendation: String(it.recommendation ?? ""),
      details: it.details ? String(it.details) : null,
    };
  });

  const summaryObj =
    raw.summary && typeof raw.summary === "object"
      ? (raw.summary as Record<string, unknown>)
      : null;

  const critical_count = Number(
    summaryObj?.critical ??
      raw.critical_count ??
      items.filter((i) => i.severity === "critical").length
  );
  const warning_count = Number(
    summaryObj?.warning ??
      raw.warning_count ??
      items.filter((i) => i.severity === "warning").length
  );
  const ok_count = Number(
    summaryObj?.ok ??
      raw.ok_count ??
      items.filter((i) => i.severity === "ok").length
  );

  return {
    scanned_at: String(raw.scanned_at ?? new Date().toLocaleTimeString("vi-VN")),
    is_admin: Boolean(raw.is_admin ?? false),
    critical_count: Number.isFinite(critical_count) ? critical_count : 0,
    warning_count: Number.isFinite(warning_count) ? warning_count : 0,
    ok_count: Number.isFinite(ok_count) ? ok_count : 0,
    items,
    ai_markdown: String(raw.ai_markdown ?? ""),
  };
}
