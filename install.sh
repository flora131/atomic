#!/usr/bin/env bash
# Atomic CLI Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
#    or: wget -qO- https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
# Usage with version: curl -fsSL ... | bash -s -- v1.0.0
#    or: VERSION=v1.0.0 curl -fsSL ... | bash
# Usage prerelease: curl -fsSL ... | bash -s -- --prerelease
#    or: VERSION=prerelease curl -fsSL ... | bash
# Set GITHUB_TOKEN for authenticated downloads (avoids API rate limits)
#
# Installs the Atomic CLI binary, config data, and all required tooling
# (npm, @playwright/cli, @llamaindex/liteparse, apm).

set -euo pipefail

# Configuration
GITHUB_REPO="flora131/atomic"
BINARY_NAME="atomic"
BIN_DIR="$HOME/.local/bin"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/atomic"
ATOMIC_HOME="$HOME/.atomic"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

info() { echo -e "${BLUE}info${NC}: $*"; }
success() { echo -e "${GREEN}success${NC}: $*"; }
warn() { echo -e "${YELLOW}warn${NC}: $*"; }
error() { echo -e "${RED}error${NC}: $*" >&2; exit 1; }

# Create a temporary netrc file for authenticated GitHub API requests.
# This avoids exposing GITHUB_TOKEN on the command line (visible via ps).
# Sets AUTH_NETRC_FILE to the path; caller must clean up via cleanup_auth.
AUTH_NETRC_FILE=""
setup_auth() {
    AUTH_NETRC_FILE=""
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        AUTH_NETRC_FILE=$(mktemp "${TMPDIR:-/tmp}/atomic-netrc.XXXXXX")
        chmod 600 "$AUTH_NETRC_FILE"
        cat > "$AUTH_NETRC_FILE" <<EOF
machine api.github.com
  login x-access-token
  password ${GITHUB_TOKEN}

machine github.com
  login x-access-token
  password ${GITHUB_TOKEN}
EOF
    fi
}

cleanup_auth() {
    if [[ -n "${AUTH_NETRC_FILE:-}" && -f "$AUTH_NETRC_FILE" ]]; then
        rm -f "$AUTH_NETRC_FILE"
        AUTH_NETRC_FILE=""
    fi
}

# Download a file using curl or wget with optional GITHUB_TOKEN auth.
# Auth credentials are passed via a temporary netrc file, not the command line.
download_file() {
    local url="$1" output="$2" quiet="${3:-false}"
    local curl_auth=() wget_auth=()

    setup_auth
    trap cleanup_auth RETURN

    if [[ -n "$AUTH_NETRC_FILE" ]]; then
        curl_auth=(--netrc-file "$AUTH_NETRC_FILE")
        wget_auth=(--netrc-file "$AUTH_NETRC_FILE")
    fi

    if command -v curl >/dev/null 2>&1; then
        if [[ "$quiet" == "true" ]]; then
            curl -fsSL ${curl_auth[@]+"${curl_auth[@]}"} "$url" -o "$output"
        else
            curl --fail --location --progress-bar ${curl_auth[@]+"${curl_auth[@]}"} --output "$output" "$url"
        fi
    elif command -v wget >/dev/null 2>&1; then
        if [[ "$quiet" == "true" ]]; then
            wget -qO "$output" ${wget_auth[@]+"${wget_auth[@]}"} "$url"
        else
            wget -O "$output" ${wget_auth[@]+"${wget_auth[@]}"} "$url"
        fi
    else
        error "Neither curl nor wget found. Please install one of them."
    fi
}

# Fetch URL contents to stdout (for piping)
fetch_url() {
    local url="$1"
    local curl_auth=() wget_auth=()

    setup_auth
    trap cleanup_auth RETURN

    if [[ -n "$AUTH_NETRC_FILE" ]]; then
        curl_auth=(--netrc-file "$AUTH_NETRC_FILE")
        wget_auth=(--netrc-file "$AUTH_NETRC_FILE")
    fi

    if command -v curl >/dev/null 2>&1; then
        curl -fsSL ${curl_auth[@]+"${curl_auth[@]}"} "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO- ${wget_auth[@]+"${wget_auth[@]}"} "$url"
    else
        error "Neither curl nor wget found. Please install one of them."
    fi
}

