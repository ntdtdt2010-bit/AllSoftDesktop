---
sidebar_position: 3
title: Lệnh 1 dòng PowerShell
description: Cài đặt AllSoft Launcher thần tốc chỉ bằng một dòng lệnh PowerShell duy nhất
---

# Lệnh 1 dòng PowerShell

Dành cho Quản trị viên và Kỹ thuật viên cần triển khai nhanh Launcher lên máy trạm mới mà không cần mở trình duyệt tải tệp thủ công.

## Lệnh cài đặt duy nhất

Mở **PowerShell** (hoặc Windows Terminal) với quyền Quản trị viên (*Run as Administrator*) và dán dòng lệnh sau:

```powershell
irm https://ntdtdt2010-bit.github.io/AllSoftDesktop/install.ps1 | iex
```

## Giải thích cơ chế hoạt động

- `irm` (viết tắt của `Invoke-RestMethod`): Tải script cài đặt trực tiếp từ kho GitHub Pages chính thức của AllSoft Desktop qua giao thức HTTPS an toàn.
- `|` (Pipeline): Đưa nội dung script trực tiếp vào luồng xử lý bộ nhớ.
- `iex` (viết tắt của `Invoke-Expression`): Thực thi script cài đặt trong phiên PowerShell hiện tại.

## Các bước script sẽ tự động thực hiện

1. **Kiểm tra quyền Administrator**: Nếu chưa có quyền, script sẽ tự động nâng quyền (UAC prompt).
2. **Kiểm tra môi trường Windows**: Kiểm tra phiên bản Windows và công cụ quản lý gói `winget`.
3. **Tải phiên bản mới nhất**: Tải `AllSoftDesktop-Setup.exe` từ GitHub Releases chính thức.
4. **Khởi chạy âm thầm**: Cài đặt vào thư mục người dùng/hệ thống và tạo lối tắt trên màn hình nền (Desktop).

