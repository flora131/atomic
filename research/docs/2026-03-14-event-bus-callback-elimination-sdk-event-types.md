---
date: 2026-03-14 20:00:55 UTC
researcher: Claude Opus 4.6
git_commit: 7fd3d71d6a6e2606eb40c04a490640e8317a45a0
branch: lavaman131/feature/code-cleanup
repository: atomic
topic: "EventBus callback-level logic elimination and SDK event type catalog"
tags: [research, event-bus, streaming, callback-elimination, sdk-events, claude-sdk, opencode-sdk, copilot-sdk, sub-agents]
status: complete
last_updated: 2026-03-14
last_updated_by: Claude Opus 4.6
---

# Research: EventBus Callback-Level Logic Elimination & SDK Event Type Catalog

## Research Question

How can the EventBus consumer pipeline be restructured to eliminate manual dispatch logic in event callbacks — specifically the imperative switch/if-else routing in `CorrelationService.enrich()`, the manual event filtering in `wireConsumers()`, and the ad-hoc type narrowing across subscribers — and what are the complete event type inventories for each SDK (Claude, OpenCode, Copilot) that the bus must handle, including sub-agent events?

## Summary

The current EventBus consumer pipeline contains **8 distinct manual callback patterns** spread across 10 files, with the heaviest being `CorrelationService.enrich()` (210-line switch, 11 cases) and `StreamPipelineConsumer.mapToStreamPart()` (240-line switch). All three SDK backends (Claude Agent SDK with 20 message types, OpenCode SDK with 42+ events, Copilot SDK with 43 events) normalize into the unified 26-type `BusEventType` system through provider adapters that each contain their own switch-based routing.

Research into the SDKs reveals three event-handling paradigms: OpenCode uses **Zod-validated `BusEvent.define()` with pub/sub**, Copilot uses **schema-generated discriminated unions with typed `session.on()` subscriptions**, and Claude uses **AsyncGenerator-yielded discriminated unions**. All three provide patterns that could replace the manual callback logic with more declarative approaches.

---

## Detailed Findings

### 1. Current Manual Callback Patterns (8 Patterns in 10 Files)

#### Pattern 1: CorrelationService Giant Switch (`correlation-service.ts:124-346`)

A 210-line `switch` on `event.type` in the `enrich()` method with 11 explicit cases. Every case manually narrows `event.data` using `as BusEventDataMap[...]` casts. The sub-agent registry lookup pattern (check `this.subagentRegistry.get(agentId)`, set `parentAgentId` and `suppressFromMainChat`) is duplicated **8 times** across the switch arms.

**What it does**: Enriches raw `BusEvent` objects with `resolvedToolId`, `resolvedAgentId`, `isSubagentTool`, `parentAgentId`, and `suppressFromMainChat` flags.

#### Pattern 2: wireConsumers Manual Filtering (`wire-consumers.ts:76-96`)

Inline batch consumer callback with a three-stage imperative pipeline:
1. Manual `event.type === "stream.session.start"` check to bootstrap correlation
2. Imperative `for` loop filtering owned vs. unowned events
3. `.filter((event) => !event.suppressFromMainChat)` suppression pass

#### Pattern 3: StreamPipelineConsumer Switch (`stream-pipeline-consumer.ts:179-421`)

A 240-line `switch` over all `BusEventType` values in `mapToStreamPart()`. Each case constructs a `StreamPartEvent` with conditional spreads (`...(x ? { y: x } : {})` — 10+ instances). Additionally, 14 event types explicitly return `null` with comments documenting which hook consumes them instead.

#### Pattern 4: coalescingKey Switch (`coalescing.ts:8-71`)

A 63-line switch over all event types returning coalescing keys or `undefined`. Every case accessing `event.data` uses `as BusEventDataMap[...]` casts.

#### Pattern 5: BatchDispatcher Stale-Delta Filtering (`batch-dispatcher.ts:228-239`)

Manual `event.type` checks with `as` casts inside the `flush()` filter callback for `stream.text.delta` and `stream.thinking.delta`.

