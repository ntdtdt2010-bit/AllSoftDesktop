"use client";

import { useEffect, useState } from "react";
import { Download, Laptop, QrCode, Sparkles } from "lucide-react";
import QRCode from "qrcode";

interface SmartDownloadButtonProps {
  version: string;
  windowsUrl: string;
  portableUrl: string;
  docsUrl: string;
  primaryLabel?: string;
  portableLabel?: string;
  versionNote?: string;
}

export function SmartDownloadButton({
  version,
  windowsUrl,
  portableUrl,
  docsUrl,
  primaryLabel,
  portableLabel,
  versionNote,
}: SmartDownloadButtonProps) {
  const [os, setOs] = useState<"windows" | "non-windows" | "loading">("loading");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  const resolvedPrimaryLabel =
    primaryLabel?.trim() || "Tải Phần mềm AllSoft Desktop cho Windows";
  const resolvedPortableLabel = portableLabel?.trim() || "Bản Portable (.exe)";
  const resolvedVersionNote =
    versionNote?.trim() || `Phiên bản ${version} · Dành cho Windows 10 & 11 (64-bit)`;
  const noteParts = resolvedVersionNote.split(/\s*[·•]\s*/);
  const noteLead = noteParts[0] || resolvedVersionNote;
  const noteTail = noteParts.length > 1 ? noteParts.slice(1).join(" · ") : "";

  useEffect(() => {
    let isWin = false;
    const nav = navigator as any;

    if (nav.userAgentData?.platform) {
      isWin = /windows/i.test(nav.userAgentData.platform);
    } else if (navigator.userAgent) {
      const ua = navigator.userAgent;
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
      const isWindows = /Windows|Win32|Win64|WOW64/i.test(ua);
      isWin = isWindows && !isMobile;
    }

    setOs(isWin ? "windows" : "non-windows");

    if (!isWin) {
      QRCode.toDataURL(docsUrl, {
        width: 160,
        margin: 1,
        color: {
          dark: "#2D2D2D",
          light: "#FFFFFF",
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error("Lỗi tạo QR:", err));
    }
  }, [docsUrl]);

  if (os === "loading") {
    return (
      <div className="flex flex-col items-center justify-center py-4">
        <div className="h-12 w-64 bg-[#FBF7EC] border border-[#EAE2CE] animate-pulse rounded-xl" />
      </div>
    );
  }

  if (os === "windows") {
    return (
      <div className="flex flex-col items-center gap-3 w-full max-w-lg">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
          <a
            href={windowsUrl}
            className="btn-shimmer w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] hover:from-[#B5943B] hover:to-[#8A6D23] text-white font-bold text-sm sm:text-base shadow-lg shadow-[#B5943B]/25 hover:shadow-[#B5943B]/40 transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-center"
          >
            <Download className="w-5 h-5 shrink-0" />
            <span>{resolvedPrimaryLabel}</span>
          </a>

          <a
            href={portableUrl}
            className="btn-shimmer w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl border border-[#2B2B2B] bg-[#2B2B2B] hover:bg-[#3D3D3D] text-white font-semibold text-xs sm:text-sm shadow-sm transition-all transform hover:-translate-y-0.5 text-center"
            title="Dành cho kỹ thuật viên IT chạy trực tiếp từ USB không cần cài đặt"
          >
            <Laptop className="w-4 h-4 text-[#C5A044] shrink-0" />
            <span>{resolvedPortableLabel}</span>
          </a>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-[#5C5649]">
          <span className="inline-flex items-center gap-1 font-bold text-[#8A6D23]">
            <Sparkles className="w-3.5 h-3.5 text-[#B5943B]" />
            {noteLead}
          </span>
          {noteTail && (
            <>
              <span className="text-[#C5A044]">•</span>
              <span>{noteTail}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  // Non-Windows (Mac, Linux, Mobile, v.v.)
  return (
    <div className="w-full max-w-lg p-5 rounded-2xl border border-[#EAE2CE] bg-[#FBF7EC] text-center mx-auto shadow-sm">
      <div className="flex items-center justify-center gap-2 mb-2 text-[#8A6D23] font-bold text-sm">
        <Laptop className="w-4 h-4 text-[#B5943B]" />
        <span>Phần mềm AllSoft Desktop hiện chỉ hỗ trợ hệ điều hành Windows</span>
      </div>
      <p className="text-xs text-[#5C5649] mb-4 leading-relaxed">
        Thiết bị hiện tại của bạn không tương thích với bộ cài Phần mềm AllSoft Desktop (.exe).
        Bạn có thể quét mã QR dưới đây bằng điện thoại để xem nhanh tài liệu và hướng dẫn sử dụng phần mềm.
      </p>

      {qrDataUrl && (
        <div className="inline-flex flex-col items-center p-3 rounded-xl bg-white border border-[#EAE2CE] shadow-xs">
          <img src={qrDataUrl} alt="Mã QR mở Tài liệu trên điện thoại" className="w-28 h-28 rounded-lg" />
          <span className="mt-2 text-[11px] font-semibold text-[#8A6D23] flex items-center gap-1">
            <QrCode className="w-3 h-3 text-[#B5943B]" /> Quét đọc tài liệu
          </span>
        </div>
      )}

      <div className="mt-3">
        <a
          href={docsUrl}
          className="text-xs font-bold text-[#8A6D23] hover:text-[#B5943B] hover:underline"
        >
          Hoặc bấm vào đây để mở trang Tài liệu →
        </a>
      </div>
    </div>
  );
}
