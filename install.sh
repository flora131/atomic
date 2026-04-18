#!/usr/bin/env bash
# Atomic CLI Installer
#
# Bootstrap installer for systems that don't already have bun. Installs
# bun (if missing) and then installs atomic from npm via bun. The CLI
# silently syncs tooling deps and bundled skills on first launch — see
# src/services/system/auto-sync.ts.
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

# Render a slim progress bar with a continuous color gradient.
#
# Args: $1 = completed, $2 = total, $3 = state (progress|success|error)
#
# Uses true-color per-character gradient (Catppuccin palette) when the
# terminal supports it; falls back to a single ANSI colour otherwise.
# The filled segment uses ■ (slim) and the empty track uses ･ (dot).
render_bar() {
    local completed=$1 total=$2 state=${3:-progress}
    local width=30
    local filled=0
    (( total > 0 )) && filled=$(( completed * width / total ))
    (( filled > width )) && filled=$width
    local empty=$(( width - filled ))
    local bar="" i

    if [[ -z "${NO_COLOR:-}" ]] && [[ "${COLORTERM:-}" == "truecolor" || "${COLORTERM:-}" == "24bit" ]] && (( filled > 0 )); then
        local sr sg sb er eg eb
        case "$state" in
            success) sr=126 sg=201 sb=138 er=166 eg=227 eb=161 ;;
            error)   sr=224 sg=108 sb=136 er=243 eg=139 eb=168 ;;
            *)       sr=242 sg=196 sb=120 er=249 eg=226 eb=175 ;;
        esac
        for ((i=0; i<filled; i++)); do
            if (( filled > 1 )); then
                local r=$(( sr + (er - sr) * i / (filled - 1) ))
                local g=$(( sg + (eg - sg) * i / (filled - 1) ))
                local b=$(( sb + (eb - sb) * i / (filled - 1) ))
            else
                local r=$er g=$eg b=$eb
            fi
            bar+=$'\033'"[38;2;${r};${g};${b}m■"
        done
        bar+=$'\033[0m'
    else
        local fill_color
        case "$state" in
            success) fill_color="$C_GREEN" ;;
            error)   fill_color="$C_RED"   ;;
            *)       fill_color="$C_YELLOW" ;;
        esac
        for ((i=0; i<filled; i++)); do bar+="■"; done
        bar="${fill_color}${bar}${C_RESET}"
    fi

    local rest=""
    for ((i=0; i<empty; i++)); do rest+="･"; done
    printf '%s%s%s%s' "$bar" "$C_DIM" "$rest" "$C_RESET"
}

# Render the full status line (no newline).
#
# Args: $1 = glyph, $2 = fill (completed count),
#       $3 = state (progress|success|error), $4 = label
render_line() {
    local glyph=$1 fill=$2 state=$3 label=$4
    local bar pct=0
    bar=$(render_bar "$fill" "$STEP_TOTAL" "$state")
    (( STEP_TOTAL > 0 )) && pct=$(( fill * 100 / STEP_TOTAL ))
    printf '  %s  %s  %s%3d%%%s  %s' \
        "$glyph" "$bar" "$C_DIM" "$pct" "$C_RESET" "$label"
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
        render_line "${C_BLUE}${f}${C_RESET}" "$completed" "progress" "$label"
        i=$((i + 1))
        sleep 0.08
    done
    # Capture exit code of wait explicitly; `|| true` would clobber it.
    local rc=0
    wait "$pid" || rc=$?
    printf '\r\033[2K'
    if [[ "$rc" == "0" ]]; then
        STEP_INDEX=$((STEP_INDEX + 1))
        render_line "${C_GREEN}✓${C_RESET}" "$STEP_INDEX" "success" "${C_DIM}${label}${C_RESET}"
        printf '\n\033[?25h'  # newline + show cursor
        rm -f "$log"
        return 0
    else
        render_line "${C_RED}✗${C_RESET}" "$completed" "error" "$label"
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

# Write the cached-source snippet to `rc`, migrating any legacy
# `eval "$(atomic completions <shell>)"` block to the faster file-based
# form. Sourcing a local file skips the bun runtime cold start that an
# `eval` incurs on every shell spawn.
install_rc_snippet() {
    local rc=$1 shell_name=$2
    local marker='# Atomic CLI completions (cached)'

    # Strip legacy eval-based snippet (both the comment and eval line).
    # Portable in-place sed across GNU and BSD: use a .bak suffix.
    if [[ -f "$rc" ]] && grep -qF 'eval "$(atomic completions' "$rc"; then
        sed -i.atomic.bak \
            -e '/^# Atomic CLI completions$/d' \
            -e '/^eval "\$(atomic completions [a-z]*)"$/d' \
            "$rc"
        rm -f "$rc.atomic.bak"
    fi

    if ! grep -qF "$marker" "$rc" 2>/dev/null; then
        {
            printf '\n%s\n' "$marker"
            printf '[ -f "$HOME/.atomic/completions/atomic.%s" ] && source "$HOME/.atomic/completions/atomic.%s"\n' \
                "$shell_name" "$shell_name"
        } >> "$rc"
    fi
}

install_completions() {
    local shell_name
    shell_name=$(basename "${SHELL:-}")
    local cache_dir="$HOME/.atomic/completions"

    case "$shell_name" in
        bash)
            mkdir -p "$cache_dir"
            atomic completions bash > "$cache_dir/atomic.bash"
            install_rc_snippet "$HOME/.bashrc" bash
            ;;
        zsh)
            mkdir -p "$cache_dir"
            atomic completions zsh > "$cache_dir/atomic.zsh"
            install_rc_snippet "$HOME/.zshrc" zsh
            ;;
        fish)
            local dir="$HOME/.config/fish/completions"
            mkdir -p "$dir"
            atomic completions fish > "$dir/atomic.fish"
            ;;
        *)
            return 1
            ;;
    esac
}

