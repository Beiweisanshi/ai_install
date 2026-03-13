# -*- coding: utf-8-with-signature -*-
#Requires -Version 5.1

<#
.SYNOPSIS
    Windows AI Tool Chain - Uninstall
.DESCRIPTION
    Uninstall Claude CLI, Codex CLI, Gemini CLI, CC Switch, Node.js, Git
.NOTES
    Requires admin privileges
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ============================================================
# Global state
# ============================================================
$script:Results = [ordered]@{}
$script:FailCount = 0
$script:SuccessCount = 0
$script:SkipCount = 0

# ============================================================
# Logging
# ============================================================
function Log-Info    { param([string]$M); Write-Host "[$(Get-Date -Format 'HH:mm:ss')] " -ForegroundColor DarkGray -NoNewline; Write-Host "INFO  " -ForegroundColor Cyan -NoNewline; Write-Host $M }
function Log-Success { param([string]$M); Write-Host "[$(Get-Date -Format 'HH:mm:ss')] " -ForegroundColor DarkGray -NoNewline; Write-Host "OK    " -ForegroundColor Green -NoNewline; Write-Host $M }
function Log-Warning { param([string]$M); Write-Host "[$(Get-Date -Format 'HH:mm:ss')] " -ForegroundColor DarkGray -NoNewline; Write-Host "WARN  " -ForegroundColor Yellow -NoNewline; Write-Host $M }
function Log-Error   { param([string]$M); Write-Host "[$(Get-Date -Format 'HH:mm:ss')] " -ForegroundColor DarkGray -NoNewline; Write-Host "ERROR " -ForegroundColor Red -NoNewline; Write-Host $M }

function Record-Result {
    param([string]$Tool, [string]$Status, [bool]$Ok)
    $script:Results[$Tool] = @{ Status = $Status; Ok = $Ok }
    if ($Ok) { $script:SuccessCount++ } else { $script:FailCount++ }
}

function Record-Skip {
    param([string]$Tool)
    $script:Results[$Tool] = @{ Status = '未安装'; Ok = $true }
    $script:SkipCount++
}

# ============================================================
# Banner
# ============================================================
function Show-Banner {
    $banner = @"

================================================================
     AI 工具链 - 卸载
     平台: Windows  |  日期: $(Get-Date -Format 'yyyy-MM-dd')
================================================================

"@
    Write-Host $banner -ForegroundColor Cyan
}

# ============================================================
# Admin check
# ============================================================
function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Log-Error "需要管理员权限，请右键 PowerShell -> 以管理员身份运行"
        pause
        exit 1
    }
    Log-Info "已确认管理员权限"
}

# ============================================================
# PATH refresh
# ============================================================
function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}

