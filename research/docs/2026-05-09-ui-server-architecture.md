---
date: 2026-05-09 19:52:28 UTC
researcher: alexlavaee
git_commit: cfe3a6b9623f4e3186522296709319e458e47792
branch: fix/issue-898-opentui-runtime-plugin
repository: atomic-issue-898
topic: "Clean-room Bun-native UI server for atomic — research feeding `create-spec`"
tags: [research, codebase, atomic-sdk, ui-server, json-rpc, tmux, ipc, panel, status-writer]
status: complete
last_updated: 2026-05-09
last_updated_by: alexlavaee
---

# Research: Clean-room Bun-native `--ui-server` for atomic

## Research Question

> Research the atomic codebase to support a clean-room implementation of a `--ui-server` flag for `atomic workflow` (and SDK-level `runWorkflow({ uiServer: ... })`) that exposes existing session/orchestrator state over a Bun-native JSON-RPC server (Unix socket default, optional TCP).

Eight focus areas:
1. Session lifecycle primitives — return shapes, state source, sync vs live.
2. `status-writer.ts` — write API, event/snapshot shape, on-disk format.
3. On-disk layout under `~/.atomic/sessions/<runId>/` and `~/.atomic/workflows/<name>/`.
4. `runtime/orchestrator-entry.ts` — invocation contract, state, control hooks.
5. The workflow panel — components, data shape, re-render triggers, single-attach assumption.
6. CLI plumbing for `atomic workflow` — flag inventory, `runWorkflow` handoff, slot for `--ui-server`.
7. Existing IPC / RPC machinery in the codebase.
8. Whether `vscode-jsonrpc` (or any Node-flavored RPC) is already a dependency.

## Summary

**The primitives a `--ui-server` would need already exist as exported, dependency-injectable functions; the new code is mostly a thin transport layer.** Specifically:

- The seven session primitives (`listSessions`, `getSession`, `getSessionStatus`, `getSessionTranscript`, `stopSession`, `attachSession`, `detachSession`) plus three pane-navigation primitives (`nextWindow`, `previousWindow`, `gotoOrchestrator`) all live in **one file**, `packages/atomic-sdk/src/primitives/sessions.ts`, and share a single `SessionPrimitiveDeps` DI struct. A UI server can re-use them verbatim; no business logic needs porting.
- Workflow state is already persisted to `~/.atomic/sessions/<runId>/status.json` via an **atomic write-then-rename** pattern in `packages/atomic-sdk/src/runtime/status-writer.ts`. Every `PanelStore` mutation triggers a debounced flush. **The on-disk file is already the canonical state for out-of-process consumers** (`atomic workflow status` reads it).
- The in-process `OrchestratorPanel` exposes a `subscribe(fn)` hook (`packages/atomic-sdk/src/components/orchestrator-panel.tsx:256`) — adding more listeners is the designed extension point. There's no broadcast/RPC infrastructure today, only one disk writer and one React subscription registered.
- **`vscode-jsonrpc` is _not_ a direct dependency** of any atomic package. It exists transitively under `@github/copilot-sdk` but is never imported. The clean-room Bun-native implementation can avoid it without removing anything.
- The codebase already establishes a **house IPC style**: file-based markers under `~/.atomic/<bucket>/` plus `fs.watch()` with polling fallback (zero-CPU when idle, instant wake-up). There is **zero** TCP/Unix-socket/WebSocket/EventEmitter infrastructure in the SDK or CLI today — a clean slate for a new transport.

**Caveats the spec author must address:**

