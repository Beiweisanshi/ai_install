#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 1. 检测 Nushell
if command -v nu &>/dev/null; then
    nu "$SCRIPT_DIR/deploy.nu"
    exit 0
fi

# 2. 安装 Nushell
echo "Installing Nushell..."
PKG_DIR="$SCRIPT_DIR/packages/macos"
NU_TAR="$(find "$PKG_DIR" -maxdepth 1 -name 'nu-*-apple-darwin*.tar.gz' 2>/dev/null | sort -rV | head -1)"

if [[ -n "$NU_TAR" ]]; then
    TMP_DIR="$(mktemp -d /tmp/nushell-XXXXXX)"
    tar -xzf "$NU_TAR" -C "$TMP_DIR"
    # 找到 nu 二进制文件并复制到 /usr/local/bin
    NU_BIN="$(find "$TMP_DIR" -name 'nu' -type f | head -1)"
    if [[ -n "$NU_BIN" ]]; then
        sudo cp "$NU_BIN" /usr/local/bin/nu
        sudo chmod +x /usr/local/bin/nu
    fi
    rm -rf "$TMP_DIR"
else
    echo "ERROR: Nushell installer not found in packages/macos/"
    echo "Expected: nu-*-apple-darwin*.tar.gz"
    exit 1
fi

# 3. 验证
if ! command -v nu &>/dev/null; then
    echo "ERROR: Nushell installation failed"
    exit 1
fi

# 4. 启动 TUI 安装器
nu "$SCRIPT_DIR/deploy.nu"
