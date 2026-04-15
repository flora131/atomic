---
source_url: https://github.com/tmux/tmux (key-bindings.c, tmux.1 man page, notify.c); https://github.com/psmux/psmux (docs/compatibility.md, docs/keybindings.md, docs/scripting.md, docs/tmux_args_reference.md, docs/configuration.md)
fetched_at: 2026-04-15
fetch_method: raw.githubusercontent.com direct file fetch
topic: tmux keybinding suppression for agent session windows — kill/rename blocking, if-shell conditionals, display-message, hooks, and psmux compatibility
---

# tmux Keybinding Suppression for Agent Session Windows

## 1. Default Bindings That Close a Window/Pane

Source: [tmux/tmux key-bindings.c](https://raw.githubusercontent.com/tmux/tmux/master/key-bindings.c) — the `key_bindings_init()` function is the definitive source of all compiled-in defaults.

All bindings below are in the **prefix table** (require `Ctrl-b` first) unless marked otherwise.

| Binding | Table | Action |
|---------|-------|--------|
| `prefix + &` | prefix | `confirm-before -p "kill-window #W? (y/n)" kill-window` |
| `prefix + x` | prefix | `confirm-before -p "kill-pane #P? (y/n)" kill-pane` |
| `prefix + d` | prefix | `detach-client` |
| `prefix + D` | prefix | `choose-client -Z` (choose which client to detach) |

**No default keybinding** exists for `kill-server` or `kill-session` in the prefix or root tables. Those commands are accessible only via `prefix + :` (the command prompt).

**Mouse menus** (root table, mouse events) also expose kill actions through context menus:
- Right-click on a window in the status bar → `DEFAULT_WINDOW_MENU` → "Kill" (`X`) → `kill-window`
- Right-click on a pane → `DEFAULT_PANE_MENU` → "Kill" (`X`) → `kill-pane`
- Right-click on session name in status bar → `DEFAULT_SESSION_MENU` → "Detach" (`d`) → `detach-client`

Mouse menu root bindings (no prefix needed):
```
bind -n MouseDown3Status       → display-menu → DEFAULT_WINDOW_MENU (includes kill-window)
bind -n M-MouseDown3Status     → display-menu → DEFAULT_WINDOW_MENU
bind -n MouseDown3StatusLeft   → display-menu → DEFAULT_SESSION_MENU (includes detach-client)
bind -n MouseDown3Pane         → display-menu → DEFAULT_PANE_MENU (includes kill-pane)
bind -n M-MouseDown3Pane       → display-menu → DEFAULT_PANE_MENU
```

## 2. Default Bindings That Rename a Window or Session

| Binding | Table | Action |
|---------|-------|--------|
| `prefix + ,` | prefix | `command-prompt -I'#W' { rename-window -- '%%' }` |
| `prefix + $` | prefix | `command-prompt -I'#S' { rename-session -- '%%' }` |
| `prefix + :` | prefix | `command-prompt` (opens tmux command line — user can type any command) |

**Window menu** (right-click on status bar) also contains:
- "Rename" (`n`) → `command-prompt -FI "#W" { rename-window -t '#{window_id}' -- '%%' }`

**Session menu** (right-click on session name in status bar) contains:
- "Rename" (`r`) → `command-prompt -I "#S" { rename-session -- '%%' }`

### Suppressing `command-prompt` (`:`)

Blocking `prefix + :` completely locks out ALL tmux commands, which may be too aggressive. A safer approach is to intercept `rename-window` and `rename-session` specifically via the `after-rename-window` and `session-renamed` hooks (see Section 5).

## 3. Suppressing Keybindings Conditionally by Window Index or Name

### Key Table Overview

tmux has the following built-in key tables:
- **`prefix`** — active after the prefix key (`Ctrl-b` by default); this is the default table for `bind`
- **`root`** — active at all times without prefix; `bind -n` is an alias for `bind -T root`
- **`copy-mode`** — active when in copy mode (emacs key style)
- **`copy-mode-vi`** — active when in copy mode (vi key style)
- Custom tables are possible and activated with `switch-client -T <table>`

`-n` flag is an alias for `-T root`. Example:
```tmux
bind -n C-x some-command        # same as:
bind -T root C-x some-command
```

### Canonical Pattern: Conditional Suppression by Window Index

Use `if-shell -F` with format variables to test the current window:

```tmux
# Suppress kill-window (&) on window index 0 (agent windows):
bind & if-shell -F "#{==:#{window_index},0}" \
  "display-message -d 2000 'kill-window disabled in agent sessions'" \
  "confirm-before -p 'kill-window #W? (y/n)' kill-window"

# Suppress kill-pane (x) on windows named "agent":
bind x if-shell -F "#{==:#{window_name},agent}" \
  "display-message -d 2000 'kill-pane disabled in agent sessions'" \
  "confirm-before -p 'kill-pane #P? (y/n)' kill-pane"

# Suppress rename-window (,) on window index 0:
bind , if-shell -F "#{==:#{window_index},0}" \
  "display-message -d 2000 'rename disabled in agent sessions'" \
  "command-prompt -I'#W' { rename-window -- '%%' }"
```

**Key points:**
- `if-shell -F` evaluates the first argument as a **format string** (not a shell command). Returns "success" if the format expands to a non-empty, non-zero string.
- `#{==:a,b}` is the equality comparison format: expands to `1` if `a == b`, `0` otherwise.
- `#{window_index}` is the zero-based window index (affected by `base-index` option).
- All `bind` commands without `-T` go into the **prefix table** by default.

### Suppressing Mouse Menu Kill Actions

Mouse menus come from `display-menu` calls in root-table bindings. To prevent kill-window via right-click on the status bar, override the entire mouse menu binding with a conditional:

```tmux
# Override right-click on window in status bar for agent windows:
bind -n MouseDown3Status \
  if-shell -F "#{==:#{window_index},0}" \
    "display-message -d 2000 'Context menu disabled in agent window'" \
    "display-menu -t= -xW -yW -T '#[align=centre]#{window_index}:#{window_name}' \
      ' Swap Left' l {swap-window -t:-1} \
      ' Swap Right' r {swap-window -t:+1} \
      '' \
      ' New After' w {new-window -a} \
      ' New At End' W {new-window}"
```

### Alternative: Unbind Completely (Nuclear Option)

```tmux
unbind &          # remove kill-window binding entirely
unbind x          # remove kill-pane binding entirely
unbind ,          # remove rename-window binding entirely
unbind $          # remove rename-session binding entirely
unbind d          # remove detach-client binding entirely
```

This is simpler but applies globally (no per-window discrimination).

## 4. `display-message` — Non-blocking Status Feedback

Source: [tmux.1 man page](https://raw.githubusercontent.com/tmux/tmux/master/tmux.1) lines ~7195+

### Synopsis
```
display-message [-aCIlNpv] [-c target-client] [-d delay] [-t target-pane] [message]
alias: display
```

### Flags
- **`-d delay`** — Number of **milliseconds** to show the message on the status bar. If not given, uses the `display-time` session option (default: 750ms). If `delay = 0`, message stays until a key is pressed.
- **`-N`** — Ignore key presses; message closes only after the delay expires (makes it truly non-blocking from the user's perspective since keypresses don't dismiss it early).
- **`-p`** — Print to stdout instead of the status line (useful for scripting).
- **`-l`** — Print the message literally (skip format expansion).
- **`-a`** — List all format variables and their values.

### Behavior: Blocking vs Non-blocking

`display-message` is **non-blocking** — it returns immediately and schedules the message to disappear after `delay` ms. The tmux server continues processing commands. The user can interact with the terminal normally while the message is displayed.

Exception: if `delay = 0` (or `display-time = 0`), it becomes **blocking** — the message stays until a key is pressed.

### display-message vs display-popup

| Feature | `display-message` | `display-popup` |
|---------|------------------|-----------------|
| Appears in | Status bar (1 line) | Floating modal box over panes |
| Blocks pane updates | No | Yes — panes not updated while popup is open |
| Requires dismissal | No (auto-expires) | Yes (Ctrl-C or `q` or `display-popup -C`) |
| Multi-line | No | Yes (runs a shell command) |
| Use for | Brief feedback, status | Interactive choices, help text |

Example for user feedback when suppressing a key:
```tmux
display-message -d 3000 "Agent window: kill-window is disabled"
# Shows for 3 seconds, then automatically disappears, non-blocking
```

## 5. Hooks That Fire on Window Events

Source: [tmux.1 HOOKS section](https://raw.githubusercontent.com/tmux/tmux/master/tmux.1) lines ~5621+; also [notify.c](https://raw.githubusercontent.com/tmux/tmux/master/notify.c)

### Hook Names (Built-in, Non-command Hooks)

| Hook | When It Fires |
|------|---------------|
| `window-linked` | When a window is linked into a session |
| `window-unlinked` | When a window is unlinked from a session |
| `window-renamed` | When a window is renamed |
| `window-resized` | When a window is resized (after `client-resized`) |
| `window-layout-changed` | When the pane layout in a window changes |
| `client-resized` | When a client is resized |
| `session-renamed` | When a session is renamed |
| `session-created` | When a new session is created |
| `session-closed` | When a session is closed |
| `client-attached` | When a client is attached |
| `client-detached` | When a client is detached |
| `client-focus-in` / `client-focus-out` | When focus enters/exits a client |
| `pane-died` | When pane command exits and `remain-on-exit` is on |
| `pane-exited` | When pane command exits |
| `command-error` | When any tmux command fails |

### After-Hooks (Per-Command Hooks)

Every tmux command automatically generates a corresponding `after-<command>` hook that fires when the command completes. For window management:

| Hook Name | Fired After |
|-----------|-------------|
| `after-kill-window` | `kill-window` completes |
| `after-rename-window` | `rename-window` completes |
| `after-rename-session` | `rename-session` completes |
| `after-kill-pane` | `kill-pane` completes |
| `after-new-window` | `new-window` completes |
| `after-split-window` | `split-window` completes |

**Note:** After-hooks do NOT fire when the command runs as part of another hook (prevents infinite loops).

### Hook Usage Syntax

```tmux
# Global hook (applies to all sessions):
set-hook -g window-renamed 'display-message -d 2000 "Window renamed: #{window_name}"'

# Revert a rename attempt on agent windows (window index 0):
set-hook -g after-rename-window \
  'if-shell -F "#{==:#{window_index},0}" \
    "rename-window -- \"agent\"; display-message -d 2000 \"Window name locked\""'

# Log all kill-window events:
set-hook -g after-kill-window 'run-shell "echo killed >>/tmp/tmux-audit.log"'

# Append to existing hooks (array behavior):
set-hook -ga window-renamed 'run-shell "echo \"renamed: #{window_name}\" >> /tmp/log"'
```

**`set-hook` flags:**
- `-g` — global (all sessions)
- `-a` — append (add to hook array, don't replace)
- `-u` — unset
- `-R` — run the hook immediately (for testing)
- `-w` — window-scoped
- `-p` — pane-scoped

Hooks can also be set via `set-option` — the following two are equivalent:
```tmux
set-hook -g pane-mode-changed[42] 'set -g status-left-style bg=red'
set-option -g pane-mode-changed[42] 'set -g status-left-style bg=red'
```

## 6. psmux (Windows) Compatibility

Source: [psmux/psmux README](https://raw.githubusercontent.com/psmux/psmux/master/README.md), [compatibility.md](https://raw.githubusercontent.com/psmux/psmux/master/docs/compatibility.md), [tmux_args_reference.md](https://raw.githubusercontent.com/psmux/psmux/master/docs/tmux_args_reference.md), [keybindings.md](https://raw.githubusercontent.com/psmux/psmux/master/docs/keybindings.md)

psmux is a **native Windows tmux re-implementation in Rust** (not a wrapper). It supports 76 tmux commands, 126+ format variables, 15+ hooks, and reads `.tmux.conf` directly.

### Verified Supported Features

| Feature | psmux Support | Notes |
|---------|---------------|-------|
| `if-shell -F` | YES | Listed explicitly in compatibility table |
| `display-message -d delay` | YES | `"aCc:d:lINpt:F:v"` flags documented in tmux_args_reference.md — `-d` is present |
| `#{window_index}` format variable | YES | Part of 126+ format variables including session/window/pane variables |
| `#{==:a,b}` format comparisons | YES | "Conditional expressions (`#{?condition,true,false}`)" and string comparisons documented |
| `set-hook` | YES | `"agpRt:uw"` flags documented in tmux_args_reference.md |
| `window-linked` hook | LIKELY YES | "15+ event hooks" listed; compatibility.md cites `after-new-window` as example |
| `window-renamed` hook | LIKELY YES | Same as above |
| `after-kill-window` hook | LIKELY YES | Same as above |
| `bind-key -T root` | YES | "bind-key/unbind-key with key tables" in compatibility table |
| `kill-window`, `kill-pane`, `kill-session`, `kill-server` | YES | All in tmux_args_reference.md command list |
| `confirm-before` | YES | Part of the 76 commands (not listed separately, assumed part of core) |
| `command-prompt` | YES | `"1beFiklI:Np:t:T:"` flags documented in tmux_args_reference.md |

### Default psmux Keybindings

psmux matches tmux defaults exactly (from docs/keybindings.md):
- `Prefix + &` → Kill current window (with confirmation)
- `Prefix + x` → Kill current pane (with confirmation)
- `Prefix + ,` → Rename current window
- `Prefix + $` → Rename session
- `Prefix + d` → Detach from session

### psmux-Specific Considerations

- Default shell is **PowerShell 7 (`pwsh`)** — shell commands in `if-shell` (without `-F`) run in PowerShell, not `/bin/sh`. Use `if-shell -F` with format conditionals (no shell invocation) to stay cross-platform.
- No `/bin/sh` on Windows — `run-shell` defaults to PowerShell. For cross-platform hooks, use tmux format expressions via `if-shell -F` instead of shell scripts.
- psmux adds Windows-specific options (`prediction-dimming`, `cursor-style`, `cursor-blink`, `claude-code-fix-tty`, etc.) that are ignored by real tmux.
- The specific 15+ hooks psmux supports are not individually enumerated in public docs; `after-new-window` is the only example cited. Treat hook support as "best effort" and test on Windows.

## 7. Complete Config Pattern: Agent Window Protection

```tmux
# ============================================================
# Agent Window Protection
# Applied via: tmux -L atomic -f <this-file>
# ============================================================

# Suppress kill-window for agent windows (index 0):
bind & if-shell -F "#{==:#{window_index},0}" \
  "display-message -d 3000 '[atomic] Agent window cannot be closed'" \
  "confirm-before -p 'kill-window #W? (y/n)' kill-window"

# Suppress kill-pane for agent windows:
bind x if-shell -F "#{==:#{window_index},0}" \
  "display-message -d 3000 '[atomic] Agent pane cannot be closed'" \
  "confirm-before -p 'kill-pane #P? (y/n)' kill-pane"

# Suppress rename-window for agent windows:
bind , if-shell -F "#{==:#{window_index},0}" \
  "display-message -d 3000 '[atomic] Agent window name is locked'" \
  "command-prompt -I'#W' { rename-window -- '%%' }"

# Suppress rename-session for agent windows:
bind '$' if-shell -F "#{==:#{window_index},0}" \
  "display-message -d 3000 '[atomic] Session rename disabled in agent windows'" \
  "command-prompt -I'#S' { rename-session -- '%%' }"

# Suppress detach in agent windows (optional — may be too aggressive):
# bind d if-shell -F "#{==:#{window_index},0}" \
#   "display-message -d 3000 '[atomic] Detach disabled in agent window'" \
#   "detach-client"

# Block mouse right-click kill on agent windows:
bind -n MouseDown3Status \
  if-shell -F "#{==:#{window_index},0}" \
    "display-message -d 2000 '[atomic] Context menu disabled'" \
    "display-menu -t= -xW -yW -T '#[align=centre]#{window_index}:#{window_name}' \
     ' Swap Left' l {swap-window -t:-1} \
     ' Swap Right' r {swap-window -t:+1} \
     '' \
     ' New After' w {new-window -a} \
     ' New At End' W {new-window}"

# Hook: revert rename attempts on agent windows (belt-and-suspenders):
set-hook -g after-rename-window \
  'if-shell -F "#{==:#{window_index},0}" \
    "rename-window -- \"agent\"; display-message -d 2000 \"[atomic] Window name reverted\""'

# Hook: log window-unlink events (debug):
# set-hook -g window-unlinked 'run-shell "echo unlinked >> /tmp/atomic-audit.log"'
```

## References

- tmux source (key-bindings.c, authoritative defaults): https://github.com/tmux/tmux/blob/master/key-bindings.c
- tmux man page (tmux.1): https://raw.githubusercontent.com/tmux/tmux/master/tmux.1
- tmux notify.c (hook triggering): https://github.com/tmux/tmux/blob/master/notify.c
- psmux README: https://raw.githubusercontent.com/psmux/psmux/master/README.md
- psmux compatibility.md: https://raw.githubusercontent.com/psmux/psmux/master/docs/compatibility.md
- psmux tmux_args_reference.md: https://raw.githubusercontent.com/psmux/psmux/master/docs/tmux_args_reference.md
- psmux keybindings.md: https://raw.githubusercontent.com/psmux/psmux/master/docs/keybindings.md
- psmux scripting.md: https://raw.githubusercontent.com/psmux/psmux/master/docs/scripting.md
