#!/usr/bin/env bash
# Atomic CLI Installer
#
# Bootstrap installer for systems that don't already have bun. Installs
# bun (if missing) and then installs atomic from npm via bun. The CLI
# itself handles tooling deps (Node.js/npm) and global skills on first
# launch — see src/services/system/auto-sync.ts.
#
# If you already have bun, you can skip this script entirely:
#   bun install -g @bastani/atomic@latest
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/flora131/atomic/main/install.sh | bash

set -euo pipefail

PACKAGE="@bastani/atomic@latest"

# ── Rendering helpers ───────────────────────────────────────────────────────
#
# Progress UI: a persistent line with a braille spinner + bracketed bar +
# step counter, rendered in place via carriage returns. Subprocess output
# is captured to a temp log and only surfaced on failure. Falls back to
# plain "[n/N] label" lines when stdout isn't a TTY (CI, piped output).

IS_TTY=0
if [[ -t 1 ]]; then IS_TTY=1; fi

# Colours — disabled if NO_COLOR is set (https://no-color.org)
#
# Palette follows Catppuccin semantics (see .impeccable.md):
#   blue   → in-flight "progress" (accent)
#   green  → completed success
#   red    → failed
#   yellow → warning
if [[ -z "${NO_COLOR:-}" ]] && [[ "$IS_TTY" == "1" ]]; then
    C_RESET=$'\033[0m'
    C_DIM=$'\033[2m'
    C_BOLD=$'\033[1m'
    C_RED=$'\033[31m'
    C_GREEN=$'\033[32m'
    C_YELLOW=$'\033[33m'
    C_BLUE=$'\033[34m'
    C_CYAN=$'\033[36m'
else
    C_RESET=""; C_DIM=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""
fi

STEP_TOTAL=0
STEP_INDEX=0

info()  { printf '  %sinfo%s %s\n' "$C_CYAN" "$C_RESET" "$*"; }
warn()  { printf '  %swarn%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
error() { printf '  %serror%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }

# Render a bracketed progress bar at the given completion ratio.
#
# Args: $1 = completed, $2 = total, $3 = state (progress|success|error)
#
# The filled segment carries the state colour (blue/green/red). The
# empty track stays dim so only the active portion telegraphs outcome.
render_bar() {
    local completed=$1 total=$2 state=${3:-progress}
    local width=18
    local filled=$(( completed * width / total ))
    (( filled > width )) && filled=$width
    local empty=$(( width - filled ))
    local fill_color
    case "$state" in
        success) fill_color="$C_GREEN" ;;
        error)   fill_color="$C_RED"   ;;
        *)       fill_color="$C_BLUE"  ;;
    esac
    local bar="" i
    for ((i=0; i<filled; i++)); do bar+="█"; done
    local rest=""
    for ((i=0; i<empty; i++)); do rest+="░"; done
    printf '%s%s%s%s%s%s%s' "$C_BOLD" "$fill_color" "$bar" "$C_RESET" "$C_DIM" "$rest" "$C_RESET"
}

# Render the full status line (no newline).
#
# Args: $1 = glyph, $2 = stepno (1-indexed), $3 = fill (completed count),
#       $4 = state (progress|success|error), $5 = label
#
# `stepno` and `fill` are separate so we can show "step 2/3" in the
# counter while the bar is still empty (fill=1) during the spinner, and
# flip to fill=2 only once the step actually succeeds.
render_line() {
    local glyph=$1 stepno=$2 fill=$3 state=$4 label=$5
    local bar
    bar=$(render_bar "$fill" "$STEP_TOTAL" "$state")
    printf '  %s  %s  %s%d/%d%s  %s' \
        "$glyph" "$bar" "$C_DIM" "$stepno" "$STEP_TOTAL" "$C_RESET" "$label"
}

