<#
.SYNOPSIS
    Đẩy mã nguồn AllSoftDesktop lên GitHub và tùy chọn phát hành tag để kích hoạt GitHub Actions build bộ cài .exe.

.EXAMPLE
    .\scripts\push-to-github.ps1
    .\scripts\push-to-github.ps1 -Message "Cập nhật tính năng mới" -ReleaseTag "v1.0.0"
#>
param(
    [string]$Message = "chore: cập nhật mã nguồn AllSoft Desktop",
    [string]$ReleaseTag = "",
    [string]$RemoteUrl = "https://github.com/ntdtdt2010-bit/AllSoftDesktop.git",
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Text) {
    Write-Host "`n==> $Text" -ForegroundColor Cyan
}

function Ensure-Git {
    Write-Step "Kiểm tra công cụ Git..."
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $ver = (& git --version) -join " "
        Write-Host "Đã tìm thấy Git trong PATH: $ver" -ForegroundColor Green
        return
    }

    $candidateDirs = @(
        "C:\Program Files\Git\cmd",
        "C:\Program Files\Git\bin",
        "C:\Program Files (x86)\Git\cmd",
        "$env:LOCALAPPDATA\Programs\Git\cmd"
    )

    foreach ($dir in $candidateDirs) {
        if (Test-Path (Join-Path $dir "git.exe")) {
            $env:PATH = "$dir;$env:PATH"
            $ver = (& git --version) -join " "
            Write-Host "Đã tìm thấy và bổ sung Git vào PATH từ '$dir': $ver" -ForegroundColor Green
            return
        }
    }

    Write-Host "Chưa tìm thấy Git trên máy. Đang cài đặt tự động qua winget..." -ForegroundColor Yellow
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Không tìm thấy git cũng như winget. Vui lòng cài đặt Git từ https://git-scm.com/download/win rồi chạy lại script."
    }

    & winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Cài đặt Git qua winget thất bại (mã lỗi: $LASTEXITCODE)."
    }

    foreach ($dir in $candidateDirs) {
        if (Test-Path (Join-Path $dir "git.exe")) {
            $env:PATH = "$dir;$env:PATH"
            break
        }
    }

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "Đã chạy cài đặt Git nhưng chưa nhận diện được lệnh 'git'. Vui lòng mở lại cửa sổ PowerShell mới và chạy lại."
    }
    Write-Host "Cài đặt Git thành công: $((& git --version) -join ' ')" -ForegroundColor Green
}

Ensure-Git

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
Write-Step "Thư mục gốc dự án: $repoRoot"

if (-not (Test-Path (Join-Path $repoRoot ".git"))) {
    Write-Step "Khởi tạo kho Git mới..."
    & git init -b $Branch
}

# Đảm bảo đã cấu hình user.name / user.email cơ bản để commit không bị lỗi
$gitName = (& git config user.name) 2>$null
if ([string]::IsNullOrWhiteSpace($gitName)) {
    & git config user.name "ntdtdt2010-bit"
}
$gitEmail = (& git config user.email) 2>$null
if ([string]::IsNullOrWhiteSpace($gitEmail)) {
    & git config user.email "ntdtdt2010-bit@users.noreply.github.com"
}

Write-Step "Kiểm tra kết nối remote 'origin'..."
$existingRemote = (& git remote get-url origin) 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($existingRemote)) {
    Write-Host "Thêm remote origin -> $RemoteUrl" -ForegroundColor Yellow
    & git remote add origin $RemoteUrl
} elseif ($existingRemote.Trim() -ne $RemoteUrl) {
    Write-Host "Cập nhật remote origin từ '$existingRemote' -> '$RemoteUrl'" -ForegroundColor Yellow
    & git remote set-url origin $RemoteUrl
} else {
    Write-Host "Remote origin hợp lệ: $existingRemote" -ForegroundColor Green
}

Write-Step "Đưa toàn bộ thay đổi vào staging (git add -A)..."
& git add -A

$status = (& git status --porcelain)
if (-not [string]::IsNullOrWhiteSpace(($status -join ""))) {
    Write-Step "Tạo bản ghi commit: '$Message'..."
    & git commit -m $Message
    if ($LASTEXITCODE -ne 0) {
        throw "Lệnh git commit thất bại."
    }
} else {
    Write-Host "Không có thay đổi mới cần commit." -ForegroundColor Yellow
}

Write-Step "Đảm bảo nhánh hiện tại là '$Branch'..."
& git branch -M $Branch

Write-Step "Đẩy mã nguồn lên GitHub (origin/$Branch)..."
& git push -u origin $Branch
if ($LASTEXITCODE -ne 0) {
    throw "Đẩy mã nguồn lên origin/$Branch thất bại. Vui lòng kiểm tra quyền truy cập/đăng nhập GitHub."
}
Write-Host "Đã đẩy nhánh '$Branch' lên GitHub thành công!" -ForegroundColor Green

if (-not [string]::IsNullOrWhiteSpace($ReleaseTag)) {
    if ($ReleaseTag -notmatch '^v\d+\.\d+\.\d+') {
        Write-Host "Lưu ý: Tag '$ReleaseTag' không bắt đầu bằng 'v' (ví dụ: v1.0.0). Workflow release-launcher.yml chỉ tự động kích hoạt với tag dạng 'v*'." -ForegroundColor Yellow
    }

    Write-Step "Tạo và đẩy tag phát hành '$ReleaseTag' để kích hoạt GitHub Actions build .exe..."
    $existingTag = (& git tag -l $ReleaseTag)
    if (-not [string]::IsNullOrWhiteSpace(($existingTag -join ""))) {
        Write-Host "Tag '$ReleaseTag' đã tồn tại cục bộ, đang cập nhật lại vào commit hiện tại..." -ForegroundColor Yellow
        & git tag -f $ReleaseTag
    } else {
        & git tag $ReleaseTag
    }

    & git push origin "refs/tags/$ReleaseTag" --force
    if ($LASTEXITCODE -ne 0) {
        throw "Đẩy tag '$ReleaseTag' lên GitHub thất bại."
    }
    Write-Host "Đã đẩy tag '$ReleaseTag' thành công! Theo dõi tiến trình tạo bộ cài .exe tại:" -ForegroundColor Green
    Write-Host "  https://github.com/ntdtdt2010-bit/AllSoftDesktop/actions" -ForegroundColor Cyan
}

Write-Host "`nHoàn tất mọi thao tác!" -ForegroundColor Green
