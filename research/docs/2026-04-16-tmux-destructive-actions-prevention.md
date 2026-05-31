---
date: 2026-04-16 14:10:03 PDT
researcher: Claude
git_commit: 9a313628
branch: flora131/bug/tmux-management
repository: atomic
topic: "Preventing destructive tmux actions during workflow execution — window closing, renaming, pane killing, and command prompt access"
tags: [research, codebase, tmux, workflow, ux, security, destructive-actions]
status: complete
last_updated: 2026-04-16
last_updated_by: Claude
last_updated_note: "Added online research findings: remain-on-exit failed, pane-died auto-respawn hook, read-only mode, shell bypass limitation"
---

# Research: Preventing Destructive tmux Actions During Workflow Execution

## Research Question

We need to prevent users from performing destructive actions inside a tmux session that is running as part of an Atomic workflow. Specifically:

1. Users should **not** be able to close tmux windows
2. Users should **not** be able to rename tmux windows
3. Users should **not** be able to close a tmux view running as part of a workflow
4. Users **should only** be able to: respond to/engage with agents, navigate stages (UX controls), and quit via `q`

The goal is to lock down the tmux environment during workflow execution to prevent accidental or intentional disruption of workflow state.

## Summary

The Atomic tmux environment currently has **no protections** against destructive user actions. The bundled `tmux.conf` (`src/sdk/runtime/tmux.conf`) does not modify the tmux prefix key (defaults to `C-b`), meaning all default tmux keybindings remain active. Users can:

- **Kill windows**: `C-b &` (kill-window with confirmation), `C-b x` (kill-pane)
- **Rename windows**: `C-b ,` (rename-window)
- **Open command prompt**: `C-b :` (arbitrary tmux commands — including `kill-session`, `kill-window`, `kill-pane`, `rename-window`)
- **Detach**: `C-b d` (detach from session)
- **Create new windows/panes**: `C-b c`, `C-b -`, `C-b |` (custom bindings)

Any of these actions can break the workflow's tmux session structure, causing the orchestrator panel to lose track of agent windows, fail to capture pane output, or crash entirely.

The fix requires changes in two locations:
1. **`src/sdk/runtime/tmux.conf`** — Unbind all dangerous default keybindings and optionally use `remain-on-exit` to protect against in-pane exits
2. **`src/sdk/components/session-graph-panel.tsx`** — No changes needed (it already only responds to specific keys)

The workflow's React-based TUI (orchestrator panel) is already well-locked-down — it only processes `q`, `Ctrl+C`, arrow keys, `hjkl`, `Enter`, `g/G`, and `/`. The problem is entirely at the tmux layer.

## Detailed Findings

### 1. Current tmux Configuration (`src/sdk/runtime/tmux.conf`)

The bundled config at `src/sdk/runtime/tmux.conf:1-74` sets up:

| Setting | Line | Purpose |
|---|---|---|
| `set-option -g mouse on` | 10 | Mouse scrolling |
| `set-option -g allow-rename off` | 13 | Prevents *processes* from renaming windows (but NOT users) |
| `set -g escape-time 0` | 16 | Vim-friendly |
| `set -g history-limit 50000` | 17 | Large scrollback |
| `bind - split-window -v` | 33 | Pane splitting |
| `bind \| split-window -h` | 34 | Pane splitting |
| `bind -r l/h/k/j resize-pane` | 37-40 | Pane resizing |
| `bind -n C-g select-window -t :0` | 59 | Return to graph |
| `bind -n C-\\ next-window` | 62 | Cycle agent windows |

**Critical gap**: The prefix key remains `C-b` (tmux default). All dangerous default prefix bindings are active.

**Key distinction**: `allow-rename off` only prevents *automatic* renaming by running processes (via escape sequences). It does **not** prevent the user from manually renaming via `C-b ,` or `tmux rename-window`.

### 2. Default tmux Prefix Bindings That Are Dangerous

These tmux default bindings are active in the current config and can break workflows:

