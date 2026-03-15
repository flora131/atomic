---
date: 2026-03-15 18:32:54 UTC
researcher: Claude Opus 4.6
git_commit: d3f22e2b5bf791dcc57580e001ac279c85390fce
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Spec 01: Streaming Pipeline - Unified event flow, adapters, and rendering"
tags: [spec, streaming, event-bus, adapters, rendering, v2]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude Opus 4.6
parent: 2026-03-15-atomic-v2-rebuild-spec-index.md
---

# Spec 01: Streaming Pipeline

## Current State

### Event Flow Architecture

The current streaming pipeline has 5 stages with 2 event translations:

```
SDK Native Events  →  SDKStreamAdapter  →  BusEvent  →  EventBus  →  Consumers/State
(provider-specific)    (per-provider)       (unified)    (pub/sub)    (reducers/UI)
```

**Stage 1: SDK Native Events** (3 different patterns)
- Claude: `session.stream()` returns `AsyncIterable<AgentMessage>`, supplemented by `client.on()` event handlers for lifecycle events
- OpenCode: `sdk.event.subscribe()` returns `AsyncGenerator` of typed events
- Copilot: `session.on()` EventEmitter pattern with callback handlers

**Stage 2: Provider Adapters** (~28 files across 3 providers)
- `services/events/adapters/providers/claude/` (9 files): streaming-runtime, stream-chunk-processor, handler-factory, subagent-event-handlers, aux-event-handlers, tool-hook-handlers, tool-state-events, tool-state, adapter-support
- `services/events/adapters/providers/opencode/` (9 files): streaming-runtime, stream-chunk-processor, handler-factory, subagent-event-handlers, aux-event-handlers, tool-event-handlers, child-session-sync, tool-state, adapter-support
- `services/events/adapters/providers/copilot/` (10 files): runtime, provider-router, message-tool-handlers, session-handlers, subagent-handlers, state, types, support, buffer

Each adapter translates its SDK's native events into `BusEvent` objects and publishes them to the event bus.

**Stage 3: Event Bus** (`services/events/`)
- `event-bus-provider.tsx` - React context provider wrapping the bus
- `bus-events/schemas.ts` - 28 Zod schemas defining the bus event types
- `bus-events/types.ts` - BusEvent, EnrichedBusEvent, BusHandler types
- `registry/` - Event handler registration with `handlers/` subdirectory
- `consumers/` - Pre-built event consumers

**Stage 4: Event Registry/Consumers**
- Registry handlers subscribe to specific BusEvent types
- Consumers aggregate events into state updates
- Debug subscriber logs all events in development

**Stage 5: State Reducers/UI**
- `state/streaming/` (1,853 lines) - Pipeline agents and tools
- `state/chat/stream/` (4,381 lines) - Stream lifecycle state
- `state/parts/` (893 lines) - Part accumulation and rendering
- Components subscribe to state and re-render

### Documented Instability Patterns

Based on research documents:

1. **Subagent Premature Completion** (5+ research docs, Feb 2026): Background agents marked as completed before their work is done, due to race conditions between `stream.agent.complete` events and actual stream finalization across SDKs.

2. **Event Ordering**: Provider adapters don't guarantee event ordering across tool starts/completions and text deltas. The `task-turn-normalization.ts` adapter exists specifically to work around ordering issues.

3. **Dual Event Translation**: Converting 25 `AgentEvent` types to 28 `BusEvent` types requires maintaining semantic equivalence across the mapping. `event-coverage-policy.ts` exists to audit coverage gaps.

4. **Tool ID Correlation**: Tool events use `toolUseId`, `toolUseID`, and `toolCallId` interchangeably across providers. The `sdkCorrelationId` field on BusEvents exists to map between them.

5. **Backpressure Absence**: No mechanism to slow down event production when the UI can't render fast enough. The `use-message-queue.ts` hook is a consumer-side buffer, not true backpressure.

---

## V2 Spec: Streaming Pipeline

### Design Principle: Single-Pass Event Flow

```
Provider SDK  →  ProviderAdapter  →  EventBus  →  Subscribers
(native API)     (single translation)  (typed pub/sub)  (state/UI)
```

Eliminate the dual event hierarchy. Provider adapters translate SDK events directly into `StreamEvent` (the unified type from Spec 00). No intermediate `AgentEvent` type exists.

### 1. Provider Adapter Contract

```typescript
// services/streaming/adapter.ts

interface ProviderAdapter {
  /**
   * Connect to a session and start streaming events.
   * Returns an AsyncIterable of StreamEvents that the caller can consume.
   * The adapter handles all SDK-specific translation internally.
   */
  stream(
    session: Session,
    message: string,
    options: StreamOptions,
  ): AsyncIterable<StreamEvent>;

  /**
   * Dispose of any internal state (unsubscribe from SDK events, etc.)
   */
  dispose(): void;
}

interface StreamOptions {
  runId: number;
  messageId: string;
  abortSignal?: AbortSignal;
  agent?: string;
}
```

