# ============================================================
# deploy.nu — AI 工具链统一 TUI 安装器
# 编排: Banner → 工具选择 → 安装 → 升级 → 配置 → 汇总
# 所有 7 个工具在同一个 UI 界面中展示 (AC15)
# ============================================================

# source 必须在脚本顶层（Nushell 编译期限制）
source nu/ui.nu
source nu/tools.nu
source nu/upgrade.nu
source nu/config.nu
source nu/install_win.nu
source nu/install_mac.nu

# ── 1. 平台检测 ──────────────────────────────────────────────

let os = $nu.os-info.name
if $os not-in ["windows" "macos"] {
    print $"(ansi red)不支持的操作系统: ($os)，仅支持 Windows 和 macOS(ansi reset)"
    exit 1
}

# ── 2. Nushell 版本检查（最低 0.101）─────────────────────────

let nu_ver = (nu --version | str trim)
let min_ver = "0.101.0"
let ver_parts = ($nu_ver | parse -r '(\d+)\.(\d+)\.(\d+)')
let ver_ok = if ($ver_parts | is-empty) {
    false
} else {
    let p = ($ver_parts | first)
    let major = ($p.capture0 | into int)
    let minor = ($p.capture1 | into int)
    ($major > 0) or ($minor >= 101)
}
if not $ver_ok {
    print $"(ansi red)Nushell 版本过低: ($nu_ver)，需要 >= ($min_ver)(ansi reset)"
    exit 1
}

# ── 3. Banner ────────────────────────────────────────────────

show-banner

# ── 4. 工具列表初始化 + 检测现有状态 ─────────────────────────

let tools = (get-tool-list)

# 构建选择列表: Nushell 展示但不参与选择，其余 6 个可选
let nu_tool = ($tools | where name == "Nushell" | first)
let selectable = ($tools | where name != "Nushell")

# 构建显示项
let display_items = ($selectable | each {|t|
    let detect = (detect-tool $t)
    let suffix = if $detect.installed {
        $" ($detect.version) ✓ 已安装"
    } else {
        ""
    }
    $"($t.name)($suffix)"
})

# ── 5. 工具选择 ──────────────────────────────────────────────

show-section "工具选择"
print $"  Nushell ($nu_ver) ✓ 已安装（基础运行时）"
print ""
print "  请选择要安装/检查的工具（空格切换，Enter 确认）:"
print ""

mut selected = []
loop {
    let chosen = ($display_items | input list --multi)
    if ($chosen | is-empty) {
        print "  ⚠ 至少选择一个工具，请重新选择"
    } else {
        $selected = $chosen
        break
    }
}

# 从显示名还原工具名（截取到第一个空格或取整个字符串）
let selected_names = ($selected | each {|s|
    let parts = ($s | split row " ")
    $parts | first
})

# ── 6. 统一进度条安装循环 ────────────────────────────────────

show-section "安装进度"

let total = 1 + ($selected_names | length)  # Nushell 算第 1 项
mut results = []

# Nushell 作为第一项，立即显示完成
show-progress 1 $total $"Nushell ($nu_ver) ✓"
$results = ($results | append {
    name: "Nushell"
    version: $nu_ver
    status: "ok"
    ok: true
})

# 逐个安装选中的工具
mut done = 1
for tool_name in $selected_names {
    $done = $done + 1
    show-progress $done $total $"正在安装 ($tool_name)..."

    # 查找工具定义
    let tool_def = ($tools | where name == $tool_name | first)
    let detect = (detect-tool $tool_def)

    let result = if $detect.installed {
        # 已安装，跳过
        {ok: true, version: $detect.version, msg: $"($tool_name) 已安装"}
    } else if ($tool_def.npm_pkg != null) {
        # npm 工具
        install-npm-tool $tool_def.name $tool_def.npm_pkg $tool_def.cmd $tool_def.version_args
    } else {
        # 本地包工具 — 按平台分发
        if $os == "windows" {
            let r = (dispatch-install-win $tool_name)
            # Windows 每次安装后刷新 PATH
            refresh-path-win
            $r
        } else {
            dispatch-install-mac $tool_name
        }
    }

    let final_ver = if ($result.version? | default "" | is-empty) {
        # 安装后重新检测
        let re = (detect-tool $tool_def)
        $re.version
    } else {
        $result.version
    }

    let status = if $result.ok { "ok" } else { "fail" }

    $results = ($results | append {
        name: $tool_name
        version: $final_ver
        status: $status
        ok: $result.ok
    })

    # 更新进度条
    let label = if $result.ok { "✓" } else { "✗" }
    show-progress $done $total $"($tool_name) ($label)"
}

# 进度条后换行
print ""
print ""

# 显示所有工具状态
for r in $results {
    show-tool-status $r.name ($r.version | into string) $r.status
}

# ── 7. 版本检测 + 升级 ───────────────────────────────────────

show-section "版本检查"

# 构建 check-upgrades 需要的输入格式
let installed_tools = ($results | each {|r|
    let tool_def = ($tools | where name == $r.name)
    let def = if ($tool_def | is-empty) { null } else { $tool_def | first }
    {
        name: $r.name
        installed: $r.ok
        version: $r.version
        npm_pkg: (if $def != null { $def.npm_pkg? | default "" } else { "" })
        cmd: (if $def != null { $def.cmd? | default "" } else { "" })
        version_args: (if $def != null { $def.version_args? | default [] } else { [] })
    }
})

let upgradable = (check-upgrades $installed_tools)
let has_upgrades = ($upgradable | where upgradable == true | length) > 0

if $has_upgrades {
    print "  发现可升级的工具:"
    for u in ($upgradable | where upgradable == true) {
        print $"    ($u.name): ($u.current) → ($u.latest)"
    }
    print ""
    let confirm = (input "  是否立即升级？(y/N): " | str trim | str downcase)
    if $confirm == "y" or $confirm == "yes" {
        let upgrade_results = (upgrade-all $upgradable $os)
        for ur in $upgrade_results {
            let icon = if $ur.ok { "✓" } else { "✗" }
            print $"  ($icon) ($ur.name): ($ur.msg)"
        }
        # 合并升级结果到 results
        $results = ($results | each {|r|
            let upgraded = ($upgrade_results | where name == $r.name)
            if ($upgraded | is-empty) {
                $r
            } else {
                let u = ($upgraded | first)
                let new_ver = if ($u.version | is-empty) { $r.version } else { $u.version }
                {
                    name: $r.name
                    version: $new_ver
                    status: (if $u.ok { "upgraded" } else { $r.status })
                    ok: ($r.ok or $u.ok)
                }
            }
        })
    } else {
        print "  跳过升级"
    }
} else {
    print "  所有工具已是最新版本 ✓"
}

# ── 8. 配置引导 ──────────────────────────────────────────────

run-config-guide

# ── 9. 部署结果 ──────────────────────────────────────────────

show-section "部署结果"
show-summary-table $results

# ── 10. 使用指南 ─────────────────────────────────────────────

show-section "使用指南"
show-usage-guide
