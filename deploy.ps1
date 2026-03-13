# -*- coding: utf-8-with-signature -*-
#Requires -Version 5.1

<#
.SYNOPSIS
    Windows AI Tool Chain - Auto Deploy (Local Packages)
.DESCRIPTION
    Install Git, Node.js, Claude CLI, Codex CLI, Gemini CLI, CC Switch
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
$script:ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:PkgDir = Join-Path $script:ScriptDir 'packages\windows'

# ============================================================
# Logging
# ============================================================
function Log-Info    { param([string]$M); Write-Host "[$(Get-Date -Format 'HH:mm:ss')] " -ForegroundColor DarkGray -NoNewline; Write-Host "INFO  " -ForegroundColor Cyan -NoNewline; Write-Host $M }
function Log-Success { param([string]$M); Write-Host "[$(Get-Date -Format 'HH:mm:ss')] " -ForegroundColor DarkGray -NoNewline; Write-Host "OK    " -ForegroundColor Green -NoNewline; Write-Host $M }
function Log-Warning { param([string]$M); Write-Host "[$(Get-Date -Format 'HH:mm:ss')] " -ForegroundColor DarkGray -NoNewline; Write-Host "WARN  " -ForegroundColor Yellow -NoNewline; Write-Host $M }
function Log-Error   { param([string]$M); Write-Host "[$(Get-Date -Format 'HH:mm:ss')] " -ForegroundColor DarkGray -NoNewline; Write-Host "ERROR " -ForegroundColor Red -NoNewline; Write-Host $M }

function Record-Result {
    param([string]$Tool, [string]$Version, [bool]$Ok)
    $script:Results[$Tool] = @{ Version = $Version; Ok = $Ok }
    if ($Ok) { $script:SuccessCount++ } else { $script:FailCount++ }
}

# ============================================================
# Banner
# ============================================================
function Show-Banner {
    $banner = @"

================================================================
     AI 工具链 - 自动部署 (本地安装包)
     平台: Windows  |  日期: $(Get-Date -Format 'yyyy-MM-dd')
     安装包: $script:PkgDir
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
    Log-Info "刷新 PATH..."
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
    $extras = @("$env:ProgramFiles\Git\cmd", "$env:ProgramFiles\nodejs", "$env:APPDATA\npm")
    foreach ($p in $extras) {
        if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) {
            $env:Path = "$p;$env:Path"
        }
    }
}