**Key changes from current:**
- Adapters return `AsyncIterable<StreamEvent>` instead of pushing to the bus imperatively
- This makes adapters testable in isolation (just iterate and collect events)
- The bus subscription happens at the orchestration layer, not inside adapters
- No `StreamAdapterOptions` grab-bag - minimal, typed options

### 2. Event Bus

```typescript
// services/streaming/event-bus.ts

type StreamEventHandler<T extends StreamEventType = StreamEventType> =
  (event: Extract<StreamEvent, { type: T }>) => void;

interface EventBus {
  /** Subscribe to a specific event type */
  on<T extends StreamEventType>(type: T, handler: StreamEventHandler<T>): Unsubscribe;

  /** Subscribe to all events (for debugging/logging) */
  onAll(handler: (event: StreamEvent) => void): Unsubscribe;

  /** Publish a single event */
  emit(event: StreamEvent): void;

  /** Publish a batch of events (for adapters that buffer) */
  emitBatch(events: StreamEvent[]): void;

  /** Remove all subscribers */
  dispose(): void;
}

type Unsubscribe = () => void;
```

**Key changes from current:**
- No React context provider for the bus. The bus is a plain object created once and injected where needed.
- `emitBatch` for adapters that naturally produce events in bursts (reduces re-render churn)
- No `EnrichedBusEvent` with decorator fields (`resolvedToolId`, `suppressFromMainChat`). Enrichment happens at the subscriber level, not on the event itself.

### 3. Stream Orchestrator

The orchestrator is the single point that wires adapter → bus → state:

```typescript
// services/streaming/orchestrator.ts

interface StreamOrchestrator {
  /**
   * Start a new stream run. Returns a handle for tracking/cancellation.
   */
  startRun(
    session: Session,
    adapter: ProviderAdapter,
    message: string,
    options: RunOptions,
  ): StreamRunHandle;
}

interface RunOptions {
  messageId: string;
  abortSignal?: AbortSignal;
  agent?: string;
}

interface StreamRunHandle {
  readonly runId: number;
  readonly done: Promise<StreamRunResult>;
  abort(): void;
}

interface StreamRunResult {
  success: boolean;
  error?: string;
  eventCount: number;
  durationMs: number;
}
```

Implementation sketch:

```typescript
function createStreamOrchestrator(bus: EventBus): StreamOrchestrator {
  let nextRunId = 1;

  return {
    startRun(session, adapter, message, options) {
      const runId = nextRunId++;
      const controller = new AbortController();

      // Link external abort signal
      options.abortSignal?.addEventListener("abort", () => controller.abort());

      const done = (async () => {
        let eventCount = 0;
        const start = Date.now();

        try {
          for await (const event of adapter.stream(session, message, {
            runId,
            messageId: options.messageId,
            abortSignal: controller.signal,
            agent: options.agent,
          })) {
            // Validate event schema
            const parsed = StreamEventSchema.safeParse(event);
            if (!parsed.success) {
              console.warn("Invalid event from adapter:", parsed.error);
              continue;
            }
            bus.emit(parsed.data);
            eventCount++;
          }
          return { success: true, eventCount, durationMs: Date.now() - start };
        } catch (err) {
          if (controller.signal.aborted) {
            return { success: false, error: "aborted", eventCount, durationMs: Date.now() - start };
          }
          bus.emit({
            type: "session.error",
            sessionId: session.id,
            runId,
            timestamp: Date.now(),
            data: { error: err instanceof Error ? err.message : String(err) },
          });
          return { success: false, error: String(err), eventCount, durationMs: Date.now() - start };
        }
      })();

      return { runId, done, abort: () => controller.abort() };
    },
  };
}
```

### 4. Adapter Implementation Pattern

Each provider adapter follows the same pattern - an async generator that yields StreamEvents:

```typescript
// services/streaming/adapters/claude-adapter.ts

function createClaudeAdapter(client: ClaudeAgentSDKClient): ProviderAdapter {
  return {
    async *stream(session, message, options) {
      // Emit session start
      yield makeEvent("session.start", options, {});

      // Start the SDK stream
      const sdkStream = session.stream(message, {
        agent: options.agent,
        abortSignal: options.abortSignal,
      });

      // Track tool state locally (not on the event)
      const toolState = new Map<string, { name: string; startTime: number }>();

      for await (const chunk of sdkStream) {
        // Translate SDK chunk → StreamEvent(s)
        // A single SDK chunk may produce 0-N StreamEvents
        yield* translateChunk(chunk, options, toolState);
      }

      // Emit session idle
      yield makeEvent("session.idle", options, { reason: "stream-complete" });
    },
    dispose() { /* cleanup SDK handlers */ },
  };
}
```

**Key improvements over current:**
- Each adapter is a single file with a single async generator function
- No separate handler-factory, streaming-runtime, chunk-processor files
- Tool state is local to the adapter (Map), not a separate module
- Subagent events are translated inline, not in a separate handler file
- No imperative bus.emit() calls - just `yield` statements

### 5. Interaction Layer (Permissions/Human Input)

