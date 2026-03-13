# nu/install_mac.nu — macOS 安装逻辑
# 移植自 deploy.sh，所有函数返回 {ok: bool, version: string, msg: string}
# 所有外部命令用 | complete 捕获退出码，不依赖 try/catch 捕获命令失败
# MIT-006: npm install 不使用 sudo（npm 安装逻辑在 tools.nu）
# AC14: 错误隔离，失败不抛异常

const MAC_PKG_DIR = "packages/macos"

# Homebrew 清华镜像
const BREW_MIRRORS = {
    HOMEBREW_BREW_GIT_REMOTE: "https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git"
    HOMEBREW_CORE_GIT_REMOTE: "https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git"
    HOMEBREW_API_DOMAIN: "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api"
    HOMEBREW_BOTTLE_DOMAIN: "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"
}

# 在 packages/macos 中 glob 匹配本地安装包，取第一个匹配项
export def find-local-package-mac [pattern: string] -> any {
    let matches = (glob $"($MAC_PKG_DIR)/($pattern)")
    if ($matches | is-empty) {
        null
    } else {
        $matches | sort -r | first
    }
}

# 安装或检测 Homebrew
export def install-homebrew [] -> record {
    try {
        # 检测 brew 是否已安装
        let result = (do { ^brew --version } | complete)
        if $result.exit_code == 0 {
            let ver = ($result.stdout | lines | first | str trim)
            # 尝试 brew update，失败不阻断
            let _update = (do { ^brew update } | complete)
            return {ok: true, version: $ver, msg: "Homebrew 已安装"}
        }
    } catch {}

    # 未安装，使用清华镜像安装
    try {
        let install_result = (
            do {
                with-env $BREW_MIRRORS {
                    ^/bin/bash -c (
                        ^curl -fsSL "https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/install/raw/HEAD/install.sh"
                    )
                }
            } | complete
        )

        if $install_result.exit_code != 0 {
            return {ok: false, version: "", msg: $"Homebrew 安装失败: ($install_result.stderr | str trim)"}
        }

        # 安装后初始化 brew 环境（Apple Silicon 或 Intel）
        let brew_path = if ("/opt/homebrew/bin/brew" | path exists) {
            "/opt/homebrew/bin/brew"
        } else if ("/usr/local/bin/brew" | path exists) {
            "/usr/local/bin/brew"
        } else {
            return {ok: false, version: "", msg: "Homebrew 安装后找不到 brew 可执行文件"}
        }

        let ver_result = (do { ^$brew_path --version } | complete)
        let ver = if $ver_result.exit_code == 0 {
            $ver_result.stdout | lines | first | str trim
        } else {
            "unknown"
        }

        {ok: true, version: $ver, msg: "Homebrew 安装成功"}
    } catch {|err|
        {ok: false, version: "", msg: $"Homebrew 安装异常: ($err.msg? | default '未知错误')"}
    }
}

# 安装或升级 Nushell（本地 .tar.gz 优先，brew 回退）
export def install-nushell-mac [] -> record {
    try {
        let current = (get-tool-version "nu" ["--version"])

        # 查找本地包
        let pkg = (find-local-package-mac "nu-*-aarch64-apple-darwin.tar.gz")

        if $pkg != null {
            let tmp_dir = (mktemp -d /tmp/nushell-install-XXXXXX)
            let extract = (do { ^tar -xzf $pkg -C $tmp_dir } | complete)

            if $extract.exit_code != 0 {
                do { ^rm -rf $tmp_dir } | complete
                return {ok: false, version: $current, msg: $"Nushell 解压失败: ($extract.stderr | str trim)"}
            }

            # 查找解压后的 nu 二进制文件
            let nu_bins = (glob $"($tmp_dir)/**/nu")
            if ($nu_bins | is-empty) {
                do { ^rm -rf $tmp_dir } | complete
                return {ok: false, version: $current, msg: "解压后未找到 nu 可执行文件"}
            }

            let nu_bin = ($nu_bins | first)
            let cp_result = (do { ^sudo cp $nu_bin /usr/local/bin/nu } | complete)
            let chmod_result = (do { ^sudo chmod +x /usr/local/bin/nu } | complete)
            do { ^rm -rf $tmp_dir } | complete

            if $cp_result.exit_code != 0 {
                return {ok: false, version: $current, msg: $"Nushell 安装失败: ($cp_result.stderr | str trim)"}
            }

            let new_ver = (get-tool-version "nu" ["--version"])
            return {ok: true, version: $new_ver, msg: "Nushell 从本地包安装成功"}
        }

        # 无本地包，brew 回退
        let brew_result = (do { ^brew install nushell } | complete)
        if $brew_result.exit_code != 0 {
            return {ok: false, version: $current, msg: $"Nushell brew 安装失败: ($brew_result.stderr | str trim)"}
        }

        let new_ver = (get-tool-version "nu" ["--version"])
        {ok: true, version: $new_ver, msg: "Nushell 通过 brew 安装成功"}
    } catch {|err|
        {ok: false, version: "", msg: $"Nushell 安装异常: ($err.msg? | default '未知错误')"}
    }
}

# 安装 Git（brew install git）
export def install-git-mac [] -> record {
    try {
        let current = (get-tool-version "git" ["--version"])
        if $current != "" {
            return {ok: true, version: $current, msg: "Git 已安装"}
        }

        let result = (do { ^brew install git } | complete)
        if $result.exit_code != 0 {
            return {ok: false, version: "", msg: $"Git 安装失败: ($result.stderr | str trim)"}
        }

        let ver = (get-tool-version "git" ["--version"])
        {ok: true, version: $ver, msg: "Git 安装成功"}
    } catch {|err|
        {ok: false, version: "", msg: $"Git 安装异常: ($err.msg? | default '未知错误')"}
    }
}

