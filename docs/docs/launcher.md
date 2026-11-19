---
sidebar_position: 2
title: Hướng dẫn dùng Launcher
description: Cách tải, cài đặt và sử dụng AllSoft Launcher trên Windows
---

# Hướng dẫn dùng Launcher

**AllSoft Launcher** là công cụ trung tâm trên từng máy trạm, giúp tự động hóa việc rà soát và cài đặt các phần mềm được phân quyền theo chức năng phòng ban.

## 1. Yêu cầu hệ thống

- **Hệ điều hành**: Windows 10 (1809 trở lên) hoặc Windows 11 (64-bit).
- **Quyền hạn**: Quyền Quản trị viên (Administrator) để cài đặt các phần mềm hệ thống và driver.
- **Kết nối**: Internet (để tải gói cài qua winget/direct) hoặc cắm USB chứa thư mục gói Offline.

## 2. Các phương thức tải Launcher

| Phiên bản | Định dạng | Mục đích sử dụng |
| :--- | :--- | :--- |
| **Bản Cài đặt (Setup)** | `AllSoftDesktop-Setup.exe` | Khuyên dùng cho máy cố định; tích hợp vào Start Menu và khôi phục tự động. |
| **Bản Di động (Portable)** | `AllSoftDesktop-Portable.exe` | Phù hợp cho kỹ thuật viên chạy trực tiếp từ USB mà không cần cài đặt Launcher. |

## 3. Quy trình sử dụng

1. **Khởi chạy ứng dụng**:
   - Nhấp đúp vào `AllSoftDesktop.exe` (chọn *Run as administrator* nếu hệ điều hành hiển thị cảnh báo UAC).
2. **Chọn Hồ sơ (Profile)**:
   - **Máy Văn phòng**: Gồm trình duyệt Cốc Cốc, ONLYOFFICE, WinRAR, UltraViewer, Lightshot.
   - **Máy Kế toán**: Bộ văn phòng kèm chữ ký số VNPT-CA và VNeGP Client Agent.
   - **Máy Lễ tân**: Bộ cơ bản kèm driver máy in nhiệt XPrinter và EPSON L8050.
   - **Máy Kỹ thuật**: Các công cụ chẩn đoán phần cứng CPU-Z, UltraViewer, WinRAR.
3. **Quét trạng thái & Cài đặt**:
   - Bấm nút **"Kiểm tra máy"**: Launcher sẽ tự động đối soát Registry và đường dẫn tệp để báo phần mềm nào "Đã cài đặt" hoặc "Chưa có".
   - Bấm **"Cài đặt tất cả"** hoặc chọn từng ứng dụng cần cài. Tiến trình sẽ diễn ra hoàn toàn tự động ở chế độ chạy ngầm (silent mode).