**Problem**: The current system puts `respond` callback functions inside event data, which breaks serialization and creates coupling between the event producer and consumer.

**Spec**: Separate the interaction layer from the event stream.

```typescript
// services/streaming/interaction.ts

interface InteractionLayer {
  /**
   * Request permission from the user. Returns the user's response.
   * This is called by the adapter when the SDK requests permission.
   */
  requestPermission(request: PermissionRequest): Promise<string>;

  /**
   * Request free-form input from the user.
   */
  requestInput(request: InputRequest): Promise<string>;
}

interface PermissionRequest {
  requestId: string;
  toolName: string;
  question: string;
  options: Array<{ label: string; value: string }>;
}

interface InputRequest {
  requestId: string;
  question: string;
  nodeId: string;
}
```

The adapter calls `interactionLayer.requestPermission()` when the SDK needs permission, and the interaction layer shows the UI and resolves the promise with the user's response. Events are emitted to the bus for display purposes but don't carry callbacks.

### 6. Backpressure

```typescript
// services/streaming/backpressure.ts

interface BackpressureConfig {
  /** Maximum events buffered before slowing the producer. Default: 100 */
  highWaterMark: number;
  /** Resume producing when buffer drops below this. Default: 25 */
  lowWaterMark: number;
}

/**
 * Wraps an AsyncIterable to apply backpressure when the consumer falls behind.
 */
function withBackpressure<T>(
  source: AsyncIterable<T>,
  config: BackpressureConfig,
): AsyncIterable<T>;
```

Applied in the orchestrator between the adapter output and bus emission.

### 7. Event Validation

Every event is validated via Zod's `safeParse` at the orchestrator boundary (between adapter and bus). This catches:
- Missing required fields
- Type mismatches
- Unknown event types

Invalid events are logged and dropped, preventing downstream crashes from malformed data.

### 8. Testing Strategy

Provider adapters return `AsyncIterable<StreamEvent>`, making them trivially testable:

```typescript
test("claude adapter emits text.delta for SDK text chunks", async () => {
  const mockSession = createMockSession([
    { type: "text", content: "hello" },
    { type: "text", content: " world" },
  ]);
  const adapter = createClaudeAdapter(mockClient);
  const events: StreamEvent[] = [];
  for await (const event of adapter.stream(mockSession, "hi", defaultOptions)) {
    events.push(event);
  }
  expect(events.filter(e => e.type === "text.delta")).toHaveLength(2);
});
```

## Architecture Diagram

```
                  ┌─────────────────────────┐
                  │     Provider SDK         │
                  │  (Claude/OpenCode/Copilot)│
                  └────────────┬────────────┘
                               │ SDK-specific API
                               ▼
                  ┌─────────────────────────┐
                  │    Provider Adapter      │
                  │  async *stream() =>      │
                  │  AsyncIterable<StreamEvent>│
                  └────────────┬────────────┘
                               │ StreamEvent
                               ▼
                  ┌─────────────────────────┐
                  │   Stream Orchestrator    │
                  │  - Zod validation        │
                  │  - Backpressure          │
                  │  - Error boundary        │
                  └────────────┬────────────┘
                               │ validated StreamEvent
                               ▼
                  ┌─────────────────────────┐
                  │       Event Bus          │
                  │  on(type, handler)       │
                  │  emit(event)             │
                  └───┬─────┬─────┬─────┬───┘
                      │     │     │     │
                      ▼     ▼     ▼     ▼
                   State  Parts  UI   Telemetry
                  Reducer Accum Render Logger
```

## Code References (Current)

- `src/services/events/adapters/types.ts:16-35` - SDKStreamAdapter interface
- `src/services/events/adapters/providers/claude/streaming-runtime.ts` - Claude streaming runtime
- `src/services/events/adapters/providers/opencode/streaming-runtime.ts` - OpenCode streaming runtime
- `src/services/events/adapters/providers/copilot/runtime.ts` - Copilot runtime
- `src/services/events/adapters/task-turn-normalization.ts` - Turn normalization workaround
- `src/services/events/adapters/event-coverage-policy.ts` - Coverage audit
- `src/services/events/adapters/subagent-tool-tracker.ts` - Subagent tracking
- `src/services/events/adapters/retry.ts` - Retry logic
- `src/services/events/event-bus-provider.tsx` - React context bus provider
- `src/hooks/use-message-queue.ts` - Consumer-side message buffering
- `src/state/streaming/` - Streaming state pipeline (1,853 lines)
- `src/state/chat/stream/` - Stream lifecycle state (4,381 lines)

## Related Research

- `research/docs/2026-02-26-streaming-architecture-event-bus-migration.md`
- `research/docs/2026-02-26-streaming-event-bus-spec-audit.md`
- `research/docs/2026-02-15-subagent-premature-completion-SUMMARY.md`
- `research/docs/2026-02-15-subagent-event-flow-diagram.md`
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md`
- `research/docs/2026-03-14-event-bus-callback-elimination-sdk-event-types.md`
- `research/docs/2026-02-23-258-background-agents-sdk-event-pipeline.md`
- `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md`
