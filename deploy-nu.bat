@echo off

:: 1. 管理员提权（复用 deploy.bat 模式）
net session >nul 2>&1
if %errorlevel% neq 0 (
    fsutil dirty query %systemdrive% >nul 2>&1
    if %errorlevel% neq 0 (
        set "_ELEVATE_BAT=%~f0"
        powershell.exe -NoProfile -Command "$q=[char]34; Start-Process cmd.exe -ArgumentList ('/c '+$q+$env:_ELEVATE_BAT+$q) -Verb RunAs"
        exit /b
    )
)

:: 2. 切换到脚本目录
cd /d "%~dp0"

:: 3. 检测 Nushell
where nu >nul 2>&1
if %errorlevel% equ 0 goto :run_nu

:: 4. 安装 Nushell
echo Installing Nushell...
for %%f in (packages\windows\nushell-*.msi) do (
    msiexec /i "%%f" /qn /norestart
    goto :refresh_path
)
echo ERROR: Nushell installer not found in packages\windows\
pause
exit /b 1

:refresh_path
:: 5. 刷新 PATH
set "PATH=%PATH%;%ProgramFiles%\nu\bin"
:: 等待安装完成
timeout /t 5 /nobreak >nul

:: 6. 验证
where nu >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Nushell installation failed
    pause
    exit /b 1
)

:run_nu
:: 7. 启动 TUI 安装器
nu "%~dp0deploy.nu"
pause
