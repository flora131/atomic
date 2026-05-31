# OpenCode Streaming Order Architecture

**Date:** 2026-03-18
**Purpose:** Reverse engineering of how OpenCode ensures correct streaming order in OpenTUI and how tool calls, thinking blocks, ask-question tools, etc. are associated effectively. Intended to model similar patterns in the Atomic CLI TUI.

---

## 1. Monotonic Ascending IDs — The Foundation of Ordering

OpenCode's ordering strategy is elegantly simple: **parts don't carry explicit sequence numbers**. Instead, every part gets a monotonically ascending ID via `PartID.ascending()`:

```
prt_<48-bit-timestamp-shifted-by-12-bits + monotonic-counter>_<random>
```

- `id/id.ts:56-74` — `Identifier.ascending()` encodes `BigInt(Date.now()) * 0x1000 + counter` into 6 hex bytes
- Counter increments within the same millisecond, guaranteeing **total ordering**
- Lexicographic string comparison = chronological creation order

This means **the order parts are created IS the display order**, and it's baked into the IDs themselves.

---

## 2. Backend: SessionProcessor — The Stream-to-Parts Reducer

`session/processor.ts` is the core. It consumes the Vercel AI SDK's `fullStream` async iterable in a sequential `for await` loop:

```
reasoning-start → reasoning-delta(s) → reasoning-end
text-start → text-delta(s) → text-end
tool-input-start → tool-call → tool-result/tool-error
start-step → finish-step
```

### Event-to-Part Mapping

| Stream Event       | Part Effect                               | Persistence                            |
| ------------------ | ----------------------------------------- | -------------------------------------- |
| `reasoning-start`  | Create `ReasoningPart` (new ascending ID) | `updatePart()` → DB + Bus              |
| `reasoning-delta`  | Append text in-memory                     | `updatePartDelta()` → Bus only (no DB) |
| `reasoning-end`    | Finalize text, set `time.end`             | `updatePart()` → DB + Bus              |
| `text-start`       | Create `TextPart` (new ascending ID)      | `updatePart()` → DB + Bus              |
| `text-delta`       | Append text in-memory                     | `updatePartDelta()` → Bus only         |
| `text-end`         | Finalize text                             | `updatePart()` → DB + Bus              |
| `tool-input-start` | Create `ToolPart` status:`pending`        | `updatePart()` → DB + Bus              |
| `tool-call`        | Update to status:`running`                | `updatePart()` → DB + Bus              |
| `tool-result`      | Update to status:`completed` with output  | `updatePart()` → DB + Bus              |
| `tool-error`       | Update to status:`error`                  | `updatePart()` → DB + Bus              |

**Two persistence paths**:
- `Session.updatePart()` → SQLite upsert + `Bus.publish(PartUpdated)` — for structural changes
- `Session.updatePartDelta()` → `Bus.publish(PartDelta)` only — for streaming text (no DB write for performance)

---

## 3. Tool Call Association — Unified Stateful ToolPart

OpenCode does NOT use separate "tool call" and "tool result" entities. A single `ToolPart` transitions through states:

```
pending → running → completed | error
```

The `ToolPart` schema (`message-v2.ts:335-344`):

```typescript
{ type: "tool", callID: string, tool: string, state: ToolState, metadata? }
```

Where `ToolState` is a discriminated union on `status`:
- `pending`: `{ input: {}, raw: "" }`
- `running`: `{ input, title?, metadata?, time: { start } }`
- `completed`: `{ input, output, title, metadata, time: { start, end }, attachments? }`
- `error`: `{ input, error, metadata?, time: { start, end } }`

The processor tracks in-flight tools in a `toolcalls: Record<string, ToolPart>` dictionary keyed by the AI SDK's `toolCallId`. Each state transition updates the **same part** (same PartID) via upsert.

---

## 4. Ask-Question Tool — Blocking Deferred Pattern

The question tool (`tool/question.ts`) is structurally a regular tool but with a **blocking execution model**:

1. Tool executes → calls `Question.ask(sessionID, questions)`
2. `Question.ask()` creates a `Deferred`, publishes `Event.Asked` on the bus, and **awaits the deferred**
3. The TUI receives the `Asked` event and renders a question UI
4. User answers → TUI calls `Question.reply(requestID, answers)`
5. `reply()` resolves the deferred, unblocking the tool
6. Tool returns the answers as formatted output → ToolPart transitions to `completed`

From the data model perspective, it's just a `ToolPart` that stays in `running` state until the user responds. The UI differentiates it by checking `part.tool === "question"`.

---

