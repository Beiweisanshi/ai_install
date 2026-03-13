# nu/install_win.nu — Windows 安装逻辑（移植自 deploy.ps1）
# 所有函数返回统一 {ok: bool, version: string|null, msg: string}
# 外部命令用 | complete 捕获退出码，try/catch 错误隔离 (AC14)

# 安装包目录（相对于项目根目录）
const WIN_PKG_DIR = "packages/windows"

# 安装包文件名匹配模式
const PKG_PATTERNS = {
    nushell: "nushell-*.msi"
    git: "Git-*-64-bit.exe"
    node: "node-*-x64.msi"
    ccswitch: "CC-Switch*.msi"
}

# Git 静默安装参数（移植自 deploy.ps1）
const GIT_SILENT_ARGS = '/VERYSILENT /NORESTART /NOCANCEL /SP- /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /COMPONENTS="icons,ext\\reg\\shellhere,assoc,assoc_sh"'

# 在 packages/windows 中 glob 匹配安装包，取名称排序最后一个（最新版本）
export def find-local-package [pattern: string] -> string {
    let matches = (glob ($WIN_PKG_DIR | path join $pattern))
    if ($matches | is-empty) {
        ""
    } else {
        $matches | sort | last
    }
}

# 从注册表读 Machine+User PATH 合并到 $env.PATH，追加常见安装目录
export def refresh-path-win [] -> nothing {
    # 读取 Machine PATH
    let machine_result = (
        do { ^reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path } | complete
    )
    let machine_path = if $machine_result.exit_code == 0 {
        let parsed = (
            $machine_result.stdout
            | lines
            | where { |line| $line =~ '(?i)REG_' }
            | each { |line|
                let m = ($line | parse -r '(?i)Path\s+REG_(?:EXPAND_)?SZ\s+(.+)')
                if ($m | is-empty) { "" } else { $m | first | get capture0 | str trim }
            }
        )
        if ($parsed | is-empty) { "" } else { $parsed | first }
    } else {
        ""
    }

    # 读取 User PATH
    let user_result = (
        do { ^reg query "HKCU\\Environment" /v Path } | complete
    )
    let user_path = if $user_result.exit_code == 0 {
        let parsed = (
            $user_result.stdout
            | lines
            | where { |line| $line =~ '(?i)REG_' }
            | each { |line|
                let m = ($line | parse -r '(?i)Path\s+REG_(?:EXPAND_)?SZ\s+(.+)')
                if ($m | is-empty) { "" } else { $m | first | get capture0 | str trim }
            }
        )
        if ($parsed | is-empty) { "" } else { $parsed | first }
    } else {
        ""
    }

    # 合并 PATH
    let combined = $"($machine_path);($user_path)"

    # 追加常见安装目录
    let program_files = ($env.ProgramFiles? | default "C:\\Program Files")
    let appdata = ($env.APPDATA? | default "")
    let extras = [
        $"($program_files)\\Git\\cmd"
        $"($program_files)\\nodejs"
        $"($appdata)\\npm"
    ]

    let extra_paths = ($extras | where { |p| ($p | path exists) and (not ($combined =~ $p)) } | str join ";")

    let final_path = if ($extra_paths | is-empty) {
        $combined
    } else {
        $"($extra_paths);($combined)"
    }

    $env.PATH = ($final_path | split row ";" | where { |p| $p != "" })
    null
}

# 通用安装器运行函数
# .msi: msiexec /i path /qn /norestart
# .exe: 直接运行带参数
export def run-installer-win [
    path: string,
    args: string = "",
    timeout_sec: int = 300,
    name: string = ""
] -> bool {
    let ext = ($path | path parse | get extension | str downcase)

    let result = if $ext == "msi" {
        do { ^msiexec /i $path /qn /norestart } | complete
    } else {
        if ($args | is-empty) {
            do { ^$path } | complete
        } else {
            # 用 cmd /c 运行以支持复杂参数
            do { ^cmd /c $"\"($path)\" ($args)" } | complete
        }
    }

    # 退出码 0 或 3010（需要重启）都算成功
    $result.exit_code == 0 or $result.exit_code == 3010
}

# Nushell 升级安装（首次由 bootstrap 完成）
export def install-nushell-win [] -> record {
    try {
        let current = (get-tool-version "nu" ["--version"])

        let pkg = (find-local-package $PKG_PATTERNS.nushell)
        if ($pkg | is-empty) {
            return {ok: ($current != ""), version: $current, msg: (if $current != "" { $"Nushell 已安装: ($current)" } else { "Nushell 安装包未找到" })}
        }

        let ok = (run-installer-win $pkg "" 120 "Nushell")
        if (not $ok) {
            return {ok: false, version: $current, msg: "Nushell 安装超时或失败"}
        }

        refresh-path-win
        let ver = (get-tool-version "nu" ["--version"])
        if $ver != "" {
            {ok: true, version: $ver, msg: $"Nushell 安装完成: ($ver)"}
        } else {
            {ok: false, version: "", msg: "Nushell 安装后版本检测失败"}
        }
    } catch {|err|
        {ok: false, version: "", msg: $"Nushell 安装异常: ($err.msg? | default '未知错误')"}
    }
}

