# ============================================================
# UI 模块 — TUI 渲染函数 (纯渲染，无 I/O)
# Claude 官网深色主题风格
# ============================================================

# 全局主题常量
const THEME = {
    accent: "#E87B35"
    accent2: "#D4A574"
    success: "#4CAF50"
    error: "#F44336"
    warning: "#FFC107"
    dim: "dark_gray"
    border: "dark_gray"
}

# 状态图标
const ICONS = {
    ok: "✓"
    fail: "✗"
    running: "◐"
    pending: "○"
    upgrade: "↑"
}

# ── 内部辅助 ─────────────────────────────────────────────────

def repeat-char [char: string, count: int] {
    if $count <= 0 { "" } else {
        0..<$count | each { $char } | str join ""
    }
}

def paint [text: string, color: string] {
    $"(ansi {fg: $color})($text)(ansi reset)"
}

def pad-right [text: string, width: int] {
    let raw = ($text | into string)
    let len = ($raw | str length)
    if $len >= $width {
        $raw | str substring 0..<$width
    } else {
        $"($raw)(repeat-char ' ' ($width - $len))"
    }
}

def status-icon [status: string] {
    match $status {
        "ok" | "latest" => $ICONS.ok
        "fail" => $ICONS.fail
        "running" => $ICONS.running
        "pending" => $ICONS.pending
        "upgraded" => $ICONS.upgrade
        _ => $ICONS.pending
    }
}

def status-color [status: string] {
    match $status {
        "ok" | "latest" => $THEME.success
        "fail" => $THEME.error
        "running" | "upgraded" => $THEME.warning
        "pending" => $THEME.dim
        _ => $THEME.dim
    }
}

def status-label [status: string] {
    match $status {
        "ok" => "已安装"
        "fail" => "安装失败"
        "running" => "安装中..."
        "pending" => "待安装"
        "latest" => "已是最新"
        "upgraded" => "已升级"
        _ => "未知"
    }
}

# ── 公开函数 ─────────────────────────────────────────────────

# ASCII art banner + 项目信息 + 平台 + 日期
def show-banner [] {
    let a = $THEME.accent
    let lines = [
        "    _    ___   _____           _       "
        "   / \\  |_ _| |_   _|__   ___ | |___   "
        "  / _ \\  | |    | |/ _ \\ / _ \\| / __|  "
        " / ___ \\ | |    | | (_) | (_) | \\__ \\  "
        "/_/   \\_\\___|   |_|\\___/ \\___/|_|___/  "
    ]
    for line in $lines {
        print (paint $line $a)
    }
    print ""
    print (paint "  AI 工具链 - 自动部署" $a)
    print (paint "  (Nushell TUI Installer)" $THEME.accent2)
    print ""
    let platform = $nu.os-info.name
    let today = (date now | format date "%Y-%m-%d")
    print $"  平台: ($platform)    日期: ($today)"
    print ""
}

# ━━━━ 分隔线 + ▸ 前缀章节标题
def show-section [title: string] {
    print ""
    print $"(ansi {fg: ($THEME.border)})(repeat-char '━' 60)(ansi reset)"
    print (paint $"  ▸ ($title)" $THEME.accent)
    print ""
}

# 进度条 [████████░░░░] done/total msg — 单行覆盖
def show-progress [done: int, total: int, msg: string] {
    let bar_w = 24
    let safe_total = if $total <= 0 { 1 } else { $total }
    let filled = ([$bar_w, ([0, (($done * $bar_w) / $safe_total)] | math max)] | math min | into int)
    let empty = ($bar_w - $filled)
    let bar_done = (paint (repeat-char "█" $filled) $THEME.accent)
    let bar_todo = (paint (repeat-char "░" $empty) $THEME.dim)
    print -n $"\r(ansi erase_entire_line)  [($bar_done)($bar_todo)] ($done)/($total) ($msg)"
}

# 工具状态行 — 固定宽度: 名称 16, 版本 16
def show-tool-status [name: string, version: string, status: string] {
    let icon = (status-icon $status)
    let color = (status-color $status)
    let label = (status-label $status)
    let n = (pad-right $name 16)
    let v = (pad-right $version 16)
    print (paint $"  ($icon) ($n)($v)($label)" $color)
}

# 汇总表格 — Unicode box-drawing 边框
def show-summary-table [results: list<record>] {
    let tw = 20
    let vw = 16
    let sw = 14

    let h_tool = (repeat-char "─" ($tw + 2))
    let h_ver = (repeat-char "─" ($vw + 2))
    let h_stat = (repeat-char "─" ($sw + 2))

    print $"  ┌($h_tool)┬($h_ver)┬($h_stat)┐"
    print (paint $"  │ (pad-right '工具' $tw) │ (pad-right '版本' $vw) │ (pad-right '状态' $sw) │" $THEME.accent)
    print $"  ├($h_tool)┼($h_ver)┼($h_stat)┤"

    for item in $results {
        let n = ($item | get -o name | default "")
        let v = ($item | get -o version | default "")
        let s = ($item | get -o status | default "pending")
        let ok = ($item | get -o ok | default false)
        let label = (status-label $s)
        let color = if $ok { $THEME.success } else { $THEME.error }
        print (paint $"  │ (pad-right $n $tw) │ (pad-right $v $vw) │ (pad-right $label $sw) │" $color)
    }

    print $"  └($h_tool)┴($h_ver)┴($h_stat)┘"

    let ok_n = ($results | where ok == true | length)
    let fail_n = ($results | where ok == false | length)
    print $"  (paint $'成功: ($ok_n)' $THEME.success)  (paint $'失败: ($fail_n)' $THEME.error)"
    print ""
}

# 使用指南 — claude/codex/gemini/cc-switch
def show-usage-guide [] {
    print (paint "  Claude CLI" $THEME.accent)
    print "    claude               启动交互式对话"
    print "    claude 'question'    单次提问"
    print "    claude --help        查看帮助"
    print ""
    print (paint "  Codex CLI" $THEME.accent)
    print "    codex                启动交互式编码"
    print "    codex 'task'         单次任务"
    print "    codex --help         查看帮助"
    print ""
    print (paint "  Gemini CLI" $THEME.accent)
    print "    gemini               启动交互式对话"
    print "    gemini 'question'    单次提问"
    print "    gemini --help        查看帮助"
    print ""
    print (paint "  CC Switch" $THEME.accent)
    print "    打开 CC Switch 应用切换 AI 工具配置"
    print ""
}
