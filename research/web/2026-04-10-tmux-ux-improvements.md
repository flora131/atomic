# tmux UX Improvements for Embedded Agent Sessions

## Problem

Atomic opens coding agent sessions inside tmux panes. Users unfamiliar with tmux cannot scroll, don't know how to detach, and lose error output when agents crash. Today, no tmux config is shipped — sessions inherit whatever the user has (often nothing).

## Current Architecture

### How each agent uses tmux

| | Claude Code | OpenCode | Copilot CLI |
|---|---|---|---|
| **Pane contents** | Bare shell, then Claude CLI injected via `send-keys` | OpenCode's own TUI (`opencode --port`) | Copilot's own TUI (`copilot --ui-server --port`) |
| **SDK interaction** | Keystroke automation (`send-keys` + `capture-pane`) | HTTP SDK to TUI server | HTTP SDK to TUI server |
| **Scroll handling** | None — user must know tmux copy-mode | TUI handles internally | TUI handles internally |
| **Mouse handling** | None — raw tmux pane | TUI captures mouse | TUI captures mouse |

### Key code paths

- **Session creation**: `src/sdk/runtime/tmux.ts` — `createSession()` and `createWindow()` call `tmux new-session` / `tmux new-window` with no `-f` (config) or `-L` (socket) flags.
- **Workflow execution**: `src/sdk/runtime/executor.ts` — creates one tmux session per workflow, one window per agent. Claude gets a bare shell; OpenCode/Copilot start their TUIs directly.
- **Chat command**: `src/commands/cli/chat/index.ts` — when outside tmux, creates a session and attaches. All three agents launch their full interactive TUI.
- **Claude automation**: `src/sdk/providers/claude.ts` — `claudeQuery()` reads output via `capturePaneScrollback()`, which is bounded by tmux's scrollback buffer (default 2000 lines).

### What's missing

- No tmux config file shipped in the repo
- No `-f` flag (config injection) on any `tmux` invocation
- No `-L` flag (separate socket) — sessions land in user's default tmux server
- No `allow-rename off` — window titles get overwritten by running processes
- No mouse support — scroll wheel does nothing unless user configured it themselves

## P0 Implementation Plan

### 1. Ship a bundled tmux config file

Create `src/sdk/runtime/tmux.conf` with the following config:

```
# Set true color
set-option -sa terminal-overrides ",xterm*:Tc"

set -g set-clipboard on
set -g allow-passthrough on

# Mouse mode
set-option -g mouse on

# Prevent processes from overwriting window titles
set-option -g allow-rename off

set -g @plugin "tmux-plugins/tpm"
set -g @plugin "tmux-plugins/tmux-resurrect"
set -g @plugin "tmux-plugins/tmux-sensible"
set -g @plugin "tmux-plugins/tmux-yank"
set -g @yank_with_mouse off

# Status bar — minimal, let the window list do the work
set -g status-left " "
set -g status-right " #{session_name} │ %H:%M "
set -g status-right-length 60
set -g status-style "bg=#1e1e2e,fg=#cdd6f4"
set -g status-right-style "fg=#6c7086"

# Open panes in current directory
bind - split-window -v -c "#{pane_current_path}"
bind | split-window -h -c "#{pane_current_path}"

# Increase pane size to the right
bind -r l resize-pane -R 5

# Increase pane size to the left
bind -r h resize-pane -L 5

# Increase pane size upwards
bind -r k resize-pane -U 5

# Increase pane size downwards
bind -r j resize-pane -D 5

# Set vi-mode
set-window-option -g mode-keys vi

# vi keybinds
bind-key -T copy-mode-vi v send-keys -X begin-selection
bind-key -T copy-mode-vi C-v send-keys -X rectangle-toggle
bind-key -T copy-mode-vi y send-keys -X copy-selection-and-cancel

# OSC52 copy-mode improvements
unbind -T copy-mode-vi MouseDragEnd1Pane
bind -T copy-mode-vi MouseDown1Pane send-keys -X clear-selection \; select-pane

bind -n C-l display-popup -E "tmux list-sessions | sed -E 's/:.*$//' | grep -v \"^$(tmux display-message -p '#S')\$\" | fzf --reverse | xargs -I {} tmux switch-client -t '{}'"

if "test ! -d ~/.config/tmux/plugins/tpm" \
   "run 'git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm && ~/.config/tmux/plugins/tpm/bin/install_plugins'"

run "~/.config/tmux/plugins/tpm/tpm"
```