#### Pattern 6: EventBus.publish Dispatch Loop (`event-bus.ts:215-276`)

Two separate handler loops (typed + wildcard) with per-handler try/catch for error isolation.

#### Pattern 7: Hooks Ref-Indirection (`hooks.ts:114-294`)

Three hooks (`useBusSubscription`, `useBusWildcard`, `useStreamConsumer`) using ref-based callback stability patterns with type cast wrappers.

#### Pattern 8: EventBusProvider Context (`event-bus-provider.tsx:43-125`)

Standard React Context provider with manual null-check-and-throw.

**Recurring anti-patterns across all files:**

| Anti-Pattern                                               | Files                                                                       | Occurrences   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- | ------------- |
| `switch (event.type)` with `as BusEventDataMap[...]` casts | correlation-service, stream-pipeline-consumer, coalescing, batch-dispatcher | 4 files       |
| Duplicated sub-agent registry lookup blocks                | correlation-service                                                         | 8 cases       |
| `if (event.type === "...")` string checks in callbacks     | wire-consumers, batch-dispatcher                                            | 2 files       |
| Conditional spread `...(x ? { y: x } : {})`                | stream-pipeline-consumer                                                    | 10+ instances |

---

### 2. SDK Event Type Inventories

#### 2.1 Claude Agent SDK — 20 Message Types

The Claude Agent SDK uses an `AsyncGenerator<SDKMessage>` pattern where `query()` yields a discriminated union of 20 message types. The discriminator is `type` (and `subtype` for system messages).

| Message Type               | `type`                | `subtype`                 | Sub-Agent Field                 |
| -------------------------- | --------------------- | ------------------------- | ------------------------------- |
| SDKSystemMessage           | `"system"`            | `"init"`                  | —                               |
| SDKAssistantMessage        | `"assistant"`         | —                         | `parent_tool_use_id`            |
| SDKUserMessage             | `"user"`              | —                         | `parent_tool_use_id`            |
| SDKUserMessageReplay       | `"user"`              | —                         | `isReplay: true`                |
| SDKPartialAssistantMessage | `"stream_event"`      | —                         | `parent_tool_use_id`            |
| SDKResultMessage           | `"result"`            | `"success"` / `"error_*"` | —                               |
| SDKStatusMessage           | `"system"`            | `"status"`                | —                               |
| SDKCompactBoundaryMessage  | `"system"`            | `"compact_boundary"`      | —                               |
| SDKTaskStartedMessage      | `"system"`            | `"task_started"`          | `task_id`, `tool_use_id`        |
| SDKTaskProgressMessage     | `"system"`            | `"task_progress"`         | `task_id`, `tool_use_id`        |
| SDKTaskNotificationMessage | `"system"`            | `"task_notification"`     | `task_id`, `tool_use_id`        |
| SDKToolProgressMessage     | `"tool_progress"`     | —                         | `parent_tool_use_id`, `task_id` |
| SDKToolUseSummaryMessage   | `"tool_use_summary"`  | —                         | —                               |
| SDKHookStartedMessage      | `"system"`            | `"hook_started"`          | —                               |
| SDKHookProgressMessage     | `"system"`            | `"hook_progress"`         | —                               |
| SDKHookResponseMessage     | `"system"`            | `"hook_response"`         | —                               |
| SDKAuthStatusMessage       | `"auth_status"`       | —                         | —                               |
| SDKFilesPersistedEvent     | `"system"`            | `"files_persisted"`       | —                               |
| SDKRateLimitEvent          | `"rate_limit_event"`  | —                         | —                               |
| SDKPromptSuggestionMessage | `"prompt_suggestion"` | —                         | —                               |

**Sub-agent correlation**: Uses `parent_tool_use_id: string | null` on assistant, user, partial, and tool progress messages. Background tasks use `task_id` / `tool_use_id` triplet across `task_started` → `task_progress` → `task_notification`.

**Streaming deltas** (via `SDKPartialAssistantMessage.event: BetaRawMessageStreamEvent`):
- `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`

**Content block types**: `text`, `tool_use`, `thinking`

#### 2.2 OpenCode SDK — 42+ Event Types

