---
date: 2026-02-26 04:46:59 UTC
researcher: Copilot
git_commit: c399d54c08b67b640e7a64bbbc181f9d329ab187
branch: lavaman131/feature/workflow-sdk
repository: workflow-sdk
topic: "Streaming Architecture Migration: Callbacks to Event-Bus Pattern"
tags: [research, streaming, sse, event-bus, callbacks, opencode, claude-agent-sdk, copilot-sdk, tui, architecture]
status: complete
last_updated: 2026-02-26
last_updated_by: Copilot
---

# Research: Streaming Architecture Migration — Callbacks to Event-Bus Pattern

## Research Question

Rethink the way that LM responses and messages are streamed across the entire TUI (which uses Claude Agent SDK, OpenCode SDK, and Copilot SDK as backends). The current callback-based approach should be migrated to a more robust event-bus streaming model inspired by OpenCode's SSE + event-bus + batched coalescing pattern. The workflow-sdk (manually orchestrated workflows) should share the same streaming backbone as the main chat, enabling unified rendering of sub-agents, tool calls, and workflow output.

## Summary

The Atomic TUI currently uses a **multi-layered callback architecture** where streaming data flows from SDK clients through function callbacks (`onChunk`, `onComplete`, `onMeta`) to the UI layer, with event handlers registered via React prop drilling and ref-based handler storage. This creates tight coupling between the orchestration layer (`src/ui/index.ts`) and the chat component (`src/ui/chat.tsx`), with dual-path event delivery (stream-path vs hook-path) and complex correlation mapping.

OpenCode, by contrast, implements a **server-side Bus → SSE → client-side event-bus with batching/coalescing** architecture. Events flow through a typed publish-subscribe system, are serialized as SSE to clients, and are consumed via an event emitter with frame-aligned batching (16ms) and key-based coalescing. Components subscribe to events declaratively without receiving callbacks as props.

All three SDK backends expose different streaming primitives:
- **OpenCode SDK**: SSE + AsyncGenerator via `sdk.event.subscribe()`
- **Claude Agent SDK**: AsyncIterable via `session.stream()`
- **Copilot SDK**: Event Emitter via `session.on(eventType, handler)`

The key architectural shift would be from **callback prop-threading** to a **centralized event bus** that normalizes all three SDK streaming patterns into a unified event stream, with batched dispatch to prevent render churn.

---

## Detailed Findings

### 1. Current Streaming Architecture (Callback-Based)

#### 1.1 SDK Layer — AsyncIterable Streaming

Each SDK client implements `Session.stream()` which returns `AsyncIterable<AgentMessage>`:

```typescript
// src/sdk/types.ts:250-251
stream(message: string, options?: { agent?: string }): AsyncIterable<AgentMessage>
```

`AgentMessage` carries:
- `type`: `"text"` | `"tool_use"` | `"tool_result"` | `"thinking"`
- `content`: string or structured data
- `role`: `"user"` | `"assistant"` | `"system"` | `"tool"`
- `metadata`: token usage, model info, tool details

**Event Emitter in Base Client** (`src/sdk/base-client.ts:32-104`):
- `on<T>(eventType, handler)` → returns unsubscribe function
- `emit<T>(eventType, sessionId, data)` → synchronous dispatch with try-catch
- Handlers stored in `Map<EventType, Set<EventHandler>>`

SDK Event Types (`src/sdk/types.ts:297-310`):
```
message.delta, message.complete, tool.start, tool.complete,
session.start, session.idle, session.error, skill.invoked,
subagent.start, subagent.complete, permission.requested,
human_input_required, usage
```

#### 1.2 Orchestration Layer — handleStreamMessage

`src/ui/index.ts:1513-1913` is the central streaming coordinator:

**Callback Signatures**:
- `onChunk: (chunk: string) => void` — text delta delivery
- `onComplete: () => void` — stream finalization
- `onMeta?: (meta: StreamingMeta) => void` — metadata updates (thinking, tokens)

