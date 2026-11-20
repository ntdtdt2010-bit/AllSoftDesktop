"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AppWindow,
  BookOpen,
  CheckCircle2,
  Download,
  ExternalLink,
  Filter,
  Layers,
  Search,
  Shield,
  Sparkles,
  Terminal,
} from "lucide-react";
import {
  catalog as staticCatalog,
  defaultBranding,
  AppItem,
  Branding,
  CatalogData,
  Profile,
} from "@/lib/catalog";
import { SmartDownloadButton } from "@/components/SmartDownloadButton";
import { CopyButton } from "@/components/CopyButton";
import { QRCodeModal } from "@/components/QRCodeModal";

interface HomeSiteContent {
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
}

const DEFAULT_HOME_CONTENT: HomeSiteContent = {
  hero_badge: "Hệ sinh thái chuẩn hóa máy trạm",
  hero_title: "Cài đặt & Chuẩn hóa Máy trạm",
  hero_highlight: "Tự động & Thông minh",
  hero_subtitle:
    "Giải pháp đồng bộ hóa phần mềm văn phòng, y tế, chữ ký số và driver thiết bị ngoại vi tập trung, nhanh gọn và an toàn.",
  btn_download_primary: "Tải Phần mềm AllSoft Desktop cho Windows",
  btn_download_portable: "Bản Portable (.exe)",
  hero_version_note: "Phiên bản 2.8.0 · Dành cho Windows 10 & 11 (64-bit)",
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
};

function readStaticHomeContent(): Partial<HomeSiteContent> {
  const raw = (staticCatalog as unknown as { site_content?: Partial<HomeSiteContent> })?.site_content;
  return raw && typeof raw === "object" ? raw : {};
}

function mergeHomeContent(source?: Partial<HomeSiteContent> | null): HomeSiteContent {
  const staticPart = readStaticHomeContent();
  const pick = <K extends keyof HomeSiteContent>(key: K): string => {
    const val = source?.[key];
    if (typeof val === "string" && val.trim() !== "") return val;
    const sVal = staticPart[key];
    if (typeof sVal === "string" && sVal.trim() !== "") return sVal;
    return DEFAULT_HOME_CONTENT[key];
  };

  return {
    hero_badge: pick("hero_badge"),
    hero_title: pick("hero_title"),
    hero_highlight: pick("hero_highlight"),
    hero_subtitle: pick("hero_subtitle"),
    btn_download_primary: pick("btn_download_primary"),
    btn_download_portable: pick("btn_download_portable"),
    hero_version_note: pick("hero_version_note"),
    ps_title: pick("ps_title"),
    ps_note: pick("ps_note"),
    ps_admin_link: pick("ps_admin_link"),
    profiles_eyebrow: pick("profiles_eyebrow"),
    profiles_title: pick("profiles_title"),
    profiles_subtitle: pick("profiles_subtitle"),
    catalog_eyebrow: pick("catalog_eyebrow"),
    catalog_title: pick("catalog_title"),
    catalog_search_placeholder: pick("catalog_search_placeholder"),
  };
}

const KNOWN_DOCS_SLUGS = new Set([
  "coccoc",
  "onlyoffice",
  "winrar",
  "ultraviewer",
  "lightshot",
  "cpu-z",
  "vnpt-ca",
  "vnegp-agent",
  "xprinter-driver",
  "epson-l8050",
]);

const GRADIENT_COLORS: Record<string, string> = {
  coccoc: "from-[#C5A044] to-[#9A7B2C]",
  onlyoffice: "from-[#2D2D2D] to-[#4A463B]",
  winrar: "from-[#B5943B] to-[#8A6D23]",
  ultraviewer: "from-[#3D3522] to-[#2B2B2B]",
  lightshot: "from-[#C5A044] to-[#8A6D23]",
  "cpu-z": "from-[#2B2B2B] to-[#1A1A1A]",
  "vnpt-ca": "from-[#9A7B2C] to-[#735A1B]",
  "vnegp-agent": "from-[#B5943B] to-[#9A7B2C]",
  "xprinter-driver": "from-[#4A4437] to-[#2B2B2B]",
  "epson-l8050": "from-[#C5A044] to-[#9A7B2C]",
};

