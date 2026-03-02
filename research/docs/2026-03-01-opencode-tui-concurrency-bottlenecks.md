---
date: 2026-03-01 19:53:49 UTC
researcher: Copilot (Claude Opus 4.6)
git_commit: 7debf4841f53cc01dbe3faa8bc4b00a9367bb7a6
branch: lavaman131/feature/workflow-sdk
repository: workflow-sdk
topic: "OpenCode TUI Concurrency Bottlenecks — Response Time Degradation During Parallel Agent SDK Execution"
tags: [research, opencode, tui, concurrency, sse, event-loop, ralph-workflow, bottleneck, streaming]
status: complete
last_updated: 2026-03-01
last_updated_by: Copilot (Claude Opus 4.6)
---

# Research: OpenCode TUI Concurrency Bottlenecks

## Research Question

Investigate OpenCode's TUI architecture for concurrency and I/O blocking issues that cause response times to degrade from seconds to indefinite when multiple agent SDKs (e.g., Claude Agent SDK, Copilot SDK) run in parallel. Specifically:
1. How does OpenCode's event loop / message handling work in its TUI layer?
2. Are there shared resources (stdin/stdout, process handles, event queues) that could cause contention when multiple agents run concurrently?
3. What does the first step of the Ralph workflow trigger in OpenCode, and how could it interact with background agent processes?
4. Reference the OpenCode source code at `~/Documents/projects/opencode` to document the relevant architecture and identify potential bottleneck points.

## Summary

The response time degradation from seconds to indefinite during parallel agent SDK execution traces to **six concrete bottleneck patterns** in the OpenCode client's SSE event loop and the workflow executor's blocking chain. The most critical issue is that the SSE `reader.read()` call in the SDK's generated client (`serverSentEvents.gen.js:52`) blocks indefinitely on dead connections, and the OpenCode client's watchdog abort signal at `opencode.ts:829` is **not propagated to the SDK's SSE reader** — only checked on the next event iteration. Additionally, when multiple sessions run against the same OpenCode server, **all events for all sessions flow through a single `for await` loop**, creating a shared bottleneck where high-volume background agent activity can starve the foreground agent's event processing.

The Ralph workflow's first step (planner) creates a deeply nested blocking chain from the executor's `for await` loop down through the TUI's `spawnSubagentParallel`, to the SDK's `session.stream()` async generator, which ultimately parks on the SSE event loop. If a background agent SDK process is consuming the SSE event loop's processing time or causing connection instability, the planner's response stream stalls.

## Detailed Findings

### Architecture Overview

**OpenCode is TypeScript/SolidJS, not Go/BubbleTea.** The TUI uses `@opentui/solid` (custom terminal renderer) with Bun as the runtime. It employs a two-process model:
- **Main thread**: SolidJS TUI rendering at 60fps
- **Worker thread**: Bun Worker running the OpenCode backend server (LLM, DB, subprocesses)

Communication between threads uses a custom JSON-RPC bridge (`util/rpc.ts`) via `postMessage`/`onmessage`, or optionally HTTP when `--port` is specified.

### Bottleneck Pattern A: SSE `reader.read()` Indefinite Block (Dead Connection)

**Location**: OpenCode SDK generated client — `serverSentEvents.gen.js:52` (in `node_modules/@opencode-ai/sdk`)

The SDK's SSE client uses `reader.read()` on a `ReadableStream` from `fetch()`. If the TCP connection silently dies (no RST/FIN — common with NAT timeouts, firewall drops, or process crashes), `reader.read()` hangs indefinitely until the OS TCP keepalive timeout fires (typically **2+ hours** on Linux defaults).

The OpenCode client's heartbeat watchdog (`opencode.ts:815-851`) sets `HEARTBEAT_TIMEOUT_MS = 15,000ms` and calls `watchdogAbort.abort()` when no events arrive for 15 seconds. However, this `watchdogAbort` controller is **local to `processEventStream()`** — it is **NOT passed to the SDK's SSE client**. The SDK only listens on its own `options.signal` from the original `event.subscribe()` call.

```
Watchdog fires → watchdogAbort.abort() → but reader.read() in SDK doesn't know
                                         → for await loop stuck at reader.read()
                                         → watchdog signal only checked at line 838
                                            on NEXT iteration (which never comes)
```

**Impact**: If the OpenCode server's SSE connection drops silently while a background agent is running, the event loop freezes. The foreground planner node is blocked in its `for await` chain waiting for events that will never arrive.

### Bottleneck Pattern B: Shared SSE Stream Across All Sessions

**Location**: `src/sdk/clients/opencode.ts:756-758`, event handler filtering throughout adapter code

The SSE `event.subscribe()` at line 756 subscribes to **all server events** scoped by directory, not by session. When multiple agents/sessions run simultaneously against the same OpenCode server:

1. All events for **all sessions** flow through the single `for await` loop at line 837
2. Each event is dispatched to **all** registered handlers via `emitEvent()` (line 1549)
3. Each handler filters by `event.sessionId` and returns early if the event belongs to a different session

When a background agent generates high-volume events (many tool calls, streaming text), those events still pass through the shared `for await` loop, `handleSdkEvent()`, and `emitEvent()` dispatch, consuming CPU time even though every handler immediately returns due to session ID filtering.

**Impact**: Background agent activity creates processing overhead that delays event handling for the foreground planner session. With enough background activity, this can cause the heartbeat watchdog to fire spuriously (Pattern A), leading to reconnections and state reconciliation overhead.

### Bottleneck Pattern C: Synchronous Handler Fanout in `emitEvent()`

**Location**: `src/sdk/clients/opencode.ts:1549-1571`

`emitEvent()` iterates all handlers **synchronously** within a `for` loop:

```typescript
for (const handler of handlers) {
  try {
    handler(event as AgentEvent<EventType>);
  } catch (error) {
    console.error(`Error in event handler for ${eventType}:`, error);
  }
}
```

All handlers execute synchronously within the `for await` iteration of `processEventStream()`. If any handler performs slow work (e.g., `EventBus.publish()` with Zod schema validation at `event-bus.ts:143-154`), it delays `resetWatchdog()` for subsequent events.

### Bottleneck Pattern D: `completionPromise` Indefinite Blocking in Adapter

**Location**: `src/events/adapters/opencode-adapter.ts:336-378`

The `OpenCodeStreamAdapter.startStreaming()` method creates a `completionPromise` that resolves when `session.idle` or `session.error` fires for the adapter's session ID:

```typescript
const completionPromise = new Promise<...>((resolve) => {
  const onIdle = client?.on("session.idle", (event) => {
    if (event.sessionId !== this.sessionId) return;
    resolve({ reason: event.data.reason ?? "idle" });
  });
  // ...
});
await session.sendAsync(message, ...);
const completion = await completionPromise;  // BLOCKS HERE
```

If the SSE event loop stalls (Pattern A), `session.idle` never arrives, and `startStreaming()` blocks indefinitely. The `abortController.signal` listener at line 361 provides an escape hatch, but only if the caller externally aborts.

### Bottleneck Pattern E: Deep Blocking Chain in Ralph Planner Step

**Location**: Multiple files — the complete blocking chain for the planner step:

```
executor.ts:455     → for await (const step of streamGraph(...))
  compiled.ts:655   → await node.execute(context)
    nodes.ts:1707   → await spawnSubagent({...})
      executor.ts:260 → await spawnFn([...], abortSignal)
        chat.tsx:4749 → await Promise.allSettled(agents.map(spawnOne))
          chat.tsx:4659 → await createSubagentSession(sessionConfig)
            chat.tsx:4710 → await adapter.consumeStream(stream, ...)
              subagent-adapter.ts:150 → for await (const chunk of stream)
                // INNERMOST: blocked on SDK AsyncIterable<AgentMessage>
```

The entire chain is synchronous/serial for the planner: one agent, one session, one stream. The executor's `for await` loop does not yield the next step until the planner's SDK stream completes at the innermost level. Any stall at any level propagates up to freeze the entire workflow.

### Bottleneck Pattern F: `stream()` Generator Infinite Poll Without Overall Timeout

**Location**: `src/sdk/clients/opencode.ts:2148-2152`

The `stream()` async generator parks for 25ms (STREAM_POLL_MS) between checks:

```typescript
await new Promise<void>((resolve) => {
  resolveNext = resolve;
  setTimeout(resolve, STREAM_POLL_MS);  // 25ms
});
```

If the SSE event loop is stalled (Pattern A), no `session.idle` event arrives, and the generator spin-polls every 25ms **indefinitely** — there is no overall timeout. The 500ms settle window (`PRE_PROMPT_TERMINAL_SETTLE_MS`) only applies after `session.idle` is received, not before.

### OpenCode Source Architecture (Reference)

#### Event Flow: Backend → TUI

```
OpenCode Server (SSE endpoint, heartbeat every 10s)
    │
    ▼
SDK createSseClient (fetch → reader.read() loop)
    │ yields parsed JSON events
    ▼
processEventStream() — for await loop (opencode.ts:837)
    │ resets watchdog timer, calls handleSdkEvent()
    ▼
handleSdkEvent() (opencode.ts:968) — switches on event.type
    ▼
emitEvent() (opencode.ts:1549) — synchronous fanout to Set<EventHandler>
    ├──► stream() handlers → deltaQueue → async generator → consumer
    └──► OpenCodeStreamAdapter handlers → EventBus.publish() → UI
```

#### Key Constants

| Constant | Value | File | Purpose |
|---|---|---|---|
| `HEARTBEAT_TIMEOUT_MS` | 15,000ms | `opencode.ts:815` | Watchdog timeout |
| `SSE_RECONNECT_DELAY_MS` | 250ms | `opencode.ts:751` | Reconnect delay |
| `PRE_PROMPT_TERMINAL_SETTLE_MS` | 500ms | `opencode.ts:116` | Post-idle drain window |
| `STREAM_POLL_MS` | 25ms | `opencode.ts:117` | Generator poll interval |
| `sseMaxRetryDelay` | 30,000ms | SDK generated | Max SSE backoff |
| `targetFps` | 60 | OpenCode `app.tsx:184` | TUI render target |
| Event batch window | 16ms | OpenCode `sdk.tsx:57` | Event coalescing |
| SSE heartbeat | 10,000ms | OpenCode `server.ts:539` | Server heartbeat |

#### Two-Process Model

OpenCode's TUI uses a **Bun Worker** for the backend (`packages/opencode/src/cli/cmd/tui/worker.ts`):
- Main thread: SolidJS rendering, keyboard input, event batching (16ms)
- Worker thread: Hono HTTP server, LLM streaming, database, subprocess management

Communication via `Rpc.client<T>(worker)` → `Rpc.listen(rpc)` over `postMessage/onmessage`.

Events from the worker are forwarded via `Rpc.emit("event", event)` at `worker.ts:37`, then batched in `SDKProvider` (`sdk.tsx:50-62`) using SolidJS `batch()` with 16ms coalescing.

#### Concurrency Primitives

| Primitive | File | Purpose |
|---|---|---|
| `AsyncQueue<T>` | `packages/opencode/src/util/queue.ts` | Producer-consumer async queue |
| `Lock.read()/write()` | `packages/opencode/src/util/lock.ts` | Reader-writer lock with writer priority |
| `Signal` | `packages/opencode/src/util/signal.ts` | One-shot promise trigger/wait |
| `AbortController` chain | Throughout | Cascading cancellation |
| `Instance.state()` | `packages/opencode/src/project/state.ts` | Per-directory singleton state |
| `GlobalBus` | `packages/opencode/src/bus/global.ts` | Process-wide EventEmitter |

#### Session Concurrency Guard

Only one LLM loop per session runs at a time (`packages/opencode/src/session/prompt.ts:238-283`). Additional callers queue via Promise callbacks. This prevents data races within a single session but does not prevent cross-session event loop contention.

### Ralph Workflow First Step: Planner

**Definition**: `src/workflows/ralph/graph.ts:160-169`

The planner is a `subagentNode` that spawns a "planner" sub-agent (defined in `.claude/agents/planner.md`, `.opencode/agents/planner.md`, or `.github/agents/planner.md`). It sends the user's prompt wrapped in `buildSpecToTasksPrompt()` to decompose it into a structured JSON task list.

