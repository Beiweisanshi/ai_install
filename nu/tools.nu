# nu/tools.nu — 工具定义、检测、版本解析与 npm 安装公共模块
# 所有外部命令用 | complete 捕获退出码，不依赖 try/catch 捕获命令失败
# MIT-006: npm install 不使用 sudo
# AC14: 错误隔离，失败不抛异常

const NPM_REGISTRY = "https://registry.npmmirror.com/"

# 返回 7 个工具的定义列表
export def get-tool-list [] {
    [
        {name: "Nushell",    cmd: "nu",     version_args: ["--version"], required: true,  group: "基础",    npm_pkg: null}
        {name: "Git",        cmd: "git",    version_args: ["--version"], required: true,  group: "基础",    npm_pkg: null}
        {name: "Node.js",    cmd: "node",   version_args: ["--version"], required: true,  group: "基础",    npm_pkg: null}
        {name: "Claude CLI", cmd: "claude", version_args: ["--version"], required: false, group: "AI 工具", npm_pkg: "@anthropic-ai/claude-code"}
        {name: "Codex CLI",  cmd: "codex",  version_args: ["--version"], required: false, group: "AI 工具", npm_pkg: "@openai/codex"}
        {name: "Gemini CLI", cmd: "gemini", version_args: ["--version"], required: false, group: "AI 工具", npm_pkg: "@google/gemini-cli"}
        {name: "CC Switch",  cmd: null,     version_args: [],            required: false, group: "辅助",    npm_pkg: null}
    ]
}

# 运行命令提取版本号，失败返回空字符串
export def get-tool-version [cmd: string, version_args: list<string>] -> string {
    try {
        let result = (do { ^$cmd ...$version_args } | complete)
        if $result.exit_code == 0 {
            let parsed = ($result.stdout | parse -r 'v?(\d+\.\d+\.\d+)')
            if ($parsed | is-empty) {
                ""
            } else {
                $parsed | first | get capture0
            }
        } else {
            ""
        }
    } catch {
        ""
    }
}

# 检测工具是否已安装，返回 {installed: bool, version: string}
export def detect-tool [tool: record] -> record {
    if $tool.cmd == null {
        # CC Switch 特殊检测
        let found = if ($nu.os-info.name == "windows") {
            ($env.LOCALAPPDATA | path join "Programs" "cc-switch" "CC Switch.exe" | path exists)
        } else if ($nu.os-info.name == "macos") {
            let matches = (glob /Applications/*[Cc][Cc][-_][Ss]witch*.app)
            ($matches | length) > 0
        } else {
            false
        }
        if $found {
            {installed: true, version: "installed"}
        } else {
            {installed: false, version: ""}
        }
    } else {
        let ver = (get-tool-version $tool.cmd $tool.version_args)
        if $ver != "" {
            {installed: true, version: $ver}
        } else {
            {installed: false, version: ""}
        }
    }
}

# 查询 npm registry 最新版本，失败返回空字符串
export def check-npm-latest [package: string] -> string {
    try {
        let resp = (http get --max-time 10sec $"($NPM_REGISTRY)($package)/latest")
        $resp.version? | default ""
    } catch {
        ""
    }
}

# npm install -g 安装工具，返回 {ok: bool, version: string, msg: string}
# 不使用 sudo (MIT-006)，try/catch 错误隔离 (AC14)
export def install-npm-tool [
    name: string,
    package: string,
    cmd: string,
    version_args: list<string>
] -> record {
    try {
        let current = (get-tool-version $cmd $version_args)

        let result = (
            do { ^npm install -g $"($package)@latest" --registry $NPM_REGISTRY } | complete
        )

        if $result.exit_code != 0 {
            let err_msg = if ($result.stderr | str trim | is-empty) {
                $result.stdout | str trim
            } else {
                $result.stderr | str trim
            }
            return {ok: false, version: $current, msg: $"安装失败: ($err_msg)"}
        }

        let new_ver = (get-tool-version $cmd $version_args)
        {ok: true, version: $new_ver, msg: $"($name) 安装成功"}
    } catch {|err|
        {ok: false, version: "", msg: $"($name) 安装异常: ($err.msg? | default '未知错误')"}
    }
}