# Git 安装：检测已装则跳过，否则静默安装
export def install-git-win [] -> record {
    try {
        let current = (get-tool-version "git" ["--version"])
        if $current != "" {
            return {ok: true, version: $current, msg: $"Git 已安装: ($current)"}
        }

        let pkg = (find-local-package $PKG_PATTERNS.git)
        if ($pkg | is-empty) {
            return {ok: false, version: "", msg: $"Git 安装包未找到，期望: ($PKG_PATTERNS.git)"}
        }

        let ok = (run-installer-win $pkg $GIT_SILENT_ARGS 120 "Git")
        if (not $ok) {
            return {ok: false, version: "", msg: "Git 安装超时或失败"}
        }

        # 等待安装程序收尾
        sleep 3sec
        refresh-path-win

        let ver = (get-tool-version "git" ["--version"])
        if $ver != "" {
            {ok: true, version: $ver, msg: $"Git 安装完成: ($ver)"}
        } else {
            {ok: false, version: "", msg: "Git 安装后未检测到 git 命令"}
        }
    } catch {|err|
        {ok: false, version: "", msg: $"Git 安装异常: ($err.msg? | default '未知错误')"}
    }
}

# Node.js 安装：msi 静默安装 + 重试 PATH 刷新
export def install-node-win [] -> record {
    try {
        let node_ver = (get-tool-version "node" ["--version"])
        let npm_ver = (get-tool-version "npm" ["--version"])
        if $node_ver != "" and $npm_ver != "" {
            return {ok: true, version: $"($node_ver) \(npm ($npm_ver)\)", msg: $"Node.js 已安装: ($node_ver)"}
        }

        let pkg = (find-local-package $PKG_PATTERNS.node)
        if ($pkg | is-empty) {
            return {ok: false, version: "", msg: $"Node.js 安装包未找到，期望: ($PKG_PATTERNS.node)"}
        }

        let ok = (run-installer-win $pkg "" 180 "Node.js")
        if (not $ok) {
            return {ok: false, version: "", msg: "Node.js 安装超时或失败"}
        }

        # 重试机制: 3 次，间隔 5/10/15 秒
        let delays = [5 10 15]
        mut final_node = ""
        mut final_npm = ""

        for delay in $delays {
            refresh-path-win
            sleep ($"($delay)sec" | into duration)

            let nv = (get-tool-version "node" ["--version"])
            let npmv = (get-tool-version "npm" ["--version"])
            if $nv != "" and $npmv != "" {
                $final_node = $nv
                $final_npm = $npmv
                break
            }
        }

        if $final_node != "" and $final_npm != "" {
            {ok: true, version: $"($final_node) \(npm ($final_npm)\)", msg: $"Node.js 安装完成: ($final_node)"}
        } else {
            {ok: false, version: "", msg: "Node.js 安装后 node/npm 未就绪"}
        }
    } catch {|err|
        {ok: false, version: "", msg: $"Node.js 安装异常: ($err.msg? | default '未知错误')"}
    }
}

# CC Switch 安装：检测已装则跳过，否则 msi 静默安装
export def install-ccswitch-win [] -> record {
    try {
        # 检测已安装: 文件路径
        let local_appdata = ($env.LOCALAPPDATA? | default "")
        let exe_path = ($local_appdata | path join "Programs" "cc-switch" "CC Switch.exe")
        if ($exe_path | path exists) {
            return {ok: true, version: "已安装", msg: "CC Switch 已安装"}
        }

        # 检测已安装: 注册表
        let reg_result = (
            do { ^reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /f "cc-switch" } | complete
        )
        if $reg_result.exit_code == 0 and ($reg_result.stdout =~ '(?i)cc.switch') {
            return {ok: true, version: "已安装", msg: "CC Switch 已安装 (注册表)"}
        }

        # 查找安装包
        mut pkg = (find-local-package $PKG_PATTERNS.ccswitch)
        if ($pkg | is-empty) {
            $pkg = (find-local-package "*cc-switch*.msi")
        }
        if ($pkg | is-empty) {
            $pkg = (find-local-package "*cc-switch*.exe")
        }
        if ($pkg | is-empty) {
            return {ok: false, version: "", msg: "CC Switch 安装包未找到"}
        }

        let ext = ($pkg | path parse | get extension | str downcase)
        let ok = if $ext == "msi" {
            run-installer-win $pkg "" 120 "CC Switch"
        } else {
            run-installer-win $pkg "/S" 120 "CC Switch"
        }

        if (not $ok) {
            return {ok: false, version: "", msg: "CC Switch 安装超时或失败"}
        }

        sleep 3sec
        {ok: true, version: "已安装", msg: "CC Switch 安装完成"}
    } catch {|err|
        {ok: false, version: "", msg: $"CC Switch 安装异常: ($err.msg? | default '未知错误')"}
    }
}

# 分发函数：根据工具名调用对应安装函数
export def dispatch-install-win [tool_name: string] -> record {
    match $tool_name {
        "Nushell" => { install-nushell-win }
        "Git" => { install-git-win }
        "Node.js" => { install-node-win }
        "CC Switch" => { install-ccswitch-win }
        _ => { {ok: false, version: "", msg: $"未知工具: ($tool_name)"} }
    }
}
