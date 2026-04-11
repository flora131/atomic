---
source_url: https://raw.githubusercontent.com/anomalyco/opencode/refs/heads/dev/install
fetched_at: 2026-04-11
fetch_method: curl raw
topic: OpenCode install script — progress bar and logo rendering
---

# OpenCode Install Script

Full raw content fetched from the dev branch.

```bash
#!/usr/bin/env bash
set -euo pipefail
APP=opencode

MUTED='\033[0;2m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
NC='\033[0m' # No Color

print_progress() {
    local bytes="$1"
    local length="$2"
    [ "$length" -gt 0 ] || return 0

    local width=50
    local percent=$(( bytes * 100 / length ))
    [ "$percent" -gt 100 ] && percent=100
    local on=$(( percent * width / 100 ))
    local off=$(( width - on ))

    local filled=$(printf "%*s" "$on" "")
    filled=${filled// /■}
    local empty=$(printf "%*s" "$off" "")
    empty=${empty// /･}

    printf "\r${ORANGE}%s%s %3d%%${NC}" "$filled" "$empty" "$percent" >&4
}

download_with_progress() {
    # ... uses curl --trace-ascii to stream bytes received
    # hides cursor with \033[?25l before download
    # restores cursor with \033[?25h after
    # progress bar written to fd 4 (stderr or /dev/null)
}

# Logo printed after installation:
echo -e ""
echo -e "${MUTED}                    ${NC}             ▄     "
echo -e "${MUTED}█▀▀█ █▀▀█ █▀▀█ █▀▀▄ ${NC}█▀▀▀ █▀▀█ █▀▀█ █▀▀█"
echo -e "${MUTED}█░░█ █░░█ █▀▀▀ █░░█ ${NC}█░░░ █░░█ █░░█ █▀▀▀"
echo -e "${MUTED}▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ${NC}▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"
echo -e ""
echo -e ""
echo -e "${MUTED}OpenCode includes free models, to start:${NC}"
echo -e ""
echo -e "cd <project>  ${MUTED}# Open directory${NC}"
echo -e "opencode      ${MUTED}# Run command${NC}"
echo -e ""
echo -e "${MUTED}For more information visit ${NC}https://opencode.ai/docs"
echo -e ""
echo -e ""
```
