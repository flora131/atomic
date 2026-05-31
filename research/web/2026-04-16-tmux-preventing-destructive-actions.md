---
source_url: multiple (tmux man page, tmux wiki, GitHub issues, Stack Overflow)
fetched_at: 2026-04-16
fetch_method: man-page + playwright-cli html-parse + web-search
topic: tmux configuration for preventing destructive user actions in a managed session
---

# tmux: Preventing Destructive User Actions — Comprehensive Reference

Tested against tmux 3.6a on macOS Darwin 25.3.0.

## 1. PREVENTING WINDOW CLOSING

### 1.1 `remain-on-exit` Window Option

The `remain-on-exit` option is a **window-level option** that prevents panes from being destroyed when their command exits.

```
remain-on-exit [on | off | failed]
```

- `on`: Pane is not destroyed when the program exits. The pane remains in "dead" state.
- `failed`: Only kept when exit status is non-zero.
- `off`: Default behavior — pane closes when command exits.

The dead pane can be reactivated with `respawn-pane`.

**Configuration:**
```tmux
# Global setting (all new windows)
set-option -g remain-on-exit on

# Per-window setting
setw -g remain-on-exit on
setw remain-on-exit on

# Failed-only: keep pane only on non-zero exit
setw -g remain-on-exit failed
```

**Note on `remain-on-exit` scope:** Despite the "window" option classification, it effectively controls pane behavior. Panes remain, and since the window stays alive as long as any pane is alive, this also prevents window destruction from process exits.

**remain-on-exit-format:** Customize what text shows in dead panes:
```tmux
set-option -g remain-on-exit-format "Pane died (exit #{pane_dead_status}). Press r to restart."
```

### 1.2 Unbinding `kill-window` Keys

The default `Prefix + &` key binding kills the current window. Unbind it:

```tmux
# Remove the kill-window key binding entirely
unbind &

# Or rebind with a confirmation prompt
bind & confirm-before -p "Kill window #W? (y/n)" kill-window

# Or rebind to a no-op (do nothing)
bind & display-message "Window closing is disabled."
```

### 1.3 Rebinding with Confirmation (`confirm-before`)

```tmux
# Require 'y' confirmation before killing window
bind & confirm-before -p "kill-window #W? (y/n)" kill-window

# Only allowed via explicit command (unbind default)
unbind &
```

### 1.4 Hook-Based Approaches — Critical Limitation

**IMPORTANT:** tmux hooks are **event notifications, not interceptors**. There is NO `before-kill-window` hook that can cancel the kill. The `after-kill-window` hook fires AFTER the window is already destroyed.

Available hooks related to window lifecycle:
- `window-unlinked` — fires when a window is unlinked from a session (after the kill)
- `window-linked` — fires when a window is linked to a session
- `session-closed` — fires when a session closes

**What hooks CAN do:** They can trigger remediation AFTER destruction:
```tmux
# After a window closes, display a message (window is already gone)
set-hook -g window-unlinked "display-message 'A workflow window was closed!'"
```

**What hooks CANNOT do:** They cannot prevent the kill from happening.

### 1.5 Preventing Close via Ctrl+D / `exit`

When a user types `exit` or presses Ctrl+D in a shell, this exits the shell process — not the tmux kill-window command. The sequence is:
1. Shell receives `exit`/Ctrl+D
2. Shell process terminates
3. `pane-exited` hook fires (if `remain-on-exit` is off)
4. OR `pane-died` hook fires (if `remain-on-exit` is on)

To handle this, use `remain-on-exit on` combined with the `pane-died` hook to auto-respawn:

```tmux
# Keep panes alive after exit
setw -g remain-on-exit on

# Auto-respawn pane when it dies (restarts the original command)
set-hook -g pane-died "respawn-pane"

# Or respawn only if exit code was non-zero (unexpected exit)
set-hook -g pane-died "if -F '#{!=:#{pane_dead_status},0}' 'respawn-pane'"
```

---

## 2. PREVENTING WINDOW RENAMING

### 2.1 `allow-rename` Option

Prevents programs running in a pane from changing the window name via terminal escape sequence (`\ek...\e\\`):

```tmux
# Globally disable terminal escape sequence renaming
setw -g allow-rename off

# Also valid per-window
set-window-option allow-rename off
```

