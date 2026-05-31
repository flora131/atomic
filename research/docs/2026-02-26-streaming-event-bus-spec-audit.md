---
date: 2026-02-26 16:12:17 UTC
researcher: Copilot
git_commit: 5592d690d176d3dc67a89fbeec1528567b4e5098
branch: lavaman131/feature/workflow-sdk
repository: workflow-sdk
topic: "Streaming Architecture Event Bus Migration - Spec Compliance Audit"
tags: [research, codebase, event-bus, streaming, spec-audit, migration, adapters, consumers, hooks]
status: complete
last_updated: 2026-02-26
last_updated_by: Copilot
---

# Streaming Event Bus Spec Compliance Audit

## Research Question

Review the correctness of the current `src/events/` implementation against the spec `specs/2026-03-02-streaming-architecture-event-bus-migration.md`, identify missing logic and errors, and reference OpenCode's event-bus patterns for design validation.

## Summary

The implementation covers the core event bus infrastructure faithfully—bus-events types (Section 5.1.1), AtomicEventBus (5.1.2), coalescing (5.1.3), and BatchDispatcher (5.1.4) all match the spec closely. The SDK adapters (5.2) correctly implement streaming-to-event translation for OpenCode, Claude, Copilot, and Workflow scenarios. Consumer services (5.3–5.5) implement the spec's intent but with API simplifications. React hooks (5.7) and the provider component match the spec's lifecycle pattern. Two confirmed **bugs** exist in adapter dispose() methods, and the CorrelationService has a significantly **simplified API** compared to the spec's detailed contract.

---

## Spec Compliance Matrix

### ✅ Fully Matches Spec

| Component | Spec Section | Status | Notes |
|-----------|-------------|--------|-------|
| BusEventType union (19 types) | 5.1.1 | ✅ Match | All 19 types present |
| BusEvent interface | 5.1.1 | ✅ Match | type, sessionId, runId, timestamp, data |
| BusEventDataMap payloads | 5.1.1 | ✅ Match | All payload shapes match spec |
| EnrichedBusEvent interface | 5.1.1 | ✅ Match | resolvedToolId, resolvedAgentId, isSubagentTool, suppressFromMainChat |
| Zod schemas (19 schemas) | 5.1.1 | ✅ Match | defineBusEvent() with schema validation |
| defineBusEvent() factory | 5.1.1 | ✅ Match | Mirrors OpenCode's BusEvent.define() pattern |
| AtomicEventBus.on() | 5.1.2 | ✅ Match | Type-safe subscription, returns unsubscribe |
| AtomicEventBus.onAll() | 5.1.2 | ✅ Match | Wildcard subscription |
| AtomicEventBus.publish() | 5.1.2 | ✅ Match | Zod validation + error isolation per handler |
| AtomicEventBus.clear() | 5.1.2 | ✅ Match | Clears all handlers |
| coalescingKey() | 5.1.3 | ✅ Match | text/thinking → null (never coalesce), state events → entity key |
| BatchDispatcher double-buffer | 5.1.4 | ✅ Match | Swap pattern avoids allocation on flush |
| BatchDispatcher 16ms flush | 5.1.4 | ✅ Match | ~60fps frame alignment |
| BatchDispatcher coalescing map | 5.1.4 | ✅ Match | Key-based deduplication for state events |
| EchoSuppressor | 5.4 | ✅ Match | FIFO queue, accumulator, filterDelta, reset |
| EventBusProvider | 5.7 | ✅ Match | React context with useMemo singleton |
| useEventBus() hook | 5.7 | ✅ Match | Context accessor shorthand |
| useBusSubscription() hook | 5.7 | ✅ Match | Type-safe sub with ref + auto-cleanup |
| useBusWildcard() hook | 5.7 | ✅ Match | Wildcard sub with ref + auto-cleanup |
| attachDebugSubscriber() | 7.2 | ✅ Match | Conditional on ATOMIC_DEBUG=1, console.debug |

### ⚠️ Deviates from Spec (Intentional Simplifications)