Also create `src/sdk/runtime/psmux.conf` as a mirrored version for Windows/psmux:

```
# Set true color
set-option -sa terminal-overrides ",xterm*:Tc"

set -g set-clipboard on
set -g allow-passthrough on

# Mouse mode
set-option -g mouse on

# Prevent processes from overwriting window titles
set-option -g allow-rename off

set -g @plugin "tmux-plugins/tpm"
set -g @plugin "tmux-plugins/tmux-resurrect"
set -g @plugin "tmux-plugins/tmux-sensible"
set -g @plugin "tmux-plugins/tmux-yank"
set -g @yank_with_mouse off

# Status bar — minimal, let the window list do the work
set -g status-left " "
set -g status-right " #{session_name} │ %H:%M "
set -g status-right-length 60
set -g status-style "bg=#1e1e2e,fg=#cdd6f4"
set -g status-right-style "fg=#6c7086"

# Open panes in current directory
bind - split-window -v -c "#{pane_current_path}"
bind | split-window -h -c "#{pane_current_path}"

# Increase pane size to the right
bind -r l resize-pane -R 5

# Increase pane size to the left
bind -r h resize-pane -L 5

# Increase pane size upwards
bind -r k resize-pane -U 5

# Increase pane size downwards
bind -r j resize-pane -D 5

# Set vi-mode
set-window-option -g mode-keys vi

# vi keybinds
bind-key -T copy-mode-vi v send-keys -X begin-selection
bind-key -T copy-mode-vi C-v send-keys -X rectangle-toggle
bind-key -T copy-mode-vi y send-keys -X copy-selection-and-cancel

# OSC52 copy-mode improvements
unbind -T copy-mode-vi MouseDragEnd1Pane
bind -T copy-mode-vi MouseDown1Pane send-keys -X clear-selection \; select-pane

# Session switcher (psmux equivalent — uses resolved mux binary)
bind -n C-l display-popup -E "psmux list-sessions | sed -E 's/:.*$//' | grep -v \"^$(psmux display-message -p '#S')\$\" | fzf --reverse | xargs -I {} psmux switch-client -t '{}'"

# TPM bootstrap (Windows path)
if "test ! -d $env:USERPROFILE/.config/tmux/plugins/tpm" \
   "run 'git clone https://github.com/tmux-plugins/tpm $env:USERPROFILE/.config/tmux/plugins/tpm && $env:USERPROFILE/.config/tmux/plugins/tpm/bin/install_plugins'"

run "$env:USERPROFILE/.config/tmux/plugins/tpm/tpm"
```

Key choices:
- **True color + passthrough** — enables rich terminal rendering for agent TUIs
- **Mouse mode** — scroll wheel works out of the box without tmux knowledge
- **`allow-rename off`** — prevents running processes from overwriting window titles set by Atomic
- **Status bar** — left side is a spacer so the window list isn't jammed against the edge. The window list (automatic, shown between left and right) already displays the session name and active window — no need to duplicate it. Right side shows the session name (useful if the user detaches and needs to reattach) and a clock (useful for long-running workflows). No hints needed — session lifecycle is fully managed by Atomic (Ctrl+C and `q` work, sessions auto-cleanup on completion)
- **TPM + plugins** — tmux-sensible (sane defaults including `escape-time`, `history-limit`), tmux-resurrect (session persistence), tmux-yank (clipboard integration)
- **Vi-mode keybinds** — consistent navigation for keyboard-driven users
- **OSC52 clipboard** — `set-clipboard on` + `allow-passthrough on` enables clipboard over SSH/remote
- **Session switcher (Ctrl+L)** — fzf-powered popup to jump between Atomic sessions
- **Pane splitting** — `|` and `-` bindings for intuitive horizontal/vertical splits
- **TPM auto-bootstrap** — clones and installs TPM on first run if missing
- **psmux.conf** — mirrors tmux.conf with Windows-appropriate paths (`$env:USERPROFILE`) and `psmux` binary references