**Stream Processing Loop** (lines 1571-1879):
```typescript
const stream = state.session!.stream(content, options);
const abortableStream = abortableAsyncIterable(stream, state.streamAbortController.signal);

for await (const message of abortableStream) {
  if (message.type === "text") {
    // Echo suppression, thinking duration, then:
    onChunk(chunkToEmit);
  }
  else if (message.type === "thinking") {
    // Track thinking sources, accumulate text
    onMeta?.(createStreamingMetaSnapshot(thinkingSourceKey));
  }
  else if (message.type === "tool_use") {
    state.toolStartHandler(toolId, toolName, input);
  }
  else if (message.type === "tool_result") {
    state.toolCompleteHandler(toolId, output, success, error);
  }
}
```

**Dual-Path Event Delivery**:
- **Stream-path**: Events in the AsyncIterable (tool_use, tool_result messages)
- **Hook-path**: Events via SDK's `client.on()` system (`subscribeToToolEvents` at lines 477-1293)
- Flag `toolEventsViaHooks = true` prevents duplicate processing
- OpenCode primarily uses hook-path; Claude/Copilot use stream-path

#### 1.3 UI Layer — React Callback Registration

`src/ui/chat.tsx` receives streaming callbacks and applies events to message parts:

**Callback Registration** (via React props + useEffect, lines 2490-2506):
```typescript
// Handler registration functions provided as props:
registerToolStartHandler?: (handler: OnToolStart) => void
registerToolCompleteHandler?: (handler: OnToolComplete) => void
registerSkillInvokedHandler?: (handler: OnSkillInvoked) => void
```

**Handler Storage** in `ChatUIState` (index.ts:167-176):
```typescript
interface ChatUIState {
  toolStartHandler: OnToolStart | null;
  toolCompleteHandler: OnToolComplete | null;
  skillInvokedHandler: OnSkillInvoked | null;
  permissionRequestHandler: OnPermissionRequest | null;
  askUserQuestionHandler: OnAskUserQuestion | null;
}
```

**Text Delta Handling** (`chat.tsx:3551-3576`):
```typescript
const handleChunk = (chunk: string) => {
  if (!isCurrentStreamCallback(streamGenerationRef.current, currentGeneration)) return;
  lastStreamingContentRef.current += chunk;
  if (hideStreamContentRef.current) return;
  setMessagesWindowed((prev) =>
    prev.map((msg) => {
      if (msg.id === messageId) {
        return applyStreamPartEvent(msg, { type: "text-delta", delta: chunk });
      }
      return msg;
    })
  );
};
```

**React State Update Pattern** (used in handleChunk, handleMeta, handleToolStart, handleToolComplete):
```typescript
setMessagesWindowed((prev: ChatMessage[]) =>
  prev.map((msg: ChatMessage) => {
    if (msg.id === messageId) {
      return applyStreamPartEvent(msg, event);
    }
    return msg;
  })
);
```

Each text delta, tool event, and thinking update triggers a full `setMessagesWindowed` call that maps over all messages.

#### 1.4 Parts Pipeline — Event Reducer

`src/ui/parts/stream-pipeline.ts:786-853` — `applyStreamPartEvent()` is a discriminated union reducer:

**StreamPartEvent types**:
```
text-delta, thinking-meta, tool-start, tool-complete,
tool-hitl-request, tool-hitl-response, parallel-agents
```

**Part types** (`src/ui/parts/types.ts`):
```
TextPart, ReasoningPart, ToolPart, AgentPart,
TaskListPart, SkillLoadPart, McpSnapshotPart, CompactionPart
```

**Part storage** (`src/ui/parts/store.ts`): Binary search-based insertion/update with timestamp-encoded PartIds for chronological ordering.

**Throttling** (`src/ui/hooks/use-throttled-value.ts`): 100ms throttle on UI updates.

#### 1.5 Hook-Path Event Subscription

`src/ui/index.ts:477-1450` — `subscribeToToolEvents()`:

Subscribes to SDK events: `tool.start`, `tool.complete`, `skill.invoked`, `permission.requested`, `human_input_required`, `subagent.start`, `subagent.complete`

**Correlation Infrastructure**:
- `sdkToolIdMap`: SDK tool use ID → internal tool ID
- `toolCallToAgentMap`: SDK correlation ID → agent ID
- `subagentSessionToAgentId`: session ID → agent ID
- `pendingTaskEntries`: FIFO queue for Task tool → subagent.start matching
- Run ownership via monotonic `state.runCounter` to reject stale events

