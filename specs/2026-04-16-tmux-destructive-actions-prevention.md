# tmux Destructive Actions Prevention — Technical Design Document

| Document Metadata      | Details                                                        |
| ---------------------- | -------------------------------------------------------------- |
| Author(s)              | flora131                                                       |
| Status                 | Implemented                                                    |
| Team / Owner           | Atomic CLI                                                     |
| Created / Last Updated | 2026-04-17                                                     |

## 1. Executive Summary

Atomic's tmux-based workflow sessions previously had limited protection against destructive user actions. The default `C-b` prefix key remained active, allowing users to kill windows (`C-b &`), kill panes (`C-b x`), and rename windows/sessions (`C-b ,` / `C-b $`). These actions break the workflow orchestrator's ability to track agent windows, capture pane output, or manage session lifecycle — leading to crashes, orphaned processes, and silent failures.

The implemented fix is applied **entirely within `src/sdk/runtime/tmux.conf`**: (1) unbind the most destructive default tmux keybindings (kill-window, kill-pane, rename-window, rename-session), (2) disable automatic window renaming, and (3) add pane splitting bindings for user convenience. The approach is intentionally conservative — only the bindings that directly corrupt workflow state are removed, while all other tmux functionality (including the command prompt, detach, window creation, and navigation) is preserved. No changes were needed to the TypeScript runtime, React TUI, or executor.

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

- [x] Users CANNOT kill tmux windows via keyboard shortcuts (`C-b &` unbound)
- [x] Users CANNOT kill tmux panes via keyboard shortcuts (`C-b x` unbound)
- [x] Users CANNOT rename windows or sessions via keyboard shortcuts (`C-b ,` and `C-b $` unbound)
- [x] Users CAN interact with agents normally (type, scroll, mouse select)
- [x] Users CAN navigate between windows via `C-g` (graph) and `C-\` (next)
- [x] Users CAN exit the workflow via `q` or `Ctrl+C` in the orchestrator panel
- [x] Users CAN scroll through pane history via mouse scroll and vi copy-mode
- [x] Users CAN split panes via `C-b -` (vertical) and `C-b |` (horizontal)
- [x] Users CAN access the tmux command prompt, detach, and create new windows (these remain available)

#### Deferred Goals (not implemented)

- [ ] ~~Users CANNOT access the tmux command prompt via keyboard shortcuts~~ — kept available; blocking `:` was deemed overly restrictive
- [ ] ~~Users CANNOT detach from the session via keyboard shortcuts~~ — kept available; detach is non-destructive
- [ ] ~~Users CANNOT create new windows or split panes via keyboard shortcuts~~ — pane splitting was added as a feature instead
- [ ] ~~If an agent process crashes, the pane remains visible (not auto-destroyed)~~ — `remain-on-exit` and `pane-died` hook were removed as overly complex for the current use case

### 3.2 Non-Goals (Out of Scope)

- [ ] We will NOT prevent tmux CLI commands run from within a shell pane (this is a known tmux architectural limitation — key binding lockdown only controls the tmux UI, not the `tmux` CLI binary)
- [ ] We will NOT implement a custom key table approach (more complex, same outcome as unbinding)
- [ ] We will NOT disable the prefix key entirely (preserves `C-b [` for copy-mode entry as a fallback to mouse scroll)
- [ ] We will NOT use tmux's read-only mode (users need to interact with agent CLIs in agent windows)
- [ ] We will NOT modify any TypeScript files (`tmux.ts`, `executor.ts`, `session-graph-panel.tsx`) — the fix is config-only
- [ ] We will NOT unbind non-destructive bindings (command prompt, detach, navigation, window creation) — the approach is conservative, only blocking actions that corrupt workflow state

## 4. Proposed Solution (High-Level Design)

### 4.1 Interaction Model Diagram

```
BEFORE (original — vulnerable):
┌─────────────────────────────────────────────────┐
│  tmux session: atomic-wf-claude-ralph-<id>      │
│                                                  │
│  C-b &  →  KILLS window (breaks workflow)        │
│  C-b x  →  KILLS pane (breaks workflow)          │
│  C-b ,  →  RENAMES window (breaks executor)      │
│  C-b $  →  RENAMES session (breaks executor)     │
│                                                  │
│  C-g    →  Return to graph ✓                     │
│  C-\    →  Next agent window ✓                   │
│  q      →  Quit workflow ✓                       │
└─────────────────────────────────────────────────┘

AFTER (implemented — targeted lockdown):
┌─────────────────────────────────────────────────┐
│  tmux session: atomic-wf-claude-ralph-<id>      │
│                                                  │
│  C-b &  →  (unbound — no effect)                │
│  C-b x  →  (unbound — no effect)                │
│  C-b ,  →  (unbound — no effect)                │
│  C-b $  →  (unbound — no effect)                │
│  C-b [  →  Enter copy-mode ✓ (kept)             │
│  C-b -  →  Split pane vertically ✓ (added)      │
│  C-b |  →  Split pane horizontally ✓ (added)    │
│  C-b :  →  Command prompt ✓ (kept)              │
│  C-b d  →  Detach ✓ (kept)                      │
│  C-b c  →  New window ✓ (kept)                  │
│                                                  │
│  C-g    →  Return to graph ✓                     │
│  C-\    →  Next agent window ✓                   │
│  q      →  Quit workflow ✓                       │
│  Mouse  →  Scroll / select / copy ✓             │
└─────────────────────────────────────────────────┘
```

### 4.2 Architectural Pattern

**Targeted lockdown via tmux configuration**:

1. **Layer 1 — Destructive key binding removal**: Unbind only the keybindings that directly corrupt workflow state (kill-window, kill-pane, rename-window, rename-session)
2. **Layer 2 — Rename protection**: `automatic-rename off` complements `allow-rename off` to prevent programmatic window renaming
3. **Layer 3 — Convenience bindings**: Add pane splitting shortcuts for power users

### 4.3 Key Components

| Component | Change | Justification |
|---|---|---|
| `src/sdk/runtime/tmux.conf` | Unbind 4 destructive keybindings (`&`, `x`, `,`, `$`) | Prevents accidental kill/rename of workflow-managed windows |
| `src/sdk/runtime/tmux.conf` | Add `automatic-rename off` | Complements existing `allow-rename off` for complete rename protection |
| `src/sdk/runtime/tmux.conf` | Add pane splitting bindings (`-` vertical, `\|` horizontal) | Gives users useful tmux functionality within the constrained environment |
| No TypeScript changes | — | Config is already injected via `-f` flag; executor/panel/store are already robust |

## 5. Detailed Design

### 5.1 tmux.conf Changes

The following directives were appended to `src/sdk/runtime/tmux.conf` after the existing copy-mode mouse bindings.

#### 5.1.1 Key Binding Unbinds

Only the bindings that directly corrupt workflow state are removed. All other tmux functionality is preserved.

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

# Prevent automatic window renaming (complements allow-rename off above)
setw -g automatic-rename off
```

> Research: [`research/docs/2026-04-16-tmux-destructive-actions-prevention.md`](../research/docs/2026-04-16-tmux-destructive-actions-prevention.md), "Strategy 1: Unbind All Dangerous Default Keys"

#### 5.1.2 Pane Splitting Bindings

Custom pane splitting bindings provide useful functionality within the workflow session.

```tmux
# Pane splitting
bind - split-window -v -c "#{pane_current_path}"
bind | split-window -h -c "#{pane_current_path}"
```

#### 5.1.3 Removed: Crash Recovery (originally proposed, not implemented)

The original spec proposed `remain-on-exit on` and a `pane-died` respawn hook. These were removed during implementation because:

- `remain-on-exit on` caused dead panes to accumulate, creating a confusing UX when agents exit cleanly
- The `pane-died` respawn hook added complexity without clear benefit — the executor already handles agent lifecycle
- The conservative approach (unbind only destructive keys) provides sufficient protection without side effects

### 5.2 Bindings That Are Intentionally KEPT

**Principle**: Keep all tmux functionality except the specific actions that corrupt workflow state (kill-window, kill-pane, rename-window, rename-session). All other default bindings remain active, including the command prompt, detach, window creation, and navigation.

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
| `C-b :` | Prefix | Command prompt (kept — power users may need it) |
| `C-b d` | Prefix | Detach (kept — non-destructive, session continues) |
| `C-b c` | Prefix | New window (kept — non-destructive) |
| `C-b n/p/w` | Prefix | Window navigation (kept — non-destructive) |
| `C-b -` | Prefix | Split pane vertically (custom binding) |
| `C-b \|` | Prefix | Split pane horizontally (custom binding) |
| `C-g` | Root (no prefix) | Return to graph panel (Atomic navigation) |
| `C-\` | Root (no prefix) | Cycle to next agent window (Atomic navigation) |
| All copy-mode-vi bindings | copy-mode-vi | Scroll, select, copy — read-only operations |
| Mouse bindings | Root | Scroll, drag-select, click — essential UX |
| Any other unlisted default binding | Prefix | Kept — only kill/rename bindings are removed |

### 5.3 Interaction with Existing Code

| Component | Impact |
|---|---|
| `tmuxRun()` (`tmux.ts:138`) | None — config is already injected via `-f`. Unbinds take effect automatically. |
| `createSession()` (`tmux.ts:204`) | None — no session-level changes beyond keybinding removal. |
| `createWindow()` (`tmux.ts:242`) | None — windows work as before, just can't be killed/renamed via keyboard. |
| `killWindow()` (`tmux.ts:416`) | None — programmatic `kill-window` via `tmuxRun()` is unaffected by keybinding unbinds. Unbinds only affect keyboard shortcuts, not tmux CLI commands. |
| `killSession()` (`tmux.ts:407`) | None — same as above. |
| `SessionGraphPanel` keyboard handler | None — only processes its own keys, doesn't use tmux prefix bindings. |
| Active window polling (`panel.tsx:369`) | None — polls `tmux display-message` which works regardless of keybinding state. |
| Status bar sync (`panel.tsx:400`) | None — uses `tmuxRun()` to set status options, not keybindings. |
| Chat sessions (`chat/index.ts`) | Same tmux.conf applies (single-window, lower risk). Unbinds are harmless. |

### 5.4 Known Limitations

**Shell access bypass**: If a user is in an agent window where the agent has exited and dropped to a shell prompt, they can run `tmux kill-window`, `tmux rename-window`, etc. directly from the command line. This bypasses all keybinding restrictions. This is a known tmux architectural limitation — keybinding lockdown only controls the tmux UI, not the `tmux` CLI binary.

**Command prompt access**: Since `C-b :` is kept available, users can still run arbitrary tmux commands (including `kill-session`, `kill-server`, etc.) via the command prompt. This is an intentional trade-off: power users benefit from command prompt access, and the risk of accidental destructive commands via the prompt is much lower than via single-key shortcuts.

> Research: [`research/docs/2026-04-16-tmux-destructive-actions-prevention.md`](../research/docs/2026-04-16-tmux-destructive-actions-prevention.md), "Architectural Limitation: Shell Access Bypass"

## 6. Alternatives Considered

| Option | Pros | Cons | Reason for Rejection/Selection |
|---|---|---|---|
| **A: Unbind only destructive keys (Selected)** | Minimal, targeted, preserves all non-destructive tmux functionality, zero code changes | Command prompt (`C-b :`) remains available for arbitrary tmux commands | **Selected**: Most conservative approach — only removes the 4 bindings that corrupt workflow state. Preserves power-user access to all other tmux features. |
| **A': Unbind all ~18 dangerous keys (Originally proposed, rejected)** | More comprehensive protection — blocks command prompt, detach, navigation, window creation | Overly restrictive; blocks non-destructive features users may want; more bindings to maintain | Rejected during implementation: the aggressive lockdown removed useful functionality (detach, command prompt, pane splitting) without proportional safety benefit. |
| **B: Disable prefix key entirely** (`set -g prefix None`) | Maximum protection — no undiscovered binding can slip through | Loses `C-b [` for copy-mode entry; users must rely solely on mouse scroll | Rejected: mouse scroll handles 95% of use cases, but losing keyboard copy-mode entry is unnecessary when we can just unbind the dangerous keys |
| **C: Custom key table** (`set key-table restricted`) | Clean separation of concerns; could have different restriction levels per window | Significantly more complex; harder to debug; same outcome as unbinding | Rejected: higher complexity for no practical benefit over Strategy A |
| **D: Read-only attach** (`tmux attach -r`) | Blocks ALL key bindings silently | Users cannot interact with agent CLIs (type prompts, respond to questions) | Rejected: fundamentally incompatible — users need to type in agent windows |
| **E: No protection (status quo)** | Zero effort | Workflow sessions remain fragile; users can accidentally destroy running workflows | Rejected: the bug report exists specifically because this is happening |
| **F: remain-on-exit + pane-died hook (Originally proposed, rejected)** | Crash recovery, dead panes stay visible for inspection | Dead panes accumulate confusingly; `pane-died` hook adds complexity; executor already handles lifecycle | Rejected during implementation: the side effects (accumulated dead panes, respawn loops) outweighed the benefits for the current use case. |

> Research: [`research/docs/2026-04-16-tmux-destructive-actions-prevention.md`](../research/docs/2026-04-16-tmux-destructive-actions-prevention.md), "tmux Options for Preventing Destructive Actions" (Strategies 1-6)

## 7. Cross-Cutting Concerns

### 7.1 Compatibility

- **tmux version**: Tested against tmux 3.6a on macOS Darwin 25.3.0. The `unbind` and `automatic-rename` directives are standard tmux commands available in all modern tmux versions (2.0+).
- **psmux (Windows)**: The config is shared by tmux (macOS/Linux) and psmux (Windows) per `tmux.conf:3`. Unbind directives are standard tmux commands — psmux compatibility should be verified during testing.
- **User tmux sessions**: The config only applies within the Atomic socket (`-L atomic`). It does NOT affect the user's default tmux sessions. Socket isolation is already in place.

### 7.2 Observability

No additional observability is needed. The tmux config changes are silent — unbinds simply make keys do nothing.

### 7.3 Reversibility

Fully reversible by removing the added lines from `tmux.conf`. No data migration, no state changes, no side effects outside the config file.

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

This is a single-file config change. It takes effect immediately for all new tmux sessions created after the change is deployed. Existing running sessions are not affected (tmux reads the config at session creation, not dynamically).

Shipped in a single phase: unbind the 4 destructive keybindings + add `automatic-rename off` + add pane splitting bindings.

### 8.2 Test Plan

- **Manual test — Key binding lockdown**: Start a workflow session (`atomic workflow -n ralph -a claude "test"`), then attempt each unbound key (`C-b &`, `C-b x`, `C-b ,`, `C-b $`). Verify all are no-ops.
- **Manual test — Safe bindings preserved**: In the same session, verify `C-g` (graph), `C-\` (next window), `C-b [` (copy-mode), `C-b :` (command prompt), `C-b d` (detach), mouse scroll, and `q` (quit) all work correctly.
- **Manual test — Pane splitting**: Verify `C-b -` (vertical split) and `C-b |` (horizontal split) work correctly, inheriting the current pane's working directory.
- **Manual test — Chat session**: Start a chat session (`atomic chat -a claude`) and verify the same protections apply without breaking single-window chat interaction.
- **Integration test**: Verify the existing workflow e2e test suite still passes (the executor's programmatic `killWindow`/`killSession` calls should be unaffected by keybinding unbinds).
- **psmux test** (Windows): Verify the unbind directives are compatible with psmux on Windows.

## 9. Open Questions / Unresolved Issues

All questions resolved.

- [x] **Q1: Should detach (`C-b d`) be blocked?** → **No.** Originally proposed to block, but detach is non-destructive (session continues running). Kept available for power users.
- [x] **Q2: Should `remain-on-exit` be enabled?** → **No.** Originally proposed, but removed — dead panes accumulate confusingly and the executor already manages agent lifecycle.
- [x] **Q3: Should the `pane-died` hook be added?** → **No.** Originally proposed, but removed — adds complexity without clear benefit for the current use case.
- [x] **Q4: Should the pane resize bindings (`C-b l/h/k/j`) be kept?** → **Yes.** Keep all non-destructive tmux bindings intact. Only unbind the specific destructive actions (kill, rename).
- [x] **Q5: Should `C-b [` (copy-mode entry) be kept?** → **Yes.** Keep `C-b [` for keyboard-based copy-mode entry as a fallback to mouse scroll.
- [x] **Q6: Should the command prompt (`C-b :`) be blocked?** → **No.** Originally proposed to block, but kept available — the risk of accidental damage via the command prompt is low (requires typing a command, not just pressing a key).
- [x] **Q7: Should pane splitting be allowed?** → **Yes.** Custom bindings (`C-b -` and `C-b |`) were added to give users useful pane management within the workflow session.
