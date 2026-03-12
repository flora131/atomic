#!/usr/bin/env bash
# Atomic CLI Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
# Usage with version: curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash -s -- v1.0.0
# Usage prerelease: curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash -s -- --prerelease

set -euo pipefail

# Configuration
GITHUB_REPO="flora131/atomic"
BINARY_NAME="atomic"
BIN_DIR="${ATOMIC_INSTALL_DIR:-$HOME/.local/bin}"
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

run_with_optional_sudo() {
    if [[ "$(id -u)" -eq 0 ]]; then
        "$@"
    elif command -v sudo >/dev/null 2>&1; then
        sudo "$@"
    else
        return 1
    fi
}

install_bun_if_missing() {
    if command -v bun >/dev/null 2>&1; then
        return 0
    fi

    info "bun not detected. Installing bun..."
    if curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1; then
        export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
        export PATH="$BUN_INSTALL/bin:$PATH"
    fi

    if command -v bun >/dev/null 2>&1; then
        info "bun installed successfully"
        return 0
    fi

    warn "Failed to install bun automatically. Install bun manually from https://bun.sh"
    return 1
}

install_npm_if_missing() {
    if command -v npm >/dev/null 2>&1; then
        return 0
    fi

    info "npm not detected. Installing Node.js/npm..."
    local installed=0

    if command -v brew >/dev/null 2>&1; then
        if brew install node >/dev/null 2>&1; then installed=1; fi
    elif command -v apt-get >/dev/null 2>&1; then
        if run_with_optional_sudo apt-get update >/dev/null 2>&1 &&
            run_with_optional_sudo apt-get install -y nodejs npm >/dev/null 2>&1; then
            installed=1
        fi
    elif command -v dnf >/dev/null 2>&1; then
        if run_with_optional_sudo dnf install -y nodejs npm >/dev/null 2>&1; then installed=1; fi
    elif command -v yum >/dev/null 2>&1; then
        if run_with_optional_sudo yum install -y nodejs npm >/dev/null 2>&1; then installed=1; fi
    elif command -v pacman >/dev/null 2>&1; then
        if run_with_optional_sudo pacman -Sy --noconfirm nodejs npm >/dev/null 2>&1; then installed=1; fi
    elif command -v zypper >/dev/null 2>&1; then
        if run_with_optional_sudo zypper --non-interactive install nodejs npm >/dev/null 2>&1; then installed=1; fi
    elif command -v apk >/dev/null 2>&1; then
        if run_with_optional_sudo apk add --no-cache nodejs npm >/dev/null 2>&1; then installed=1; fi
    fi

    if [[ $installed -eq 1 ]] && command -v npm >/dev/null 2>&1; then
        info "npm installed successfully"
        return 0
    fi

    warn "Failed to install npm automatically. Install Node.js/npm manually."
    return 1
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
            # Delegate to PowerShell on Windows
            info "Windows detected, delegating to PowerShell installer..."
            powershell -c "irm https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.ps1 | iex"
            exit $?
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

# Sync bundled config templates into provider home roots for global discovery
# Installs only Atomic-managed agents and skills; provider config JSON files are
# onboarded per-workspace by `atomic init`.
sync_global_agent_configs() {
    local source_root="$1"

    mkdir -p "$HOME/.claude/agents" "$HOME/.claude/skills"
    mkdir -p "$HOME/.opencode/agents" "$HOME/.opencode/skills"
    mkdir -p "$HOME/.copilot/agents" "$HOME/.copilot/skills"

    cp -R "$source_root/.claude/agents/." "$HOME/.claude/agents/"
    cp -R "$source_root/.claude/skills/." "$HOME/.claude/skills/"
    cp -R "$source_root/.opencode/agents/." "$HOME/.opencode/agents/"
    cp -R "$source_root/.opencode/skills/." "$HOME/.opencode/skills/"
    cp -R "$source_root/.github/agents/." "$HOME/.copilot/agents/"
    cp -R "$source_root/.github/skills/." "$HOME/.copilot/skills/"

    # Remove SCM-managed skills from global config; these are project-scoped.
    rm -rf "$HOME/.claude/skills/gh-"* "$HOME/.claude/skills/sl-"* 2>/dev/null || true
    rm -rf "$HOME/.opencode/skills/gh-"* "$HOME/.opencode/skills/sl-"* 2>/dev/null || true
    rm -rf "$HOME/.copilot/skills/gh-"* "$HOME/.copilot/skills/sl-"* 2>/dev/null || true

    install_bun_if_missing || true
    install_npm_if_missing || true

    # Install @playwright/cli globally if a package manager is available.
    # Do not install Chromium browsers here; defer to first use.
    info "Installing @playwright/cli globally (if available)..."
    if command -v bun >/dev/null 2>&1; then
        bun install -g @playwright/cli@latest 2>/dev/null || true
    elif command -v npm >/dev/null 2>&1; then
        npm install -g @playwright/cli@latest 2>/dev/null || true
    else
        warn "Neither bun nor npm found. Install @playwright/cli manually for web browsing capabilities."
    fi
}

# Get latest version (stable or prerelease)
get_latest_version() {
    local prerelease="${1:-false}"
    if [[ "$prerelease" == "true" ]]; then
        curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases" |
            grep -E '"tag_name"|"prerelease"' | paste - - |
            grep '"prerelease": true' | head -1 |
            sed -E 's/.*"tag_name": "([^"]+)".*/\1/'
    else
        curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" |
            grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/'
    fi
}

# Main installation
main() {
    local version="" prerelease="false"

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --prerelease) prerelease="true"; shift ;;
            *) version="$1"; shift ;;
        esac
    done

    local platform download_url checksums_url config_url tmp_dir

    # Check dependencies
    command -v curl >/dev/null || error "curl is required to install ${BINARY_NAME}"
    command -v tar >/dev/null || error "tar is required to install ${BINARY_NAME}"

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
    curl --fail --location --progress-bar --output "${tmp_dir}/${BINARY_NAME}-${platform}" "$download_url" ||
        error "Failed to download binary from ${download_url}"

    # Download config files
    info "Downloading config files..."
    curl --fail --location --progress-bar --output "${tmp_dir}/${BINARY_NAME}-config.tar.gz" "$config_url" ||
        error "Failed to download config files from ${config_url}"

    # Download checksums
    info "Downloading checksums..."
    curl -fsSL --output "${tmp_dir}/checksums.txt" "$checksums_url" ||
        error "Failed to download checksums from ${checksums_url}"

    # Verify checksums
    verify_checksum "${tmp_dir}/${BINARY_NAME}-${platform}" "${tmp_dir}/checksums.txt"
    verify_checksum "${tmp_dir}/${BINARY_NAME}-config.tar.gz" "${tmp_dir}/checksums.txt"

    # Install binary
    mv "${tmp_dir}/${BINARY_NAME}-${platform}" "${BIN_DIR}/${BINARY_NAME}"
    chmod +x "${BIN_DIR}/${BINARY_NAME}"

    # Extract config files to data directory (clean install)
    info "Installing config files to ${DATA_DIR}..."
    rm -rf "$DATA_DIR"
    mkdir -p "$DATA_DIR"
    tar -xzf "${tmp_dir}/${BINARY_NAME}-config.tar.gz" -C "$DATA_DIR"

    info "Syncing global agent configs to provider home roots..."
    sync_global_agent_configs "$DATA_DIR"

    # Verify installation
    "${BIN_DIR}/${BINARY_NAME}" --version >/dev/null 2>&1 ||
        error "Installation verification failed"

    success "Installed ${BINARY_NAME} ${version} to ${BIN_DIR}/${BINARY_NAME}"
    success "Config files installed to ${DATA_DIR}"
    success "Global agent configs synced to ~/.claude, ~/.opencode, and ~/.copilot"

    # Persist prerelease channel preference in settings
    local settings_file="${ATOMIC_HOME}/settings.json"
    mkdir -p "$ATOMIC_HOME"
    if [[ "$prerelease" == "true" ]]; then
        local prerelease_value="true"
    else
        local prerelease_value="false"
    fi
    if [[ -f "$settings_file" ]]; then
        if grep -q '"prerelease"' "$settings_file" 2>/dev/null; then
            sed -i "s/\"prerelease\":[^,}]*/\"prerelease\": ${prerelease_value}/" "$settings_file"
        else
            # Insert before closing brace
            sed -i "s/}$/,\n  \"prerelease\": ${prerelease_value}\n}/" "$settings_file"
        fi
    else
        printf '{\n  "prerelease": %s\n}\n' "$prerelease_value" > "$settings_file"
    fi
    if [[ "$prerelease" == "true" ]]; then
        info "Prerelease channel enabled in ${settings_file}"
    fi

    # Update PATH in shell config
    if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
        local config_file
        config_file=$(detect_shell_config)

        if add_to_path "$config_file"; then
            echo ""
            warn "Restart your shell or run: source $config_file"
        fi
    fi

    echo ""
    success "Run 'atomic --help' to get started!"
}

main "$@"
