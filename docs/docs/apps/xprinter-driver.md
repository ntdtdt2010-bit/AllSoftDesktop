---
sidebar_position: 9
title: XPrinter Driver 8.2
description: Trình điều khiển máy in nhiệt / in hóa đơn XPrinter phiên bản chuẩn hóa 8.2
---

# Driver máy in XPrinter 8.2

Bản driver ghim phiên bản **8.2** chuẩn hóa dùng cho tất cả các dòng máy in nhiệt, in hóa đơn khổ K80 / K58 phục vụ quầy tiếp đón, lễ tân, thu ngân và nhà thuốc.

## Khổ giấy & Cổng kết nối hỗ trợ
- **Khổ giấy**: XP-80C (80mm - K80) hoặc XP-58 (58mm - K58).
- **Cổng kết nối**: USB hoặc Ethernet (LAN / Wi-Fi qua địa chỉ IP máy in).

## Cấu hình máy in sau khi cài đặt
1. Vào `Control Panel` > `Devices and Printers` > Nhấp chuột phải vào `XPrinter XP-80` > Chọn `Printer properties`.
2. Chuyển sang thẻ `Ports`:
   - Nếu cắm dây USB: Chọn đúng cổng `USB001` hoặc `USB002`.
   - Nếu in qua mạng LAN: Bấm `Add Port` > Chọn `Standard TCP/IP Port` > Nhập IP máy in (ví dụ: `192.168.1.200`).
3. Chuyển sang thẻ `Device Settings`:
   - Kiểm tra mục `Cutter` (Cắt giấy tự động): Đặt là `Cut at Document End` để máy in tự động cắt biên lai sau khi in xong.
4. Bấm `Print Test Page` để in thử trang mẫu.