OpenCode uses `BusEvent.define(name, zodSchema)` with typed pub/sub. The event envelope is `{ type, properties }`. The v2 surface (`@opencode-ai/sdk/v2`) is the preferred import.

**Core streaming events:**

| Event Type             | Key Properties                                       |
| ---------------------- | ---------------------------------------------------- |
| `message.part.delta`   | `sessionID`, `messageID`, `partID`, `field`, `delta` |
| `message.part.updated` | `part: Part` (discriminated union of 12 types)       |
| `message.part.removed` | `sessionID`, `messageID`, `partID`                   |
| `message.updated`      | `info: Message` (UserMessage \| AssistantMessage)    |
| `message.removed`      | —                                                    |

**Session lifecycle:**

| Event Type          | Key Properties                                     |
| ------------------- | -------------------------------------------------- |
| `session.created`   | `info: Session`                                    |
| `session.updated`   | `info: Session`                                    |
| `session.deleted`   | —                                                  |
| `session.error`     | error details                                      |
| `session.status`    | `sessionID`, `status: "idle" \| "busy" \| "retry"` |
| `session.idle`      | —                                                  |
| `session.diff`      | `sessionID`, `diff: FileDiff[]`                    |
| `session.compacted` | —                                                  |

**Part discriminated union** (12 types, discriminated on `type`):
`TextPart`, `ReasoningPart`, `ToolPart`, `FilePart`, `SubtaskPart`, `AgentPart`, `SnapshotPart`, `PatchPart`, `CompactionPart`, `StepStartPart`, `StepFinishPart`, `RetryPart`

**ToolState discriminated union** (4 states on `ToolPart.state.status`):
`pending`, `running`, `completed`, `error`

**Sub-agent handling**: No special event types. Sub-agents create child sessions with unique `sessionID` values, reusing the same `message.*` and `session.*` events. The `SubtaskPart` (`type: "subtask"`) describes delegation context.

**Additional events** (infrastructure): `permission.asked`, `permission.replied`, `question.asked/replied/rejected`, `file.edited`, `file.watcher.updated`, `lsp.*`, `vcs.branch.updated`, `mcp.*`, `workspace.*`, `pty.*`, `todo.updated`, `tui.*`, `command.executed`, `installation.*`, `server.*`

#### 2.3 Copilot SDK — 43 Event Types

Copilot uses **schema-generated discriminated unions** with `session.on()` typed subscriptions. The event envelope is `{ type, data }`. Events divide into two separate hierarchies: `SessionEvent` (conversation) and `SessionLifecycleEvent` (session lifecycle).

**Streaming events:**

| Event Type                  | Key Data Fields                                 |
| --------------------------- | ----------------------------------------------- |
| `assistant.message`         | `content`, `toolRequests[]`, `parentToolCallId` |
| `assistant.message_delta`   | `deltaContent` (ephemeral)                      |
| `assistant.reasoning`       | `content`                                       |
| `assistant.reasoning_delta` | `deltaContent` (ephemeral)                      |
| `assistant.turn_start`      | —                                               |
| `assistant.turn_end`        | —                                               |
| `assistant.usage`           | token counts, model                             |

**Tool events:**

| Event Type                      | Key Data Fields                                           |
| ------------------------------- | --------------------------------------------------------- |
| `tool.execution_start`          | `toolCallId`, `toolName`, `arguments`, `parentToolCallId` |
| `tool.execution_partial_result` | partial output                                            |
| `tool.execution_progress`       | `progressText`                                            |
| `tool.execution_complete`       | `toolCallId`, `success`, `result`, `error`                |
| `tool.user_requested`           | —                                                         |

**Session lifecycle:**

| Event Type                                         | Key Data Fields                                          |
| -------------------------------------------------- | -------------------------------------------------------- |
| `session.start`                                    | `sessionId`, `selectedModel`, `context { cwd, gitRoot }` |
| `session.resume`                                   | —                                                        |
| `session.idle`                                     | —                                                        |
| `session.error`                                    | `errorType`, `message`                                   |
| `session.shutdown`                                 | —                                                        |
| `session.context_changed`                          | —                                                        |
| `session.truncation`                               | —                                                        |
| `session.compaction_start` / `compaction_complete` | —                                                        |
| `session.usage_info`                               | —                                                        |

