export interface Profile {
  id: string;
  name: string;
  description: string;
  apps: string[];
}

export interface CatalogApp {
  id: string;
  name: string;
  description: string;
  category: string;
  hidden: boolean;
  source: "winget" | "direct";
  version: string;
  dependencies: string[];
  uninstall: { mode: "winget" | "registry" | "none"; args: string[] };
  changelog_url?: string | null;
}

export interface Catalog {
  catalog_version: number;
  updated_at: string;
  repo: string;
  launcher: { name: string; version: string };
  profiles: Profile[];
  apps: CatalogApp[];
}

export interface CatalogPayload {
  catalog: Catalog;
  origin: "online" | "cache" | "bundled";
}

export interface AppState {
  id: string;
  status: "installed" | "update" | "missing";
  installed_version: string | null;
}

export interface Progress {
  id: string;
  stage: "running" | "done" | "error" | "skipped";
  message: string;
  percent: number | null;
  index: number;
  total: number;
}

export interface UpdateInfo {
  available: boolean;
  current: string;
  latest: string;
  url: string;
}

export interface CliArgs {
  profile: string | null;
  auto: boolean;
}

// ===== SHARED TASK PROGRESS (Diagnostics / Cleaner / Uninstaller / Printer) =====
export interface TaskProgress {
  module: "diagnostics" | "cleaner" | "uninstaller" | "printer";
  step: string;
  percent: number;
  done?: boolean;
  cancelled?: boolean;
}

// ===== MODULE 1: DIAGNOSTICS =====
export type DiagnosticSeverity = "critical" | "warning" | "ok";

export interface DiagnosticItem {
  id: string;
  severity: DiagnosticSeverity;
  category: string;
  source: string;
  event_id?: string | null;
  title: string;
  count: number;
  last_seen: string;
  summary: string;
  recommendation: string;
  details?: string | null;
}

export interface DiagnosticReport {
  scanned_at: string;
  is_admin: boolean;
  critical_count: number;
  warning_count: number;
  ok_count: number;
  items: DiagnosticItem[];
  ai_markdown: string;
}

// ===== MODULE 2: CLEANER =====
export type CleanerLevel = "green" | "yellow" | "red";

export interface CleanerTargetMeta {
  id: string;
  name: string;
  level: CleanerLevel;
  description: string;
  note?: string;
  warning?: string;
  defaultChecked: boolean;
}

export interface CleanerScanItem {
  id: string;
  size_bytes: number;
  file_count: number;
  accessible: boolean;
  note?: string | null;
}

export interface CleanerScanResult {
  scanned_at: string;
  total_bytes: number;
  total_files: number;
  items: CleanerScanItem[];
}

export interface CleanerRunResult {
  freed_bytes: number;
  deleted_files: number;
  skipped_locked_files: number;
  cancelled: boolean;
  notes: string[];
}

// ===== MODULE 3: CLEAN UNINSTALLER =====
export type LeftoverKind = "folder" | "file" | "registry";

export interface LeftoverItem {
  id: string;
  kind: LeftoverKind;
  path: string;
  size_bytes: number;
  detail: string;
  safe_to_delete: boolean;
}

export interface LeftoverScanResult {
  program_name: string;
  scanned_at: string;
  blacklist_active: boolean;
  protected_scopes: string[];
  items: LeftoverItem[];
}

export interface LeftoverCleanResult {
  deleted_files_count: number;
  deleted_registry_count: number;
  freed_bytes: number;
  skipped_count: number;
  reg_backup_path: string | null;
  cancelled: boolean;
}

// ===== MODULE 4: PRINTER RESCUE & LAN SHARE FIX =====
export interface PrinterInfo {
  name: string;
  driver: string;
  port: string;
  is_network: boolean;
  is_default: boolean;
  job_count: number;
  status: string;
  shared?: boolean;
  share_name?: string | null;
}

export interface PrinterShareFix {
  id: string;
  code: string;
  title: string;
  description: string;
  applied: boolean;
  risk_note?: string | null;
  reg_path?: string | null;
}

export interface PrinterStatusReport {
  spooler_status: string;
  stuck_jobs_count: number;
  stuck_files_count: number;
  printers: PrinterInfo[];
  share_fixes: PrinterShareFix[];
}

export interface SpoolerRescueResult {
  cleared_files: number;
  spooler_restarted: boolean;
  message: string;
}

export interface PrinterFixResult {
  applied_ids: string[];
  backup_reg_path: string | null;
  spooler_restarted: boolean;
  message: string;
  errors: string[];
}

export interface SharedPrinterCandidate {
  name: string;
  share_name: string;
  unc_path: string;
  remark?: string;
}

export interface PrinterHostProbe {
  host_ip: string;
  reachable_smb: boolean;
  latency_ms: number | null;
  shared_printers: SharedPrinterCandidate[];
  message: string;
}
