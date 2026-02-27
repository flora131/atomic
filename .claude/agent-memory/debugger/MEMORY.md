# Debugger Agent Memory

## Key Architecture Patterns

### Event Delivery Pipeline (Two Paths)
The event bus has two delivery paths that can cause race conditions:
1. **Direct bus subscriptions** (`useBusSubscription` / `bus.on()`) - synchronous, immediate
2. **Batched delivery** (`bus.onAll()` -> `BatchDispatcher.enqueue()` -> 16ms flush -> `StreamPipelineConsumer`) - delayed

Text deltas (`stream.text.delta`) are consumed ONLY through the batched path (via `StreamPipelineConsumer`), while completion events (`stream.text.complete`, `stream.session.idle`) are consumed via BOTH paths. The direct subscription fires immediately, so it can race ahead of unprocessed batched deltas.

**Fix pattern**: Call `batchDispatcher.flush()` synchronously before any stream finalization that sets `isStreaming=false` or nulls `streamingMessageIdRef`.

### Copilot SDK Event Flow
SDK session `_dispatchEvent` -> wildcard handlers (in Set insertion order):
1. `wrapSession` handler (registered at session creation) -> `handleSdkEvent` -> `emitEvent` -> client-level handlers -> adapter bus events
2. `stream()` handler (registered when stream starts) -> pushes to generator chunks queue

### Key Files
- `src/events/adapters/copilot-adapter.ts` - Copilot stream adapter
- `src/events/batch-dispatcher.ts` - 16ms batched event delivery
- `src/events/coalescing.ts` - Event coalescing rules (text deltas never coalesced)
- `src/ui/chat.tsx` - Main chat UI with stream finalization logic
- `src/sdk/clients/copilot.ts` - Copilot client with session wrapping and stream generator
- `src/events/hooks.ts` - `useBusSubscription`, `useStreamConsumer` hooks

### Testing
- Use `bun test` for all tests (never npm/node)
- Adapter tests: `src/events/adapters/adapters.test.ts`
- Copilot client tests: `src/sdk/clients/copilot.test.ts`