#### 1.6 Workflow Streaming

`src/workflows/executor.ts:122-283` — `executeWorkflow()`:
- Iterates `streamGraph()` AsyncGenerator
- Yields `StepResult<TState>` containing `{ nodeId, state, result, status }`
- Progress messages via `context.addMessage()`
- Task list sync via `context.setTodoItems(state.tasks)`

Sub-agent spawning (`src/ui/chat.tsx:3796-3960` — `spawnSubagentParallel()`):
- Creates isolated sessions via `createSubagentSession()`
- Streams via `session.stream(options.task)`
- Uses `Promise.allSettled()` for concurrent execution
- Returns `SubagentResult[]`

Workflow streaming uses the same callback infrastructure as main chat, flowing through `handleStreamMessage()`.

---

### 2. OpenCode's SSE + Event-Bus Architecture

#### 2.1 Server-Side: Bus → SSE

**Bus System** (`packages/opencode/src/bus/index.ts`):
- Events defined with `BusEvent.define(name, zodSchema)` for type-safe pub/sub
- `Bus.publish(Event, properties)` → validates with Zod → dispatches to all subscribers
- `Bus.subscribeAll(callback)` → receives all published events
- `Bus.subscribe(eventType, callback)` → specific event subscription
- `Bus.once(eventType, callback)` → one-time subscription

**SSE Endpoint** (`packages/opencode/src/server/server.ts:511-528`):
```typescript
const unsub = Bus.subscribeAll(async (event) => {
  await stream.writeSSE({ data: JSON.stringify(event) });
  if (event.type === Bus.InstanceDisposed.type) { stream.close(); }
});
// 30s heartbeat to prevent WKWebView timeout
const heartbeat = setInterval(() => {
  stream.writeSSE({ data: JSON.stringify({ type: "server.heartbeat", properties: {} }) });
}, 30000);
```

**Global Events Endpoint** (`packages/opencode/src/server/routes/global.ts:79-95`):
- Same pattern but via `GlobalBus.on("event", handler)`
- Wraps events in `{ payload: event }` envelope
- Supports multi-directory event distribution

**Key Event Types**:
```
session.status, session.updated, session.created, session.deleted,
message.updated, message.part.updated, message.part.delta,
lsp.updated, lsp.client.diagnostics, mcp.tools.changed,
server.heartbeat, server.connected, server.instance.disposed
```

#### 2.2 Client-Side: Event Bus with Batching

**Web App** (`packages/app/src/context/global-sdk.tsx:46-84`):

```typescript
const FLUSH_FRAME_MS = 16;  // ~60 FPS alignment
const STREAM_YIELD_MS = 8;  // Yield to event loop

let queue: Queued[] = [];
let buffer: Queued[] = [];
const coalesced = new Map<string, number>();
```

**Coalescing Key Function**:
```typescript
const key = (directory: string, payload: Event) => {
  if (payload.type === "session.status") return `session.status:${directory}:${payload.properties.sessionID}`;
  if (payload.type === "lsp.updated") return `lsp.updated:${directory}`;
  if (payload.type === "message.part.updated") {
    const part = payload.properties.part;
    return `message.part.updated:${directory}:${part.messageID}:${part.id}`;
  }
};
```

Events with the same key within a batching window overwrite each other — only the most recent state is preserved.

**Flush Function**:
```typescript
const flush = () => {
  const events = queue;
  queue = buffer;    // Swap buffers efficiently
  buffer = events;
  queue.length = 0;
  coalesced.clear();
  last = Date.now();
  batch(() => {      // SolidJS batch: single render for all updates
    for (const event of events) {
      emitter.emit(event.directory, event.payload);
    }
  });
};
```

**TUI Batching** (`packages/opencode/src/cli/cmd/tui/context/sdk.tsx:36-62`):
- Simpler 16ms threshold batching without coalescing
- Immediate flush if >16ms since last flush, else schedule
- Uses SolidJS `batch()` for grouped reactive updates

#### 2.3 Event Bus Architecture