# Detect platform
detect_platform() {
    local os arch
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)

    case "$os" in
        linux) os="linux" ;;
        darwin) os="darwin" ;;
        mingw*|msys*|cygwin*)
            # Windows delegation is handled in main() before this subshell call.
            # If reached here, it's an unexpected code path.
            error "Windows detected — use install.ps1 directly or run install.sh from main()"
            ;;
        *) error "Unsupported OS: $os" ;;
    esac

    case "$arch" in
        x86_64|amd64) arch="x64" ;;
        arm64|aarch64) arch="arm64" ;;
        *) error "Unsupported architecture: $arch" ;;
    esac

    # Detect Rosetta 2 on macOS
    if [[ "$os" == "darwin" && "$arch" == "x64" ]]; then
        if [[ $(sysctl -n sysctl.proc_translated 2>/dev/null) == "1" ]]; then
            info "Detected Rosetta 2 emulation, using native arm64 binary"
            arch="arm64"
        fi
    fi

    echo "${os}-${arch}"
}

# Detect shell config file
detect_shell_config() {
    case $(basename "${SHELL:-bash}") in
    fish)
        echo "$HOME/.config/fish/config.fish"
        ;;
    zsh)
        echo "$HOME/.zshrc"
        ;;
    bash)
        for f in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
            [[ -f "$f" ]] && echo "$f" && return
        done
        echo "$HOME/.bashrc"
        ;;
    *)
        echo "$HOME/.profile"
        ;;
    esac
}

# Add to PATH in shell config
add_to_path() {
    local config_file="$1"
    local path_line

    # Fish uses different syntax
    if [[ "$config_file" == *"fish"* ]]; then
        path_line="fish_add_path $BIN_DIR"
    else
        path_line="export PATH=\"$BIN_DIR:\$PATH\""
    fi

    # Create config file if it doesn't exist
    mkdir -p "$(dirname "$config_file")"
    touch "$config_file"

    # Check if already in config
    if ! grep -q "$BIN_DIR" "$config_file" 2>/dev/null; then
        {
            echo ""
            echo "# Added by Atomic CLI installer"
            echo "$path_line"
        } >> "$config_file"
        info "Added $BIN_DIR to PATH in $config_file"
        return 0
    fi
    return 1
}

# Verify checksum
verify_checksum() {
    local file="$1"
    local checksums_file="$2"
    local filename
    filename=$(basename "$file")

    local expected
    expected=$(grep -F "$filename" "$checksums_file" | awk '{print $1}')

    if [[ -z "$expected" ]]; then
        error "Could not find checksum for $filename"
    fi

    local actual
    if command -v sha256sum >/dev/null; then
        actual=$(sha256sum "$file" | awk '{print $1}')
    elif command -v shasum >/dev/null; then
        actual=$(shasum -a 256 "$file" | awk '{print $1}')
    else
        error "Neither sha256sum nor shasum found for verification"
    fi

    if [[ "$actual" != "$expected" ]]; then
        error "Checksum verification failed!\nExpected: $expected\nActual:   $actual"
    fi

    info "Checksum verified successfully"
}

# Get latest version (stable or prerelease)
get_latest_version() {
    local prerelease="${1:-false}"
    if [[ "$prerelease" == "true" ]]; then
        fetch_url "https://api.github.com/repos/${GITHUB_REPO}/releases" |
            grep -E '"tag_name"|"prerelease"' | paste - - |
            grep '"prerelease": true' | head -1 |
            sed -E 's/.*"tag_name": "([^"]+)".*/\1/'
    else
        fetch_url "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" |
            grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/'
    fi
}

# ─── Tooling helpers ─────────────────────────────────────────────────────────

install_fnm() {
    if command -v fnm >/dev/null 2>&1; then
        info "fnm is already installed"
        return 0
    fi
    info "Installing fnm (Fast Node Manager)..."
    if [[ "$OSTYPE" == darwin* ]] && command -v brew >/dev/null 2>&1; then
        if ! brew install fnm; then
            warn "fnm installation via Homebrew failed"
            return 1
        fi
    else
        if ! curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell; then
            warn "fnm installation failed"
            return 1
        fi
        # Make fnm available in the current session.
        export FNM_DIR="${FNM_DIR:-$HOME/.local/share/fnm}"
        export PATH="$FNM_DIR:$PATH"
        if ! command -v fnm >/dev/null 2>&1; then
            # Some systems install to ~/.fnm
            export PATH="$HOME/.fnm:$PATH"
        fi
    fi
}

