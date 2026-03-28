#!/usr/bin/env bash
set -eo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo 'Script must be run as root.' >&2
    exit 1
fi

# ─── Redirect HOME to the devcontainer remote user's home directory ──────────
# The devcontainer runtime sets _REMOTE_USER_HOME during feature installation.
# Without this, the stock installer writes to /root/ which is invisible to the
# non-root remoteUser (e.g. "vscode") on standard devcontainer base images.
export HOME="${_REMOTE_USER_HOME:-$HOME}"

# ─── Install Atomic CLI + all shared deps/configs via stock installer ────────
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash

# ─── Install Claude Code CLI ────────────────────────────────────────────────
curl -fsSL https://claude.ai/install.sh | bash

# ─── Fix ownership for the non-root remoteUser ──────────────────────────────
# The installers above run as root, so all created files are owned by
# root:root. The devcontainer runtime sets _REMOTE_USER to the non-root user
# (e.g. "vscode") who will actually use these files at runtime. Without this
# chown, the remoteUser hits "permission denied" writing to ~/.atomic/,
# ~/.claude/, ~/.bun/, etc.
if [ -n "${_REMOTE_USER}" ] && [ "${_REMOTE_USER}" != "root" ]; then
    chown -R "${_REMOTE_USER}:${_REMOTE_USER}" \
        "$HOME/.local" \
        "$HOME/.bun" \
        "$HOME/.atomic" \
        "$HOME/.claude" \
        "$HOME/.cocoindex_code" \
        2>/dev/null || true
fi

echo "Atomic + Claude Code installed successfully."