**Two-Tier Emitter System**:
1. **Global Emitter** (web app) — Single SSE connection, distributes by directory
2. **Directory Emitter** (per-project) — Filters from global emitter, provides scoped subscription

```
Component calls sdk.event.listen((event) => {
  if (event.type === "message.part.delta") {
    updateMessagePartInStore(event.properties);
  }
});
```

**Reconnection**:
```typescript
while (true) {
  try {
    for await (const chunk of eventSdk.global.event()) { handleEvent(chunk); }
  } catch (error) {
    await wait(RECONNECT_DELAY_MS);  // 250ms
  }
}
```

#### 2.4 LLM Provider Streaming

**TransformStream** (`packages/opencode/src/provider/sdk/copilot/chat/openai-compatible-chat-language-model.ts:367-386`):
- Parses raw SSE chunks from AI providers into `LanguageModelV2StreamPart` types
- Handles: `stream-start`, `reasoning-start/delta/end`, `text-start/delta/end`, `tool-input-start/delta/end`, `tool-call`, `finish`
- Tracks active reasoning, text, and tool call state transitions

**SessionProcessor** (`packages/opencode/src/session/processor.ts`):
- Consumes `stream.fullStream` and creates/updates `MessageV2` parts
- Calls `Session.updatePart()` and `Session.updatePartDelta()` which publish Bus events
- Bus events flow through SSE to clients automatically

**End-to-End Flow**:
```
LLM SSE chunks → TransformStream → LanguageModelV2StreamPart
→ SessionProcessor → Bus.publish(PartUpdated/PartDelta)
→ GlobalBus → SSE endpoint → Client SSE reader
→ Event queue (with coalescing) → batch(flush)
→ Emitter → Component subscribers → Single render
```

---

### 3. SDK Streaming API Comparison

| Aspect | OpenCode SDK | Claude Agent SDK | Copilot SDK |
|--------|-------------|-----------------|-------------|
| **Primary Method** | `sdk.event.subscribe()` | `session.stream()` | `session.on(eventType, handler)` |
| **Return Type** | `{ stream: AsyncGenerator<Event> }` | `AsyncIterable` | Unsubscribe function |
| **Pattern** | Pull-based (iterator) | Pull-based (iterator) | Push-based (observer) |
| **Event Count** | 42+ event types | ~6 documented | 43 event types |
| **Type Safety** | Zod schemas | TypeScript types | Discriminated unions |
| **Backpressure** | Consumer-controlled | Holds until subagents complete | None (synchronous dispatch) |
| **Multi-language** | JavaScript/TypeScript | TypeScript | TS, Python, Go, C# |

**OpenCode SDK Events** (key subset):
- `message.part.updated` — Full part state replacement
- `message.part.delta` — Incremental text delta
- `session.status` — Session lifecycle
- `message.updated` — Full message updates

**Claude Agent SDK Events**:
- `task_started` — Subagent task registration
- `task_notification` — Task completion with `tool_use_id` correlation
- `SDKResultSuccess` / `SDKResultError` — Result messages

**Copilot SDK Events** (key subset):
- `assistant.message_delta` — Streaming text chunk (ephemeral)
- `assistant.turn_start/end` — Turn boundaries
- `tool.execution_start/progress/complete` — Tool lifecycle
- `subagent.started/completed/failed` — Sub-agent lifecycle
- `session.start/idle/error/shutdown` — Session lifecycle

---

### 4. Architectural Comparison

#### 4.1 Current Atomic Architecture (Callbacks)

```
SDK Client.stream() → AsyncIterable<AgentMessage>
      ↓
index.ts: for await (msg of stream)
      ↓ (callbacks)
  onChunk(text)  →  chat.tsx: setMessagesWindowed(applyStreamPartEvent)
  onMeta(meta)   →  chat.tsx: setMessagesWindowed(applyStreamPartEvent)
  onComplete()   →  chat.tsx: finalize streaming state
      ↓
SDK Client.on("tool.start") → state.toolStartHandler → chat.tsx: handleToolStart
SDK Client.on("tool.complete") → state.toolCompleteHandler → chat.tsx: handleToolComplete
SDK Client.on("subagent.start") → state.parallelAgentHandler → chat.tsx: updateAgentTree
```

