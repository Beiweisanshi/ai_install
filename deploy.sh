#!/bin/bash
set -euo pipefail

# =============================================================================
# macOS AI Tool Chain - Auto Deploy (Local Packages)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$SCRIPT_DIR/packages/macos"

# ---------------------------------------------------------------------------
# Colors & logging
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

timestamp() { date '+%H:%M:%S'; }
log_info()    { printf "${BLUE}[$(timestamp)] [INFO]${NC}    %s\n" "$*"; }
log_success() { printf "${GREEN}[$(timestamp)] [OK]${NC}      %s\n" "$*"; }
log_warn()    { printf "${YELLOW}[$(timestamp)] [WARN]${NC}    %s\n" "$*"; }
log_error()   { printf "${RED}[$(timestamp)] [ERROR]${NC}   %s\n" "$*"; }

SUCCESS_COUNT=0
FAIL_COUNT=0
mark_success() { ((SUCCESS_COUNT++)) || true; }
mark_fail()    { ((FAIL_COUNT++))    || true; }

# ---------------------------------------------------------------------------
# Homebrew mirrors (Tsinghua)
# ---------------------------------------------------------------------------
export HOMEBREW_BREW_GIT_REMOTE="https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/brew.git"
export HOMEBREW_CORE_GIT_REMOTE="https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/homebrew-core.git"
export HOMEBREW_API_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"

NPM_REGISTRY="--registry https://registry.npmmirror.com/"

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo ""
printf "${CYAN}${BOLD}"
cat << 'BANNER'
================================================================
   macOS AI Tool Chain - Auto Deploy (Local Packages)
================================================================
BANNER
printf "${NC}\n"
log_info "Packages directory: $PKG_DIR"

# ==========================================================================
# Homebrew
# ==========================================================================
install_homebrew() {
    log_info "Checking Homebrew ..."
    if command -v brew &>/dev/null; then
        log_success "Homebrew installed: $(brew --version | head -1)"
        brew update 2>/dev/null || log_warn "brew update failed, continuing"
        mark_success
        return
    fi

    log_info "Installing Homebrew (Tsinghua mirror)..."
    if /bin/bash -c "$(curl -fsSL https://mirrors.tuna.tsinghua.edu.cn/git/homebrew/install/raw/HEAD/install.sh)"; then
        if [[ -x /opt/homebrew/bin/brew ]]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [[ -x /usr/local/bin/brew ]]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
        log_success "Homebrew installed"
        mark_success
    else
        log_error "Homebrew install failed"
        mark_fail
    fi
}

# ==========================================================================
# Git
# ==========================================================================
install_git() {
    log_info "Checking Git ..."
    if command -v git &>/dev/null; then
        log_success "Git installed: $(git --version)"
        mark_success
        return
    fi

    log_info "Installing Git via brew ..."
    if brew install git; then
        log_success "Git installed: $(git --version)"
        mark_success
    else
        log_error "Git install failed"
        mark_fail
    fi
}

# ==========================================================================
# Node.js - local .pkg or brew fallback
# ==========================================================================
install_node() {
    log_info "Checking Node.js ..."
    if command -v node &>/dev/null; then
        log_success "Node.js installed: $(node -v), npm: $(npm -v)"
        mark_success
        return
    fi

    # Try local .pkg first
    local pkg_file
    pkg_file="$(find "$PKG_DIR" -maxdepth 1 -name 'node-*.pkg' 2>/dev/null | sort -rV | head -1)"

    if [[ -n "$pkg_file" ]]; then
        log_info "Installing Node.js from: $pkg_file"
        if sudo installer -pkg "$pkg_file" -target /; then
            log_success "Node.js installed: $(node -v), npm: $(npm -v)"
            mark_success
        else
            log_error "Node.js local install failed"
            mark_fail
        fi
    else
        log_info "No local Node.js .pkg found, using brew ..."
        if brew install node; then
            log_success "Node.js installed: $(node -v), npm: $(npm -v)"
            mark_success
        else
            log_error "Node.js install failed"
            mark_fail
        fi
    fi
}

# ==========================================================================
# Claude CLI (npm)
# ==========================================================================
install_claude() {
    log_info "Installing/updating Claude CLI ..."
    if npm install -g @anthropic-ai/claude-code@latest $NPM_REGISTRY; then
        log_success "Claude CLI: $(claude --version 2>/dev/null || echo 'installed')"
        mark_success
    else
        log_error "Claude CLI install failed"
        mark_fail
    fi
}

# ==========================================================================
# Codex CLI (npm)
# ==========================================================================
install_codex() {
    log_info "Installing/updating Codex CLI ..."
    if npm install -g @openai/codex@latest $NPM_REGISTRY; then
        log_success "Codex CLI: $(codex --version 2>/dev/null || echo 'installed')"
        mark_success
    else
        log_error "Codex CLI install failed"
        mark_fail
    fi
}

# ==========================================================================
# Gemini CLI (npm)
# ==========================================================================
install_gemini() {
    log_info "Installing/updating Gemini CLI ..."
    if npm install -g @google/gemini-cli@latest $NPM_REGISTRY; then
        log_success "Gemini CLI: $(gemini --version 2>/dev/null || echo 'installed')"
        mark_success
    else
        log_error "Gemini CLI install failed"
        mark_fail
    fi
}

