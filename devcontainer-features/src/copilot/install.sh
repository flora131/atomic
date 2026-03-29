#!/usr/bin/env bash
set -eo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo 'Script must be run as root.' >&2
    exit 1
fi

# ─── Ensure prerequisites exist (bare images like ubuntu:latest lack them) ──
if ! command -v curl >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y --no-install-recommends curl ca-certificates unzip
    rm -rf /var/lib/apt/lists/*
fi

# ─── Install Atomic CLI as the non-root remoteUser ──────────────────────────
# The Atomic installer writes to $HOME-relative paths (~/.atomic, ~/.copilot,
# ~/.bun, etc.). Running it as _REMOTE_USER via su ensures files are created
# with correct ownership from the start — no post-install chown fixup needed.
if [ -n "${_REMOTE_USER}" ] && [ "${_REMOTE_USER}" != "root" ]; then
    su - "${_REMOTE_USER}" -c 'curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash'
else
    curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
fi

# ─── Install Copilot CLI ────────────────────────────────────────────────────
# When run as root, the Copilot installer defaults PREFIX=/usr/local, placing
# the binary in /usr/local/bin — a system directory already on PATH with no
# user-ownership concerns.
curl -fsSL https://gh.io/copilot-install | bash

echo "Atomic + Copilot CLI installed successfully."