## 5. Client-Side: Sorted Insertion via Binary Search

The TUI maintains parts in a SolidJS reactive store: `store.part[messageID]: Part[]`

When events arrive (`sync.tsx:290-341`):

```typescript
// message.part.updated
const result = Binary.search(parts, event.part.id, (p) => p.id);
if (result.found) {
  reconcile(parts[result.index], event.part);  // update in-place
} else {
  parts.splice(result.index, 0, event.part);   // insert at sorted position
}

// message.part.delta
const result = Binary.search(parts, event.partID, (p) => p.id);
if (result.found) {
  parts[result.index][field] += event.delta;    // append delta
}
```

Because ascending IDs sort lexicographically = chronologically, binary search insertion produces correct chronological order even if events arrive out of order.

---

## 6. Event Batching — 16ms Coalescing Window

The TUI batches SSE events in a 16ms window (~60fps) before applying them:

```typescript
// sdk.tsx:60-71
function handleEvent(event) {
  queue.push(event);
  if (Date.now() - lastFlush < 16) {
    setTimeout(flush, 16);
  } else {
    flush();
  }
}

function flush() {
  batch(() => {  // SolidJS batch — single render pass
    queue.forEach(applyEvent);
    queue.length = 0;
  });
}
```

---

## 7. TUI Rendering — Dynamic Part Dispatch

`AssistantMessage` iterates parts in array order (which IS creation order):

```tsx
<For each={props.parts}>
  {(part) => (
    <Dynamic component={PART_MAPPING[part.type]} part={part} />
  )}
</For>
```

Where `PART_MAPPING = { text: TextPart, tool: ToolPart, reasoning: ReasoningPart }`. Parts not in the mapping (step-start, step-finish, snapshot, patch) are silently excluded.

Tool results render **inline within the same ToolPart component** — a `<Switch>/<Match>` on `part.state.status` shows pending spinner vs completed output.

---

## 8. Finalization

When the stream ends (`processor.ts:402-418`):
1. Orphaned tools (still pending/running) are force-set to `error: "Tool execution aborted"`
2. `assistantMessage.time.completed = Date.now()` is persisted
3. Session status transitions back to `idle`

---

## 9. Unified BusEvent Type System (Atomic CLI Side)

The unified event type system is defined in `services/events/bus-events/`:

```typescript
// types.ts:17-23
export interface BusEvent<T extends BusEventType = BusEventType> {
  type: T;
  sessionId: string;
  runId: number;
  timestamp: number;
  data: BusEventDataMap[T];
}
```

30 event types categorized as:

| Category          | Event Types                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Text              | `stream.text.delta`, `stream.text.complete`                                                           |
| Thinking          | `stream.thinking.delta`, `stream.thinking.complete`                                                   |
| Tool              | `stream.tool.start`, `stream.tool.complete`, `stream.tool.partial_result`                             |
| Agent             | `stream.agent.start`, `stream.agent.update`, `stream.agent.complete`                                  |
| Session lifecycle | `stream.session.start/idle/partial-idle/error/retry/info/warning/title_changed/truncation/compaction` |
| Turn lifecycle    | `stream.turn.start`, `stream.turn.end`                                                                |
| Interaction       | `stream.permission.requested`, `stream.human_input_required`                                          |
| Telemetry         | `stream.skill.invoked`, `stream.usage`                                                                |

`EnrichedBusEvent` extends `BusEvent` with adapter-side correlation metadata (`resolvedToolId`, `resolvedAgentId`, `isSubagentTool`, `suppressFromMainChat`, `parentAgentId`).

---

## 10. Stream Adapter Implementations (Atomic CLI Side)

All three adapters implement `SDKStreamAdapter` (`services/events/adapters/types.ts:16-35`):

```typescript
export interface SDKStreamAdapter {
  startStreaming(session: Session, message: string, options: StreamAdapterOptions): Promise<void>;
  dispose(): void;
}
```

`StreamAdapterOptions` includes `runId` (monotonically increasing per stream for staleness detection), `messageId`, optional `abortSignal`, and `runtimeFeatureFlags`.

### Claude Adapter (`providers/claude.ts`)

- Wraps the Claude Agent SDK
- Creates a **correlating bus proxy** that intercepts `publish()` to enrich events with adapter-side correlation metadata
- Maintains: `ClaudeToolState`, `ClaudeAdapterSupport`, `ClaudeStreamChunkProcessor`, `ClaudeToolHookHandlers`, `ClaudeAuxEventHandlers`, `ClaudeSubagentEventHandlers`
- `SubagentToolTracker` for background/sub-agent tool lifecycles
- `turnMetadataState` for normalizing turn start/end IDs

