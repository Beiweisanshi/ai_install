# ============================================================
# 配置引导模块 — CC-Switch / Codex / Gemini 的 URL + Key 配置
# 安全: MIT-001 ~ MIT-005 全部在此文件实现
# 依赖: ui.nu 的 show-section（由 deploy.nu 统一 source）
# ============================================================

# ── 验证函数 ─────────────────────────────────────────────────

# MIT-002: URL 验证 — http(s) scheme, <= 2048, 无空白
def validate-url [url: string] -> bool {
    let len = ($url | str length)
    if $len > 2048 { return false }
    if ($url | str contains " ") or ($url | str contains "\t") { return false }
    ($url | str starts-with "http://") or ($url | str starts-with "https://")
}

# MIT-002: Key 验证 — 非空, 无换行/双引号/反引号, <= 256
def validate-key [key: string] -> bool {
    let len = ($key | str length)
    if $len == 0 or $len > 256 { return false }
    if ($key | str contains "\n") { return false }
    if ($key | str contains '"') { return false }
    if ($key | str contains '`') { return false }
    true
}

# ── 交互输入 ─────────────────────────────────────────────────

# 引导用户输入 URL + Key，返回 {url, key} 或 null（跳过）
def prompt-config [tool_name: string] {
    print $"  ($tool_name) 配置:"

    # URL 输入 — 最多 3 次
    mut url = ""
    mut url_ok = false
    for attempt in 1..3 {
        let raw = (input $"  API URL \(Enter 跳过\): ")
        if ($raw | str trim | is-empty) {
            print $"  ⏭ 跳过 ($tool_name) 配置"
            return null
        }
        if (validate-url $raw) {
            $url = $raw
            $url_ok = true
            break
        }
        if $attempt < 3 {
            print $"  ✗ URL 无效（需 http:// 或 https:// 开头），请重新输入 \(($attempt)/3\)"
        } else {
            print $"  ✗ URL 验证失败 3 次，跳过 ($tool_name) 配置"
        }
    }
    if not $url_ok { return null }

    # Key 输入 — MIT-003: suppress-output, 最多 3 次
    mut key = ""
    mut key_ok = false
    for attempt in 1..3 {
        let raw = (input --suppress-output $"  API Key: ")
        print ""  # suppress-output 不换行，手动补一个
        if (validate-key $raw) {
            $key = $raw
            $key_ok = true
            break
        }
        if $attempt < 3 {
            print $"  ✗ Key 无效（不能为空，不能含换行/引号/反引号），请重新输入 \(($attempt)/3\)"
        } else {
            print $"  ✗ Key 验证失败 3 次，跳过 ($tool_name) 配置"
        }
    }
    if not $key_ok { return null }

    { url: $url, key: $key }
}

# ── 文件权限 ─────────────────────────────────────────────────

# MIT-004: 设置文件权限 — 仅当前用户可读写
def set-file-permissions [path: string] {
    let os = ($nu.os-info.name)
    if $os == "macos" {
        ^chmod 600 $path | complete | null
    } else if $os == "windows" {
        ^icacls $path /inheritance:r /grant:r $"($env.USERNAME):F" | complete | null
    }
}

# ── 配置写入 ─────────────────────────────────────────────────

# MIT-001: CC-Switch 配置 — JSON 原生操作
def write-config-ccswitch [config: record] -> bool {
    let config_path = if ($nu.os-info.name == "windows") {
        $env.APPDATA | path join "cc-switch" "config.json"
    } else {
        $"($env.HOME)/.config/cc-switch/config.json"
    }

    # 确保目录存在
    let dir = ($config_path | path dirname)
    if not ($dir | path exists) {
        mkdir $dir
    }

    # 读取 → 更新 → 写入 (MIT-001: JSON 原生操作)
    let existing = if ($config_path | path exists) {
        open $config_path
    } else {
        {}
    }
    let updated = ($existing | upsert api_url $config.url | upsert api_key $config.key)
    $updated | to json | save -f $config_path

    # MIT-004: 设置权限
    set-file-permissions $config_path
    true
}

# MIT-001: 环境变量配置 — Windows 用 setx, macOS 用 shell profile
def write-config-env [var_url: string, var_key: string, config: record] -> bool {
    let os = ($nu.os-info.name)

    if $os == "windows" {
        ^setx $var_url $config.url | complete | null
        ^setx $var_key $config.key | complete | null
        return true
    }

    # macOS: 写入 shell profile
    let profile = if ($env.SHELL? | default "/bin/zsh") =~ "zsh" {
        $"($env.HOME)/.zshrc"
    } else {
        $"($env.HOME)/.bashrc"
    }

    # 读取现有内容
    let content = if ($profile | path exists) {
        open $profile --raw
    } else {
        ""
    }

    # 替换或追加 export 行 (MIT-001: 固定 export 格式)
    let lines = ($content | lines)
    let url_line = $'export ($var_url)="($config.url)"'
    let key_line = $'export ($var_key)="($config.key)"'

    let updated_lines = ($lines
        | where { |line| not ($line =~ $'^export ($var_url)=') }
        | where { |line| not ($line =~ $'^export ($var_key)=') })

    let final_lines = ($updated_lines | append $url_line | append $key_line)
    $final_lines | str join "\n" | save -f $profile

    # MIT-004: 设置 profile 文件权限
    set-file-permissions $profile

    true
}

# ── 各工具配置入口 ───────────────────────────────────────────

# AC7: CC-Switch 配置
def configure-ccswitch [] {
    let config = (prompt-config "CC Switch")
    if $config == null { return }
    try {
        let ok = (write-config-ccswitch $config)
        if $ok { print "  ✓ CC Switch 配置已写入" }
    } catch {
        # MIT-005: 不输出 key 值
        print "  ✗ CC Switch 配置写入失败"
    }
}

# AC8: Codex CLI 配置
def configure-codex [] {
    let config = (prompt-config "Codex CLI")
    if $config == null { return }
    try {
        let ok = (write-config-env "OPENAI_API_BASE" "OPENAI_API_KEY" $config)
        if $ok { print "  ✓ Codex CLI 配置已写入" }
    } catch {
        # MIT-005: 不输出 key 值
        print "  ✗ Codex CLI 配置写入失败"
    }
}

# AC9: Gemini CLI 配置
def configure-gemini [] {
    let config = (prompt-config "Gemini CLI")
    if $config == null { return }
    try {
        let ok = (write-config-env "GEMINI_API_BASE" "GEMINI_API_KEY" $config)
        if $ok { print "  ✓ Gemini CLI 配置已写入" }
    } catch {
        # MIT-005: 不输出 key 值
        print "  ✗ Gemini CLI 配置写入失败"
    }
}

# ── 主入口 ───────────────────────────────────────────────────

# deploy.nu 调用此函数
def run-config-guide [] {
    show-section "配置引导"
    configure-ccswitch
    configure-codex
    configure-gemini
}