**Sub-agent events:**

| Event Type            | Key Data Fields                               |
| --------------------- | --------------------------------------------- |
| `subagent.selected`   | `agentName`, `agentDisplayName`, `tools`      |
| `subagent.started`    | `toolCallId`, `agentName`, `agentDescription` |
| `subagent.completed`  | `toolCallId`, `agentName`                     |
| `subagent.failed`     | `toolCallId`, `agentName`, `error`            |
| `subagent.deselected` | —                                             |

**Other:** `user.message`, `permission.requested`, `skill.invoked`

**Sub-agent correlation**: Uses `toolCallId` on sub-agent events and `parentToolCallId` on tool/message events to reconstruct the execution tree. Sequential delegation only (one sub-agent at a time).

---

### 3. Provider Adapter SDK → BusEvent Mappings

All three SDK adapters normalize into the unified 26-type `BusEventType` system. Each adapter uses a `switch` in its handler factory to route provider events.

#### 3.1 Normalized Provider Event Types (Intermediate Layer)

The adapters use a shared `ProviderStreamEventType` vocabulary (`services/agents/provider-events/contracts.ts:10-35`) as an intermediate normalization layer between raw SDK events and `BusEvent` types:

| Provider Event          | → BusEvent Type                                                 | Claude                                  | OpenCode                                        | Copilot                             |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| `message.delta`         | `stream.text.delta` or `stream.thinking.delta`                  | via content block deltas                | via `message.part.delta`                        | via `assistant.message_delta`       |
| `message.complete`      | `stream.text.complete` + `stream.tool.start` (per tool request) | via `SDKAssistantMessage`               | via `message.part.updated`                      | via `assistant.message`             |
| `reasoning.delta`       | `stream.thinking.delta`                                         | via thinking content blocks             | via `message.part.delta` (contentType=thinking) | via `assistant.reasoning_delta`     |
| `reasoning.complete`    | `stream.thinking.complete`                                      | via content block stop                  | via step finish metadata                        | via `assistant.reasoning`           |
| `tool.start`            | `stream.tool.start`                                             | via `PreToolUse` hook or content blocks | via `tool.execute.before`                       | via `tool.execution_start`          |
| `tool.complete`         | `stream.tool.complete`                                          | via `PostToolUse` hook or tool result   | via `tool.execute.after`                        | via `tool.execution_complete`       |
| `tool.partial_result`   | `stream.tool.partial_result`                                    | via tool progress                       | —                                               | via `tool.execution_partial_result` |
| `subagent.start`        | `stream.agent.start`                                            | via task_started + correlation          | via child session creation                      | via `subagent.started`              |
| `subagent.complete`     | `stream.agent.complete`                                         | via task_notification                   | via child session idle                          | via `subagent.completed`            |
| `subagent.update`       | `stream.agent.update`                                           | via task_progress                       | —                                               | via (synthetic)                     |
| `session.error`         | `stream.session.error`                                          | via SDK error messages                  | via `session.error`                             | via `session.error`                 |
| `session.idle`          | `stream.session.idle`                                           | adapter finally block                   | adapter finally block                           | deferred to finally block           |
| `usage`                 | `stream.usage`                                                  | via result message usage                | via step finish tokens                          | via `assistant.usage`               |
| `permission.requested`  | `stream.permission.requested`                                   | via hook system                         | via `permission.asked`                          | via `permission.requested`          |
| `human_input_required`  | `stream.human_input_required`                                   | via hook system                         | via `question.asked`                            | via (not available)                 |
| `skill.invoked`         | `stream.skill.invoked`                                          | via skill hook                          | —                                               | via `skill.invoked`                 |
| `turn.start`            | `stream.turn.start`                                             | adapter-generated                       | adapter-generated                               | via `assistant.turn_start`          |
| `turn.end`              | `stream.turn.end`                                               | via message stop                        | via step finish                                 | via `assistant.turn_end`            |
| `session.info`          | `stream.session.info`                                           | via SDK info messages                   | —                                               | via `session.context_changed`       |
| `session.warning`       | `stream.session.warning`                                        | via SDK warning                         | —                                               | no-op (suppressed)                  |
| `session.title_changed` | `stream.session.title_changed`                                  | via SDK title change                    | —                                               | via (synthetic)                     |
| `session.truncation`    | `stream.session.truncation`                                     | via compact boundary                    | —                                               | via `session.truncation`            |
| `session.compaction`    | `stream.session.compaction`                                     | via status compacting                   | via `session.compacted`                         | via `session.compaction_*`          |