| Component | Spec Section | Deviation | Impact |
|-----------|-------------|-----------|--------|
| CorrelationService API | 5.3 | Uses `enrich(event)` + `registerTool()` instead of spec's `processBatch()` / `startRun()` / `isOwnedEvent()` | Missing run ownership tracking; simplified but functional |
| CorrelationService state | 5.3 | Has `toolToAgent`, `subAgentTools`, `mainAgentId` instead of spec's `sdkToolIdMap`, `toolCallToAgentMap`, `subagentSessionToAgentId`, `pendingTaskEntries`, `ownedSessionIds`, `toolIdToRunMap`, `activeRunId` | Reduced capability for multi-agent correlation |
| StreamPipelineConsumer | 5.5 | Uses `onStreamParts(callback)` pattern instead of spec's direct `setMessages` React dispatch | Architectural difference; callback is more flexible |
| useStreamConsumer() return | 5.7 | Returns `{ resetConsumers }` instead of spec's `{ startStreaming, stopStreaming, isStreaming }` | Missing streaming lifecycle control from hook |
| Workflow adapter | 5.2 | Producer-side helper with `publishStepStart/publishStepComplete/publishTaskUpdate/publishAgentStart/publishAgentUpdate/publishAgentComplete` methods instead of spec's `streamWithEvents()` AsyncGenerator wrapper | Different pattern; method-based vs generator-based |
| Claude adapter tool events | 5.2 | Comment says tool events "handled at higher level" — adapter only processes text/thinking from stream | Spec says adapters should be SOLE consumers of SDK events |
| Debug subscriber | 7.2 | Only console.debug logging; no event replay or JSONL dump capability | Missing observability features |

### 🐛 Bugs Found

| Bug | File | Line | Severity | Details |
|-----|------|------|----------|---------|
| dispose() null reference | `opencode-adapter.ts` | ~197 | **High** | When `dispose()` called during active streaming, sets `this.abortController = null`. Error handler subsequently tries `this.abortController.signal.aborted` → `TypeError: Cannot read properties of null`. Test is **SKIPPED** documenting this. |
| dispose() null reference | `claude-adapter.ts` | ~111 | **High** | Same null reference pattern as OpenCode adapter. Test is **SKIPPED** documenting this. |
| Missing Zod validation tests | `event-bus.test.ts` | — | **Medium** | No tests for: schema validation failure, early return on invalid events, or validation error logging. `publish()` does validate but correctness is unverified. |

### 📋 Missing from Spec (Not Yet Implemented)

| Feature | Spec Section | Description |
|---------|-------------|-------------|
| `CorrelationService.startRun()` | 5.3 | Register a new run for ownership tracking |
| `CorrelationService.isOwnedEvent()` | 5.3 | Check if event belongs to current run |
| `CorrelationService.activeRunId` | 5.3 | Track currently active run |
| `CorrelationService.ownedSessionIds` | 5.3 | Track sessions owned by current user |
| `useStreamConsumer().startStreaming` | 5.7 | Start streaming from hook |
| `useStreamConsumer().stopStreaming` | 5.7 | Stop streaming from hook |
| `useStreamConsumer().isStreaming` | 5.7 | Streaming state from hook |
| Event replay capability | 7.2 | Replay events for debugging |
| JSONL dump capability | 7.2 | Export events for analysis |

---

## Detailed Findings

### 1. Bus Events (bus-events.ts) — Section 5.1.1

**Location:** `src/events/bus-events.ts` (515 lines)

All 19 `BusEventType` union members match the spec:
- Stream events: `stream.text.delta`, `stream.text.complete`, `stream.thinking.delta`, `stream.thinking.complete`
- Tool events: `stream.tool.start`, `stream.tool.complete`
- Agent events: `stream.agent.start`, `stream.agent.update`, `stream.agent.complete`
- Session events: `session.status`, `session.error`
- Stream lifecycle: `stream.start`, `stream.end`, `stream.abort`, `stream.error`
- UI events: `ui.scroll.lock`, `ui.scroll.unlock`
- Workflow events: `workflow.step.start`, `workflow.step.complete`

`BusEvent` interface has correct shape: `{ type, sessionId, runId, timestamp, data }`.

`EnrichedBusEvent` extends `BusEvent` with: `resolvedToolId?`, `resolvedAgentId?`, `isSubagentTool?`, `suppressFromMainChat?`.

`defineBusEvent()` factory creates typed event constructors with Zod validation — matches OpenCode's `BusEvent.define()` pattern.

**BusEventDataMap** payloads match spec for all 19 event types.

### 2. Event Bus Core (event-bus.ts) — Section 5.1.2

**Location:** `src/events/event-bus.ts` (139 lines)

`AtomicEventBus` class implements:
- `on(type, handler)` → type-safe subscription, returns `() => void` unsubscribe
- `onAll(handler)` → wildcard subscription
- `publish(event)` → Zod validation + synchronous dispatch with `try/catch` per handler (error isolation)
- `clear()` → removes all handlers
- `hasHandlers(type?)` / `handlerCount(type?)` → introspection methods