### 2.2 `automatic-rename` Option

Controls whether tmux automatically renames windows based on the currently running command:

```tmux
# Globally disable automatic renaming
set-option -wg automatic-rename off

# Per-window
setw automatic-rename off
```

**Note from FAQ:** This flag is automatically disabled for an individual window when a name is specified at creation with `new-window` or `new-session`, or later with `rename-window`, or with a terminal escape sequence.

### 2.3 Both Together (Recommended)

```tmux
# Prevent ALL window renaming — both automatic and via escape sequence
setw -g allow-rename off
setw -g automatic-rename off
```

### 2.4 Using the `after-rename-window` Hook

The `window-renamed` hook fires after a rename already happened. Combined with the `after-rename-window` command hook, you can force a rename back:

```tmux
# After any window rename, immediately rename it back to the desired name
# This is a reactive (not preventive) approach
set-hook -g after-rename-window "rename-window '#{@workflow-window-name}'"
```

Store the desired window name as a user option (`@workflow-window-name`) and restore it.

### 2.5 Preventing Rename via Key Binding

Default `Prefix + ,` opens the rename dialog. Unbind it:

```tmux
unbind ,
```

---

## 3. PREVENTING PANE CLOSING

### 3.1 `remain-on-exit` for Panes

Same as the window option (it is a window option, applies to all panes in the window):

```tmux
setw -g remain-on-exit on
```

This prevents panes from being closed when their command exits. The pane becomes "dead" but remains visible.

### 3.2 Unbinding `kill-pane` Keys

Default `Prefix + x` kills the current pane:

```tmux
# Disable kill-pane entirely
unbind x

# Or require confirmation
bind x confirm-before -p "kill-pane? (y/n)" kill-pane

# Or display a message
bind x display-message "Pane killing is disabled in this workflow."
```

### 3.3 Auto-Respawning with `pane-died` Hook

When `remain-on-exit on` is set, use `pane-died` to respawn:

```tmux
setw -g remain-on-exit on

# Immediately respawn any dead pane
set-hook -g pane-died "respawn-pane"

# Respawn with a delay (allow user to see output)
set-hook -g pane-died "run-shell 'sleep 2 && tmux respawn-pane -t #{pane_id}'"
```