# 安装 Node.js（本地 .pkg 优先，brew 回退）
export def install-node-mac [] -> record {
    try {
        let current = (get-tool-version "node" ["--version"])
        if $current != "" {
            return {ok: true, version: $current, msg: "Node.js 已安装"}
        }

        # 本地 .pkg 优先
        let pkg = (find-local-package-mac "node-*.pkg")

        if $pkg != null {
            let result = (do { ^sudo installer -pkg $pkg -target / } | complete)
            if $result.exit_code == 0 {
                let ver = (get-tool-version "node" ["--version"])
                return {ok: true, version: $ver, msg: "Node.js 从本地 .pkg 安装成功"}
            } else {
                return {ok: false, version: "", msg: $"Node.js .pkg 安装失败: ($result.stderr | str trim)"}
            }
        }

        # brew 回退
        let result = (do { ^brew install node } | complete)
        if $result.exit_code != 0 {
            return {ok: false, version: "", msg: $"Node.js brew 安装失败: ($result.stderr | str trim)"}
        }

        let ver = (get-tool-version "node" ["--version"])
        {ok: true, version: $ver, msg: "Node.js 通过 brew 安装成功"}
    } catch {|err|
        {ok: false, version: "", msg: $"Node.js 安装异常: ($err.msg? | default '未知错误')"}
    }
}

# 安装 CC Switch（本地包优先，brew cask 回退）
export def install-ccswitch-mac [] -> record {
    try {
        # 检测是否已安装
        let matches = (glob /Applications/*[Cc][Cc][-_][Ss]witch*.app)
        if ($matches | length) > 0 {
            return {ok: true, version: "installed", msg: "CC Switch 已安装"}
        }

        # 查找本地包（.tar.gz 或 .dmg）
        let tar_pkg = (find-local-package-mac "*[Cc][Cc]*[Ss]witch*.tar.gz")
        let dmg_pkg = (find-local-package-mac "*[Cc][Cc]*[Ss]witch*.dmg")

        if $tar_pkg != null {
            let tmp_dir = (mktemp -d /tmp/cc-switch-XXXXXX)
            let extract = (do { ^tar -xzf $tar_pkg -C $tmp_dir } | complete)

            if $extract.exit_code != 0 {
                do { ^rm -rf $tmp_dir } | complete
                return {ok: false, version: "", msg: $"CC Switch 解压失败: ($extract.stderr | str trim)"}
            }

            let apps = (glob $"($tmp_dir)/**/*.app")
            if ($apps | is-empty) {
                do { ^rm -rf $tmp_dir } | complete
                return {ok: false, version: "", msg: "解压后未找到 .app 文件"}
            }

            let app = ($apps | first)
            let cp_result = (do { ^cp -R $app /Applications/ } | complete)
            do { ^rm -rf $tmp_dir } | complete

            if $cp_result.exit_code != 0 {
                return {ok: false, version: "", msg: $"CC Switch 复制失败: ($cp_result.stderr | str trim)"}
            }

            return {ok: true, version: "installed", msg: "CC Switch 从本地 tar.gz 安装成功"}
        }

        if $dmg_pkg != null {
            let mount_result = (do { ^hdiutil attach $dmg_pkg -nobrowse } | complete)
            if $mount_result.exit_code != 0 {
                return {ok: false, version: "", msg: $"CC Switch dmg 挂载失败: ($mount_result.stderr | str trim)"}
            }

            let mount_point = ($mount_result.stdout | lines | last | split column "\t" | get column3 | first | str trim)
            let apps = (glob $"($mount_point)/*.app")

            if ($apps | is-empty) {
                let _detach = (do { ^hdiutil detach $mount_point -quiet } | complete)
                return {ok: false, version: "", msg: "dmg 中未找到 .app 文件"}
            }

            let app = ($apps | first)
            let cp_result = (do { ^cp -R $app /Applications/ } | complete)
            let _detach = (do { ^hdiutil detach $mount_point -quiet } | complete)

            if $cp_result.exit_code != 0 {
                return {ok: false, version: "", msg: $"CC Switch 复制失败: ($cp_result.stderr | str trim)"}
            }

            return {ok: true, version: "installed", msg: "CC Switch 从本地 dmg 安装成功"}
        }

        # brew cask 回退
        let _tap = (do { ^brew tap farion1231/ccswitch } | complete)
        let install_result = (do { ^brew install --cask cc-switch } | complete)

        if $install_result.exit_code == 0 {
            return {ok: true, version: "installed", msg: "CC Switch 通过 brew 安装成功"}
        }

        # 尝试 upgrade
        let upgrade_result = (do { ^brew upgrade --cask cc-switch } | complete)
        if $upgrade_result.exit_code == 0 {
            return {ok: true, version: "installed", msg: "CC Switch 通过 brew 更新成功"}
        }

        {ok: false, version: "", msg: "CC Switch 安装失败，请将 .dmg 或 .tar.gz 放入 packages/macos/"}
    } catch {|err|
        {ok: false, version: "", msg: $"CC Switch 安装异常: ($err.msg? | default '未知错误')"}
    }
}

# 分发函数：根据工具名调用对应安装函数
# npm 工具（Claude CLI / Codex CLI / Gemini CLI）不经过此函数，由 tools.nu 的 install-npm-tool 处理
export def dispatch-install-mac [tool_name: string] -> record {
    match $tool_name {
        "Homebrew" => { install-homebrew }
        "Nushell" => { install-nushell-mac }
        "Git" => { install-git-mac }
        "Node.js" => { install-node-mac }
        "CC Switch" => { install-ccswitch-mac }
        _ => { {ok: false, version: "", msg: $"未知工具: ($tool_name)"} }
    }
}
