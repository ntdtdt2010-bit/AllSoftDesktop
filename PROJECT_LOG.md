# Sổ Tay Kiến Trúc & Lịch Sử Phát Triển — AllSoft Desktop

> **Thư mục gốc Project:** `C:\Users\ntdtd\source\repos\AllSoftDesktop`  
> **GitHub Repo:** `https://github.com/ntdtdt2010-bit/AllSoftDesktop` (Nhánh `main` · Tag mới nhất: `v2.8.0`)  
> **Website Online:** `https://ntdtdt2010-bit.github.io/AllSoftDesktop/`  
> **Trang Quản trị:** `https://ntdtdt2010-bit.github.io/AllSoftDesktop/admin/`  
> **Tác giả / Thương hiệu:** Created By Mr. Dương · Creative X Technology

---

## 1. Hướng dẫn nhanh cho các phiên làm việc sau (Dành cho Sếp & AI)

Khi Sếp cần **thêm/bớt tính năng hoặc sửa lỗi** ở một phiên chat mới, chỉ cần mở workspace `C:\Users\ntdtd\source\repos\AllSoftDesktop` và nhắn AI:
> *"Đọc `PROJECT_LOG.md` để nắm kiến trúc, sau đó thực hiện yêu cầu: [mô tả ngắn gọn việc cần làm]."*

### Quy ước thiết kế & thương hiệu bắt buộc (Sếp đã chốt)
- **Giao diện:** Chỉ dùng **Pure Light Mode** (không dùng Dark Mode).
- **Bảng màu:** Nền sáng kem `#FDFBF7` / `#FFFFFF`, viền `#EAE2CE`, màu chủ đạo **Vàng Đồng Hoàng Gia (`#B5943B`, gradient `from-[#C5A044] to-[#9A7B2C]`)** kết hợp **Charcoal (`#2B2B2B`)**.
- **Logo & Icon:** Logo ngang **MR. DƯƠNG · CREATIVE X TECHNOLOGY** kích thước tối thiểu `W: 200px` (`H: auto`), không đóng khung ô vuông nhỏ. Icon app là biểu tượng khiên vàng đồng (`icon.ico` / `icon.png`).
- **Bản quyền:** Chỉ hiển thị gọn **1 lần ở Footer** (`© 2026 AllSoft Desktop · Created By Mr. Dương`), tránh lặp lại ở Header, Hero hoặc nhiều nơi trong cùng màn hình.
- **Ngôn ngữ giao diện:** 100% Tiếng Việt rõ ràng, chuyên nghiệp, không dùng từ viết tắt dễ gây hiểu nhầm (ví dụ dùng `ứng dụng` thay cho `PM`).

---

## 2. Lịch sử phát triển & Các cột mốc (Git History)

| Thời điểm | Commit / Tag | Nội dung chính |
| :--- | :--- | :--- |
| **Giai đoạn v1** | `_backup_v1.zip` | Phiên bản thử nghiệm ban đầu (Electron + dữ liệu rời), đã được sao lưu và xây lại hoàn toàn bằng **Tauri 2 + Next.js + Docusaurus**. |
| **19/11/2026** | `b7e3ac9` | Hoàn thiện nền tảng cốt lõi: CSDL `catalog/apps.json` (13 app, 4 profile), Web Portal tĩnh, Trang Quản trị `/admin` (khoá PBKDF2-SHA256), Nhật ký mã hoá AES-256-GCM, Tài liệu Docusaurus, và Phần mềm Windows tích hợp 5 Tab (Cài đặt theo Profile, Chẩn đoán lỗi, Dọn rác, Cứu hộ máy in, Gỡ cài đặt). |
| **19/11/2026** | `c9b26e3` (`v2.8.0`) | Rà soát tổng thể & nâng cấp phiên bản `v2.8.0`: vá khớp 100% IPC Rust ↔ React (`run_diagnostics`, `list_installed_programs`, `uninstall_program`), hỗ trợ `offline_filename`, dọn sạch các điểm trùng lặp UX/UI (CPU/RAM/Footer/Changelog), gỡ mục `/config` thừa và link chết trong Docs. |
| **20/11/2026** | `0e1ea23` | Thêm cơ chế tự động vô hiệu hoá cache `localStorage` cũ trên Portal/Admin khi nâng phiên bản phát hành. |
| **20/11/2026** | `a0c3d95` | Sửa lỗi kiểu chuỗi `&str` trong `launcher/src-tauri/src/report.rs` khi biên dịch Rust trên GitHub Actions → Build thành công `AllSoftDesktop-Setup.exe` (2.1 MB) & `AllSoftDesktop-Portable.exe` (5.16 MB) tại Release `v2.8.0`. |
| **20/11/2026** | `ee7735b` | Bổ sung nút **`Tải về`** trực tiếp trên từng thẻ phần mềm tại Web Portal (`portal/app/page.tsx`). |

---

## 3. Bản đồ Kiến trúc & Thư mục Project

```text
C:\Users\ntdtd\source\repos\AllSoftDesktop\
├─ catalog/
│  ├─ apps.json              # CSDL trung tâm: danh sách phần mềm, profiles, branding, site_content
│  └─ apps.schema.json       # JSON Schema kiểm định hợp lệ catalog
├─ portal/                   # Web Portal (Next.js 15 static export, basePath: /AllSoftDesktop)
│  ├─ app/page.tsx           # Trang chủ: Hero tải phần mềm, lệnh 1 dòng, Profiles, Danh mục + QR + nút Tải về
│  ├─ app/admin/page.tsx     # Trung tâm Quản trị (/admin): CRUD App + Upload bộ cài + Kho 25+ mẫu + Full UI CMS
│  ├─ app/changelog/page.tsx # Trang Nhật ký bảo mật giải mã client-side (AES-256-GCM)
│  ├─ components/            # Header.tsx, Footer.tsx, SmartDownloadButton.tsx, QRCodeModal.tsx, CopyButton.tsx
│  ├─ lib/                   # catalog.ts (types & defaults), crypto.ts (PBKDF2/AES), presets.ts (25+ app mẫu VN)
│  ├─ data/changelog.md      # Nội dung nguồn của Nhật ký phát triển
│  ├─ scripts/encrypt-changelog.mjs  # Mã hoá changelog.md -> public/changelog.enc.json
│  └─ public/                # install.ps1, apps.json, changelog.enc.json, logo.png, icon.png, favicon.ico
├─ launcher/                 # Phần mềm Windows "AllSoft Desktop" (Tauri v2 + React + Vite + Tailwind)
│  ├─ src/
│  │  ├─ App.tsx             # Khung chính 5 Tab + Thanh thông số phần cứng (CPU/RAM/DISK/LAN)
│  │  ├─ api.ts              # Cầu nối IPC gọi Rust backend + Preview Mode tương tác trên trình duyệt
│  │  ├─ types.ts            # Toàn bộ kiểu dữ liệu TypeScript cho 5 module
│  │  └─ components/
│  │     ├─ DiagnosticsTab.tsx  # Tab 2: Chẩn đoán lỗi (Event Viewer, BSOD, SMART, PnP, mdsched.exe)
│  │     ├─ CleanerTab.tsx      # Tab 3: Dọn rác 3 mức màu (Cơ bản/Trung bình/Chuyên sâu), 2 bước Quét -> Dọn
│  │     ├─ PrinterTab.tsx      # Tab 4: Cứu hộ Spooler treo lệnh in + Vá lỗi Share LAN + Test SMB 445
│  │     └─ UninstallerTab.tsx  # Tab 5: Kiểm kê toàn bộ phần mềm máy trạm + Wizard gỡ sạch 3 bước
│  └─ src-tauri/
│     ├─ Cargo.toml & tauri.conf.json & build.rs (requireAdministrator manifest)
│     ├─ icons/              # Bộ icon đa phân giải & icon.ico cho file .exe
│     └─ src/
│        ├─ main.rs          # Đăng ký toàn bộ Tauri commands, CancelState, ToolProgress event
│        ├─ catalog.rs       # Tải apps.json online -> cache -> fallback bản đóng gói
│        ├─ detect.rs        # Đọc thông số phần cứng + quét Registry Uninstall (64/32/HKCU)
│        ├─ winget.rs        # Cài/nâng cấp/gỡ qua winget & map exit code
│        ├─ direct.rs        # Tải file trực tiếp + kiểm tra SHA-256 + cài silent exe/msi
│        ├─ offline.rs       # Quét thư mục packages/ cạnh file .exe để cài offline
│        ├─ deps.rs          # Kiểm tra & cài nền tảng phụ thuộc (.NET, VC++, Node)
│        ├─ report.rs        # Xuất báo cáo cài đặt HTML/CSV
│        ├─ updater.rs       # Kiểm tra & tự cập nhật từ GitHub Releases
│        ├─ diagnostics.rs   # Backend Module Chẩn đoán lỗi
│        ├─ cleaner.rs       # Backend Module Dọn rác an toàn
│        ├─ uninstaller.rs   # Backend Module Gỡ sạch 3 bước + Blacklist + Auto-backup .reg
│        └─ printer.rs       # Backend Module Cứu hộ máy in + Vá Registry 0x0000011b/709/bcb
├─ docs/                     # Trang Tài liệu hướng dẫn (Docusaurus 3, baseUrl: /AllSoftDesktop/docs/)
├─ scripts/
│  ├─ serve-preview.mjs      # Server xem trước cổng 3000 + API lưu catalog, upload logo/icon/installer
│  ├─ validate-catalog.mjs   # Kiểm tra tính hợp lệ của catalog/apps.json
│  └─ push-to-github.ps1     # Script hỗ trợ commit & push nhanh lên GitHub
└─ .github/workflows/
   ├─ pages.yml              # Tự động build Portal + Docs -> xuất bản GitHub Pages khi push main
   ├─ release-launcher.yml   # Tự động build Tauri .exe trên Windows runner khi push tag v*
   └─ validate-catalog.yml   # Tự động kiểm tra apps.json trên Pull Request
```

---

## 4. Hướng dẫn Bảo trì & Mở rộng về sau

### A. Thêm / Sửa phần mềm & Giao diện không cần đụng code
1. Mở trang Quản trị: `https://ntdtdt2010-bit.github.io/AllSoftDesktop/admin/` *(hoặc chạy local `node scripts/serve-preview.mjs` rồi mở `http://localhost:3000/AllSoftDesktop/admin/`)*.
2. Đăng nhập bằng tài khoản mặc định (`admin` / `Kakaidid001@`).
3. Thêm/sửa/ẩn phần mềm, upload bộ cài `.exe`/`.msi`, chỉnh sửa chữ hiển thị hoặc đổi Logo/Icon ở Tab 3, rồi xuất bản lên GitHub ở Tab 4.

### B. Khi muốn sửa code & phát hành bản `.exe` mới (ví dụ lên `v2.9.0`)
1. **Kiểm tra local trước khi đẩy:**
   - Validate catalog: `npm run validate:catalog`
   - Build Portal: `cd portal && npm run build`
   - Build Launcher Frontend: `cd launcher && npm run build`
   - Build Docs: `cd docs && npm run build`
   - *(Lưu ý: Máy cá nhân không cài MSVC `link.exe`, kiểm tra cú pháp Rust bằng `rustc --edition 2021 -Z unpretty=ast-tree ...`, còn biên dịch ra `.exe` do GitHub Actions `windows-latest` đảm nhận).*
2. **Nâng số phiên bản** tại 5 chỗ: `launcher/src-tauri/Cargo.toml`, `launcher/src-tauri/tauri.conf.json`, `launcher/package.json`, `portal/package.json`, `catalog/apps.json` (`launcher.version` + `hero_version_note`).
3. **Đẩy code & tạo tag phát hành mới:**
   ```powershell
   cd C:\Users\ntdtd\source\repos\AllSoftDesktop
   git add -A
   git commit -m "feat: mô tả tính năng mới"
   git tag v2.9.0
   git push origin main
   git push origin v2.9.0
   ```
   - `push origin main` → tự động cập nhật Web Portal + Docs trong ~1–2 phút.
   - `push origin v2.9.0` → tự động biên dịch `AllSoftDesktop-Setup.exe` & `AllSoftDesktop-Portable.exe` đưa lên GitHub Releases trong ~4–5 phút.

### C. Bảo mật & Secrets trên GitHub
- **Secret `CHANGELOG_PASSWORD`** (trong *GitHub Repo → Settings → Secrets and variables → Actions*): dùng để mã hoá `portal/data/changelog.md` thành `changelog.enc.json` mỗi lần chạy `pages.yml`.
- **Tài khoản Admin mặc định** (`admin` / `Kakaidid001@`): lưu dưới dạng mã băm PBKDF2-SHA256 (600.000 vòng) trong `portal/lib/crypto.ts`.
