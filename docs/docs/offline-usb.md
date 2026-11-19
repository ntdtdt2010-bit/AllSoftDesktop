---
sidebar_position: 4
title: Chế độ Offline / USB
description: Triển khai cài đặt phần mềm không cần kết nối Internet qua USB hoặc thư mục mạng nội bộ
---

# Chế độ Offline / USB

Trong môi trường phòng khám, bệnh viện, khu vực cách ly mạng hoặc đường truyền Internet chập chờn, AllSoft Launcher hỗ trợ cơ chế nạp gói cục bộ (Offline Package Cache) cực kỳ tiện lợi.

## Cấu trúc thư mục USB chuẩn

Để Launcher tự động nhận diện gói Offline và bỏ qua bước tải Internet, bạn chỉ cần tổ chức thư mục trên USB như sau:

```text
E:\ (USB Drive)
├── AllSoftDesktop-Portable.exe
└── packages\
    ├── coccoc.exe
    ├── onlyoffice.exe
    ├── winrar.exe
    ├── ultraviewer.exe
    ├── lightshot.exe
    ├── cpu-z.exe
    ├── vnpt-ca.exe
    ├── vnegp-agent.exe
    ├── xprinter-driver.exe
    └── epson-l8050.exe
```

## Quy tắc đặt tên tệp gói

- **Vị trí**: Thư mục có tên bắt buộc là `packages\` nằm **ngang hàng** (cạnh) tệp thực thi `AllSoftDesktop-Portable.exe` (hoặc thư mục cài đặt của Launcher).
- **Tên tệp**: Bắt buộc đặt tên theo đúng mã định danh **`<id>.exe`** được định nghĩa trong `apps.json`.
  - Ví dụ: Ứng dụng có id là `vnpt-ca` thì tệp gói phải là `packages\vnpt-ca.exe`.
  - Ví dụ: Ứng dụng có id là `xprinter-driver` thì tệp gói phải là `packages\xprinter-driver.exe`.

## Cơ chế ưu tiên của Launcher

1. Khi người dùng bấm Cài đặt một ứng dụng, Launcher sẽ kiểm tra thư mục `packages\<id>.exe` trước tiên.
2. Nếu tệp tồn tại và hợp lệ, Launcher sẽ lập tức chạy lệnh cài đặt âm thầm từ tệp nội bộ này mà không phát sinh bất kỳ yêu cầu mạng nào.
3. Nếu không tìm thấy trong `packages\`, Launcher mới thực hiện tải trực tiếp từ Internet (qua winget hoặc direct download link).

