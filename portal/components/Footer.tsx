"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Github, Shield, ShieldCheck } from "lucide-react";
import { catalog as staticCatalog, defaultBranding, Branding } from "@/lib/catalog";

const DEFAULT_LOGO = "/AllSoftDesktop/logo.png";

interface FooterSiteContent {
  nav_apps: string;
  nav_docs: string;
  nav_changelog: string;
  nav_admin: string;
  footer_desc: string;
  footer_nav_title: string;
  footer_infra_title: string;
  footer_copyright: string;
}

const DEFAULT_FOOTER_CONTENT: FooterSiteContent = {
  nav_apps: "Phần mềm",
  nav_docs: "Tài liệu",
  nav_changelog: "Nhật ký",
  nav_admin: "Quản trị",
  footer_desc:
    "Giải pháp chuẩn hóa máy trạm, tự động hóa cài đặt, bảo trì hệ thống và quản trị phần mềm tập trung dành cho bệnh viện, cơ quan hành chính và doanh nghiệp.",
  footer_nav_title: "Điều hướng Hệ thống",
  footer_infra_title: "Hạ tầng & Phát hành",
  footer_copyright: "© 2026 AllSoft Desktop · Created By Mr. Dương",
};

function readStaticFooterContent(): Partial<FooterSiteContent> {
  const raw = (staticCatalog as unknown as { site_content?: Partial<FooterSiteContent> })?.site_content;
  return raw && typeof raw === "object" ? raw : {};
}

function mergeFooterContent(source?: Partial<FooterSiteContent> | null): FooterSiteContent {
  const staticPart = readStaticFooterContent();
  return {
    nav_apps: source?.nav_apps?.trim() || staticPart.nav_apps?.trim() || DEFAULT_FOOTER_CONTENT.nav_apps,
    nav_docs: source?.nav_docs?.trim() || staticPart.nav_docs?.trim() || DEFAULT_FOOTER_CONTENT.nav_docs,
    nav_changelog:
      source?.nav_changelog?.trim() ||
      staticPart.nav_changelog?.trim() ||
      DEFAULT_FOOTER_CONTENT.nav_changelog,
    nav_admin: source?.nav_admin?.trim() || staticPart.nav_admin?.trim() || DEFAULT_FOOTER_CONTENT.nav_admin,
    footer_desc:
      source?.footer_desc?.trim() || staticPart.footer_desc?.trim() || DEFAULT_FOOTER_CONTENT.footer_desc,
    footer_nav_title:
      source?.footer_nav_title?.trim() ||
      staticPart.footer_nav_title?.trim() ||
      DEFAULT_FOOTER_CONTENT.footer_nav_title,
    footer_infra_title:
      source?.footer_infra_title?.trim() ||
      staticPart.footer_infra_title?.trim() ||
      DEFAULT_FOOTER_CONTENT.footer_infra_title,
    footer_copyright:
      source?.footer_copyright?.trim() ||
      staticPart.footer_copyright?.trim() ||
      DEFAULT_FOOTER_CONTENT.footer_copyright,
  };
}