**Validation behavior:** `publish()` validates against Zod schema. On failure, logs warning and returns early (event not dispatched). This matches spec intent but **no tests verify this path**.

**No singleton pattern** — managed externally via React context provider. This matches spec's decision to use React context (Section 5.7).

### 3. Coalescing (coalescing.ts) — Section 5.1.3

**Location:** `src/events/coalescing.ts` (78 lines)

`coalescingKey()` function matches spec exactly:
- `stream.text.delta` / `stream.thinking.delta` → returns `null` (never coalesced, each delta is additive)
- `stream.tool.start` / `stream.tool.complete` → coalesce by `toolId`
- `stream.agent.start` / `stream.agent.update` / `stream.agent.complete` → coalesce by `agentId`
- `session.status` → coalesce by `sessionId`
- `session.error` → coalesce by `sessionId`
- All other events → returns `null`

Test coverage is comprehensive with 78 lines of tests verifying each event type mapping.

### 4. Batch Dispatcher (batch-dispatcher.ts) — Section 5.1.4

**Location:** `src/events/batch-dispatcher.ts` (177 lines)

`BatchDispatcher` implements:
- **Double-buffer swap:** `frontBuffer` and `backBuffer` arrays swapped on flush (no allocation)
- **16ms flush interval:** `BATCH_INTERVAL = 16` matching ~60fps
- **Coalescing map:** Uses `coalescingKey()` to deduplicate state events within a batch
- **Consumer array:** `subscribe(consumer)` adds consumers, called on flush
- **Metrics:** `BatchMetrics` tracks totalFlushed, totalCoalesced, totalDropped, flushCount (bonus, not in spec)
- **Lifecycle:** `start()` / `stop()` / `dispose()` for explicit lifecycle management

**Constructor:** Takes `bus: AtomicEventBus` parameter. In `wireConsumers()`, the bus's `onAll()` feeds events into `dispatcher.enqueue()`. Spec shows bus publishing directly to dispatcher — functionally equivalent.

### 5. SDK Adapters — Section 5.2

#### 5.1 OpenCode Adapter (`opencode-adapter.ts`, 221 lines)

Maps 9 SDK event types to BusEvents via `startStreaming(session)`:
- Text chunks → `stream.text.delta` + `stream.text.complete`
- Thinking chunks → `stream.thinking.delta` + `stream.thinking.complete`
- Tool events (via client EventEmitter) → `stream.tool.start` / `stream.tool.complete`
- Sub-agent events → `stream.agent.start` / `stream.agent.complete`
- Session events → `session.status`

**🐛 BUG:** `dispose()` sets `this.abortController = null` at line ~197. If called during active streaming, the error handler's `catch` block tries `this.abortController.signal.aborted` → `TypeError`. The test documenting this is **SKIPPED** with comment explaining the issue.

#### 5.2 Claude Adapter (`claude-adapter.ts`, 138 lines)

Maps text/thinking from stream to BusEvents:
- Text chunks → `stream.text.delta` + `stream.text.complete`
- Thinking chunks → `stream.thinking.delta` + `stream.thinking.complete`

**⚠️ Deviation:** Comment says tool and agent events are "handled at higher level" — adapter only processes the stream's text/thinking content. Spec says adapters should be the **sole consumers** of SDK events.

**🐛 BUG:** Same `dispose()` null reference pattern as OpenCode adapter. Test is **SKIPPED**.

#### 5.3 Copilot Adapter (`copilot-adapter.ts`, 196 lines)

Maps 7 SDK event types to BusEvents:
- Text chunks → `stream.text.delta` + `stream.text.complete`
- Thinking chunks → `stream.thinking.delta` + `stream.thinking.complete`
- Tool events → `stream.tool.start` / `stream.tool.complete`
- Sub-agent events → `stream.agent.start` / `stream.agent.complete`

**Notable:** Implements **backpressure** via bounded buffer (`MAX_BUFFER_SIZE = 1000`) with FIFO drop. This matches spec's backpressure guidance.

#### 5.4 Workflow Adapter (`workflow-adapter.ts`, ~120 lines)

Producer-side helper with explicit publish methods:
- `publishStepStart()`, `publishStepComplete()`
- `publishTaskUpdate()`
- `publishAgentStart()`, `publishAgentUpdate()`, `publishAgentComplete()`

**⚠️ Deviation:** Spec describes `streamWithEvents()` AsyncGenerator wrapper pattern. Implementation uses method-based publisher pattern instead. Both achieve same goal of translating workflow events to BusEvents.

