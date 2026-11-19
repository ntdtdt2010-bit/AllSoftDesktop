"use client";

import { useEffect, useState } from "react";
import { ExternalLink, QrCode, X } from "lucide-react";
import QRCode from "qrcode";

interface QRCodeModalProps {
  appName: string;
  docsUrl: string;
}

export function QRCodeModal({ appName, docsUrl }: QRCodeModalProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string>("");
  const [largeUrl, setLargeUrl] = useState<string>("");

  useEffect(() => {
    QRCode.toDataURL(docsUrl, {
      width: 64,
      margin: 0,
      color: {
        dark: "#2D2D2D",
        light: "#FFFFFF",
      },
    })
      .then((url) => setThumbnailUrl(url))
      .catch((err) => console.error("Lỗi tạo QR thumbnail:", err));
  }, [docsUrl]);

  const handleOpen = () => {
    setIsOpen(true);
    if (!largeUrl) {
      QRCode.toDataURL(docsUrl, {
        width: 256,
        margin: 1,
        color: {
          dark: "#2D2D2D",
          light: "#FFFFFF",
        },
      })
        .then((url) => setLargeUrl(url))
        .catch((err) => console.error("Lỗi tạo QR modal:", err));
    }
  };

  return (
    <>
      {/* Thumbnail trên card */}
      <button
        type="button"
        onClick={handleOpen}
        title="Bấm để phóng to mã QR tài liệu di động"
        className="group relative p-1.5 rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] hover:border-[#C5A044] hover:bg-[#FBF7EC] transition-all cursor-pointer flex flex-col items-center justify-center shrink-0"
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`Mã QR ${appName}`}
            className="w-10 h-10 rounded transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="w-10 h-10 flex items-center justify-center bg-[#FBF7EC] rounded">
            <QrCode className="w-5 h-5 text-[#B5943B]" />
          </div>
        )}
        <span className="text-[9px] text-[#8A6D23] font-semibold mt-0.5 group-hover:text-[#B5943B]">
          Mã QR
        </span>
      </button>

      {/* Modal phóng to */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop-luxury animate-fade-up"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl bg-white border border-[#EAE2CE] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-[#5C5649] hover:text-[#2D2D2D] hover:bg-[#FBF7EC] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="text-center">
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-[#FBF7EC] text-[#8A6D23] mb-2 border border-[#EAE2CE]">
                <QrCode className="w-3.5 h-3.5 text-[#B5943B]" />
                Quét mã xem trên điện thoại
              </span>
              <h3 className="text-lg font-extrabold text-[#2D2D2D]">
                {appName}
              </h3>
              <p className="text-xs text-[#5C5649] mt-1">
                Hướng dẫn sử dụng cơ bản & khắc phục sự cố máy trạm
              </p>

              <div className="my-5 flex justify-center">
                <div className="p-3 rounded-2xl bg-white border-2 border-[#EAE2CE] shadow-md">
                  {largeUrl ? (
                    <img
                      src={largeUrl}
                      alt={`Mã QR tài liệu ${appName}`}
                      className="w-48 h-48 rounded-lg"
                    />
                  ) : (
                    <div className="w-48 h-48 flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-[#B5943B] border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-shimmer inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] text-white text-xs font-bold shadow-sm transition-all"
                >
                  <span>Mở tài liệu trực tiếp trên web</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-[#5C5649] hover:text-[#2D2D2D] transition-colors cursor-pointer"
                >
                  Đóng lại
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