# ==========================================================================
# cc-switch - local .dmg or brew fallback
# ==========================================================================
install_ccswitch() {
    log_info "Checking cc-switch ..."

    # Check if already in /Applications
    if ls /Applications/CC\ Switch*.app &>/dev/null || ls /Applications/cc-switch*.app &>/dev/null; then
        log_success "cc-switch already installed"
        mark_success
        return
    fi

    # Try local package first (.dmg or .tar.gz)
    local pkg_file
    pkg_file="$(find "$PKG_DIR" -maxdepth 1 \( -name '*cc-switch*.dmg' -o -name '*CC*Switch*.dmg' -o -name '*cc-switch*.tar.gz' -o -name '*CC*Switch*.tar.gz' \) 2>/dev/null | head -1)"

    if [[ -n "$pkg_file" ]]; then
        log_info "Installing cc-switch from: $pkg_file"

        if [[ "$pkg_file" == *.tar.gz ]]; then
            # tar.gz: extract .app to /Applications
            local tmp_dir
            tmp_dir="$(mktemp -d /tmp/cc-switch-XXXXXX)"
            tar -xzf "$pkg_file" -C "$tmp_dir"
            local app
            app="$(find "$tmp_dir" -maxdepth 2 -name '*.app' | head -1)"
            if [[ -n "$app" ]]; then
                cp -R "$app" /Applications/
                log_success "cc-switch installed to /Applications"
                mark_success
            else
                log_error "No .app found in tar.gz"
                mark_fail
            fi
            rm -rf "$tmp_dir"
        elif [[ "$pkg_file" == *.dmg ]]; then
            local mount_point
            mount_point="$(hdiutil attach "$pkg_file" -nobrowse | tail -1 | awk '{print $NF}')"
            if [[ -d "$mount_point" ]]; then
                local app
                app="$(find "$mount_point" -maxdepth 1 -name '*.app' | head -1)"
                if [[ -n "$app" ]]; then
                    cp -R "$app" /Applications/
                    log_success "cc-switch installed to /Applications"
                    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
                    mark_success
                else
                    log_error "No .app found in dmg"
                    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
                    mark_fail
                fi
            else
                log_error "Failed to mount dmg"
                mark_fail
            fi
        fi
        return
    fi

    # Fallback: brew cask
    log_info "No local dmg, trying brew cask ..."
    if brew tap farion1231/ccswitch 2>/dev/null && brew install --cask cc-switch 2>/dev/null; then
        log_success "cc-switch installed via brew"
        mark_success
    elif brew upgrade --cask cc-switch 2>/dev/null; then
        log_success "cc-switch updated via brew"
        mark_success
    else
        log_error "cc-switch install failed"
        log_error "Please put cc-switch .dmg in packages/macos/"
        mark_fail
    fi
}

# ==========================================================================
# Final report
# ==========================================================================
final_report() {
    echo ""
    printf "${CYAN}${BOLD}================================================================${NC}\n"
    printf "${CYAN}${BOLD}                    Deploy Summary${NC}\n"
    printf "${CYAN}${BOLD}================================================================${NC}\n\n"

    printf "  %-18s %s\n" "Tool" "Version"
    printf "  %-18s %s\n" "------" "-------"

    check_tool() {
        local name="$1" cmd="$2"
        local version
        if version=$(eval "$cmd" 2>/dev/null); then
            printf "  ${GREEN}%-18s${NC} %s\n" "$name" "$version"
        else
            printf "  ${RED}%-18s${NC} %s\n" "$name" "not installed"
        fi
    }

    check_tool "Homebrew"   "brew --version | head -1"
    check_tool "Git"        "git --version"
    check_tool "Node.js"    "node -v"
    check_tool "npm"        "npm -v"
    check_tool "Claude CLI" "claude --version 2>/dev/null || claude -v 2>/dev/null"
    check_tool "Codex CLI"  "codex --version 2>/dev/null || codex -v 2>/dev/null"
    check_tool "Gemini CLI" "gemini --version 2>/dev/null || gemini -v 2>/dev/null"
    check_tool "cc-switch"  "ls /Applications/*cc-switch*.app /Applications/*CC*Switch*.app 2>/dev/null && echo 'installed'"

    echo ""
    printf "  ${GREEN}Success: %d${NC}  ${RED}Failed: %d${NC}\n" "$SUCCESS_COUNT" "$FAIL_COUNT"
    echo ""

    if [[ $FAIL_COUNT -eq 0 ]]; then
        printf "  ${GREEN}${BOLD}All tools deployed!${NC}\n\n"
    else
        printf "  ${YELLOW}${BOLD}Some tools failed. Check logs above.${NC}\n\n"
    fi
}

# ==========================================================================
# Main
# ==========================================================================
main() {
    if [[ ! -d "$PKG_DIR" ]]; then
        log_warn "packages/macos/ directory not found, will use brew for everything"
        mkdir -p "$PKG_DIR"
    fi

    install_homebrew
    if ! command -v brew &>/dev/null; then
        log_error "Homebrew not available, aborting"
        final_report
        exit 1
    fi

    install_git
    install_node

    if ! command -v npm &>/dev/null; then
        log_error "npm not available, skipping CLI tools"
        mark_fail; mark_fail; mark_fail
    else
        install_claude
        install_codex
        install_gemini
    fi

    install_ccswitch
    final_report
}

main "$@"