### 6. Consumer Services — Sections 5.3–5.5

#### 6.1 CorrelationService (`correlation-service.ts`) — Section 5.3

**⚠️ Major Deviation:** The spec describes a rich API:
```typescript
// Spec contract (Section 5.3)
class CorrelationService {
  startRun(runId, sessionId): void
  processBatch(events): EnrichedBusEvent[]
  isOwnedEvent(event): boolean
  reset(): void
  // Properties: sdkToolIdMap, toolCallToAgentMap, subagentSessionToAgentId,
  //             pendingTaskEntries, ownedSessionIds, toolIdToRunMap, activeRunId
}
```

The implementation has:
```typescript
// Actual API
class CorrelationService {
  registerTool(toolId, agentId, isSubagent): void
  enrich(event: BusEvent): EnrichedBusEvent
  reset(): void
  // Properties: toolToAgent, subAgentTools, mainAgentId
}
```

**Missing:** `startRun()`, `isOwnedEvent()`, `activeRunId`, `ownedSessionIds`, `processBatch()`. The `enrich()` method processes single events vs spec's `processBatch()` for batches. Run ownership tracking is absent.

#### 6.2 EchoSuppressor (`echo-suppressor.ts`) — Section 5.4

Fully matches spec:
- `expectEcho(resultText)` — registers expected echo text in FIFO queue
- `filterDelta(delta)` — returns filtered delta (empty if suppressed, accumulated text if diverged)
- `reset()` — clears all state
- `hasPendingTargets` — getter for pending state
- Uses prefix-matching with accumulator to handle deltas that arrive character-by-character

#### 6.3 StreamPipelineConsumer (`stream-pipeline-consumer.ts`) — Section 5.5

Implements event-to-StreamPartEvent transformation:
- `processBatch(events: EnrichedBusEvent[])` — maps events via switch/case
- `onStreamParts(callback)` — registers output callback
- `mapToStreamPart(event)` — maps individual events:
  - `stream.text.delta` → `text-delta` (with echo suppression)
  - `stream.thinking.delta` → `thinking-meta`
  - `stream.tool.start` → `tool-start`
  - `stream.tool.complete` → `tool-complete`
  - All others → `null` (ignored)
- `reset()` — delegates to echoSuppressor.reset() + correlation.reset()

**⚠️ Deviation:** Spec says `processBatch()` should call `setMessages(activeMessageId, updater)` directly. Implementation uses callback `onStreamParts(callback)` pattern — more decoupled but requires external wiring.

#### 6.4 wireConsumers (`wire-consumers.ts`)

Wires the complete pipeline:
```
bus.onAll() → dispatcher.enqueue()
dispatcher.subscribe(batch => {
  enriched = batch.map(e => correlation.enrich(e))
  pipeline.processBatch(enriched)
})
```
Returns `{ correlation, echoSuppressor, pipeline, dispose }`.

### 7. React Integration — Section 5.7

#### EventBusProvider (`event-bus-provider.tsx`, 120 lines)

Creates singleton `AtomicEventBus` + `BatchDispatcher` via `useMemo([], [])`. Context throws if used outside provider. Matches spec pattern.

#### useStreamConsumer Hook (`hooks.ts:211-242`)

**⚠️ Deviation:** Spec signature:
```typescript
// Spec
useStreamConsumer(onStreamParts): { startStreaming, stopStreaming, isStreaming }
```

Implementation:
```typescript
// Actual
useStreamConsumer(onStreamParts): { resetConsumers }
```

Missing `startStreaming`, `stopStreaming`, and `isStreaming` — these would provide streaming lifecycle control from within the hook. Currently streaming is started externally via adapters.

### 8. Debug Subscriber (`debug-subscriber.ts`) — Section 7.2

`attachDebugSubscriber(bus)` — conditional on `ATOMIC_DEBUG=1`, logs all events via `console.debug` with timestamp, type, runId, and data preview (100 char truncation).

**⚠️ Deviation:** Spec mentions event replay capability and JSONL dump for debugging. Implementation only provides console logging.

---

## OpenCode Pattern Validation

Research into OpenCode's event-bus architecture (via DeepWiki analysis of `anomalyco/opencode`) confirms the following design decisions align:

1. **In-process pub/sub** — OpenCode uses `EventBus<TEvent>` with typed `subscribe(handler)` and `publish(event)`. Our `AtomicEventBus` follows the same pattern.

