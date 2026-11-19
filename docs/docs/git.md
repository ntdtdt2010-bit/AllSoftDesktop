---
sidebar_position: 2
title: Git for Windows
summary: Kiểm tra bản cài và cấu hình danh tính sau khi launcher chạy xong.
---

Launcher cài Git bằng `/VERYSILENT /NORESTART`. Không có hộp thoại Next hay Finish.

## Kiểm tra

Mở một terminal mới và chạy:

```
git --version
```

Dòng kết quả cần khớp phiên bản đang ghi trong catalog.

## Danh tính commit

```
git config --global user.name "Tên của bạn"
git config --global user.email "ban@phong.local"
```

## Khi cần cài lại

Mở launcher, chọn Git và cài với chế độ ghi đè. Bản cùng phiên bản sẽ được bỏ qua cho đến khi bạn yêu cầu cài lại.
