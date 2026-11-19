"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Boxes,
  Lock,
  Menu,
  Shield,
  X,
} from "lucide-react";
import { catalog as staticCatalog, defaultBranding, Branding } from "@/lib/catalog";

const DEFAULT_LOGO = "/AllSoftDesktop/logo.png";
const DEFAULT_ICON = "/AllSoftDesktop/icon.png";

interface HeaderSiteContent {
  nav_apps: string;
  nav_docs: string;
  nav_changelog: string;
  nav_admin: string;
}

const DEFAULT_HEADER_CONTENT: HeaderSiteContent = {
  nav_apps: "Phần mềm",
  nav_docs: "Tài liệu",
  nav_changelog: "Nhật ký",
  nav_admin: "Quản trị",
};

type DynamicBranding = Branding & { icon_url?: string };

function readStaticSiteContent(): Partial<HeaderSiteContent> {
  const raw = (staticCatalog as unknown as { site_content?: Partial<HeaderSiteContent> })?.site_content;
  return raw && typeof raw === "object" ? raw : {};
}

function mergeHeaderContent(source?: Partial<HeaderSiteContent> | null): HeaderSiteContent {
  const staticPart = readStaticSiteContent();
  return {
    nav_apps: source?.nav_apps?.trim() || staticPart.nav_apps?.trim() || DEFAULT_HEADER_CONTENT.nav_apps,
    nav_docs: source?.nav_docs?.trim() || staticPart.nav_docs?.trim() || DEFAULT_HEADER_CONTENT.nav_docs,
    nav_changelog:
      source?.nav_changelog?.trim() ||
      staticPart.nav_changelog?.trim() ||
      DEFAULT_HEADER_CONTENT.nav_changelog,
    nav_admin: source?.nav_admin?.trim() || staticPart.nav_admin?.trim() || DEFAULT_HEADER_CONTENT.nav_admin,
  };
}