#### 3.2 Sub-Agent Event Routing (Cross-Provider Patterns)

All three adapters implement these shared patterns:

1. **Early tool event queuing**: Tool starts arriving before their parent `subagent.start` are queued in `Map<string, EarlyToolEvent[]>` and replayed when the parent starts
2. **Multi-alias correlation ID resolution**: Different SDK event types reference the same logical tool by different field names (`toolUseId`, `toolCallId`, `toolUseID`)
3. **Synthetic foreground agent wrapping**: When `options.agent` is provided, a virtual agent ID (`agent-only-*`) groups events under a synthetic agent lifecycle

**Claude-specific**: 7-level parent agent resolution cascade in `tool-hook-handlers.ts:232-240` (direct → task dispatch → session mapped → TaskOutput → sole active → background → active tool → synthetic)

**Copilot-specific**: Tool.complete suppression for task tools — SDK fires `tool.execution_complete` BEFORE `subagent.completed`, so the adapter synthesizes a deferred tool complete at the correct time

**OpenCode-specific**: Tool start signature deduplication via `buildToolStartSignature` — identical signatures are suppressed to prevent duplicates from the dual-path stream

---

### 4. SDK Event Handling Paradigms (External Guidance)

#### 4.1 OpenCode: `BusEvent.define()` + Zod Schemas

```typescript
// Define events with compile-time + runtime type safety
const PartUpdated = BusEvent.define("message.part.updated", z.object({
  part: PartSchema,
}));

// Subscribe with automatic type inference
Bus.subscribe(PartUpdated, (event) => {
  // event.properties is typed as { part: Part }
});
```

Key patterns:
- **Type-safe by construction**: No `as` casts needed — Zod schema provides both compile-time and runtime validation
- **Coalescing built into the bus**: Key-based coalescing (`session.status:{dir}:{sid}`) prevents redundant updates
- **Frame-aligned batching**: 16ms flush intervals with double-buffer swap

#### 4.2 Copilot: Schema-Generated Typed Subscriptions

```typescript
// Typed subscription — automatic narrowing
session.on("assistant.message_delta", (event) => {
  // event.data is typed as { deltaContent: string }
});

// Or wildcard with manual narrowing
session.on((event) => {
  switch (event.type) { ... }
});
```

Key patterns:
- **Auto-generated types from JSON schema**: Types are derived, not hand-written
- **Separate event hierarchies**: `SessionEvent` vs `SessionLifecycleEvent` — different handler signatures
- **Middleware hooks**: `onPreToolUse`, `onPostToolUse`, `onUserPromptSubmitted` for intercepting lifecycle

#### 4.3 Claude: AsyncGenerator + Discriminated Unions

```typescript
for await (const message of query({ prompt })) {
  switch (message.type) {
    case "stream_event":
      // Process streaming deltas
      break;
    case "assistant":
      // Process complete response
      break;
  }
}
```

Key patterns:
- **Pull-based**: Consumer controls iteration pace (natural backpressure)
- **Two-level discrimination**: `type` for message category, `subtype` for system message variants
- **`parent_tool_use_id`**: The universal sub-agent correlation field

---

### 5. Event Envelope Differences (Critical for Adapter Layer)

