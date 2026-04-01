#!/usr/bin/env bash
set -eo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo 'Script must be run as root.' >&2
    exit 1
fi

curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash
