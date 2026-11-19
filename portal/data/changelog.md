# Nhật ký phát triển AllSoft Desktop

## v2.8.0 (2026-11-19)
- **Web Portal chuẩn hóa**: Ra mắt giao diện cổng triển khai hiện đại hỗ trợ lọc theo Hồ sơ phòng ban (Profiles), tìm kiếm kho phần mềm, tải bản Setup/Portable và cài nhanh 1 dòng PowerShell (`install.ps1`).
- **Trung tâm Quản trị Full UI CMS & Upload bộ cài**: Tích hợp giao diện quản trị trực quan cho phép tùy biến thương hiệu, nội dung trang chủ, quản lý danh mục phần mềm/hồ sơ và tải trực tiếp tệp bộ cài lên GitHub Releases kèm khớp `offline_filename`.
- **Phần mềm AllSoft Desktop — Bộ 4 Module vận hành & bảo trì Windows**:
  - **Chẩn đoán lỗi hệ thống**: Quét Event Viewer (Kernel-Power 41, BugCheck 1001, Disk 7/11/51, NTFS 55, App Error 1000), BSOD Minidump, sức khỏe ổ đĩa/S.M.A.R.T, Driver PnP lỗi, gọi nhanh `mdsched.exe` và xuất báo cáo Markdown khử trùng lặp cho AI.
  - **Dọn rác hệ thống an toàn 3 cấp độ**: Phân tầng Xanh / Vàng / Đỏ (tệp tạm, thùng rác, Windows Update Cache, cache trình duyệt bảo toàn Cookies/Mật khẩu, DISM WinSxS).
  - **Cứu hộ máy in & vá lỗi Share LAN**: Xả kẹt Print Spooler (`.SPL`/`.SHD`), áp dụng bộ 4 bản vá Share máy in Windows 10/11 (`0x0000011b`, `0x00000709`, `0x00000bcb`, Firewall/Guest Auth) có sao lưu `.reg`, dò máy chủ SMB cổng 445 và kết nối nhanh máy in mạng.
  - **Gỡ cài đặt sạch 3 bước**: Chạy trình gỡ gốc, quét tàn dư thư mục/Registry kèm Blacklist bảo vệ hệ thống và tự động backup `.reg` trước khi xóa.

## Phiên bản 1.0.0 (2026-11-10)
- **Khởi tạo hệ thống**: Ra mắt AllSoft Desktop v2 (Launcher Tauri + Web Portal + Docs).
- **Cài đặt hybrid**: ưu tiên `winget`, dự phòng tải trực tiếp từ GitHub Releases kèm kiểm tra SHA-256.
- **Profile theo vai trò**: Văn phòng, Kế toán, Lễ tân, Kỹ thuật.
- **Lệnh 1 dòng**: `irm https://ntdtdt2010-bit.github.io/AllSoftDesktop/install.ps1 | iex`.
- **Offline/USB**: cài từ thư mục `packages/` cạnh file thực thi.