ensure_fnm_in_shell_profiles() {
    local marker="# fnm"
    local fnm_dir="${FNM_DIR:-$HOME/.local/share/fnm}"
    local posix_block
    # shellcheck disable=SC2016
    posix_block=$(printf '\n# fnm\nexport FNM_DIR="%s"\nexport PATH="%s:$PATH"\neval "$(fnm env)"\n' \
        "$fnm_dir" "$fnm_dir")
    local fish_block
    # shellcheck disable=SC2016
    fish_block=$(printf '\n# fnm\nset -gx FNM_DIR "%s"\nset -gx PATH "%s" $PATH\nfnm env | source\n' \
        "$fnm_dir" "$fnm_dir")

    for profile in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
        [[ -f "$profile" ]] || continue
        grep -q "$marker" "$profile" 2>/dev/null && continue
        printf '%s' "$posix_block" >> "$profile"
    done

    local fish_config="$HOME/.config/fish/config.fish"
    if [[ -f "$fish_config" ]] && ! grep -q "$marker" "$fish_config" 2>/dev/null; then
        printf '%s' "$fish_block" >> "$fish_config"
    fi
}

install_npm() {
    # Require Node.js 22+ (LTS) for Copilot CLI and modern tooling.
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

    # Preferred: install via fnm (works on macOS + Linux, no root required).
    if install_fnm; then
        if command -v fnm >/dev/null 2>&1; then
            if fnm install --lts && eval "$(fnm env)"; then
                ensure_fnm_in_shell_profiles
                info "Node.js $(node --version) installed via fnm"
                return 0
            fi
            warn "fnm install --lts failed, trying other methods..."
        fi
    fi

    # Fallback: Homebrew (macOS).
    if command -v brew >/dev/null 2>&1; then
        if brew install "node@$NODE_MAJOR" && brew link --overwrite "node@$NODE_MAJOR" 2>/dev/null; then
            return 0
        fi
        if brew install node; then
            return 0
        fi
        warn "brew install node failed, trying other methods..."
    fi

    # Determine privilege escalation command
    local sudo_cmd=""
    if [[ "$(id -u)" -ne 0 ]]; then
        if command -v sudo >/dev/null 2>&1; then
            sudo_cmd="sudo"
        else
            warn "Cannot install Node.js: no sudo and not root"
            return 1
        fi
    fi

    # Debian/Ubuntu: use NodeSource repository for current LTS.
    if command -v apt-get >/dev/null 2>&1; then
        if curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $sudo_cmd bash -; then
            $sudo_cmd apt-get install -y nodejs
            return $?
        fi
        warn "NodeSource setup failed, falling back to system package..."
        $sudo_cmd apt-get update && $sudo_cmd apt-get install -y nodejs npm
        return $?
    fi

    # RHEL/Fedora: use NodeSource repository.
    if command -v dnf >/dev/null 2>&1; then
        if curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | $sudo_cmd bash -; then
            $sudo_cmd dnf install -y nodejs
            return $?
        fi
        $sudo_cmd dnf install -y nodejs npm
        return $?
    fi

    if command -v yum >/dev/null 2>&1; then
        if curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | $sudo_cmd bash -; then
            $sudo_cmd yum install -y nodejs
            return $?
        fi
        $sudo_cmd yum install -y nodejs npm
        return $?
    fi

    # Other Linux package managers: use system defaults (may not be 22+).
    if command -v pacman >/dev/null 2>&1; then
        $sudo_cmd pacman -Sy --noconfirm nodejs npm
    elif command -v zypper >/dev/null 2>&1; then
        $sudo_cmd zypper --non-interactive install nodejs npm
    elif command -v apk >/dev/null 2>&1; then
        $sudo_cmd apk add --no-cache nodejs npm
    else
        warn "No supported package manager found to install Node.js"
        return 1
    fi
}