| SDK         | Discriminator                      | Payload Key        | Sub-Agent Correlation             |
| ----------- | ---------------------------------- | ------------------ | --------------------------------- |
| OpenCode v2 | `event.type`                       | `event.properties` | `sessionID` on all events         |
| Copilot     | `event.type`                       | `event.data`       | `toolCallId` / `parentToolCallId` |
| Claude      | `message.type` + `message.subtype` | Varies per type    | `parent_tool_use_id` / `task_id`  |

---

## Code References

### Current EventBus Pipeline
- `src/services/events/event-bus.ts:85-332` — EventBus class with publish/subscribe
- `src/services/events/bus-events/types.ts:5-237` — 26 BusEventType definitions + BusEventDataMap
- `src/services/events/bus-events/schemas.ts:1-187` — Zod validation schemas for all event types
- `src/services/events/batch-dispatcher.ts:89-313` — Frame-aligned batching with coalescing
- `src/services/events/coalescing.ts:8-71` — Coalescing key generation (switch statement)

### Consumer Pipeline (Manual Callback Logic)
- `src/services/events/consumers/correlation-service.ts:124-346` — 210-line enrich() switch
- `src/services/events/consumers/wire-consumers.ts:65-108` — Manual filtering in batch callback
- `src/services/events/consumers/stream-pipeline-consumer.ts:179-421` — 240-line mapToStreamPart() switch
- `src/services/events/consumers/echo-suppressor.ts:13-93` — Echo suppression state machine
- `src/services/events/hooks.ts:74-294` — React hooks with ref-based stability

### Provider Adapters
- `src/services/events/adapters/providers/claude/handler-factory.ts:86-169` — Claude event routing switch
- `src/services/events/adapters/providers/opencode/handler-factory.ts:110-200` — OpenCode event routing switch
- `src/services/events/adapters/providers/copilot/provider-router.ts:87-298` — Copilot event routing switch
- `src/services/events/adapters/event-coverage-policy.ts` — Formal coverage invariant
- `src/services/agents/provider-events/contracts.ts:10-35` — ProviderStreamEventType definitions

### Sub-Agent Handling
- `src/services/events/adapters/providers/claude/subagent-event-handlers.ts:43-281` — Claude sub-agent lifecycle
- `src/services/events/adapters/providers/opencode/subagent-event-handlers.ts` — OpenCode sub-agent lifecycle
- `src/services/events/adapters/providers/copilot/subagent-handlers.ts:90-259` — Copilot sub-agent lifecycle
- `src/services/events/adapters/subagent-adapter/index.ts:28-133` — Workflow sub-agent adapter

---

## Architecture Documentation

### Current Event Flow Pipeline

```
SDK Stream (Claude/OpenCode/Copilot)
  → Provider Adapter (switch on SDK event type)
    → BusEvent normalization
      → EventBus.publish() (Zod validation → typed handlers → wildcard handlers)
        → BatchDispatcher.enqueue() (coalescing, stale-delta filtering)
          → flush() every 16ms
            → wireConsumers batch callback
              → ownership filter (isOwnedEvent)
              → CorrelationService.enrich() (210-line switch)
              → suppression filter (!suppressFromMainChat)
              → StreamPipelineConsumer.processBatch() (240-line switch)
                → StreamPartEvent[] → applyStreamPartEvent() reducer → UI state
```

### Adapter Handler Architecture

Each adapter uses a **Handler Factory pattern** with specialized handler classes:

```
ClaudeStreamAdapter
  ├── ClaudeStreamingRuntime (retry loop, lifecycle events)
  ├── ClaudeStreamChunkProcessor (AsyncIterable path)
  ├── ClaudeToolHookHandlers (provider event path)
  ├── ClaudeSubagentEventHandlers (agent lifecycle)
  └── ClaudeAuxEventHandlers (info, warning, usage, turns, etc.)

OpenCodeStreamAdapter
  ├── OpenCodeStreamingRuntime (dual-mode: sendAsync + stream)
  ├── OpenCodeStreamChunkProcessor (message/thinking deltas)
  ├── OpenCodeToolEventHandlers (with signature deduplication)
  ├── OpenCodeSubagentEventHandlers (agent lifecycle)
  └── OpenCodeAuxEventHandlers (usage, permissions, etc.)

CopilotStreamAdapter
  ├── CopilotStreamingRuntime (deferred idle, background-only mode)
  ├── CopilotProviderRouter (event routing switch)
  ├── CopilotMessageToolHandlers (delta/complete/tool extraction)
  ├── CopilotSubagentHandlers (with nested suppression)
  └── CopilotSessionHandlers (lifecycle events)
```

