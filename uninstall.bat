@echo off

:: Admin check - use fsutil as fallback for net session
net session >nul 2>&1
if %errorlevel% neq 0 (
    fsutil dirty query %systemdrive% >nul 2>&1
    if %errorlevel% neq 0 (
        set "_ELEVATE_BAT=%~f0"
        powershell.exe -NoProfile -Command "$q=[char]34; Start-Process cmd.exe -ArgumentList ('/c '+$q+$env:_ELEVATE_BAT+$q) -Verb RunAs"
        exit /b
    )
)

cd /d "%~dp0"

echo ========================================
echo   AI Tool Chain - Uninstall
echo ========================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"

echo.
echo ========================================
echo   Done
echo ========================================
pause