# Cache the GitHub MCP token once per day so `gh auth token` isn't
# forked on every shell spawn. Uses bash/zsh-specific syntax, so we
# only install it for those shells.
install_gh_token_cache() {
    local shell_name
    shell_name=$(basename "${SHELL:-}")

    local rc
    case "$shell_name" in
        bash) rc="$HOME/.bashrc" ;;
        zsh)  rc="$HOME/.zshrc"  ;;
        *)    return 0           ;;  # silently skip other shells
    esac

    mkdir -p "$HOME/.atomic"
    cat > "$HOME/.atomic/gh-token-cache.sh" <<'EOF'
# Atomic: cache `gh auth token` for 24h to avoid shelling out on every
# shell spawn. Refreshes the cache lazily when it's missing or stale.
load_github_token() {
  [[ -n "$GITHUB_PERSONAL_ACCESS_TOKEN" ]] && return 0
  command -v gh >/dev/null 2>&1 || return 0

  local cache="${XDG_CACHE_HOME:-$HOME/.cache}/gh-auth-token"
  local tok

  if [[ -s "$cache" && -n "$(find "$cache" -mmin -1440 2>/dev/null)" ]]; then
    export GITHUB_PERSONAL_ACCESS_TOKEN="$(<"$cache")"
  elif tok=$(gh auth token 2>/dev/null); then
    mkdir -p "${cache%/*}"
    (umask 077; printf '%s' "$tok" > "$cache")
    export GITHUB_PERSONAL_ACCESS_TOKEN="$tok"
  fi
}

load_github_token
EOF

    local marker='# Atomic CLI gh auth token cache'
    if ! grep -qF "$marker" "$rc" 2>/dev/null; then
        {
            printf '\n%s\n' "$marker"
            printf '[ -f "$HOME/.atomic/gh-token-cache.sh" ] && source "$HOME/.atomic/gh-token-cache.sh"\n'
        } >> "$rc"
    fi
}

# ── Main ────────────────────────────────────────────────────────────────────

main() {
    # Count upcoming steps so the progress bar is honest.
    STEP_TOTAL=3  # atomic install + completions + gh token cache
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

    # Best-effort: don't fail the install if completions can't be set up
    if ! run_step "Installing shell completions" install_completions; then
        warn "Could not detect shell — install completions manually: atomic completions --help"
    fi

    # Best-effort: gh token caching speeds up shell startup for MCP users
    if ! run_step "Installing gh auth token cache" install_gh_token_cache; then
        warn "Could not install gh auth token cache"
    fi

    printf '\n  %s✓%s %sAtomic installed successfully%s\n\n' \
        "$C_GREEN" "$C_RESET" "$C_BOLD" "$C_RESET"
    printf '    Get started:  %satomic init%s\n\n' "$C_CYAN" "$C_RESET"
    printf '    %sTooling deps and skills are synced silently on first launch.%s\n' \
        "$C_DIM" "$C_RESET"
    printf '    %sTo upgrade later: bun update -g @bastani/atomic%s\n\n' \
        "$C_DIM" "$C_RESET"
}

main