**Characteristics**:
- Callbacks threaded through props and refs
- Dual-path event delivery (stream vs hooks)
- Each callback triggers `setMessagesWindowed()` which maps over all messages
- Complex correlation maps for tool/agent attribution
- Generation-based staleness guards
- 100ms throttling via `use-throttled-value.ts`
- Echo suppression for post-task duplicate text

#### 4.2 OpenCode Architecture (Event Bus)

```
LLM Provider → TransformStream → SessionProcessor
      ↓
Bus.publish(PartUpdated/PartDelta)
      ↓
GlobalBus → SSE endpoint → HTTP SSE stream
      ↓
Client SSE reader → Queue (with key-based coalescing)
      ↓ (16ms batched flush)
batch(() => emitter.emit(directory, event))
      ↓
Component subscribers → SolidJS reactive updates → Single render
```

**Characteristics**:
- No callback prop-threading
- Single event pathway (Bus → SSE → emitter)
- Key-based coalescing eliminates redundant updates
- Frame-aligned batching (16ms) reduces render churn
- Components subscribe declaratively
- Reconnection handled at SDK level
- Heartbeat keeps connections alive

---

## Code References

### Current Callback Architecture
- `src/sdk/types.ts:250-251` — `Session.stream()` AsyncIterable interface
- `src/sdk/types.ts:297-310` — `EventType` discriminated union
- `src/sdk/types.ts:349-400` — Event data types (MessageDelta, ToolStart, ToolComplete)
- `src/sdk/base-client.ts:32-104` — `EventEmitter` class
- `src/ui/index.ts:167-176` — `ChatUIState` handler refs
- `src/ui/index.ts:477-1450` — `subscribeToToolEvents()` hook-path event handling
- `src/ui/index.ts:1513-1913` — `handleStreamMessage()` stream-path processing
- `src/ui/chat.tsx:3551-3576` — `handleChunk()` text delta callback
- `src/ui/chat.tsx:3578-3717` — `handleComplete()` stream finalization
- `src/ui/chat.tsx:3720-3748` — `handleMeta()` thinking metadata callback
- `src/ui/chat.tsx:2266-2354` — `handleToolStart()` tool event callback
- `src/ui/chat.tsx:2361-2476` — `handleToolComplete()` tool event callback
- `src/ui/chat.tsx:2490-2506` — Handler registration via useEffect
- `src/ui/chat.tsx:3796-3960` — `spawnSubagentParallel()` sub-agent spawning

### Parts Pipeline
- `src/ui/parts/stream-pipeline.ts:786-853` — `applyStreamPartEvent()` reducer
- `src/ui/parts/stream-pipeline.ts:91-98` — `StreamPartEvent` union type
- `src/ui/parts/types.ts:49-127` — Part type definitions
- `src/ui/parts/store.ts:20-53` — Binary search part storage
- `src/ui/parts/handlers.ts:21-52` — `handleTextDelta()` text part splitting
- `src/ui/parts/id.ts` — Timestamp-encoded PartId generation
- `src/ui/parts/guards.ts` — Stream finalization guards

### Hooks
- `src/ui/hooks/use-streaming-state.ts:55-94` — Streaming state management
- `src/ui/hooks/use-message-queue.ts` — Message queue during streaming
- `src/ui/hooks/use-throttled-value.ts` — 100ms update throttling

### Workflow Streaming
- `src/workflows/executor.ts:122-283` — `executeWorkflow()` lifecycle
- `src/workflows/graph/compiled.ts:324-569` — `GraphExecutor.streamSteps()`
- `src/workflows/graph/compiled.ts:888` — `streamGraph()` AsyncGenerator
- `src/workflows/graph/stream.ts:7-123` — `StreamMode`, `StreamEvent`, `StreamRouter`
- `src/workflows/graph/nodes.ts:193` — Agent nodes calling `session.stream()`
- `src/workflows/graph/types.ts:289` — `ExecutionContext.emit()` custom events

