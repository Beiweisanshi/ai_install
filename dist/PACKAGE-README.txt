AI Tools Installer Windows Package

Contents:
- gui-installer.exe
- WebView2Loader.dll
- libgcc_s_seh-1.dll
- libstdc++-6.dll
- libwinpthread-1.dll
- app-version.json
- packages\windows\*.msi / *.exe

Usage on a new Windows PC:
1. Extract the whole zip to an ASCII path if possible, for example: D:\ai_tools_installer
2. Keep gui-installer.exe and the packages folder in the same extracted directory
3. Run gui-installer.exe
4. Install Claude CLI / Codex CLI / Gemini CLI requires network access

Notes:
- Do not move gui-installer.exe away from the packages folder
- The installer looks for packages next to the exe
