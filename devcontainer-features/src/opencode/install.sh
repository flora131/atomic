#!/usr/bin/env bash
#-------------------------------------------------------------------------------------------------------------
# Installs the Atomic CLI binary only. Config data, agent config syncing,
# tooling and SDK installation
# are all handled on first `atomic init` / `atomic chat` run via auto-init.
#
# NOTE: This script is duplicated across claude, copilot, and opencode features.
#       Keep all three copies in sync when making changes.
#       See: devcontainer-features/src/{claude,copilot,opencode}/install.sh
#-------------------------------------------------------------------------------------------------------------

set -e

if [ "$(id -u)" -ne 0 ]; then
    echo 'Script must be run as root.' >&2
    exit 1
fi

# ─── Ensure prerequisites ───────────────────────────────────────────────────
check_packages() {
    if ! dpkg -s "$@" > /dev/null 2>&1; then
        if [ "$(find /var/lib/apt/lists/* 2>/dev/null | wc -l)" = "0" ]; then
            apt-get update -y
        fi
        apt-get -y install --no-install-recommends "$@"
    fi
}

check_packages curl ca-certificates unzip jq

# ─── Detect architecture ────────────────────────────────────────────────────
arch=$(dpkg --print-architecture)
if [ "${arch}" = "amd64" ]; then arch="x64"; fi
if [ "${arch}" != "x64" ] && [ "${arch}" != "arm64" ]; then
    echo "Unsupported architecture: ${arch}" >&2
    exit 1
fi

# ─── Resolve version ────────────────────────────────────────────────────────
ATOMIC_VERSION="${VERSION:-latest}"
GITHUB_REPO="flora131/atomic"

# Support GITHUB_TOKEN for authenticated API requests (avoids rate limits)
CURL_AUTH_ARGS=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
    CURL_AUTH_ARGS=(-H "Authorization: token ${GITHUB_TOKEN}")
fi

if [ "${ATOMIC_VERSION}" = "latest" ]; then
    ATOMIC_VERSION=$(curl -fsSL ${CURL_AUTH_ARGS[@]+"${CURL_AUTH_ARGS[@]}"} \
        "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
        | jq -r '.tag_name')
elif [ "${ATOMIC_VERSION}" = "prerelease" ]; then
    ATOMIC_VERSION=$(curl -fsSL ${CURL_AUTH_ARGS[@]+"${CURL_AUTH_ARGS[@]}"} \
        "https://api.github.com/repos/${GITHUB_REPO}/releases" \
        | jq -r '[.[] | select(.prerelease == true)][0].tag_name')
fi

# Validate that version resolution succeeded
if [ -z "${ATOMIC_VERSION}" ] || [ "${ATOMIC_VERSION}" = "null" ]; then
    echo "Error: Failed to resolve Atomic CLI version. No matching release found." >&2
    exit 1
fi

# Validate semver format (vMAJOR.MINOR.PATCH with optional numeric prerelease suffix)
if ! echo "${ATOMIC_VERSION}" | grep -qE '^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+)?$'; then
    echo "Error: Resolved version '${ATOMIC_VERSION}' is not a valid semver format." >&2
    echo "Expected format: vMAJOR.MINOR.PATCH (e.g., v1.0.0 or v1.0.0-1)" >&2
    exit 1
fi

case "$ATOMIC_VERSION" in v*) ;; *) ATOMIC_VERSION="v${ATOMIC_VERSION}" ;; esac

echo "Installing Atomic CLI ${ATOMIC_VERSION} (linux-${arch})..."

# ─── Resolve remote user install dir ────────────────────────────────────────
# Devcontainer CLI exposes _REMOTE_USER and _REMOTE_USER_HOME at feature-install
# time. Fall back gracefully if the feature is invoked outside the devcontainer
# CLI (e.g. local testing).
REMOTE_USER="${_REMOTE_USER:-${USERNAME:-vscode}}"
REMOTE_HOME="${_REMOTE_USER_HOME:-/home/${REMOTE_USER}}"
if [ ! -d "${REMOTE_HOME}" ]; then
    echo "Error: remote user home directory '${REMOTE_HOME}' does not exist" >&2
    exit 1
fi
INSTALL_DIR="${REMOTE_HOME}/.local/bin"

# ─── Download and install binary ────────────────────────────────────────────
mkdir -p "${INSTALL_DIR}"
curl -fL# ${CURL_AUTH_ARGS[@]+"${CURL_AUTH_ARGS[@]}"} -o "${INSTALL_DIR}/atomic" \
    "https://github.com/${GITHUB_REPO}/releases/download/${ATOMIC_VERSION}/atomic-linux-${arch}"
chmod +x "${INSTALL_DIR}/atomic"

# Hand ownership of ~/.local (bin + sibling state dirs created later by the
# binary) to the remote user so `atomic update` / `atomic uninstall` work
# without sudo. Fall back to single-arg chown when user:group form fails.
chown -R "${REMOTE_USER}:${REMOTE_USER}" "${REMOTE_HOME}/.local" 2>/dev/null || \
    chown -R "${REMOTE_USER}" "${REMOTE_HOME}/.local" 2>/dev/null || true

# Ensure ~/.local/bin is on PATH for login shells in every base image
# (Ubuntu/Debian default .profile already does this, but Alpine/Fedora/etc.
# may not). /etc/profile.d is sourced by login shells — VSCode devcontainer
# terminals default to login shells, so this covers the common case.
cat > /etc/profile.d/atomic-path.sh <<'PROFILE_EOF'
if [ -d "$HOME/.local/bin" ]; then
    case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *) export PATH="$HOME/.local/bin:$PATH" ;;
    esac
fi
PROFILE_EOF
chmod 644 /etc/profile.d/atomic-path.sh

echo "✓ Atomic CLI installed to ${INSTALL_DIR}/atomic"

# ─── Install global npm CLI tools ───────────────────────────────────────────
# Source NVM (installed by the dependent node feature) so npm resolves to the
# NVM-managed binary, then fix group permissions so the non-root container user
# (already in the `nvm` group) can install packages later without permission errors.
# This mirrors how devcontainers/features/node installs pnpm.
NVM_DIR="${NVM_DIR:-"/usr/local/share/nvm"}"
echo "Installing global npm CLI tools..."
if [ -s "${NVM_DIR}/nvm.sh" ]; then
    (. "${NVM_DIR}/nvm.sh" && npm install -g @playwright/cli @llamaindex/liteparse) 2>&1 \
        && { echo "✓ Global npm CLI tools installed"; chmod -R g+rw "${NVM_DIR}/versions" 2>/dev/null || true; } \
        || echo "⚠ Some global npm CLI tools failed to install (non-fatal)"
else
    npm install -g @playwright/cli @llamaindex/liteparse 2>&1 \
        && echo "✓ Global npm CLI tools installed" \
        || echo "⚠ Some global npm CLI tools failed to install (non-fatal)"
fi
command -v playwright >/dev/null && echo "✓ playwright available"
command -v lit >/dev/null && echo "✓ liteparse (lit) available"
