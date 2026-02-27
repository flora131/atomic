# Debugger Agent Memory

## Key Architecture Patterns

### Event Delivery Pipeline (Two Paths)
The event bus has two delivery paths that can cause race conditions:
1. **Direct bus subscriptions** (`useBusSubscription` / `bus.on()`) - synchronous, immediate
2. **Batched delivery** (`bus.onAll()` -> `BatchDispatcher.enqueue()` -> 16ms flush -> `StreamPipelineConsumer`) - delayed

Text deltas (`stream.text.delta`) are consumed ONLY through the batched path (via `StreamPipelineConsumer`), while completion events (`stream.text.complete`, `stream.session.idle`) are consumed via BOTH paths. The direct subscription fires immediately, so it can race ahead of unprocessed batched deltas.

**Fix pattern**: Call `batchDispatcher.flush()` synchronously before any stream finalization that sets `isStreaming=false` or nulls `streamingMessageIdRef`.

### Stream Finalization: text-complete vs session.idle
- `stream.text.complete` now flows through the BATCHED pipeline (since c5cd49e) and calls `handleStreamComplete` from inside `useStreamConsumer` callback
- `stream.session.idle` flows through DIRECT `useBusSubscription` and calls `batchDispatcher.flush()` + `handleStreamComplete`
- Claude adapter does NOT emit `session.idle` -- finalization relies solely on `text-complete`
- Copilot/OpenCode adapters emit BOTH `text-complete` and `session.idle`
- When both arrive, `text-complete` in the flush calls `handleStreamComplete` first; the idle handler's call is a no-op

### Bus.publish execution order
1. Typed handlers (`bus.on(type)`) fire first
2. Wildcard handlers (`bus.onAll()`) fire second
This is critical: session.idle typed handler runs flush() BEFORE the wildcard handler enqueues session.idle

### Copilot SDK Event Flow
SDK session `_dispatchEvent` -> wildcard handlers (in Set insertion order):
1. `wrapSession` handler (registered at session creation) -> `handleSdkEvent` -> `emitEvent` -> client-level handlers -> adapter bus events
2. `stream()` handler (registered when stream starts) -> pushes to generator chunks queue

### CorrelationService Ownership
- `resetConsumers()` (called in `startAssistantStream`) resets correlation, clearing `activeRunId` and `ownedSessionIds`
- Events are only processed if `isOwnedEvent()` returns true
- `stream.session.start` triggers `startRun()` which sets the new run ownership
- The batch consumer processes events IN ORDER, so session.start (first event) sets up ownership before text deltas are checked

### Key Files
- `src/events/adapters/copilot-adapter.ts` - Copilot stream adapter
- `src/events/batch-dispatcher.ts` - 16ms batched event delivery
- `src/events/coalescing.ts` - Event coalescing rules (text deltas never coalesced)
- `src/ui/chat.tsx` - Main chat UI with stream finalization logic
- `src/sdk/clients/copilot.ts` - Copilot client with session wrapping and stream generator
- `src/events/hooks.ts` - `useBusSubscription`, `useStreamConsumer` hooks
- `src/events/consumers/wire-consumers.ts` - Wires batch consumer pipeline
- `src/events/consumers/stream-pipeline-consumer.ts` - Maps BusEvents to StreamPartEvents
- `src/ui/parts/stream-pipeline.ts` - applyStreamPartEvent reducer

### Testing
- Use `bun test` for all tests (never npm/node)
- Adapter tests: `src/events/adapters/adapters.test.ts`
- Copilot client tests: `src/sdk/clients/copilot.test.ts`
- Pipeline consumer tests: `src/events/consumers/stream-pipeline-consumer.test.ts`
- Stream pipeline tests: `src/ui/parts/stream-pipeline.test.ts`

### Token Usage Event Pipeline
- `stream.usage` events flow via DIRECT path (`useBusSubscription` in chat.tsx) -- synchronous
- Adapters must emit cumulative (running-total) outputTokens, not per-call deltas
- chat.tsx uses `Math.max(prev, incoming)` to handle out-of-order delivery
- **Copilot**: `assistant.usage` = per-API-call tokens; adapter accumulates internally
- **OpenCode**: `message.updated` SSE = cumulative-within-message (fires multiple times per msg); adapter tracks lastSeen + accumulated to produce cross-message totals
- **Critical**: Copilot `session.usage_info` must NOT be mapped to `"usage"` -- it has `{currentTokens, tokenLimit}` shape, not `{inputTokens, outputTokens}`. Mapping it causes 0-valued stream.usage that overwrites real counts.
- OpenCode adapter must NOT emit stream.usage from processStreamChunk streamingStats (only from createUsageHandler) to avoid double-counting
- `stream.usage` coalesces by sessionId (`usage:${sessionId}`), so only the latest event survives a batch window -- safe since adapters emit cumulative values

### Claude Token Usage Bug (Diagnosed)
- **Root cause**: `processMessage()` emits `"usage"` event from `assistant` SDKMessages, but during streaming the `assistant` message is yielded at `content_block_stop` BEFORE `message_delta` arrives. The `message.usage.output_tokens` at that point equals the initial value from `message_start` (typically 1-2, NOT the real total).
- The SDK's inner stream MUTATES the already-yielded `assistant` message's `usage` field when `message_delta` arrives, but `processMessage` has already fired for the stale object.
- The `message_delta` arrives as `type: "stream_event"` which `processMessage` does NOT handle for usage.
- The stream generator tracks `message_delta.usage.output_tokens` in a local variable but only uses it for the final metadata yield, which the adapter ignores.
- The `SDKResultMessage` (type: "result") has `.usage` with correct totals but `processMessage` does not emit a "usage" event for it.
- **Fix**: Either (a) emit usage from `message_delta` stream_events in `processMessage`, (b) emit usage from the `result` message, or (c) have the stream generator yield a synthetic usage chunk from `message_delta` data.

### OpenTUI Rendering
- OpenTUI defers renders via `setTimeout` (not synchronous like React DOM)
- `flushSync` is available from `@opentui/react` to force immediate render commits
- State updates batched within synchronous execution may collapse intermediate render states
