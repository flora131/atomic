# tmux Destructive Actions Prevention — Technical Design Document

| Document Metadata      | Details                                                        |
| ---------------------- | -------------------------------------------------------------- |
| Author(s)              | flora131                                                       |
| Status                 | Draft (WIP)                                                    |
| Team / Owner           | Atomic CLI                                                     |
| Created / Last Updated | 2026-04-16                                                     |

## 1. Executive Summary

Atomic's tmux-based workflow sessions currently have **zero protection** against destructive user actions. The default `C-b` prefix key remains active, allowing users to kill windows (`C-b &`), kill panes (`C-b x`), rename windows (`C-b ,`), open an arbitrary command prompt (`C-b :`), detach (`C-b d`), and create unmanaged windows (`C-b c`). Any of these actions break the workflow orchestrator's ability to track agent windows, capture pane output, or manage session lifecycle — leading to crashes, orphaned processes, and silent failures.

This spec proposes a layered fix applied **entirely within `src/sdk/runtime/tmux.conf`**: (1) unbind all dangerous default tmux keybindings, (2) enable `remain-on-exit` to protect against in-pane process exits, and (3) add a `pane-died` auto-respawn hook for crash recovery. No changes are needed to the TypeScript runtime, React TUI, or executor — the problem and fix are purely at the tmux configuration layer.

## 2. Context and Motivation

### 2.1 Current State

