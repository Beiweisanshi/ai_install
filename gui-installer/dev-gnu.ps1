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
& npx.cmd tauri dev