| Binding | Command | Risk |
|---|---|---|
| `C-b &` | `confirm-before -p "kill-window #W? (y/n)" kill-window` | **Kills an agent window** — orphans the session runner |
| `C-b x` | `confirm-before -p "kill-pane #P? (y/n)" kill-pane` | **Kills a pane** — same effect as killing the window for single-pane windows |
| `C-b ,` | `command-prompt -I "#W" "rename-window -- '%%'"` | **Renames window** — breaks `tmux.selectWindow(name)` calls in executor |
| `C-b :` | `command-prompt` | **Opens tmux command prompt** — user can run ANY tmux command |
| `C-b d` | `detach-client` | **Detaches** — user exits the workflow but session keeps running headlessly |
| `C-b c` | `new-window` | Creates unexpected windows — confuses the window list |
| `C-b n` / `C-b p` | `next-window` / `previous-window` | Already overridden by `C-\` but prefix versions still work |
| `C-b w` | `choose-tree -Zw` | Opens window picker — could select unexpected window |
| `C-b $` | `command-prompt -I "#S" "rename-session -- '%%'"` | **Renames session** — breaks `tmuxSessionName` references |

### 3. Workflow Session Structure (What Gets Broken)

From `src/sdk/runtime/executor.ts`:

**Session naming** (`executor.ts:346`):
```
atomic-wf-<agent>-<definition.name>-<workflowRunId>
```

**Window creation** (`executor.ts:967`):
```ts
tmux.createWindow(shared.tmuxSessionName, name, paneCmd, undefined, paneEnvVars);
```

**Window targeting** (throughout `executor.ts` and providers):
```ts
tmux.killWindow(shared.tmuxSessionName, name);       // uses session:window notation
tmux.selectWindow(`${tmuxSession}:${n.name}`);        // panel.tsx:150
tmux.capturePane(paneId);                              // pane ID from createWindow
tmux.sendLiteralText(paneId, text);                    // agent automation
```

If a user renames a window via `C-b ,`, any `tmux.killWindow(session, name)` or `tmux.selectWindow(session:name)` call will fail because the window name no longer matches what the executor expects. If a user kills a window via `C-b &`, the `paneId` becomes invalid, causing `capturePane` and `sendLiteralText` to fail.

### 4. Orchestrator Panel Controls (Already Safe)

The React TUI at `src/sdk/components/session-graph-panel.tsx:216-310` handles keyboard input via `useKeyboard()`. It processes **only**:

| Key | Action | Line |
|---|---|---|
| `q` / `Ctrl+C` | `store.requestQuit()` | 241-243 |
| Arrow keys / `hjkl` | Navigate graph nodes | 260-275 |
| `Enter` | Attach to focused node | 277-279 |
| `G` (shift) | Focus deepest leaf | 283-296 |
| `gg` (double-tap) | Focus root | 299-308 |
| `/` | Open compact switcher | 253-255 |

When the switcher is open (lines 218-237), only `Escape`, `up/down/k/j`, and `Enter` are processed.

**Auto-reset** (line 247-249): When the user is in "attached" mode and presses a key back in the orchestrator window, viewMode resets to "graph". This is correct behavior.

The React TUI does not expose any destructive actions. The problem is purely at the tmux layer.

### 5. tmux-Level Navigation (Prefix-Free Bindings)

Two prefix-free bindings provide workflow navigation (`tmux.conf:59,62`):

| Binding | Command | Purpose |
|---|---|---|
| `C-g` | `select-window -t :0` | Return to graph (window 0) |
| `C-\` | `next-window` | Cycle to next agent window |

These are safe and should remain. They work without the prefix key.

### 6. tmux Status Bar Sync (`session-graph-panel.tsx:400-421`)

The panel dynamically updates the tmux status bar based on viewMode:

- **Attached mode**: Shows agent names via `window-status-format`, with hints `ctrl+g graph . ctrl+\ next`
- **Graph mode**: Restores minimal defaults

The status bar constants are defined in `tmux.ts:43-53` and mirrored in `tmux.conf:25-30`.

### 7. Active Window Polling (`session-graph-panel.tsx:369-394`)

The panel polls `tmux display-message` every 500ms to detect when the user uses `C-g` or `C-\` (which bypass React's `useKeyboard`). This sync mechanism would break if windows are renamed or killed.

### 8. Quit Flow

The quit mechanism is clean and safe:

1. User presses `q` or `Ctrl+C` in the orchestrator panel
2. `store.requestQuit()` fires (`orchestrator-panel-store.ts:175-181`)
3. If workflow is still running: `resolveAbort()` triggers `WorkflowAbortError` in `executor.ts:1396-1398`
4. Executor calls `shutdown()` (`executor.ts:1317-1325`): destroys panel, kills tmux session, sets exit code
5. If workflow completed: `resolveExit()` triggers exit

This flow is already robust. Protecting against destructive tmux actions will keep this flow intact.

### 9. Chat Command (`src/commands/cli/chat/index.ts`)

The chat command creates single-window tmux sessions (`atomic-chat-<agent>-<id>`). It does NOT have an orchestrator panel. The same tmux protections should apply but with less urgency since there's no multi-window coordination to break.

## tmux Options for Preventing Destructive Actions

### Strategy 1: Unbind All Dangerous Default Keys (Recommended)

Add to `tmux.conf`:

```bash
# ── Workflow protection: unbind destructive defaults ──────────────
# Atomic manages window lifecycle programmatically.  Users should interact
# with agents and navigate via Ctrl+G / Ctrl+\ / the graph panel — not
# through raw tmux commands.