# ============================================================
# Helper: run command with timeout
# ============================================================
function Invoke-WithTimeout {
    param(
        [string]$Command,
        [string[]]$Arguments,
        [int]$TimeoutSec = 15,
        [switch]$AllowNonZeroExit
    )
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = 'cmd.exe'
        $argString = $Arguments -join ' '
        $psi.Arguments = "/c `"$Command $argString`""
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true

        $proc = [System.Diagnostics.Process]::Start($psi)
        $stdout = $proc.StandardOutput.ReadToEndAsync()
        $stderr = $proc.StandardError.ReadToEndAsync()

        if (-not $proc.WaitForExit($TimeoutSec * 1000)) {
            $proc.Kill()
            Log-Warning "$Command 超时 (${TimeoutSec}秒)"
            return $null
        }

        [System.Threading.Tasks.Task]::WaitAll(@($stdout, $stderr))
        if (-not $AllowNonZeroExit -and $proc.ExitCode -ne 0) {
            return $null
        }

        $output = $stdout.Result.Trim()
        if ($output) { return $output }
        $errOut = $stderr.Result.Trim()
        if ($errOut) { return $errOut }
        return $null
    } catch {
        return $null
    }
}

# ============================================================
# Helper: wait until no installer process is running
# ============================================================
function Wait-InstallerIdle {
    param([int]$TimeoutSec = 60)
    $elapsed = 0
    $interval = 3
    while ($elapsed -lt $TimeoutSec) {
        # Filter out the msiexec service process (/V flag) which lingers after uninstall
        $busy = Get-Process -Name msiexec, setup, Git-*, node-* -ErrorAction SilentlyContinue |
            Where-Object { $_.Id -ne $PID } |
            Where-Object {
                try {
                    $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
                    # msiexec /V is the service host — not an active installer
                    $cmdLine -and $cmdLine -notmatch '/V\b'
                } catch { $true }
            }
        if (-not $busy) { return }
        Log-Info "卸载程序仍在运行 ($(($busy | Select-Object -ExpandProperty Name) -join ', '))... 等待中"
        Start-Sleep -Seconds $interval
        $elapsed += $interval
    }
    Log-Warning "卸载进程超过 ${TimeoutSec} 秒仍未结束，继续执行"
}

# ============================================================
# Helper: check if command exists (bypass PowerShell cache)
# ============================================================
function Test-CommandExists {
    param([string]$Command)
    $result = Invoke-WithTimeout -Command 'where' -Arguments @($Command) -TimeoutSec 5
    return [bool]$result
}

# ============================================================
# Helper: check npm global package existence
# ============================================================
function Test-NpmGlobalPackageInstalled {
    param([string]$Package)
    if (-not (Test-CommandExists 'npm')) { return $false }
    $result = Invoke-WithTimeout -Command 'npm' -Arguments @('ls', '-g', $Package, '--depth=0') -TimeoutSec 30
    return [bool]$result
}

# ============================================================
# Helper: find uninstall string from registry
# ============================================================
function Find-UninstallEntry {
    param([string]$DisplayNamePattern)
    $paths = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($regPath in $paths) {
        $entry = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like $DisplayNamePattern }
        if ($entry) { return $entry | Select-Object -First 1 }
    }
    return $null
}

# ============================================================
# Helper: find Git for Windows uninstall entry safely
# ============================================================
function Find-GitUninstallEntry {
    $paths = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($regPath in $paths) {
        $entry = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue |
            Where-Object {
                ($_.DisplayName -eq 'Git') -or
                ($_.DisplayName -like 'Git version*') -or
                ($_.UninstallString -match '\\Git\\unins\d+\.exe') -or
                ($_.QuietUninstallString -match '\\Git\\unins\d+\.exe')
            } |
            Select-Object -First 1
        if ($entry) { return $entry }
    }
    return $null
}

# ============================================================
# 1. Claude CLI
# ============================================================
function Uninstall-ClaudeCli {
    Log-Info "=== Claude CLI ==="
    if ((-not (Test-CommandExists 'claude')) -and (-not (Test-NpmGlobalPackageInstalled '@anthropic-ai/claude-code'))) {
        Log-Info "Claude CLI 未安装，跳过"
        Record-Skip 'Claude CLI'
        return
    }

    Log-Info "执行: npm uninstall -g @anthropic-ai/claude-code"
    $result = Invoke-WithTimeout -Command 'npm' -Arguments @('uninstall', '-g', '@anthropic-ai/claude-code') -TimeoutSec 60
    if ($result) { Log-Info "  $result" }

    Refresh-Path
    if (Test-NpmGlobalPackageInstalled '@anthropic-ai/claude-code') {
        Log-Error "Claude CLI 卸载后仍存在"
        Record-Result 'Claude CLI' '失败' $false
    } else {
        if (Test-CommandExists 'claude') { Log-Warning "claude 命令仍在 PATH 中（可能是残留），包已移除" }
        Log-Success "Claude CLI 已卸载"
        Record-Result 'Claude CLI' '已卸载' $true
    }
}

# ============================================================
# 2. Codex CLI
# ============================================================
function Uninstall-CodexCli {
    Log-Info "=== Codex CLI ==="
    if ((-not (Test-CommandExists 'codex')) -and (-not (Test-NpmGlobalPackageInstalled '@openai/codex'))) {
        Log-Info "Codex CLI 未安装，跳过"
        Record-Skip 'Codex CLI'
        return
    }

    Log-Info "执行: npm uninstall -g @openai/codex"
    $result = Invoke-WithTimeout -Command 'npm' -Arguments @('uninstall', '-g', '@openai/codex') -TimeoutSec 60
    if ($result) { Log-Info "  $result" }

    Refresh-Path
    if (Test-NpmGlobalPackageInstalled '@openai/codex') {
        Log-Error "Codex CLI 卸载后仍存在"
        Record-Result 'Codex CLI' '失败' $false
    } else {
        if (Test-CommandExists 'codex') { Log-Warning "codex 命令仍在 PATH 中（可能是残留），包已移除" }
        Log-Success "Codex CLI 已卸载"
        Record-Result 'Codex CLI' '已卸载' $true
    }
}

# ============================================================
# 3. Gemini CLI
# ============================================================
function Uninstall-GeminiCli {
    Log-Info "=== Gemini CLI ==="
    if ((-not (Test-CommandExists 'gemini')) -and (-not (Test-NpmGlobalPackageInstalled '@google/gemini-cli'))) {
        Log-Info "Gemini CLI 未安装，跳过"
        Record-Skip 'Gemini CLI'
        return
    }

    Log-Info "执行: npm uninstall -g @google/gemini-cli"
    $result = Invoke-WithTimeout -Command 'npm' -Arguments @('uninstall', '-g', '@google/gemini-cli') -TimeoutSec 60
    if ($result) { Log-Info "  $result" }

    Refresh-Path
    if (Test-NpmGlobalPackageInstalled '@google/gemini-cli') {
        Log-Error "Gemini CLI 卸载后仍存在"
        Record-Result 'Gemini CLI' '失败' $false
    } else {
        if (Test-CommandExists 'gemini') { Log-Warning "gemini 命令仍在 PATH 中（可能是残留），包已移除" }
        Log-Success "Gemini CLI 已卸载"
        Record-Result 'Gemini CLI' '已卸载' $true
    }
}

# ============================================================
# 4. CC Switch
# ============================================================
function Uninstall-CcSwitch {
    Log-Info "=== CC Switch ==="

    $entry = Find-UninstallEntry '*cc-switch*'
    if (-not $entry) { $entry = Find-UninstallEntry '*CC Switch*' }

    if (-not $entry) {
        # Also check the exe directly
        $exePath = "$env:LOCALAPPDATA\Programs\cc-switch\CC Switch.exe"
        if (-not (Test-Path $exePath)) {
            Log-Info "CC Switch 未安装，跳过"
            Record-Skip 'CC Switch'
            return
        }
    }

    if ($entry) {
        $uninstallCmd = $entry.UninstallString
        if (-not $uninstallCmd) { $uninstallCmd = $entry.QuietUninstallString }

        if ($uninstallCmd -match 'msiexec') {
            # Extract product code from uninstall string
            $productCode = [regex]::Match($uninstallCmd, '\{[0-9A-Fa-f\-]+\}').Value
            if ($productCode) {
                Log-Info "通过 msiexec /x $productCode 卸载 CC Switch"
                $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList "/x $productCode /qn /norestart" -PassThru -Wait
                Wait-InstallerIdle -TimeoutSec 60
            } else {
                Log-Info "执行卸载命令: $uninstallCmd"
                Start-Process cmd.exe -ArgumentList "/c `"$uninstallCmd /qn`"" -Wait
                Wait-InstallerIdle -TimeoutSec 60
            }
        } else {
            Log-Info "执行卸载命令: $uninstallCmd"
            Start-Process cmd.exe -ArgumentList "/c `"$uninstallCmd /S`"" -Wait
            Wait-InstallerIdle -TimeoutSec 60
        }
    } else {
        # No registry entry but exe exists — try to remove the directory
        $installDir = "$env:LOCALAPPDATA\Programs\cc-switch"
        if (Test-Path $installDir) {
            Log-Info "删除 CC Switch 目录: $installDir"
            Remove-Item -Path $installDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    # Verify
    $stillExists = (Find-UninstallEntry '*cc-switch*') -or (Find-UninstallEntry '*CC Switch*') -or
                   (Test-Path "$env:LOCALAPPDATA\Programs\cc-switch\CC Switch.exe")
    if ($stillExists) {
        Log-Warning "CC Switch 可能未完全卸载"
        Record-Result 'CC Switch' '部分卸载' $false
    } else {
        Log-Success "CC Switch 已卸载"
        Record-Result 'CC Switch' '已卸载' $true
    }
}

# ============================================================
# 5. Node.js
# ============================================================
function Uninstall-Node {
    Log-Info "=== Node.js ==="

    $entry = Find-UninstallEntry '*Node.js*'
    if (-not $entry) {
        if (-not (Test-CommandExists 'node')) {
            Log-Info "Node.js 未安装，跳过"
            Record-Skip 'Node.js'
            return
        }
    }

    if ($entry) {
        $uninstallCmd = $entry.UninstallString
        $productCode = [regex]::Match($uninstallCmd, '\{[0-9A-Fa-f\-]+\}').Value
        if ($productCode) {
            Log-Info "通过 msiexec /x $productCode 卸载 Node.js"
            $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList "/x $productCode /qn /norestart" -PassThru -Wait
        } else {
            Log-Info "执行卸载命令: $uninstallCmd"
            Start-Process cmd.exe -ArgumentList "/c `"$uninstallCmd /qn`"" -Wait
        }
        Wait-InstallerIdle -TimeoutSec 60
    } else {
        Log-Warning "检测到 Node.js 但未找到注册表卸载项"
        Record-Result 'Node.js' '需手动卸载' $false
        return
    }

    Refresh-Path
    if (Test-CommandExists 'node') { Log-Warning "Node.js 卸载后仍存在"; Record-Result 'Node.js' '部分卸载' $false }
    else { Log-Success "Node.js 已卸载"; Record-Result 'Node.js' '已卸载' $true }
}