export default function HomePage() {
  const [activeCatalog, setActiveCatalog] = useState<CatalogData>(staticCatalog);
  const [branding, setBranding] = useState<Branding>(
    staticCatalog.branding ?? defaultBranding
  );
  const [siteContent, setSiteContent] = useState<HomeSiteContent>(() => mergeHomeContent(null));
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("Tất cả");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  // Đồng bộ dữ liệu động từ localStorage và /api/catalog
  useEffect(() => {
    const loadDynamicCatalog = async () => {
      let loadedFromLocal = false;
      try {
        const localRaw = localStorage.getItem("allsoft_custom_catalog");
        if (localRaw) {
          const parsed = JSON.parse(localRaw);
          const isStaleVersion =
            parsed?.launcher?.version &&
            parsed.launcher.version !== staticCatalog.launcher.version;
          if (isStaleVersion) {
            localStorage.removeItem("allsoft_custom_catalog");
          } else if (parsed && Array.isArray(parsed.apps)) {
            setActiveCatalog(parsed);
            if (parsed.branding) {
              setBranding((prev) => ({ ...prev, ...parsed.branding }));
            }
            setSiteContent(mergeHomeContent(parsed.site_content));
            loadedFromLocal = true;
          }
        }
        const localLogo = localStorage.getItem("allsoft_custom_logo");
        if (localLogo) {
          setBranding((prev) => ({ ...prev, logo_url: localLogo }));
        }
      } catch {
        // Ignore localStorage parse errors
      }

      if (!loadedFromLocal) {
        try {
          const res = await fetch("/AllSoftDesktop/api/catalog", { cache: "no-store" });
          if (res.ok) {
            const apiData = await res.json();
            if (apiData && Array.isArray(apiData.apps)) {
              setActiveCatalog(apiData);
              if (apiData.branding) {
                setBranding((prev) => ({ ...prev, ...apiData.branding }));
              }
              setSiteContent(mergeHomeContent(apiData.site_content));
            }
          }
        } catch {
          // Fallback về staticCatalog
        }
      }
    };

    const handleSync = () => {
      void loadDynamicCatalog();
    };

    void loadDynamicCatalog();
    window.addEventListener("storage", handleSync);
    window.addEventListener("allsoft-catalog-updated", handleSync);
    return () => {
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("allsoft-catalog-updated", handleSync);
    };
  }, []);

  const visibleApps = useMemo(() => {
    return (activeCatalog.apps || []).filter((app) => !app.hidden);
  }, [activeCatalog]);

  const categories = useMemo(() => {
    return ["Tất cả", ...Array.from(new Set(visibleApps.map((a) => a.category)))];
  }, [visibleApps]);

  const installCommand = `irm ${activeCatalog.site_url}/install.ps1 | iex`;
  const docsBaseUrl = `${activeCatalog.site_url}/docs`;

  // Giữ tương thích đọc title/subtitle từ siteContent (ưu tiên) và tránh gắn dư bản quyền
  const heroTitle = siteContent.hero_title || branding.hero_title;
  const heroHighlight = siteContent.hero_highlight || branding.hero_highlight;
  const heroSubtitle = siteContent.hero_subtitle || branding.hero_subtitle;

  const filteredApps = useMemo(() => {
    return visibleApps.filter((app) => {
      const matchSearch =
        searchTerm.trim() === "" ||
        app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (app.winget?.id && app.winget.id.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchCategory =
        selectedCategory === "Tất cả" || app.category === selectedCategory;

      let matchProfile = true;
      if (selectedProfileId) {
        const profile = activeCatalog.profiles.find((p) => p.id === selectedProfileId);
        if (profile) {
          matchProfile = profile.apps.includes(app.id);
        }
      }

      return matchSearch && matchCategory && matchProfile;
    });
  }, [visibleApps, activeCatalog.profiles, searchTerm, selectedCategory, selectedProfileId]);

  const handleProfileClick = (profileId: string) => {
    if (selectedProfileId === profileId) {
      setSelectedProfileId(null);
    } else {
      setSelectedProfileId(profileId);
      setSelectedCategory("Tất cả");
      const el = document.getElementById("catalog");
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
    }
  };

  return (
    <div className="flex flex-col gap-12 sm:gap-16 pb-20 w-full overflow-x-hidden">
      {/* 1. HERO SECTION */}
      <section className="relative pt-10 sm:pt-16 md:pt-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full text-center animate-fade-up">
        {/* Nền ánh vàng ngọc trai chuyển động chậm */}
        <div
          aria-hidden="true"
          className="hero-mesh-aura absolute top-1/2 left-1/2 w-[26rem] sm:w-[44rem] h-[22rem] sm:h-[30rem] rounded-full pointer-events-none -z-10"
        />

        {/* Hero Badge gọn gàng - CHỈ hiển thị hero_badge */}
        <div className="inline-flex flex-wrap items-center justify-center gap-2 px-4 py-1.5 rounded-full bg-[#FBF7EC]/90 backdrop-blur-sm border border-[#EAE2CE] text-[#8A6D23] text-xs font-bold mb-5 shadow-2xs">
          <Sparkles className="w-3.5 h-3.5 text-[#B5943B]" />
          <span>{siteContent.hero_badge}</span>
        </div>

        <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#2D2D2D] max-w-4xl mx-auto leading-snug sm:leading-tight">
          {heroTitle}{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#C5A044] via-[#B5943B] to-[#9A7B2C] block sm:inline">
            {heroHighlight}
          </span>
        </h1>

        <p className="mt-4 sm:mt-5 text-sm sm:text-base md:text-lg text-[#5C5649] max-w-2xl mx-auto leading-relaxed px-2">
          {heroSubtitle}
        </p>

        {/* Nút tải thông minh Smart OS Detection */}
        <div className="mt-6 sm:mt-8 flex justify-center w-full px-2">
          <SmartDownloadButton
            version={activeCatalog.launcher.version}
            windowsUrl={activeCatalog.launcher.downloads.windows}
            portableUrl={activeCatalog.launcher.downloads.windows_portable}
            docsUrl={docsBaseUrl}
            primaryLabel={siteContent.btn_download_primary}
            portableLabel={siteContent.btn_download_portable}
            versionNote={siteContent.hero_version_note}
          />
        </div>

        {/* 2. KHỐI CÀI NHANH BẰNG 1 DÒNG LỆNH POWERSHELL */}
        <div className="mt-10 sm:mt-12 max-w-2xl mx-auto w-full px-1 animate-fade-up delay-100">
          <div className="card-spotlight rounded-2xl p-4 sm:p-5 text-left">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-3 border-b border-[#EAE2CE] gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#2D2D2D]">
                <Terminal className="w-4 h-4 text-[#B5943B] shrink-0" />
                <span>{siteContent.ps_title}</span>
              </div>
              <CopyButton text={installCommand} label="Sao chép lệnh" className="self-start sm:self-auto" />
            </div>

            <div className="p-3.5 rounded-xl bg-[#2B2B2B] font-mono text-xs text-[#FBF7EC] overflow-x-auto border border-[#3D3D3D] max-w-full">
              <code className="break-all sm:break-normal">{installCommand}</code>
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-[#5C5649]">
              <span>{siteContent.ps_note}</span>
              <Link
                href="/admin/"
                className="inline-flex items-center gap-1 font-bold text-[#8A6D23] hover:text-[#B5943B] shrink-0 active:scale-[0.98] transition-transform"
              >
                <Shield className="w-3.5 h-3.5 text-[#B5943B]" />
                <span>{siteContent.ps_admin_link}</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 3. KHỐI PROFILES (HỒ SƠ MÁY TRẠM) */}
      <section className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full animate-fade-up delay-200">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-6 sm:mb-8 gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#8A6D23] uppercase tracking-wider mb-1">
              <Layers className="w-3.5 h-3.5 text-[#B5943B]" />
              <span>{siteContent.profiles_eyebrow}</span>
            </div>
            <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-[#2D2D2D]">
              {siteContent.profiles_title}
            </h2>
            <p className="text-xs sm:text-sm text-[#5C5649] mt-1">
              {siteContent.profiles_subtitle}
            </p>
          </div>

          {selectedProfileId && (
            <button
              onClick={() => setSelectedProfileId(null)}
              className="px-3.5 py-1.5 rounded-xl bg-[#FBF7EC] border border-[#C5A044] text-xs font-bold text-[#8A6D23] hover:bg-[#F3E9CE] active:scale-[0.98] self-start sm:self-auto cursor-pointer transition-all"
            >
              Hiển thị lại toàn bộ ứng dụng ×
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {activeCatalog.profiles.map((profile: Profile, idx: number) => {
            const isSelected = selectedProfileId === profile.id;

            return (
              <div
                key={profile.id}
                onClick={() => handleProfileClick(profile.id)}
                style={{ animationDelay: `${idx * 60}ms` }}
                className={`card-spotlight p-4 sm:p-5 rounded-2xl cursor-pointer relative flex flex-col justify-between animate-fade-up active:scale-[0.99] ${
                  isSelected
                    ? "!border-[#B5943B] !bg-[#FBF7EC] ring-2 ring-[#B5943B]/25"
                    : ""
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-extrabold text-base text-[#2D2D2D]">
                      {profile.name}
                    </h3>
                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-[#B5943B] shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-[#5C5649] leading-relaxed mb-4">
                    {profile.description}
                  </p>
                </div>

                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#8A6D23] block mb-1.5">
                    Gồm {profile.apps.length} ứng dụng:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.apps.map((appId) => {
                      const appMeta = activeCatalog.apps.find((a) => a.id === appId);
                      return (
                        <span
                          key={appId}
                          className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE]"
                        >
                          {appMeta?.name || appId}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4. SOFTWARE CATALOG */}
      <section id="catalog" className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full animate-fade-up delay-300">
        <div className="border-t border-[#EAE2CE] pt-8 sm:pt-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 sm:mb-8">
            <div>
              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#8A6D23] uppercase tracking-wider mb-1">
                <AppWindow className="w-3.5 h-3.5 text-[#B5943B]" />
                <span>{siteContent.catalog_eyebrow}</span>
              </div>
              <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-[#2D2D2D]">
                {siteContent.catalog_title} ({filteredApps.length}/{visibleApps.length})
              </h2>
            </div>

            {/* Ô tìm kiếm */}
            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8A6D23]" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={siteContent.catalog_search_placeholder}
                className="w-full pl-10 pr-12 py-2.5 text-xs sm:text-sm rounded-xl border border-[#EAE2CE] bg-white text-[#2D2D2D] placeholder:text-[#5C5649]/60 focus:outline-none focus:border-[#B5943B] focus:ring-2 focus:ring-[#B5943B]/20 shadow-2xs transition-all"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#8A6D23] hover:text-[#B5943B] cursor-pointer"
                >
                  Xóa
                </button>
              )}
            </div>
          </div>

          {/* Thanh lọc danh mục Category */}
          <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6">
            <span className="text-xs font-bold text-[#8A6D23] flex items-center gap-1 shrink-0 mr-1">
              <Filter className="w-3.5 h-3.5 text-[#B5943B]" /> Danh mục:
            </span>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap active:scale-[0.98] transition-all cursor-pointer shrink-0 ${
                  selectedCategory === cat
                    ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-sm"
                    : "bg-white text-[#5C5649] border border-[#EAE2CE] hover:bg-[#FBF7EC] hover:text-[#8A6D23] hover:border-[#C5A044]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Grid thẻ card ứng dụng */}
          {filteredApps.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl border border-[#EAE2CE] shadow-xs">
              <p className="text-[#5C5649] text-sm font-medium">
                Không tìm thấy phần mềm phù hợp với từ khóa & bộ lọc đã chọn.
              </p>
              <button
                onClick={() => {
                  setSearchTerm("");
                  setSelectedCategory("Tất cả");
                  setSelectedProfileId(null);
                }}
                className="btn-shimmer mt-4 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs font-bold cursor-pointer shadow-sm active:scale-[0.98]"
              >
                Đặt lại bộ lọc
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredApps.map((app: AppItem, idx: number) => {
                const gradient =
                  GRADIENT_COLORS[app.id] || "from-[#C5A044] to-[#9A7B2C]";
                const isWinget = app.source === "winget";
                const slug = app.docs_slug || app.id;
                const hasKnownDocs = KNOWN_DOCS_SLUGS.has(slug);
                const docPath = `/AllSoftDesktop/docs/apps/${slug}`;
                const docAbsoluteUrl = `${docsBaseUrl}/apps/${slug}/`;
                const directDownloadUrl = app.direct?.url?.trim() || "";
                const homeUrl = app.changelog_url?.trim() || "";
                const downloadHref =
                  directDownloadUrl || homeUrl || activeCatalog.launcher.downloads.windows;
                const isDirectFile = Boolean(directDownloadUrl);

                const qrUrl = hasKnownDocs
                  ? docAbsoluteUrl
                  : directDownloadUrl || homeUrl || activeCatalog.site_url;

                return (
                  <div
                    key={app.id}
                    style={{ animationDelay: `${Math.min(idx * 45, 360)}ms` }}
                    className="card-spotlight p-5 rounded-2xl flex flex-col justify-between animate-fade-up"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-11 h-11 rounded-xl bg-gradient-to-tr ${gradient} flex items-center justify-center text-white font-extrabold text-base sm:text-lg shadow-sm shrink-0`}
                          >
                            {app.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-extrabold text-sm sm:text-base text-[#2D2D2D] leading-snug">
                              {app.name}
                            </h3>
                            <span className="inline-block mt-0.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE]">
                              {app.category}
                            </span>
                          </div>
                        </div>

                        <QRCodeModal appName={app.name} docsUrl={qrUrl} />
                      </div>

                      <p className="text-xs text-[#5C5649] leading-relaxed mb-4">
                        {app.description}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-[#EAE2CE] flex items-center justify-between gap-2">
                      {isWinget ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE] truncate max-w-[60%]">
                          <Sparkles className="w-3 h-3 text-[#B5943B] shrink-0" />
                          <span className="truncate">winget · {app.winget?.id || "latest"}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold bg-[#2B2B2B] text-[#FBF7EC]">
                          <span>Direct · v{app.version}</span>
                        </span>
                      )}

                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasKnownDocs && (
                          <a
                            href={docPath}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-[#8A6D23] bg-[#FBF7EC] hover:bg-[#F3E9CE] border border-[#EAE2CE] active:scale-[0.98] transition-all"
                            title="Đọc tài liệu hướng dẫn sử dụng"
                          >
                            <BookOpen className="w-3.5 h-3.5 text-[#B5943B]" />
                            <span>Tài liệu</span>
                          </a>
                        )}

                        <a
                          href={downloadHref}
                          target="_blank"
                          rel="noreferrer"
                          {...(isDirectFile ? { download: true } : {})}
                          className="btn-shimmer inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] hover:brightness-105 shadow-xs active:scale-[0.98] transition-all"
                          title={
                            isDirectFile
                              ? `Tải trực tiếp bộ cài ${app.name}`
                              : `Mở trang tải chính thức của ${app.name}`
                          }
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải về</span>
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