# Prevent window/pane destruction
unbind &     # kill-window (default: confirm-before kill-window)
unbind x     # kill-pane   (default: confirm-before kill-pane)

# Prevent renaming
unbind ,     # rename-window
unbind '$'   # rename-session

# Prevent command prompt (blocks arbitrary tmux commands)
unbind :     # command-prompt

# Prevent detach (workflow should be exited via q, not detach)
unbind d     # detach-client
unbind D     # choose-client -Z (detach menu)

# Prevent uncontrolled window/pane creation
unbind c     # new-window
unbind '"'   # split-window (default vertical)
unbind %     # split-window -h (default horizontal)
unbind -     # our custom vertical split (remove during workflow)
unbind '|'   # our custom horizontal split (remove during workflow)

# Prevent window navigation that bypasses our controls
unbind n     # next-window (we have Ctrl+\ instead)
unbind p     # previous-window
unbind l     # last-window
unbind w     # choose-tree -Zw

# Prevent window swapping/moving
unbind .     # move-window (command-prompt)
```

### Strategy 2: `remain-on-exit` for Crash Protection

If a process inside a tmux pane exits (e.g., the agent crashes, user types `exit`), the pane normally closes. Setting `remain-on-exit on` keeps the pane visible with a `[Pane is dead]` banner, allowing the orchestrator to detect the failure gracefully.

```bash
set-option -g remain-on-exit on
```

**Consideration**: If used, the orchestrator needs to handle dead panes appropriately. Currently, `paneIsIdle()` and `paneLooksReady()` check for prompts — a dead pane would return empty/static content and eventually timeout.

### Strategy 3: Disable the Prefix Key Entirely

The most aggressive approach — completely remove the prefix key:

```bash
set -g prefix None
unbind C-b
```

**Risk**: This would also disable copy-mode entry via `C-b [`. However, mouse scrolling (already enabled) and `C-g`/`C-\` (prefix-free) would still work. Copy-mode vi keybindings would still work once in copy-mode (entered via mouse scroll).

**Alternative**: Rebind the prefix to an unlikely key:

```bash
set -g prefix C-F12
unbind C-b
```

This effectively disables all prefix-based commands while keeping tmux's internal machinery intact.

### Strategy 4: Custom Key Table for Restricted Mode

tmux supports custom key tables. You could create a restricted table that only allows safe actions:

```bash
# Create a restricted key table with only safe bindings
bind -T restricted-root C-g select-window -t :0
bind -T restricted-root C-\\ next-window
# ... copy-mode bindings
```

**Complexity**: This approach is more complex and less maintainable. The unbind approach (Strategy 1) achieves the same goal with less code.

### Strategy 5: Read-Only Attach Mode

tmux supports a read-only flag on `attach-session`:

```bash
tmux attach-session -r -t mysession    # -r = read-only,ignore-size
```

When read-only, **only `detach-client` and `switch-client` bindings work**. All other key bindings are silently ignored.

**Critical caveat** (from official tmux FAQ): Read-only mode is "a convenience feature to prevent accidental changes by trusted users, not a security mechanism." A user who can run `tmux` commands from a shell bypasses it entirely.

**Not applicable for Atomic**: Users need to interact with agent CLIs in agent windows, so read-only mode would block all input.

### Strategy 6: `remain-on-exit failed` + `pane-died` Hook

tmux 3.2+ supports `remain-on-exit failed` which only keeps dead panes visible when the exit code is non-zero (crash/error), but auto-closes on clean exit (exit code 0):

```bash
setw -g remain-on-exit failed       # only keep dead panes on non-zero exit
set-hook -g pane-died "respawn-pane" # auto-restart dead panes
```

This is more nuanced than plain `remain-on-exit on` — clean exits still close the pane while crashes are preserved for debugging.

### Architectural Limitation: Shell Access Bypass

**Important**: If users have shell access within a pane (i.e., the agent runs in an interactive shell), they can bypass ALL key binding restrictions by running tmux CLI commands directly:

```bash
tmux kill-window    # bypasses unbind &
tmux rename-window  # bypasses unbind ,
tmux kill-session   # bypasses unbind $
```

Key binding lockdown only controls the tmux UI keyboard shortcuts, not the tmux CLI itself. This is a known tmux limitation — there is no way to prevent a user with shell access from running arbitrary tmux commands.

**Mitigation for Atomic**: Since agents run as direct program executions in their panes (not interactive shell sessions where the user can type arbitrary commands), this bypass requires the user to intentionally exit the agent first and then run tmux commands in the resulting shell. The `remain-on-exit on` setting would further protect against this by keeping the pane in a "dead" state rather than dropping to a shell.

### tmux Hooks — Reference (tmux 3.6a)

Available hooks for monitoring/reacting (but **not preventing**):

| Hook | Trigger | Notes |
|---|---|---|
| `pane-died` | Process exits (remain-on-exit ON) | Use to auto-respawn |
| `pane-exited` | Process exits (remain-on-exit OFF) | |
| `after-kill-pane` | `kill-pane` command used | `hook_pane` is empty (bug #2849) |
| `window-renamed` | Window was renamed | Reactive — rename already done |
| `after-rename-window` | After rename-window command | Same |
| `window-unlinked` | Window removed from session | After destruction |
| `session-closed` | Session closed | |

**No `before-` hooks exist** — hooks cannot prevent actions, only react after the fact.

## Code References

### tmux Configuration
- `src/sdk/runtime/tmux.conf:1-74` — Current bundled config (no protections)
- `src/sdk/runtime/tmux.ts:22` — `CONFIG_PATH` constant pointing to `tmux.conf`
- `src/sdk/runtime/tmux.ts:143` — Config injected via `-f` flag in `tmuxRun()`
- `src/sdk/runtime/tmux.ts:228` — `source-file` reload after session creation

### tmux Session/Window Lifecycle
- `src/sdk/runtime/tmux.ts:204-230` — `createSession()` — creates tmux session with initial command
- `src/sdk/runtime/tmux.ts:242-262` — `createWindow()` — creates window in existing session
- `src/sdk/runtime/tmux.ts:407-413` — `killSession()` — kills session (cleanup)
- `src/sdk/runtime/tmux.ts:416-422` — `killWindow()` — kills window (cleanup/error)
- `src/sdk/runtime/tmux.ts:653-655` — `selectWindow()` — switches to window by target name

### Workflow Executor
- `src/sdk/runtime/executor.ts:334-409` — `executeWorkflow()` — creates tmux session, attaches user
- `src/sdk/runtime/executor.ts:395-396` — Session creation with `tmux.createSession()`
- `src/sdk/runtime/executor.ts:966-968` — Window creation for each stage with `tmux.createWindow()`
- `src/sdk/runtime/executor.ts:1247-1252` — Error cleanup: `tmux.killWindow()` for failed stages
- `src/sdk/runtime/executor.ts:1317-1325` — `shutdown()`: panel.destroy() + tmux.killSession()
- `src/sdk/runtime/executor.ts:1395-1398` — Abort promise: races workflow against user quit

### Orchestrator Panel (React TUI)
- `src/sdk/components/session-graph-panel.tsx:216-310` — Keyboard handler (safe, only processes navigation/quit)
- `src/sdk/components/session-graph-panel.tsx:150` — `tmuxRun(["switch-client"])` for agent attach
- `src/sdk/components/session-graph-panel.tsx:369-394` — Active window polling (500ms interval)
- `src/sdk/components/session-graph-panel.tsx:400-421` — Status bar mode sync

### Panel Store
- `src/sdk/components/orchestrator-panel-store.ts:175-181` — `requestQuit()`: routes to exit or abort
- `src/sdk/components/orchestrator-panel-store.ts:150-154` — `setViewMode()`: graph/attached toggle

### Status Bar Constants
- `src/sdk/runtime/tmux.ts:38-53` — All `TMUX_DEFAULT_STATUS_*` and `TMUX_ATTACHED_*` constants

## Architecture Documentation

### Current User Interaction Model

```
User in Workflow Session
    |
    ├── [Orchestrator Window (0)] ← React TUI (OpenTUI)
    |       ├── q / Ctrl+C → quit workflow
    |       ├── arrows/hjkl → navigate graph
    |       ├── Enter → attach to agent window
    |       ├── G/gg → focus deepest/root node
    |       └── / → open agent switcher
    |
    ├── [Agent Window 1] ← Running agent CLI (Claude/OpenCode/Copilot)
    |       ├── C-g → return to graph (tmux binding)
    |       ├── C-\ → cycle to next agent (tmux binding)
    |       └── User interacts with agent normally (type, scroll, etc.)
    |
    ├── [Agent Window N] ← Additional agent windows
    |
    └── [tmux Prefix (C-b)] ← CURRENTLY UNPROTECTED
            ├── & → KILL WINDOW (breaks workflow)
            ├── x → KILL PANE (breaks workflow)
            ├── , → RENAME WINDOW (breaks executor references)
            ├── : → COMMAND PROMPT (arbitrary tmux commands)
            ├── d → DETACH (exits but session continues)
            ├── c → NEW WINDOW (confuses window list)
            └── ... (other dangerous defaults)
```

### Proposed Interaction Model After Fix

```
User in Workflow Session
    |
    ├── [Orchestrator Window (0)] ← React TUI (unchanged)
    |       └── (same safe controls)
    |
    ├── [Agent Windows] ← Running agents (unchanged)
    |       ├── C-g → return to graph
    |       ├── C-\ → cycle next agent
    |       ├── Mouse scroll → copy-mode (read scrollback)
    |       └── Normal agent interaction
    |
    └── [tmux Prefix (C-b)] ← ALL DANGEROUS BINDINGS REMOVED
            └── Only copy-mode and safe operations remain
```

### Files That Need Modification

| File | Change | Impact |
|---|---|---|
| `src/sdk/runtime/tmux.conf` | Add `unbind` directives for all dangerous keys | Prevents destructive actions at tmux layer |
| `src/sdk/runtime/tmux.conf` | Optionally add `remain-on-exit on` | Prevents pane auto-close on process exit |
| `src/sdk/runtime/tmux.conf` | Optionally remove pane split bindings | Prevents users from creating new panes |

No changes needed in:
- `src/sdk/runtime/tmux.ts` — Config is already injected via `-f` flag
- `src/sdk/runtime/executor.ts` — Session lifecycle is already managed programmatically
- `src/sdk/components/session-graph-panel.tsx` — React TUI is already locked down
- `src/sdk/components/orchestrator-panel-store.ts` — Quit flow is already robust

## Historical Context (from research/)

- `research/docs/2026-04-10-tmux-ux-implementation-guide.md` — Previous implementation guide for tmux config injection, socket isolation, and UX improvements. Documents the `tmuxRun()` architecture that makes config injection work.
- `research/web/2026-04-10-tmux-ux-for-embedded-cli-tools.md` — Survey of OSS projects embedding tmux. Overmind uses `allow-rename off` and `remain-on-exit on`. Zellij has a locked mode. Google Cloud Shell hides tmux entirely.
- `research/web/2026-04-10-tmux-ux-improvements.md` — Original proposal for bundled tmux config, `-f` injection, `-L atomic` socket isolation. All implemented. Does not address destructive action prevention.
- `research/web/2026-04-11-tmux-copy-mode-ux-scroll-exit.md` — Copy-mode UX research.

## Related Research

- `research/docs/2026-04-10-tmux-ux-implementation-guide.md` — Companion research for tmux architecture
- `research/web/2026-04-10-tmux-ux-improvements.md` — Original tmux UX proposal
- `research/web/2026-04-16-tmux-preventing-destructive-actions.md` — Online research on tmux protection options (man page, hooks, read-only mode, GitHub issues)

## Open Questions

1. **Should detach (`C-b d`) be blocked?** Detaching doesn't break the workflow — the session continues running. But the user might not know how to reattach (`tmux -L atomic attach`). Currently, the quit mechanism (`q`) kills the session. If detach is blocked, users must use `q` to exit. Recommendation: block it for consistency.

2. **Should `remain-on-exit` be enabled?** If an agent process crashes, `remain-on-exit on` keeps the pane visible (showing `[Pane is dead]`). Without it, the pane closes and the window disappears. The orchestrator's error handling (`executor.ts:1199-1203`) already catches errors and writes `error.txt`. However, `remain-on-exit` would give users visual feedback that something went wrong. Recommendation: enable it for better UX.

3. **Copy-mode entry**: If the prefix key is unbound or rebound, users lose `C-b [` to enter copy-mode. However, mouse scroll already triggers copy-mode (because `mouse on` is set). This should be sufficient for most users. Advanced users who know `C-b [` will understand the restriction.

4. **Should protections apply to chat sessions too?** Chat sessions (`atomic chat -a <agent>`) are single-window and don't have orchestrator coordination. The risk is lower, but for consistency the same config applies (since both use the same `tmux.conf` via `tmuxRun()`). The unbindings are harmless for chat sessions.

5. **Prefix key approach**: Unbinding individual keys (Strategy 1) vs. disabling the prefix entirely (Strategy 3). Unbinding is more surgical and preserves the prefix for any remaining safe bindings (like `C-b [` for copy-mode). Disabling the prefix is more aggressive but guarantees no undiscovered dangerous binding slips through. Recommendation: unbind individual keys (Strategy 1) since mouse scrolling handles the copy-mode use case.
