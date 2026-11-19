"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

export function CopyButton({ text, label, className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Lỗi sao chép:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      type="button"
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
        copied
          ? "bg-emerald-50 text-emerald-700 border border-emerald-300"
          : "bg-[#FBF7EC] hover:bg-[#F3E9CE] text-[#8A6D23] border border-[#EAE2CE]"
      } ${className}`}
      title="Sao chép vào bộ nhớ tạm"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-600" />
          <span>{label ? "Đã sao chép!" : "Đã chép"}</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5 text-[#B5943B]" />
          <span>{label || "Sao chép"}</span>
        </>
      )}
    </button>
  );
}
