#!/usr/bin/env bash
# Atomic CLI Installer
#
# Installs npm (if needed), bun (if needed), atomic globally, and sets up skills.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash

set -euo pipefail

REPO="https://github.com/flora131/atomic.git"
SKILLS_AGENTS=("claude-code" "opencode" "github-copilot")
SCM_SKILLS_TO_REMOVE=("gh-commit" "gh-create-pr" "sl-commit" "sl-submit-diff")

info()  { printf '\033[1;34minfo\033[0m: %s\n' "$*"; }
ok()    { printf '\033[1;32msuccess\033[0m: %s\n' "$*"; }
warn()  { printf '\033[1;33mwarn\033[0m: %s\n' "$*" >&2; }
error() { printf '\033[1;31merror\033[0m: %s\n' "$*" >&2; }

# ── npm / Node.js ────────────────────────────────────────────────────────────

install_fnm() {
    if command -v fnm >/dev/null 2>&1; then
        info "fnm is already installed"
        return 0
    fi
    info "Installing fnm (Fast Node Manager)..."
    # macOS: Homebrew (preferred)
    if [[ "$OSTYPE" == darwin* ]] && command -v brew >/dev/null 2>&1; then
        if brew install fnm; then return 0; fi
        warn "brew install fnm failed, trying curl installer..."
    fi
    # Linux / macOS fallback
    if curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell; then
        export FNM_DIR="${FNM_DIR:-$HOME/.local/share/fnm}"
        export PATH="$FNM_DIR:$HOME/.fnm:$PATH"
        return 0
    fi
    warn "fnm installation failed"
    return 1
}

install_npm() {
    local NODE_MAJOR=22

    if command -v node >/dev/null 2>&1; then
        local current_major
        current_major=$(node --version | sed 's/^v//' | cut -d. -f1)
        if [[ "$current_major" -ge "$NODE_MAJOR" ]]; then
            info "Node.js $(node --version) is already installed (>= $NODE_MAJOR)"
            return 0
        fi
        warn "Node.js $(node --version) is too old (need >= $NODE_MAJOR), upgrading..."
    fi

    info "Installing Node.js $NODE_MAJOR LTS..."

    # Preferred: fnm (no root required)
    if install_fnm && command -v fnm >/dev/null 2>&1; then
        if fnm install --lts && eval "$(fnm env)"; then
            info "Node.js $(node --version) installed via fnm"
            return 0
        fi
        warn "fnm install --lts failed, trying other methods..."
    fi

    # Homebrew (macOS)
    if command -v brew >/dev/null 2>&1; then
        if brew install "node@$NODE_MAJOR" && brew link --overwrite "node@$NODE_MAJOR" 2>/dev/null; then
            return 0
        fi
        if brew install node; then return 0; fi
        warn "brew install node failed, trying other methods..."
    fi

    local sudo_cmd=""
    if [[ "$(id -u)" -ne 0 ]]; then
        if command -v sudo >/dev/null 2>&1; then
            sudo_cmd="sudo"
        else
            warn "Cannot install Node.js: no sudo and not root"
            return 1
        fi
    fi

    # Debian/Ubuntu
    if command -v apt-get >/dev/null 2>&1; then
        if curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $sudo_cmd bash -; then
            $sudo_cmd apt-get install -y nodejs && return 0
        fi
        $sudo_cmd apt-get update && $sudo_cmd apt-get install -y nodejs npm && return 0
    fi

    # RHEL/Fedora
    if command -v dnf >/dev/null 2>&1; then
        if curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | $sudo_cmd bash -; then
            $sudo_cmd dnf install -y nodejs && return 0
        fi
        $sudo_cmd dnf install -y nodejs npm && return 0
    fi

    if command -v yum >/dev/null 2>&1; then
        if curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | $sudo_cmd bash -; then
            $sudo_cmd yum install -y nodejs && return 0
        fi
        $sudo_cmd yum install -y nodejs npm && return 0
    fi

    # Other Linux
    if command -v pacman >/dev/null 2>&1; then
        $sudo_cmd pacman -Sy --noconfirm nodejs npm && return 0
    elif command -v zypper >/dev/null 2>&1; then
        $sudo_cmd zypper --non-interactive install nodejs npm && return 0
    elif command -v apk >/dev/null 2>&1; then
        $sudo_cmd apk add --no-cache nodejs npm && return 0
    fi

    warn "No supported package manager found to install Node.js"
    return 1
}

# ── bun ──────────────────────────────────────────────────────────────────────

install_bun() {
    if command -v bun >/dev/null 2>&1; then
        info "bun is already installed: $(bun --version 2>/dev/null)"
        return 0
    fi

    info "Installing bun..."

    # macOS: Homebrew (preferred)
    if [[ "$OSTYPE" == darwin* ]] && command -v brew >/dev/null 2>&1; then
        brew install oven-sh/bun/bun && return 0
        warn "brew install bun failed, trying curl installer..."
    fi

    # Official installer (Linux / macOS fallback)
    if command -v curl >/dev/null 2>&1; then
        if curl -fsSL https://bun.sh/install | bash; then
            export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
            export PATH="$BUN_INSTALL/bin:$PATH"
            if command -v bun >/dev/null 2>&1; then return 0; fi
        fi
    fi

    warn "Could not install bun — install it manually from https://bun.sh"
    return 1
}

# ── Skills ───────────────────────────────────────────────────────────────────

install_skills() {
    if ! command -v npx >/dev/null 2>&1; then
        warn "npx not found — skipping skills install"
        return
    fi

    local agent_flags=()
    for agent in "${SKILLS_AGENTS[@]}"; do
        agent_flags+=("-a" "$agent")
    done

    info "Installing bundled skills globally..."
    if ! npx --yes skills add "$REPO" --skill '*' -g "${agent_flags[@]}" -y 2>/dev/null; then
        warn "skills install failed (non-fatal)"
        return
    fi

    local remove_flags=()
    for skill in "${SCM_SKILLS_TO_REMOVE[@]}"; do
        remove_flags+=("--skill" "$skill")
    done

    info "Removing source-control skill variants globally..."
    npx --yes skills remove "${remove_flags[@]}" -g "${agent_flags[@]}" -y 2>/dev/null || true
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
    local failed_tools=()

    # Step 1: npm (needed for npx skills)
    install_npm || { warn "npm installation failed — install Node.js manually from https://nodejs.org"; failed_tools+=("npm"); }

    # Step 2: bun (required runtime)
    install_bun || { error "bun installation failed — install manually from https://bun.sh"; exit 1; }

    # Step 3: Install atomic
    info "Installing atomic..."
    bun add -g atomic@latest
    ok "atomic installed"

    # Step 4: Skills
    install_skills

    if [[ ${#failed_tools[@]} -gt 0 ]]; then
        warn "Some optional tools failed to install: ${failed_tools[*]}"
    fi

    ok ""
    ok "Atomic installed successfully!"
    echo ""
    echo "  Get started:  atomic init"
    echo "  Update later: atomic update"
    echo ""
}

main