# ============================================================
# 6. Git
# ============================================================
function Uninstall-Git {
    Log-Info "=== Git ==="

    $uninstaller = "$env:ProgramFiles\Git\unins000.exe"
    $gitEntry = $null
    if (-not (Test-Path $uninstaller)) {
        $gitEntry = Find-GitUninstallEntry
        if (-not $gitEntry) {
            if (-not (Test-CommandExists 'git')) {
                Log-Info "Git 未安装，跳过"
                Record-Skip 'Git'
                return
            }
            Log-Warning "检测到 Git 但未找到卸载项"
            Record-Result 'Git' '需手动卸载' $false
            return
        }
    }

    if (Test-Path $uninstaller) {
        Log-Info "执行 Git 卸载程序: $uninstaller /VERYSILENT"
        Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT' -Wait
    } else {
        $uninstallCmd = if ($gitEntry.QuietUninstallString) { $gitEntry.QuietUninstallString } else { $gitEntry.UninstallString }
        if (-not $uninstallCmd) {
            Log-Warning "注册表中未找到 Git 卸载命令"
            Record-Result 'Git' '需手动卸载' $false
            return
        }
        Log-Info "从注册表执行 Git 卸载命令"
        Start-Process cmd.exe -ArgumentList "/c `"$uninstallCmd`"" -Wait
    }
    Wait-InstallerIdle -TimeoutSec 60

    Refresh-Path
    if (Test-CommandExists 'git') { Log-Warning "Git 卸载后仍存在"; Record-Result 'Git' '部分卸载' $false }
    else { Log-Success "Git 已卸载"; Record-Result 'Git' '已卸载' $true }
}

# ============================================================
# Summary
# ============================================================
function Show-Summary {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "                    卸载结果" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host ("{0,-16} {1,-16}" -f '工具', '结果') -ForegroundColor White
    Write-Host ("{0,-16} {1,-16}" -f '----', '----') -ForegroundColor DarkGray

    foreach ($tool in $script:Results.Keys) {
        $r = $script:Results[$tool]
        $color = if ($r.Ok) { 'Green' } else { 'Red' }
        Write-Host ("{0,-16} " -f $tool) -NoNewline
        Write-Host $r.Status -ForegroundColor $color
    }

    Write-Host ""
    $removed = $script:SuccessCount
    $failed = $script:FailCount
    $skipped = $script:SkipCount
    Write-Host "已卸载: $removed  失败: $failed  跳过: $skipped" -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Yellow' })
    Write-Host ""
    if ($failed -eq 0) {
        Write-Host "卸载全部完成！" -ForegroundColor Green
    } else {
        Write-Host "部分工具未能完全卸载，请查看上方日志。" -ForegroundColor Yellow
    }
    Write-Host ""
}

# ============================================================
# Main
# ============================================================
function Main {
    Show-Banner
    Assert-Admin

    Write-Host ""
    Write-Host "即将卸载以下工具:" -ForegroundColor Yellow
    Write-Host "  - Claude CLI, Codex CLI, Gemini CLI (npm 全局包)" -ForegroundColor Yellow
    Write-Host "  - CC Switch" -ForegroundColor Yellow
    Write-Host "  - Node.js" -ForegroundColor Yellow
    Write-Host "  - Git" -ForegroundColor Yellow
    Write-Host ""

    $confirm = Read-Host "是否继续？[y/N]"
    if ($confirm -notmatch '^[yY]') {
        Write-Host "已取消。" -ForegroundColor DarkGray
        return
    }

    Write-Host ""

    # Uninstall in reverse order of install
    Uninstall-ClaudeCli
    Uninstall-CodexCli
    Uninstall-GeminiCli
    Uninstall-CcSwitch
    Uninstall-Node
    Uninstall-Git

    Refresh-Path
    Show-Summary
}

Main
