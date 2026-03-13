# Repository Instructions

## GUI Installer Build Policy

- For `gui-installer` on Windows, always prefer the `WinLibs/MinGW + Rust GNU toolchain + Tauri CLI release build` path.
- Do not default to the `MSVC` / Visual Studio Build Tools path unless the user explicitly asks for it.
- Do not ship a Windows GUI `.exe` produced by plain `cargo build` for this project.
- Reason: direct Cargo builds for this Tauri app can compile with `cfg(dev)` and keep the frontend pointed at `http://localhost:1420`, which makes the released app show a network connection error on startup.
- After any code change that affects this repository, finish by running the relevant build for the changed deliverable.
- After building, remove stale temporary or fallback artifacts that are no longer needed, especially `dist/*.next*` files and obvious root-level `_tmp*` files created during local debugging or verification.

## Standard Windows EXE Build Flow

Run these steps from `D:\work\ai_部署\gui-installer`:

1. Ensure the Rust GNU host toolchain exists:
   - `rustup toolchain install stable-x86_64-pc-windows-gnu`
2. Ensure the Rust GNU target exists:
   - `rustup target add x86_64-pc-windows-gnu`
3. Use the existing local WinLibs toolchain:
   - `D:\ai_tools_tmp\winlibs\mingw64`
4. If the repository path contains non-ASCII characters, force Tauri/Cargo temp output to ASCII-only paths:
   - `D:\ai_tools_tmp\tauri-target`
   - `D:\ai_tools_tmp\tmp-build`
5. Build with the repository script:
   - `powershell -ExecutionPolicy Bypass -File .\build-windows-gnu.ps1`

## Equivalent Manual Build Command

```powershell
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

## Expected Artifact

- Primary raw build artifact:
  - `D:\ai_tools_tmp\tauri-target\x86_64-pc-windows-gnu\release\gui-installer.exe`
- Repo delivery artifact:
  - `D:\work\ai_部署\dist\gui-installer.exe`

## Constraints

- If the GNU toolchain install fails because of disk space, report that clearly before trying any other build path.
- Do not switch back to the `LLVM-MinGW` path that was previously under the WinGet package cache; that location is no longer present on this machine.
- If the repo path contains non-ASCII characters, keep `CARGO_TARGET_DIR`, `TEMP`, and `TMP` on ASCII-only paths or `dlltool.exe` may fail.
- If the app opens and shows a network connection error immediately, first verify the build was produced by `npx tauri build --no-bundle --target x86_64-pc-windows-gnu` and not by plain `cargo build`.
- On Windows, all child processes launched by the Tauri backend must use a hidden-window command helper (`CREATE_NO_WINDOW`) so the GUI app does not pop up terminal windows during detection, install, or config save.
- If a bundled installer is needed later, first produce the raw `.exe` successfully using the GNU Tauri CLI path, then evaluate bundle tooling separately.
