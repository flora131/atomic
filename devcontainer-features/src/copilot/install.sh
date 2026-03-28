#!/usr/bin/env bash
set -e

if [ "$(id -u)" -ne 0 ]; then
    echo 'Script must be run as root.' >&2
    exit 1
fi

# ─── Install Atomic CLI + all shared deps/configs via stock installer ────────
curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash

# ─── Install Copilot CLI ────────────────────────────────────────────────────
curl -fsSL https://gh.io/copilot-install | bash

echo "Atomic + Copilot CLI installed successfully."
