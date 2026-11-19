import catalogRaw from "../../catalog/apps.json";

export interface Branding {
  app_name: string;
  author: string;
  subbrand: string;
  logo_url: string;
  icon_url?: string;
  primary_color: string;
  hero_badge: string;
  hero_title: string;
  hero_highlight: string;
  hero_subtitle: string;
}

export interface SiteContent {
  nav_apps: string;
  nav_docs: string;
  nav_changelog: string;
  nav_admin: string;
  hero_badge: string;
  hero_title: string;
  hero_highlight: string;
  hero_subtitle: string;
  btn_download_primary: string;
  btn_download_portable: string;
  hero_version_note: string;
  ps_title: string;
  ps_note: string;
  ps_admin_link: string;
  profiles_eyebrow: string;
  profiles_title: string;
  profiles_subtitle: string;
  catalog_eyebrow: string;
  catalog_title: string;
  catalog_search_placeholder: string;
  footer_desc: string;
  footer_nav_title: string;
  footer_infra_title: string;
  footer_copyright: string;
}

export interface LauncherInfo {
  name: string;
  version: string;
  release_url: string;
  downloads: {
    windows: string;
    windows_portable: string;
  };
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  apps: string[];
}

export interface AppItem {
  id: string;
  name: string;
  description: string;
  category: string;
  hidden?: boolean;
  source: "winget" | "direct";
  version: string;
  winget?: {
    id: string;
    scope?: string;
  };
  direct?: {
    url: string;
    installer_type: string;
    silent_args: string[];
    sha256: string | null;
  };
  dependencies?: string[];
  uninstall?: {
    mode: string;
    args?: string[];
  };
  changelog_url: string;
  docs_slug?: string;
  detect?: {
    display_names: string[];
    registry_keys: string[];
    install_paths: string[];
  };
}

export interface CatalogData {
  catalog_version: number;
  updated_at: string;
  repo: string;
  site_url: string;
  branding?: Branding;
  site_content?: Partial<SiteContent>;
  launcher: LauncherInfo;
  profiles: Profile[];
  apps: AppItem[];
}

export const defaultBranding: Branding = {
  app_name: "AllSoft Desktop",
  author: "Created By Mr. Dương",
  subbrand: "CREATIVE X TECHNOLOGY",
  logo_url: "/AllSoftDesktop/logo.png",
  icon_url: "/AllSoftDesktop/icon.png",
  primary_color: "#B5943B",
  hero_badge: "Hệ sinh thái chuẩn hóa máy trạm",
  hero_title: "Cài đặt & Chuẩn hóa Máy trạm",
  hero_highlight: "Tự động & Thông minh",
  hero_subtitle:
    "Giải pháp đồng bộ hóa phần mềm văn phòng, y tế, chữ ký số và driver thiết bị ngoại vi tập trung, nhanh gọn và an toàn.",
};

export const defaultSiteContent: SiteContent = {
  nav_apps: "Phần mềm",
  nav_docs: "Tài liệu",
  nav_changelog: "Nhật ký",
  nav_admin: "Quản trị",
  hero_badge: "Hệ sinh thái chuẩn hóa máy trạm",
  hero_title: "Cài đặt & Chuẩn hóa Máy trạm",
  hero_highlight: "Tự động & Thông minh",
  hero_subtitle:
    "Giải pháp đồng bộ hóa phần mềm văn phòng, y tế, chữ ký số và driver thiết bị ngoại vi tập trung, nhanh gọn và an toàn.",
  btn_download_primary: "Tải Phần mềm AllSoft Desktop cho Windows",
  btn_download_portable: "Bản Portable (.exe)",
  hero_version_note: "Phiên bản 1.0.0 · Dành cho Windows 10 & 11 (64-bit)",
  ps_title: "Cài nhanh bằng 1 dòng lệnh PowerShell (Run as Administrator)",
  ps_note: "Mở PowerShell bằng quyền Quản trị viên và dán lệnh để cài đặt tự động.",
  ps_admin_link: "Tùy chỉnh kho phần mềm →",
  profiles_eyebrow: "GÓI PHẦN MỀM THEO VỊ TRÍ CÔNG TÁC",
  profiles_title: "Hồ sơ Triển khai (Profiles)",
  profiles_subtitle:
    "Chọn hồ sơ bên dưới để lọc nhanh danh sách phần mềm tiêu chuẩn theo từng phòng ban",
  catalog_eyebrow: "KHO PHẦN MỀM CHUẨN HÓA",
  catalog_title: "Danh mục Phần mềm",
  catalog_search_placeholder: "Tìm phần mềm, mã winget, mô tả...",
  footer_desc:
    "Giải pháp chuẩn hóa máy trạm, tự động hóa cài đặt, bảo trì hệ thống và quản trị phần mềm tập trung dành cho bệnh viện, cơ quan hành chính và doanh nghiệp.",
  footer_nav_title: "Điều hướng Hệ thống",
  footer_infra_title: "Hạ tầng & Phát hành",
  footer_copyright: "© 2026 AllSoft Desktop · Created By Mr. Dương",
};

export const catalog: CatalogData = catalogRaw as CatalogData;

export const branding: Branding = {
  ...defaultBranding,
  ...(catalog.branding ?? {}),
};

export const siteContent: SiteContent = {
  ...defaultSiteContent,
  ...(catalog.site_content ?? {}),
};

// Bỏ qua các app có hidden: true trong danh mục hiển thị
export const visibleApps: AppItem[] = catalog.apps.filter((app) => !app.hidden);

export const categories: string[] = [
  "Tất cả",
  ...Array.from(new Set(visibleApps.map((a) => a.category))),
];

