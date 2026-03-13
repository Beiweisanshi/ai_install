#!/bin/bash
set -euo pipefail

# =============================================================================
# macOS AI Tool Chain - Uninstall
# =============================================================================

# ---------------------------------------------------------------------------
# Colors & logging
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

timestamp() { date '+%H:%M:%S'; }
log_info()    { printf "${CYAN}[$(timestamp)] [INFO]${NC}    %s\n" "$*"; }
log_success() { printf "${GREEN}[$(timestamp)] [OK]${NC}      %s\n" "$*"; }
log_warn()    { printf "${YELLOW}[$(timestamp)] [WARN]${NC}    %s\n" "$*"; }
log_error()   { printf "${RED}[$(timestamp)] [ERROR]${NC}   %s\n" "$*"; }

REMOVED_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
mark_removed() { ((REMOVED_COUNT++)) || true; }
mark_fail()    { ((FAIL_COUNT++))     || true; }
mark_skip()    { ((SKIP_COUNT++))     || true; }

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo ""
printf "${CYAN}${BOLD}"
cat << 'BANNER'
================================================================
   macOS AI Tool Chain - Uninstall
================================================================
BANNER
printf "${NC}\n"

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------
echo "This will uninstall the following tools:"
echo "  - Claude CLI, Codex CLI, Gemini CLI (npm global packages)"
echo "  - cc-switch"
echo "  - Node.js"
echo "  - Git (brew-installed only; Xcode git is preserved)"
echo "  - Homebrew will NOT be removed"
echo ""
read -rp "Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[yY]$ ]]; then
    echo "Cancelled."
    exit 0
fi
echo ""

# ==========================================================================
# 1. Claude CLI
# ==========================================================================
uninstall_claude() {
    log_info "=== Claude CLI ==="
    if ! command -v claude &>/dev/null; then
        log_info "Claude CLI not installed, skipping"
        mark_skip
        return
    fi
    log_info "Running: npm uninstall -g @anthropic-ai/claude-code"
    if npm uninstall -g @anthropic-ai/claude-code 2>/dev/null; then
        log_success "Claude CLI uninstalled"
        mark_removed
    else
        log_error "Claude CLI uninstall failed"
        mark_fail
    fi
}

# ==========================================================================
# 2. Codex CLI
# ==========================================================================
uninstall_codex() {
    log_info "=== Codex CLI ==="
    if ! command -v codex &>/dev/null; then
        log_info "Codex CLI not installed, skipping"
        mark_skip
        return
    fi
    log_info "Running: npm uninstall -g @openai/codex"
    if npm uninstall -g @openai/codex 2>/dev/null; then
        log_success "Codex CLI uninstalled"
        mark_removed
    else
        log_error "Codex CLI uninstall failed"
        mark_fail
    fi
}

# ==========================================================================
# 3. Gemini CLI
# ==========================================================================
uninstall_gemini() {
    log_info "=== Gemini CLI ==="
    if ! command -v gemini &>/dev/null; then
        log_info "Gemini CLI not installed, skipping"
        mark_skip
        return
    fi
    log_info "Running: npm uninstall -g @google/gemini-cli"
    if npm uninstall -g @google/gemini-cli 2>/dev/null; then
        log_success "Gemini CLI uninstalled"
        mark_removed
    else
        log_error "Gemini CLI uninstall failed"
        mark_fail
    fi
}

# ==========================================================================
# 4. cc-switch
# ==========================================================================
uninstall_ccswitch() {
    log_info "=== cc-switch ==="

    local found=false

    # Remove from /Applications
    for app in /Applications/CC\ Switch*.app /Applications/cc-switch*.app; do
        if [[ -e "$app" ]]; then
            log_info "Removing: $app"
            rm -rf "$app"
            found=true
        fi
    done

    # Also try brew uninstall
    if brew list --cask cc-switch &>/dev/null 2>&1; then
        log_info "Running: brew uninstall --cask cc-switch"
        brew uninstall --cask cc-switch 2>/dev/null || true
        found=true
    fi

    if $found; then
        log_success "cc-switch uninstalled"
        mark_removed
    else
        log_info "cc-switch not installed, skipping"
        mark_skip
    fi
}

