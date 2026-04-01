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

curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
