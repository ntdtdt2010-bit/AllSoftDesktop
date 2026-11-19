import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "AllSoft Desktop · Mr. Dương Studio",
  description:
    "Hệ sinh thái chuẩn hóa máy trạm và quản lý phần mềm chuyên nghiệp cho cơ quan, bệnh viện và doanh nghiệp.",
  icons: {
    icon: "/AllSoftDesktop/icon.png",
    shortcut: "/AllSoftDesktop/favicon.ico",
    apple: "/AllSoftDesktop/icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="min-h-screen flex flex-col bg-[#FDFBF7] text-[#2D2D2D] antialiased selection:bg-[#FBF7EC] selection:text-[#8A6D23]">
        <Header />
        <main className="flex-1 flex flex-col">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