**Execution path**:
1. `executeWorkflow()` at `executor.ts:137` obtains `context.spawnSubagentParallel` from the TUI
2. The executor wraps it in `spawnSubagent` (single-agent wrapper) at `executor.ts:249-274`
3. The planner node calls `spawnSubagent()` at `nodes.ts:1707`
4. TUI's `spawnSubagentParallel` at `chat.tsx:4598` creates an isolated SDK session
5. The session's `stream()` async generator iterates the SSE event stream
6. **This iteration is where the bottleneck occurs** — the `for await` loop in `SubagentStreamAdapter.consumeStream()` blocks until the stream completes

### Workflow-SDK Agent SDK Integration

Only **one SDK** is active per chat session (`src/commands/chat.ts:81-92`):

```typescript
function createClientForAgentType(agentType: AgentType): CodingAgentClient {
  switch (agentType) {
    case "claude": return createClaudeAgentClient();
    case "opencode": return createOpenCodeClient({ directory: process.cwd() });
    case "copilot": return createCopilotClient();
  }
}
```

However, the **workflow executor** can spawn sub-agents that create **additional sessions** on the same client. When using OpenCode, all these sessions share the same SSE event subscription, creating the cross-session contention described in Pattern B.

The stream adapter layer (`src/events/adapters/`) normalizes each SDK's native streaming into `BusEvent` format:
- `OpenCodeStreamAdapter`: Push-based — subscribes to `client.on()` events
- `ClaudeStreamAdapter`: Pull-based — consumes `session.stream()` AsyncIterable
- `CopilotStreamAdapter`: Push-based — subscribes to `client.on()` events, bounded buffer (1000 max)

### Known Related Issues (from `research/ralph-workflow.md`)

1. Sub-agent tree state not streaming tool calls — stuck at "Initializing..."
2. Streaming delay after TODO list completion — seconds of delay before final duration/tokens output
3. Both issues are symptoms consistent with the SSE event loop bottlenecks documented here

## Code References

- `src/sdk/clients/opencode.ts:728-851` — SSE event loop, watchdog, reconnection
- `src/sdk/clients/opencode.ts:968-1571` — Event handling and dispatch
- `src/sdk/clients/opencode.ts:1864-2194` — `sendAsync()` and `stream()` methods
- `src/events/adapters/opencode-adapter.ts:145-438` — Stream adapter entry point
- `src/events/adapters/opencode-adapter.ts:336-378` — `completionPromise` blocking pattern
- `src/workflows/executor.ts:239-305` — Runtime spawn injection
- `src/workflows/ralph/graph.ts:160-169` — Planner node definition
- `src/workflows/graph/nodes.ts:1665-1731` — `subagentNode()` factory
- `src/ui/chat.tsx:4598-4784` — `spawnSubagentParallel` implementation
- `src/ui/index.ts:207-805` — TUI session management
- `packages/opencode/src/cli/cmd/tui/thread.ts:116-168` — OpenCode TUI thread/worker setup
- `packages/opencode/src/cli/cmd/tui/worker.ts:1-95` — OpenCode worker process
- `packages/opencode/src/cli/cmd/tui/context/sdk.tsx:28-100` — OpenCode event batching
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx:107-343` — OpenCode state sync
- `packages/opencode/src/util/queue.ts:1-32` — AsyncQueue
- `packages/opencode/src/util/lock.ts:1-98` — Reader-writer lock
- `packages/opencode/src/server/routes/tui.ts` — Server→TUI bridge via AsyncQueue
- `packages/opencode/src/session/prompt.ts:238-283` — Session concurrency guard

## Architecture Documentation

### OpenCode Event Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ OpenCode Server                                             │
│   SessionProcessor → Bus.publish() → GlobalBus.emit()       │
│   → Rpc.emit("event", ...) / SSE stream endpoint            │
└────────────────────────┬────────────────────────────────────┘
                         │ postMessage / SSE
┌────────────────────────▼────────────────────────────────────┐
│ OpenCode TUI Main Thread                                     │
│   SDKProvider → 16ms batch → SolidJS batch() → SyncProvider │
│   → store update → reactive component re-render              │
└──────────────────────────────────────────────────────────────┘
```

### Workflow-SDK Event Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ OpenCode Server                                             │
│   LLM streaming → Session.updatePart() → Bus.publish()      │
│   → SSE endpoint (GET /event)                                │
└────────────────────────┬────────────────────────────────────┘
                         │ SSE (fetch → reader.read())
