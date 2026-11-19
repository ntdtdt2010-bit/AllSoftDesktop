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

1. **Web Portal (Cổng thông tin & Quản trị)**:
   - Tra cứu danh mục phần mềm trực quan.
   - Tải bộ cài phần mềm AllSoft Desktop và quét mã QR xem hướng dẫn nhanh trên điện thoại.
   - Quản trị kho phần mềm, hồ sơ triển khai và giao diện tập trung qua Trung tâm Quản trị.
   - Theo dõi nhật ký phiên bản được bảo mật.

2. **Phần mềm AllSoft Desktop (Windows v2.8.0)**:
   - **Cài đặt chuẩn hóa theo Profile**: Đọc danh mục chuẩn từ `catalog/apps.json`, tự động đối soát phần mềm đã cài trên máy và hỗ trợ cài đặt 1-click theo từng hồ sơ phòng ban (Máy Văn phòng, Máy Kế toán, Máy Lễ tân, Máy Kỹ thuật) ở cả chế độ Online và Offline qua USB/thư mục cục bộ.
   - **Chẩn đoán lỗi hệ thống**: Kiểm tra nhanh thông số phần cứng, dịch vụ Windows, kết nối mạng và phát hiện các lỗi vận hành phổ biến trên máy trạm.
   - **Dọn rác tùy chỉnh**: Giải phóng dung lượng an toàn theo từng hạng mục tệp tạm, bộ nhớ đệm trình duyệt và rác hệ thống.
   - **Cứu hộ máy in & Share LAN**: Sửa nhanh lỗi hàng đợi in (Print Spooler), lỗi chia sẻ máy in qua mạng nội bộ (Error `0x0000011b` / `0x00000709`) và tối ưu kết nối máy in LAN.
   - **Gỡ cài đặt sạch 3 bước**: Kiểm kê toàn bộ chương trình đang cài, gỡ cài đặt triệt để kèm dọn dấu vết còn sót và xuất báo cáo kiểm kê máy trạm.

3. **Tài liệu hướng dẫn (AllSoft Docs)**:
   - Tài liệu hóa quy trình vận hành cho IT Admin.
   - Hướng dẫn sử dụng cơ bản từng phần mềm cho người dùng cuối với đường dẫn slug cố định và mã QR tối ưu cho thiết bị di động.

---

## Bắt đầu nhanh

- **Người dùng máy trạm Windows**: [Hướng dẫn sử dụng phần mềm](/launcher) hoặc cài nhanh qua [PowerShell](/powershell).
- **Kỹ thuật viên IT**: Xem cách triển khai [Chế độ Offline / USB](/offline-usb) và [Thêm phần mềm mới](/contributing-apps).
- **Cổng thông tin**: Truy cập [Web Portal AllSoft Desktop](https://ntdtdt2010-bit.github.io/AllSoftDesktop/).
