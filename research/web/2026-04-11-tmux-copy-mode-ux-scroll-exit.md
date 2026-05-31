---
source_url: multiple (tmux/tmux source, tmux man page, GitHub discussions, plugin repos)
fetched_at: 2026-04-11
fetch_method: raw github + man page + web search
topic: tmux copy-mode UX — scroll to exit, click vs drag, selection_present, pane-mode-changed hook
---

# tmux Copy-Mode UX: Scroll-to-Exit, Click vs Drag, and Return-to-Input

## Problem Statement

A TUI app (like Claude Code) runs inside a tmux pane. Users need to:
1. Scroll up through output (entering copy-mode) via mouse wheel or arrow keys
2. Select and copy text while in copy-mode
3. Return to the input/typing area easily — ideally by scrolling back to the bottom or clicking the input area

The naive fix of binding `MouseDown1Pane` to `cancel` exits copy-mode on any click, breaking text selection.

---

## 1. How Do `copy-mode -e` and `scroll_exit` Work?

### Source-Level Behavior (confirmed from `window-copy.c` and `cmd-copy-mode.c`)

`copy-mode -e` sets an internal `scroll_exit` flag to `1` on the copy-mode data struct when copy-mode is entered:

```c
// cmd-copy-mode.c line 463
data->scroll_exit = args_has(args, 'e');
```

The `-e` flag is what `WheelUpPane` uses by default (from `key-bindings.c` line 451):
```
bind -n WheelUpPane { if -F '#{||:#{alternate_on},#{pane_in_mode},#{mouse_any_flag}}' { send -M } { copy-mode -e } }
```

The `scroll_exit` flag is checked at the bottom of `window_copy_pagedown1()` and `window_copy_scroll1()`:

```c
// window-copy.c — window_copy_pagedown1(), line 809
if (scroll_exit && data->oy == 0)
    return (1);  // returns 1 = exit copy mode

// window-copy.c — window_copy_scroll1(), line 693
if (scroll_exit && data->oy == 0) {
    window_pane_reset_mode(wp);
    return;
}
```

`data->oy == 0` means the offset from the live view is zero — i.e., the user scrolled back to the bottom of the scrollback buffer to the current live output.

**Summary:** `copy-mode -e` means "auto-exit copy-mode when the user scrolls back down to the live view". This is the default behavior when entering copy-mode via mouse wheel scroll up.

### Copy-Mode Commands to Toggle scroll_exit at Runtime

Three in-copy-mode `send-keys -X` commands exist (verified from `window-copy.c` lines 2133–2157 and key-bindings list lines 3190–3200):

| Command | Effect |
|---|---|
| `send-keys -X scroll-exit-on` | Enable auto-exit when reaching bottom |
| `send-keys -X scroll-exit-off` | Disable auto-exit (stay in copy-mode at bottom) |
| `send-keys -X scroll-exit-toggle` | Toggle the current state |

Usage in a binding:
```
bind -Tcopy-mode-vi e send-keys -X scroll-exit-toggle
```

---

## 2. Auto-Exit on Scroll-to-Bottom: All Available Mechanisms

### Mechanism A: `copy-mode -e` (Built-in, Simplest)

The canonical approach. Enter copy-mode with the exit flag set:
```
bind -n WheelUpPane { ... { copy-mode -e } }
```
When the user scrolls back down to `oy == 0` (live bottom), copy-mode exits automatically.

**Pros:** Zero config, works natively. This IS the default tmux behavior for mouse wheel scroll.
**Cons:** If user entered copy-mode via keyboard (`[` or `PPage`), the `-e` flag is NOT set. Also does not handle the edge case of having an active selection (see Section 5).

### Mechanism B: `WheelDownPane` with `send-X scroll-down` in Copy-Mode Table

Override the default `WheelDownPane` binding in `copy-mode-vi` to also use `scroll_exit`:

Default (line 644 of key-bindings.c):
```
bind -Tcopy-mode-vi WheelDownPane { select-pane; send -N5 -X scroll-down }
```

This uses `data->scroll_exit` which was set when entering copy-mode. If copy-mode was entered via `copy-mode -e` (mouse wheel), scrolling down with the wheel exits at the bottom. If entered via keyboard without `-e`, it does not.

**To ensure exit-on-bottom always works with wheel-down in copy-mode:**
```
# Override: always exit when wheel-down reaches bottom in copy-mode-vi
bind -Tcopy-mode-vi WheelDownPane { select-pane; send -X scroll-exit-on; send -N5 -X scroll-down }
```