function applyDocumentFavicon(iconHref: string) {
  if (!iconHref || typeof document === "undefined") return;
  const rels = ["icon", "shortcut icon", "apple-touch-icon"];
  let updatedAny = false;
  for (const rel of rels) {
    const existing = document.querySelectorAll(`link[rel='${rel}']`);
    if (existing.length > 0) {
      existing.forEach((node) => {
        const linkEl = node as HTMLLinkElement;
        if (linkEl.getAttribute("href") !== iconHref) {
          linkEl.setAttribute("href", iconHref);
        }
      });
      updatedAny = true;
    }
  }
  if (!updatedAny) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = iconHref;
    document.head.appendChild(link);
  }
}

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [brand, setBrand] = useState<DynamicBranding>(() => ({
    ...defaultBranding,
    ...(staticCatalog.branding ?? {}),
  }));
  const [content, setContent] = useState<HeaderSiteContent>(() => mergeHeaderContent(null));
  const pathname = usePathname();

  useEffect(() => {
    const syncHeaderState = async () => {
      let loadedFromLocal = false;
      try {
        let nextBrand: DynamicBranding = {
          ...defaultBranding,
          ...(staticCatalog.branding ?? {}),
        };
        let nextContent = mergeHeaderContent(null);

        const savedCatalogRaw = localStorage.getItem("allsoft_custom_catalog");
        if (savedCatalogRaw) {
          const parsed = JSON.parse(savedCatalogRaw);
          if (parsed?.branding) {
            nextBrand = { ...nextBrand, ...parsed.branding };
          }
          if (parsed?.site_content) {
            nextContent = mergeHeaderContent(parsed.site_content);
          }
          loadedFromLocal = true;
        }

        const savedLogo = localStorage.getItem("allsoft_custom_logo");
        if (savedLogo) {
          nextBrand.logo_url = savedLogo;
        }

        const savedIcon = localStorage.getItem("allsoft_custom_icon");
        if (savedIcon) {
          nextBrand.icon_url = savedIcon;
        }

        setBrand(nextBrand);
        setContent(nextContent);
        applyDocumentFavicon(nextBrand.icon_url || DEFAULT_ICON);
      } catch {
        // Ignore parse errors
      }

      if (!loadedFromLocal) {
        try {
          const res = await fetch("/AllSoftDesktop/api/catalog", { cache: "no-store" });
          if (res.ok) {
            const apiData = await res.json();
            let nextBrand: DynamicBranding = {
              ...defaultBranding,
              ...(staticCatalog.branding ?? {}),
              ...(apiData?.branding ?? {}),
            };
            const savedLogo = localStorage.getItem("allsoft_custom_logo");
            if (savedLogo) nextBrand.logo_url = savedLogo;
            const savedIcon = localStorage.getItem("allsoft_custom_icon");
            if (savedIcon) nextBrand.icon_url = savedIcon;

            setBrand(nextBrand);
            setContent(mergeHeaderContent(apiData?.site_content));
            applyDocumentFavicon(nextBrand.icon_url || DEFAULT_ICON);
          }
        } catch {
          // Fallback static
        }
      }
    };

    const handleSyncEvent = () => {
      void syncHeaderState();
    };

    void syncHeaderState();
    window.addEventListener("storage", handleSyncEvent);
    window.addEventListener("allsoft-catalog-updated", handleSyncEvent);
    return () => {
      window.removeEventListener("storage", handleSyncEvent);
      window.removeEventListener("allsoft-catalog-updated", handleSyncEvent);
    };
  }, []);

  const navItems = [
    { label: content.nav_apps, href: "/", icon: Boxes },
    { label: content.nav_docs, href: "/AllSoftDesktop/docs/", icon: BookOpen, external: true },
    { label: content.nav_changelog, href: "/changelog/", icon: Lock },
    { label: content.nav_admin, href: "/admin/", icon: Shield, highlight: true },
  ];

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname === "";
    return pathname.startsWith(href.replace(/\/$/, ""));
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-[#FDFBF7]/85 backdrop-blur-xl border-b border-[#EAE2CE]/80 shadow-xs transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-[82px] py-2 flex items-center justify-between gap-4">
        {/* Logo ngang trực tiếp (W: 200px, H theo tỉ lệ) + gạch dọc mảnh + Tên sản phẩm */}
        <Link href="/" className="flex items-center gap-3.5 sm:gap-4 group shrink-0">
          <img
            src={brand.logo_url || DEFAULT_LOGO}
            alt={brand.app_name || "AllSoft Desktop"}
            className="w-[200px] min-w-[200px] h-auto object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = DEFAULT_LOGO;
            }}
          />
          <span className="h-8 w-px bg-[#E5DEC9] shrink-0" aria-hidden="true" />
          <span className="font-extrabold text-sm sm:text-base tracking-tight text-[#2D2D2D] whitespace-nowrap">
            {brand.app_name}
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = !item.external && isActive(item.href);

            if (item.external) {
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium text-[#5C5649] hover:text-[#2D2D2D] hover:bg-[#FBF7EC] border border-transparent hover:border-[#EAE2CE] active:scale-[0.98] transition-all"
                >
                  <Icon className="w-4 h-4 text-[#B5943B]" />
                  <span>{item.label}</span>
                </a>
              );
            }

            if (item.highlight) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`btn-shimmer flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold active:scale-[0.98] transition-all shadow-xs ${
                    active
                      ? "bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white shadow-md shadow-[#B5943B]/20"
                      : "bg-[#FBF7EC] text-[#8A6D23] border border-[#C5A044]/50 hover:bg-gradient-to-r hover:from-[#C5A044] hover:to-[#9A7B2C] hover:text-white hover:border-transparent"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? "text-white" : "text-[#B5943B]"}`} />
                  <span>{item.label}</span>
                </Link>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium active:scale-[0.98] transition-all ${
                  active
                    ? "text-[#8A6D23] bg-[#FBF7EC] border border-[#EAE2CE] font-bold shadow-2xs"
                    : "text-[#5C5649] hover:text-[#2D2D2D] hover:bg-[#FBF7EC]/70 border border-transparent"
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? "text-[#B5943B]" : "text-[#8A6D23]/70"}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile menu trigger */}
        <div className="flex md:hidden items-center gap-2">
          <Link
            href="/admin/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-[#FBF7EC] text-[#8A6D23] border border-[#C5A044]/40 active:scale-[0.98]"
          >
            <Shield className="w-3.5 h-3.5 text-[#B5943B]" />
            <span>{content.nav_admin}</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-xl text-[#2D2D2D] hover:bg-[#FBF7EC] border border-[#EAE2CE] active:scale-[0.98]"
            aria-label="Mở menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Nav Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-[#EAE2CE] bg-[#FFFFFF]/95 backdrop-blur-xl px-4 pt-2 pb-4 space-y-1.5 shadow-lg">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = !item.external && isActive(item.href);

            if (item.external) {
              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-[#5C5649] hover:bg-[#FBF7EC]"
                >
                  <Icon className="w-4 h-4 text-[#B5943B]" />
                  <span>{item.label}</span>
                </a>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium ${
                  active
                    ? "bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE] font-bold"
                    : "text-[#5C5649] hover:bg-[#FBF7EC]"
                }`}
              >
                <Icon className="w-4 h-4 text-[#B5943B]" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
