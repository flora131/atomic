---
date: 2026-04-15 05:34:52 UTC
researcher: Claude
git_commit: 3b15918b3f2c4a7b3d325feec35ff49807063297
branch: main
repository: atomic
topic: "Prevent users from closing or renaming tmux windows in agent sessions"
tags: [research, codebase, tmux, ux, runtime, keybindings, psmux, agent-sessions, paused-state, sdk-events]
status: complete
last_updated: 2026-04-15
last_updated_by: Claude
last_updated_note: "Added follow-up research on the paused-state objective (ticket #003): SDK idle/cancellation event mapping (Claude/OpenCode/Copilot), TUI animation/timer gating, and session checkpointing primitives. Second follow-up: exhaustive read of the local SDK docs in docs/ to extract abort, interrupt, session persistence, resume, and hook APIs verbatim."
---

# Research: Preventing Window Close / Rename in Agent Sessions

## Research Question

Within an active agent session, users must not be able to close or rename
tmux windows or exit out of the Copilot CLI, Claude Code, or OpenCode CLI
that is open in a window (e.g., double Ctrl+C not permitted).

Acceptance criteria to evaluate:
1. Window close keybind suppressed for agent session windows
2. Window rename keybind suppressed for agent session windows
3. Suppressed actions show a non-blocking status message
4. Ctrl+C transitions to paused state (see #003)
5. `q` triggers clean exit flow
6. Non-agent tmux windows unaffected

> This applies to tmux windows **within the agent session**, not the terminal
> emulator window itself.

## Summary

All tmux operations flow through a single dispatcher, `tmuxRun()` at
[`src/sdk/runtime/tmux.ts:138-153`](#code-references), which injects
`-f <tmux.conf> -L atomic` on every invocation. The bundled config at
[`src/sdk/runtime/tmux.conf`](#code-references) currently **does not** override
tmux's default destructive bindings (`prefix + &` kill-window,
`prefix + x` kill-pane, `prefix + ,` rename-window, `prefix + $`
rename-session, `prefix + :` command-prompt, and the mouse right-click
window/pane menus). Because the atomic tmux server is fully isolated from
the user's personal tmux server via the `-L atomic` socket, any binding
overrides placed in this config only affect Atomic sessions — satisfying
criterion 6 for free.

The codebase already has two building blocks needed for implementation:
**(1)** a canonical `if-shell -F "#{...}"` conditional-keybinding pattern at
[`tmux.conf:65`](#code-references) (used for copy-mode Escape behavior),
and **(2)** a `#{==:#{window_index},0}` format-conditional at
[`tmux.ts:50-51`](#code-references) (used to hide the orchestrator window
from the attached-mode status list). Combining these patterns produces
per-window-index guards for `&` and `,` without spawning shells (which is
important for psmux compatibility).

Atomic **does not currently use** `display-message -d <ms>` for any
user-facing feedback; all non-blocking status is surfaced via the OpenTUI
`Statusline` component in the orchestrator window only. For agent windows
(where OpenTUI is not rendering), `display-message -d` is the canonical
tmux-native mechanism for a non-blocking toast, and psmux explicitly
supports it.

The acceptance criteria reference three exit/pause flows with distinct
current behavior:
- **`q` in orchestrator** → already routes to `store.requestQuit()` →
  `resolveAbort()` → `WorkflowAbortError` → `shutdown(0)` → full session
  teardown ([`session-graph-panel.tsx:241`](#code-references),
  [`orchestrator-panel-store.ts:159-165`](#code-references),
  [`executor.ts:1172-1180`](#code-references)). This already matches
  criterion 5 (`q` triggers a clean exit flow).
- **Ctrl+C in orchestrator** → same path as `q`. Criterion 4 ("transitions
  to paused state, see #003") refers to future work in a separate
  spec/ticket; a paused state does **not** exist in the current codebase.
- **Ctrl+C / `q` inside an agent window** → tmux passes the keystroke
  through to the embedded CLI (Claude Code / OpenCode / Copilot CLI),
  which interprets it per its own logic (e.g., Claude's double-Ctrl+C
  exit). No tmux-level interception of `C-c` exists today.

Session naming and window layout are also already unambiguous: workflow
sessions are `atomic-wf-<agent>-<name>-<id>` with window 0 = orchestrator
and windows 1+ = agent CLIs; chat sessions are `atomic-chat-<agent>-<id>`
with exactly one window running the agent CLI. The `-L atomic` socket
means **every** window on the atomic server is an Atomic-managed window,
which simplifies the "which windows should be protected" decision.

## Detailed Findings

### 1. The `tmuxRun()` Dispatcher and Config Injection

All tmux invocations funnel through `tmuxRun()`, which prepends
`-f <CONFIG_PATH> -L <SOCKET_NAME>` to every command:

```ts
// src/sdk/runtime/tmux.ts:138-153
export function tmuxRun(args: string[]): TmuxResult {
  const binary = getMuxBinary();
  if (!binary) { /* ... */ }
  const fullArgs = ["-f", CONFIG_PATH, "-L", SOCKET_NAME, ...args];
  const result = Bun.spawnSync({
    cmd: [binary, ...fullArgs],
    /* ... */
  });
  /* ... */
}
```

- `SOCKET_NAME = "atomic"` ([`tmux.ts:19`](#code-references))
- `CONFIG_PATH = join(import.meta.dir, "tmux.conf")` ([`tmux.ts:22`](#code-references))
- The `-f` flag is only honored on server start; for already-running
  servers, `createSession()` explicitly re-sources the config via
  `tmuxRun(["source-file", CONFIG_PATH])` after creating the session
  ([`tmux.ts:226-228`](#code-references)).

All exported tmux functions (createSession, createWindow, killSession,
killWindow, switchClient, selectWindow, display-message queries, etc.)
go through `tmuxRun`. A handful of specialized call sites that need
`stdin: "inherit"` (attachSession, spawnMuxAttach, detachAndAttachAtomic)
call `Bun.spawn*` directly but still build their argv through
`buildAttachArgs()` at [`tmux.ts:545-551`](#code-references), which
mirrors the flag injection.

### 2. The Current `tmux.conf` — What's Bound and What's Not

[`src/sdk/runtime/tmux.conf`](#code-references) (74 lines) defines:

- **True color + clipboard**: `terminal-overrides`, `set-clipboard on`,
  `allow-passthrough on`
- **Mouse on**: `set-option -g mouse on`
- **`allow-rename off`**: prevents *processes* from overwriting window
  titles via escape sequences. **Does NOT** prevent the user from
  manually triggering `prefix + ,` (rename-window) or `prefix + $`
  (rename-session) — those bindings open a `command-prompt` that calls
  `rename-window`/`rename-session` directly, bypassing `allow-rename`.
- **Sane defaults** (inlined from tmux-sensible): `escape-time 0`,
  `history-limit 50000`, `display-time 4000`, `status-interval 5`,
  `focus-events on`, `aggressive-resize on`
- **Status bar**: minimal, with `#{session_name}` on the right and
  agent-list/hints in attached mode via constants in
  [`tmux.ts:38-53`](#code-references)
- **Pane split / resize bindings**: `-`, `|` for split; `hjkl` for resize
- **Vi copy-mode**: `v` / `C-v` / `y` bindings, plus custom mouse
  drag/click handlers at [`tmux.conf:71-73`](#code-references)
- **Prefix-free navigation**: `bind -n C-g select-window -t :0` and
  `bind -n C-\\ next-window` at [`tmux.conf:58-62`](#code-references)

**What's NOT defined** (so tmux defaults apply):
- `prefix + &` — `confirm-before -p "kill-window #W? (y/n)" kill-window`
- `prefix + x` — `confirm-before -p "kill-pane #P? (y/n)" kill-pane`
- `prefix + ,` — `command-prompt -I "#W" { rename-window -- "%%" }`
- `prefix + $` — `command-prompt -I "#S" { rename-session -- "%%" }`
- `prefix + :` — `command-prompt` (full tmux command line — user can type
  any command including `kill-window`, `kill-session`, `rename-window`)
- `MouseDown3Status` (right-click on window status) — opens
  `DEFAULT_WINDOW_MENU` with a "Kill" entry that runs `kill-window`
- `MouseDown3Pane` (right-click on pane body) — opens
  `DEFAULT_PANE_MENU` with a "Kill" entry that runs `kill-pane`
- `prefix + d` — `detach-client` (detach, not kill — session stays alive)
- `prefix + D` — `choose-client -Z` (choose which client to detach)

The comment block at [`tmux.conf:53-56`](#code-references) explicitly
notes: "Ctrl+\\ overrides the default SIGQUIT signal. Agent CLIs running
in these panes will not receive SIGQUIT via Ctrl+\\. … The integrated
agents (Claude Code, OpenCode, Copilot CLI) use Ctrl+C for interrupts
and are not affected." No equivalent interception exists for Ctrl+C.

### 3. Agent Session Window Taxonomy

Session naming (parsed by
[`parseSessionName()` at `tmux.ts:466-492`](#code-references)):

| Session kind | Name format                           | Windows                            |
|--------------|----------------------------------------|------------------------------------|
| Workflow     | `atomic-wf-<agent>-<name>-<id>`        | Window 0 = orchestrator; 1+ agents |
| Chat         | `atomic-chat-<agent>-<id>`             | Single window = agent CLI          |

- **Workflow sessions** are created by the executor at
  [`executor.ts:1090-1104`](#code-references) via
  `OrchestratorPanel.create()` and `createSession(tmuxSessionName, …)`.
  The initial window (index 0) runs the OpenTUI React renderer — it's
  where `Statusline`, the graph canvas, and the `useKeyboard` handler
  live. Agent windows (index 1+) are added by
  `tmux.createWindow(sharedTmuxSessionName, name, command, …)` per
  [`executor.ts:1185-1191`](#code-references) cleanup loop.
- **Chat sessions** are created by
  [`src/commands/cli/chat/index.ts:201-221`](#code-references). There is
  **no orchestrator window**: the single window starts with `shellCmd`
  that launches the agent CLI directly. `windowName` is set equal to
  the session name.
- In **both** cases, the session lives on the `-L atomic` socket; every
  window on that socket is an Atomic-managed window.
- Window-index detection pattern already present in the codebase:
  `"#{?#{==:#{window_index},0},, #W }"` — the attached-mode window-list
  format at [`tmux.ts:50-51`](#code-references) — hides window 0
  (orchestrator) from the status bar.

### 4. How Status and Feedback Are Currently Surfaced

- **OpenTUI `Statusline`** at `src/sdk/components/statusline.tsx`
  renders the bottom row of the orchestrator window (mode badge,
  focused-node status, background task count, navigation hints).
  Present **only** in window 0.
- **Attach flash message** at
  [`session-graph-panel.tsx:120-128`](#code-references) — React state
  (`attachMsg`) cleared by a `setTimeout` after
  `ATTACH_MSG_DISPLAY_MS = 2400` ms; also only rendered in window 0.
- **tmux status bar** — set via `tmuxRun(["set", "-g", "status-right",
  …])` at
  [`session-graph-panel.tsx:400-421`](#code-references). Used for
  agent-list rendering in attached mode and for the "ctrl+g graph ·
  ctrl+\\ next" hints. Managed centrally from the orchestrator React
  tree.
- **`display-message -p`** is used today only as a **query** mechanism
  (e.g., `display-message -t <session> -p "#{window_index} #{window_name}"`
  polled every 500 ms at
  [`session-graph-panel.tsx:373-376`](#code-references); and
  `display-message -p "#{session_name}"` in
  [`tmux.ts:600`](#code-references)).
- **`display-message -d <ms>`** (non-blocking status toast on the tmux
  status bar) is **not used anywhere** in the codebase. `set -g
  display-time 4000` at [`tmux.conf:18`](#code-references) sets the
  default duration, but because `-d` overrides the default, the
  configured `display-time` is effectively unused for this purpose.

### 5. Current Exit/Pause Handling

#### `q` and `Ctrl+C` in the orchestrator window (index 0)

```ts
// src/sdk/components/session-graph-panel.tsx:241-244
if ((key.ctrl && key.name === "c") || key.name === "q") {
  store.requestQuit();
  return;
}
```

`store.requestQuit()` at
[`orchestrator-panel-store.ts:159-165`](#code-references) branches on
`completionReached`:

```ts
requestQuit(): void {
  if (this.completionReached) {
    this.resolveExit();   // end waitForExit() → graceful shutdown(0)
  } else {
    this.resolveAbort();  // end waitForAbort() → WorkflowAbortError
  }
}
```

At [`executor.ts:1172-1180`](#code-references), the orchestrator races
`definition.run(workflowCtx)` against `panel.waitForAbort()`:

```ts
const abortPromise = panel.waitForAbort().then(() => {
  throw new WorkflowAbortError();
});
await Promise.race([definition.run(workflowCtx), abortPromise]);
```

`WorkflowAbortError` is caught at the `try/catch` boundary in
`runOrchestrator()`, which triggers `shutdown(0)` — destroys the panel,
calls `tmux.killSession(tmuxSessionName)`, and sets `process.exitCode`.

The SIGINT handler at [`executor.ts:1108-1109`](#code-references) calls
`shutdown(1)` directly — this is a backup for when Ctrl+C arrives as a
real OS signal (e.g., when OpenTUI is not capturing it), not when it's
caught by the React keyboard hook in window 0.

`createCliRenderer` is explicitly configured with `exitOnCtrlC: false`
at [`orchestrator-panel.tsx:69`](#code-references) so OpenTUI does not
auto-quit on Ctrl+C — the React handler has the first chance.

#### `q` and `Ctrl+C` inside an agent window (index 1+, or chat)

tmux passes keystrokes directly to the running CLI — Atomic's
`useKeyboard` handler is **not** active because OpenTUI isn't rendering
in those panes. No `bind -n C-c` entry exists in `tmux.conf`, so tmux
never intercepts Ctrl+C at the server layer.

The embedded CLIs handle Ctrl+C per their own logic:
- **Claude Code** — first Ctrl+C interrupts the current turn; double
  Ctrl+C (within ~1s) exits the CLI.
- **OpenCode** — first Ctrl+C interrupts; double Ctrl+C exits.
- **Copilot CLI** — first Ctrl+C interrupts; double Ctrl+C exits.

Once the CLI process exits, the pane (and window) dies. With default
tmux settings (no `remain-on-exit`), this also closes the window — so
double-Ctrl+C through the CLI is a current path for closing an agent
window.

#### No "paused state" exists today

There is **no** `paused` status in the codebase:
- `SessionStatus` at `src/sdk/components/orchestrator-panel-types.ts`
  is `"pending" | "running" | "complete" | "error"` — no `"paused"`.
- The conductor at `src/services/workflows/conductor/conductor.ts`
  aborts the current stage via `currentSession?.abort?.()` but
  does not set a conductor-level paused flag that holds the execution
  loop.
- Specs [`2026-03-25-workflow-interrupt-stage-advancement-fix.md`](#historical-context-from-research)
  and [`2026-03-25-workflow-interrupt-resume-session-preservation.md`](#historical-context-from-research)
  lay out a future paused-state model for the workflow conductor, but
  this is independent of the tmux-level window suppression problem.
- The acceptance criterion "Ctrl+C transitions to paused state (see
  #003)" therefore references future work — it is **not** a constraint
  that the current codebase can satisfy without additional changes in
  a separate spec/ticket.

### 6. Socket Isolation Guarantees Criterion 6 (Non-Agent Windows Unaffected)

The `-L atomic` socket flag causes tmux to run a **separate server
process** with its own socket (`/tmp/tmux-<uid>/atomic` on
Linux/macOS; named pipe on Windows via psmux). The two servers share
no state: bindings, hooks, config, and sessions are fully independent.

Any `bind`/`unbind`/`set-option` issued via `tmuxRun()` targets the
atomic server only. A user's personal tmux — running on its default
socket — is never contacted. This gives "non-agent tmux windows
unaffected" for free: the user's personal `prefix + &` behavior is
untouched.

The runtime check `isInsideAtomicSocket()` at
[`tmux.ts:124-131`](#code-references) parses the `TMUX` env var's socket
path segment to detect whether the current process is running inside
the atomic socket specifically (not just any tmux).

### 7. The Pattern Building Blocks Already Present in the Codebase

#### Pattern A — `if-shell -F` conditional keybinding

From [`tmux.conf:65`](#code-references) (copy-mode Escape behavior):

```tmux
bind-key -T copy-mode-vi Escape \
  if-shell -F "#{selection_present}" \
    "send-keys -X clear-selection" \
    "send-keys -X cancel"
```

`if-shell -F` evaluates a tmux format string **at binding invocation
time** — no shell is spawned, so the pattern is fast and cross-platform
(critical for psmux on Windows, where `run-shell` uses PowerShell).

#### Pattern B — `#{==:#{window_index},0}` format conditional

From [`tmux.ts:50-51`](#code-references) (attached-mode window-list
format):

```ts
export const TMUX_ATTACHED_WINDOW_FMT =
  "#{?#{==:#{window_index},0},, #W }";
```

Reads: "if window_index == 0 then empty else ` #W `". This same
comparison can be used inside `if-shell -F` to branch on whether the
current window is the orchestrator (index 0) or an agent window
(index ≥ 1).

#### Pattern C — `unbind` + `bind` override

From [`tmux.conf:71-73`](#code-references) (mouse copy-mode overrides):

```tmux
bind -T copy-mode-vi MouseDrag1Pane    select-pane \; send-keys -X begin-selection \; send-keys -X scroll-exit-off
bind -T copy-mode-vi MouseDragEnd1Pane send-keys -X copy-pipe-and-cancel
bind -T copy-mode-vi MouseDown1Pane    send-keys -X clear-selection \; select-pane
```

Same shape that an override of the `&`, `,`, etc. prefix bindings would
take — overriding a default binding in a specific table (`prefix` or
`root`/`-n`) without needing to `unbind` first (tmux `bind` replaces
any existing entry for the same key in the same table).

#### Pattern D — `display-message -d <ms>` for non-blocking toast

Not yet in the codebase. From
[`research/web/2026-04-15-tmux-keybind-suppression.md`](#historical-context-from-research):
`display-message -d <milliseconds>` renders a message in the tmux
status bar for N ms, returns immediately, and does not block pane
updates. Psmux supports this flag.

### 8. Composite Detection: "Is This an Agent Window?"

For workflow sessions: window_index > 0 ⇒ agent window; window_index
== 0 ⇒ orchestrator.

For chat sessions: the lone window is the agent. Its window_index on a
freshly-created session is typically 0 (tmux's default `base-index` is
0, and `tmux.conf` does not override it).

Format expressions that pick out "agent windows" exclusively:
- Combined (workflow OR chat): `#{||:#{!=:#{window_index},0},#{m/r:^atomic-chat-,#{session_name}}}`
  — true for any non-zero window index, OR for any window in an
  `atomic-chat-*` session.
- Alternative: because every window on the `-L atomic` socket is
  Atomic-managed, and window 0 of a workflow session is the only
  "orchestrator" on the server, a simpler guard suffices: "only allow
  close/rename when `window_name == session_name` in a chat session, OR
  when `window_index == 0` in a workflow session." In practice, a
  coarser guard — "suppress close/rename everywhere on the atomic
  socket except on the orchestrator" — matches the criterion and needs
  only `#{!=:#{window_index},0}` **plus** the chat-session prefix check.

Format variables confirmed to work in both tmux and psmux:
`#{window_index}`, `#{window_name}`, `#{session_name}`, `#{pane_in_mode}`,
`#{pane_mode}`, `#{selection_present}`, `#{==:a,b}`, `#{!=:a,b}`,
`#{||:a,b}`, `#{?cond,yes,no}`, `#{m/r:regex,string}`
(see [research/web/2026-04-15-tmux-keybind-suppression.md](#historical-context-from-research)
§4 for psmux confirmation).

### 9. Mouse-Menu Close Path (Not Yet Accounted For)

Right-clicking on the window status bar (`MouseDown3Status`) opens
`DEFAULT_WINDOW_MENU`, which includes a "Kill" entry that calls
`kill-window` *without* going through the `prefix + &` binding.
Similarly, `MouseDown3Pane` opens `DEFAULT_PANE_MENU` with a "Kill"
entry. To close this path, the menus themselves must be overridden:
either by binding `MouseDown3Status` / `MouseDown3Pane` to a custom
action, or by overriding the menu templates via tmux options
(see tmux man page: `display-panes-time`, `DEFAULT_*_MENU`). The
codebase does not currently customize these menus.

### 10. Window-Event Hooks Available

Tmux exposes named hooks that fire on window/session events. Confirmed
available hooks:
- `window-linked`, `window-unlinked`, `window-renamed`
- `session-renamed`, `session-created`, `session-closed`
- `client-resized`, `client-attached`, `client-detached`
- Auto-generated `after-<command>` hooks for every command (e.g.,
  `after-rename-window`, `after-kill-window`, `after-kill-session`)

Example (not present in code, from online research):
```tmux
set-hook -g after-rename-window \
  "run-shell 'tmux rename-window -t #{hook_pane} atomic-wf-foo'"
```

Hooks are a belt-and-suspenders option if the binding-level suppression
is insufficient — they can revert unwanted state changes after the fact.

## Code References

- `src/sdk/runtime/tmux.ts:19` — `SOCKET_NAME = "atomic"`
- `src/sdk/runtime/tmux.ts:22` — `CONFIG_PATH` bundled config resolution
- `src/sdk/runtime/tmux.ts:38-53` — Status-bar defaults and attached-mode
  format constants (`TMUX_ATTACHED_WINDOW_FMT` demonstrates the
  `#{==:#{window_index},0}` pattern)
- `src/sdk/runtime/tmux.ts:71-93` — `getMuxBinary()` — Windows
  (psmux → pmux → tmux fallback) vs Unix (tmux)
- `src/sdk/runtime/tmux.ts:113-131` — `isInsideTmux` / `isInsideAtomicSocket`
- `src/sdk/runtime/tmux.ts:138-153` — `tmuxRun()` central dispatcher; injects
  `-f CONFIG_PATH -L SOCKET_NAME` on every call
- `src/sdk/runtime/tmux.ts:204-230` — `createSession()` — note the
  `source-file` reload at line 228 that keeps bindings current for an
  already-running server
- `src/sdk/runtime/tmux.ts:242-262` — `createWindow()` — how agent
  windows are added to a workflow session
- `src/sdk/runtime/tmux.ts:407-413` — `killSession()`
- `src/sdk/runtime/tmux.ts:416-422` — `killWindow()` (programmatic; not
  the user-triggered path)
- `src/sdk/runtime/tmux.ts:454-492` — `parseSessionName()` — the
  `atomic-wf-*` / `atomic-chat-*` taxonomy
- `src/sdk/runtime/tmux.ts:545-578` — `buildAttachArgs` / `attachSession`
  / `spawnMuxAttach` — the attach path that respects `-f -L`
- `src/sdk/runtime/tmux.ts:600` — `display-message -p` used as a
  read-only query (the only current use of `display-message` in the code)
- `src/sdk/runtime/tmux.conf:13` — `allow-rename off` (blocks process
  auto-rename, not user-initiated rename)
- `src/sdk/runtime/tmux.conf:18` — `display-time 4000` (default duration;
  overridden by `display-message -d` when used)
- `src/sdk/runtime/tmux.conf:53-62` — SIGQUIT comment + prefix-free
  navigation (`C-g`, `C-\\`)
- `src/sdk/runtime/tmux.conf:65` — Canonical `if-shell -F` conditional
  keybinding pattern
- `src/sdk/runtime/tmux.conf:71-73` — Mouse copy-mode override pattern
- `src/sdk/runtime/executor.ts:1090-1104` — Session creation and
  `OrchestratorPanel.create`
- `src/sdk/runtime/executor.ts:1108-1109` — SIGINT handler
- `src/sdk/runtime/executor.ts:1172-1180` — `Promise.race` between
  workflow execution and user abort
- `src/sdk/runtime/executor.ts:1185-1191` — Catch-block cleanup that
  kills each active agent window via `tmux.killWindow`
- `src/commands/cli/chat/index.ts:200-240` — Chat session creation (one
  session = one agent window, no orchestrator)
- `src/sdk/components/session-graph-panel.tsx:216-310` — `useKeyboard`
  handler in orchestrator
- `src/sdk/components/session-graph-panel.tsx:241-244` — Ctrl+C / `q`
  route to `store.requestQuit()`
- `src/sdk/components/session-graph-panel.tsx:373-394` — 500 ms poll
  loop using `display-message -p "#{window_index} #{window_name}"` to
  detect active window
- `src/sdk/components/session-graph-panel.tsx:400-421` — tmux status-bar
  mode switching between graph and attached modes
- `src/sdk/components/orchestrator-panel.tsx:69` — `exitOnCtrlC: false`
  so React handles Ctrl+C first
- `src/sdk/components/orchestrator-panel-store.ts:159-165` —
  `requestQuit()` → `resolveAbort()` / `resolveExit()`
- `src/sdk/components/statusline.tsx` — React TUI statusline
  (orchestrator window only)

## Architecture Documentation

### Current keybinding landscape on the atomic socket

| Key(s)                 | Current binding (atomic socket)                  | Suppressible? |
|------------------------|--------------------------------------------------|---------------|
| `prefix + &`           | tmux default — `confirm-before kill-window`      | Yes (rebind in prefix table) |
| `prefix + x`           | tmux default — `confirm-before kill-pane`        | Yes |
| `prefix + ,`           | tmux default — `command-prompt rename-window`    | Yes |
| `prefix + $`           | tmux default — `command-prompt rename-session`   | Yes |
| `prefix + :`           | tmux default — `command-prompt` (arbitrary cmd)  | Yes (but blocks power users) |
| `prefix + d` / `D`     | tmux default — detach/choose detach              | Functional — not destructive |
| `MouseDown3Status`     | tmux default — opens window context menu (Kill)  | Yes (rebind in root table) |
| `MouseDown3Pane`       | tmux default — opens pane context menu (Kill)    | Yes |
| `C-g` (no prefix)      | Atomic — `select-window -t :0`                   | Already handled |
| `C-\\` (no prefix)     | Atomic — `next-window`                           | Already handled |
| `-` / `\|` (prefix)    | Atomic — split-window                            | OK |
| `h/j/k/l` (prefix)     | Atomic — resize-pane                             | OK |
| copy-mode bindings     | Atomic — custom vi + mouse                       | OK |

### The "agent window" boundary

```
┌──────────────────────────────────── tmux -L atomic ────────────────────────────────┐
│                                                                                     │
│  Workflow session: atomic-wf-claude-myflow-abc123                                   │
│    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                            │
│    │  Window 0    │  │  Window 1    │  │  Window 2    │                            │
│    │ orchestrator │  │ agent (node) │  │ agent (node) │                            │
│    │ OpenTUI      │  │ Claude Code  │  │ Copilot CLI  │                            │
│    │ React tree   │  │ embedded CLI │  │ embedded CLI │                            │
│    └──────────────┘  └──────────────┘  └──────────────┘                            │
│    ^                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^                             │
│    │                 criterion: close/rename suppressed on these windows            │
│    └─ close/rename allowed (criterion 5: `q` triggers clean exit)                   │
│                                                                                     │
│  Chat session: atomic-chat-opencode-def456                                          │
│    ┌──────────────┐                                                                 │
│    │  Window 0    │                                                                 │
│    │ agent (only) │                                                                 │
│    │ OpenCode CLI │                                                                 │
│    └──────────────┘                                                                 │
│    ^^^^^^^^^^^^^^^^                                                                 │
│    criterion: close/rename suppressed on this window                                │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘

Non-atomic tmux (user's personal server on default socket):
  ┌──────────────┐  ┌──────────────┐
  │   Window 0   │  │   Window 1   │       ← criterion: UNAFFECTED (different server)
  │  user shell  │  │  user shell  │
  └──────────────┘  └──────────────┘
```

### The exit / abort flow (current)

```
Window 0 (orchestrator)
  └── OpenTUI useKeyboard
        └── key = 'q' OR (ctrl + 'c')
              └── store.requestQuit()
                    ├── completionReached? → resolveExit() ─┐
                    └── else              → resolveAbort() ─┤
                                                             │
Window N (agent)                                             │
  └── tmux send-keys pass-through                            │
        └── CLI receives key directly                        │
              └── CLI handles Ctrl+C / exits on double ─────┤
                                                             ▼
                                               runOrchestrator() catch
                                                 └── shutdown(exitCode)
                                                       ├── panel.destroy()
                                                       ├── tmux.killSession(name)
                                                       └── process.exitCode = N
```

Criterion 4 (Ctrl+C → paused state) would add a new transition between
"key received in agent window" and "CLI exits the process" — but this
requires **tmux-level interception of Ctrl+C in agent windows**, which
does not exist today. That interception is out of scope for
criteria 1 & 2 (window close/rename) but intersects with them because
double-Ctrl+C currently exits the CLI, which in turn closes the window.

## Historical Context (from research/)

- [`research/web/2026-04-15-tmux-keybind-suppression.md`](../web/2026-04-15-tmux-keybind-suppression.md)
  — Authoritative dump of default tmux bindings for kill/rename/menu,
  `if-shell -F` conditional patterns, `display-message -d`
  non-blocking semantics, and psmux compatibility notes. Companion to
  this document; fetched from tmux/tmux master and psmux docs on
  2026-04-15.
- [`research/docs/2026-04-10-tmux-ux-implementation-guide.md`](./2026-04-10-tmux-ux-implementation-guide.md)
  — How `tmuxRun()`, `-f`, and `-L atomic` were implemented. Confirms
  the config-injection architecture used as the basis for any binding
  overrides.
- [`research/web/2026-04-10-tmux-ux-improvements.md`](../web/2026-04-10-tmux-ux-improvements.md)
  — Original proposal doc for the atomic socket + bundled config.
  Scope explicitly excludes Ctrl+C/`q` interception ("Atomic's session
  lifecycle is fully managed — Ctrl+C and `q` work, sessions
  auto-cleanup on completion"). The new criteria extend beyond that
  MVP scope.
- [`research/web/2026-04-10-tmux-ux-for-embedded-cli-tools.md`](../web/2026-04-10-tmux-ux-for-embedded-cli-tools.md)
  — OSS prior art (Overmind, Zellij, tmate). Zellij's "locked mode"
  (Ctrl+g passes all keystrokes to the terminal) is a conceptual
  analog for suppression, though Zellij is a separate multiplexer, not
  a tmux config.
- [`research/web/2026-04-11-tmux-copy-mode-ux-scroll-exit.md`](../web/2026-04-11-tmux-copy-mode-ux-scroll-exit.md)
  — `pane-mode-changed` hook, `#{selection_present}` format variable,
  and other tmux format/hook infrastructure referenced in §9, §10.
- [`research/web/2026-04-10-psmux-tmux-compatibility.md`](../web/2026-04-10-psmux-tmux-compatibility.md)
  — psmux ↔ tmux feature parity — referenced for confirming
  `if-shell -F` / `display-message -d` / `set-hook` support on
  Windows.
- [`specs/2026-03-25-workflow-interrupt-stage-advancement-fix.md`](../../specs/2026-03-25-workflow-interrupt-stage-advancement-fix.md)
  and
  [`specs/2026-03-25-workflow-interrupt-resume-session-preservation.md`](../../specs/2026-03-25-workflow-interrupt-resume-session-preservation.md)
  — Planned paused-state model for the workflow conductor. Likely the
  referent of "#003" in the acceptance criteria, or a sibling
  ticket.
- [`research/docs/2026-03-25-workflow-interrupt-resume-bugs.md`](./2026-03-25-workflow-interrupt-resume-bugs.md)
  — Research backing the conductor paused-state work.

## Related Research

- [`research/docs/2026-04-10-tmux-ux-implementation-guide.md`](./2026-04-10-tmux-ux-implementation-guide.md)
- [`research/web/2026-04-15-tmux-keybind-suppression.md`](../web/2026-04-15-tmux-keybind-suppression.md)
- [`research/web/2026-04-10-tmux-ux-improvements.md`](../web/2026-04-10-tmux-ux-improvements.md)
- [`research/web/2026-04-11-tmux-copy-mode-ux-scroll-exit.md`](../web/2026-04-11-tmux-copy-mode-ux-scroll-exit.md)

## Open Questions

1. **Scope of Ctrl+C interception inside agent windows.** The
   acceptance criteria say "users must not be able to … exit out of
   the Copilot CLI, Claude Code, or OpenCode CLI" and "double Ctrl+C
   not permitted." Suppressing `prefix + &` and `prefix + ,` alone
   does not stop double-Ctrl+C from exiting the CLI, which in turn
   closes the window. Does this spec own Ctrl+C interception via
   `bind -n C-c`, or is that delegated to the "#003 paused state"
   ticket? The interception options are:
   - `bind -n C-c` in the tmux config — intercepts at tmux layer
     before the CLI sees it; conditional on window type.
   - Detection at the executor level (e.g., listen for SIGCHLD on the
     pane and auto-restart the CLI if it exits during an active
     workflow).

2. **Mouse-menu close coverage.** Criteria 1 & 2 say "keybind" —
   technically the right-click context menu "Kill" entries are menu
   items, not keybindings. Should mouse menus also be suppressed, or
   is the scope limited to keyboard bindings?

3. **`prefix + :` command-prompt.** The arbitrary command prompt lets
   a user type `kill-window`, `rename-window`, `kill-session`, etc.
   directly, bypassing `&` and `,` overrides. Does the spec require
   closing this escape hatch (e.g., by unbinding `prefix + :` or
   overriding `command-prompt` to reject certain commands)? Power
   users familiar with tmux may need `:` for debugging.

4. **Workflow session window 0 behavior.** Criterion 5 (`q` triggers
   clean exit flow) is already satisfied in window 0. But should
   `prefix + &` on window 0 also trigger the clean exit flow (instead
   of killing just the orchestrator window), or should window 0
   simply keep the default tmux behavior? Killing only window 0 via
   `&` would strand agent windows — the session would stay alive
   without its orchestrator, likely creating a zombie state.

5. **Chat session semantics.** Chat sessions have no orchestrator
   window and no OpenTUI-rendered controls — the user is dropped
   directly into the agent CLI. Is "q triggers clean exit flow"
   applicable to chat sessions? Today `q` inside a chat window goes
   straight to the agent CLI. Would the spec route `q` to a clean
   exit (e.g., via `bind -n q` with window-prefix condition), or is
   `q` out of scope for chat?

6. **Does the user's personal tmux server need extra protection?** The
   `-L atomic` boundary means bindings set on the atomic server don't
   affect the user's personal tmux. But if a user happens to `tmux
   -L atomic attach` manually outside Atomic, they'd be bound by the
   same restrictions — is that desired? (Most likely yes, since
   manual atomic-socket attach is also "inside an agent session.")

7. **Restoring bindings after the session ends.** The atomic server
   persists until its last session ends. If a future change to
   `tmux.conf` modifies `&` or `,`, the `source-file` reload at
   [`tmux.ts:228`](#code-references) propagates the change to an
   already-running server — but only on subsequent `createSession`
   calls. A user attached to an already-running atomic server between
   updates would see stale bindings until the next session starts.
   This is an existing property of the config-reload mechanism and
   does not need new handling, but is worth noting.

8. **Interaction with `allow-rename off`.** The current config already
   has `allow-rename off`, which blocks one vector (programmatic
   renames by the running process). Adding a user-facing suppression
   for `prefix + ,` completes the picture. Should the spec also
   cover `set-titles on/off` and terminal-emulator-level title
   changes?

---

## Follow-up Research [2026-04-15 05:50 UTC] — Paused State for Interrupted Stages

### Follow-up Objective

> Implement paused state for cancelled/interrupted workflow stages.
> When a stage is interrupted (Ctrl+C), the orchestrator should
> transition to a paused state (checkpointing) rather than hard
> cancellation.
>
> Acceptance criteria:
> - SDK integrations map native idle/cancellation events to orchestrator paused state
> - On paused: stage timer stops and TUI animations halt
> - Session state is checkpointed for resumption
> - paused is visually distinct from running/cancelled/completed in TUI
> - Resuming from paused restarts timer and animations from prior state
>
> Note: each SDK has its own idle/cancellation event — map at the SDK layer.

This is very likely the "#003" ticket referenced in the primary research
topic's acceptance criterion 4 ("Ctrl+C transitions to paused state (see
#003)"). The two objectives are complementary: the tmux-level
suppression prevents window close/rename, while the paused-state
handling gives Ctrl+C in an agent window a graceful, resumable
destination.

### FF.1 — SDK Idle and Cancellation Event Map

Each SDK signals completion differently. No SDK has a native "paused"
or "interrupted" event type; mapping must happen at the Atomic adapter
layer.

#### GitHub Copilot SDK

- **Idle event**: `session.idle` — a named event on the `CopilotSession`
  event emitter (zero-argument handler). Documented at
  `docs/copilot-cli/sdk.md:46-50`.
- **Cancellation**: `session.abort(): Promise<void>` method on
  `CopilotSession` (`docs/copilot-cli/sdk.md:275-277`). When abort is
  called, the session emits `session.error` (**not** a dedicated
  "aborted" event).
- **Error event**: `session.error` with payload
  `{ data: { message?: string } }` — caught alongside `session.idle` in
  `src/sdk/runtime/executor.ts:928-936`.
- **Native "interrupted" state**: none. Event schema
  (`docs/copilot-cli/sdk.md:311-321`) lists `user.message`,
  `assistant.message`, `assistant.message_delta`,
  `tool.execution_start`, `tool.execution_complete`, `command.execute`,
  `commands.changed`, `session.compaction_start`,
  `session.compaction_complete`. No `session.interrupted` or
  `session.paused`.
- **Current wiring**: `executor.ts:916-941` wraps native `send()` in a
  `Promise` that resolves on `session.idle` and rejects on
  `session.error`. `session.abort()` is **not** called anywhere in the
  runtime today.

#### Claude Agent SDK

Claude has two code paths in Atomic: the headless path (pure SDK) and
the interactive/tmux path (pane-capture-based).

- **Headless idle**: no dedicated idle event. The async generator
  returned by `query()` yields a `ResultMessage` with `subtype` ∈
  `"success" | "error_max_turns" | "error_max_budget_usd" |
  "error_during_execution" | "error_max_structured_output_retries"`
  (`docs/claude-code/agent-sdk/agent-loop.md:270-280`). Consumed at
  `src/sdk/providers/claude.ts:627-633` in
  `HeadlessClaudeSessionWrapper.query()`.
- **Interactive/tmux idle**: no SDK-level event. Detected by polling
  the tmux pane via `paneLooksReady()` + `!paneHasActiveTask()` in a
  loop at `src/sdk/providers/claude.ts:265-302` (`waitForIdle()`). The
  polling interval defaults to 2000 ms. The executor also sets
  `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` at `executor.ts:84-87`,
  which writes `session_state_changed` events to the JSONL
  transcript, but the current runtime uses pane-capture polling as
  the authoritative idle signal.
- **Cancellation**:
  - Headless path — `Options.abortController`/`signal` passable via
    `sdkOpts` at `src/sdk/providers/claude.ts:622-626`, but the
    runtime does not currently wire one.
  - Interactive/tmux path — no abort call; the tmux pane is simply
    killed via `tmux.killWindow()` at `executor.ts:1185-1190`.
- **Native "interrupted" state**: the `ResultMessage.subtype` value
  `"error_during_execution"` is the closest analog — fires on API
  failures or cancelled requests (agent-loop.md:277). No explicit
  `"interrupted"` or `"paused"` subtype.

#### OpenCode SDK

- **Idle event**: none. `client.session.prompt()` is a synchronous
  HTTP RPC that blocks until `SessionPromptResponse` is returned
  (`docs/opencode/sdk.md:312`). Completion is implied by the method
  returning.
- **Event stream**: `event.subscribe()` SSE stream exists
  (`docs/opencode/sdk.md:447-458`) but is not consumed by the current
  Atomic runtime in any wired path.
- **Cancellation**: `client.session.abort({ path: { id } }):
  Promise<boolean>` — REST call (`docs/opencode/sdk.md:307`). Exists
  in the SDK but is **not called** anywhere in `src/sdk/providers/opencode.ts`
  or `src/sdk/runtime/executor.ts`.
- **Native "interrupted" state**: none documented. The `info` field
  on `SessionPromptResponse` carries an optional `error` field only
  typed for `StructuredOutputError`.

### FF.2 — Why the Mapping Is Non-Trivial

| SDK                | Idle signal kind        | Cancellation kind       | Currently wired for abort? |
|--------------------|-------------------------|-------------------------|----------------------------|
| Copilot            | Event emitter           | Async method + error    | No (abort exists, unused)  |
| Claude (headless)  | Async-generator yield   | AbortController         | No (signal passable, unused)|
| Claude (tmux)      | Polling (pane-capture)  | tmux kill-window        | Indirect (pane kill)       |
| OpenCode           | Synchronous return      | Async REST method       | No (abort exists, unused)  |

Three of four code paths have a usable cancellation primitive exposed
by the underlying SDK but none are currently invoked by Atomic. The
existing abort mechanism is "kill the tmux session," which is
indiscriminate and unresumable. A paused-state implementation would
need per-SDK abort wiring in addition to the shared tmux-level teardown
to produce checkpointable state.

### FF.3 — `SessionStatus` Enum and Visual State Today

`src/sdk/components/orchestrator-panel-types.ts:3` — the current
`SessionStatus` type:

```ts
type SessionStatus = "pending" | "running" | "complete" | "error";
```

There is **no** `"paused"`, `"interrupted"`, or `"cancelled"` value.
Adding one requires a coordinated change across:

- `orchestrator-panel-types.ts` — add the literal to the union
- `src/sdk/components/status-helpers.ts:5-25` — add
  `statusColor/Label/Icon` mappings for the new value
- `src/sdk/components/node-card.tsx:21-39` — decide what the node
  border/background renders for paused (see §FF.5)
- `src/sdk/components/orchestrator-panel-store.ts` — add a new
  transition method (e.g. `pauseSession`, `resumeSession`)

#### Current per-status visual distinctions

From `src/sdk/components/status-helpers.ts:5-25`:

| Status    | Color            | Label     | Icon |
|-----------|------------------|-----------|------|
| `running` | `theme.warning`  | "running" | `●`  |
| `complete`| `theme.success`  | "done"    | `✓`  |
| `pending` | `theme.textDim`  | "waiting" | `○`  |
| `error`   | `theme.error`    | "failed"  | `✗`  |
| (other)   | `theme.textDim`  | raw       | `○`  |

From `src/sdk/components/node-card.tsx:21-39`:

- **running, unfocused**: sine-wave pulse between `theme.border` and
  `theme.warning` driven by `pulsePhase` (`t = (sin((pulsePhase / 32)
  * π * 2 − π/2) + 1) / 2`)
- **running, focused**: fixed 20% lerp between `theme.warning` and
  `#ffffff` — does not pulse
- **pending, focused**: uses the status color (`theme.textDim`)
- **pending, unfocused**: `theme.borderActive`
- **complete / error**: solid border in the raw status color
- Focused nodes get a faint background tint: `lerpColor(theme.background,
  sc, 0.12)`. Unfocused nodes are fully transparent.
- `statusIcon()` values are NOT currently rendered in `node-card.tsx`
  — the node shows the name in the border title and the duration
  string in a centered `<text>` element.

### FF.4 — How Stage Timers and Animations Are Currently Gated

From `src/sdk/components/session-graph-panel.tsx:48-117` and
`src/sdk/components/node-card.tsx:43-46`:

- **Pulse frame rate**: `PULSE_INTERVAL_MS = 60` (~16.7 fps),
  `PULSE_FRAME_COUNT = 32` frames per cycle (~1920 ms cycle).
- **Pulse gating**: the `setInterval` is only registered when
  `hasRunning === true`, where `hasRunning` is a `useMemo` checking
  `store.sessions.some((s) => s.status === "running")`. If no session
  is `"running"`, the interval is not created and `pulsePhase` stops
  advancing.
- **Timer computation**: `node-card.tsx:43-46` computes
  `fmtDuration((node.endedAt ?? Date.now()) - node.startedAt)` at
  render time. `fmtDuration` at `status-helpers.ts:29-32` formats ms
  as `"Xm YYs"`.
- **Timer/animation coupling** (documented at
  `session-graph-panel.tsx:107-109`): the 60 ms pulse interval doubles
  as the live-timer refresh trigger. Because the duration is recomputed
  at render time via `Date.now()` and re-renders are triggered by
  `setPulsePhase`, clearing the interval implicitly freezes the
  displayed timer (it stops re-rendering).
- **Freezing on complete/error**: the `endedAt` field is populated by
  `completeSession`/`failSession` at
  `orchestrator-panel-store.ts:76-90` with `Date.now()`. Once set, the
  `endedAt ?? Date.now()` expression resolves to the frozen value, so
  the displayed elapsed time becomes stable even if the pulse
  interval is still running for other sessions.

#### Implications for paused state

The timer-halt and animation-halt requirements (acceptance criteria
2) can be satisfied via one of two approaches using existing
primitives:

- **Option A — Snapshot `pausedAt` on transition.** Add a
  `pausedAt: number | null` field to `SessionData`. In
  `node-card.tsx`, change the duration expression to
  `(node.endedAt ?? node.pausedAt ?? Date.now()) - node.startedAt`.
  When `pausedAt` is non-null, the displayed elapsed time freezes at
  the moment of pause. This is a minimal delta.
- **Option B — Set `endedAt` on pause, restore on resume.** Re-use
  the existing `endedAt` field. On resume, clear `endedAt` and shift
  `startedAt` forward by `Date.now() - (paused.endedAt)` so the
  displayed elapsed time continues from where it paused. This has
  fewer type changes but conflates "done" and "paused" fields
  semantically.

For animation halting: because `hasRunning` keys off
`status === "running"`, simply flipping the paused session's status
to `"paused"` automatically removes it from `hasRunning`. If every
running session transitions to paused, the `setInterval` clears on
its own — no explicit animation-stop code is needed. However,
`pulsePhase` state persists across the effect unmount (React state),
so when resumed, the pulse resumes from its last `pulsePhase` value —
satisfying acceptance criterion 5 ("restarts … animations from prior
state"). No explicit "snapshot pulsePhase" logic is required.

### FF.5 — Session Checkpointing Primitives

There is **no** resume/checkpoint runtime in the codebase today. Active
machinery:

- **`s.save(s.sessionId)`** — the workflow-facing API demonstrated in
  `src/sdk/workflows/builtin/deep-research-codebase/claude/index.ts:161`
  and elsewhere. Documented purpose: persist the agent's session ID to
  enable resume.
- **`wrapMessages()`** at `src/sdk/runtime/executor.ts:817-870` —
  called via `save`. For Claude workflows, it invokes
  `listSessions({ dir: process.cwd() })` and `getSessionMessages(
  candidate.sessionId, { dir })` from `@anthropic-ai/claude-agent-sdk`
  to fetch the message history, then serializes it to `messages.json`
  and renders it as plain text to `inbox.md` within the session
  directory.
- **Session directory layout**: `~/.atomic/sessions/<workflowRunId>/
  <sessionName>-<sessionId>/` containing per-session
  `metadata.json` (name, description, agent, paneId, serverUrl, port,
  startedAt — written at stage start at `executor.ts:964-979`),
  `messages.json` (from `save`), and `inbox.md` (rendered from
  messages).
- **Top-level metadata**: `metadata.json` at `sessionsBaseDir` written
  at `executor.ts:1143-1156` with `workflowName`, `agent`, `prompt`,
  `projectRoot`, `startedAt`.
- **In-memory-only registries**: `activeRegistry` and
  `completedRegistry` at `src/sdk/runtime/executor.ts:1118-1120` are
  `Map` instances that exist only for the lifetime of the
  `runOrchestrator()` process. There is no serialization, no
  mid-flight checkpoint write, and no reload mechanism.

There is no `resume`, `checkpoint`, or `persisted` identifier in
`src/sdk/runtime/executor.ts`. The existing `save()` machinery can be
a foundation for checkpointing — it already captures agent-side
session IDs and message history, which is the minimum needed to
re-enter a provider session. What's missing is:

1. A mechanism to trigger `save()` at the moment of pause (currently
   only user-code triggers it).
2. A runtime-layer record of "which stage was paused and at what
   graph position," so a future resume knows where to re-enter.
3. A reload path that reads the persisted state and reconstructs the
   in-memory registries.

### FF.6 — Prior Spec Work on This Topic

Two existing specs address the conductor-layer paused state but
stop short of the orchestrator-panel layer:

- `specs/2026-03-25-workflow-interrupt-stage-advancement-fix.md` —
  proposes adding `"interrupted"` as a fourth value to
  `StageOutputStatus` (in `src/services/workflows/conductor/types.ts`)
  and to the `workflow.step.complete` event bus schema (in
  `schemas.ts`). **It does not** modify the `SessionStatus` union in
  `orchestrator-panel-types.ts` — the conductor-level and panel-level
  state types are separate.
- `specs/2026-03-25-workflow-interrupt-resume-session-preservation.md`
  — follow-up that introduces `preservedSession: Session | null` and
  `isResuming: boolean` internal to `WorkflowSessionConductor`. Session
  preservation is entirely within the conductor layer; no
  orchestrator-panel type changes are proposed.

**Gap**: neither spec makes the panel visually reflect a "paused"
state. The follow-up objective in this research closes that gap.

### FF.7 — Current Abort Plumbing (`runOrchestrator` Path)

From `src/sdk/runtime/executor.ts:1090-1193`:

```
runOrchestrator()
  ├── panel = OrchestratorPanel.create({ tmuxSession })
  ├── process.on("SIGINT", () => shutdown(1))           // backup for OS-level Ctrl+C
  ├── const abortPromise = panel.waitForAbort()
  │                          .then(() => { throw WorkflowAbortError })
  ├── await Promise.race([
  │     definition.run(workflowCtx),                    // user workflow
  │     abortPromise                                    // TUI abort (q / Ctrl+C)
  │   ])
  ├── catch WorkflowAbortError
  │     └── for each active session: tmux.killWindow()  // indiscriminate
  └── shutdown(exitCode) → panel.destroy(), tmux.killSession(), exit
```

The only cancellation mechanism invoked is `tmux.killWindow()` /
`tmux.killSession()`. No SDK-level `session.abort()` is called. This
is the "hard cancellation" the follow-up objective seeks to replace
with paused state + checkpoint.

### FF.8 — Session Status Transition Call Graph (Today)

From `src/sdk/components/orchestrator-panel-store.ts`:

| Method             | Sets status to | Side effects                                                  | Called from                                  |
|--------------------|----------------|---------------------------------------------------------------|----------------------------------------------|
| `setWorkflowInfo`  | `pending` (all non-orchestrator nodes) / `running` (orchestrator) | Initializes `sessions` array                  | `executor.ts:1159`                            |
| `startSession`     | `running`      | Sets `startedAt = Date.now()`                                 | NOT currently called by the executor          |
| `addSession`       | `running` (as constructed by caller) | Appends to `sessions`                                          | `orchestrator-panel.tsx:115-123` ← `executor.ts:792` |
| `completeSession`  | `complete`     | Sets `endedAt = Date.now()`                                   | via `panel.sessionSuccess(name)` at `executor.ts:1008` |
| `failSession`      | `error`        | Sets `endedAt = Date.now()`, stores `error` string            | via `panel.sessionError(name, msg)` at `executor.ts:992, 1025` |
| `setCompletion`    | `complete` (orchestrator only) | Sets `completionInfo`, `endedAt = Date.now()` on orchestrator | `executor.ts:1178`                            |

**Observation**: the `pending → running` transition via `startSession`
is dead code for dynamically-spawned sessions — `addSession` creates
them directly in `"running"` state. The `pending` state only applies
to the workflow graph's pre-declared (static) sessions from
`setWorkflowInfo`.

### FF.9 — Additional Code References (Follow-up)

- `src/sdk/components/orchestrator-panel-types.ts:3` — `SessionStatus`
  union (no paused value today)
- `src/sdk/components/status-helpers.ts:5-32` — `statusColor`,
  `statusLabel`, `statusIcon`, `fmtDuration`
- `src/sdk/components/node-card.tsx:21-46` — status-driven rendering
  and duration computation
- `src/sdk/components/session-graph-panel.tsx:48-117` — pulse
  animation driver and `hasRunning` gate (lines 101-117)
- `src/sdk/components/orchestrator-panel-store.ts:68-106` — session
  lifecycle transitions
- `src/sdk/components/orchestrator-panel.tsx:100, 115-123` —
  `sessionStart` (unused) vs. `addSession` (used)
- `src/sdk/runtime/executor.ts:916-941` — Copilot `send()` wrapper
  (idle/error promise shim)
- `src/sdk/runtime/executor.ts:817-870` — `wrapMessages` for
  save/persist
- `src/sdk/runtime/executor.ts:964-979` — per-session
  `metadata.json` write at stage start
- `src/sdk/runtime/executor.ts:1118-1120` — `activeRegistry` /
  `completedRegistry` in-memory maps
- `src/sdk/runtime/executor.ts:1185-1190` — the catch-block cleanup
  (`tmux.killWindow` loop)
- `src/sdk/providers/claude.ts:185-302` —
  `HeadlessClaudeSessionWrapper` + `waitForIdle` polling loop
- `src/sdk/providers/claude.ts:622-633` — headless `query()`
  consumption of the `ResultMessage` subtype
- `docs/claude-code/agent-sdk/agent-loop.md:270-280` — Claude
  `ResultMessage.subtype` values
- `docs/opencode/sdk.md:307, 312, 447-458` — OpenCode `session.abort`,
  `session.prompt`, `event.subscribe`
- `docs/copilot-cli/sdk.md:46-50, 275-277, 311-321` — Copilot
  `session.idle`, `session.abort`, event schema
- `specs/2026-03-25-workflow-interrupt-stage-advancement-fix.md` —
  conductor-layer `"interrupted"` proposal
- `specs/2026-03-25-workflow-interrupt-resume-session-preservation.md`
  — conductor-layer session preservation proposal

### FF.10 — Follow-up Open Questions

1. **Conductor vs. panel status semantics.** The existing specs
   propose `"interrupted"` at the conductor layer (`StageOutputStatus`
   + bus schema). This follow-up objective calls for `"paused"` at
   the orchestrator-panel layer (`SessionStatus`). Are these the
   same concept under different names, or two distinct states that
   both need modeling (e.g., "the conductor observed an interrupt"
   vs. "the UI is displaying a paused node")?
2. **Which SDK exception(s) map to paused?** For each SDK, multiple
   termination paths exist:
   - Copilot: `session.error` fires on both user-abort and real
     errors.
   - Claude headless: `ResultMessage.subtype` has five distinct
     termination subtypes.
   - OpenCode: `session.prompt()` rejection vs. `session.abort()`
     resolution.
   Does the spec need to distinguish "user-initiated interrupt"
   (→ paused) from "underlying error" (→ error)? If so, a user-abort
   flag must propagate from the interrupt handler down into the SDK
   adapter so it can classify the event correctly.
3. **Resume semantics for partially-completed stages.** When a stage
   pauses mid-stream, the agent may have emitted partial output
   (tool calls, assistant messages). Does resume replay the partial
   output to reconstruct the UI, or only pick up from the last
   acknowledged message? Claude's `messages.json` captures up to the
   last event persisted by the SDK; OpenCode has no equivalent until
   `session.prompt()` returns.
4. **Headless vs. tmux path parity.** Claude Code has both a
   headless SDK path and an interactive tmux path. The headless path
   can use `AbortController.abort()` cleanly; the tmux path currently
   relies on pane capture + killing the window. Does the paused
   state need to work equivalently on both paths, or is pausing only
   meaningful for the headless (programmatic) path?
5. **What does "resume" mean for a pane-capture session?** When a
   workflow stage runs via tmux pane automation (Claude interactive
   path), pausing would need to freeze the pane and leave the agent
   alive. The pane survives as long as the tmux window survives —
   which directly ties back to criteria 1 & 2 of the primary topic
   (suppress window close). A user who closes the agent window
   destroys the resume target. This is the concrete link between
   the two objectives: window-close suppression is a **prerequisite**
   for pane-capture-based resume to work.
6. **Idempotency of `session.abort`.** Copilot and OpenCode both
   expose async abort methods. What happens if abort is called while
   the session is already idle? Does it no-op, throw, or put the
   session into an unrecoverable state? The local docs don't
   document this; spec work may need empirical validation.
7. **Visual treatment for paused.** Status color palette
   (`graph-theme.ts`) currently has `warning` (running), `success`
   (complete), `error` (failed), `textDim` (pending). A new paused
   color needs a distinct channel — e.g., a dimmed/desaturated
   `warning` (indicating "was running, now not") or an entirely new
   theme token. Icon convention currently unused in `node-card.tsx`;
   adding a paused icon would be the first use of `statusIcon` in
   the actual card render.
8. **Interaction with `hasRunning` when sessions mix states.** If
   one session is paused and another is still running, the pulse
   interval keeps running for the latter. The paused session's
   duration must be independently frozen (via the `pausedAt`
   snapshot or `endedAt` trick in §FF.4). This is a per-node
   concern, not a global-animation concern.
9. **Propagation through the event bus.** The event bus schema at
   `src/services/workflows/event-bus/schemas.ts` emits
   `workflow.step.complete` with status; if this schema is updated
   to carry `"interrupted"` or `"paused"`, consumers (telemetry,
   transcript writers, UI event listeners) all need to acknowledge
   the new value — especially for telemetry, which currently maps
   status to histogram buckets.

---

## Follow-up Research [2026-04-15 06:30 UTC] — Deep Dive into Local SDK Docs

The previous follow-up section (FF.1-FF.10) summarized SDK idle/abort
behavior based on the code wiring in `src/sdk/providers/` and
`src/sdk/runtime/executor.ts`. This second pass reads the SDK
**documentation** in `docs/` in full, extracting the authoritative API
surface for each SDK — specifically the primitives that enable (or
don't enable) a clean "paused + resume" model. Sources cited by file
path and section heading rather than line number because the docs are
prose.

### FF'.1 — Claude Agent SDK (`docs/claude-code/agent-sdk/`)

#### Idle signal

The canonical completion signal is the `SDKResultMessage` yielded as
the **last** item from the `query()` async generator
(`agent-loop.md`, "Handle the result"). Shape (from
`sdk-references/typescript.md`, `SDKResultMessage`):

```ts
type SDKResultMessage =
  | { type: "result"; subtype: "success";
      result: string; session_id: string; total_cost_usd: number;
      usage: NonNullableUsage; stop_reason: string | null;
      num_turns: number; /* ... */ }
  | { type: "result";
      subtype: "error_max_turns" | "error_during_execution"
             | "error_max_budget_usd"
             | "error_max_structured_output_retries";
      errors: string[]; session_id: string; /* ... */ };
```

`stop_reason` includes `"end_turn"`, `"max_tokens"`, `"refusal"`.
`session_id` is present on every variant — the adapter can always
capture it for later resume.

#### Abort primitives

Three distinct primitives (`sdk-references/typescript.md`,
"Options" / "Query" object):

1. `options.abortController: AbortController` — passed into `query()`;
   calling `abortController.abort()` halts the loop.
2. `query.interrupt(): Promise<void>` — **streaming input mode only**
   (`streaming-vs-single-mode.md`). Documented as interrupting the
   current turn cleanly.
3. `query.close(): void` — "forcefully ends the query and cleans up
   all resources."

On abort mid-stream, the loop **still yields** a final `ResultMessage`
with `subtype: "error_during_execution"` (`agent-loop.md`, "Handle the
result" table: *"An error interrupted the loop (for example, an API
failure or cancelled request)"*). That subtype is **ambiguous** — it
covers user-initiated interrupts and real errors with no finer
distinction. The Atomic adapter must track whether abort was
orchestrator-initiated to classify as paused vs. error.

Partial `input_json_delta` events that were already yielded before
abort are **not retracted**. No `AssistantMessage` is emitted for an
incomplete turn.

Also notable: `PermissionResult` has an `interrupt?: boolean` flag on
the `{ behavior: "deny" }` variant
(`sdk-references/typescript.md`) — a hook can deny a tool use and
simultaneously interrupt the running turn. This is a supported (if
unusual) second pathway into the `error_during_execution` state.

#### Session persistence and resume

Two **independent** persistence mechanisms, both first-party:

**A. Conversation session persistence** (`core-concepts/sessions.md`):
- Automatic write to `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`
- JSONL format, one message per line, covering prompts, tool calls,
  tool results, assistant responses
- Resume via `options.resume: sessionId`. TS also supports
  `options.continue: true` (auto-resume most recent session in cwd).
- Fork via `options.forkSession: true` with `resume` — creates new
  session branching from that point; original untouched.
- `options.persistSession: false` disables disk persistence (TS only;
  Python always persists).
- `options.resumeSessionAt: string` resumes at a specific message UUID.

**B. File checkpointing** (`guides/file-checkpointing.md`):
- Tracks file modifications made by `Write`, `Edit`, `NotebookEdit`
  tools only (not `Bash`).
- Enabled via `enableFileCheckpointing: true` and
  `extraArgs: { "replay-user-messages": null }`.
- Checkpoint identifier = `UserMessage.uuid` from the stream.
- Rewind API: `query.rewindFiles(checkpointId)` (TS) or
  `client.rewind_files(checkpoint_id)` (Python).
- Rewind does **not** revert conversation history — only files on
  disk. This separation is explicit: "File checkpointing tracks file
  modifications … only."

This split is architecturally important for a paused-state spec.
Conversation resume can happen without touching the filesystem;
filesystem rollback requires a separate opt-in. The Atomic adapter
will need to decide whether pause implies any file-level rollback or
just conversation-level resume.

#### Hooks (`sdk-references/typescript.md`, `HookEvent`)

```ts
type HookEvent =
  | "PreToolUse" | "PostToolUse" | "PostToolUseFailure"
  | "Notification" | "UserPromptSubmit"
  | "SessionStart" | "SessionEnd"    // TypeScript SDK only
  | "Stop"
  | "SubagentStart" | "SubagentStop"
  | "PreCompact"
  | "PermissionRequest"
  | "Setup" | "TeammateIdle" | "TaskCompleted"
  | "ConfigChange" | "WorktreeCreate" | "WorktreeRemove";
```

Relevant for pause/interrupt:
- `"Stop"` — fires when agent execution stops; `hooks.md` calls out
  "Validate the result, save session state" as a use case.
- `"SessionEnd"` (TS only) — fires on session termination.
- `"Notification"` subtypes include `idle_prompt`.
- No `beforeAbort` or `onSessionPause` hook exists. Best proxy:
  `"Stop"` + inspect `ResultMessage.subtype`.

Hook callbacks receive `options: { signal: AbortSignal }` as third
argument — the signal is triggered if the hook itself times out (not
if the parent session is aborted).

#### Streaming vs. single mode (`guides/streaming-vs-single-mode.md`)

- **Streaming input mode** (`prompt: AsyncIterable<SDKUserMessage>`):
  supports image uploads, queued messages, mid-loop `interrupt()`,
  hooks, multi-turn without process restart. Required for clean
  pause-with-resume semantics.
- **Single message mode** (`prompt: string`): cannot be interrupted
  mid-turn. The only way to stop is full abort via `AbortController`.

`includePartialMessages: true` yields `SDKPartialAssistantMessage`
(`type: "stream_event"`) events, including `input_json_delta` tool
call streams. Extended thinking
(`maxThinkingTokens` / `thinking`) disables `StreamEvent` emission.

#### Pause/resume mapping for Claude

Claude Agent SDK has the **cleanest** path to the paused-state model
among the three SDKs:

```
User presses Ctrl+C in agent window
  ↓
Adapter sets `wasUserAborted = true` on the session
  ↓
Adapter calls query.interrupt()   [streaming mode]
           OR abortController.abort()  [single mode]
  ↓
Generator yields ResultMessage{ subtype: "error_during_execution",
                                session_id: "<uuid>" }
  ↓
Adapter reads session_id; checks wasUserAborted
  ├── true  → emit { panel.status = "paused", sessionId }
  └── false → emit { panel.status = "error" }
  ↓
[later] User requests resume
  ↓
Adapter re-invokes query({ options: { resume: sessionId, … } })
  ↓
Full conversation context restored from JSONL; new prompt processes
normally, yielding another ResultMessage on completion.
```

Gap to bridge: the `wasUserAborted` intent tracking — the SDK's
`"error_during_execution"` subtype doesn't carry that distinction
natively.

### FF'.2 — OpenCode SDK (`docs/opencode/sdk.md`, `docs/opencode/server.md`)

#### Idle signal

Two modes:

1. **Synchronous** — `client.session.prompt({ path, body })` is a
   REST call that blocks until the AI response is complete, returning
   `{ info: AssistantMessage, parts: Part[] }` (`sdk.md`, "Sessions"
   table). The method returning IS the idle signal.
2. **Asynchronous** — `POST /session/:id/prompt_async` returns
   `204 No Content` immediately. Completion must be tracked through
   the SSE event stream at `GET /event` (`server.md`, "Messages"
   table).

SSE stream behavior: `client.event.subscribe()` yields events starting
with `server.connected`. **The specific bus event type that signals
turn completion is NOT enumerated in the local docs.** The docs link
out to `types.gen.ts` (external) for schema details. This is a
documented gap for the paused-state spec.

A `GET /session/status` endpoint returns
`{ [sessionID]: SessionStatus }`, but the `SessionStatus` field values
(e.g., `"idle"`, `"busy"`, `"aborted"`) are not defined in the local
docs.

#### Abort primitives

- `POST /session/:id/abort` → returns `boolean`. SDK wrapper:
  `client.session.abort({ path: { id } })` (`sdk.md` / `server.md`
  "Sessions").
- `createOpencode({ signal: AbortSignal })` — but per the docs, this
  signal is for **server startup timeout**, not per-request abort.

Post-abort state: **not documented**. Specifically, the docs do not
describe:
- Whether the synchronous `prompt()` call returns a partial
  `AssistantMessage` or throws
- Which SSE event type fires after abort completes
- Whether `SessionStatus` transitions to a specific value

This is the **biggest single doc gap** among the three SDKs for
paused-state work. The Atomic adapter will likely need runtime
observation (spawn an OpenCode server, issue `abort()`, observe the
SSE bus) to characterize post-abort behavior.

#### Session persistence

- Sessions are server-managed: `session.create()`, `session.list()`,
  `session.get()` — sessions persist on the server across calls.
- `POST /session/:id/fork` with optional `body: { messageID? }` →
  returns a new `Session`. Closest analog to a checkpoint.
- `POST /session/:id/revert` with `body: { messageID, partID? }` and
  the paired `POST /session/:id/unrevert`. Message-history-level
  rewind (not file-level).
- `GET /session/:id/diff` with optional `messageID` returns
  `FileDiff[]`. Implies git-level diff tracking but no dedicated file
  rollback.

No **file-level** checkpointing API is documented. The revert
endpoint operates on message history only.

**Storage location for the server's session state is not
documented** in the local docs (contrast with Claude's explicit
`~/.claude/projects/…` path).

#### Hooks

The SDK/server docs do **not** describe any programmatic hook
registration API. Config-level hooks likely exist via `.opencode`
config (referenced in project `CLAUDE.md`) but are not documented in
the SDK docs. For paused-state purposes, assume no lifecycle hook
access at the SDK layer.

#### TS types

Local docs link out to `@opencode-ai/sdk`'s `types.gen.ts` (generated
from OpenAPI). No specific `"paused"`, `"interrupted"`, or
`"cancelled"` literal types are quoted in the local docs.

#### Pause/resume mapping for OpenCode

Flow:

```
User presses Ctrl+C
  ↓
Adapter calls client.session.abort({ path: { id } })
  ↓
Adapter stores sessionId (known from session.create)
  ↓
??? post-abort behavior undocumented — likely SSE bus event or poll
    GET /session/status to confirm idle state
  ↓
Adapter sets panel.status = "paused"
  ↓
[later] User requests resume
  ↓
Adapter calls client.session.prompt({ path: { id: sessionId },
                                       body: { message: <newPrompt> } })
  ↓
Server restores context (implicit — server-managed); new prompt
processes normally.
```

Gap: the middle "???" step needs empirical characterization before a
spec can lock down the event shape the adapter consumes.

### FF'.3 — Copilot CLI SDK (`docs/copilot-cli/sdk.md`, `docs/copilot-cli/hooks.md`)

#### Idle signal

- **Primary**: `"session.idle"` event on the `CopilotSession` emitter
  — `session.on("session.idle", () => { … })` (`sdk.md` "Quick
  Start"). Zero payload.
- **Higher-level wrapper**: `session.sendAndWait(options, timeout?)`
  — sends message and resolves on `"session.idle"`, returning
  `AssistantMessageEvent | undefined`.
- Preceding `"assistant.message"` event carries full response
  (`event.data.content`).

Completion reason classification is not on the `"session.idle"` event
itself but on the session-end hook (see below).

#### Abort primitives

- `session.abort(): Promise<void>` — "Abort the currently processing
  message in this session" (`sdk.md`, "CopilotSession" methods).
- **Not** an `AbortController` pattern; abort is a method on the
  session object.
- Post-abort behavior of partial `"assistant.message_delta"` events
  in streaming mode is **not documented**.

#### Interruption distinction (richest of the three)

Session-end hook receives `input.reason`:

```ts
reason: "complete" | "error" | "abort" | "timeout" | "user_exit"
```

(`hooks.md`, "Session end hook", "Fields" section.)

This is the **most granular** termination-reason enumeration among
the three SDKs. `"abort"` specifically means programmatic
`session.abort()`; `"user_exit"` appears distinct (likely Ctrl+C at
the terminal). This lets the adapter distinguish
orchestrator-initiated pause from user-initiated exit cleanly.

#### Session persistence ("Infinite Sessions")

- `client.resumeSession(sessionId, config?)` — "Resume an existing
  session." `config.onPermissionRequest` is mandatory on resume too.
- `client.listSessions(filter?)` → `SessionMetadata[]` with fields
  `sessionId`, `startTime`, `modifiedTime`, `summary`, `context`
  (`cwd`, `gitRoot`, `repository`, `branch`).
- `client.deleteSession(sessionId)` — removes a session and its data
  from disk.
- `session.workspacePath` — present when infinite sessions are
  enabled. Points to
  `~/.copilot/session-state/{sessionId}/` containing:
  - `checkpoints/` — native checkpoint directory
  - `plan.md`
  - `files/` — file state
- `"session.compaction_start"` / `"session.compaction_complete"`
  events (with token counts) — part of infinite session management.

The checkpoint file format under `checkpoints/` is **not documented**
in local docs.

#### Hooks (`sdk.md` "Session Hooks"; `hooks.md` for shell hooks)

SDK hook registration object:

```ts
hooks: {
  onPreToolUse:          async (input, invocation) => {
                           permissionDecision: "allow" | "deny" | "ask",
                           modifiedArgs, additionalContext
                         },
  onPostToolUse:         async (input, invocation) => { additionalContext },
  onUserPromptSubmitted: async (input, invocation) => { modifiedPrompt },
  onSessionStart:        async (input, invocation) => { additionalContext },
                         // input.source: "startup" | "resume" | "new"
  onSessionEnd:          async (input, invocation) => void,
                         // input.reason: "complete" | "error" | "abort" | "timeout" | "user_exit"
  onErrorOccurred:       async (input, invocation) => {
                           errorHandling: "retry" | "skip" | "abort"
                         },
}
```

Caveat from `hooks.md`: for `preToolUse`, only `"deny"` is currently
processed — `"allow"` and `"ask"` "are not currently processed." This
limits hook-based gating for pause/resume decisions, but does not
affect the core pause detection via `onSessionEnd` + `reason:
"abort"`.

No dedicated `beforeAbort` or `onSessionPause` hook — but
`onSessionEnd` with `reason: "abort"` covers detection cleanly.

#### Pause/resume mapping for Copilot

```
User presses Ctrl+C
  ↓
Adapter calls session.abort()
  ↓
onSessionEnd hook fires with { input: { reason: "abort" } }
  ↓
Adapter sets panel.status = "paused", stores session.sessionId
  ↓
[later] User requests resume
  ↓
Adapter calls client.resumeSession(sessionId, { onPermissionRequest })
  ↓
Session workspace restored (workspacePath/checkpoints/ if infinite
sessions enabled); new prompt processes normally.
```

Gap: whether `workspacePath` is populated depends on infinite-sessions
config. If disabled, file state is not tracked — resume restores
conversation only, not files.

### FF'.4 — Cross-SDK Comparison (from local docs)

| Dimension | Claude Agent SDK | OpenCode SDK | Copilot CLI SDK |
|---|---|---|---|
| **Idle signal type** | Async-generator yield: `SDKResultMessage` | REST return / SSE event (event type undocumented) | Named event: `"session.idle"` |
| **Abort primitive** | `AbortController`, `query.interrupt()`, `query.close()` | `POST /session/:id/abort` → `boolean` | `session.abort(): Promise<void>` |
| **Interruption-specific signal** | `subtype: "error_during_execution"` (ambiguous — covers abort + errors) | **Not documented** | `onSessionEnd` hook with `reason: "abort"` (distinct from `"error"`, `"timeout"`, `"user_exit"`) |
| **Reason-code granularity** | 5 subtypes (`success`, `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`) | Not documented in local docs | 5 reasons (`complete`, `error`, `abort`, `timeout`, `user_exit`) |
| **Resume primitive** | `options: { resume: sessionId }` on `query()` | Send new prompt to same `sessionId` (server-managed) | `client.resumeSession(sessionId, config)` |
| **Conversation persistence** | Auto: `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` | Server-managed (location undocumented) | `~/.copilot/session-state/{sessionId}/` (infinite sessions) |
| **File-level checkpointing** | Native: `enableFileCheckpointing` + `rewindFiles(uuid)` | Revert-by-message, no file rollback | `workspacePath/checkpoints/` (infinite sessions; format undocumented) |
| **Fork/branch** | `forkSession: true` on resume | `POST /session/:id/fork?messageID` | Not documented |
| **Streaming interrupt** | `query.interrupt()` **streaming input mode only** | Not mode-differentiated in docs | `session.abort()` in any mode |
| **Lifecycle hooks for pause** | `"Stop"`, `"SessionEnd"` (TS only), `"Notification"` (`idle_prompt`) | None documented at SDK layer | `onSessionEnd` (SDK hook), `sessionEnd` (shell config hook) |
| **User-abort vs. error distinction** | Must be tracked by adapter (subtype is ambiguous) | Must be tracked by adapter (undocumented) | **Native** — reason field distinguishes |
| **`"paused"` literal type** | Not defined — must infer | Not defined | Not defined |

### FF'.5 — Implementation Blueprint Implied by the Docs

Based on the above, the Atomic adapter layer needs these pieces per SDK:

**Claude (clean path, conversation-level resume is deterministic):**
1. Wrap the query loop with a shared `wasUserAborted` intent flag set
   by the interrupt handler before calling `query.interrupt()` /
   `abortController.abort()`.
2. On `ResultMessage{ subtype: "error_during_execution" }`, inspect
   the flag → emit `"paused"` (if true) or `"error"` (if false).
3. Persist `session_id` (already available on the message).
4. Resume: invoke `query({ options: { resume: session_id } })` with a
   new prompt.

**OpenCode (needs empirical characterization first):**
1. Call `client.session.abort({ path: { id } })`.
2. Open question: how does the adapter **confirm** the session has
   reached an idle state post-abort? Options: poll
   `GET /session/status`, or subscribe to `event.subscribe()` and
   wait for an undocumented bus event. The spec will need empirical
   testing or direct source inspection to resolve.
3. Store `session.id`. Resume: `session.prompt({ path: { id }, body:
   <newPrompt> })`.
4. Decision: whether to use `fork` for a branching-resume semantic.

**Copilot (hook-based classification, cleanest reason-code):**
1. Register `onSessionEnd` hook on session creation.
2. Call `session.abort()` on Ctrl+C. `onSessionEnd` fires with
   `reason: "abort"` — this is the authoritative pause signal.
3. Persist `session.sessionId` (already available).
4. Resume: `client.resumeSession(sessionId, { onPermissionRequest })`.
5. For file-level rollback: requires infinite sessions to be enabled
   so `workspacePath/checkpoints/` is populated — the spec will
   need to decide whether to require this.

### FF'.6 — Updated Code References (Docs)

- `docs/claude-code/agent-sdk/agent-loop.md` — `SDKResultMessage`
  subtypes, agent loop completion semantics
- `docs/claude-code/agent-sdk/core-concepts/sessions.md` —
  `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`; `resume`,
  `continue`, `forkSession`, `persistSession`, `resumeSessionAt`
  options
- `docs/claude-code/agent-sdk/guides/file-checkpointing.md` —
  `enableFileCheckpointing`, `rewindFiles`, user-message-UUID
  checkpoint identifiers
- `docs/claude-code/agent-sdk/guides/streaming-vs-single-mode.md` —
  `query.interrupt()` streaming-mode-only; single-mode limitations
- `docs/claude-code/agent-sdk/guides/hooks.md` — `"Stop"`,
  `"SessionEnd"`, `"Notification"` (`idle_prompt`) use cases
- `docs/claude-code/agent-sdk/sdk-references/typescript.md` —
  authoritative TS types (`SDKResultMessage`, `HookEvent`,
  `PermissionResult.interrupt`, `Query.interrupt/close`)
- `docs/opencode/sdk.md` — `client.session.prompt`, `session.abort`,
  `session.create/list/get`, `event.subscribe`
- `docs/opencode/server.md` — REST endpoints:
  `POST /session/:id/abort`, `POST /session/:id/fork`,
  `POST /session/:id/revert`, `GET /session/:id/diff`,
  `GET /session/status`, `GET /event`
- `docs/copilot-cli/sdk.md` — `session.abort`, `session.idle`,
  `sendAndWait`, `resumeSession`, `listSessions`, `deleteSession`,
  `workspacePath`, infinite-sessions events
  (`session.compaction_start`/`complete`)
- `docs/copilot-cli/hooks.md` — `onSessionEnd` `reason` enum
  (`complete` / `error` / `abort` / `timeout` / `user_exit`);
  `preToolUse` only-`deny`-is-processed caveat

### FF'.7 — Resolved and Residual Open Questions

**Resolved by the docs dive:**

- *Is `"paused"` at the conductor layer the same as at the panel
  layer?* → Clearly two different layers. `StageOutputStatus`
  (conductor) and `SessionStatus` (panel) are independent types.
  The proposed "paused" would be a **panel-facing** status that
  derives from (but is not identical to) the conductor's
  `"interrupted"` observation, plus the SDK adapter's classification
  of abort-intent.

- *Which SDK exception(s) map to paused?* →
  - Claude: `ResultMessage{ subtype: "error_during_execution" }` +
    adapter-tracked user-abort flag.
  - Copilot: `onSessionEnd{ reason: "abort" }` (clean, native).
  - OpenCode: **undocumented** — needs empirical characterization.

- *Resume primitives exist for all three SDKs:*
  - Claude — `resume: sessionId` (JSONL-backed, deterministic).
  - OpenCode — same session ID + new prompt (server-managed).
  - Copilot — `client.resumeSession(sessionId)` (with mandatory
    `onPermissionRequest`).

- *Partial-stream semantics:* Claude does NOT retract already-yielded
  `input_json_delta` events on abort; Copilot & OpenCode partial
  delta behavior on abort is not documented.

- *Idempotency of abort:* **not documented for any SDK**. Remains a
  residual open question requiring empirical validation.

**Residual for the spec:**

1. **OpenCode post-abort event shape** must be characterized
   empirically or by reading `@opencode-ai/sdk` source.
2. **Does every SDK's resume preserve partial tool output from the
   turn that was interrupted?** Claude's JSONL captures what was
   persisted by the SDK up to the abort point, but a tool call
   whose `input_json_delta` was still streaming would not have a
   matching `ToolUseBlock` in the JSONL. The interrupted turn may
   replay from the last fully-emitted user message. This affects
   whether the resumed UI should "replay" or "skip" the interrupted
   stage.
3. **File-level rollback policy.** Claude's `rewindFiles` rolls back
   Write/Edit/NotebookEdit changes only (not `Bash`-initiated file
   changes). Copilot's checkpoints (when infinite sessions enabled)
   track `files/` but the format is undocumented. OpenCode has no
   file-rollback API. Does the spec require file rollback on pause,
   or only conversation rollback?
4. **For Claude interactive/tmux path** (where completion is detected
   by pane-capture polling, not a `ResultMessage`): the SDK resume
   primitive is still available for the headless path, but the
   interactive path currently has no SDK-level session ID — it's a
   raw terminal running the Claude CLI. How does the paused-state
   model accommodate the pane-capture path, or is pausing
   restricted to the headless path? (This links directly to the
   primary topic: the tmux window is the resume target for the
   interactive path, reinforcing why window-close suppression is a
   prerequisite.)
5. **Permission-denial interrupts.** Claude's
   `PermissionResult{ behavior: "deny", interrupt: true }` is a
   second pathway into `"error_during_execution"`. Should this route
   to paused or error? It's technically user-initiated (via a hook
   the adapter registered) but semantically different from a direct
   abort.

### FF'.8 — Critical Pre-spec Investigations Needed

Two items are blocking for a full spec draft and should be resolved
before committing to an implementation plan:

1. **OpenCode post-abort signal**: spin up a local OpenCode server,
   issue `client.session.abort()` mid-stream, and characterize:
   - Which SSE bus event(s) fire after abort completes.
   - What `GET /session/status` returns for the affected session.
   - Whether `client.session.prompt()` (if it was mid-call) throws,
     returns partial, or returns normally.
   - Whether subsequent `session.prompt()` on the same session ID
     works as expected post-abort.

2. **SDK abort idempotency**: for each SDK, call abort twice in rapid
   succession and once after the session has already completed.
   Document whether the second call no-ops, throws, or corrupts
   session state. This matters because a paused-state handler may
   be invoked multiple times during a noisy Ctrl+C sequence.