### UI Components
- `src/ui/components/parallel-agents-tree.tsx:206-360` — Agent deduplication logic
- `src/ui/components/parallel-agents-tree.tsx:589-734` — Tree rendering
- `src/ui/components/task-list-panel.tsx:72-179` — Workflow task list rendering
- `src/ui/components/transcript-view.tsx` — Main transcript with streaming

### SDK Clients
- `src/sdk/clients/opencode.ts` — OpenCode SDK integration
- `src/sdk/clients/claude.ts` — Claude Agent SDK integration
- `src/sdk/clients/copilot.ts` — Copilot SDK integration
- `src/sdk/clients/opencode.events.test.ts` — OpenCode event handling tests
- `src/sdk/unified-event-parity.test.ts` — Cross-SDK event consistency tests

---

## Architecture Documentation

### Current Patterns

1. **Dual-Path Event Delivery**: Events arrive via both the AsyncIterable stream (stream-path) and SDK's native event system (hook-path). A flag `toolEventsViaHooks` prevents duplicate processing. OpenCode primarily uses hook-path; Claude/Copilot use stream-path.

2. **Ref-Based Handler Storage**: Streaming callbacks are stored as refs in `ChatUIState` and called by the orchestration layer. This avoids re-registration on every render but creates implicit coupling.

3. **Generation-Based Staleness Guards**: A monotonic `streamGenerationRef` counter invalidates callbacks from previous streams when new messages are sent rapidly.

4. **Run Ownership Tracking**: Monotonic `runCounter` at `src/ui/index.ts:206` assigns ownership IDs, preventing stale hook events from previous streams.

5. **FIFO Correlation Queuing**: `pendingTaskEntries` queue at `src/ui/index.ts:490` correlates Task tool calls with subagent.start events when SDK correlation IDs are unavailable.

6. **Echo Suppression**: Post-task duplicate text from SDKs is suppressed via `suppressPostTaskResults` FIFO at `src/ui/index.ts:1594`.

7. **Binary Search Part Ordering**: Parts are maintained in chronological order via timestamp-encoded PartIds with O(log n) binary search insertion.

8. **React State Immutable Updates**: Every streaming event triggers `setMessagesWindowed((prev) => prev.map(...))`, creating new message objects for changed messages.

### OpenCode Patterns

1. **Typed Event Bus**: Events defined with Zod schemas provide compile-time and runtime type safety.

2. **Key-Based Coalescing**: Events with the same composite key within a batching window overwrite each other, preserving only the latest state.

3. **Frame-Aligned Batching**: 16ms flush intervals align with ~60 FPS rendering cadence.

4. **Buffer Swapping**: Double-buffer technique (`queue`/`buffer` swap) avoids array allocation during flush.

5. **Stream Yielding**: 8ms yield intervals prevent blocking the main thread during high-volume events.

6. **Part-Based Message Model**: Messages are composed of typed parts (TextPart, ToolPart, ReasoningPart) with unique IDs for granular updates.

7. **SSE + Reconnection**: Automatic reconnection with 250ms delay and exponential backoff at the SDK level.

---

## Historical Context (from research/)

### Directly Related Research
- `research/docs/2026-02-23-258-background-agents-sdk-event-pipeline.md` — Documents the multi-stage pipeline from SDK events → UI integration state → ChatApp parallelAgents → synthetic parallel-agents stream events → message parts → ParallelAgentsTree rendering
- `research/docs/2026-02-16-opencode-tui-chat-architecture.md` — OpenCode's reactive event-driven architecture with backend streaming message parts via SSE
- `research/docs/2026-02-16-atomic-chat-architecture-current.md` — Current content segment model, MessageBubble rendering, streaming pipeline
- `research/docs/2026-02-16-chat-system-design-reference.md` — Production-grade chat system design with part-based model
- `research/docs/2026-02-16-opencode-message-rendering-patterns.md` — OpenCode's message part structure and dynamic rendering
- `research/docs/2026-02-15-subagent-event-flow-diagram.md` — Timeline diagrams showing sync/async task flows and race conditions
- `research/docs/2026-02-12-sdk-ui-standardization-research.md` — Unified CodingAgentClient interface and event normalization
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md` — Content-offset-based segmentation for interleaving text/tool outputs
- `research/docs/2026-02-15-ui-inline-streaming-vs-pinned-elements.md` — Inline chronological segments vs pinned panels rendering paths

### SDK Integration Research
- `research/docs/2026-02-19-sdk-v2-first-unified-layer-research.md` — Unified provider abstraction with normalized event model
- `research/docs/2026-02-23-sdk-subagent-api-research.md` — How all three SDKs handle sub-agent tool calls and event streaming
- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` — Disconnect between Atomic's SubagentSessionManager and native SDK sub-agent APIs
- `research/docs/2026-01-31-opencode-sdk-research.md` — OpenCode SDK architecture, event system, plugin development
- `research/docs/2026-01-31-claude-agent-sdk-research.md` — Claude Agent SDK v2, event handling & hooks
- `research/docs/2026-01-31-github-copilot-sdk-research.md` — GitHub Copilot SDK research

