#!/usr/bin/env bash
#-------------------------------------------------------------------------------------------------------------
# Installs the Atomic CLI binary only. Config data, agent config syncing,
# tooling (bun, uv, cocoindex, playwright, liteparse), and SDK installation
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

echo "Installing Copilot CLI..."

curl -fsSL --retry 3 --retry-delay 5 https://gh.io/copilot-install | bash

echo "✓ Copilot CLI installed"

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

# ─── Download and install binary ────────────────────────────────────────────
curl -fL# ${CURL_AUTH_ARGS[@]+"${CURL_AUTH_ARGS[@]}"} -o /usr/local/bin/atomic \
    "https://github.com/${GITHUB_REPO}/releases/download/${ATOMIC_VERSION}/atomic-linux-${arch}"
chmod +x /usr/local/bin/atomic

echo "✓ Atomic CLI installed to /usr/local/bin/atomic"