### Mechanism C: `copy-mode -d` (Page Down with Exit)

From `cmd-copy-mode.c`:
```c
if (args_has(args, 'd'))
    window_copy_pagedown(wp, 0, args_has(args, 'e'));
```

`copy-mode -d -e` does a page-down and exits if at bottom. Useful for a "page down and exit at bottom" binding:
```
bind -Tcopy-mode-vi WheelDownPane send -X scroll-exit-on \; send -N5 -X scroll-down
```

### Mechanism D: `tmux-better-mouse-mode` Plugin

The `nhdaly/tmux-better-mouse-mode` plugin wraps this logic in a configurable way:

```bash
# In tmux.conf:
set -g @scroll-down-exit-copy-mode "on"    # default
set -g @scroll-speed-num-lines-per-scroll "3"
set -g @scroll-without-changing-pane "off"
```

It generates the WheelUpPane/WheelDownPane bindings dynamically using `copy-mode -e` when `@scroll-down-exit-copy-mode` is "on". Source: https://github.com/nhdaly/tmux-better-mouse-mode

**Note:** This plugin predates the built-in `scroll-exit-on/off/toggle` commands (added in a newer tmux version). For modern tmux (3.3+), the built-in mechanism is simpler.

### Mechanism E: Explicit `WheelDownPane` Cancel at Bottom

Manual approach without relying on `scroll_exit` flag:
```
bind -Tcopy-mode-vi WheelDownPane \
  if-shell -F "#{?#{==:#{pane_in_mode},1},1,0}" \
  "send -N5 -X scroll-down" \
  "send -M"
```
However, this doesn't detect "are we at the bottom". The `scroll_exit` mechanism is the right tool for this.

---

## 3. Default Mouse Bindings in Copy-Mode (Exact Source, key-bindings.c)

### Root table (applies outside copy-mode):
```
bind -n MouseDown1Pane { select-pane -t=; send -M }
bind -n MouseDrag1Pane { if -F '#{||:#{pane_in_mode},#{mouse_any_flag}}' { send -M } { copy-mode -M } }
bind -n WheelUpPane { if -F '#{||:#{alternate_on},#{pane_in_mode},#{mouse_any_flag}}' { send -M } { copy-mode -e } }
bind -n MouseDown2Pane { select-pane -t=; if -F '#{||:#{pane_in_mode},#{mouse_any_flag}}' { send -M } { paste -p } }
bind -n DoubleClick1Pane { select-pane -t=; if -F '#{||:#{pane_in_mode},#{mouse_any_flag}}' { send -M } { copy-mode -H; send -X select-word; run -d0.3; send -X copy-pipe-and-cancel } }
bind -n TripleClick1Pane { select-pane -t=; if -F '#{||:#{pane_in_mode},#{mouse_any_flag}}' { send -M } { copy-mode -H; send -X select-line; run -d0.3; send -X copy-pipe-and-cancel } }
```

### `copy-mode` table (emacs mode):
```
bind -Tcopy-mode MouseDown1Pane select-pane
bind -Tcopy-mode MouseDrag1Pane { select-pane; send -X begin-selection }
bind -Tcopy-mode MouseDragEnd1Pane { send -X copy-pipe-and-cancel }
bind -Tcopy-mode WheelUpPane { select-pane; send -N5 -X scroll-up }
bind -Tcopy-mode WheelDownPane { select-pane; send -N5 -X scroll-down }
```

### `copy-mode-vi` table:
```
bind -Tcopy-mode-vi MouseDown1Pane { select-pane }
bind -Tcopy-mode-vi MouseDrag1Pane { select-pane; send -X begin-selection }
bind -Tcopy-mode-vi MouseDragEnd1Pane { send -X copy-pipe-and-cancel }
bind -Tcopy-mode-vi WheelUpPane { select-pane; send -N5 -X scroll-up }
bind -Tcopy-mode-vi WheelDownPane { select-pane; send -N5 -X scroll-down }
bind -Tcopy-mode-vi DoubleClick1Pane { select-pane; send -X select-word; run -d0.3; send -X copy-pipe-and-cancel }
bind -Tcopy-mode-vi TripleClick1Pane { select-pane; send -X select-line; run -d0.3; send -X copy-pipe-and-cancel }
```