┌────────────────────────▼────────────────────────────────────┐
│ OpenCode SDK Client (workflow-sdk)                           │
│   createSseClient → reader.read() ──── BLOCKING POINT ────  │
│   → processEventStream() for await loop                      │
│   → handleSdkEvent() → emitEvent() → handler fanout         │
│     ├─► stream() deltaQueue → async generator                │
│     └─► OpenCodeStreamAdapter → EventBus → BatchDispatcher  │
│           → StreamPipelineConsumer → React UI                │
└──────────────────────────────────────────────────────────────┘
```

### Ralph Planner Blocking Chain

```
for await (streamGraph)          ← executor.ts:455
  └─ await node.execute()        ← compiled.ts:655
      └─ await spawnSubagent()   ← nodes.ts:1707
          └─ await spawnFn()     ← executor.ts:260
              └─ await Promise.allSettled(spawnOne)  ← chat.tsx:4749
                  └─ await createSubagentSession()   ← chat.tsx:4659
                  └─ await adapter.consumeStream()   ← chat.tsx:4710
                      └─ for await (stream)          ← subagent-adapter.ts:150
                          └─ BLOCKS ON SSE EVENTS    ← opencode.ts reader.read()
```

## Historical Context (from research/)

- `research/ralph-workflow.md` — Known bugs: sub-agent tree not streaming, streaming delay after task completion
- `research/workflow-gaps.md` — High-impact gaps including broken rendering pipeline and MCP bridge placeholders
- `research/docs/2026-02-15-subagent-premature-completion-investigation.md` — Sub-agent nodes marked completed before background tasks finish
- `research/docs/2026-02-15-subagent-event-flow-diagram.md` — Sub-agent event flow and race condition documentation
- `research/docs/2026-02-26-streaming-event-bus-spec-audit.md` — Streaming event bus spec compliance audit
- `research/docs/2026-03-01-opencode-delegation-streaming-parity.md` — OpenCode task/subtask streaming parity
- `research/docs/2026-03-01-opencode-auto-compaction.md` — OpenCode SDK auto-compaction mechanism
- `research/docs/2026-02-26-opencode-event-bus-patterns.md` — OpenCode event-bus architecture
- `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md` — Graph execution engine technical docs
- `research/docs/2026-02-25-ralph-workflow-implementation.md` — Ralph workflow implementation technical docs
- `research/docs/2026-02-23-258-background-agents-sdk-event-pipeline.md` — Background agents SDK event pipeline

## Related Research

- `research/docs/2026-02-16-opencode-tui-chat-architecture.md` — OpenCode TUI chat architecture deep-dive
- `research/docs/2026-02-14-opencode-opentui-sdk-research.md` — OpenCode SDK and OpenTUI sub-agent spawning
- `research/docs/2026-02-28-workflow-tui-rendering-unification-refactor.md` — Workflow TUI rendering unification
- `research/docs/2026-02-25-workflow-sdk-design.md` — WorkflowSDK design documentation
- `research/docs/2026-02-15-ralph-dag-orchestration-implementation.md` — Ralph DAG-based orchestration implementation

## Open Questions

1. **Watchdog abort propagation**: The local `watchdogAbort` at `opencode.ts:820` is not passed to the SDK's SSE client. Is this intentional (relying on the global `eventSubscriptionController` instead) or an oversight? The global controller only aborts on `disconnect()`, not on heartbeat timeout.

2. **Cross-session event volume**: What is the measured overhead of processing irrelevant session events in the shared `for await` loop? Under heavy background agent load, does this overhead exceed the 15s heartbeat timeout threshold?

3. **`reader.read()` abort mechanism**: The SDK's `createSseClient` registers an abort listener at `serverSentEvents.gen.js:49` that calls `reader.cancel()`. Could the workflow-sdk pass its own `AbortSignal` (composed from the watchdog + the global subscription controller) to enable mid-read cancellation?

4. **Process-level isolation**: Since each SDK session shares a single `OpenCodeClient` instance with one SSE event loop, would spawning separate client instances per workflow sub-agent eliminate the cross-session contention at the cost of additional server connections?

5. **TCP keepalive tuning**: Could the OpenCode server or client configure TCP keepalive at the socket level (e.g., `SO_KEEPALIVE` with shorter intervals) to detect dead connections faster than the OS default 2-hour timeout?
