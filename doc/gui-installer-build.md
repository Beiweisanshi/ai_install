# GUI Installer Build Notes

## Recommended Windows Build Path

This project should build the Tauri GUI on Windows through `WinLibs/MinGW`, the Rust GNU toolchain, and `Tauri CLI`, not through `MSVC`, unless explicitly requested otherwise.

## Root Cause Of The Network Error

Using plain `cargo build --manifest-path src-tauri/Cargo.toml --release --target x86_64-pc-windows-gnu` can produce a Tauri binary compiled with `cfg(dev)`.

That binary may still point to the frontend dev server at `http://localhost:1420`, so opening the shipped `.exe` shows a network connection error even though the machine itself is online.

To avoid this permanently, release builds for this app must go through `npx tauri build --no-bundle --target x86_64-pc-windows-gnu`.

## Why

- The machine already has a working `WinLibs` tree at `D:\ai_tools_tmp\winlibs\mingw64`.
- The Tauri Rust build script already contains a `windows-gnu` branch.
- This avoids the `link.exe` dependency from Visual Studio Build Tools.
- The repository path contains non-ASCII characters, so Cargo output and temp paths must stay on ASCII-only directories for `dlltool.exe`.
- Tauri CLI produces the correct release context for the embedded frontend instead of a dev-server-dependent binary.

## Preferred Command

Run in `D:\work\ai_部署\gui-installer`:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows-gnu.ps1
```

## Equivalent Manual Command

```powershell
rustup toolchain install stable-x86_64-pc-windows-gnu
rustup target add x86_64-pc-windows-gnu

$mingw = 'D:\ai_tools_tmp\winlibs\mingw64'
$bin = Join-Path $mingw 'bin'
$null = New-Item -ItemType Directory -Force 'D:\ai_tools_tmp\tmp-build'
$null = New-Item -ItemType Directory -Force 'D:\ai_tools_tmp\tauri-target'

$env:PATH = "$bin;$env:PATH"
$env:TEMP = 'D:\ai_tools_tmp\tmp-build'
$env:TMP = 'D:\ai_tools_tmp\tmp-build'
$env:CARGO_TARGET_DIR = 'D:\ai_tools_tmp\tauri-target'
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
$env:CARGO_BUILD_TARGET = 'x86_64-pc-windows-gnu'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = Join-Path $bin 'x86_64-w64-mingw32-gcc.exe'
$env:CC_x86_64_pc_windows_gnu = Join-Path $bin 'x86_64-w64-mingw32-gcc.exe'
$env:CXX_x86_64_pc_windows_gnu = Join-Path $bin 'x86_64-w64-mingw32-g++.exe'
$env:AR_x86_64_pc_windows_gnu = Join-Path $bin 'x86_64-w64-mingw32-ar.exe'
$env:CARGO_INCREMENTAL = '0'

npx.cmd tauri build --no-bundle --target x86_64-pc-windows-gnu

Copy-Item 'D:\ai_tools_tmp\tauri-target\x86_64-pc-windows-gnu\release\gui-installer.exe' 'D:\work\ai_部署\dist\gui-installer.exe' -Force
Copy-Item 'D:\ai_tools_tmp\tauri-target\x86_64-pc-windows-gnu\release\WebView2Loader.dll' 'D:\work\ai_部署\dist\' -Force
```

## Output

Successful builds should produce:

- Raw build output: `D:\ai_tools_tmp\tauri-target\x86_64-pc-windows-gnu\release\gui-installer.exe`
- Deliverable copy: `D:\work\ai_部署\dist\gui-installer.exe`



## macOS Build Path

macOS GUI packages must be built on a Mac. Tauri's DMG flow runs the macOS native bundler and should not be treated as a Windows cross-compile target.

Run in `gui-installer/` on macOS:

```bash
npm run build:macos
```

For a universal Apple Silicon + Intel package, install both Rust Apple targets on the Mac and run:

```bash
MACOS_TARGET=universal-apple-darwin npm run build:macos
```

Equivalent direct command:

```bash
npx tauri build --bundles dmg
```

The repository script copies the generated DMG to `dist/`, writes `dist/app-version.json`, copies `gui-installer/checksums.json` when present, and removes stale `dist/*.next*` / `dist/_tmp*` artifacts.

Expected macOS output:

- Raw Tauri bundle: `gui-installer/src-tauri/target/release/bundle/dmg/*.dmg`
- Deliverable copy: `dist/zm_tools-0.1.0-macos-<arch|universal>.dmg`

When shipping local dependency packages with the app, place `packages/` next to `zm_tools.app` after installation or next to the app bundle before first run. The backend also checks `zm_tools.app/Contents/Resources/packages` for bundled resources.


## Version Banner Metadata

The GUI now shows the installer's current version and the latest available version.

- Local fallback metadata file: `dist/app-version.json`
- Supported JSON shape: `{"latest_version":"0.1.0","download_url":"https://example.com/gui-installer.exe"}`
- Optional remote metadata source: set `GUI_INSTALLER_VERSION_URL` before launching the app
- Optional local override path: set `GUI_INSTALLER_VERSION_FILE` before launching the app

## Known Failure Modes

If `rustup toolchain install stable-x86_64-pc-windows-gnu` fails with `os error 112`, the machine does not have enough free disk space to install the GNU host toolchain.

If Cargo writes to a path containing non-ASCII characters, `dlltool.exe` may fail while creating import libraries. Keep `CARGO_TARGET_DIR`, `TEMP`, and `TMP` on ASCII-only paths.

If the app opens and immediately reports that it cannot connect to the network, check whether someone used plain `cargo build` instead of `npx tauri build`.

If the GUI app starts correctly but terminal windows flash during detect/install/config steps, check whether new Windows backend commands were added without the hidden-window helper in `src-tauri/src/installer/windows.rs`.