### 2. Inject config via `-f` on all tmux invocations

Modify `createSession()` and `createWindow()` in `tmux.ts` to accept and pass `-f <path>` to every `tmux new-session` / `tmux new-window` call. Resolve the config file path at runtime relative to the package.

### 3. Use a separate tmux socket via `-L atomic`

Pass `-L atomic` on all tmux commands (create, attach, switch, kill, capture, send-keys). This isolates Atomic sessions from the user's personal tmux and ensures the injected config applies exclusively to Atomic sessions without overriding user preferences.

**Note**: This requires updating every `tmuxRun()` call site or adding the `-L` flag inside `tmuxRun()` itself as a default.

### 4. Print session connection info for users

When Atomic creates or attaches to a tmux session, print a short message telling the user how to reattach manually, e.g.:

```
[atomic] Session running on tmux socket "atomic". To reattach: tmux -L atomic attach -t <session-name>
```

This is necessary because `-L atomic` makes sessions invisible to plain `tmux ls`. Without this hint, a user who detaches has no way to find their session again unless they already know about tmux sockets.

### 5. Ensure proper cleanup of the separate tmux server

The `-L atomic` server persists as a background process until all its sessions end or it is explicitly killed. If Atomic crashes without cleanup:

- Add `-L atomic` to all existing `killSession()` and `killWindow()` calls (covered by making `-L` a default in `tmuxRun()`).
- Add a process exit handler (SIGINT/SIGTERM) that kills any Atomic tmux sessions created during the current run — `executor.ts` already has a SIGINT handler at its cleanup path; extend it to include the socket flag.
- Consider a startup check: on launch, detect orphaned sessions on the `atomic` socket (`tmux -L atomic ls`) and offer to clean them up or clean them automatically.

## Psmux (Windows/PowerShell) Considerations

### Architecture Recap

Atomic uses a single unified multiplexer abstraction in `src/sdk/runtime/tmux.ts`. On Windows, `getMuxBinary()` resolves to `psmux` (or `pmux`, or `tmux` as fallback). All runtime operations — `createSession`, `sendKeys`, `capturePane`, etc. — go through `tmuxRun()`, which delegates to whichever binary was resolved. There is no separate psmux code path.

The `isInsideTmux()` check already handles both environments: `process.env.TMUX || process.env.PSMUX`.

### What Carries Over Unchanged

Since psmux is a tmux protocol clone, the following should work identically on both platforms:

| Feature | Why it works |
|---|---|
| `-f <path>` config injection | Same CLI flag semantics |
| `-L <socket>` socket isolation | Same CLI flag semantics |
| `set -g mouse on` | Same config file format |
| `allow-rename off` | Same config file format |
| `set-clipboard on` / `allow-passthrough on` | Same config file format |
| Vi-mode keybinds (`mode-keys vi`, copy-mode-vi) | Same keybinding system |
| Status bar (`status-left` / `status-right`) | Same config file format |
| Pane split bindings (`bind - split-window`) | Same keybinding system |
| TPM plugin manager | Same plugin system — psmux supports TPM |

Because all tmux invocations flow through `tmuxRun()` → `getMuxBinary()`, adding `-f` and `-L` flags inside `tmuxRun()` (or at the call site) automatically applies to psmux with no additional code paths.

### Nuances That Need Attention

1. **Config file compatibility validation**: While psmux aims for full tmux config compatibility, the specific options in our bundled config (`mouse on`, `set-clipboard on`, `allow-passthrough on`, vi-mode keybinds, status bar hints, TPM bootstrap) should be tested against psmux to confirm they are supported. If any option is unsupported, we need a conditional config or a psmux-compatible subset.