- `attachSession()` in `packages/atomic-sdk/src/primitives/sessions.ts:188` is a **blocking** `Bun.spawnSync` with `stdin/stdout: "inherit"`. It cannot be served from inside a JSON-RPC handler — it would freeze the event loop until the user detaches. The spec must either expose `attachSession` as a "spawn-a-helper" method (write a launcher, return its path / pid) or refuse to expose it.
- The orchestrator process **does not handle SIGTERM**, only SIGINT (`packages/atomic-sdk/src/runtime/executor.ts:2374-2375`). When `tmux kill-session` fires (the path that `stopSession` triggers), the process receives SIGHUP with default disposition and dies without writing a final `status.json`. A UI server living in that process would die with it; one living *outside* the orchestrator (e.g. in the parent CLI) would not.
- `getSessionStatus` and `getSessionTranscript` are **disk reads**, not live tmux queries — so they only reflect whatever the orchestrator last flushed. `listSessions` and `getSession` are **live tmux subprocess queries** with no in-process cache; concurrent JSON-RPC clients would each fork their own `tmux list-sessions` subprocess. A request-coalescing cache in front of the server is worth scoping in v1.
- The workflow panel today **assumes one viewer per run**: it owns `process.stdout` of the orchestrator pane. A UI server is not in conflict (it's a separate channel), but spec must be explicit that the server is a *parallel* read/control surface, not a replacement for the panel.

## Detailed Findings

### 1. Session lifecycle primitives — `packages/atomic-sdk/src/primitives/sessions.ts`

All ten primitives live in one file and share a single DI seam.

**Common DI struct** (`sessions.ts:68-81`):

```ts
export interface SessionPrimitiveDeps {
  isTmuxInstalled: () => boolean;
  listAllTmuxSessions: () => readonly TmuxSession[];
  killSession: (id: string) => void;
  attachSession: (id: string) => void;
  detachClients: (id: string) => void;
  nextWindow: (id: string) => void;
  previousWindow: (id: string) => void;
  selectWindow: (target: string) => void;     // target is `<session>:<index>`
  readSnapshot: typeof readSnapshot;
  sessionsBaseDir: string;                    // defaults to ~/.atomic/sessions
}
```

**The 10 primitives, by state source:**

| Primitive | sessions.ts line | State source | Sync/live | Returns |
|---|---|---|---|---|
| `listSessions(opts?)` | 142 | live tmux subprocess (`list-sessions -F …__ATOMIC_SESSION_FIELD__…`) + per-session `show-environment` for unparsed agents | sync subprocess | `SessionInfo[]` |
| `getSession(id)` | 157 | same `listAllTmuxSessions()` call as above, then `.find(s => s.name === id)` | sync subprocess | `SessionInfo \| undefined` |
| `getSessionStatus(id)` | 285 | disk: `~/.atomic/sessions/<runId>/status.json` (no tmux query) | async file read | `WorkflowStatusSnapshot \| null` |
| `getSessionTranscript(id, sessionName)` | 303 | disk: `~/.atomic/sessions/<runId>/<sessionName>/messages.json` (no tmux query) | async file read | `SavedMessage[]` (never `null`) |
| `stopSession(id)` | 170 | runs `tmux kill-session -t <id>` via `Bun.spawnSync`; swallows errors twice | sync subprocess inside async wrapper | `void` |
| `attachSession(id)` | 188 | runs `tmux attach-session -t <id>` via `Bun.spawnSync` with `stdin/stdout: "inherit"` — **blocks the calling process until the user detaches** | sync subprocess inside async wrapper | `void` (throws `MissingDependencyError` if no tmux) |
| `detachSession(id)` | 266 | runs `tmux detach-client -s <id>`; never rejects (two nested `catch {}`) | sync subprocess inside async wrapper | `void` |
| `nextWindow(id)` | 222 | `ensureSession(id)` (full `list-sessions` query) → `tmux next-window -t <id>`; throws on missing tmux/missing id | sync subprocess inside async wrapper | `void` |
| `previousWindow(id)` | 234 | symmetrical — `tmux previous-window` | sync subprocess inside async wrapper | `void` |
| `gotoOrchestrator(id)` | 250 | `ensureSession(id)` → `tmux select-window -t ${id}:0` | sync subprocess inside async wrapper | `void` |

**Export membership** — relevant for what the UI server can re-export to clients:

| Primitive | `src/index.ts` (root) | `src/workflows/index.ts` |
|---|---|---|
| `listSessions` | line 97 | line 104 |
| `getSession` | line 98 | line 105 |
| `stopSession` | line 99 | line 106 |
| `attachSession` | line 100 | line 107 |
| `getSessionStatus` | line 105 | line 108 |
| `getSessionTranscript` | line 106 | line 109 |
| `detachSession` | line 101 | **not exported** |
| `nextWindow` | line 102 | **not exported** |
| `previousWindow` | line 103 | **not exported** |
| `gotoOrchestrator` | line 104 | **not exported** |

The workflows-barrel comment at `workflows/index.ts:8-10` states explicitly: "Tmux helpers and other runtime utilities are intentionally NOT re-exported — they are private to the SDK and the atomic CLI."

**Behavioral notes for the spec:**

- `listSessions` / `getSession` / `nextWindow` / `previousWindow` / `gotoOrchestrator` each fork at least one `Bun.spawnSync` per call. **No in-process cache.** Concurrent RPC clients will each fork independently. A request-coalescing layer (e.g. 100ms debounce) is the obvious cache shape.
- `getSessionStatus` / `getSessionTranscript` are disk-only — cheap, idempotent, safe to call concurrently. They reflect whatever the orchestrator last flushed.
- `stopSession` and `detachSession` swallow all errors. Idempotent and safe.
- `attachSession` cannot be served from a JSON-RPC handler — it blocks. Options: (a) refuse to expose, (b) expose a derivative method that returns the `tmux attach-session -t <id>` argv as a string for the client to invoke locally, (c) spawn a detached helper process.

### 2. `status-writer.ts` — atomic snapshot, not event stream — `packages/atomic-sdk/src/runtime/status-writer.ts`

**Important framing correction:** the file does not write a stream of `StatusEvent`s. There is no discriminated union of events. It writes a **single `WorkflowStatusSnapshot` JSON document**, completely rewritten on every change, via atomic write-then-rename.

**Public API:**

| Export | Line | Signature |
|---|---|---|
| `STATUS_FILE_NAME` (`"status.json"`) | 15 | constant |
| `WorkflowOverallStatus` | 18-22 | `"in_progress" \| "error" \| "completed" \| "needs_review"` |
| `WorkflowStatusSession` | 25-32 | per-stage record |
| `WorkflowStatusSnapshot` | 38-54 | the persisted document |
| `StatusWriterInputs` | 60-69 | input to `buildSnapshot` |
| `deriveOverallStatus(input)` | 84-96 | computes `overall` from sessions list |
| `buildSnapshot(input, now?)` | 99-127 | pure builder |
| `statusFilePath(sessionDir)` | 130-132 | `join(sessionDir, "status.json")` |
| `writeSnapshot(sessionDir, snapshot)` | 140-153 | atomic write-then-rename |
| `readSnapshot(sessionDir)` | 160-172 | read + JSON.parse + isSnapshot guard |
| `workflowRunIdFromTmuxName(name)` | 193-201 | parses 8-hex suffix from `atomic-wf-<agent>-<name>-<id>` |

**Snapshot shape** (`status-writer.ts:38-54`):

```ts
export interface WorkflowStatusSnapshot {
  schemaVersion: 1;
  workflowRunId: string;
  tmuxSession: string;
  workflowName: string;
  agent: string;
  prompt: string;
  overall: WorkflowOverallStatus;
  completionReached: boolean;
  fatalError: string | null;
  updatedAt: string;        // ISO-8601
  sessions: WorkflowStatusSession[];
}
```

**Per-session shape** (`status-writer.ts:25-32`):

```ts
export interface WorkflowStatusSession {
  name: string;
  status: SessionStatus;    // 7-variant union from components/orchestrator-panel-types.ts:3
  parents: string[];
  error?: string;
  startedAt: number | null;
  endedAt: number | null;
}
```

`SessionStatus` union (`packages/atomic-sdk/src/components/orchestrator-panel-types.ts:3`):
`"pending" | "running" | "complete" | "error" | "awaiting_input" | "offloaded" | "resuming"`.

**On-disk format:**

- Path: `~/.atomic/sessions/<workflowRunId>/status.json`.
- `JSON.stringify(snapshot, null, 2)` — pretty-printed, fully rewritten on every update. **Not append-only JSONL.**
- Atomicity (`status-writer.ts:144-149`): write to `status.json.tmp-<pid>`, then `rename(2)` to `status.json`. POSIX rename is atomic on the same filesystem; readers see either the prior full snapshot or the new one, never partial JSON. **No `fsync`.** Errors are silently swallowed.

**Writers — exactly two callsites in production code, both in `executor.ts`:**

1. **Debounced subscription callback** (`packages/atomic-sdk/src/runtime/executor.ts:2330-2348`):
   ```ts
   let snapshotPending = false;
   const persistSnapshot = (): void => {
     if (snapshotPending) return;
     snapshotPending = true;
     queueMicrotask(() => {
       snapshotPending = false;
       const snap = panel.getSnapshot();
       void writeSnapshot(sessionsBaseDir, buildSnapshot({
         workflowRunId, tmuxSession: tmuxSessionName, ...snap,
       }));
     });
   };
   const unsubscribePanel = panel.subscribe(persistSnapshot);
   persistSnapshot();        // seed the file before any stage
   ```
   Triggered on every `PanelStore` mutation (stage start/end/error/HIL/completion). The `queueMicrotask` debounce collapses bursts into one write per event-loop turn.

2. **Final shutdown write** (`executor.ts:2357-2364`):
   ```ts
   void writeSnapshot(sessionsBaseDir, buildSnapshot({
     workflowRunId, tmuxSession: tmuxSessionName, ...panel.getSnapshot(),
   }));
   ```
   Called from `shutdown(exitCode)` after `unsubscribePanel()`. Runs on clean exit *and* SIGINT-triggered exit, but **not on SIGHUP** (which is what `tmux kill-session` ultimately delivers).

**Readers — three production callsites:**

1. `readSnapshot` itself (`status-writer.ts:160-172`). One-shot disk read, no watcher.
2. `packages/atomic/src/commands/cli/workflow-status.ts:84-131` — used by `atomic workflow status`. One-shot read on user/agent invocation.
3. `packages/atomic-sdk/src/primitives/sessions.ts:285-291` — used by `getSessionStatus`. One-shot read on each call.

**No file watchers exist on `status.json`.** All readers poll/read on demand.

**Lifecycle:** Created at orchestrator start (the `persistSnapshot()` seed call before any stage). Rewritten on every panel mutation and on shutdown. **Never deleted** — `~/.atomic/sessions/<runId>/` accumulates indefinitely. There is no reaper or TTL.

### 3. On-disk layout under `~/.atomic/`

The runtime touches **far more** than `sessions/` and `workflows/`. Full tree:

```
~/.atomic/
├── sessions/
│   ├── <runId>/                                 # 8-hex from crypto.randomUUID().slice(0,8)
│   │   ├── status.json                          # WorkflowStatusSnapshot (atomic rename-write)
│   │   ├── metadata.json                        # workflow-level: name, agent, prompt, cwd, startedAt
│   │   ├── orchestrator.sh|.ps1                 # launcher script written by executor.ts:780
│   │   ├── orchestrator.log                     # stderr of orchestrator process
│   │   ├── telemetry.jsonl                      # appended events (mode 0o600)
│   │   └── <stageName>-<stageSessionId>/        # per-stage subdir
│   │       ├── metadata.json                    # stage: name, description, agent, paneId, startedAt
│   │       ├── messages.json                    # SavedMessage[] from s.save()
│   │       ├── inbox.md                         # rendered messages for human review
│   │       └── error.txt                        # only if stage failed
│   └── chat/
│       └── atomic-chat-<agent>-<chatId>.sh|.ps1 # chat-mode launcher (deleted post-attach)
├── workflows/
│   └── <name>/
│       └── index.ts                             # atomic-managed Mode 1 workflow definition
├── tmp/
│   └── <prefix>-<id><ext>                       # ephemeral temp via atomic-temp.ts
├── runtime/
│   └── <SDK_VERSION>/
│       └── tmux.conf                            # materialized from bunfs (compiled binary)
├── bin/                                         # Windows-only psmux/pmux install
├── claude-stop/<session_id>                     # turn-completion marker
├── claude-queue/<session_id>                    # next-prompt queue file
├── claude-release/<session_id>                  # session-end signal
├── claude-hil/<session_id>                      # human-in-loop marker
├── claude-pid/<session_id>                      # workflow PID for liveness detection
├── claude-ready/<session_id>                    # session-ready signal
├── claude-inflight/
│   ├── <root_session_id>/<agent_id>             # subagent lifecycle marker
│   └── .session-roots/<session_id>              # nested-subagent → root mapping
├── settings.json                                # global registry + provider config
└── .synced-version                              # installer marker
```

**Two paths matter most to the UI server:**

1. **`~/.atomic/sessions/<runId>/status.json`** — the only out-of-process state channel that's already designed for cross-process reading. The UI server should fan it out over the wire.
2. **`~/.atomic/sessions/<runId>/<stageName>-<stageSessionId>/messages.json`** — per-stage transcripts; also designed for cross-process reading via `getSessionTranscript`.

**Observation:** `runId` resolution is one-way — given a tmux session name `atomic-wf-<agent>-<workflowName>-<runId>`, you can extract the 8-hex `runId` via `workflowRunIdFromTmuxName` (`status-writer.ts:193-201`). Going the other direction (runId → tmux session name) requires a `list-sessions` query. The UI server should standardize on **tmux session name** as the addressable identifier in JSON-RPC method params, since that's what the SDK primitives accept.

### 4. `runtime/orchestrator-entry.ts` — thin dispatcher; real state lives in `executor.ts`

`orchestrator-entry.ts` itself is stateless. It validates argv, dynamically imports the workflow source, and calls `runOrchestrator()` in `executor.ts`.

**Argv contract** (built at `executor.ts:757-761`):

```
<binary> _orchestrator-entry <workflowName> <agent> <inputsB64> <workflowSource>
```

**Required env vars** (validated by `executor-env.ts:17-45`):

| Env var | Purpose |
|---|---|
| `ATOMIC_WF_ID` | 8-hex `workflowRunId` |
| `ATOMIC_WF_TMUX` | tmux session name (`atomic-wf-<agent>-<name>-<id>`) |
| `ATOMIC_WF_AGENT` | `claude` \| `copilot` \| `opencode` |
| `ATOMIC_WF_CWD` | project root |

**The full run state** lives in `SharedRunnerState` (`executor.ts:1482-1520`):

```ts
interface SharedRunnerState {
  tmuxSessionName: string;
  sessionsBaseDir: string;          // ~/.atomic/sessions/<workflowRunId>
  projectRoot: string;
  agent: AgentType;
  inputs: Record<string, string | number>;
  providerOverrides: ProviderOverrides;
  extraChatFlags: string[];
  panel: OrchestratorPanel;
  activeRegistry: Map<string, ActiveSession>;
  completedRegistry: Map<string, SessionResult>;
  failedRegistry: Set<string>;
  offloadManager: OffloadManager;
  workflowRunId: string;
}
```

**Lifecycle of `runOrchestrator()`** (`executor.ts:2290-2498`):

1. `validateOrchestratorEnv()` reads the four `ATOMIC_WF_*` vars.
2. Sets production telemetry sink, `process.chdir(cwd)`.
3. Reads `~/.atomic/settings.json` + project `.atomic/settings.json` for provider overrides.
4. `OrchestratorPanel.create(...)` initializes OpenTUI and the React tree.
5. `panel.subscribe(persistSnapshot)` + immediate seed write.
6. Wires SIGINT → `shutdown(1)` (`executor.ts:2374-2375`). **Does not wire SIGTERM** — comment at line 2372 says "SIGTERM and other signals are handled by OpenTUI's exitSignals."
7. Builds `OffloadManager`, `SharedRunnerState`, `WorkflowContext`.
8. Writes `~/.atomic/sessions/<workflowRunId>/metadata.json`.
9. **`await Promise.race([definition.run(workflowCtx), abortPromise])`** — main blocking await.
10. On normal completion: `panel.showCompletion(...)` → `await panel.waitForExit()` → `shutdown(0)`.
11. On `WorkflowAbortError`: `shutdown(0)`.
12. On other error: `panel.showFatalError(message)` → `await panel.waitForExit()` → `shutdown(1)`.

**Control hooks already wired:**

- **SIGINT** → `shutdown(1)` (writes final `status.json`, kills tmux session).
- **Keyboard `q` inside OpenTUI** → `panel.waitForAbort()` resolves → `WorkflowAbortError` thrown.
- **No SIGTERM handler.** SIGTERM hits OpenTUI's default handler, which terminates without atomic's cleanup.
- **No control file/socket/FIFO/sentinel.** No mechanism for an external process to ask "stop", "next-pane", "go-to-orchestrator-pane" via IPC. All control flows through signals or the keyboard.

**Stop mechanics:** `stopSession(id)` → `tmux kill-session -t <id>`. tmux kills the orchestrator pane → orchestrator process receives **SIGHUP**. There is no SIGHUP handler; the process dies with default disposition. **`shutdown()` is not called in this path**, so the final `status.json` write is skipped. The status snapshot will reflect the last debounced flush (which may or may not include "completed" — likely "in_progress" forever for an externally-killed run).

**Status writes are tied to panel mutations.** Every `PanelStore` mutation triggers `persistSnapshot`. Mutations include `addSession`, `backgroundTaskStarted/Finished`, `sessionSuccess`, `sessionError`, `sessionAwaitingInput`, `sessionResumed`, `showCompletion`, `showFatalError`. See list at `executor.ts:1936-1953`.

### 5. The workflow panel — `packages/atomic-sdk/src/components/`

**Library:** OpenTUI exclusively. `@opentui/core` (`createCliRenderer`, `KeyEvent`, `ScrollBoxRenderable`, `TextareaRenderable`) + `@opentui/react` (`createRoot`, `useKeyboard`, `useTerminalDimensions`, `useRenderer`). Confirmed by `workflow-picker-panel.tsx:1` JSX pragma and `orchestrator-panel.tsx:7-8` imports.

**Two top-level panel classes (different lifecycles):**

- `OrchestratorPanel` (`orchestrator-panel.tsx`) — live workflow view that runs inside the orchestrator pane during workflow execution.
- `WorkflowPickerPanel` (`workflow-picker-panel.tsx`) — pre-run picker, blocks the CLI until the user confirms or cancels.
- A third path, the **attached footer** (`tui/attached-statusline.tsx`), uses React purely as a JSX→tmux-format-string compiler — it sets `@atomic-*` tmux user-options once and exits. No live renderer.

**Component tree (orchestrator panel):**

```
OrchestratorPanel
└── createRoot(renderer).render(
      StoreContext.Provider(PanelStore)
        ThemeContext.Provider(GraphTheme)
          TmuxSessionContext.Provider(string)
            OffloadManagerContext.Provider(OffloadManager | null)
              ErrorBoundary
                SessionGraphPanel
                  ├── Header (CountBadge × N)
                  ├── <scrollbox> (Edge × N + NodeCard × N)
                  ├── CompactSwitcher? (when "/" pressed)
                  └── ToastStack (ToastCard × N)
    )
```

**State source — `PanelStore`** (`orchestrator-panel-store.ts:20`):

```ts
class PanelStore {
  version = 0;
  workflowName = "";
  agent = "";
  prompt = "";
  sessions: SessionData[] = [];                                          // <— main state
  completionInfo: { workflowName: string; transcriptsPath: string } | null = null;
  fatalError: string | null = null;
  completionReached = false;
  exitResolve: (() => void) | null = null;
  abortResolve: (() => void) | null = null;
  backgroundTaskCount = 0;
  viewMode: ViewMode = "graph";        // "graph" | "attached" | "resuming"
  activeAgentId = "";
  toasts: ToastEntry[] = [];
  private listeners = new Set<Listener>();
}
```

The store is **the only data source the panel consumes**. It does not call `listSessions()`, `getSessionStatus()`, or watch any file. The executor mutates the store directly via imperative methods (`panel.sessionStart(name)`, `panel.sessionSuccess(name)`, `panel.sessionError(name, msg)`, …); each mutation calls `this.emit()` which increments `version` and notifies all listeners.

**Re-render triggers:**

| Trigger | Source |
|---|---|
| `PanelStore.emit()` → `useSyncExternalStore` | every imperative mutation method |
| 60ms `setInterval` pulse animation | `session-graph-panel.tsx:128-135` (only when any session is `running`/`awaiting_input`) |
| 500ms `setInterval` tmux poll for `viewMode` | `session-graph-panel.tsx:397-455` (`tmux display-message -t <session> -p '#{window_index} #{window_name}'`) |
| `setTimeout` toast auto-dismiss | `orchestrator-panel-store.ts:189-196` |
| `OrchestratorPanel.attachOffloadManager()` | `orchestrator-panel.tsx:276-279` (one-time) |

**Single-attach assumption — confirmed.** `createCliRenderer` (`orchestrator-panel.tsx:108-111`) yields a single renderer tied to `process.stdout`/`process.stdin` of the orchestrator pane. tmux multiplexes the PTY to multiple viewers, but the React renderer and `PanelStore` know nothing about additional clients. **One `PanelStore`, one render loop.**

**Critical extension point for the UI server** — `OrchestratorPanel.subscribe(fn)` (`orchestrator-panel.tsx:256`):

> The store's `listeners` `Set` already supports multiple subscribers. Today only two consumers register: the React `useSyncExternalStore` subscription and the `persistSnapshot` disk writer. **The `subscribe()` method is the designed extension point for additional state consumers.** A UI server living in the orchestrator process can attach a third subscriber that fans out to N JSON-RPC clients with zero changes to the store.

### 6. CLI plumbing — `atomic workflow`

**Entry:** `packages/atomic/src/cli.ts` (`#!/usr/bin/env bun` + `Command` from `@commander-js/extra-typings`).

**Top-level program** at `cli.ts:46` (`createProgram()`), parsed at `cli.ts:613` (`program.parseAsync()`).

**`workflow` subcommand** built by `buildWorkflowCommand()` in `packages/atomic/src/commands/cli/workflow.ts:313-432`. Singleton exported at `workflow.ts:434`:
```ts
export const workflowCommand = buildWorkflowCommand(createBuiltinRegistry(), true);
```
Mounted via `program.addCommand(workflowCommand)` at `cli.ts:172`. `enablePositionalOptions()` is called at both `cli.ts:151` and `workflow.ts:321`.

**Existing flags on `atomic workflow` (the dispatcher):**

| Flag | Registration | Notes |
|---|---|---|
| `-n, --name <name>` | `workflow.ts:323` | validator checks live registry |
| `-a, --agent <agent>` | `workflow.ts:341` | `isValidAgent` |
| `--<input> <value>` (dynamic) | `workflow.ts:359` via `applyDynamicOptions()` (`workflow.ts:109-115`) | per-workflow inputs |
| `-d, --detach` | `workflow.ts:361` | boolean |
| `[prompt...]` positional | `workflow.ts:363` | variadic; collapses to `inputs.prompt` |

**`RESERVED_LONG_FLAGS`** (`workflow.ts:87-93`):
```ts
const RESERVED_LONG_FLAGS = new Set([
  "--name", "--agent", "--detach", "--help", "--version",
]);
```
Protected from stripping during `resyncDynamicOptions` for custom-workflow reloads.

**Subcommands of `atomic workflow`:**

| Subcommand | cli.ts registration | Implementation |
|---|---|---|
| `list [-a]` | 177-189 | `workflow-list.ts:175` |
| `inputs <name> -a [...]` | 193-210 | `workflow-inputs.ts:219` |
| `refresh` | 214-231 | `workflow-refresh.ts:300` |
| `read --sessionId <id>` | 233-257 | `workflow-read.ts:304` |
| `status [<session_id>]` | 259-278 | `workflow-status.ts:144` |
| `session <list|connect|kill>` | 281 | `management-commands.ts:23` |

**Flag → `runWorkflow` trace (e.g. `atomic workflow -n ralph -a claude -d`):**

1. argv → Commander → `workflowCommand` matches → option parsers fire.
2. `.action()` (`workflow.ts:368`) reads `this.opts()`:
   ```ts
   const name = options["name"] as string | undefined;
   const agent = options["agent"] as AgentType | undefined;
   const detach = options["detach"] === true;
   ```
3. Iterates `buildInputUnion(listWorkflows(effectiveRegistry))` to extract `--<input>` flags into `cliInputs`.
4. `resolveWorkflow(effectiveRegistry, name, agent)` (`workflow.ts:419`).
5. `await dispatch(workflow, cliInputs, detach)` (`workflow.ts:428`).
6. `dispatch()` (`workflow.ts:260-280`) calls `runWorkflow({ workflow, inputs: cliInputs, detach })` (`workflow.ts:275-279`).
7. `runWorkflow` (`packages/atomic-sdk/src/primitives/run.ts:82-105`) validates and calls `executeWorkflow({...})` (`run.ts:92-104`).
8. `executeWorkflow` (`executor.ts:659-828`) destructures `detach` and `pathToAtomicExecutable` at `executor.ts:668`, calls `resolveDispatcher` at `executor.ts:674`, writes the launcher script at `executor.ts:780`, calls `tmux.createSession(...)` at `executor.ts:791`.

**Slot for `--ui-server`:** the parallel of `pathToAtomicExecutable` is the right pattern. New flag would slot in at:

| File | Where | What |
|---|---|---|
| `workflow.ts:362` | new `cmd.option("--ui-server [address]", "...")` | Registration adjacent to `--detach` |
| `workflow.ts:87-93` | add `"--ui-server"` to `RESERVED_LONG_FLAGS` | Prevent strip during dynamic-input refresh |
| `workflow.ts:374` | extract `const uiServer = options["uiServer"] as string \| boolean \| undefined` | Action handler |
| `workflow.ts:260-280` | new `uiServer` parameter on `dispatch()` | Forward through |
| `workflow.ts:275-279` | add `uiServer` to the `runWorkflow({...})` option bag | Hand to SDK |
| `packages/atomic-sdk/src/primitives/run.ts` (around line 54) | new `uiServer?: string \| boolean` on `RunWorkflowOptions` | SDK-level option |
| `executor.ts:668` and downstream | destructure and forward | Reach the orchestrator pane |

`atomic chat` (`packages/atomic/src/commands/cli/chat/index.ts`) is architecturally distinct — it uses `.allowUnknownOption()` + `.passThroughOptions()` and calls `createSession` directly at `chat/index.ts:379`, bypassing `runWorkflow`. Adding `--ui-server` to `chat` would need to be intercepted *before* the passthrough.

### 7. Existing IPC / RPC machinery — file-watch is the house style

**Dominant pattern: file-based markers + `fs.watch()` with polling fallback.**

| Marker dir | Writer | Reader | Purpose |
|---|---|---|---|
| `~/.atomic/claude-stop/<session_id>` | `claude-stop-hook.ts:281` (`Bun.write`) | `claude.ts:378-390` (`fs.watch` + poll) | Turn completion |
| `~/.atomic/claude-queue/<session_id>` | runtime via `enqueuePrompt()` | `claude-stop-hook.ts:309-330` (poll `existsSync` + `fs.readFile`) | Next-prompt queue |
| `~/.atomic/claude-release/<session_id>` | runtime on teardown | `claude-stop-hook.ts:332-344` (poll) | Session-end signal |
| `~/.atomic/claude-pid/<session_id>` | `setupClaudeSession` (`writeFile`) | `claude-stop-hook.ts:86-90` (`process.kill(pid, 0)` liveness) | Workflow PID |
| `~/.atomic/claude-ready/<session_id>` | `claude-session-start-hook` | `claude.ts:178-231` (`fs.watch`) | Session-ready signal |
| `~/.atomic/claude-hil/<session_id>` | `claude-ask-hook` | `watchHILMarker()` (watch create/unlink) | HIL request |
| `~/.atomic/claude-inflight/<root>/<agent>` | `claude-inflight-hook.ts:218` (`Bun.write`) | `waitForInflightDrained()` (readdir) | Subagent lifecycle |

**`fs.watch()` callsites** (Bun-native, no chokidar):
- `claude.ts:378-390` — watch `claude-stop/`, `claude-queue/`
- `claude.ts:414-425` — watch `claude-ready/`
- `claude-stop-hook.ts:378-391` — dual watchers on queue + release dirs

**HTTP server callsite** (the *only* server in the codebase): `rest-api/src/server.ts:27` — `Bun.serve({ port, routes: {...} })`. **Unrelated to agent IPC** — it's a CRUD REST API for items.

**What does _not_ exist:**

- No `Bun.listen()` (TCP/Unix sockets) anywhere. Only test code in `port-discovery.test.ts` uses `net.createServer()` for port-discovery testing.
- No WebSocket use anywhere (`new WebSocket`, `WebSocketServer`, `ws` library).
- No `EventEmitter` / `EventTarget` IPC bus (one comment-level reference in `workflow.ts`, no usage).
- No Node child-process IPC channel (`process.send` / `process.on('message')`).
- No third-party IPC libs (`node-ipc`, `posix-mq`, `zeromq`).

### 8. RPC dependency audit — `vscode-jsonrpc` is _not_ a direct dependency

**Direct deps:** zero. None of `packages/atomic/package.json`, `packages/atomic-sdk/package.json`, `packages/create-atomic-sdk/package.json`, root `package.json`, or any `examples/*/package.json` declares `vscode-jsonrpc`.

**Transitive presence:** `vscode-jsonrpc@8.2.1` is pulled in via `@github/copilot-sdk@0.3.0` (declared as a direct dep in both `packages/atomic-sdk/package.json` and `packages/atomic/package.json`).

**Imports in source:** `rg "import.*vscode-jsonrpc"` returns **zero hits** across the monorepo.

**Other RPC libraries searched (none present, direct or transitive):** `vscode-languageserver-protocol`, `jayson`, `json-rpc-2.0`, `json-rpc-engine`, `ws`, `socket.io`, `socket.io-client`, `engine.io`, `@grpc/*`, `grpc-js`, `msgpack`, `msgpackr`, `protobufjs`, `openrpc`, `@trpc/*`, `nice-grpc`.

**Conclusion:** the clean-room Bun-native UI server can ship with **zero new RPC-library dependencies**. It can use Bun's built-in `Bun.serve` (HTTP + WebSocket) and `Bun.listen` (TCP / Unix sockets). The codebase has zero RPC infrastructure to compete with or extend.

## Code References

### Session lifecycle primitives
- `packages/atomic-sdk/src/primitives/sessions.ts:68-95` — `SessionPrimitiveDeps` and `defaultDeps`
- `packages/atomic-sdk/src/primitives/sessions.ts:142-156` — `listSessions`
- `packages/atomic-sdk/src/primitives/sessions.ts:157-168` — `getSession`
- `packages/atomic-sdk/src/primitives/sessions.ts:170-181` — `stopSession`
- `packages/atomic-sdk/src/primitives/sessions.ts:188-200` — `attachSession` (blocking)
- `packages/atomic-sdk/src/primitives/sessions.ts:202-210` — `ensureSession` guard
- `packages/atomic-sdk/src/primitives/sessions.ts:222-232` — `nextWindow`
- `packages/atomic-sdk/src/primitives/sessions.ts:234-244` — `previousWindow`
- `packages/atomic-sdk/src/primitives/sessions.ts:250-264` — `gotoOrchestrator`
- `packages/atomic-sdk/src/primitives/sessions.ts:266-273` — `detachSession`
- `packages/atomic-sdk/src/primitives/sessions.ts:285-292` — `getSessionStatus`
- `packages/atomic-sdk/src/primitives/sessions.ts:303-335` — `getSessionTranscript`

### Status writer
- `packages/atomic-sdk/src/runtime/status-writer.ts:15` — `STATUS_FILE_NAME` constant
- `packages/atomic-sdk/src/runtime/status-writer.ts:18-22` — `WorkflowOverallStatus` union
- `packages/atomic-sdk/src/runtime/status-writer.ts:25-32` — `WorkflowStatusSession`
- `packages/atomic-sdk/src/runtime/status-writer.ts:38-54` — `WorkflowStatusSnapshot`
- `packages/atomic-sdk/src/runtime/status-writer.ts:99-127` — `buildSnapshot`
- `packages/atomic-sdk/src/runtime/status-writer.ts:140-153` — `writeSnapshot` (atomic rename)
- `packages/atomic-sdk/src/runtime/status-writer.ts:160-172` — `readSnapshot`
- `packages/atomic-sdk/src/runtime/status-writer.ts:193-201` — `workflowRunIdFromTmuxName`

### Orchestrator + executor
- `packages/atomic-sdk/src/runtime/orchestrator-entry.ts:125-131` — `runOrchestratorWithDefinition`
- `packages/atomic-sdk/src/runtime/orchestrator-entry.ts:167-194` — `runOrchestratorEntry`
- `packages/atomic-sdk/src/runtime/executor.ts:659-828` — `executeWorkflow` (parent process)
- `packages/atomic-sdk/src/runtime/executor.ts:1482-1520` — `SharedRunnerState`
- `packages/atomic-sdk/src/runtime/executor.ts:2290-2498` — `runOrchestrator` (orchestrator process)
- `packages/atomic-sdk/src/runtime/executor.ts:2330-2348` — `persistSnapshot` debounced subscription
- `packages/atomic-sdk/src/runtime/executor.ts:2352-2370` — `shutdown` closure
- `packages/atomic-sdk/src/runtime/executor.ts:2374-2375` — SIGINT handler (no SIGTERM)

### Panel
- `packages/atomic-sdk/src/components/orchestrator-panel.tsx:108-111` — `createCliRenderer` (single renderer)
- `packages/atomic-sdk/src/components/orchestrator-panel.tsx:256-258` — `subscribe()` extension point
- `packages/atomic-sdk/src/components/orchestrator-panel-store.ts:20-50` — `PanelStore`
- `packages/atomic-sdk/src/components/orchestrator-panel-store.ts:47-55` — `subscribe()` / `emit()`
- `packages/atomic-sdk/src/components/orchestrator-panel-types.ts:3` — `SessionStatus` union
- `packages/atomic-sdk/src/components/orchestrator-panel-types.ts:17-25` — `SessionData` interface
- `packages/atomic-sdk/src/components/session-graph-panel.tsx:128-135` — pulse animation interval
- `packages/atomic-sdk/src/components/session-graph-panel.tsx:397-455` — tmux poll for `viewMode`

### CLI plumbing
- `packages/atomic/src/cli.ts:26` — Commander import
- `packages/atomic/src/cli.ts:46-50` — `createProgram`
- `packages/atomic/src/cli.ts:172` — `program.addCommand(workflowCommand)`
- `packages/atomic/src/cli.ts:613` — `program.parseAsync()`
- `packages/atomic/src/commands/cli/workflow.ts:87-93` — `RESERVED_LONG_FLAGS`
- `packages/atomic/src/commands/cli/workflow.ts:260-280` — `dispatch()` (calls `runWorkflow`)
- `packages/atomic/src/commands/cli/workflow.ts:313-432` — `buildWorkflowCommand`
- `packages/atomic/src/commands/cli/workflow.ts:323-365` — flag registrations
- `packages/atomic-sdk/src/primitives/run.ts:25-55` — `RunWorkflowOptions`
- `packages/atomic-sdk/src/primitives/run.ts:82-105` — `runWorkflow`

### IPC patterns (file-based, the house style)
- `packages/atomic-sdk/src/providers/claude.ts:178-231` — `waitForClaudeReady` (`fs.watch`)
- `packages/atomic-sdk/src/providers/claude.ts:378-390` — watch `claude-stop/`, `claude-queue/`
- `packages/atomic-sdk/src/providers/claude-stop-hook.ts:281` — write turn-completion marker
- `packages/atomic-sdk/src/providers/claude-stop-hook.ts:309-330` — poll for queue file
- `packages/atomic-sdk/src/providers/claude-inflight-hook.ts:210-218` — write subagent markers

## Architecture Documentation

**The house IPC style:** file markers under `~/.atomic/<bucket>/`, written via `Bun.write()`, watched via `fs.watch()` with polling fallback. Zero CPU when idle; instant wake-up on activity. **Single HTTP server in the entire codebase** (`rest-api/src/server.ts`) — and it's an unrelated CRUD example, not the SDK or runtime.

**The state-fanout pattern that already works:** the executor wires `panel.subscribe(persistSnapshot)` (`executor.ts:2346`) to push every `PanelStore` mutation to disk via debounced `queueMicrotask`. Disk readers (`atomic workflow status`, `getSessionStatus`) consume the result on-demand. This is a one-writer / many-readers fan-out using the filesystem as a broadcast channel.

**The DI-seam pattern:** every primitive in `sessions.ts` accepts `deps: SessionPrimitiveDeps = defaultDeps` as the last parameter. Tests override per-call. **A UI server can use the same seam to inject mocks, intercept calls for tracing, or provide a coalescing cache.** No module-load surgery needed.

**The dispatcher resolution pattern** (`packages/atomic-sdk/src/lib/self-exec.ts:132-193`) — `resolveDispatcher` is the closest precedent in the codebase for a "decide-at-runtime-then-spawn" pattern. The UI server's optional binary-bundling story (`@bastani/atomic-${platform}-${arch}` resolution) would follow this same shape.

## Historical Context (from `research/`)

Most relevant prior research:

- `research/docs/2026-04-10-tmux-ux-implementation-guide.md` — `tmuxRun()` dispatcher in `runtime/tmux.ts`, socket isolation (`-L atomic`), config injection. **Directly relevant** — confirms the tmux-socket pattern the UI server will inherit.
- `research/docs/2026-03-25-workflow-interrupt-resume-bugs.md` — `finally` block destroys sessions prematurely during interrupt+resume. Relevant because a UI server's `stopSession` handler will face the same lifecycle ambiguity.
- `research/docs/2026-01-31-atomic-current-workflow-architecture.md` — overall workflow architecture (SDK layer, Session interface, EventEmitter pattern referenced but not present in current code, hook system).
- `specs/2026-05-08-workflow-pane-offload-and-resume.md` — pane offload mechanism. The UI server must coexist with offload state (the `offloaded` and `resuming` `SessionStatus` variants).
- `specs/2026-03-18-event-bus-callback-elimination-sdk-event-types.md` — historical event-bus design. **No event bus survived to the current code** — `PanelStore.subscribe()` is the only multi-listener seam.

**Prior research contains nothing about:** `--ui-server`, embedded server, headless attach, JSON-RPC, WebSocket, Bun.serve in the SDK or CLI. This is a clean slate.

## Open Questions for the spec author

1. **Process scope of the UI server.** Two options:
   - (a) **In-orchestrator**: spawn the server inside `runOrchestrator()` (`executor.ts:2290+`), attach it as a third subscriber to `panel.subscribe(...)`, tear down in `shutdown()`. Pro: zero polling, push-based events, identical state to the panel. Con: dies on SIGHUP from `tmux kill-session`; cannot serve a workflow whose orchestrator process is gone.
   - (b) **Out-of-process**: a separate Bun process spawned by the parent CLI (`executeWorkflow` at `executor.ts:659+`) that watches `~/.atomic/sessions/<runId>/status.json` via `fs.watch` and re-emits to clients. Pro: survives orchestrator death, can serve completed/historical runs. Con: latency of file-watch round-trip; needs its own lifecycle management.
2. **Identifier in JSON-RPC params.** Tmux session name (`atomic-wf-<agent>-<name>-<runId>`) vs. bare `runId`. The SDK primitives accept tmux session names; converting requires an extra `list-sessions` call. Recommend tmux session name.
3. **`attachSession` exposure.** Cannot run inside an RPC handler (blocks). Three options:
   - Refuse to expose.
   - Expose `getAttachCommand(id)` returning the argv string, let client invoke locally.
   - Expose `spawnAttachHelper(id)` that detaches a child process and returns its PID.
4. **Transport defaults.** Unix socket (`~/.atomic/sessions/<runId>/ui.sock`) is recommended for security and zero-port-collision. TCP only when `--ui-server=<port>` is given explicitly. Spec must define both code paths.
5. **Authn/authz for TCP mode.** Unix socket is filesystem-permission-scoped; TCP isn't. Token? Localhost-only bind? `Authorization` header? Spec needs a story.
6. **Wire protocol versioning.** Mirror the precedent at `sdk-protocol-version.json` from Copilot's runtime — single source of truth that clients can version-gate.
7. **Live event stream vs. pull-only.**
   - Pull-only v1: clients call `session/list`, `session/status`, `session/transcript` on demand.
   - Push v1.5: server emits `panel.update` notifications when `PanelStore` mutates (in-orchestrator scope only).
   - Push for out-of-process scope: server fans out from a `fs.watch(status.json)` loop.
8. **Backpressure / fairness when multiple clients connect to one run.** Each subscription holds a reference to the live `PanelStore` listeners set; teardown on disconnect is critical to avoid leaks.
9. **Behavior when `--ui-server` is passed but the workflow runs `--detach`.** Detached mode means the parent CLI returns immediately; the orchestrator continues in tmux. The UI server should outlive the parent CLI (ergo: in-orchestrator scope, or a separate background process).
10. **Behavior when the orchestrator pane is offloaded** (`offloaded` / `resuming` `SessionStatus`). The UI server should expose this state as it appears in the snapshot — clients render it without the server needing extra logic.

## Related Research

- `specs/2026-05-08-workflow-pane-offload-and-resume.md` — pane offload state machine
- `research/docs/2026-04-10-tmux-ux-implementation-guide.md` — tmux dispatcher implementation
- `research/docs/2026-03-25-workflow-interrupt-resume-bugs.md` — session lifecycle hazards
- `research/docs/2026-01-31-atomic-current-workflow-architecture.md` — pre-rewrite architecture context