**Key observation:** `MouseDown1Pane` in copy-mode only does `select-pane` — it does NOT cancel copy-mode. `MouseDragEnd1Pane` does `copy-pipe-and-cancel` — drag-to-select copies AND exits copy-mode.

---

## 4. Click vs Drag Differentiation

### The Problem

Binding `MouseDown1Pane` to `cancel` in copy-mode exits copy-mode on any left click, which breaks drag-to-select (the drag starts with a MouseDown).

### How Tmux Distinguishes Click from Drag

- A plain click generates: `MouseDown1Pane` → `MouseUp1Pane`
- A drag generates: `MouseDown1Pane` → `MouseDrag1Pane` → `MouseDragEnd1Pane`

By default, `MouseDown1Pane` in copy-mode does only `select-pane` (moves focus, positions cursor). `MouseDrag1Pane` starts selection. `MouseDragEnd1Pane` copies and cancels.

The `#{selection_present}` format variable is the most reliable way to check if a non-trivial selection exists:

```c
// window-copy.c lines 953-958
if (data->endselx != data->selx || data->endsely != data->sely)
    format_add(ft, "selection_present", "1");
else
    format_add(ft, "selection_present", "0");
```

`selection_present` is `1` only when `sel != NULL` AND the selection end coordinates differ from start (non-zero-length selection). This correctly returns `0` for a zero-length cursor placement (simple click that starts a selection without moving).

There is also `selection_active` which is `1` while the user is actively dragging (`cursordrag != CURSORDRAG_NONE`).

### Pattern: Conditional Click-to-Exit (only when no selection)

```
# Exit copy-mode on left click ONLY if no real selection is active
bind -Tcopy-mode-vi MouseDown1Pane \
  if-shell -F "#{selection_present}" \
    "send-keys -X clear-selection" \
    "send-keys -X cancel"
```

**Behavior:**
- User clicks somewhere without having dragged a selection → `selection_present = 0` → cancel (exit copy-mode)
- User has a drag selection and clicks (e.g., to place cursor) → `selection_present = 1` → clear-selection (deselect but stay in copy-mode)

**Pros:** Allows exiting copy-mode by clicking. Doesn't break drag-to-select flow.
**Cons:** After a drag selection, clicking once clears the selection; a second click then exits copy-mode (two-click to exit when selection is present). This is intentional since the user may click to deselect then continue selecting.

### Alternative: `clear-selection` Always (Never Exit on Click)

```
bind -Tcopy-mode-vi MouseDown1Pane send-keys -X clear-selection
```

**Behavior:** Click never exits copy-mode, just deselects. User must press `q` or `Escape` to exit.
**Pros:** Safe — never interrupts a selection workflow.
**Cons:** No click-to-exit capability. Requires keyboard knowledge.

### Alternative: `select-pane` Only (tmux default)

```
bind -Tcopy-mode-vi MouseDown1Pane select-pane
```

This is the tmux default. Click just positions the cursor and focuses the pane. No selection clearing, no cancel.

---

## 5. The Selection-Present Edge Case with `copy-mode -e`

### The Problem (tmux Discussion #4079)

When using `copy-mode -e` and the user has an active drag selection that extends beyond the visible area:
1. User enters copy-mode via mouse wheel (sets `scroll_exit = 1`)
2. User drag-selects a region
3. User scrolls down to see the bottom of their selection
4. When `oy` reaches 0 (bottom), copy-mode exits and destroys the selection

### The Solution

Override `WheelDownPane` in `copy-mode-vi` to check `#{selection_present}`:

```
bind -Tcopy-mode-vi WheelDownPane \
  if-shell -F "#{selection_present}" \
    "send -X scroll-exit-off ; send -N5 -X scroll-down" \
    "send -N5 -X scroll-down"
```

Or more elegantly: disable `scroll_exit` while a selection is active:
```
bind -Tcopy-mode-vi MouseDrag1Pane \
  "select-pane ; send -X begin-selection ; send -X scroll-exit-off"
bind -Tcopy-mode-vi MouseDragEnd1Pane \
  "send -X copy-pipe-and-cancel"
```

This disables scroll_exit the moment a drag selection starts, preventing the "exit mid-selection" problem.

---

## 6. `pane-mode-changed` Hook

### What It Is

From the tmux man page and `notify.c`:

```
set-hook -g pane-mode-changed 'run-shell "echo pane mode changed"'
```