### OpenCode Adapter (`providers/opencode.ts`)

- Same correlating-bus proxy pattern
- Requires `OpenCodeProviderEventSource` (`onProviderEvent()` method)
- `startStreaming()` resets state → publishes `stream.session.start` → subscribes to provider events → runs streaming runtime
- Routes events to `OpenCodeToolEventHandlers`, `OpenCodeAuxEventHandlers`, `OpenCodeSubagentEventHandlers`, `OpenCodeStreamChunkProcessor`

### Copilot Adapter (`providers/copilot.ts`)

- Thinnest adapter — delegates entirely to `startCopilotStreaming()` and `disposeCopilotStreamAdapter()`

---

## 11. EventBus Dispatch Mechanism (Atomic CLI Side)

`EventBus` class (`services/events/event-bus.ts:85`):

- Typed subscriptions: `handlers: Map<BusEventType, Set<BusHandler>>`
- Wildcard subscriptions: `wildcardHandlers: Set<WildcardHandler>`

`publish()` flow:
1. Short-circuit if no handlers exist
2. Validate event payload against Zod schema (when `validatePayloads` enabled) — drop on failure
3. Dispatch to typed handlers with per-handler error isolation
4. Dispatch to wildcard handlers with per-handler error isolation

Handler errors are caught and logged but never propagate to the publisher.

---

## 12. Batch Dispatcher — Frame-Aligned Batching (Atomic CLI Side)

`BatchDispatcher` (`services/events/batch-dispatcher.ts:90`) — double-buffer swap pattern:

- **Write buffer** accumulates events via `enqueue()`
- **Read buffer** receives swap during `flush()`
- **Flush interval**: 16ms (~60fps)

Key behaviors:
- **Coalescing**: State events with the same `coalescingKey` replace earlier events in-place
- **No coalescing for text deltas**: `coalescingKey()` returns `undefined` for `stream.text.delta`
- **Stale delta filtering**: `stream.text.complete` supersedes buffered `stream.text.delta` events
- **Buffer overflow**: Max 10,000 events; oldest non-lifecycle events dropped first
- **Auto-start/stop**: Flush timer starts on first enqueue; immediate flush if enough time elapsed

---

## 13. Stream Part Ordering (Atomic CLI Side)

No explicit sequence numbers. Ordering maintained through three mechanisms:

### A. Temporal ordering via monotonic IDs (OpenCode backend)
`PartID.ascending()` encodes timestamp + counter into ID → lexicographic sort = chronological order.

### B. Insertion-order preservation (Atomic CLI)
`createPartId()` (`state/parts/id.ts:20-24`) generates `part_<12-hex-timestamp>_<4-hex-counter>`. Parts in `ChatMessage.parts` maintained in insertion order. `applyStreamPartEvent()` reducer appends new parts or upserts by `toolCallId`.

### C. runId-based staleness (Atomic CLI)
`runId` on each `BusEvent` is monotonically increasing per stream. `shouldProcessStreamPartEvent()` checks that a part's `runId` matches the active run, preventing stale events from corrupting state.

---

## 14. Stream Lifecycle (Start → Parts → Finalize)

### Start Phase
1. Adapter's `startStreaming()` called with `Session`, `message`, and `StreamAdapterOptions`
2. Adapter resets internal state
3. Publishes `stream.session.start`
4. Subscribes to native event source

### Parts Phase
1. SDK chunks arrive → adapter normalizes into `BusEvent` objects
2. Events flow through `BatchDispatcher.enqueue()` (coalescing + scheduling)
3. On flush, `StreamPipelineConsumer.processBatch()` maps `BusEvent[]` → `StreamPartEvent[]`
4. Adjacent text/thinking deltas within a batch are coalesced
5. `applyStreamPartEvent()` reduces each event into `ChatMessage` state

### Finalize Phase
1. Adapter publishes `stream.session.idle` / `partial-idle` / `error`
2. Publishes `stream.text.complete` to flush remaining text
3. Calls `cleanupOrphanedTools()` and `flushOrphanedAgentCompletions()`
4. `useChatAgentStreamFinalization` watches for all agents/tools terminal → finalizes message

---

## 15. Data Flow Summary