### Workflow SDK Research
- `research/docs/2026-02-25-workflow-sdk-standardization.md` — Graph engine, sub-agents as building blocks, typed state management
- `research/docs/2026-02-25-unified-workflow-execution-research.md` — Unified workflow execution interface
- `research/docs/2026-02-25-workflow-sdk-design.md` — WorkflowSDK class design with provider clients and subagent infrastructure
- `research/docs/2026-02-11-workflow-sdk-implementation.md` — Graph execution engine, fluent builder API
- `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md` — Graph execution engine technical documentation

### Sub-Agent Lifecycle Research
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md` — Status-to-color mapping, SDK parity across normalized events
- `research/docs/2026-02-16-sub-agent-tree-inline-state-lifecycle-research.md` — Tree inline rendering, lifecycle state signaling
- `research/docs/2026-02-14-subagent-output-propagation-issue.md` — Bridge layer data truncation, SDK registration gaps
- `research/docs/2026-02-23-thinking-tag-stream-grouping.md` — Thinking text concatenation across streams

---

## Related Research

- `research/docs/2026-02-16-opentui-rendering-architecture.md` — OpenTUI rendering architecture
- `research/docs/2026-02-14-opencode-opentui-sdk-research.md` — OpenCode + OpenTUI SDK research
- `research/docs/2026-02-16-opencode-deepwiki-research.md` — OpenCode DeepWiki research
- `research/docs/2026-02-04-agent-subcommand-parity-audit.md` — Agent subcommand parity audit
- `research/docs/2026-02-25-ui-workflow-coupling.md` — UI to workflow coupling analysis

---

## Open Questions

1. **SSE Server Requirement**: OpenCode runs a local server that exposes SSE endpoints. Atomic is a pure TUI application without a server. Should an in-process event bus (e.g., `mitt` or custom typed emitter) replace the SSE transport layer, or should a lightweight local server be introduced?

2. **Coalescing Granularity**: OpenCode coalesces `message.part.updated` events by `{messageID}:{partID}`. Atomic's current system applies every delta immediately. What coalescing keys make sense for the three SDK backends?

3. **Batch Rendering in React vs SolidJS**: OpenCode uses SolidJS `batch()` which groups reactive updates. React's `unstable_batchedUpdates` or React 18's automatic batching provides similar semantics — how should the flush cycle integrate with React's rendering?

4. **Workflow Streaming Unification**: Workflow execution currently uses `context.addMessage()` and `context.setTodoItems()` to update the UI. Should workflows emit events onto the same event bus as main chat, or maintain a separate event channel?

5. **SDK Normalization Layer**: All three SDKs have different streaming APIs (AsyncGenerator, AsyncIterable, EventEmitter). Where exactly in the pipeline should normalization happen — at the SDK client level, or in the event bus subscription layer?

6. **Backpressure**: Copilot SDK has no backpressure (synchronous dispatch). OpenCode's pull-based iterator provides natural backpressure. How should the event bus handle slow consumers when normalizing across all three?

7. **Sub-Agent Session Ownership**: The current `state.ownedSessionIds` Set tracks which sub-agent sessions belong to the current run. In an event-bus model, how would multi-session event routing work without the correlation maps?

8. **TransformStream Integration**: Should Atomic adopt OpenCode's TransformStream-based provider parsing, or continue to rely on each SDK's native message format?