export function Footer() {
  const [brand, setBrand] = useState<Branding>(() => ({
    ...defaultBranding,
    ...(staticCatalog.branding ?? {}),
  }));
  const [content, setContent] = useState<FooterSiteContent>(() => mergeFooterContent(null));

  useEffect(() => {
    const syncFooterState = async () => {
      let loadedFromLocal = false;
      try {
        let nextBrand: Branding = {
          ...defaultBranding,
          ...(staticCatalog.branding ?? {}),
        };
        let nextContent = mergeFooterContent(null);

        const savedCatalogRaw = localStorage.getItem("allsoft_custom_catalog");
        if (savedCatalogRaw) {
          const parsed = JSON.parse(savedCatalogRaw);
          if (parsed?.branding) {
            nextBrand = { ...nextBrand, ...parsed.branding };
          }
          if (parsed?.site_content) {
            nextContent = mergeFooterContent(parsed.site_content);
          }
          loadedFromLocal = true;
        }
        const savedLogo = localStorage.getItem("allsoft_custom_logo");
        if (savedLogo) {
          nextBrand.logo_url = savedLogo;
        }
        setBrand(nextBrand);
        setContent(nextContent);
      } catch {
        // Ignore
      }

      if (!loadedFromLocal) {
        try {
          const res = await fetch("/AllSoftDesktop/api/catalog", { cache: "no-store" });
          if (res.ok) {
            const apiData = await res.json();
            const nextBrand: Branding = {
              ...defaultBranding,
              ...(staticCatalog.branding ?? {}),
              ...(apiData?.branding ?? {}),
            };
            const savedLogo = localStorage.getItem("allsoft_custom_logo");
            if (savedLogo) nextBrand.logo_url = savedLogo;

            setBrand(nextBrand);
            setContent(mergeFooterContent(apiData?.site_content));
          }
        } catch {
          // Fallback static
        }
      }
    };

    const handleSyncEvent = () => {
      void syncFooterState();
    };

    void syncFooterState();
    window.addEventListener("storage", handleSyncEvent);
    window.addEventListener("allsoft-catalog-updated", handleSyncEvent);
    return () => {
      window.removeEventListener("storage", handleSyncEvent);
      window.removeEventListener("allsoft-catalog-updated", handleSyncEvent);
    };
  }, []);

  return (
    <footer className="mt-auto border-t border-[#EAE2CE] bg-[#FFFFFF] text-[#5C5649] text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Cột 1: Logo ngang rõ nét & Thông tin hệ thống */}
          <div className="md:col-span-2 space-y-4">
            <div className="flex items-center gap-4">
              <img
                src={brand.logo_url || DEFAULT_LOGO}
                alt={brand.app_name || "AllSoft Desktop"}
                className="w-[200px] sm:w-[220px] min-w-[200px] h-auto object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = DEFAULT_LOGO;
                }}
              />
              <span className="h-8 w-px bg-[#E5DEC9] shrink-0" aria-hidden="true" />
              <span className="font-extrabold text-[#2D2D2D] text-base tracking-tight">
                {brand.app_name}
              </span>
            </div>

            <p className="text-xs text-[#5C5649] max-w-md leading-relaxed">
              {content.footer_desc}
            </p>
          </div>

          {/* Cột 2: Điều hướng */}
          <div>
            <h4 className="font-bold text-[#2D2D2D] text-xs uppercase tracking-wider mb-3.5">
              {content.footer_nav_title}
            </h4>
            <ul className="space-y-2.5">
              <li>
                <Link href="/" className="hover:text-[#B5943B] font-medium transition-colors">
                  {content.nav_apps}
                </Link>
              </li>
              <li>
                <a href="/AllSoftDesktop/docs/" className="hover:text-[#B5943B] font-medium transition-colors">
                  {content.nav_docs}
                </a>
              </li>
              <li>
                <Link href="/changelog/" className="hover:text-[#B5943B] font-medium transition-colors">
                  {content.nav_changelog}
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/"
                  className="inline-flex items-center gap-1 text-[#8A6D23] font-bold hover:text-[#B5943B] transition-colors"
                >
                  <Shield className="w-3.5 h-3.5 text-[#B5943B]" />
                  <span>{content.nav_admin}</span>
                </Link>
              </li>
            </ul>
          </div>

          {/* Cột 3: Mã nguồn & Phát hành */}
          <div>
            <h4 className="font-bold text-[#2D2D2D] text-xs uppercase tracking-wider mb-3.5">
              {content.footer_infra_title}
            </h4>
            <ul className="space-y-2.5">
              <li>
                <a
                  href="https://github.com/ntdtdt2010-bit/AllSoftDesktop"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 hover:text-[#B5943B] font-medium transition-colors"
                >
                  <Github className="w-3.5 h-3.5 text-[#2D2D2D]" />
                  <span>GitHub Repository</span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/ntdtdt2010-bit/AllSoftDesktop/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-[#B5943B] font-medium transition-colors"
                >
                  Bản phát hành AllSoft Desktop mới nhất
                </a>
              </li>
              <li>
                <a
                  href="/AllSoftDesktop/docs/offline-usb"
                  className="hover:text-[#B5943B] font-medium transition-colors"
                >
                  Hướng dẫn đóng gói USB Offline
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Duy nhất 1 dòng bản quyền trang trọng ở đáy chân trang */}
        <div className="pt-6 border-t border-[#EAE2CE] flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs font-semibold text-[#2D2D2D]">
            {content.footer_copyright}
          </p>
          <div className="flex items-center gap-1.5 text-[#8A6D23] font-medium text-xs">
            <ShieldCheck className="w-4 h-4 text-[#B5943B]" />
            <span>Chuẩn hóa hạ tầng CNTT Chuyên nghiệp</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