```
User submits message
  → adapter.startStreaming(session, message, options)
  → adapter resets state, publishes stream.session.start
  → adapter connects to SDK (SSE for OpenCode, AsyncIterable for Claude, EventEmitter for Copilot)
  → SDK emits stream chunks
  → adapter normalizes to BusEvent, publishes through correlating proxy
  → BatchDispatcher enqueues (coalescing, 16ms flush)
  → StreamPipelineConsumer maps BusEvent[] → StreamPartEvent[]
  → applyStreamPartEvent() reduces into ChatMessage state
  → Session lifecycle events trigger finalization
  → useChatAgentStreamFinalization detects terminal state, resolves run
```

---

## 16. Actionable Model for Atomic CLI TUI

| Pattern                     | OpenCode Implementation                                                    | Atomic CLI Analog                                                                      |
| --------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Ordering**                | Monotonic ascending IDs (`PartID.ascending()`)                             | `createPartId()` in `state/parts/id.ts` — already exists                               |
| **Part lifecycle**          | Unified `ToolPart` with state machine (`pending→running→completed\|error`) | Model in `state/parts/types.ts`                                                        |
| **Two persistence paths**   | `updatePart` (structural) vs `updatePartDelta` (streaming text)            | `BusEvent` types: `stream.tool.start/complete` vs `stream.text.delta` — already exists |
| **Binary search insertion** | `Binary.search()` for sorted client-side arrays                            | Implement in part store or use existing `applyStreamPartEvent` reducer                 |
| **Event batching**          | 16ms coalescing with `batch()`                                             | `BatchDispatcher` at 16ms — already exists                                             |
| **Question tool**           | Deferred-based blocking + `Asked/Replied/Rejected` events                  | Map to `stream.human_input_required` BusEvent                                          |
| **Finalization**            | Orphan cleanup + message completion timestamp                              | `useChatAgentStreamFinalization` — already exists                                      |

### Key Insight

Ordering is an **emergent property** of monotonic IDs + sorted insertion, not explicit sequence numbers. The rest is a clean event pipeline: SDK → adapter → bus → batch → reducer → reactive store → UI.

---

## Key Files Reference

### OpenCode Backend
- `/home/alilavaee/Documents/projects/opencode/packages/opencode/src/session/processor.ts` — SessionProcessor (stream chunk processing)
- `/home/alilavaee/Documents/projects/opencode/packages/opencode/src/session/prompt.ts` — SessionPrompt.loop() (conversation loop)
- `/home/alilavaee/Documents/projects/opencode/packages/opencode/src/session/llm.ts` — LLM.stream() (AI SDK streamText wrapper)
- `/home/alilavaee/Documents/projects/opencode/packages/opencode/src/session/message-v2.ts` — MessageV2 types (Part, TextPart, ToolPart, events)
- `/home/alilavaee/Documents/projects/opencode/packages/opencode/src/session/schema.ts` — SessionID/MessageID/PartID branded types
- `/home/alilavaee/Documents/projects/opencode/packages/opencode/src/session/session.sql.ts` — SQLite schema
- `/home/alilavaee/Documents/projects/opencode/packages/opencode/src/id/id.ts` — Identifier.ascending() monotonic ID generation
- `/home/alilavaee/Documents/projects/opencode/packages/opencode/src/bus/index.ts` — Backend Bus pub/sub
- `/home/alilavaee/Documents/projects/opencode/packages/opencode/src/server/server.ts` — SSE endpoint at `/event`

### Atomic CLI (code-cleanup)
- `src/services/events/bus-events/schemas.ts` — 30 BusEvent Zod schemas
- `src/services/events/bus-events/types.ts` — BusEvent interface and type mappings
- `src/services/events/event-bus.ts` — EventBus pub/sub implementation
- `src/services/events/batch-dispatcher.ts` — Frame-aligned batching with coalescing
- `src/services/events/adapters/types.ts` — SDKStreamAdapter interface
- `src/services/events/adapters/providers/claude.ts` — Claude adapter
- `src/services/events/adapters/providers/opencode.ts` — OpenCode adapter
- `src/services/events/adapters/providers/copilot.ts` — Copilot adapter
- `src/services/events/consumers/stream-pipeline-consumer.ts` — BusEvent-to-StreamPartEvent consumer
- `src/services/events/registry/registry.ts` — EventHandlerRegistry singleton
- `src/state/streaming/pipeline.ts` — applyStreamPartEvent reducer
- `src/state/streaming/pipeline-types.ts` — StreamPartEvent union type
- `src/state/parts/types.ts` — Part discriminated union
- `src/state/parts/id.ts` — Monotonic PartId generation
- `src/state/chat/shared/helpers/stream.ts` — Stream lifecycle predicates
- `src/state/chat/agent/use-stream-finalization.ts` — Stream finalization effect
