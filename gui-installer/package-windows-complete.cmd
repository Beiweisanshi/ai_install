@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_ROOT=%%~fI"
set "DIST_DIR=%REPO_ROOT%\dist"
set "PACKAGE_ROOT=%DIST_DIR%\package-windows"
set "PACKAGE_PACKAGES=%PACKAGE_ROOT%\packages\windows"
set "ZIP_PATH=%DIST_DIR%\ai-tools-installer-windows-complete.zip"

if exist "%PACKAGE_ROOT%" rmdir /s /q "%PACKAGE_ROOT%"
if exist "%ZIP_PATH%" del /f /q "%ZIP_PATH%"

mkdir "%PACKAGE_PACKAGES%" || exit /b 1

copy /y "%DIST_DIR%\gui-installer.exe" "%PACKAGE_ROOT%\" >nul || exit /b 1
copy /y "%DIST_DIR%\WebView2Loader.dll" "%PACKAGE_ROOT%\" >nul || exit /b 1
copy /y "%DIST_DIR%\libgcc_s_seh-1.dll" "%PACKAGE_ROOT%\" >nul || exit /b 1
copy /y "%DIST_DIR%\libstdc++-6.dll" "%PACKAGE_ROOT%\" >nul || exit /b 1
copy /y "%DIST_DIR%\libwinpthread-1.dll" "%PACKAGE_ROOT%\" >nul || exit /b 1
copy /y "%DIST_DIR%\app-version.json" "%PACKAGE_ROOT%\" >nul || exit /b 1
copy /y "%DIST_DIR%\checksums.json" "%PACKAGE_ROOT%\" >nul || exit /b 1
copy /y "%DIST_DIR%\PACKAGE-README.txt" "%PACKAGE_ROOT%\" >nul || exit /b 1
copy /y "%REPO_ROOT%\packages\windows\*" "%PACKAGE_PACKAGES%\" >nul || exit /b 1

tar.exe -a -c -f "%ZIP_PATH%" -C "%PACKAGE_ROOT%" . || exit /b 1

echo Created package:
echo %ZIP_PATH%