install_global_npm_package() {
    local pkg="$1"
    info "Installing ${pkg} globally..."
    if command -v npm >/dev/null 2>&1; then
        if npm install -g "$pkg"; then
            return 0
        fi
    fi
    warn "Could not install ${pkg}"
    return 1
}

install_tmux() {
    # Skip if tmux is already installed
    if command -v tmux >/dev/null 2>&1; then
        info "tmux is already installed: $(tmux -V 2>/dev/null || echo 'version unknown')"
        return 0
    fi

    info "Installing tmux..."

    # macOS: Homebrew
    if [[ "$OSTYPE" == darwin* ]] && command -v brew >/dev/null 2>&1; then
        brew install tmux && return 0
    fi

    # Determine privilege escalation command
    local sudo_cmd=""
    if [[ "$(id -u)" -ne 0 ]]; then
        if command -v sudo >/dev/null 2>&1; then
            sudo_cmd="sudo"
        else
            warn "Not running as root and sudo is not available — tmux install may fail"
        fi
    fi

    # Linux: try package managers in order
    if command -v apt-get >/dev/null 2>&1; then
        $sudo_cmd apt-get update -qq && $sudo_cmd apt-get install -y tmux && return 0
    fi
    if command -v dnf >/dev/null 2>&1; then
        $sudo_cmd dnf install -y tmux && return 0
    fi
    if command -v yum >/dev/null 2>&1; then
        $sudo_cmd yum install -y tmux && return 0
    fi
    if command -v pacman >/dev/null 2>&1; then
        $sudo_cmd pacman -Sy --noconfirm tmux && return 0
    fi
    if command -v zypper >/dev/null 2>&1; then
        $sudo_cmd zypper --non-interactive install tmux && return 0
    fi
    if command -v apk >/dev/null 2>&1; then
        $sudo_cmd apk add --no-cache tmux && return 0
    fi

    warn "Could not install tmux — install it manually"
    return 1
}

install_bun() {
    # Skip if bun is already installed
    if command -v bun >/dev/null 2>&1; then
        info "bun is already installed: $(bun --version 2>/dev/null || echo 'version unknown')"
        return 0
    fi

    info "Installing bun..."

    # Preferred: official installer script
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL https://bun.sh/install | bash && return 0
    fi

    # macOS: Homebrew fallback
    if [[ "$OSTYPE" == darwin* ]] && command -v brew >/dev/null 2>&1; then
        brew install oven-sh/bun/bun && return 0
    fi

    warn "Could not install bun — install it manually from https://bun.sh"
    return 1
}

install_apm() {
    if command -v apm >/dev/null 2>&1; then
        info "apm is already installed: $(apm --version 2>/dev/null || echo 'version unknown')"
        return 0
    fi

    info "Installing apm (Agent Package Manager)..."

    # Preferred: official installer script
    if command -v curl >/dev/null 2>&1; then
        if curl -sSL https://aka.ms/apm-unix | sh; then
            # The installer may place apm in ~/.local/bin or similar; ensure it's on PATH
            for apm_candidate in "$HOME/.local/bin/apm" "$HOME/bin/apm" "/usr/local/bin/apm"; do
                if [[ -x "$apm_candidate" ]]; then
                    export PATH="$(dirname "$apm_candidate"):$PATH"
                    break
                fi
            done
            if command -v apm >/dev/null 2>&1; then
                return 0
            fi
        fi
        warn "apm official installer failed, trying fallbacks..."
    fi

    # Fallback: Homebrew (macOS/Linux)
    if command -v brew >/dev/null 2>&1; then
        if brew install microsoft/apm/apm; then
            return 0
        fi
        warn "brew install apm failed, trying other methods..."
    fi

    # Fallback: pip
    if command -v pip3 >/dev/null 2>&1; then
        if pip3 install apm-cli; then
            # pip installs to a scripts dir that may not be on PATH yet
            local pip_bin
            pip_bin=$(python3 -m site --user-base 2>/dev/null)/bin
            [[ -d "$pip_bin" ]] && export PATH="$pip_bin:$PATH"
            command -v apm >/dev/null 2>&1 && return 0
        fi
    elif command -v pip >/dev/null 2>&1; then
        if pip install apm-cli; then
            local pip_bin
            pip_bin=$(python -m site --user-base 2>/dev/null)/bin
            [[ -d "$pip_bin" ]] && export PATH="$pip_bin:$PATH"
            command -v apm >/dev/null 2>&1 && return 0
        fi
    fi

    warn "Could not install apm — install it manually from https://microsoft.github.io/apm/"
    return 1
}

install_apm_global_config() {
    local config_dir="$1"

    if ! command -v apm >/dev/null 2>&1; then
        warn "apm not found — skipping global config install"
        return 0
    fi

    if [[ ! -f "${config_dir}/apm.yml" ]]; then
        return 0
    fi

    info "Installing APM dependencies globally..."
    if (cd "$config_dir" && apm install -g 2>&1); then
        success "APM global config installed"
    else
        warn "APM global config install failed (non-fatal)"
    fi
}

# Merge-copy the bundled Atomic agents from the extracted config data dir
# into the provider-native global roots (~/.claude/agents, ~/.opencode/agents,
# ~/.copilot/agents). Uses `cp -R src/. dest/` which overwrites files sharing
# a name with a bundled file and preserves any extra user-added files.
#
# Copilot's lsp.json is written to ~/.copilot/lsp-config.json per the
# in-binary rename in atomic-global-config.ts.
install_global_agents() {
    local config_dir="$1"

    info "Installing bundled Atomic agents into provider global roots..."

    local pair src dest
    for pair in \
        ".claude/agents:${HOME}/.claude/agents" \
        ".opencode/agents:${HOME}/.opencode/agents" \
        ".github/agents:${HOME}/.copilot/agents"
    do
        src="${config_dir}/${pair%%:*}"
        dest="${pair#*:}"
        if [[ ! -d "$src" ]]; then
            warn "Bundled agents missing at ${src} — skipping ${dest}"
            continue
        fi
        mkdir -p "$dest"
        if cp -R "$src/." "$dest/"; then
            info "Synced ${dest}"
        else
            warn "Failed to sync ${dest} (non-fatal)"
        fi
    done

    local lsp_src="${config_dir}/.github/lsp.json"
    local lsp_dest="${HOME}/.copilot/lsp-config.json"
    if [[ -f "$lsp_src" ]]; then
        mkdir -p "$(dirname "$lsp_dest")"
        if cp "$lsp_src" "$lsp_dest"; then
            info "Synced ${lsp_dest}"
        else
            warn "Failed to sync ${lsp_dest} (non-fatal)"
        fi
    fi

    success "Global agent configs installed"
}

# Install all bundled skills globally via `npx skills`, then remove the
# source-control variants (gh-*/sl-*) so `atomic init` can install them
# locally per-project based on the user's selected SCM + active agent.
install_global_skills() {
    if ! command -v npx >/dev/null 2>&1; then
        warn "npx not found — skipping global skills install"
        return 0
    fi

    local skills_repo="https://github.com/flora131/atomic.git"
    local -a agent_flags=(-a claude-code -a opencode -a github-copilot)

    info "Installing all bundled skills globally via npx skills..."
    if ! npx --yes skills add "$skills_repo" --skill '*' -g "${agent_flags[@]}" -y; then
        warn "'npx skills add' failed (non-fatal)"
        return 0
    fi

    info "Removing source-control skill variants globally (installed per-project by 'atomic init')..."
    if ! npx --yes skills remove \
        --skill 'gh-commit' \
        --skill 'gh-create-pr' \
        --skill 'sl-commit' \
        --skill 'sl-submit-diff' \
        -g "${agent_flags[@]}" -y; then
        warn "'npx skills remove' failed (non-fatal)"
        return 0
    fi

    success "Global skills installed"
}

