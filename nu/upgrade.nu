# nu/upgrade.nu — 版本比较与批量升级
# 依赖: tools.nu 的 check-npm-latest, install-npm-tool, get-tool-version

# 语义版本比较，返回 -1 (current < latest), 0 (相等), 1 (current > latest)
# 输入: "v1.2.3" 或 "1.2.3" 均可
def compare-versions [current: string, latest: string] -> int {
    let parse_ver = {|v|
        let cleaned = ($v | str replace -r '^v' '')
        let parts = ($cleaned | parse -r '(\d+)\.(\d+)\.(\d+)')
        if ($parts | is-empty) {
            {major: 0, minor: 0, patch: 0}
        } else {
            let p = ($parts | first)
            {
                major: ($p.capture0 | into int)
                minor: ($p.capture1 | into int)
                patch: ($p.capture2 | into int)
            }
        }
    }

    let c = (do $parse_ver $current)
    let l = (do $parse_ver $latest)

    if $c.major != $l.major {
        if $c.major < $l.major { -1 } else { 1 }
    } else if $c.minor != $l.minor {
        if $c.minor < $l.minor { -1 } else { 1 }
    } else if $c.patch != $l.patch {
        if $c.patch < $l.patch { -1 } else { 1 }
    } else {
        0
    }
}

# 检查已安装工具的可升级状态
# 输入: 安装结果列表（含 name, installed, version, npm_pkg 等字段）
# 输出: [{name, current, latest, upgradable}]
def check-upgrades [tools: list<record>] -> list<record> {
    $tools
    | where {|t| $t.npm_pkg? != null and $t.npm_pkg? != "" and $t.installed? == true and $t.version? != "" }
    | each {|t|
        let latest = (check-npm-latest $t.npm_pkg)
        let upgradable = if $latest == "" {
            false
        } else {
            (compare-versions $t.version $latest) == -1
        }
        {
            name: $t.name
            current: $t.version
            latest: (if $latest == "" { "unknown" } else { $latest })
            upgradable: $upgradable
            npm_pkg: $t.npm_pkg
            cmd: $t.cmd
            version_args: $t.version_args
        }
    }
}

# 批量升级所有可升级的 npm 工具
# 输入: check-upgrades 返回的列表, 当前 OS
# 输出: [{name, version, ok, msg}]
def upgrade-all [upgradable: list<record>, os: string] -> list<record> {
    $upgradable
    | where upgradable == true
    | each {|t|
        if $t.npm_pkg? != null and $t.npm_pkg? != "" {
            let result = (install-npm-tool $t.name $t.npm_pkg $t.cmd $t.version_args)
            {name: $t.name, version: $result.version, ok: $result.ok, msg: $result.msg}
        } else {
            # 本地包工具 (Nushell/Git/Node) 的升级需提示用户手动操作
            # Nushell 自身升级会替换运行中的二进制，需重启
            {name: $t.name, version: $t.current, ok: false, msg: $"($t.name) 请手动升级或重新运行安装器"}
        }
    }
}