2. **Socket naming on Windows**: The `-L atomic` flag creates a Unix domain socket on macOS/Linux. On Windows, psmux may use named pipes or a different IPC mechanism. The flag should behave the same from the CLI perspective, but the cleanup semantics (orphaned server detection, process exit handler) may differ. Specifically:
   - `tmux -L atomic ls` for orphan detection — verify psmux supports `-L` for listing sessions on a named socket.
   - Process cleanup on crash — Windows doesn't have Unix signals (SIGINT/SIGTERM); the existing executor cleanup path should be audited for Windows compatibility.

3. **Reattach instructions must use the correct binary**: The user-facing message (plan item #4) currently hardcodes `tmux -L atomic attach -t <session-name>`. This must use the resolved binary name:
   ```
   // Bad: hardcoded
   "tmux -L atomic attach -t <session>"
   // Good: dynamic
   `${getMuxBinary()} -L atomic attach -t <session>`
   ```

4. **Session switcher binding**: The `C-l` popup binding uses `tmux list-sessions` / `tmux switch-client` in `tmux.conf` and `psmux list-sessions` / `psmux switch-client` in `psmux.conf`. Verify that psmux supports `display-popup -E` and that `fzf` is available on the Windows PATH. Additionally, the status-right hint for reattach hardcodes `tmux -L atomic attach` — the psmux.conf version should reference the psmux binary instead.

5. **TPM paths on Windows**: The psmux.conf uses `$env:USERPROFILE/.config/tmux/plugins/tpm` for TPM bootstrap. Verify psmux correctly expands PowerShell environment variables in `if`/`run` directives, or use `%USERPROFILE%` if psmux uses cmd-style expansion instead.

5. **Launcher script interaction**: The `-f` and `-L` flags are passed to the multiplexer binary, not to the launcher scripts (`.ps1` / `.sh`). The launcher scripts only handle shell invocation and environment setup, so they are unaffected by this change.

6. **Installation of psmux**: `ensureTmuxInstalled()` in `src/lib/spawn.ts` already handles psmux installation via winget/scoop/choco/cargo. No changes needed for installation — the UX improvements only affect runtime behavior after the binary is available.

### Implementation Impact

Because of the unified `tmuxRun()` architecture, the implementation cost for psmux support is **near-zero**:

- Adding `-f` and `-L` flags inside `tmuxRun()` covers both platforms automatically.
- Two config files: `tmux.conf` and `psmux.conf` — selected at runtime based on `getMuxBinary()`.
- The psmux-specific work is:
  1. Testing the config options against psmux (manual validation).
  2. Using `getMuxBinary()` in user-facing reattach strings instead of hardcoded `"tmux"`.
  3. Verifying `-L` socket/cleanup behavior on Windows.
  4. Verifying TPM bootstrap paths and `display-popup` support on psmux.
  5. Selecting the correct config file (`tmux.conf` vs `psmux.conf`) based on resolved binary.

## OSS References

| Project | Pattern used | Link |
|---|---|---|
| Overmind | Separate socket + `allow-rename off` (we skip `remain-on-exit` — dead panes confuse users unfamiliar with tmux) | github.com/DarthSim/overmind |
| tmux-sensible | Community-agreed sane defaults | github.com/tmux-plugins/tmux-sensible |
| Zellij | Persistent keybinding hints in status bar (considered but not adopted — Atomic's session lifecycle is fully managed, so hints add noise without value) | zellij.dev |
| Claude Squad | TUI wrapper over tmux for multi-agent Claude Code | github.com/smtg-ai/claude-squad |

## Scope

This is MVP. We are not building a tmux UX framework. The goal is: a user who has never configured tmux can scroll and see crash output — without reading any docs. Detach/reattach hints are omitted because Atomic fully manages session lifecycle (auto-cleanup on completion, Ctrl+C, and `q` to quit).