# ============================================================
# Helper: run command with timeout
# Default behavior: only return output when exit code is 0.
# ============================================================
function Invoke-WithTimeout {
    param(
        [string]$Command,
        [string[]]$Arguments,
        [int]$TimeoutSec = 15,
        [switch]$AllowNonZeroExit
    )
    try {
        # Always use cmd.exe /c to run commands - handles .exe, .cmd, .bat uniformly
        # Quote the entire command so cmd.exe passes all arguments correctly
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
# Helper: get tool version with timeout
# ============================================================
function Get-ToolVersion {
    param([string]$Command, [string[]]$VersionArgs = @('--version'))
    # Use cmd.exe /c where to find the command - bypasses PowerShell's stale command cache
    # This is critical: after installing a new tool, Get-Command may not see it
    # even though $env:Path is updated, because PowerShell caches command lookups.
    $whereResult = Invoke-WithTimeout -Command 'where' -Arguments @($Command) -TimeoutSec 5
    if (-not $whereResult) { return $null }
    $raw = Invoke-WithTimeout -Command $Command -Arguments $VersionArgs -TimeoutSec 10
    if (-not $raw) { return $null }
    # Extract clean version number (e.g., "2.53.0", "v22.14.0", "1.2.3")
    $match = [regex]::Match($raw, 'v?(\d+\.\d+\.\d+)')
    if ($match.Success) { return $match.Value }
    return $null
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
# Helper: get npm global package version
# ============================================================
function Get-NpmGlobalPackageVersion {
    param([string]$Package)
    if (-not (Test-CommandExists 'npm')) { return $null }
    $raw = Invoke-WithTimeout -Command 'npm' -Arguments @('ls', '-g', $Package, '--depth=0') -TimeoutSec 20 -AllowNonZeroExit
    if (-not $raw) { return $null }
    $pattern = [regex]::Escape($Package) + '@(\d+\.\d+\.\d+)'
    $match = [regex]::Match($raw, $pattern)
    if ($match.Success) { return $match.Groups[1].Value }
    return $null
}

# ============================================================
# Helper: wait until no installer process is running
# ============================================================
function Wait-InstallerIdle {
    param([int]$TimeoutSec = 120)
    $elapsed = 0
    $interval = 3
    while ($elapsed -lt $TimeoutSec) {
        $busy = Get-Process -Name msiexec, setup, Git-*, node-* -ErrorAction SilentlyContinue |
            Where-Object { $_.Id -ne $PID }
        if (-not $busy) { return }
        Log-Info "安装程序仍在运行 ($(($busy | Select-Object -ExpandProperty Name) -join ', '))... 等待中"
        Start-Sleep -Seconds $interval
        $elapsed += $interval
    }
    Log-Warning "安装进程超过 ${TimeoutSec} 秒仍未结束，继续执行"
}

# ============================================================
# Helper: find local installer by pattern
# ============================================================
function Find-LocalPackage {
    param([string]$Pattern)
    $files = Get-ChildItem -Path $script:PkgDir -Filter $Pattern -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    if ($files) { return $files[0].FullName }
    return $null
}

# ============================================================
# Helper: run installer with timeout
# ============================================================
function Start-Installer {
    param([string]$FilePath, [string]$Arguments, [int]$TimeoutSec = 300, [string]$DisplayName = '')
    Log-Info "启动安装程序: $(Split-Path -Leaf $FilePath)"
    Log-Info "超时时间: ${TimeoutSec}秒"

    $proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
    $elapsed = 0
    $interval = 5

    while (-not $proc.HasExited -and $elapsed -lt $TimeoutSec) {
        Start-Sleep -Seconds $interval
        $elapsed += $interval
        if ($elapsed % 15 -eq 0) {
            Log-Info "$DisplayName 安装中... (已用 ${elapsed}秒)"
        }
    }

    if (-not $proc.HasExited) {
        Log-Warning "$DisplayName 安装超时 (${TimeoutSec}秒)，终止进程"
        $proc.Kill()
        return $false
    }

    $exitCode = $proc.ExitCode
    if ($exitCode -ne 0 -and $exitCode -ne 3010) {
        Log-Warning "$DisplayName 安装程序退出码: $exitCode"
    }
    return $true
}

# ============================================================
# Git - local installer
# ============================================================
function Install-Git {
    Log-Info "=== Git ==="

    $ver = Get-ToolVersion 'git' @('--version')
    if ($ver) {
        Log-Success "Git 已安装: $ver"
        Record-Result 'Git' $ver $true
        return
    }

    $installer = Find-LocalPackage 'Git-*-64-bit.exe'
    if (-not $installer) {
        Log-Error "Git 安装包未找到: $script:PkgDir"
        Log-Error "期望文件: Git-*-64-bit.exe"
        Record-Result 'Git' 'N/A' $false
        return
    }

    Log-Info "从本地安装 Git: $(Split-Path -Leaf $installer)"
    try {
        $ok = Start-Installer -FilePath $installer `
            -Arguments '/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"' `
            -TimeoutSec 120 -DisplayName 'Git'

        if (-not $ok) { throw "安装超时" }

        Wait-InstallerIdle -TimeoutSec 30
        Refresh-Path
        $ver = Get-ToolVersion 'git' @('--version')
        if ($ver) {
            Log-Success "Git 安装完成: $ver"
            Record-Result 'Git' $ver $true
        } else {
            throw "安装后未找到 git"
        }
    } catch {
        Log-Error "Git 安装失败: $_"
        Record-Result 'Git' 'N/A' $false
    }
}

# ============================================================
# Node.js - local installer
# ============================================================
function Install-Node {
    Log-Info "=== Node.js ==="

    $ver = Get-ToolVersion 'node' @('-v')
    if ($ver) {
        $npmVer = Get-ToolVersion 'npm' @('-v')
        if ($npmVer) {
            Log-Success "Node.js 已安装: $ver (npm $npmVer)"
            Record-Result 'Node.js' "$ver (npm $npmVer)" $true
            return
        }
        Log-Warning "检测到 Node.js ($ver) 但 npm 不可用，重新安装"
    }

    $installer = Find-LocalPackage 'node-*-x64.msi'
    if (-not $installer) {
        Log-Error "Node.js 安装包未找到: $script:PkgDir"
        Log-Error "期望文件: node-*-x64.msi"
        Record-Result 'Node.js' 'N/A' $false
        return
    }

    Log-Info "从本地安装 Node.js: $(Split-Path -Leaf $installer)"
    try {
        $ok = Start-Installer -FilePath 'msiexec.exe' `
            -Arguments "/i `"$installer`" /qn /norestart" `
            -TimeoutSec 180 -DisplayName 'Node.js'

        if (-not $ok) { throw "安装超时" }

        # Wait for any lingering installer processes to finish
        Wait-InstallerIdle -TimeoutSec 60

        # Retry 3 times with increasing delays
        $nodePath = "$env:ProgramFiles\nodejs"
        $ver = $null
        $retryDelays = @(5, 10, 15)
        $totalWait = 0
        foreach ($delay in $retryDelays) {
            if ((Test-Path $nodePath) -and ($env:Path -notlike "*$nodePath*")) {
                $env:Path = "$nodePath;$env:Path"
            }
            Refresh-Path
            Log-Info "等待 Node.js 就绪 (${delay}秒)..."
            Start-Sleep -Seconds $delay
            $totalWait += $delay
            $ver = Get-ToolVersion 'node' @('-v')
            if ($ver) { break }
            Log-Info "Node.js 尚未就绪 (已等待 ${totalWait}秒)，重试中..."
        }

        $npmVer = Get-ToolVersion 'npm' @('-v')
        if ($ver -and $npmVer) {
            Log-Success "Node.js 安装完成: $ver (npm $npmVer)"
            Record-Result 'Node.js' "$ver (npm $npmVer)" $true
        } else {
            throw "安装后 node/npm 未就绪 (路径: $nodePath, 已等待 ${totalWait}秒)"
        }
    } catch {
        Log-Error "Node.js 安装失败: $_"
        Record-Result 'Node.js' 'N/A' $false
    }
}

# ============================================================
# npm tool install/update with timeout (Claude, Codex, Gemini)
# ============================================================
function Install-NpmTool {
    param(
        [string]$DisplayName,
        [string]$Command,
        [string]$Package,
        [string[]]$VersionArgs = @('--version'),
        [int]$TimeoutSec = 120
    )

    Log-Info "=== $DisplayName ==="
    $currentVer = Get-ToolVersion $Command $VersionArgs
    if (-not $currentVer) {
        $pkgVer = Get-NpmGlobalPackageVersion -Package $Package
        if ($pkgVer) { $currentVer = $pkgVer }
    }

    # Query latest version
    $latestVer = $null
    try {
        $pkgInfo = Invoke-RestMethod -Uri "https://registry.npmmirror.com/${Package}/latest" -UseBasicParsing -ErrorAction Stop -TimeoutSec 10
        $latestVer = $pkgInfo.version
    } catch {
        Log-Warning "无法查询 $Package 最新版本"
    }

    if ($currentVer -and $latestVer) {
        $currentClean = [regex]::Match($currentVer, '[\d]+\.[\d]+\.[\d]+').Value
        if ($currentClean -eq $latestVer) {
            Log-Success "$DisplayName 已是最新版: $currentVer"
            Record-Result $DisplayName $currentVer $true
            return
        }
        Log-Info "$DisplayName 当前: $currentClean，最新: $latestVer，更新中..."
    } elseif ($currentVer) {
        Log-Warning "无法查询最新版本，保留当前 ${DisplayName}: $currentVer"
        Record-Result $DisplayName $currentVer $true
        return
    } else {
        Log-Info "$DisplayName 未安装，开始安装..."
    }

    if (-not (Test-CommandExists 'npm')) {
        Log-Error "npm 不可用，无法安装 $DisplayName"
        Record-Result $DisplayName 'N/A' $false
        return
    }

    # Run npm install as a process with timeout
    Log-Info "执行: npm install -g ${Package}@latest --registry https://registry.npmmirror.com/"
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'cmd.exe'
    $psi.Arguments = "/c `"npm install -g ${Package}@latest --registry https://registry.npmmirror.com/`""
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
        $elapsed = 0
        $interval = 5

        # Read output in background
        $outTask = $proc.StandardOutput.ReadToEndAsync()
        $errTask = $proc.StandardError.ReadToEndAsync()

        while (-not $proc.HasExited -and $elapsed -lt $TimeoutSec) {
            Start-Sleep -Seconds $interval
            $elapsed += $interval
            Log-Info "  $DisplayName npm 安装中... (已用 ${elapsed}秒)"
        }

        if (-not $proc.HasExited) {
            $proc.Kill()
            Log-Error "$DisplayName npm 安装超时 (${TimeoutSec}秒)"
            Record-Result $DisplayName 'N/A' $false
            return
        }

        [System.Threading.Tasks.Task]::WaitAll(@($outTask, $errTask))
        $npmOutput = $outTask.Result
        $npmError = $errTask.Result

        if ($proc.ExitCode -ne 0) {
            Log-Error "$DisplayName npm 安装失败 (退出码 $($proc.ExitCode))"
            if ($npmError) { Log-Error "  $npmError" }
            Record-Result $DisplayName 'N/A' $false
            return
        }

        if ($npmOutput) { Log-Info "  $npmOutput" }

        Refresh-Path
        $ver = Get-ToolVersion $Command $VersionArgs
        if ($ver) {
            Log-Success "$DisplayName 安装/更新完成: $ver"
            Record-Result $DisplayName $ver $true
        } else {
            Log-Warning "$DisplayName 已安装但版本检查失败（可能需要新终端）"
            Record-Result $DisplayName '已安装' $true
        }
    } catch {
        Log-Error "$DisplayName 安装失败: $_"
        Record-Result $DisplayName 'N/A' $false
    }
}

# ============================================================
# CC Switch - local installer
# ============================================================
function Install-CcSwitch {
    Log-Info "=== CC Switch ==="

    $exePath = "$env:LOCALAPPDATA\Programs\cc-switch\CC Switch.exe"
    if (Test-Path $exePath) {
        Log-Success "CC Switch 已安装"
        Record-Result 'CC Switch' '已安装' $true
        return
    }

    # Check registry
    $regKey = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like '*cc-switch*' -or $_.DisplayName -like '*CC Switch*' }
    if ($regKey) {
        Log-Success "CC Switch 已安装 (注册表)"
        $displayVer = if ($regKey.DisplayVersion) { $regKey.DisplayVersion } else { '已安装' }
        Record-Result 'CC Switch' $displayVer $true
        return
    }

    $installer = Find-LocalPackage 'CC-Switch*.msi'
    if (-not $installer) { $installer = Find-LocalPackage '*cc-switch*.msi' }
    if (-not $installer) { $installer = Find-LocalPackage '*cc-switch*.exe' }
    if (-not $installer) {
        Log-Error "CC Switch 安装包未找到: $script:PkgDir"
        Log-Error "期望文件: CC-Switch*.msi 或 *.exe"
        Record-Result 'CC Switch' 'N/A' $false
        return
    }

    Log-Info "从本地安装 CC Switch: $(Split-Path -Leaf $installer)"
    try {
        if ($installer -match '\.msi$') {
            $ok = Start-Installer -FilePath 'msiexec.exe' `
                -Arguments "/i `"$installer`" /qn /norestart" `
                -TimeoutSec 120 -DisplayName 'CC Switch'
        } else {
            $ok = Start-Installer -FilePath $installer `
                -Arguments '/S' `
                -TimeoutSec 120 -DisplayName 'CC Switch'
        }

        if (-not $ok) { throw "安装超时" }

        Wait-InstallerIdle -TimeoutSec 30
        Log-Success "CC Switch 安装完成"
        Record-Result 'CC Switch' '已安装' $true
    } catch {
        Log-Error "CC Switch 安装失败: $_"
        Record-Result 'CC Switch' 'N/A' $false
    }
}

# ============================================================
# Summary
# ============================================================
function Show-Summary {
    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "                    部署结果" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host ("{0,-16} {1,-8} {2}" -f '工具', '状态', '版本') -ForegroundColor White
    Write-Host ("{0,-16} {1,-8} {2}" -f '----', '----', '----') -ForegroundColor DarkGray

    foreach ($tool in $script:Results.Keys) {
        $r = $script:Results[$tool]
        $status = if ($r.Ok) { '成功' } else { '失败' }
        $color  = if ($r.Ok) { 'Green' } else { 'Red' }
        Write-Host ("{0,-16} " -f $tool) -NoNewline
        Write-Host ("{0,-8} " -f $status) -ForegroundColor $color -NoNewline
        Write-Host $r.Version
    }

    Write-Host ""
    Write-Host "成功: $script:SuccessCount  失败: $script:FailCount" -ForegroundColor $(if ($script:FailCount -eq 0) { 'Green' } else { 'Yellow' })
    Write-Host ""
    if ($script:FailCount -eq 0) {
        Write-Host "所有工具部署成功！" -ForegroundColor Green
    } else {
        Write-Host "部分工具部署失败，请查看上方日志。" -ForegroundColor Yellow
    }
    Write-Host ""
}

# ============================================================
# Main
# ============================================================
function Main {
    Show-Banner
    Assert-Admin

    if (-not (Test-Path $script:PkgDir)) {
        Log-Error "packages\windows\ 目录不存在！"
        Log-Error "期望路径: $script:PkgDir"
        pause
        exit 1
    }

    Log-Info "发现安装包:"
    Get-ChildItem -Path $script:PkgDir -File | ForEach-Object {
        Log-Info "  $($_.Name) ($([math]::Round($_.Length/1MB, 1)) MB)"
    }
    Write-Host ""

    Install-Git
    Refresh-Path

    # Git must be ready before continuing
    if (-not (Test-CommandExists 'git')) {
        Log-Error "Git 不可用，中止部署"
        Show-Summary
        return
    }

    Install-Node
    Refresh-Path

    # Node/npm must be ready before CLI tools
    if ((-not (Test-CommandExists 'node')) -or (-not (Test-CommandExists 'npm'))) {
        Log-Error "Node.js/npm 不可用，跳过 CLI 工具"
        Record-Result 'Claude CLI' 'N/A' $false
        Record-Result 'Codex CLI' 'N/A' $false
        Record-Result 'Gemini CLI' 'N/A' $false
    } else {
        Install-NpmTool -DisplayName 'Claude CLI' -Command 'claude' -Package '@anthropic-ai/claude-code' -VersionArgs @('--version') -TimeoutSec 180
        Install-NpmTool -DisplayName 'Codex CLI'  -Command 'codex'  -Package '@openai/codex'             -VersionArgs @('--version') -TimeoutSec 180
        Install-NpmTool -DisplayName 'Gemini CLI' -Command 'gemini' -Package '@google/gemini-cli'        -VersionArgs @('--version') -TimeoutSec 180
    }

    Install-CcSwitch

    Show-Summary
}

Main
