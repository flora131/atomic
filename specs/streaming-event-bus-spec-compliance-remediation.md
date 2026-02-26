# Streaming Event Bus Spec Compliance Remediation — Technical Design Document

| Document Metadata      | Details           |
| ---------------------- | ----------------- |
| Author(s)              | lavaman131        |
| Status                 | In Review (RFC)   |
| Team / Owner           | lavaman131/atomic |
| Created / Last Updated | 2026-02-26        |

## 1. Executive Summary

This RFC proposes remediation of all gaps, bugs, and deviations identified in the [Streaming Event Bus Spec Compliance Audit](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md) against the [Streaming Architecture Event Bus Migration spec](../specs/streaming-architecture-event-bus-migration.md). The audit found **2 high-severity bugs** (adapter `dispose()` null references), **7 intentional simplifications** that deviate from the spec's contract, **8 missing features** (run ownership tracking, streaming lifecycle hooks, debug tooling), and **test coverage gaps** (missing Zod validation tests, no Copilot/Workflow adapter tests). This document specifies the exact changes needed to bring the `src/events/` implementation into full spec compliance while preserving the existing architectural decisions that were validated against OpenCode patterns.

**Research References:**

- [Spec Compliance Audit](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md)
- [OpenCode Event Bus Patterns](../research/docs/2026-02-26-opencode-event-bus-patterns.md)
- [Streaming Architecture Event Bus Migration (original spec)](../specs/streaming-architecture-event-bus-migration.md)

## 2. Context and Motivation

### 2.1 Current State

The `src/events/` directory implements the core event bus infrastructure specified in the [Streaming Architecture Event Bus Migration spec](../specs/streaming-architecture-event-bus-migration.md). The compliance audit ([research/docs/2026-02-26-streaming-event-bus-spec-audit.md](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md)) confirmed that the **foundational components are correctly implemented**: all 19 bus event types, the `AtomicEventBus` pub/sub core, coalescing key logic, `BatchDispatcher` with double-buffer/16ms flush, `EchoSuppressor`, React hooks, and the provider pattern all match the spec closely.

However, the audit identified the following categories of issues:

- **2 high-severity bugs** in adapter `dispose()` methods causing `TypeError` crashes during active streaming cancellation
- **7 intentional API simplifications** where implementation differs from the spec's contract
- **8 features specified but not yet implemented** (run ownership, streaming lifecycle hooks, debug tooling)
- **Test coverage gaps** leaving critical paths unverified

### 2.2 The Problem

