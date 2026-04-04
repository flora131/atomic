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
# (bun, npm, uv, @playwright/cli, @llamaindex/liteparse).

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

# Return the bun executable path, checking PATH first then the default install location.
resolve_bun() {
    local bun_in_path
    bun_in_path=$(command -v bun 2>/dev/null) && echo "$bun_in_path" && return 0
    local default_bun="${BUN_INSTALL:-$HOME/.bun}/bin/bun"
    [[ -x "$default_bun" ]] && echo "$default_bun" && return 0
    return 1
}

install_bun() {
    if resolve_bun >/dev/null 2>&1; then
        info "bun is already installed"
        return 0
    fi
    info "Installing bun..."
    if ! curl -fsSL https://bun.sh/install | bash; then
        warn "bun installation failed"
        return 1
    fi
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
}

install_npm() {
    if command -v npm >/dev/null 2>&1; then
        info "npm is already installed"
        return 0
    fi
    info "Installing Node.js/npm..."
    if command -v brew >/dev/null 2>&1; then
        if brew install node; then
            return 0
        fi
        warn "brew install node failed, trying system package managers..."
    fi
    # Determine privilege escalation command
    local sudo_cmd=""
    if [[ "$(id -u)" -ne 0 ]]; then
        if command -v sudo >/dev/null 2>&1; then
            sudo_cmd="sudo"
        else
            warn "Cannot install npm: no sudo and not root"
            return 1
        fi
    fi

    if command -v apt-get >/dev/null 2>&1; then
        $sudo_cmd apt-get update && $sudo_cmd apt-get install -y nodejs npm
    elif command -v dnf >/dev/null 2>&1; then
        $sudo_cmd dnf install -y nodejs npm
    elif command -v yum >/dev/null 2>&1; then
        $sudo_cmd yum install -y nodejs npm
    elif command -v pacman >/dev/null 2>&1; then
        $sudo_cmd pacman -Sy --noconfirm nodejs npm
    elif command -v zypper >/dev/null 2>&1; then
        $sudo_cmd zypper --non-interactive install nodejs npm
    elif command -v apk >/dev/null 2>&1; then
        $sudo_cmd apk add --no-cache nodejs npm
    else
        warn "No supported package manager found to install npm"
        return 1
    fi
}

install_uv() {
    if command -v uv >/dev/null 2>&1 || [[ -x "$HOME/.local/bin/uv" ]]; then
        info "uv is already installed"
        return 0
    fi
    info "Installing uv..."
    if ! curl -LsSf https://astral.sh/uv/install.sh | sh; then
        warn "uv installation failed"
        return 1
    fi
    export PATH="$HOME/.local/bin:$PATH"
}

install_global_bun_package() {
    local pkg="$1"
    info "Installing ${pkg} globally..."
    local bun_path
    bun_path=$(resolve_bun 2>/dev/null) || true
    if [[ -n "$bun_path" ]]; then
        if "$bun_path" install -g "$pkg"; then
            return 0
        fi
        warn "bun failed to install ${pkg}, trying npm..."
    fi
    if command -v npm >/dev/null 2>&1; then
        if npm install -g "$pkg"; then
            return 0
        fi
    fi
    warn "Could not install ${pkg}"
    return 1
}

trust_bun_global_packages() {
    local bun_path
    bun_path=$(resolve_bun 2>/dev/null) || return 0
    local global_dir="${BUN_INSTALL:-$HOME/.bun}/install/global"
    [[ -d "$global_dir" ]] || return 0
    info "Trusting global bun packages..."
    (cd "$global_dir" && "$bun_path" pm trust @playwright/cli @llamaindex/liteparse 2>/dev/null || true)
}

ensure_bun_bin_in_shell_profiles() {
    local bun_install_root="${BUN_INSTALL:-$HOME/.bun}"
    local bun_bin_dir="$bun_install_root/bin"
    local marker="# bun"
    local posix_block
    # shellcheck disable=SC2016
    posix_block=$(printf '\n# bun\nexport BUN_INSTALL="%s"\nexport PATH="%s:$PATH"\n' \
        "$bun_install_root" "$bun_bin_dir")
    local fish_block
    # shellcheck disable=SC2016
    fish_block=$(printf '\n# bun\nset --export BUN_INSTALL "%s"\nset --export PATH %s $PATH\n' \
        "$bun_install_root" "$bun_bin_dir")

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

install_tooling() {
    info "Installing required tooling (bun, npm, uv, playwright-cli, liteparse)..."
    local failed_tools=()

    # Phase 1: package managers
    install_bun || { warn "bun installation skipped or failed — install manually from https://bun.sh"; failed_tools+=("bun"); }
    install_npm || { warn "npm installation skipped or failed — install Node.js manually from https://nodejs.org"; failed_tools+=("npm"); }
    install_uv  || { warn "uv installation skipped or failed — install manually from https://docs.astral.sh/uv/"; failed_tools+=("uv"); }

    # Phase 2: global CLI tools
    install_global_bun_package "@playwright/cli@latest"        || { warn "@playwright/cli installation skipped or failed"; failed_tools+=("@playwright/cli"); }
    install_global_bun_package "@llamaindex/liteparse@latest"  || { warn "@llamaindex/liteparse installation skipped or failed"; failed_tools+=("@llamaindex/liteparse"); }

    # Phase 3: trust lifecycle scripts for globally installed bun packages
    trust_bun_global_packages

    # Phase 4: ensure ~/.bun/bin is in shell profiles
    ensure_bun_bin_in_shell_profiles

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