Atomic manages workflow sessions as tmux sessions on an isolated socket (`-L atomic`). The bundled config at `src/sdk/runtime/tmux.conf` is injected via the `-f` flag on every tmux invocation through `tmuxRun()` (`src/sdk/runtime/tmux.ts:143`). The config provides mouse support, vi copy-mode, status bar styling, and two prefix-free navigation bindings (`C-g` → graph, `C-\` → next window).

**The config does not modify the tmux prefix key (`C-b`)**, leaving all ~40 default prefix-based tmux keybindings active. The only existing protection is `allow-rename off` (line 13), which only blocks *process escape sequences* from renaming windows — it does not block the user's `C-b ,` rename keybinding.

**Architecture context**: The React TUI orchestrator panel (`src/sdk/components/session-graph-panel.tsx`) is already well-locked-down — it only processes `q`, `Ctrl+C`, arrow keys, `hjkl`, `Enter`, `G/gg`, and `/`. The vulnerability is entirely at the tmux layer, not the application layer.

> Research: [`research/docs/2026-04-16-tmux-destructive-actions-prevention.md`](../research/docs/2026-04-16-tmux-destructive-actions-prevention.md), Section "Summary"

### 2.2 The Problem

**User Impact**: Users who accidentally press `C-b &` (kill window) or `C-b x` (kill pane) destroy an agent window mid-execution. The workflow fails with opaque errors because the executor's `paneId` references become invalid — `capturePane()` and `sendLiteralText()` fail silently or throw.

**Workflow State Corruption**: The executor tracks windows by name (`src/sdk/runtime/executor.ts:967`). If a user renames a window via `C-b ,`, all subsequent `tmux.killWindow(session, name)` and `tmux.selectWindow(session:name)` calls fail because the name no longer matches.

**Session Lifecycle Breakage**: If a user detaches via `C-b d`, the session continues running headlessly. The user has no obvious way to reattach (`tmux -L atomic attach` is not surfaced), and may think the workflow crashed.

**Command Prompt Escape**: `C-b :` opens the tmux command prompt where a user can run `kill-session`, `kill-server`, or any arbitrary tmux command — completely bypassing all application-level protections.

> Research: [`research/docs/2026-04-16-tmux-destructive-actions-prevention.md`](../research/docs/2026-04-16-tmux-destructive-actions-prevention.md), Sections "Default tmux Prefix Bindings That Are Dangerous" and "Workflow Session Structure (What Gets Broken)"

## 3. Goals and Non-Goals

### 3.1 Functional Goals

- [x] Users CANNOT kill tmux windows via keyboard shortcuts
- [x] Users CANNOT kill tmux panes via keyboard shortcuts
- [x] Users CANNOT rename windows or sessions via keyboard shortcuts
- [x] Users CANNOT access the tmux command prompt via keyboard shortcuts
- [x] Users CANNOT detach from the session via keyboard shortcuts
- [x] Users CANNOT create new windows or split panes via keyboard shortcuts
- [x] Users CAN interact with agents normally (type, scroll, mouse select)
- [x] Users CAN navigate between windows via `C-g` (graph) and `C-\` (next)
- [x] Users CAN exit the workflow via `q` or `Ctrl+C` in the orchestrator panel
- [x] Users CAN scroll through pane history via mouse scroll and vi copy-mode
- [x] If an agent process crashes, the pane remains visible (not auto-destroyed)

### 3.2 Non-Goals (Out of Scope)

- [ ] We will NOT prevent tmux CLI commands run from within a shell pane (this is a known tmux architectural limitation — key binding lockdown only controls the tmux UI, not the `tmux` CLI binary)
- [ ] We will NOT implement a custom key table approach (more complex, same outcome as unbinding)
- [ ] We will NOT disable the prefix key entirely (preserves `C-b [` for copy-mode entry as a fallback to mouse scroll)
- [ ] We will NOT use tmux's read-only mode (users need to interact with agent CLIs in agent windows)
- [ ] We will NOT modify any TypeScript files (`tmux.ts`, `executor.ts`, `session-graph-panel.tsx`) — the fix is config-only

## 4. Proposed Solution (High-Level Design)

### 4.1 Interaction Model Diagram

```
BEFORE (current — vulnerable):
┌─────────────────────────────────────────────────┐
│  tmux session: atomic-wf-claude-ralph-<id>      │
│                                                  │
│  C-b &  →  KILLS window (breaks workflow)        │
│  C-b x  →  KILLS pane (breaks workflow)          │
│  C-b ,  →  RENAMES window (breaks executor)      │
│  C-b :  →  COMMAND PROMPT (arbitrary commands)   │
│  C-b d  →  DETACH (confusing UX)                 │
│  C-b c  →  NEW WINDOW (confuses window list)     │
│                                                  │
│  C-g    →  Return to graph ✓                     │
│  C-\    →  Next agent window ✓                   │
│  q      →  Quit workflow ✓                       │
└─────────────────────────────────────────────────┘

AFTER (proposed — locked down):
┌─────────────────────────────────────────────────┐
│  tmux session: atomic-wf-claude-ralph-<id>      │
│                                                  │
│  C-b &  →  (unbound — no effect)                │
│  C-b x  →  (unbound — no effect)                │
│  C-b ,  →  (unbound — no effect)                │
│  C-b :  →  (unbound — no effect)                │
│  C-b d  →  (unbound — no effect)                │
│  C-b c  →  (unbound — no effect)                │
│  C-b [  →  Enter copy-mode ✓ (kept)             │
│                                                  │
│  C-g    →  Return to graph ✓                     │
│  C-\    →  Next agent window ✓                   │
│  q      →  Quit workflow ✓                       │
│  Mouse  →  Scroll / select / copy ✓             │
│                                                  │
│  remain-on-exit on → dead panes stay visible    │
│  pane-died hook → auto-respawn crashed panes    │
└─────────────────────────────────────────────────┘
```

### 4.2 Architectural Pattern

**Defense in depth via tmux configuration layering**:

1. **Layer 1 — Key binding lockdown**: Unbind all dangerous prefix-based keybindings to prevent keyboard-initiated destructive actions
2. **Layer 2 — Process exit protection**: `remain-on-exit on` prevents pane/window auto-destruction when an agent process exits (crash, `exit`, Ctrl+D)
3. **Layer 3 — Crash recovery**: `pane-died` hook auto-respawns crashed panes so the executor can retry or the user can see the recovery

### 4.3 Key Components

| Component | Change | Justification |
|---|---|---|
| `src/sdk/runtime/tmux.conf` | Unbind ~18 dangerous default keybindings | Prevents all keyboard-initiated destructive actions |
| `src/sdk/runtime/tmux.conf` | Add `remain-on-exit on` | Keeps panes alive after process exit for crash visibility |
| `src/sdk/runtime/tmux.conf` | Add `pane-died` respawn hook | Auto-restarts crashed agent processes |
| `src/sdk/runtime/tmux.conf` | Add `automatic-rename off` | Complements existing `allow-rename off` for complete rename protection |
| No TypeScript changes | — | Config is already injected via `-f` flag; executor/panel/store are already robust |

## 5. Detailed Design

### 5.1 tmux.conf Changes

The following directives will be appended to `src/sdk/runtime/tmux.conf` after the existing copy-mode bindings (after line 73).

#### 5.1.1 Key Binding Unbinds

```tmux
# ── Workflow protection: unbind destructive defaults ──────────────
# Atomic manages the tmux session lifecycle programmatically. Users should
# interact with agents and navigate via Ctrl+G / Ctrl+\ / the graph panel.
# The prefix key (C-b) is kept only for copy-mode entry (C-b [).

# Prevent window/pane destruction
unbind &          # kill-window
unbind x          # kill-pane

# Prevent renaming
unbind ,          # rename-window
unbind '$'        # rename-session

# Prevent command prompt (blocks arbitrary tmux commands)
unbind :

# Prevent detach (exit workflow via q in the orchestrator panel)
unbind d          # detach-client
unbind D          # choose-client (detach menu)

# Prevent uncontrolled window/pane creation
unbind c          # new-window
unbind '"'        # split-window (default vertical)
unbind %          # split-window (default horizontal)
unbind -          # our custom vertical split
unbind '|'        # our custom horizontal split
unbind !          # break-pane (moves pane to new window)

# Prevent window navigation that bypasses our controls
unbind n          # next-window (we have Ctrl+\ instead)
unbind p          # previous-window
unbind w          # choose-tree (window picker)

# Prevent session navigation/management
unbind '('        # previous-session
unbind ')'        # next-session
unbind s          # choose-tree (session picker)
unbind L          # switch to last session

# Prevent window reordering
unbind .          # move-window

# Prevent suspend
unbind C-z        # suspend-client
```

> Research: [`research/docs/2026-04-16-tmux-destructive-actions-prevention.md`](../research/docs/2026-04-16-tmux-destructive-actions-prevention.md), "Strategy 1: Unbind All Dangerous Default Keys" and [`research/web/2026-04-16-tmux-preventing-destructive-actions.md`](../research/web/2026-04-16-tmux-preventing-destructive-actions.md), Section 5.2

#### 5.1.2 Process Exit Protection

```tmux
# ── Process exit protection ───────────────────────────────────────
# Keep panes alive when agent processes exit (crash, exit, Ctrl+D).
# The pane shows "[Pane is dead]" instead of auto-closing.
setw -g remain-on-exit on

# Prevent automatic window renaming (complements allow-rename off above)
setw -g automatic-rename off
```

> Research: [`research/web/2026-04-16-tmux-preventing-destructive-actions.md`](../research/web/2026-04-16-tmux-preventing-destructive-actions.md), Section 1.1 and 2.3

#### 5.1.3 Crash Recovery Hook

```tmux
# ── Crash recovery ────────────────────────────────────────────────
# Auto-respawn panes that die with a non-zero exit code (crash).
# Clean exits (code 0) keep the dead pane visible for inspection.
set-hook -g pane-died "if -F '#{!=:#{pane_dead_status},0}' 'respawn-pane'"
```

> Research: [`research/docs/2026-04-16-tmux-destructive-actions-prevention.md`](../research/docs/2026-04-16-tmux-destructive-actions-prevention.md), "Strategy 6: remain-on-exit failed + pane-died Hook"

### 5.2 Bindings That Are Intentionally KEPT

**Principle**: Keep all non-destructive tmux functionality intact. Only unbind the specific actions that can break workflow state (kill, rename, command prompt, detach, create, navigate to other sessions). All safe, read-only, and informational bindings remain active.

| Binding | Type | Reason |
|---|---|---|
| `C-b [` | Prefix | Enter copy-mode (keyboard fallback to mouse scroll) |
| `C-b PPage` | Prefix | Enter copy-mode and page up (accessibility) |
| `C-b l/h/k/j` | Prefix | Pane resize (non-destructive layout adjustment) |
| `C-b z` | Prefix | Zoom/unzoom pane (non-destructive, togglable) |
| `C-b q` | Prefix | Display pane numbers (informational only) |
| `C-b t` | Prefix | Show clock (informational only) |
| `C-b Space` | Prefix | Cycle through pane layouts (non-destructive) |
| `C-b ?` | Prefix | List key bindings (informational only) |
| `C-g` | Root (no prefix) | Return to graph panel (Atomic navigation) |
| `C-\` | Root (no prefix) | Cycle to next agent window (Atomic navigation) |
| All copy-mode-vi bindings | copy-mode-vi | Scroll, select, copy — read-only operations |
| Mouse bindings | Root | Scroll, drag-select, click — essential UX |
| Any other unlisted default binding | Prefix | Kept unless explicitly identified as destructive |

### 5.3 Interaction with Existing Code

| Component | Impact |
|---|---|
| `tmuxRun()` (`tmux.ts:138`) | None — config is already injected via `-f`. Unbinds take effect automatically. |
| `createSession()` (`tmux.ts:204`) | None — `remain-on-exit` applies globally to all new windows. |
| `createWindow()` (`tmux.ts:242`) | None — new windows inherit global `remain-on-exit` setting. |
| `killWindow()` (`tmux.ts:416`) | None — programmatic `kill-window` via `tmuxRun()` is unaffected by keybinding unbinds. Unbinds only affect keyboard shortcuts, not tmux CLI commands. |
| `killSession()` (`tmux.ts:407`) | None — same as above. |
| `capturePane()` (`tmux.ts:267`) | May need to handle dead panes (returns empty/static content). Already handles this via timeout in `waitForPaneReady()`. |
| `SessionGraphPanel` keyboard handler | None — only processes its own keys, doesn't use tmux prefix bindings. |
| Active window polling (`panel.tsx:369`) | None — polls `tmux display-message` which works regardless of keybinding state. |
| Status bar sync (`panel.tsx:400`) | None — uses `tmuxRun()` to set status options, not keybindings. |
| `pane-died` hook + `remain-on-exit` | If an agent crashes, the pane respawns automatically (non-zero exit). The executor's `waitForPaneReady()` polling will detect the restarted pane. For zero-exit (clean shutdown), the pane stays dead — the executor's existing error handling (`executor.ts:1199-1203`) catches the timeout. |
| Chat sessions (`chat/index.ts`) | Same tmux.conf applies (single-window, lower risk). Unbinds are harmless. `remain-on-exit` provides crash protection for chat too. |

### 5.4 Known Limitations

**Shell access bypass**: If a user is in an agent window where the agent has exited and dropped to a shell prompt, they can run `tmux kill-window`, `tmux rename-window`, etc. directly from the command line. This bypasses all keybinding restrictions.

**Mitigation**: The `remain-on-exit on` setting prevents auto-dropping to a shell. When a pane's process exits, the pane enters "dead" state (`[Pane is dead]`) rather than spawning a new shell. The `pane-died` hook respawns crashed processes. A user would have to intentionally wait for the respawn to fail and then somehow get to a shell — this is not an accidental action.

> Research: [`research/docs/2026-04-16-tmux-destructive-actions-prevention.md`](../research/docs/2026-04-16-tmux-destructive-actions-prevention.md), "Architectural Limitation: Shell Access Bypass"

## 6. Alternatives Considered

| Option | Pros | Cons | Reason for Rejection/Selection |
|---|---|---|---|
| **A: Unbind dangerous keys (Selected)** | Surgical, preserves copy-mode via `C-b [`, low complexity, zero code changes | Requires maintaining an explicit unbind list as tmux versions add new defaults | **Selected**: Best balance of protection and usability. Easy to maintain — new tmux defaults rarely add destructive bindings. |
| **B: Disable prefix key entirely** (`set -g prefix None`) | Maximum protection — no undiscovered binding can slip through | Loses `C-b [` for copy-mode entry; users must rely solely on mouse scroll | Rejected: mouse scroll handles 95% of use cases, but losing keyboard copy-mode entry is unnecessary when we can just unbind the dangerous keys |
| **C: Custom key table** (`set key-table restricted`) | Clean separation of concerns; could have different restriction levels per window | Significantly more complex; harder to debug; same outcome as unbinding | Rejected: higher complexity for no practical benefit over Strategy A |
| **D: Read-only attach** (`tmux attach -r`) | Blocks ALL key bindings silently | Users cannot interact with agent CLIs (type prompts, respond to questions) | Rejected: fundamentally incompatible — users need to type in agent windows |
| **E: No protection (status quo)** | Zero effort | Workflow sessions remain fragile; users can accidentally destroy running workflows | Rejected: the bug report exists specifically because this is happening |

> Research: [`research/docs/2026-04-16-tmux-destructive-actions-prevention.md`](../research/docs/2026-04-16-tmux-destructive-actions-prevention.md), "tmux Options for Preventing Destructive Actions" (Strategies 1-6)

## 7. Cross-Cutting Concerns

### 7.1 Compatibility

- **tmux version**: Tested against tmux 3.6a on macOS Darwin 25.3.0. The `unbind`, `remain-on-exit`, and `set-hook` directives are available in tmux 2.6+. `remain-on-exit failed` requires tmux 3.2+, but we use `remain-on-exit on` (available in all modern versions).
- **psmux (Windows)**: The config is shared by tmux (macOS/Linux) and psmux (Windows) per `tmux.conf:3`. Unbind directives are standard tmux commands — psmux compatibility should be verified during testing.
- **User tmux sessions**: The config only applies within the Atomic socket (`-L atomic`). It does NOT affect the user's default tmux sessions. Socket isolation is already in place.

### 7.2 Observability

No additional observability is needed. The tmux config changes are silent — unbinds simply make keys do nothing. The `pane-died` hook auto-respawns, which the executor's existing polling (`waitForPaneReady`) will detect.

### 7.3 Reversibility

Fully reversible by removing the added lines from `tmux.conf`. No data migration, no state changes, no side effects outside the config file.

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

This is a single-file config change. It takes effect immediately for all new tmux sessions created after the change is deployed. Existing running sessions are not affected (tmux reads the config at session creation, not dynamically).

- **Phase 1**: Add unbind directives + `remain-on-exit on` + `pane-died` hook to `tmux.conf`. Ship in next release.
- **Phase 2** (if needed): If edge cases emerge (e.g., a specific agent expects to be in a shell after exit), adjust `remain-on-exit` to `failed` (only keep dead panes on non-zero exit) or fine-tune the `pane-died` hook condition.

### 8.2 Test Plan

- **Manual test — Key binding lockdown**: Start a workflow session (`atomic workflow -n ralph -a claude "test"`), then attempt each unbound key (`C-b &`, `C-b x`, `C-b ,`, `C-b :`, `C-b d`, `C-b c`). Verify all are no-ops.
- **Manual test — Safe bindings preserved**: In the same session, verify `C-g` (graph), `C-\` (next window), `C-b [` (copy-mode), mouse scroll, and `q` (quit) all work correctly.
- **Manual test — remain-on-exit**: Kill an agent process from another terminal (`kill <pid>`). Verify the pane shows `[Pane is dead]` instead of auto-closing. Verify the pane respawns if exit code was non-zero.
- **Manual test — Chat session**: Start a chat session (`atomic chat -a claude`) and verify the same protections apply without breaking single-window chat interaction.
- **Integration test**: Verify the existing workflow e2e test suite still passes (the executor's programmatic `killWindow`/`killSession` calls should be unaffected by keybinding unbinds).
- **psmux test** (Windows): Verify the unbind directives are compatible with psmux on Windows.

## 9. Open Questions / Unresolved Issues

All questions resolved.

- [x] **Q1: Should detach (`C-b d`) be blocked?** → **Yes.** Detaching creates confusing UX — users don't know how to reattach. The quit mechanism (`q`) is the intended exit path.
- [x] **Q2: Should `remain-on-exit` be enabled?** → **Yes.** Keeps panes visible after agent crashes, giving users visual feedback and preventing auto-destruction of workflow state.
- [x] **Q3: Should the `pane-died` hook respawn all exits or only crashes?** → **Only crashes (non-zero exit).** Clean exits (code 0) should keep the dead pane visible for inspection rather than silently restarting.
- [x] **Q4: Should the pane resize bindings (`C-b l/h/k/j`) be kept?** → **Yes.** Keep all non-destructive tmux bindings intact. Only unbind the specific destructive actions identified in the research. The principle: preserve all safe tmux functionality, block only what can break workflows.
- [x] **Q5: Should `C-b [` (copy-mode entry) be kept?** → **Yes.** Keep `C-b [` for keyboard-based copy-mode entry as a fallback to mouse scroll. The prefix key stays active but with all dangerous bindings removed.