install_tooling() {
    info "Installing required tooling (npm, tmux, bun, playwright-cli, liteparse, apm)..."
    local failed_tools=()

    # Phase 1: core tools
    install_npm || { warn "npm installation skipped or failed — install Node.js manually from https://nodejs.org"; failed_tools+=("npm"); }
    install_tmux || { warn "tmux installation skipped or failed — install tmux manually"; failed_tools+=("tmux"); }
    install_bun || { warn "bun installation skipped or failed — install bun manually from https://bun.sh"; failed_tools+=("bun"); }

    # Phase 2: global CLI tools
    install_global_npm_package "@playwright/cli@latest"        || { warn "@playwright/cli installation skipped or failed"; failed_tools+=("@playwright/cli"); }
    install_global_npm_package "@llamaindex/liteparse@latest"  || { warn "@llamaindex/liteparse installation skipped or failed"; failed_tools+=("@llamaindex/liteparse"); }
    install_apm                                                || { warn "apm installation skipped or failed"; failed_tools+=("apm"); }

    # Summary
    if [[ ${#failed_tools[@]} -gt 0 ]]; then
        echo ""
        warn "┌─────────────────────────────────────────────────────┐"
        warn "│ The following tools failed to install:              │"
        for tool in "${failed_tools[@]}"; do
            printf -v line "│   • %-48s│" "${tool}"
            warn "$line"
        done
        warn "│ Install them manually before using Atomic CLI.      │"
        warn "└─────────────────────────────────────────────────────┘"
    fi

    success "Tooling setup complete"
}

# Install bundled workflow templates to ~/.atomic/workflows/
# Copies from the config data dir, skipping existing workflow directories
# to preserve user customizations. Shared files (package.json, tsconfig,
# helpers) are always updated to ensure SDK compatibility.
install_workflows() {
    local src_dir="${DATA_DIR}/.atomic/workflows"
    local dest_dir="${ATOMIC_HOME}/workflows"

    if [[ ! -d "$src_dir" ]]; then
        return 0
    fi

    info "Installing workflow templates to ${dest_dir}..."
    mkdir -p "$dest_dir"

    # Enumerate source: copy root files and non-agent directories (always update),
    # then handle agent directories with per-workflow skip-if-exists logic.
    for entry in "$src_dir"/*; do
        [[ -e "$entry" ]] || continue
        local name
        name=$(basename "$entry")
        [[ "$name" == "node_modules" ]] && continue

        if [[ -f "$entry" ]]; then
            cp "$entry" "$dest_dir/$name"
        elif [[ -d "$entry" ]]; then
            case "$name" in
                copilot|opencode|claude) ;; # handled below
                *) mkdir -p "$dest_dir/$name" && cp -r "$entry/." "$dest_dir/$name/" ;;
            esac
        fi
    done
    # Copy dotfiles (only .gitignore — skip other hidden files to match TS behavior)
    if [[ -f "$src_dir/.gitignore" ]]; then
        cp "$src_dir/.gitignore" "$dest_dir/.gitignore"
    fi

    # Copy per-agent workflow directories (skip existing to preserve user customizations)
    local copied=0
    for agent in copilot opencode claude; do
        local agent_src="$src_dir/$agent"
        if [[ ! -d "$agent_src" ]]; then
            continue
        fi
        mkdir -p "$dest_dir/$agent"
        for workflow_dir in "$agent_src"/*/; do
            [[ -d "$workflow_dir" ]] || continue
            local workflow_name
            workflow_name=$(basename "$workflow_dir")
            local dest_workflow="$dest_dir/$agent/$workflow_name"
            if [[ ! -d "$dest_workflow" ]]; then
                cp -r "$workflow_dir" "$dest_workflow"
                copied=$((copied + 1))
            fi
        done
    done

    # Install SDK dependency
    if command -v bun >/dev/null 2>&1; then
        (cd "$dest_dir" && bun install 2>/dev/null) || warn "Workflow dependency install failed (non-fatal)"
    elif command -v npm >/dev/null 2>&1; then
        (cd "$dest_dir" && npm install 2>/dev/null) || warn "Workflow dependency install failed (non-fatal)"
    fi

    success "Workflow templates installed (${copied} new workflow(s))"
}

# ─────────────────────────────────────────────────────────────────────────────

# Main installation
main() {
    local version="" prerelease="false"

    # Parse arguments early so they're available for Windows delegation
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --prerelease) prerelease="true"; shift ;;
            *) version="$1"; shift ;;
        esac
    done

    # Support VERSION env var (e.g., VERSION=v1.0.0 curl ... | bash)
    if [[ -z "$version" && -n "${VERSION:-}" ]]; then
        if [[ "$VERSION" == "prerelease" ]]; then
            prerelease="true"
        elif [[ "$VERSION" != "latest" ]]; then
            version="$VERSION"
        fi
    fi

    # Export for Windows PowerShell installer delegation
    export ATOMIC_INSTALL_VERSION="$version"
    export ATOMIC_INSTALL_PRERELEASE="$prerelease"

    local platform download_url checksums_url config_url tmp_dir

    # Check dependencies
    command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || error "curl or wget is required to install ${BINARY_NAME}"
    command -v tar >/dev/null || error "tar is required to install ${BINARY_NAME}"

    # Handle Windows delegation before command substitution — exit inside $() only
    # exits the subshell, not the parent script, so we must check here.
    case "$(uname -s | tr '[:upper:]' '[:lower:]')" in
        mingw*|msys*|cygwin*)
            info "Windows detected, delegating to PowerShell installer..."
            local ps_args=""
            if [[ -n "${ATOMIC_INSTALL_VERSION:-}" ]]; then
                if [[ ! "${ATOMIC_INSTALL_VERSION}" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
                    error "Invalid version format: ${ATOMIC_INSTALL_VERSION} (expected semver like v1.2.3 or v1.2.3-1)"
                fi
                ps_args="${ps_args} -Version '${ATOMIC_INSTALL_VERSION}'"
            fi
            if [[ "${ATOMIC_INSTALL_PRERELEASE:-}" == "true" ]]; then
                ps_args="${ps_args} -Prerelease"
            fi
            if ! command -v pwsh &>/dev/null; then
                error "PowerShell 7+ (pwsh) is required but not found. Install it from https://aka.ms/install-powershell"
            fi
            pwsh -Command "iex \"& { \$(irm https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.ps1) }${ps_args}\""
            exit $?
            ;;
    esac

    # Detect platform
    platform=$(detect_platform)
    info "Detected platform: $platform"

    # Get version
    if [[ -z "$version" ]]; then
        version=$(get_latest_version "$prerelease")
        if [[ -z "$version" ]]; then
            error "No ${prerelease:+pre}release found"
        fi
        if [[ "$prerelease" == "true" ]]; then
            info "Latest prerelease: $version"
        else
            info "Latest version: $version"
        fi
    fi

    # Validate version format to prevent URL manipulation
    if [[ ! "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
        error "Invalid version format: $version (expected semver like v1.2.3 or v1.2.3-1)"
    fi

    # Setup directories
    mkdir -p "$BIN_DIR"
    mkdir -p "$DATA_DIR"
    tmp_dir=$(mktemp -d)
    trap 'rm -rf "${tmp_dir:-}"' EXIT

    # Download URLs
    local base_url="https://github.com/${GITHUB_REPO}/releases/download/${version}"
    download_url="${base_url}/${BINARY_NAME}-${platform}"
    config_url="${base_url}/${BINARY_NAME}-config.tar.gz"
    checksums_url="${base_url}/checksums.txt"

    # Download binary
    info "Downloading ${BINARY_NAME} ${version}..."
    download_file "$download_url" "${tmp_dir}/${BINARY_NAME}-${platform}" ||
        error "Failed to download binary from ${download_url}"

    # Download config files
    info "Downloading config files..."
    download_file "$config_url" "${tmp_dir}/${BINARY_NAME}-config.tar.gz" ||
        error "Failed to download config files from ${config_url}"

    # Download checksums
    info "Downloading checksums..."
    download_file "$checksums_url" "${tmp_dir}/checksums.txt" "true" ||
        error "Failed to download checksums from ${checksums_url}"

    # Verify checksums
    verify_checksum "${tmp_dir}/${BINARY_NAME}-${platform}" "${tmp_dir}/checksums.txt"
    verify_checksum "${tmp_dir}/${BINARY_NAME}-config.tar.gz" "${tmp_dir}/checksums.txt"

    # Validate downloaded config archive
    if ! tar -tzf "${tmp_dir}/${BINARY_NAME}-config.tar.gz" >/dev/null 2>&1; then
        error "Downloaded config archive is not a valid tarball or is corrupted."
    fi

    # Notice when replacing existing binary
    if [[ -f "${BIN_DIR}/${BINARY_NAME}" ]]; then
        info "Replacing existing ${BINARY_NAME} binary at ${BIN_DIR}/${BINARY_NAME}"
    fi

    # Install binary
    mv "${tmp_dir}/${BINARY_NAME}-${platform}" "${BIN_DIR}/${BINARY_NAME}"
    chmod +x "${BIN_DIR}/${BINARY_NAME}"

    # Extract config files to data directory without deleting existing user files
    info "Installing config files to ${DATA_DIR}..."
    mkdir -p "$DATA_DIR"
    tar -xzf "${tmp_dir}/${BINARY_NAME}-config.tar.gz" -C "$DATA_DIR"

    # Verify installation
    "${BIN_DIR}/${BINARY_NAME}" --version >/dev/null 2>&1 ||
        error "Installation verification failed"

    success "Installed ${BINARY_NAME} ${version} to ${BIN_DIR}/${BINARY_NAME}"
    success "Config files installed to ${DATA_DIR}"

    # Install required tooling
    install_tooling

    # Install bundled workflow templates to ~/.atomic/workflows/
    install_workflows

    # Install APM dependencies globally (deploys to ~/.copilot/, ~/.claude/, etc.)
    install_apm_global_config "$DATA_DIR"

    # Merge-copy the bundled agent definitions into ~/.claude/agents,
    # ~/.opencode/agents, ~/.copilot/agents (+ ~/.copilot/lsp-config.json).
    # User-added files in those dirs are preserved.
    install_global_agents "$DATA_DIR"

    # Install bundled skills globally, minus the source-control variants
    # (those are installed per-project by `atomic init`).
    install_global_skills

    # Persist prerelease channel preference in settings (atomic write via temp + mv)
    local settings_file="${ATOMIC_HOME}/settings.json"
    mkdir -p "$ATOMIC_HOME"
    if [[ "$prerelease" == "true" ]]; then
        local prerelease_value="true"
    else
        local prerelease_value="false"
    fi
    local settings_tmp
    settings_tmp=$(mktemp "${ATOMIC_HOME}/settings.json.XXXXXX")
    if [[ -f "$settings_file" ]]; then
        if grep -q '"prerelease"' "$settings_file" 2>/dev/null; then
            sed "s/\"prerelease\":[^,}]*/\"prerelease\": ${prerelease_value}/" "$settings_file" > "$settings_tmp"
        else
            # Insert before closing brace
            sed "s/}$/,\n  \"prerelease\": ${prerelease_value}\n}/" "$settings_file" > "$settings_tmp"
        fi
    else
        printf '{\n  "prerelease": %s\n}\n' "$prerelease_value" > "$settings_tmp"
    fi
    mv "$settings_tmp" "$settings_file"
    if [[ "$prerelease" == "true" ]]; then
        info "Prerelease channel enabled in ${settings_file}"
    fi

    # Update PATH in shell config
    if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
        local config_file path_line
        config_file=$(detect_shell_config)

        if [[ "$config_file" == *"fish"* ]]; then
            path_line="fish_add_path $BIN_DIR"
        else
            path_line="export PATH=\"$BIN_DIR:\$PATH\""
        fi

        # Prompt user to add to shell config (only if interactive)
        if [ -t 0 ] || [ -e /dev/tty ]; then
            echo ""
            printf "Would you like to add %s to your PATH in %s? [y/N] " "$BIN_DIR" "$config_file"
            if read -r REPLY </dev/tty 2>/dev/null; then
                if [[ "$REPLY" == "y" || "$REPLY" == "Y" ]]; then
                    add_to_path "$config_file"
                    echo ""
                    warn "Restart your shell or run: source $config_file"
                fi
            fi
        else
            echo ""
            info "$BIN_DIR is not in your PATH."
            info "To add it permanently, add this to $config_file:"
            echo "  $path_line"
        fi

        echo ""
        success "Installation complete! To get started, run:"
        echo "  $path_line && ${BINARY_NAME} --help"
    else
        echo ""
        success "Run '${BINARY_NAME} --help' to get started!"
    fi
}

main "$@"