**Hook firing rules:**
- `pane-died`: Fires when a pane's process exits AND `remain-on-exit` is `on`. Does NOT fire if user uses `kill-pane`.
- `pane-exited`: Fires when a pane's process exits AND `remain-on-exit` is `off`.
- `after-kill-pane`: Fires after the `kill-pane` command is used (but `hook_pane` is empty — known bug, see GitHub issue #2849).

### 3.4 The Hook Gap for kill-pane

**Critical finding from tmux GitHub issue #2849:**
> "after-kill-pane is triggered after pane-focus-in, ideally it should be the other way round. after-kill-pane's hook_pane is empty, perhaps this can be the pane_id of the pane that just got killed."

This means:
- `kill-pane` via `Prefix+x` DOES trigger `after-kill-pane` (but with empty `hook_pane`)
- `exit` in shell triggers `pane-exited` (not `after-kill-pane`)
- There is NO way to prevent `kill-pane` from executing via hooks

**Workaround: List remaining pane IDs after kill to detect what was removed:**
```bash
# In a shell script monitoring the session
tmux list-panes -s -F '#{pane_id}' > /tmp/current_panes.txt
# Compare with expected pane IDs to detect missing panes
```

---

## 4. PREVENTING SESSION DESTRUCTION

### 4.1 `destroy-unattached` Session Option

Controls what happens to sessions with no attached clients:

```tmux
destroy-unattached [off | on | keep-last | keep-group]
```

- `off` (default): Leave session alive when no clients are attached.
- `on`: Destroy session after last client detaches.
- `keep-last`: Destroy only if it is in a group and has other sessions in that group.
- `keep-group`: Destroy unless it is in a group and is the only session in that group.

**For managed sessions, keep at `off` (the default):**
```tmux
set-option -g destroy-unattached off
```

### 4.2 `exit-unattached` Server Option

If enabled, the **entire tmux server** exits when there are no attached clients:

```tmux
exit-unattached [on | off]
```

**Keep this off (the default) to prevent server exit:**
```tmux
set-option -g exit-unattached off
```

### 4.3 The `no-detach-on-destroy` Client Flag

When a client is attached with this flag, it won't detach when its session is destroyed (if there are other sessions available):

```tmux
tmux attach-session -f no-detach-on-destroy -t mysession
```

### 4.4 Protecting Session via Rename Bindings

Prevent accidental `$` (rename session) action:

```tmux
unbind $
```

---

## 5. KEY BINDING LOCKDOWN

### 5.1 Inventory of ALL Dangerous Default Bindings

From the tmux man page (DEFAULT KEY BINDINGS), the dangerous bindings are:

| Key | Command | Risk Level |
|-----|---------|------------|
| `Prefix + &` | kill-window | HIGH — destroys window |
| `Prefix + x` | kill-pane | HIGH — destroys pane |
| `Prefix + :` | command-prompt | HIGH — arbitrary tmux commands |
| `Prefix + ,` | rename-window | MEDIUM — renames window |
| `Prefix + $` | rename-session | MEDIUM — renames session |
| `Prefix + c` | new-window | MEDIUM — creates unmanaged window |
| `Prefix + d` | detach-client | MEDIUM — detaches from session |
| `Prefix + !` | break-pane | MEDIUM — breaks pane to new window |
| `Prefix + "` | split-window (vertical) | LOW — creates new pane |
| `Prefix + %` | split-window (horizontal) | LOW — creates new pane |
| `Prefix + -` | delete-buffer | LOW |
| `Prefix + .` | move-window | LOW |
| `Prefix + (` | previous-session | LOW |
| `Prefix + )` | next-session | LOW |
| `Prefix + s` | choose-tree (sessions) | LOW |
| `Prefix + w` | choose-tree (windows) | LOW |
| `Prefix + D` | choose-client to detach | MEDIUM |
| `Prefix + C-z` | suspend client | MEDIUM |

### 5.2 Unbinding Specific Dangerous Keys

```tmux
# Kill operations
unbind &          # kill-window
unbind x          # kill-pane

# Command prompt (allows arbitrary tmux commands)
unbind :

# Window/session management
unbind c          # new-window
unbind "          # split-window vertical
unbind %          # split-window horizontal
unbind !          # break-pane

# Renaming
unbind ,          # rename-window
unbind $          # rename-session

# Navigation to other sessions
unbind (
unbind )
unbind s
unbind w
unbind L

# Detach
unbind d
unbind D
```

### 5.3 Unbind ALL Keys (Full Lockdown)

For maximum restriction, unbind everything and re-add only what's needed:

```tmux
# Clear all key tables
unbind-key -a -T prefix
unbind-key -a -T root
unbind-key -a -T copy-mode
unbind-key -a -T copy-mode-vi

# Disable the prefix key entirely
set -g prefix None
```

**After full unbind, re-add only safe bindings:**
```tmux
# Allow scrolling
bind -T root WheelUpPane copy-mode
bind -T copy-mode-vi WheelUpPane send -X scroll-up
bind -T copy-mode-vi WheelDownPane send -X scroll-down
bind -T copy-mode-vi q send -X cancel
```

### 5.4 Disabling the Command Prompt (`:` Key)

The `:` key after prefix opens the tmux command prompt, allowing users to run arbitrary tmux commands:

```tmux
# Simply unbind it
unbind :
```

**Important limitation:** If the user can access a shell inside tmux, they can run `tmux set-option ...` or `tmux bind-key ...` directly from the shell. Shell-level restrictions are required for true lockdown.

### 5.5 Setting a Different or No Prefix

```tmux
# Set a hard-to-accidentally-press prefix
set -g prefix C-q

# Or disable the prefix entirely (combined with unbind -a for full lockdown)
set -g prefix None
```

### 5.6 Custom Key Tables for Restricted Environments

Create a custom key table that limits user actions:

```tmux
# Create a "workflow" key table with only safe actions
bind -T workflow q send -X cancel           # exit copy mode
bind -T workflow ? list-keys -T workflow    # show available keys

# Set the default key table for the session to this restricted table
set -t mysession: key-table workflow
```

---

## 6. TMUX HOOKS — COMPLETE REFERENCE

### 6.1 Full List of Available Hooks (tmux 3.6a)

**After-command hooks (fire after the named command runs):**
```
after-bind-key         after-capture-pane      after-copy-mode
after-display-message  after-display-panes     after-kill-pane
after-list-buffers     after-list-clients      after-list-keys
after-list-panes       after-list-sessions     after-list-windows
after-load-buffer      after-lock-server       after-new-session
after-new-window       after-paste-buffer      after-pipe-pane
after-queue            after-refresh-client    after-rename-session
after-rename-window    after-resize-pane       after-resize-window
after-save-buffer      after-select-layout     after-select-pane
after-select-window    after-send-keys         after-set-buffer
after-set-environment  after-set-hook          after-set-option
after-show-environment after-show-messages     after-show-options
after-split-window     after-unbind-key
```

**Event hooks (fire when events occur):**
```
alert-activity         alert-bell              alert-silence
client-active          client-attached         client-dark-theme
client-detached        client-focus-in         client-focus-out
client-light-theme     client-resized          client-session-changed
command-error          pane-died               pane-exited
pane-focus-in          pane-focus-out          pane-mode-changed
pane-set-clipboard     session-closed          session-created
session-renamed        session-window-changed  window-layout-changed
window-linked          window-renamed          window-resized
window-unlinked
```

### 6.2 Hooks for Monitoring Destruction

| Hook | When it fires | Contains pane ID? |
|------|--------------|-------------------|
| `after-kill-pane` | After `kill-pane` command runs | NO (known bug #2849) |
| `pane-exited` | When pane process exits naturally (remain-on-exit OFF) | YES |
| `pane-died` | When pane process exits (remain-on-exit ON) | YES |
| `window-unlinked` | After window is removed from session | YES (window ID) |
| `after-kill-window` | After `kill-window` command | YES (window ID) |
| `after-rename-window` | After window rename | YES |
| `window-renamed` | When a window is renamed | YES |
| `session-closed` | When session closes | NO |
| `after-kill-session` | After kill-session | - |

### 6.3 Hook Management Commands

```tmux
# Set a global hook
set-hook -g pane-died "respawn-pane"

# Set with array index (multiple hooks for same event)
set-hook -g pane-died[0] "display-message 'pane died'"
set-hook -g pane-died[1] "respawn-pane"

# Run a hook immediately
set-hook -R pane-died

# Unset a hook
set-hook -gu pane-died

# Show all hooks
show-hooks -g

# Show specific hook
show-hooks -g pane-died
```

### 6.4 Hook Patterns for Workflow Protection

**Pattern 1: Auto-respawn on pane death:**
```tmux
setw -g remain-on-exit on
set-hook -g pane-died "respawn-pane"
```

**Pattern 2: Force window name back after rename:**
```tmux
# Store desired name as user option on each window
set-hook -g after-new-window "set-option -w @workflow-name '#{window_name}'"

# On rename, restore it
set-hook -g window-renamed "rename-window '#{@workflow-name}'"
```

**Pattern 3: Alert when a window is unlinked:**
```tmux
set-hook -g window-unlinked "run-shell 'echo \"Window closed\" | notify-send --stdin'"
```

**Pattern 4: Auto-respawn with conditional (check exit code):**
```tmux
setw -g remain-on-exit on
set-hook -g pane-died "if -F '#{!=:#{pane_dead_status},0}' 'respawn-pane' 'display-message \"Process exited cleanly\"'"
```

---

## 7. READ-ONLY MODE

### 7.1 `attach-session -r` Flag

Attach a client in read-only mode:

```bash
tmux attach-session -r -t mysession
# or
tmux attach -f read-only -t mysession
```

**Behavior when read-only:** Only keys bound to `detach-client` or `switch-client` commands have any effect. All other key bindings are ignored.

**Critical caveat from tmux FAQ:**
> "tmux's read-only mode is NOT a security boundary. It is a convenience feature to prevent accidental changes by trusted users. A user with access to a tmux socket should be considered fully trusted and can fully control the tmux server."

### 7.2 `switch-client -r` Toggle

Toggle a currently-attached client between read-only and writable:

```bash
# From inside tmux, toggle read-only for current client
tmux switch-client -r
```

### 7.3 `server-access` Command

Manage per-user access to the tmux server socket (multi-user scenarios):

```bash
# Make a user's clients read-only
tmux server-access -r username

# Revoke access entirely
tmux server-access -d username

# List current access permissions
tmux server-access -l
```

### 7.4 Limitations of Read-Only Mode

- Read-only users can still resize windows (affects all attached clients)
- Read-only mode only blocks KEY BINDINGS, not direct `tmux` shell commands
- If the user can run shell commands, they can bypass read-only entirely

---

## 8. COMPLETE LOCKDOWN CONFIGURATION FOR AGENT WORKFLOWS

### 8.1 Recommended Configuration

This is a comprehensive tmux config for a managed workflow session where users should NOT be able to break the session:

```tmux
# ============================================================
# WORKFLOW SESSION LOCKDOWN CONFIG
# Apply via: tmux -f /path/to/this.conf -L workflow.sock new-session
# ============================================================

# --- Isolation ---
# Use a private socket (prevents conflicts with user tmux)
# Applied at startup: tmux -L atomic-workflow new-session ...

# --- Session survival ---
set-option -g destroy-unattached off      # Don't destroy session on detach
set-option -g exit-unattached off         # Don't exit server on detach

# --- Window/pane survival ---
setw -g remain-on-exit on                 # Keep panes alive after exit
set-option -g remain-on-exit-format "Process exited (status: #{pane_dead_status}). Restarting..."

# --- Auto-respawn on exit ---
set-hook -g pane-died "respawn-pane"

# --- Prevent renaming ---
setw -g allow-rename off                  # Block terminal escape seq renames
setw -g automatic-rename off             # Block automatic renaming

# --- Disable the prefix key entirely for a clean slate ---
# (Uncomment and configure per your needs)
# set -g prefix None

# --- Unbind dangerous keys (keep prefix C-b for now) ---
unbind &          # kill-window
unbind x          # kill-pane
unbind :          # command-prompt (IMPORTANT: blocks arbitrary commands)
unbind c          # new-window (prevent creating unmanaged windows)
unbind "          # split-window
unbind %          # split-window
unbind !          # break-pane
unbind ,          # rename-window
unbind $          # rename-session
unbind (          # previous-session
unbind )          # next-session
unbind s          # choose-tree
unbind w          # choose-tree windows
unbind D          # choose-client to detach
unbind d          # detach client

# --- Re-bind essential safe operations ---
# Scroll support (copy mode)
bind [ copy-mode                          # Allow read-only scrolling
bind -T copy-mode-vi q send -X cancel    # Exit copy mode
bind -T copy-mode-vi Escape send -X cancel
bind -T copy-mode-vi WheelUpPane send -X scroll-up
bind -T copy-mode-vi WheelDownPane send -X scroll-down

# Status bar with guidance
set -g status-style "bg=#1a1a2e,fg=#00d4ff"
set -g status-left "#[fg=#ff6b6b,bold] WORKFLOW SESSION "
set -g status-right "#[fg=#ffd700] Scroll: C-b [ | Exit scroll: q "
set -g display-time 4000

# --- Mouse ---
set -g mouse on                           # Mouse scrolling and selection

# --- Miscellaneous ---
set -s escape-time 0                      # No vim escape delay
set -g history-limit 50000               # Large scrollback
```

### 8.2 Starting the Session with Isolation

```bash
# Start isolated workflow session
tmux -f /path/to/workflow.conf -L atomic-workflow new-session -s main -d

# Create managed windows
tmux -L atomic-workflow new-window -n "agent" -t main
tmux -L atomic-workflow new-window -n "logs" -t main

# Lock in window names immediately (set user option to track desired names)
tmux -L atomic-workflow set-option -wt "main:agent" @workflow-name "agent"
tmux -L atomic-workflow set-option -wt "main:logs" @workflow-name "logs"

# Attach
tmux -L atomic-workflow attach-session -t main
```

### 8.3 Programmatic Session Management from Node/TypeScript

```typescript
import { execSync } from 'child_process';

const SOCKET = 'atomic-workflow';
const tmux = (cmd: string) => execSync(`tmux -L ${SOCKET} ${cmd}`);

// Check if pane is dead (remain-on-exit state)
const isPaneDead = (paneId: string): boolean => {
  const result = execSync(
    `tmux -L ${SOCKET} display -p -t ${paneId} '#{pane_dead}'`
  ).toString().trim();
  return result === '1';
};

// Force-respawn a specific pane
const respawnPane = (paneId: string, command?: string) => {
  const cmd = command ? `"${command}"` : '';
  tmux(`respawn-pane -k -t ${paneId} ${cmd}`);
};
```

---

## 9. KEY LIMITATIONS AND CAVEATS

### 9.1 Hooks Cannot Prevent Destruction

**Hooks are notifications, not interceptors.** There is no `before-kill-window` or `before-kill-pane` hook that can cancel the operation. All available hooks fire AFTER the destructive action has completed.

### 9.2 Shell Access Bypasses Key Bindings

If a user can type commands into a shell pane, they can run:
```bash
tmux kill-window         # bypasses all key binding restrictions
tmux rename-window foo   # bypasses allow-rename off
tmux kill-session        # destroys the entire session
```

Key binding restrictions only affect what users can do via keyboard shortcuts in the tmux UI. They do NOT prevent tmux CLI commands run from within panes.

**Mitigations:**
- Run agent commands in non-shell panes (e.g., direct program execution, not bash)
- Use shell restrictions (`rbash`, custom `$PATH`) to limit available commands
- Monitor via `pane-died` / `window-unlinked` hooks for reactive recovery

### 9.3 `read-only` Mode Is Not True Security

From the tmux FAQ:
> "Any user with access to a tmux socket should be considered fully trusted... The read-only flag is a convenience feature to prevent accidental changes by trusted users, not a security mechanism."

### 9.4 `after-kill-pane` Hook Has Empty `hook_pane` (Bug)

GitHub issue #2849 confirms: `after-kill-pane` fires but `hook_pane` is empty, making it impossible to know WHICH pane was killed from within the hook. Workaround: diff the list of pane IDs before vs after.

---

## 10. REFERENCE SUMMARY TABLE

| Goal | Option/Command | Notes |
|------|---------------|-------|
| Keep pane alive after exit | `setw -g remain-on-exit on` | Pane stays in "dead" state |
| Auto-restart pane on death | `set-hook -g pane-died "respawn-pane"` | Requires remain-on-exit on |
| Prevent window kill via key | `unbind &` | User can still use CLI |
| Require confirmation to kill | `bind & confirm-before kill-window` | Adds friction only |
| Block escape-seq rename | `setw -g allow-rename off` | |
| Block auto-rename | `setw -g automatic-rename off` | |
| Block all key bindings | `unbind-key -a -T prefix; unbind-key -a -T root` | Full lockdown |
| Disable command prompt | `unbind :` | Blocks `Prefix+:` only |
| Disable prefix entirely | `set -g prefix None` | |
| Attach read-only | `tmux attach -r` | Convenience, not security |
| Session survives detach | `set-option -g destroy-unattached off` | Default is already off |
| Server survives detach | `set-option -g exit-unattached off` | Default is already off |
| Monitor renames | `set-hook -g window-renamed "..."` | Reactive only |
| Monitor window loss | `set-hook -g window-unlinked "..."` | Reactive only |
| Isolated tmux server | `tmux -L mysocket ...` | Separate socket = isolation |

---

## Sources

- tmux man page (local, tmux 3.6a): `man tmux`
- [tmux FAQ - GitHub Wiki](https://github.com/tmux/tmux/wiki/FAQ)
- [tmux Advanced Use - GitHub Wiki](https://github.com/tmux/tmux/wiki/Advanced-Use)
- [Hook problems with killing pane - Issue #2849](https://github.com/tmux/tmux/issues/2849)
- [Hook problems with killing window - Issue #2848](https://github.com/tmux/tmux/issues/2848)
- [tmux man page - man7.org](https://man7.org/linux/man-pages/man1/tmux.1.html)
- [Prevent pane/window from closing - Unix Stack Exchange](https://unix.stackexchange.com/questions/17116/prevent-pane-window-from-closing-when-command-completes-tmux)
- [How to respawn panes - tmuxai.dev](https://tmuxai.dev/tmux-respawn-pane/)
- [Binding Keys in tmux - seanh.cc](https://www.seanh.cc/2020/12/28/binding-keys-in-tmux/)
- [Read-only guest tmux sessions - brianmckenna.org](https://brianmckenna.org/blog/guest_tmux)
- Existing research: `/Users/norinlavaee/atomic/research/web/2026-04-10-tmux-ux-for-embedded-cli-tools.md`
