$ErrorActionPreference = "Stop"

$mingwBin = "D:\ai_tools_tmp\winlibs\mingw64\bin"
$env:PATH = "$mingwBin;$env:PATH"
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
$env:CARGO_BUILD_TARGET = "x86_64-pc-windows-gnu"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = Join-Path $mingwBin "x86_64-w64-mingw32-gcc.exe"
$env:CC_x86_64_pc_windows_gnu = Join-Path $mingwBin "x86_64-w64-mingw32-gcc.exe"
$env:CXX_x86_64_pc_windows_gnu = Join-Path $mingwBin "x86_64-w64-mingw32-g++.exe"
$env:AR_x86_64_pc_windows_gnu = Join-Path $mingwBin "ar.exe"
$env:CARGO_TARGET_DIR = "D:\ai_tools_tmp\tauri-target"
$env:CARGO_INCREMENTAL = "0"

Set-Location $PSScriptRoot

# Run via Start-Process so the npx + cargo + GUI process tree stays alive
# even after this launcher script terminates. Output is captured to a file.
$logPath = Join-Path $PSScriptRoot "dev.log"
Start-Process -FilePath "npx.cmd" `
  -ArgumentList @("tauri", "dev") `
  -WorkingDirectory $PSScriptRoot `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError "$logPath.err" `
  -WindowStyle Hidden

Write-Host "Started Tauri dev. Log: $logPath"