- **Crash Risk**: Calling `dispose()` during active streaming in OpenCode and Claude adapters causes a `TypeError: Cannot read properties of null` due to a missing null guard on `abortController` ([audit bug table](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#-bugs-found)). Two tests are **SKIPPED** documenting this.
- **Incomplete Run Ownership**: The `CorrelationService` uses a simplified `enrich()`/`registerTool()`/`reset()` API instead of the spec's full `processBatch()`/`startRun()`/`isOwnedEvent()` contract. This means stale events from previous runs cannot be filtered at the correlation level — consumers must manually check `event.runId` ([audit deviation table](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#️-deviates-from-spec-intentional-simplifications)).
- **No Streaming Lifecycle Control**: The `useStreamConsumer` hook returns only `{ resetConsumers }` instead of the spec's `{ startStreaming, stopStreaming, isStreaming }`, forcing consumers to manage adapter lifecycle separately ([audit Section 7](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#7-react-integration--section-57)).
- **Claude Adapter Gap**: Tool events are not handled in the Claude adapter — a comment says they are "handled at higher level", violating the spec's rule that adapters should be the **sole consumers** of SDK events ([audit Section 5.2](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#52-claude-adapter-claude-adapterts-138-lines)).
- **No Debug Replay**: The debug subscriber only logs to console; the original spec's Section 7.2 calls for event replay and JSONL dump capabilities, but the implementation should follow OpenCode's proven file-based log retention pattern ([audit Section 8](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#8-debug-subscriber-debug-subscriberts--section-72)).
- **Unverified Zod Validation**: `publish()` validates events via Zod schemas, but no tests verify the failure path (schema rejection, early return, warning log) ([audit bug table](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#-bugs-found)).

## 3. Goals and Non-Goals

### 3.1 Functional Goals

- [ ] Fix both adapter `dispose()` null reference bugs and unskip the corresponding tests
- [ ] Expand `CorrelationService` API to include run ownership tracking (`startRun`, `isOwnedEvent`, `activeRunId`)
- [ ] Add `startStreaming`/`stopStreaming`/`isStreaming` to the `useStreamConsumer` hook
- [ ] Handle tool and agent events in the Claude adapter (making it the sole consumer of Claude SDK events)
- [ ] Replace console-only debug subscriber with file-based JSONL event logging with log rotation (modeled after OpenCode's `packages/opencode/src/util/log.ts`)
- [ ] Add Zod validation failure tests to `event-bus.test.ts`
- [ ] Add test coverage for `CopilotStreamAdapter` and `WorkflowEventAdapter`
- [ ] Align `StreamPipelineConsumer` batch processing flow with the enrichment pipeline described in the spec

### 3.2 Non-Goals (Out of Scope)

- [ ] Will NOT change the architectural pattern (in-process pub/sub, double-buffer batching, coalescing) — these are validated and correct
- [ ] Will NOT refactor the callback-based `onStreamParts()` pattern in `StreamPipelineConsumer` to the spec's direct `setMessages()` dispatch — the callback pattern is intentionally more flexible ([audit validation](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#key-design-decisions-validated-against-opencode))
- [ ] Will NOT convert the `WorkflowEventAdapter` from method-based to AsyncGenerator pattern — the method-based approach is simpler for discrete events ([audit validation](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#key-design-decisions-validated-against-opencode))
- [ ] Will NOT rewrite existing passing tests — only add missing coverage and unskip fixed tests
- [ ] Will NOT change `BusEventType` definitions or `BusEventDataMap` payloads — all 19 types are confirmed correct

## 4. Proposed Solution (High-Level Design)

### 4.1 System Architecture Diagram

The remediation does not change the overall architecture. The event flow remains:

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

Changes are **internal** to existing components — the inter-component contracts remain the same. The key additions are:

1. **Null guards** in adapter error handlers (bug fix)
2. **Run ownership state** in `CorrelationService` (API expansion)
3. **Adapter lifecycle management** in `useStreamConsumer` (hook enhancement)
4. **Tool/agent event handling** in Claude adapter (feature addition)
5. **File-based JSONL event logging** in debug subscriber with OpenCode-style rotation (feature addition)

### 4.2 Architectural Pattern

No change. The centralized in-process Event Bus with batched dispatch pattern remains as specified in the [original spec Section 4.2](../specs/streaming-architecture-event-bus-migration.md#42-architectural-pattern).

### 4.3 Key Components

| Component                      | Change Type         | Description                                                                         |
| ------------------------------ | ------------------- | ----------------------------------------------------------------------------------- |
| `opencode-adapter.ts`          | Bug Fix             | Add null guard to `abortController` in error handler                                |
| `claude-adapter.ts`            | Bug Fix + Feature   | Add null guard + handle tool/agent events in adapter                                |
| `correlation-service.ts`       | API Expansion       | Add `startRun()`, `isOwnedEvent()`, `activeRunId`, `processBatch()`                 |
| `hooks.ts` (useStreamConsumer) | Enhancement         | Add `startStreaming`, `stopStreaming`, `isStreaming`                                |
| `debug-subscriber.ts`          | Rewrite             | Replace console-only logging with file-based JSONL log retention (OpenCode pattern) |
| `event-bus.test.ts`            | Test Addition       | Add Zod validation failure path tests                                               |
| `adapters.test.ts`             | Test Fix + Addition | Unskip dispose tests, add Copilot/Workflow adapter tests                            |

## 5. Detailed Design

### 5.1 Bug Fix: Adapter `dispose()` Null Reference

**Files:** `src/events/adapters/opencode-adapter.ts`, `src/events/adapters/claude-adapter.ts`

**Root Cause:** When `dispose()` is called during active streaming, it aborts and nullifies `this.abortController`. The stream's error handler then tries to access `this.abortController.signal.aborted`, which throws `TypeError: Cannot read properties of null`.

**Fix:** Add a null guard before accessing `abortController.signal` in the catch block of the streaming loop.

```typescript
// BEFORE (both adapters):
} catch (error) {
  if (!this.abortController.signal.aborted) {
    this.publishSessionError(runId, error);
  }
}

// AFTER (both adapters):
} catch (error) {
  if (this.abortController && !this.abortController.signal.aborted) {
    this.publishSessionError(runId, error);
  }
}
```

**Test Changes:** Unskip the two `dispose() stops processing via AbortController` tests in `adapters.test.ts` (lines ~252-286 and ~520-554). Change `test.skip(...)` to `test(...)`.

**Ref:** [Audit Bug Table](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#-bugs-found)

### 5.2 CorrelationService API Expansion

**File:** `src/events/consumers/correlation-service.ts`

**Current API** (simplified):

```typescript
class CorrelationService {
    enrich(event: BusEvent): EnrichedBusEvent;
    registerTool(toolId: string, agentId: string, isSubagent?: boolean): void;
    reset(): void;
    // State: toolToAgent, subAgentTools, mainAgentId
}
```

**Expanded API** (matching spec Section 5.3):

```typescript
class CorrelationService {
    // Existing (preserved):
    enrich(event: BusEvent): EnrichedBusEvent;
    registerTool(toolId: string, agentId: string, isSubagent?: boolean): void;
    reset(): void;

    // New — Run lifecycle:
    startRun(runId: number, sessionId: string): void;
    isOwnedEvent(event: BusEvent): boolean;
    get activeRunId(): number | null;

    // New — Batch processing:
    processBatch(events: BusEvent[]): EnrichedBusEvent[];

    // New — State (additions):
    private ownedSessionIds: Set<string>;
    private toolIdToRunMap: Map<string, number>;
}
```

**Implementation Details:**

1. **`startRun(runId, sessionId)`**: Sets `activeRunId`, adds `sessionId` to `ownedSessionIds`, calls `reset()` to clear previous run state. This replaces the manual `runId` tracking that currently happens external to the service.

2. **`isOwnedEvent(event)`**: Returns `true` if `event.runId === this.activeRunId` or `event.sessionId` is in `ownedSessionIds`. Used by consumers to filter stale events from previous runs.

3. **`activeRunId` getter**: Exposes the current run ID for external queries (e.g., staleness guards).

4. **`processBatch(events)`**: Convenience method that maps `events.map(e => this.enrich(e))`. The existing single-event `enrich()` method is preserved for backward compatibility with `wireConsumers.ts`.

5. **`ownedSessionIds`**: Tracks session IDs registered via `startRun()`. Used by `isOwnedEvent()` for session-level ownership checks.

6. **`toolIdToRunMap`**: Maps tool IDs to the run that spawned them. Populated during `enrich()` when processing `stream.tool.start` events.

**Backward Compatibility:** The existing `enrich()`, `registerTool()`, and `reset()` APIs are preserved with identical behavior. New methods are additive. `wireConsumers.ts` continues to use `enrich()` without modification.

**Ref:** [Audit Deviation — CorrelationService API](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#61-correlationservice-correlation-servicets--section-53)

### 5.3 `useStreamConsumer` Hook Enhancement

**File:** `src/events/hooks.ts`

**Current Return Type:**

```typescript
{ resetConsumers: () => void }
```

**Enhanced Return Type:**

```typescript
{
  resetConsumers: () => void;       // Preserved
  startStreaming: (
    adapter: SDKStreamAdapter,
    session: Session,
    message: string,
    options: StreamAdapterOptions
  ) => Promise<void>;
  stopStreaming: () => void;
  isStreaming: boolean;
}
```

**Implementation Details:**

1. **`startStreaming(adapter, session, message, options)`**: Stores the adapter reference, sets `isStreaming = true`, calls `resetConsumers()` for clean state, then delegates to `adapter.startStreaming(session, message, options)`. On completion or error, sets `isStreaming = false`.

2. **`stopStreaming()`**: Calls `adapter.dispose()` on the stored adapter reference, sets `isStreaming = false`, nullifies the adapter ref.

3. **`isStreaming`**: React state (`useState`) toggled by `startStreaming`/`stopStreaming`. Provides reactive streaming status for UI components.

4. **Adapter parameter**: The adapter is passed as a parameter to `startStreaming()` rather than being created internally. This preserves the current pattern where the calling component decides which SDK adapter to use based on the active session type. The hook manages the adapter's lifecycle after receiving it.

**Cleanup:** On unmount, the hook calls `stopStreaming()` to ensure proper disposal.

**Ref:** [Audit Deviation — useStreamConsumer](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#usestreamconsumer-hook-hooksts211-242)

### 5.4 Claude Adapter Tool/Agent Event Handling

**File:** `src/events/adapters/claude-adapter.ts`

**Current Behavior:** The Claude adapter only processes `text` and `thinking` message types from the stream. A comment says tool events are "handled at higher level."

**Required Behavior (per spec Section 5.2):** Adapters should be the **sole consumers** of SDK events. The Claude adapter must handle:

- `AgentMessage { type: "tool_use" }` → publish `stream.tool.start` with `toolId`, `toolName`, `toolInput`
- `AgentMessage { type: "tool_result" }` → publish `stream.tool.complete` with `toolId`, `toolResult`, `success`
- Claude hooks (`PreToolUse`, `SubagentStart`) → publish `stream.agent.start` / `stream.agent.complete`

**Implementation:**

Add cases to the stream message processing switch/case:

```typescript
case "tool_use":
  this.bus.publish({
    type: "stream.tool.start",
    sessionId, runId,
    timestamp: Date.now(),
    data: {
      toolId: message.id,
      toolName: message.name,
      toolInput: message.input,
      sdkCorrelationId: message.correlationId,
    },
  });
  break;

case "tool_result":
  this.bus.publish({
    type: "stream.tool.complete",
    sessionId, runId,
    timestamp: Date.now(),
    data: {
      toolId: message.tool_use_id,
      toolName: message.toolName ?? "unknown",
      toolResult: typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
      success: !message.is_error,
      error: message.is_error ? String(message.content) : undefined,
      sdkCorrelationId: message.correlationId,
    },
  });
  break;
```

Agent lifecycle events should be captured via Claude Agent SDK hooks registered within the adapter, following the pattern described in [spec Section 5.2.2](../specs/streaming-architecture-event-bus-migration.md#522-adapter-implementations).

**Ref:** [Audit Deviation — Claude adapter tool events](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#52-claude-adapter-claude-adapterts-138-lines)

### 5.5 Debug Subscriber: File-Based JSONL Event Log Retention

**File:** `src/events/debug-subscriber.ts`

**Current:** Only `console.debug` logging when `ATOMIC_DEBUG=1`.

**Replacement:** File-based JSONL event logging with automatic rotation, modeled after OpenCode's `packages/opencode/src/util/log.ts` pattern ([DeepWiki: OpenCode logging](https://deepwiki.com/anomalyco/opencode)).

#### 5.5.1 Design (Mirroring OpenCode)

OpenCode's logging system (`packages/opencode/src/util/log.ts`) uses:

- **Directory**: `~/.local/share/opencode/log/`
- **File naming**: `YYYY-MM-DDTHHMMSS.log` (ISO timestamp, colons stripped)
- **Rotation**: File-count-based, retains 10 most recent files
- **Cleanup**: `Bun.Glob("????-??-??T??????.log")` scans for log files, deletes oldest beyond limit
- **Writing**: `Bun.file(path).writer()` with synchronous `writer.write(msg)` + `writer.flush()`
- **Dev mode**: Uses fixed `dev.log` filename
- **Format**: `[ISO_TIMESTAMP] +[TIME_DIFF_MS] [TAGS] [MESSAGE]`

Atomic's event log system adapts this pattern for structured event data:

| Aspect       | OpenCode                                        | Atomic Event Logger                        |
| ------------ | ----------------------------------------------- | ------------------------------------------ |
| Directory    | `~/.local/share/opencode/log/`                  | `~/.local/share/atomic/log/events/`        |
| File format  | Plain text (`[TIMESTAMP] +[DIFF] [TAGS] [MSG]`) | JSONL (one JSON object per event per line) |
| File naming  | `YYYY-MM-DDTHHMMSS.log`                         | `YYYY-MM-DDTHHMMSS.events.jsonl`           |
| Rotation     | 10 most recent files                            | 10 most recent files                       |
| Cleanup glob | `????-??-??T??????.log`                         | `????-??-??T??????.events.jsonl`           |
| Activation   | `--log-level DEBUG`                             | `ATOMIC_DEBUG=1`                           |
| Writing      | `Bun.file().writer()`                           | `Bun.file().writer()`                      |
| Dev mode     | `dev.log`                                       | `dev.events.jsonl`                         |

#### 5.5.2 Implementation

```typescript
// src/events/debug-subscriber.ts

import { join } from "path";
import { homedir } from "os";

const LOG_DIR = join(homedir(), ".local", "share", "atomic", "log", "events");
const MAX_LOG_FILES = 10;

/** JSONL log entry format — one per line in the log file */
interface EventLogEntry {
    ts: string; // ISO timestamp
    type: string; // BusEventType
    sessionId: string;
    runId: number;
    data: unknown; // Event payload
}

/**
 * Clean up old event log files, retaining the most recent MAX_LOG_FILES.
 * Mirrors OpenCode's cleanup() in packages/opencode/src/util/log.ts.
 */
async function cleanup(dir: string): Promise<void> {
    const glob = new Bun.Glob("????-??-??T??????.events.jsonl");
    const files = await Array.fromAsync(
        glob.scan({ cwd: dir, absolute: true }),
    );
    // Glob returns files in lexicographic order (oldest first due to timestamp naming)
    if (files.length <= MAX_LOG_FILES) return;
    const filesToDelete = files.slice(0, -MAX_LOG_FILES);
    await Promise.all(
        filesToDelete.map((file) =>
            Bun.file(file)
                .exists()
                .then((exists) =>
                    exists
                        ? require("fs/promises")
                              .unlink(file)
                              .catch(() => {})
                        : undefined,
                ),
        ),
    );
}

/**
 * Initialize the event log file writer.
 * Mirrors OpenCode's Log.init() in packages/opencode/src/util/log.ts.
 */
async function initEventLog(options?: { dev?: boolean }): Promise<{
    write: (event: BusEvent) => void;
    close: () => void;
    logPath: string;
}> {
    await require("fs/promises").mkdir(LOG_DIR, { recursive: true });
    await cleanup(LOG_DIR);

    const filename = options?.dev
        ? "dev.events.jsonl"
        : new Date().toISOString().split(".")[0].replace(/:/g, "") +
          ".events.jsonl";

    const logPath = join(LOG_DIR, filename);
    const logFile = Bun.file(logPath);
    // Truncate if reusing (dev mode)
    if (options?.dev) {
        await require("fs/promises")
            .truncate(logPath)
            .catch(() => {});
    }

    const writer = logFile.writer();

    const write = (event: BusEvent): void => {
        const entry: EventLogEntry = {
            ts: new Date(event.timestamp).toISOString(),
            type: event.type,
            sessionId: event.sessionId,
            runId: event.runId,
            data: event.data,
        };
        writer.write(JSON.stringify(entry) + "\n");
        writer.flush();
    };

    const close = (): void => {
        writer.end();
    };

    return { write, close, logPath };
}

/**
 * Attach a file-based debug subscriber to the event bus.
 * When ATOMIC_DEBUG=1, all events are written to a JSONL log file
 * with automatic rotation (10 most recent files retained).
 *
 * Also retains console.debug logging for real-time visibility.
 */
function attachDebugSubscriber(bus: AtomicEventBus): Promise<{
    unsubscribe: () => void;
    logPath: string | null;
}> {
    if (process.env.ATOMIC_DEBUG !== "1") {
        return Promise.resolve({ unsubscribe: () => {}, logPath: null });
    }

    return initEventLog({ dev: process.env.NODE_ENV === "development" }).then(
        ({ write, close, logPath }) => {
            const unsubBus = bus.onAll((event) => {
                // File-based JSONL logging
                write(event);
                // Retain console.debug for real-time visibility
                const preview = JSON.stringify(event.data).slice(0, 100);
                console.debug(
                    `[EventBus] ${event.type} run=${event.runId} ${preview}`,
                );
            });

            const unsubscribe = (): void => {
                unsubBus();
                close();
            };

            return { unsubscribe, logPath };
        },
    );
}
```

#### 5.5.3 Log Replay Utility

Since events are persisted as JSONL files, replay is a simple file read — no in-memory buffer needed:

```typescript
/**
 * Read and parse events from a JSONL event log file.
 * Replaces the in-memory EventReplayBuffer with file-based replay.
 */
async function readEventLog(
    logPath: string,
    filter?: (entry: EventLogEntry) => boolean,
): Promise<EventLogEntry[]> {
    const content = await Bun.file(logPath).text();
    const entries = content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as EventLogEntry);
    return filter ? entries.filter(filter) : entries;
}

/**
 * List all available event log files, most recent first.
 */
async function listEventLogs(): Promise<string[]> {
    const glob = new Bun.Glob("????-??-??T??????.events.jsonl");
    const files = await Array.fromAsync(
        glob.scan({ cwd: LOG_DIR, absolute: true }),
    );
    return files.reverse(); // Most recent first
}
```

**Advantages over in-memory replay buffer:**

- Events persist across process restarts (critical for debugging crashes)
- No memory cap concerns — disk is plentiful
- JSONL files can be analyzed with standard tools (`jq`, `grep`, text editors)
- Rotation is automatic and bounded (10 files max)
- Matches OpenCode's proven pattern

**Ref:** [Audit Deviation — Debug subscriber](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#8-debug-subscriber-debug-subscriberts--section-72), [OpenCode Log Implementation](https://deepwiki.com/anomalyco/opencode)

### 5.6 Test Coverage Additions

#### 5.6.1 Zod Validation Failure Tests

**File:** `src/events/event-bus.test.ts`

Add tests verifying:

- Publishing an event with invalid payload (wrong types) → event is NOT dispatched, warning is logged
- Publishing an event with missing required fields → early return, no handler invocation
- Publishing an event with extra fields → Zod strips extras (passthrough behavior check)

```typescript
test("publish() rejects event with invalid payload schema", () => {
    const handler = mock(() => {});
    bus.on("stream.text.delta", handler);

    const invalidEvent = {
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: 123 }, // Should be string
    };

    bus.publish(invalidEvent as BusEvent<"stream.text.delta">);
    expect(handler).not.toHaveBeenCalled();
});
```

#### 5.6.2 Copilot Adapter Tests

**File:** `src/events/adapters/adapters.test.ts`

Add test suite for `CopilotStreamAdapter` covering:

- Text delta events → `stream.text.delta` + `stream.text.complete`
- Tool events → `stream.tool.start` / `stream.tool.complete`
- Agent events → `stream.agent.start` / `stream.agent.complete`
- Backpressure behavior (buffer exceeding `MAX_BUFFER_SIZE`)
- `dispose()` cleanup

#### 5.6.3 Workflow Adapter Tests

**File:** `src/events/adapters/adapters.test.ts`

Add test suite for `WorkflowEventAdapter` covering:

- `publishStepStart()` → publishes `workflow.step.start` with correct payload
- `publishStepComplete()` → publishes `workflow.step.complete` with status
- `publishTaskUpdate()` → publishes `workflow.task.update` with task array
- `publishAgentStart()`/`publishAgentUpdate()`/`publishAgentComplete()` → correct `stream.agent.*` events

## 6. Alternatives Considered

| Option                                                                 | Pros                                      | Cons                                                          | Reason for Rejection                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A: Keep simplified CorrelationService**                              | No refactoring risk, currently functional | Stale event filtering burden on consumers, diverges from spec | Rejected — run ownership is needed for multi-agent correctness                                                                                                                         |
| **B: Merge adapter + hook lifecycle** (adapter created inside hook)    | Cleaner API, hook owns full lifecycle     | Couples hook to adapter factory, harder to test               | Rejected — passing adapter as parameter preserves testability                                                                                                                          |
| **C: Replace StreamPipelineConsumer callback with direct setMessages** | Matches spec exactly                      | Couples consumer to React, harder to test                     | Rejected — callback pattern validated as intentionally better ([audit](../research/docs/2026-02-26-streaming-event-bus-spec-audit.md#key-design-decisions-validated-against-opencode)) |
| **D: Full CorrelationService rewrite**                                 | Clean slate, optimal API                  | High risk, existing tests depend on current behavior          | Rejected — additive expansion preserves backward compatibility                                                                                                                         |

## 7. Cross-Cutting Concerns

### 7.1 Security and Privacy

- **No change**: All fixes are internal to the in-process event bus. No new data leaves the process boundary.
- **JSONL dump**: Debug event dumps contain the same data already visible in console.debug. Files are written to user-controlled paths only when explicitly invoked.

### 7.2 Observability Strategy

- **File-based event logging**: When `ATOMIC_DEBUG=1`, all bus events are written to JSONL files at `~/.local/share/atomic/log/events/`. Automatic rotation retains the 10 most recent log files. Mirrors OpenCode's `packages/opencode/src/util/log.ts` pattern.
- **Event replay**: `readEventLog(path, filter?)` reads persisted JSONL files for post-hoc analysis. Events persist across process restarts, enabling crash debugging.
- **JSONL format**: Each line is a self-contained JSON object (`{ts, type, sessionId, runId, data}`), compatible with `jq`, `grep`, and standard log analysis tools.
- **Console logging**: `console.debug` retained alongside file logging for real-time visibility during development.
- **Existing metrics**: `BatchMetrics` (totalFlushed, totalCoalesced, totalDropped, flushCount) remain unchanged.

### 7.3 Scalability and Capacity Planning

- **Log file storage**: 10 JSONL files × ~1-5MB each ≈ 10-50MB max disk usage. Log rotation ensures bounded growth.
- **Write performance**: `Bun.file().writer()` with synchronous `flush()` (same as OpenCode) adds negligible latency per event — I/O is buffered by the OS.
- **No memory overhead**: Unlike an in-memory replay buffer, file-based logging adds no persistent memory pressure. Only the writer handle is kept in memory.
- **No performance regression**: Bug fixes are single null-guard additions. CorrelationService additions are O(1) lookups. No hot-path changes.

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

#### Phase 1: Bug Fixes

- [ ] Add null guard to `opencode-adapter.ts` error handler (~line 197)
- [ ] Add null guard to `claude-adapter.ts` error handler (~line 111)
- [ ] Unskip both `dispose()` tests in `adapters.test.ts`
- [ ] Run test suite to verify fixes

**Verification:** Both previously-skipped tests pass. No regressions in existing adapter tests.

#### Phase 2: CorrelationService Expansion

- [ ] Add `startRun(runId, sessionId)` method
- [ ] Add `isOwnedEvent(event)` method
- [ ] Add `activeRunId` getter
- [ ] Add `processBatch(events)` convenience method
- [ ] Add `ownedSessionIds` and `toolIdToRunMap` internal state
- [ ] Add unit tests for all new methods in `correlation-service.test.ts`

**Verification:** New tests pass. Existing `enrich()`/`registerTool()`/`reset()` tests unchanged and passing.

#### Phase 3: Claude Adapter Tool Events

- [ ] Add `tool_use` → `stream.tool.start` mapping
- [ ] Add `tool_result` → `stream.tool.complete` mapping
- [ ] Register Claude hooks for agent lifecycle events within the adapter
- [ ] Remove "handled at higher level" comment
- [ ] Add tests for tool/agent event handling in Claude adapter section of `adapters.test.ts`

**Verification:** Claude adapter tests cover text, thinking, tool, and agent event types. Integration test with Claude adapter produces complete event stream.

#### Phase 4: Hook Enhancement + Debug Subscriber

- [ ] Add `startStreaming`, `stopStreaming`, `isStreaming` to `useStreamConsumer` return
- [ ] Add cleanup on unmount
- [ ] Add tests for streaming lifecycle in `hooks.test.ts`
- [ ] Implement `initEventLog()` with JSONL file writer (mirrors OpenCode's `Log.init()`)
- [ ] Implement `cleanup()` with `Bun.Glob` rotation retaining 10 most recent files (mirrors OpenCode's `cleanup()`)
- [ ] Implement `readEventLog()` and `listEventLogs()` replay utilities
- [ ] Enhance `attachDebugSubscriber()` to write JSONL files + retain console.debug
- [ ] Add tests for log rotation, JSONL format, and replay utilities

**Verification:** Hook tests verify startStreaming/stopStreaming lifecycle and isStreaming state. Debug subscriber tests verify JSONL file creation, log rotation at 10 files, and replay utility correctness.

#### Phase 5: Test Coverage

- [ ] Add Zod validation failure tests to `event-bus.test.ts`
- [ ] Add `CopilotStreamAdapter` test suite to `adapters.test.ts`
- [ ] Add `WorkflowEventAdapter` test suite to `adapters.test.ts`
- [ ] Verify all previously-skipped tests are now enabled

**Verification:** Full test suite passes with zero skipped tests. All adapter types have test coverage.

### 8.2 Data Migration Plan

- **No data migration required**: All changes are runtime behavior modifications.

### 8.3 Test Plan

- **Unit Tests**: `CorrelationService` (new methods), `initEventLog()`, `cleanup()` (log rotation), `readEventLog()` (replay), Zod validation failure paths
- **Adapter Tests**: Claude adapter (tool/agent events), Copilot adapter (full suite), Workflow adapter (full suite), dispose() fix verification (unskipped tests)
- **Hook Tests**: `useStreamConsumer` streaming lifecycle (`startStreaming`, `stopStreaming`, `isStreaming` state transitions, unmount cleanup)
- **Integration Tests**: Existing `integration.test.ts` (8 scenarios) should continue passing with no modifications
- **Regression**: Run `bun test` to verify zero regressions across entire `src/events/` test suite

## 9. Resolved Design Decisions

- [x] **Q1 — CorrelationService `processBatch` semantics:** **Simple map wrapper** — `processBatch()` is `events.map(e => this.enrich(e))`. Run lifecycle is managed externally via explicit `startRun()` calls, not auto-detected within batches. This aligns with OpenCode's pattern where stale events are filtered via coalescing (key-based deduplication) at the frontend level rather than batch-level run boundary detection. ([OpenCode reference](https://deepwiki.com/anomalyco/opencode))

- [x] **Q2 — `useStreamConsumer` adapter parameter pattern:** **Adapter as parameter** — `startStreaming(adapter, session, message, options)` accepts the adapter instance from the caller. This mirrors OpenCode's context provider pattern (where the SDK client is provided via React context) adapted for Atomic's in-process architecture. The hook manages the adapter's lifecycle after receiving it without needing to know about session types or adapter factories.

- [x] **Q3 — Claude adapter hook registration:** **Stream message parsing** — Claude Agent SDK v1 delivers all event types (`text`, `tool_use`, `tool_result`, `task_started`, sub-agent lifecycle) as message types in the `AsyncIterable` stream returned by `Session.stream()`. No separate hook registration (`PreToolUse`, `SubagentStart`) is needed. The adapter iterates the stream and switches on `message.type` to handle all event types inline. ([Claude Agent SDK reference](https://deepwiki.com/anthropics/claude-agent-sdk-typescript))

- [x] **Q4 — Debug event persistence strategy:** **File-based JSONL log retention (OpenCode pattern)** — replaces the originally proposed in-memory replay buffer. Events are written to `~/.local/share/atomic/log/events/` as JSONL files (`YYYY-MM-DDTHHMMSS.events.jsonl`), with automatic rotation retaining 10 most recent files. This mirrors OpenCode's `packages/opencode/src/util/log.ts` implementation which uses `Bun.Glob("????-??-??T??????.log")` for cleanup and `Bun.file().writer()` for writing. Key advantages: events persist across process restarts (enabling crash debugging), no memory cap concerns, JSONL files are analyzable with `jq`/`grep`, and rotation is automatic and bounded. Dev mode uses fixed `dev.events.jsonl` filename. ([OpenCode Log.init() reference](https://deepwiki.com/anomalyco/opencode))

- [x] **Q5 — Copilot adapter test mocking:** **Real EventEmitter instance** — tests use a real `EventEmitter` instance rather than a mock. This is lightweight, tests actual event wiring, and ensures the adapter correctly registers/unregisters handlers on the EventEmitter interface.