2. **Zod validation** — OpenCode uses `BusEvent.define({ type, schema })` factory. Our `defineBusEvent()` mirrors this exactly.

3. **Batch processing** — OpenCode batches UI updates. Our `BatchDispatcher` with 16ms flush matches this pattern.

4. **Error isolation** — OpenCode wraps handlers in try/catch. Our `publish()` does the same per handler.

5. **No singleton** — OpenCode creates bus instances per context. Our provider pattern matches.

See: `research/docs/2026-02-26-opencode-event-bus-patterns.md` for full OpenCode architecture documentation.

---

## Code References

### Bugs
- `src/events/adapters/opencode-adapter.ts:~197` — dispose() null reference on abortController
- `src/events/adapters/claude-adapter.ts:~111` — dispose() null reference on abortController

### Spec Deviations
- `src/events/consumers/correlation-service.ts` — Simplified API vs spec Section 5.3
- `src/events/consumers/stream-pipeline-consumer.ts` — Callback pattern vs spec's direct setMessages
- `src/events/hooks.ts:211-242` — useStreamConsumer missing startStreaming/stopStreaming/isStreaming
- `src/events/adapters/claude-adapter.ts` — Tool events not handled in adapter
- `src/events/adapters/workflow-adapter.ts` — Method-based vs AsyncGenerator pattern

### Fully Compliant
- `src/events/bus-events.ts` — All 19 types, schemas, interfaces
- `src/events/event-bus.ts` — AtomicEventBus core
- `src/events/coalescing.ts` — Coalescing key logic
- `src/events/batch-dispatcher.ts` — Double-buffer, 16ms flush, coalescing
- `src/events/consumers/echo-suppressor.ts` — FIFO suppress, accumulator, filterDelta
- `src/events/event-bus-provider.tsx` — React context provider
- `src/events/debug-subscriber.ts` — Conditional debug logging
- `src/events/hooks.ts:71-171` — useEventBus, useBusSubscription, useBusWildcard

### Integration Tests
- `src/events/integration.test.ts` (665 lines) — 8 test scenarios covering full pipeline, text deltas, tool lifecycle, echo suppression, multi-adapter, batch coalescing, thinking deltas, sub-agent lifecycle

---

## Architecture Documentation

### Event Flow (Current Implementation)

```
SDK Stream/Events
       ↓
SDK Adapter (opencode/claude/copilot/workflow)
       ↓
bus.publish(busEvent)       ← Zod validation here
       ↓
AtomicEventBus
       ↓
bus.onAll() → dispatcher.enqueue()    ← wireConsumers() sets this up
       ↓
BatchDispatcher (16ms flush, coalescing, double-buffer)
       ↓
correlation.enrich(event)  → EnrichedBusEvent
       ↓
StreamPipelineConsumer.processBatch(enrichedEvents)
       ↓
onStreamParts callback → StreamPartEvent[]
       ↓
React component state update
```

### Key Design Decisions (Validated Against OpenCode)

1. **No SSE/WebSocket** — In-process pub/sub is correct for single-process TUI
2. **Zod validation at publish boundary** — Matches OpenCode's validation pattern
3. **Handler ref pattern in hooks** — Prevents React re-subscription churn
4. **Callback pattern for StreamPipelineConsumer** — More flexible than direct setMessages
5. **Method-based workflow adapter** — Simpler than AsyncGenerator for discrete events

---

## Historical Context (from research/)

- `research/docs/2026-02-26-opencode-event-bus-patterns.md` — OpenCode event-bus architecture deep-dive, confirming design alignment

---

## Related Research

- `specs/2026-03-02-streaming-architecture-event-bus-migration.md` — Source spec (908 lines)
- `research/docs/2026-02-26-opencode-event-bus-patterns.md` — OpenCode patterns reference

---

## Open Questions

1. **CorrelationService scope:** Is the simplified API (enrich/registerTool/reset) intentionally minimal for Phase 1, or should it be expanded to match spec's full contract (startRun/isOwnedEvent/activeRunId)?

2. **Claude adapter tool events:** Where are tool events actually handled if not in the adapter? Is there a higher-level wiring that the spec doesn't account for?

3. **useStreamConsumer lifecycle:** Should startStreaming/stopStreaming/isStreaming be added to the hook, or is external adapter control the preferred pattern?

4. **Dispose() bug fix strategy:** Should dispose() guard against null abortController, or should streaming be guaranteed complete before dispose()?

5. **Debug subscriber extensions:** Are event replay and JSONL dump features planned for a later phase?