# ==========================================================================
# 5. Node.js
# ==========================================================================
uninstall_node() {
    log_info "=== Node.js ==="
    if ! command -v node &>/dev/null; then
        log_info "Node.js not installed, skipping"
        mark_skip
        return
    fi

    # Check if installed via brew
    if brew list node &>/dev/null 2>&1; then
        log_info "Running: brew uninstall node"
        if brew uninstall node 2>/dev/null; then
            log_success "Node.js uninstalled (brew)"
            mark_removed
        else
            log_error "Node.js uninstall failed"
            mark_fail
        fi
    else
        log_warn "Node.js not installed via brew, manual removal may be needed"
        log_warn "If installed via .pkg, run: sudo rm -rf /usr/local/lib/node_modules /usr/local/bin/node /usr/local/bin/npm"
        mark_fail
    fi
}

# ==========================================================================
# 6. Git
# ==========================================================================
uninstall_git() {
    log_info "=== Git ==="

    # Check if git is brew-installed
    if brew list git &>/dev/null 2>&1; then
        log_info "Running: brew uninstall git"
        if brew uninstall git 2>/dev/null; then
            log_success "Git uninstalled (brew)"
            mark_removed
        else
            log_error "Git uninstall failed"
            mark_fail
        fi
    else
        if command -v git &>/dev/null; then
            log_info "Git is present but not from brew (likely Xcode CLT), preserving"
        else
            log_info "Git not installed, skipping"
        fi
        mark_skip
    fi
}

# ==========================================================================
# Summary
# ==========================================================================
final_report() {
    echo ""
    printf "${CYAN}${BOLD}================================================================${NC}\n"
    printf "${CYAN}${BOLD}                   Uninstall Summary${NC}\n"
    printf "${CYAN}${BOLD}================================================================${NC}\n\n"

    printf "  %-18s %s\n" "Tool" "Status"
    printf "  %-18s %s\n" "------" "------"

    check_tool() {
        local name="$1" cmd="$2"
        if eval "$cmd" &>/dev/null; then
            printf "  ${RED}%-18s${NC} %s\n" "$name" "still present"
        else
            printf "  ${GREEN}%-18s${NC} %s\n" "$name" "removed"
        fi
    }

    check_tool "Claude CLI" "command -v claude"
    check_tool "Codex CLI"  "command -v codex"
    check_tool "Gemini CLI" "command -v gemini"
    check_tool "cc-switch"  "ls /Applications/*cc-switch*.app /Applications/*CC*Switch*.app 2>/dev/null"
    check_tool "Node.js"    "command -v node"
    # Git: show Xcode git as preserved, not "still present"
    if brew list git &>/dev/null 2>&1; then
        printf "  ${RED}%-18s${NC} %s\n" "Git" "still present (brew)"
    elif command -v git &>/dev/null; then
        printf "  ${CYAN}%-18s${NC} %s\n" "Git" "preserved (Xcode CLT)"
    else
        printf "  ${GREEN}%-18s${NC} %s\n" "Git" "removed"
    fi

    echo ""
    printf "  ${GREEN}Removed: %d${NC}  ${RED}Failed: %d${NC}  Skipped: %d\n" "$REMOVED_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
    echo ""

    if [[ $FAIL_COUNT -eq 0 ]]; then
        printf "  ${GREEN}${BOLD}Uninstall completed!${NC}\n\n"
    else
        printf "  ${YELLOW}${BOLD}Some tools could not be fully removed. Check logs above.${NC}\n\n"
    fi
}

# ==========================================================================
# Main
# ==========================================================================
main() {
    # npm tools first (require node)
    uninstall_claude
    uninstall_codex
    uninstall_gemini

    uninstall_ccswitch
    uninstall_node
    uninstall_git

    final_report
}

main "$@"