---

## Historical Context (from research/)

### Primary Research Documents
- `research/docs/2026-02-26-streaming-architecture-event-bus-migration.md` — Foundational design document for migrating from callbacks to event bus; documents pain points of the callback approach and the target architecture
- `research/docs/2026-02-26-streaming-event-bus-spec-audit.md` — Spec compliance audit for the event bus migration
- `research/docs/2026-02-26-opencode-event-bus-patterns.md` — OpenCode's batched coalescing and event bus patterns that inspired the current architecture
- `research/docs/2026-03-06-opencode-sdk-event-schema-reference.md` — Canonical OpenCode SDK v2 event type reference
- `research/docs/2026-03-06-copilot-sdk-session-events-schema-reference.md` — Canonical Copilot SDK session event type reference
- `research/docs/2026-03-13-codebase-architecture-modularity-analysis.md` — Module boundary analysis including EventBus coupling

### Key Historical Decisions
1. **Single event pathway over dual-path** — The original callback architecture had a `toolEventsViaHooks` flag creating two delivery paths; the event bus eliminated this (2026-02-26 migration doc)
2. **In-process bus over SSE server** — Atomic is a TUI app without a local server, so an in-process bus was chosen over OpenCode's SSE transport (2026-02-26 migration doc)
3. **Frame-aligned 16ms batching** — Adopted from OpenCode's pattern, replacing the original 100ms throttle (2026-02-26 opencode patterns doc)
4. **Prefer `@opencode-ai/sdk/v2`** — v2 has cleaner delta separation and better event model (2026-03-06 schema reference)
5. **Copilot dual event hierarchies** — `SessionEvent` and `SessionLifecycleEvent` are separate type hierarchies requiring different handler signatures (2026-03-06 copilot schema reference)

### Related Specs
- `specs/streaming-architecture-event-bus-migration.md` — Technical design for the event bus migration
- `specs/streaming-event-bus-spec-compliance-remediation.md` — Spec compliance fixes
- `specs/codebase-architecture-modularity-refactor.md` — Module boundary refactor including EventBus
- `specs/sdk-v2-first-unified-layer.md` — SDK v2-first unified layer design

---

## Related Research

- `research/docs/2026-02-15-subagent-event-flow-diagram.md` — Sub-agent event flow and race conditions
- `research/docs/2026-02-23-258-background-agents-sdk-event-pipeline.md` — Background agent pipeline issues
- `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md` — Claude sub-agent done-state ordering
- `research/docs/2026-03-08-claude-subagent-tree-tool-call-streaming.md` — Claude sub-agent tree tool call streaming
- `research/docs/2026-03-12-background-agent-spinner-premature-completion.md` — Background agent spinner issues
- `research/docs/2026-02-25-workflow-sdk-patterns.md` — External SDK patterns for workflow orchestration

---

## Open Questions

1. **Handler registry vs middleware pipeline**: Should the CorrelationService switch be replaced by a handler registry (`Map<BusEventType, EnrichmentHandler>`) or a middleware pipeline (chain of functions)?
2. **Event-to-handler registration granularity**: Should enrichment handlers be registered per-event-type (fine-grained, 26 handlers) or per-event-category (e.g., `stream.tool.*`, `stream.agent.*`)?
3. **Correlation as adapter responsibility vs consumer responsibility**: The streaming migration doc recommends adapters emit pre-correlated events, but the current design has downstream CorrelationService handling it — which should be the target?
4. **Zod schema + BusEventDataMap redundancy**: Both exist today; should schemas be the source of truth (like OpenCode) with types inferred from them?
5. **StreamPipelineConsumer mapToStreamPart()**: Should this transformation be co-located with event type definitions (registry pattern) or kept as a separate transformation layer?
