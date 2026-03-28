#!/usr/bin/env bash
set -eo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo 'Script must be run as root.' >&2
    exit 1
fi

# ─── Install Atomic CLI + all shared deps/configs via stock installer ────────
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash

# ─── Install OpenCode CLI ───────────────────────────────────────────────────
curl -fsSL https://opencode.ai/install | bash

echo "Atomic + OpenCode installed successfully."