# Run a command with a spinner; capture output; surface only on failure.
# STEP_INDEX tracks *completed* steps — it only advances on success so
# the progress bar tells the truth about how far we've actually gotten.
# Args: $1 = label, $2... = command
run_step() {
    local label=$1; shift
    local completed=$STEP_INDEX
    local stepno=$((completed + 1))

    if [[ "$IS_TTY" != "1" ]]; then
        printf '  [%d/%d] %s ' "$stepno" "$STEP_TOTAL" "$label"
        local log; log=$(mktemp)
        if "$@" >"$log" 2>&1; then
            printf '%sok%s\n' "$C_GREEN" "$C_RESET"
            rm -f "$log"
            STEP_INDEX=$((STEP_INDEX + 1))
            return 0
        else
            printf '%sfailed%s\n' "$C_RED" "$C_RESET"
            sed 's/^/      /' "$log" >&2
            rm -f "$log"
            return 1
        fi
    fi

    local log; log=$(mktemp)
    "$@" >"$log" 2>&1 &
    local pid=$!

    local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    local i=0
    printf '\033[?25l'  # hide cursor
    while kill -0 "$pid" 2>/dev/null; do
        local f="${frames[i % 10]}"
        printf '\r\033[2K'
        render_line "${C_BLUE}${f}${C_RESET}" "$stepno" "$completed" "progress" "$label"
        i=$((i + 1))
        sleep 0.08
    done
    # Capture exit code of wait explicitly; `|| true` would clobber it.
    local rc=0
    wait "$pid" || rc=$?
    printf '\r\033[2K'
    if [[ "$rc" == "0" ]]; then
        STEP_INDEX=$((STEP_INDEX + 1))
        render_line "${C_GREEN}✓${C_RESET}" "$stepno" "$STEP_INDEX" "success" "${C_DIM}${label}${C_RESET}"
        printf '\n\033[?25h'  # newline + show cursor
        rm -f "$log"
        return 0
    else
        render_line "${C_RED}✗${C_RESET}" "$stepno" "$completed" "error" "$label"
        printf '\n\033[?25h'
        if [[ -s "$log" ]]; then
            # Indent and dim the final ~15 lines of captured output
            tail -n 15 "$log" | sed "s/^/    ${C_DIM}/" | sed "s/$/${C_RESET}/" >&2
        fi
        rm -f "$log"
        return $rc
    fi
}

# ── Installers ──────────────────────────────────────────────────────────────

install_bun() {
    if command -v bun >/dev/null 2>&1; then
        info "bun already installed ($(bun --version 2>/dev/null))"
        return 0
    fi

    # macOS: Homebrew (preferred)
    if [[ "$OSTYPE" == darwin* ]] && command -v brew >/dev/null 2>&1; then
        if run_step "Installing bun (brew)" brew install oven-sh/bun/bun; then
            return 0
        fi
        warn "brew install bun failed, trying curl installer"
    fi

    # Official installer (Linux / macOS fallback)
    if command -v curl >/dev/null 2>&1; then
        if run_step "Downloading bun" bash -c 'curl -fsSL https://bun.sh/install | bash'; then
            export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
            export PATH="$BUN_INSTALL/bin:$PATH"
            if command -v bun >/dev/null 2>&1; then return 0; fi
        fi
    fi

    warn "Could not install bun — install it manually from https://bun.sh"
    return 1
}

install_atomic() {
    run_step "Installing @bastani/atomic" bun install -g "$PACKAGE"
}

# ── Main ────────────────────────────────────────────────────────────────────

main() {
    # Count upcoming steps so the progress bar is honest.
    STEP_TOTAL=1  # atomic install
    if ! command -v bun >/dev/null 2>&1; then
        STEP_TOTAL=$((STEP_TOTAL + 1))  # bun install
    fi

    printf '\n'

    if ! install_bun; then
        error "bun installation failed — install manually from https://bun.sh"
        exit 1
    fi

    if ! install_atomic; then
        error "atomic installation failed"
        exit 1
    fi

    printf '\n  %s✓%s %sAtomic installed successfully%s\n\n' \
        "$C_GREEN" "$C_RESET" "$C_BOLD" "$C_RESET"
    printf '    Get started:  %satomic init%s\n\n' "$C_CYAN" "$C_RESET"
    printf '    %sTooling deps and skills will be set up automatically on first launch.%s\n' \
        "$C_DIM" "$C_RESET"
    printf '    %sTo upgrade later: bun update -g @bastani/atomic%s\n\n' \
        "$C_DIM" "$C_RESET"
}

main
