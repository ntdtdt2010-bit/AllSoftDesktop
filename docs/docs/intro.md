---
slug: /
sidebar_position: 1
title: Giới thiệu hệ thống
description: Tổng quan kiến trúc AllSoft Desktop và cách vận hành chuẩn hóa
---

# Giới thiệu AllSoft Desktop

**AllSoft Desktop** là giải pháp chuẩn hóa môi trường làm việc máy trạm cho cơ quan, bệnh viện và doanh nghiệp. Hệ thống giúp kỹ thuật viên IT và người dùng cuối quản lý, cài đặt và cập nhật phần mềm một cách tự động, an toàn và nhất quán.

## Kiến trúc 3 thành phần

Hệ thống được thiết kế theo mô hình 3 trụ cột:

1. **Web Portal (Cổng thông tin & Cấu hình)**:
   - Tra cứu danh mục phần mềm trực quan.
   - Trình sinh cấu hình máy trạm động client-side an toàn (`config.json`, `settings.ini`).
   - Tải bộ cài Launcher và quét mã QR xem hướng dẫn nhanh trên điện thoại.
   - Theo dõi nhật ký phiên bản được bảo mật.

2. **AllSoft Launcher (Máy trạm)**:
   - Ứng dụng desktop gọn nhẹ chạy trên Windows.
   - Đọc danh mục chuẩn từ `catalog/apps.json` để tự động đối soát phần mềm đã cài trên máy.
   - Hỗ trợ cài đặt 1-click hoặc cài đặt theo Profile (Máy Văn phòng, Máy Kế toán, Máy Lễ tân, Máy Kỹ thuật).
   - Hỗ trợ cả chế độ Online và Offline qua USB/thư mục cục bộ.

3. **Tài liệu hướng dẫn (AllSoft Docs)**:
   - Tài liệu hóa quy trình vận hành cho IT Admin.
   - Hướng dẫn sử dụng cơ bản từng phần mềm cho người dùng cuối với đường dẫn slug cố định và mã QR tối ưu cho thiết bị di động.

---

## Bắt đầu nhanh

- **Người dùng máy trạm Windows**: [Hướng dẫn sử dụng Launcher](/launcher) hoặc cài nhanh qua [PowerShell](/powershell).
- **Kỹ thuật viên IT**: Xem cách triển khai [Chế độ Offline / USB](/offline-usb) và [Thêm phần mềm mới](/contributing-apps).
- **Cổng thông tin**: Truy cập [Web Portal AllSoft Desktop](https://ntdtdt2010-bit.github.io/AllSoftDesktop/).