Fires whenever a pane transitions between modes (normal ↔ copy-mode ↔ clock-mode). The hook receives `#{pane_in_mode}` (0/1) and `#{pane_mode}` (empty string in normal mode, `"copy-mode"` or `"copy-mode-vi"` or `"view-mode"` in a mode).

The control mode protocol sends `%pane-mode-changed <pane-id>` to connected control clients.

### Use Case: React to Copy-Mode Entry/Exit

```
# In tmux.conf:
set-hook -g pane-mode-changed \
  'if-shell -F "#{pane_in_mode}" \
    "run-shell ~/scripts/entered-copy-mode.sh" \
    "run-shell ~/scripts/exited-copy-mode.sh"'
```

This can be used to:
- Show a visual indicator in the status bar when copy-mode is active
- Trigger external scripts when copy-mode exits (e.g., notify the host app)
- Change status-bar styling to signal scroll mode

```
# Example: red status bar when in copy-mode
set-hook -g pane-mode-changed \
  'if-shell -F "#{pane_in_mode}" \
    "set -g status-style bg=red" \
    "set -g status-style bg=#1e1e2e"'
```

**Limitation:** `pane-mode-changed` fires for ANY mode change (entering and exiting). Use `#{pane_in_mode}` to distinguish direction. It does NOT fire mid-copy-mode for selection changes.

### `after-copy-mode` Hook: Does NOT Exist

There is no `after-copy-mode` hook in tmux. The correct hook is `pane-mode-changed`. The `after-` prefix applies to tmux commands (like `after-split-window`), not to modes.

---

## 7. `copy-mode -q` (Quit All Modes)

From `cmd-copy-mode.c`:
```c
if (args_has(args, 'q')) {
    window_pane_reset_mode_all(wp);
    return (CMD_RETURN_NORMAL);
}
```

`copy-mode -q` calls `window_pane_reset_mode_all()` which exits ALL active modes on the pane (not just the outermost). This is useful as a "hard cancel" from outside copy-mode (e.g., from the root table binding or a script).

**Usage:**
```
# Bind Escape in root table to forcibly exit copy-mode
bind -n Escape { if-shell -F "#{pane_in_mode}" "copy-mode -q" "" }

# From a script:
tmux copy-mode -q -t <pane-id>
```

**Difference from `send-keys -X cancel`:**
- `send-keys -X cancel` sends the `cancel` action to the currently active copy-mode, exiting it
- `copy-mode -q` is a direct pane-level reset that works even without knowing the pane's current mode state

---

## 8. How Other Tools Handle This

### WezTerm

WezTerm has its own scroll/copy mode (not tmux copy-mode):
- `MoveToScrollbackBottom` action scrolls to the bottom and exits scroll mode
- Users compose `ClearSelectionMode + ClearPattern + Close` actions for clean exit
- Mouse wheel scroll automatically enters "scroll mode" without an explicit activation step
- Exiting scroll mode on scroll-to-bottom is available via `MoveToScrollbackBottom` action bound to `WheelDown` at the bottom
- Source: https://wezterm.org/copymode.html

**Key difference from tmux:** WezTerm does not require an explicit "enter scroll mode" step — it uses the scrollback buffer transparently. The user just scrolls, reads, and types to return.

### Zellij

