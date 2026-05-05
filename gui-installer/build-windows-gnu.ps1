$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$repoRoot = Split-Path -Parent $projectRoot
$distDir = Join-Path $repoRoot "dist"
$mingwRoot = "D:\ai_tools_tmp\winlibs\mingw64"
$mingwBin = Join-Path $mingwRoot "bin"
$targetDir = "D:\ai_tools_tmp\tauri-target"
$tempDir = "D:\ai_tools_tmp\tmp-build"
$exePath = Join-Path $targetDir "x86_64-pc-windows-gnu\release\gui-installer.exe"
$webviewLoaderPath = Join-Path $targetDir "x86_64-pc-windows-gnu\release\WebView2Loader.dll"
$tauriConfigPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"

function Copy-WithFallback {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,
    [Parameter(Mandatory = $true)]
    [string]$TargetPath
  )

  try {
    Copy-Item $SourcePath $TargetPath -Force
    return $TargetPath
  } catch [System.IO.IOException] {
    $targetDirectory = Split-Path -Parent $TargetPath
    $targetLeaf = [System.IO.Path]::GetFileNameWithoutExtension($TargetPath)
    $targetExtension = [System.IO.Path]::GetExtension($TargetPath)
    $fallbackPath = Join-Path $targetDirectory ($targetLeaf + ".next" + $targetExtension)
    Copy-Item $SourcePath $fallbackPath -Force
    Write-Warning "$targetLeaf is in use. Wrote the new file to $(Split-Path -Leaf $fallbackPath) instead."
    return $fallbackPath
  }
}

function Remove-IfExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (Test-Path $Path) {
    Remove-Item $Path -Force
  }
}

function Resolve-RequiredTool {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Names
  )

  foreach ($name in $Names) {
    $path = Join-Path $mingwBin $name
    if (Test-Path $path) {
      return $path
    }
  }

  throw "Required MinGW tool not found. Tried: $($Names -join ', ')"
}

if (-not (Test-Path $mingwBin)) {
  throw "MinGW toolchain not found: $mingwBin"
}

New-Item -ItemType Directory -Force $distDir | Out-Null
New-Item -ItemType Directory -Force $targetDir | Out-Null
New-Item -ItemType Directory -Force $tempDir | Out-Null

$env:PATH = "$mingwBin;$env:PATH"
$env:TEMP = $tempDir
$env:TMP = $tempDir
$env:CARGO_TARGET_DIR = $targetDir
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
$env:CARGO_BUILD_TARGET = "x86_64-pc-windows-gnu"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = Join-Path $mingwBin "x86_64-w64-mingw32-gcc.exe"
$env:CC_x86_64_pc_windows_gnu = Join-Path $mingwBin "x86_64-w64-mingw32-gcc.exe"
$env:CXX_x86_64_pc_windows_gnu = Join-Path $mingwBin "x86_64-w64-mingw32-g++.exe"
$env:AR_x86_64_pc_windows_gnu = Resolve-RequiredTool @(
  "x86_64-w64-mingw32-ar.exe",
  "ar.exe",
  "gcc-ar.exe",
  "x86_64-w64-mingw32-gcc-ar.exe"
)
$env:CARGO_INCREMENTAL = "0"

Set-Location $projectRoot
npx.cmd tauri build --no-bundle --target x86_64-pc-windows-gnu

$deliveredExePath = Copy-WithFallback $exePath (Join-Path $distDir "gui-installer.exe")
$primaryExePath = Join-Path $distDir "gui-installer.exe"
$fallbackExePaths = @(
  (Join-Path $distDir "gui-installer.exe.next"),
  (Join-Path $distDir "gui-installer.next.exe")
)

if (Test-Path $webviewLoaderPath) {
  $deliveredWebViewPath = Copy-WithFallback $webviewLoaderPath (Join-Path $distDir "WebView2Loader.dll")
  $primaryWebViewPath = Join-Path $distDir "WebView2Loader.dll"
  $fallbackWebViewPaths = @(
    (Join-Path $distDir "WebView2Loader.dll.next"),
    (Join-Path $distDir "WebView2Loader.next.dll")
  )

  if ($deliveredWebViewPath -eq $primaryWebViewPath) {
    foreach ($fallbackPath in $fallbackWebViewPaths) {
      Remove-IfExists $fallbackPath
    }
  }
}

foreach ($dllName in @("libgcc_s_seh-1.dll", "libstdc++-6.dll", "libwinpthread-1.dll")) {
  $sourcePath = Join-Path $mingwBin $dllName
  if (Test-Path $sourcePath) {
    Copy-WithFallback $sourcePath (Join-Path $distDir $dllName) | Out-Null
  }
}

$tauriConfig = Get-Content $tauriConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$versionMetadata = @{
  latest_version = $tauriConfig.version
}

if ($env:GUI_INSTALLER_DOWNLOAD_URL) {
  $versionMetadata.download_url = $env:GUI_INSTALLER_DOWNLOAD_URL
}

$versionMetadata | ConvertTo-Json | Set-Content (Join-Path $distDir "app-version.json") -Encoding utf8

$checksumsSource = Join-Path $projectRoot "checksums.json"
if (Test-Path $checksumsSource) {
  Copy-Item $checksumsSource (Join-Path $distDir "checksums.json") -Force
} else {
  Write-Warning "checksums.json not found at $checksumsSource – package integrity verification will be skipped at runtime"
}

if ($deliveredExePath -eq $primaryExePath) {
  foreach ($fallbackPath in $fallbackExePaths) {
    Remove-IfExists $fallbackPath
  }
}

Write-Host "Built GUI installer:"
Get-Item $deliveredExePath | Format-List FullName, Length, LastWriteTime
