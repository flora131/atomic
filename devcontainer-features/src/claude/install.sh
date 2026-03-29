#!/usr/bin/env bash
set -eo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo 'Script must be run as root.' >&2
    exit 1
fi

# ─── Install Atomic CLI + Claude Code as the non-root remoteUser ────────────
# Both installers write to $HOME-relative paths (~/.atomic, ~/.claude, ~/.bun,
# etc.). Running them as _REMOTE_USER via su ensures files are created with
# correct ownership from the start — no post-install chown fixup needed.
if [ -n "${_REMOTE_USER}" ] && [ "${_REMOTE_USER}" != "root" ]; then
    su - "${_REMOTE_USER}" -c 'curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash'
    su - "${_REMOTE_USER}" -c 'curl -fsSL https://claude.ai/install.sh | bash'
else
    curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
    curl -fsSL https://claude.ai/install.sh | bash
fi

echo "Atomic + Claude Code installed successfully."
