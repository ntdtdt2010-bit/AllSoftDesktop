"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  AlertCircle,
  Award,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Lock,
  RotateCcw,
  ShieldAlert,
  Unlock,
  User,
} from "lucide-react";
import * as CryptoLib from "@/lib/crypto";

export default function ChangelogPage() {
  const [username, setUsername] = useState<string>("admin");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [markdownContent, setMarkdownContent] = useState<string | null>(null);
  const [payload, setPayload] = useState<CryptoLib.EncryptedPayload | null>(null);

  const basePath = "/AllSoftDesktop";

  useEffect(() => {
    async function fetchEncryptedLog() {
      try {
        const res = await fetch(`${basePath}/changelog.enc.json`);
        if (!res.ok) {
          setPayload({
            version: 1,
            info: "Tệp mã hóa nội bộ",
          });
          return;
        }
        const data = await res.json();
        setPayload(data);
      } catch {
        setPayload({
          version: 1,
          info: "Offline fallback",
        });
      }
    }

    fetchEncryptedLog();
  }, []);

  // Kiểm tra phiên đã mở khóa trong sessionStorage
  useEffect(() => {
    if (!payload) return;

    const savedPass = sessionStorage.getItem("allsoft_changelog_auth");
    const savedUser = sessionStorage.getItem("allsoft_changelog_user") || "admin";
    if (savedPass) {
      setUsername(savedUser);
      handleDecrypt(savedUser, savedPass);
    }
  }, [payload]);

  const handleDecrypt = async (userToTry: string, passToTry: string) => {
    if (userToTry.trim().toLowerCase() !== "admin") {
      setErrorMsg("Tài khoản không hợp lệ. Vui lòng sử dụng tài khoản quản trị 'admin'.");
      return;
    }

    if (!passToTry.trim()) {
      setErrorMsg("Vui lòng nhập mật khẩu xác thực.");
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const cryptoAny = CryptoLib as any;
      let decrypted: string;

      if (typeof cryptoAny.decryptChangelog === "function") {
        decrypted = await cryptoAny.decryptChangelog(passToTry);
      } else {
        const targetPayload = payload || { demo: true };
        decrypted = await CryptoLib.decryptPayload(targetPayload, passToTry);
      }

      setMarkdownContent(decrypted);
      sessionStorage.setItem("allsoft_changelog_auth", passToTry);
      sessionStorage.setItem("allsoft_changelog_user", userToTry.trim());
    } catch (err: any) {
      if (err?.message === "WRONG_PASSWORD") {
        setErrorMsg("Mật khẩu không chính xác. Vui lòng kiểm tra lại mã truy cập nội bộ.");
      } else {
        setErrorMsg("Không thể giải mã dữ liệu: " + (err?.message || "Mật khẩu không đúng"));
      }
      sessionStorage.removeItem("allsoft_changelog_auth");
      setMarkdownContent(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLock = () => {
    sessionStorage.removeItem("allsoft_changelog_auth");
    sessionStorage.removeItem("allsoft_changelog_user");
    setMarkdownContent(null);
    setPassword("");
    setErrorMsg(null);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full animate-fade-up">
      {/* Tiêu đề trang */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold bg-[#FBF7EC] text-[#8A6D23] border border-[#EAE2CE] mb-3">
          <History className="w-3.5 h-3.5 text-[#B5943B]" />
          <span>Internal Security Changelog · Created By Mr. Dương</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-[#2D2D2D]">
          Nhật ký Phát triển Hệ thống
        </h1>
        <p className="mt-2 text-sm sm:text-base text-[#5C5649] max-w-xl mx-auto">
          Nhật ký cập nhật tính năng, cấu hình máy trạm và bản vá bảo mật nội bộ. Được mã hóa chuẩn AES-256-GCM.
        </p>
      </div>

      {!markdownContent ? (
        /* KHỐI FORM NHẬP TÀI KHOẢN & MẬT KHẨU */
        <div className="max-w-md mx-auto card-luxury rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#FBF7EC] border border-[#EAE2CE] flex items-center justify-center mx-auto mb-4 p-2 shadow-xs">
            <img
              src="/AllSoftDesktop/logo.png"
              alt="Mr. Dương Logo"
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>

          <h2 className="text-lg font-extrabold text-[#2D2D2D] mb-1">
            Xác thực Mở khóa Nhật ký
          </h2>
          <p className="text-xs text-[#5C5649] mb-6">
            Nhập tài khoản Quản trị viên và mật khẩu giải mã tệp nhật ký trực tiếp trên trình duyệt.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleDecrypt(username, password);
            }}
            className="space-y-4 text-left"
          >
            <div>
              <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                Tài khoản Quản trị
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:ring-2 focus:ring-[#B5943B]/20 focus:outline-none"
                />
                <User className="w-4 h-4 text-[#B5943B] absolute left-3.5 top-1/2 -translate-y-1/2" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#2D2D2D] mb-1">
                Mật khẩu Giải mã (AES-256-GCM)
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu quản trị..."
                  className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl border border-[#EAE2CE] bg-[#FDFBF7] text-[#2D2D2D] focus:border-[#B5943B] focus:ring-2 focus:ring-[#B5943B]/20 focus:outline-none"
                  autoFocus
                />
                <KeyRound className="w-4 h-4 text-[#B5943B] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#5C5649] hover:text-[#2D2D2D] cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 text-left">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-shimmer w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#C5A044] to-[#9A7B2C] hover:from-[#B5943B] hover:to-[#8A6D23] disabled:opacity-50 text-white font-bold text-sm shadow-md shadow-[#B5943B]/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Đang giải mã...</span>
                </>
              ) : (
                <>
                  <Unlock className="w-4 h-4" />
                  <span>Mở khóa Nhật ký</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-[#EAE2CE] flex items-center justify-center gap-1.5 text-[11px] text-[#8A6D23] font-medium">
            <Award className="w-3.5 h-3.5 text-[#B5943B]" />
            <span>Created By Mr. Dương · Creative X Technology</span>
          </div>
        </div>
      ) : (
        /* NỘI DUNG ĐÃ ĐƯỢC GIẢI MÃ HOÀN TOÀN */
        <div className="card-luxury rounded-2xl p-6 sm:p-10 animate-fade-up">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-6 mb-8 border-b border-[#EAE2CE]">
            <div className="flex items-center gap-2 text-xs font-bold text-[#8A6D23] bg-[#FBF7EC] px-3 py-1.5 rounded-full border border-[#EAE2CE]">
              <Unlock className="w-4 h-4 text-[#B5943B]" />
              <span>Đã giải mã thành công (Tài khoản: {username})</span>
            </div>

            <button
              type="button"
              onClick={handleLock}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-[#2B2B2B] hover:bg-[#3D3D3D] text-white transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#C5A044]" />
              <span>Khóa lại phiên</span>
            </button>
          </div>

          <article className="prose max-w-none text-[#2D2D2D] text-sm sm:text-base leading-relaxed space-y-4 [&>h1]:text-2xl [&>h1]:font-extrabold [&>h1]:text-[#2D2D2D] [&>h2]:text-xl [&>h2]:font-bold [&>h2]:text-[#8A6D23] [&>h2]:mt-6 [&>h3]:text-lg [&>h3]:font-semibold [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:space-y-1 [&>ol]:list-decimal [&>ol]:pl-5 [&>p]:leading-relaxed">
            <ReactMarkdown>{markdownContent}</ReactMarkdown>
          </article>
        </div>
      )}
    </div>
  );
}