Zellij has an explicit `Scroll` mode separate from normal mode:
- Status bar always shows current mode and available keybindings → discoverability is built in
- `ScrollToBottom` action (bound to `Ctrl+c` by default in scroll mode) scrolls to the bottom AND exits scroll mode
- Mouse wheel does NOT automatically enter scroll mode (still a requested feature as of 2024 — Discussion #4117)
- `Ctrl+c` in scroll mode exits scroll mode (same as the common "I'm done" gesture)
- Source: https://zellij.dev/documentation/

**Key insight:** Zellij solves the "how do I exit scroll mode" problem via the visible status bar — users always know what mode they're in and what key exits it.

### kitty Terminal

kitty handles scrollback at the terminal level (no multiplexer copy-mode concept):
- `kitty_mod+h` / `kitty_mod+f` opens the scrollback in a separate window (pager)
- The pager is a separate process; closing it returns to the normal prompt
- Mouse selection works normally (OSC52 passthrough)
- No "scroll mode" concept — scrolling is always available, typing at the terminal just moves the view to the bottom

**Key insight:** kitty avoids the copy-mode problem entirely by handling scrollback at a different layer.

### lazygit

lazygit manages its own TUI with pane-level scrolling:
- Individual panels scroll with the mouse wheel by default
- lazygit's TUI captures mouse events directly, so tmux copy-mode is NOT triggered
- `mouse_any_flag` is set, so tmux passes mouse events through to lazygit instead of entering copy-mode
- Users see output within lazygit's panels; output outside lazygit (the underlying shell) would use tmux copy-mode

**Key insight:** Applications that register mouse support (`mouse_any_flag`) bypass tmux copy-mode entirely for their own panes.

---

## 9. Recommended Configuration Patterns

### Pattern 1: Pure `copy-mode -e` (Simplest)

Works out of the box. Entering copy-mode via mouse wheel already sets `scroll_exit`. Scroll back to bottom → auto-exit.

```
# This is already the default for WheelUpPane. No changes needed.
# Just ensure mouse is on:
set -g mouse on
```

**Limitation:** Does not provide a click-to-exit path. Users must scroll all the way back down.

### Pattern 2: `copy-mode -e` + WheelDown Always Exits

Ensure WheelDown in copy-mode also respects scroll_exit (it does by default since it uses `data->scroll_exit` set by `-e`):

```
set -g mouse on
# WheelUpPane enters copy-mode with -e (exit on bottom) — this is the default
# WheelDownPane in copy-mode-vi uses data->scroll_exit — already correct
```

**This is already the default behavior.** The `-e` flag is passed when entering via mouse wheel, and WheelDownPane in copy-mode uses the stored flag.

### Pattern 3: Scroll-to-Bottom Always Exits (Even Keyboard Entry)

If the user can also enter copy-mode via keyboard (`[` prefix), they won't have `scroll_exit` set. Override WheelDown to always exit at bottom:

```
bind -Tcopy-mode-vi WheelDownPane \
  "select-pane ; send -X scroll-exit-on ; send -N5 -X scroll-down"
bind -Tcopy-mode WheelDownPane \
  "select-pane ; send -X scroll-exit-on ; send -N5 -X scroll-down"
```

**Pros:** Consistent behavior regardless of how copy-mode was entered.
**Cons:** If user wants to stay at the bottom of scrollback without exiting (e.g., viewing history), they can't.

### Pattern 4: Click-to-Exit (Smart)

Allows clicking to exit copy-mode when no selection is active:

```
# Exit copy-mode on click if no selection; clear selection if one exists
bind -Tcopy-mode-vi MouseDown1Pane \
  "if-shell -F '#{selection_present}' \
    'send-keys -X clear-selection' \
    'send-keys -X cancel'"
bind -Tcopy-mode MouseDown1Pane \
  "if-shell -F '#{selection_present}' \
    'send-keys -X clear-selection' \
    'send-keys -X cancel'"
```

**Pros:** Clicking input area (where cursor goes when not in copy-mode) exits copy-mode intuitively.
**Cons:** Clicking anywhere (not just the input area) exits copy-mode.

### Pattern 5: Combined — Scroll Exit + Click Exit + Selection Safety

The most complete solution for the stated requirements:

```
# Mouse support
set -g mouse on

# Enter copy-mode on scroll up, with auto-exit on scroll to bottom
bind -n WheelUpPane \
  if-shell -F '#{||:#{alternate_on},#{pane_in_mode},#{mouse_any_flag}}' \
    'send -M' \
    'copy-mode -e'

# In copy-mode-vi: scroll down exits at bottom (scroll_exit already set by -e)
# But ensure it also applies when keyboard-entered:
bind -Tcopy-mode-vi WheelDownPane \
  "select-pane ; send -X scroll-exit-on ; send -N5 -X scroll-down"
bind -Tcopy-mode WheelDownPane \
  "select-pane ; send -X scroll-exit-on ; send -N5 -X scroll-down"

# Click-to-exit when no selection active
bind -Tcopy-mode-vi MouseDown1Pane \
  "if-shell -F '#{selection_present}' \
    'send-keys -X clear-selection' \
    'send-keys -X cancel'"
bind -Tcopy-mode MouseDown1Pane \
  "if-shell -F '#{selection_present}' \
    'send-keys -X clear-selection' \
    'send-keys -X cancel'"

# Drag-to-select: disable scroll_exit to prevent losing selection on scroll-down
bind -Tcopy-mode-vi MouseDrag1Pane \
  "select-pane ; send -X begin-selection ; send -X scroll-exit-off"
bind -Tcopy-mode MouseDrag1Pane \
  "select-pane ; send -X begin-selection ; send -X scroll-exit-off"

# Keep drag-end as copy-and-cancel
bind -Tcopy-mode-vi MouseDragEnd1Pane { send -X copy-pipe-and-cancel }
bind -Tcopy-mode MouseDragEnd1Pane { send -X copy-pipe-and-cancel }

# OSC52 clipboard integration
set -g set-clipboard on
set -g allow-passthrough on
```

### Pattern 6: Status Bar Indicator (Zellij-inspired)

Show users they're in copy-mode:

```
set-hook -g pane-mode-changed \
  'if-shell -F "#{pane_in_mode}" \
    "set -g status-style \"bg=#f38ba8,fg=#1e1e2e\" ; set -g status-left \" SCROLL \"" \
    "set -g status-style \"bg=#1e1e2e,fg=#cdd6f4\" ; set -g status-left \" \""'
```

---

## 10. Format Variables Available in Copy-Mode Bindings

| Variable | Type | Description |
|---|---|---|
| `#{pane_in_mode}` | 0/1 | Pane is in any mode (copy, clock, etc.) |
| `#{pane_mode}` | string | Mode name: `"copy-mode"`, `"copy-mode-vi"`, `"view-mode"`, or empty |
| `#{selection_present}` | 0/1 | Non-zero-length selection is active in copy-mode |
| `#{selection_active}` | 0/1 | User is actively dragging a selection (cursordrag != NONE) |
| `#{mouse_any_flag}` | 0/1 | Running application registers any mouse events |
| `#{mouse_button_flag}` | 0/1 | Running application registers button mouse events |
| `#{alternate_on}` | 0/1 | Pane is on alternate screen (vim, less, etc.) |
| `#{copy_cursor_x}` | int | Copy-mode cursor X position |
| `#{copy_cursor_y}` | int | Copy-mode cursor Y position |
| `#{scroll_position}` | int | Current scroll offset from bottom |

---

## 11. Summary of Viable Options with Pros/Cons

| Option | How | Pros | Cons |
|---|---|---|---|
| `copy-mode -e` (default) | WheelUpPane already uses this | Zero config, works natively | Only activates if entered via mouse wheel; no click-to-exit |
| `scroll-exit-on` in WheelDownPane | Override WheelDownPane binding | Works for keyboard-entered copy-mode too | Forces exit even when user wants to stay at bottom |
| Click-to-exit via `#{selection_present}` | Override `MouseDown1Pane` | Intuitive "click to return to input" | Exits on any click, not just on input area |
| Disable scroll_exit during drag | Override `MouseDrag1Pane` | Prevents losing selection when scrolling | Slightly more complex config |
| `pane-mode-changed` hook | `set-hook -g pane-mode-changed` | Can run scripts/status changes on mode transitions | Does not directly solve the UX problem; event-driven side channel only |
| `copy-mode -q` from outside | Script or binding | Hard-reset all modes from a host process | Requires external trigger (e.g., from the app's TUI logic) |
| Status bar mode indicator | `set-hook -g pane-mode-changed` + status style | Users always know what mode they're in (Zellij pattern) | Adds visual complexity; doesn't add exit mechanism |
| `tmux-better-mouse-mode` plugin | TPM plugin | Full scroll UX feature set with config options | External dependency; overkill for a bundled config |

---

## References

- tmux source: https://github.com/tmux/tmux
  - `cmd-copy-mode.c`: `-e`, `-d`, `-q`, `-M` flag handling
  - `window-copy.c`: `scroll_exit`, `selection_present`, `scroll-exit-on/off/toggle` commands
  - `key-bindings.c`: All default mouse and copy-mode key bindings
  - `notify.c`: `pane-mode-changed` hook
  - `format.c`: Format variable callbacks for `pane_in_mode`, `pane_mode`
- tmux Discussion #4079: https://github.com/orgs/tmux/discussions/4079 (selection_present + WheelDownPane)
- tmux man page: https://man7.org/linux/man-pages/man1/tmux.1.html
- nhdaly/tmux-better-mouse-mode: https://github.com/nhdaly/tmux-better-mouse-mode
- WezTerm copy mode: https://wezterm.org/copymode.html
- Zellij scroll mode: https://zellij.dev/documentation/options.html
- Zellij Discussion #4117: https://github.com/zellij-org/zellij/discussions/4117
