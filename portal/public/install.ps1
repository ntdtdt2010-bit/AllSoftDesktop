# AllSoft Desktop - Cài đặt bằng 1 dòng lệnh
#   irm https://ntdtdt2010-bit.github.io/AllSoftDesktop/install.ps1 | iex
# Chọn profile (office | accounting | reception | technician):
#   $env:ALLSOFT_PROFILE='office'; irm https://ntdtdt2010-bit.github.io/AllSoftDesktop/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://ntdtdt2010-bit.github.io/AllSoftDesktop/install.ps1))) -Profile office
[CmdletBinding()]
param(
    [ValidateSet('', 'office', 'accounting', 'reception', 'technician')]
    [string]$Profile = $env:ALLSOFT_PROFILE,
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$Repo      = 'ntdtdt2010-bit/AllSoftDesktop'
$AssetName = 'AllSoftDesktop-Setup.exe'
$Url       = "https://github.com/$Repo/releases/latest/download/$AssetName"

function Write-Step($m) { Write-Host "[AllSoft] $m" -ForegroundColor Cyan }
function Write-Warn($m) { Write-Host "[AllSoft] $m" -ForegroundColor Yellow }
function Write-Fail($m) { Write-Host "[AllSoft] LỖI: $m" -ForegroundColor Red }

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    # 1. Kiểm tra quyền Administrator
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Fail 'Cần quyền Administrator. Hãy mở PowerShell bằng "Run as administrator" rồi chạy lại lệnh.'
        return
    }

    # 2. Kiểm tra winget
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Step 'Đã tìm thấy winget.'
    } else {
        Write-Warn 'Không tìm thấy winget (App Installer). Launcher sẽ chỉ cài được phần mềm tải trực tiếp; hãy cập nhật "App Installer" từ Microsoft Store để dùng đủ tính năng.'
    }

    # 3. Tải bản Launcher mới nhất
    $tmp = Join-Path ([IO.Path]::GetTempPath()) $AssetName
    Write-Step "Đang tải Launcher mới nhất từ GitHub Releases..."
    Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
    if (-not (Test-Path $tmp) -or (Get-Item $tmp).Length -lt 1MB) {
        throw 'Tệp tải về không hợp lệ (quá nhỏ hoặc không tồn tại).'
    }
    $sig = Get-AuthenticodeSignature $tmp
    if ($sig.Status -eq 'HashMismatch') { throw 'Chữ ký số của tệp cài đặt không hợp lệ.' }

    # 4. Cài đặt
    Write-Step 'Đang cài đặt AllSoft Desktop...'
    $p = Start-Process -FilePath $tmp -ArgumentList '/S' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Trình cài đặt trả về mã lỗi $($p.ExitCode)." }
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    Write-Step 'Cài đặt hoàn tất.'

    # 5. Mở Launcher (kèm profile nếu có)
    $candidates = @(
        "$env:ProgramFiles\AllSoft Desktop\AllSoft Desktop.exe",
        "$env:ProgramFiles\AllSoftDesktop\AllSoftDesktop.exe",
        "$env:LOCALAPPDATA\AllSoft Desktop\AllSoft Desktop.exe"
    )
    $exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($exe -and -not $Silent) {
        $launchArgs = @()
        if ($Profile) { $launchArgs += @('--profile', $Profile); Write-Step "Profile: $Profile" }
        Start-Process -FilePath $exe -ArgumentList $launchArgs
    } else {
        Write-Step 'Hãy mở "AllSoft Desktop" từ Start Menu để bắt đầu.'
    }
}
catch {
    Write-Fail $_.Exception.Message
    Write-Warn "Bạn có thể tải thủ công tại: https://github.com/$Repo/releases/latest"
}
