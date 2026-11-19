---
sidebar_position: 5
title: Thêm phần mềm vào catalog
description: Hướng dẫn cấu hình apps.json và so sánh nguồn cài đặt winget với direct
---

# Thêm phần mềm vào apps.json

Danh mục phần mềm của toàn hệ thống AllSoft Desktop được khai báo tập trung trong tệp `catalog/apps.json`. Khi bạn cập nhật tệp này, cả Web Portal và Launcher sẽ tự động cập nhật danh mục.

## So sánh nguồn cài đặt: `winget` vs `direct`

AllSoft hỗ trợ hai hình thức cung cấp gói cài đặt chính:

| Tiêu chí | `winget` (Windows Package Manager) | `direct` (Tải bộ cài trực tiếp) |
| :--- | :--- | :--- |
| **Bản chất** | Tận dụng kho gói chính thức của Microsoft Windows | Tải file `.exe` / `.msi` từ GitHub Releases hoặc Server nội bộ |
| **Phiên bản** | Luôn lấy bản mới nhất do nhà phát triển phát hành | Ghim phiên bản cố định (`version`), đảm bảo tính ổn định tuyệt đối |
| **Phù hợp cho** | Trình duyệt, bộ ứng dụng văn phòng, công cụ phổ thông | Chữ ký số, phần mềm y tế đặc thù, driver máy in ghim version |
| **Cấu hình** | Cần `winget.id` (ví dụ `RARLab.WinRAR`) | Cần `direct.url`, `installer_type`, `silent_args` |

---

## 1. Mẫu khai báo nguồn `winget`

```json
{
  "id": "coccoc",
  "name": "Cốc Cốc",
  "description": "Trình duyệt web tối ưu cho người Việt.",
  "category": "Trình duyệt",
  "source": "winget",
  "winget": {
    "id": "CocCoc.CocCoc",
    "scope": "machine"
  },
  "version": "latest",
  "dependencies": [],
  "uninstall": { "mode": "winget" },
  "changelog_url": "https://coccoc.com",
  "docs_slug": "coccoc",
  "detect": {
    "display_names": ["Cốc Cốc", "CocCoc"],
    "registry_keys": [],
    "install_paths": []
  }
}
```

---

## 2. Mẫu khai báo nguồn `direct`

Dùng khi cần khóa đúng phiên bản và truyền tham số cài đặt im lặng (`silent_args`):

```json
{
  "id": "xprinter-driver",
  "name": "XPrinter Driver 8.2",
  "description": "Driver máy in nhiệt/hoá đơn XPrinter (ghim bản 8.2).",
  "category": "Driver",
  "source": "direct",
  "direct": {
    "url": "https://github.com/ntdtdt2010-bit/AllSoftDesktop/releases/download/apps-v1/XPrinter-Driver-8.2.exe",
    "installer_type": "exe",
    "silent_args": ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"],
    "sha256": null
  },
  "version": "8.2",
  "dependencies": [],
  "uninstall": { "mode": "registry", "args": ["/VERYSILENT"] },
  "changelog_url": "https://github.com/ntdtdt2010-bit/AllSoftDesktop/releases/tag/apps-v1",
  "docs_slug": "xprinter-driver",
  "detect": {
    "display_names": ["XPrinter Driver"],
    "registry_keys": [],
    "install_paths": []
  }
}
```

---

## 3. Thuộc tính `hidden: true`

Nếu một phần mềm là thư viện phụ thuộc (như Visual C++ Runtime hay .NET Runtime) mà bạn không muốn xuất hiện trên danh mục Portal cho người dùng cuối bấm cài riêng lẻ, hãy đặt `"hidden": true`. Launcher vẫn đọc được để xử lý trong mảng `dependencies`.

