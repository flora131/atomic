---
date: 2026-03-15 19:45:00 UTC
researcher: Claude Opus 4.6
git_commit: d3f22e2b5bf791dcc57580e001ac279c85390fce
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Comprehensive from-scratch rebuild specification for the Atomic TUI application — addressing streaming UI instabilities, un-unified workflow SDK, and architectural fragilities"
tags: [research, architecture, rebuild-spec, streaming, workflow, sdk-unification, state-management, graph-engine, ui-rendering, event-bus]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude Opus 4.6
---

# Atomic TUI: From-Scratch Rebuild Specification

## Research Question

Conduct a comprehensive audit of the Atomic TUI application's current architecture, implementation patterns, and known instabilities — focusing on (1) the streaming UI pipeline, (2) the workflow SDK abstraction layer, and (3) cross-cutting concerns — with enough fidelity to produce a hierarchical from-scratch rebuild specification that addresses observed design fragilities.

## Executive Summary

The Atomic TUI is a 576-file TypeScript/Bun terminal application built on OpenTUI (React-for-terminal) that wraps three coding agent SDKs (Claude Agent SDK, OpenCode SDK, Copilot SDK) behind a unified chat interface with autonomous workflow support. The current system has three fundamental architectural fragilities:

1. **Dual-pipeline streaming**: The EventBus pipeline handles 1:1 chat streaming correctly, but the workflow system (Ralph) completely bypasses it through CommandContext callbacks, creating two parallel event flows with incompatible state mutation patterns.

2. **State gravitational center**: The `state/` module is the most-imported layer (270 cross-module imports) with 9 bidirectional circular dependency pairs, ~55 React hooks, and a 500-line HITL hook containing workflow-specific auto-answer logic that should live in the service layer.

3. **Sequential graph execution**: The graph engine uses a FIFO queue (`nodeQueue.shift()`) that processes one node at a time, and the Ralph worker node processes only `ready[0]` despite infrastructure for parallel sub-agent dispatch existing.

This document provides a complete architectural audit organized as hierarchical specs for a ground-up rebuild.

---

## Table of Contents

- [Atomic TUI: From-Scratch Rebuild Specification](#atomic-tui-from-scratch-rebuild-specification)
  - [Research Question](#research-question)
  - [Executive Summary](#executive-summary)
  - [Table of Contents](#table-of-contents)
  - [Spec 1: Streaming UI Pipeline](#spec-1-streaming-ui-pipeline)
    - [1.1 SDK Stream Adapters](#11-sdk-stream-adapters)
    - [1.2 EventBus Core](#12-eventbus-core)
    - [1.3 Consumer Pipeline](#13-consumer-pipeline)
    - [1.4 StreamPartEvent Reducer](#14-streampartevent-reducer)
    - [1.5 State-to-UI Bridge](#15-state-to-ui-bridge)
    - [1.6 Current Instabilities](#16-current-instabilities)
  - [Spec 2: SDK Unification Layer](#spec-2-sdk-unification-layer)
    - [2.1 CodingAgentClient Interface](#21-codingagentclient-interface)
    - [2.2 Per-Provider Clients](#22-per-provider-clients)
    - [2.3 Provider Events Layer](#23-provider-events-layer)
    - [2.4 Tool System](#24-tool-system)
    - [2.5 Current Fragilities](#25-current-fragilities)
  - [Spec 3: State Management](#spec-3-state-management)
    - [3.1 Chat State Sub-Modules](#31-chat-state-sub-modules)
    - [3.2 Parts System](#32-parts-system)
    - [3.3 Streaming State](#33-streaming-state)
    - [3.4 Runtime State](#34-runtime-state)
    - [3.5 Current Fragilities](#35-current-fragilities)
  - [Spec 4: Workflow \& Graph Engine](#spec-4-workflow--graph-engine)
    - [4.1 Graph Execution Engine](#41-graph-execution-engine)
    - [4.2 Workflow Runtime](#42-workflow-runtime)
    - [4.3 Ralph Workflow](#43-ralph-workflow)
    - [4.4 Runtime Contracts](#44-runtime-contracts)
    - [4.5 Current Fragilities](#45-current-fragilities)
  - [Spec 5: UI Layer](#spec-5-ui-layer)
    - [5.1 Application Bootstrap](#51-application-bootstrap)
    - [5.2 Screen Architecture](#52-screen-architecture)
    - [5.3 Component System](#53-component-system)
    - [5.4 Message Rendering Pipeline](#54-message-rendering-pipeline)
    - [5.5 Current Fragilities](#55-current-fragilities)
  - [Spec 6: Command \& Config System](#spec-6-command--config-system)
    - [6.1 Command Registry](#61-command-registry)
    - [6.2 Config Loading](#62-config-loading)
    - [6.3 Agent Discovery](#63-agent-discovery)
    - [6.4 Current Fragilities](#64-current-fragilities)
  - [Spec 7: Cross-Cutting Concerns](#spec-7-cross-cutting-concerns)
    - [7.1 Error Handling](#71-error-handling)
    - [7.2 Telemetry](#72-telemetry)
    - [7.3 Models System](#73-models-system)
    - [7.4 Build \& Test Infrastructure](#74-build--test-infrastructure)
  - [Architecture Documentation](#architecture-documentation)
    - [Current Layered Architecture](#current-layered-architecture)
    - [Key Architectural Patterns](#key-architectural-patterns)
    - [Coupling Hotspots (Highest Fan-In Files)](#coupling-hotspots-highest-fan-in-files)
  - [Historical Context (from research/)](#historical-context-from-research)
  - [Related Research](#related-research)
  - [Open Questions](#open-questions)

---

## Spec 1: Streaming UI Pipeline

### 1.1 SDK Stream Adapters

**Current implementation**: Three adapter classes (`ClaudeStreamAdapter`, `OpenCodeStreamAdapter`, `CopilotStreamAdapter`) in `services/events/adapters/providers/` implement `SDKStreamAdapter` interface with `startStreaming()` and `dispose()` methods.

**Data flow**: Raw SDK events → adapter handler classes → `BusEvent` construction → `correlate()` enrichment → `EventBus.publish()`.

**Key mechanisms**:
- **Correlating bus proxy** (`adapters/shared/adapter-correlation.ts:108-282`): A `Proxy` wrapping `EventBus.publish()` that enriches events with `resolvedToolId`, `resolvedAgentId`, `isSubagentTool`, `suppressFromMainChat`, `parentAgentId` before they reach the bus.
- **Per-adapter handler decomposition**: Claude uses 5 handler classes (StreamChunkProcessor, ToolHookHandlers, AuxEventHandlers, SubagentEventHandlers, ToolState). OpenCode and Copilot follow similar patterns.
- **Event coverage policy** (`adapters/event-coverage-policy.ts`): Documents mapping of all SDK event types to canonical `BusEventType` with runtime invariant assertion.

**SDK streaming paradigms**:
| SDK      | Transport                                                                            | Event Model                                           | Sub-agent Correlation           |
| -------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------- |
| Claude   | `AsyncIterable` from `session.stream()` + `onProviderEvent()` hooks (22 event types) | `SDKMessage` discriminated on `type`+`subtype`        | `parent_tool_use_id`            |
| OpenCode | SSE via `sdk.event.subscribe()` + HTTP client-server                                 | `GlobalEvent` with `BusEvent.define()` Zod schemas    | `sessionID`-based parent-child  |
| Copilot  | EventEmitter via `session.on()` + `session.stream()` async iterator                  | `SessionEvent` with `id`/`timestamp`/`parentId` chain | `toolCallId`/`parentToolCallId` |

### 1.2 EventBus Core

**Current implementation** (`services/events/event-bus.ts:85-332`): Typed pub/sub with 26 event types across 8 categories (text, thinking, tool, agent, session, turn, interaction, usage). All event schemas Zod-validated at publish time.

**Key properties**:
- Per-handler error isolation (handler failures never break publisher)
- Wildcard handlers for debugging/logging
- Internal error channel for schema drops and handler exceptions
- Zero workflow-specific events in the bus itself

### 1.3 Consumer Pipeline

**Current implementation** (`services/events/consumers/`): Linear chain assembled by `wireConsumers()`:

```
EventBus.onAll() → BatchDispatcher.enqueue()
  → 16ms frame-aligned flush (double-buffer swap)
    → OwnershipTracker.isOwnedEvent() filter
      → suppressFromMainChat filter
        → StreamPipelineConsumer.processBatch()
          → EventHandlerRegistry.getStreamPartMapper() per event
            → In-batch coalescing of adjacent text-delta / thinking-meta
              → onStreamParts callback
```

**BatchDispatcher** (`batch-dispatcher.ts:90-311`): 16ms flush interval (~60fps), double-buffer swap (zero allocation), key-based coalescing with stale-delta superseding, overflow protection at 10,000 events.

**EventHandlerRegistry** (`registry/registry.ts:21-163`): Singleton holding per-event-type descriptors with `coalescingKey`, `toStreamPart` mapper, `isStale` predicate, and `staleKey`/`supersedesStaleKey` for staleness chain.

**EchoSuppressor** (`consumers/echo-suppressor.ts:13-93`): FIFO queue of expected echo targets. Accumulates incoming deltas and compares against active target prefix.

### 1.4 StreamPartEvent Reducer

**Current implementation** (`state/streaming/pipeline.ts:70-365`): Pure function `applyStreamPartEvent(message: ChatMessage, event: StreamPartEvent) => ChatMessage`.

**StreamPartEvent union** (13 members): `text-delta`, `text-complete`, `thinking-meta`, `thinking-complete`, `tool-start`, `tool-complete`, `tool-partial-result`, `tool-hitl-request`, `tool-hitl-response`, `parallel-agents`, `agent-terminal`, `task-list-update`, `task-result-upsert`.

**Key sub-modules**:
- `pipeline-agents/`: Agent event buffering (for agents not yet in parts), inline part routing, parallel agent merging and normalization.
- `pipeline-tools/`: Tool call upsert, tool part upsert, HITL request/response overlay.
- `pipeline-thinking.ts`: WeakMap-based `reasoningPartIdBySourceRegistry` for stable part IDs across immutable message copies.

### 1.5 State-to-UI Bridge

**Dual delivery path**:
1. **StreamPartEvent path** (batched): `useChatStreamConsumer` → `applyStreamPartBatchToMessages()` → `setMessagesWindowed()` → React re-render.
2. **Direct bus subscription path** (unbatched): `useBusSubscription()` hooks for session lifecycle, agent lifecycle, usage, interactions → direct `setState` calls.

Session events (`stream.session.start/idle/error/retry/info/warning/title_changed/truncation/compaction`) and agent events (`stream.agent.start/update/complete`) return `null` from `toStreamPart` and are consumed exclusively via direct subscriptions.

### 1.6 Current Instabilities

1. **`dispose()` null reference bug**: Both `opencode-adapter.ts` and `claude-adapter.ts` — when `dispose()` is called during active streaming, `this.abortController` is set to null, and the subsequent error handler tries to access `.signal.aborted`. Tests documenting this are SKIPPED.

2. **Deferred completion race**: When `handleStreamComplete()` fires while sub-agents are still "running" in React state, completion is deferred. Resolution chain: `stream.agent.complete` event → 16ms batch → React state update → re-render → `useEffect` → `setTimeout(0)` → re-entry. A 30-second safety timeout exists as worst-case fallback.

3. **Sub-agent tree stuck at "Initializing..."**: `AgentRow` shows "Initializing..." until `agent.toolUses > 0`. Multiple chokepoints: event coalescing, `AgentPart` not yet created when tool events arrive (silent drops), `useBusSubscription` handler race.

4. **Post-completion text ordering**: Post-completion text streams above the agent tree (interleaved segments use `contentOffsetAtStart` for chronological ordering, but `ParallelAgentsTree` is rendered at fixed position below all segments).

5. **12 unconsumed event types**: 5 session events, 2 turn lifecycle, 1 tool partial result, 3 workflow events, 1 skill event — registered but never read by any consumer.

6. **Workflow bypass**: The `task-list-update` and `task-result-upsert` `StreamPartEvent` types exist in the union but are NOT produced by the EventBus pipeline — they're produced by `CommandContext.updateTaskList()` which bypasses the bus entirely.

---

## Spec 2: SDK Unification Layer

### 2.1 CodingAgentClient Interface

**Current implementation** (`services/agents/contracts/client.ts:7-23`): Strategy pattern with 13 methods including `createSession`, `resumeSession`, `on<T>(eventType, handler)`, `registerTool`, `start`, `stop`, `getModelDisplayInfo`, `setActiveSessionModel`, `getSystemToolsTokens`.

**Unified event system** (`contracts/events.ts`): 25 `EventType` values with typed `EventDataMap`. Dual-layer: unified events for cross-provider consumption, `ProviderEventEnvelope` wrapping native SDK events for adapter-specific processing.

**Session contract** (`contracts/session.ts:66-87`): `Session` interface with `send()`, `stream()` (AsyncIterable), `sendAsync()`, `summarize()`, `getContextUsage()`, `destroy()`, `abort()`, `abortBackgroundAgents()`.

### 2.2 Per-Provider Clients

| Provider | Architecture                               | Session Creation                | Streaming                              |
| -------- | ------------------------------------------ | ------------------------------- | -------------------------------------- |
| Claude   | In-process SDK wrapping Claude Code binary | `query()` → lazy `Query` object | `for await` over `SDKMessage` iterator |
| OpenCode | Client-server (HTTP + SSE)                 | `sdkClient.session.create()`    | SSE reconnecting event loop            |
| Copilot  | In-process SDK via JSON-RPC                | `sdkClient.createSession()`     | `session.stream()` + `session.on()`    |

**Claude specifics**: Uses MCP-based tool wrapping via `createSdkMcpServer()`. Adaptive thinking config (opus/sonnet get `{ type: "adaptive" }`, others get explicit budget). 22 hook events for tool/session lifecycle. V1 API preferred (V2 documented but unused).

**OpenCode specifics**: Auto-spawns server process. Reconnecting SSE loop with watchdog. Tool bridge via HTTP dispatch server + generated MCP stdio script for cross-process tool execution.

**Copilot specifics**: Two-object model (CopilotClient + CopilotSession). Event deduplication via `recentEventIds: Set<string>` (window = 2048). Pending model switch requires session restart (`requiresNewSession: true`).

### 2.3 Provider Events Layer

**Current implementation** (`services/agents/provider-events/contracts.ts`): `ProviderEventEnvelope` preserving native SDK event alongside normalized data. Three provider-specific union types: `ClaudeProviderEvent`, `OpenCodeProviderEvent`, `CopilotProviderEvent`.

**Synthetic events**: `SyntheticProviderNativeEvent` created when native event unavailable (client-side logic vs. SDK event).

### 2.4 Tool System

**ToolRegistry** (`services/agents/tools/registry.ts`): Singleton `Map<string, ToolEntry>` with discovery from `.atomic/tools/` directories.

**Plugin API** (`tools/plugin.ts`): `tool()` identity function with Zod schema inference. User tools import from `@atomic/plugin`.

**Cross-provider registration**: Claude wraps in MCP, OpenCode generates stdio MCP script + HTTP dispatch server, Copilot converts to `SdkTool`.

**Built-in TodoWrite tool** (`tools/todo-write.ts`): Cross-provider implementation for SDKs without built-in todo support.

### 2.5 Current Fragilities

1. **Three different tool registration mechanisms**: Claude (MCP server), OpenCode (HTTP bridge + MCP script), Copilot (direct SDK tool). Each has its own error handling and lifecycle.

2. **OpenCode MCP bridge returns placeholder strings**: Documented gap — the bridge returns placeholder strings instead of executing actual handlers in some cases.

3. **Stream integrity counters unacted upon**: `streamIntegrity` in Claude client tracks unmatched tool starts/completes and missing terminal events, but no corrective action is taken.

4. **Provider event layer duplication**: The `ProviderStreamEventType` mirrors `EventType` exactly (same 25 types) but serves a different purpose. This creates maintenance burden — changes must be synchronized.

5. **Copilot 20+ ignored event types**: `session.usage_info`, `session.shutdown`, `assistant.intent`, `hook.start`, `hook.end`, etc. are explicitly dropped in the event mapper — potential data loss.

---

## Spec 3: State Management

### 3.1 Chat State Sub-Modules

**Current implementation** (`state/chat/`): 8 sub-modules with enforced boundary rules (linted by `check-submodule-boundaries.ts`):

| Sub-Module    | Responsibility                                | Key Hooks                  |
| ------------- | --------------------------------------------- | -------------------------- |
| `agent/`      | Background agents, parallel trees, ordering   | `useChatAgentProjection`   |
| `command/`    | Slash command execution, context factory      | `useCommandExecutor`       |
| `composer/`   | Input, autocomplete, submit, mentions         | `useComposerController`    |
| `controller/` | UI controller bridge, HITL, orchestration     | `useChatUiControllerStack` |
| `keyboard/`   | Shortcuts, interrupts, background termination | `useChatKeyboard`          |
| `session/`    | Session lifecycle types (pure re-exports)     | None                       |
| `shell/`      | Layout, render model, scroll                  | `useChatRenderModel`       |
| `stream/`     | Stream lifecycle, consumers, subscriptions    | `useChatStreamRuntime`     |

**Hook composition tree**:
```
ChatApp
  └─ useChatShellState
  └─ useChatStreamRuntime
  │    ├── useChatBackgroundDispatch
  │    ├── useChatRunTracking
  │    ├── useChatRuntimeControls
  │    ├── useChatRuntimeEffects
  │    ├── useChatStreamConsumer
  │    │    ├── useChatStreamAgentOrdering
  │    │    └── useChatStreamToolEvents
  │    └── useChatStreamLifecycle
  │         ├── useChatStreamStartup
  │         ├── useChatStreamCompletion (3 sub-hooks)
  │         ├── useChatStreamErrors
  │         ├── useStreamAgentSubscriptions
  │         └── useStreamSessionSubscriptions
  └─ useChatAppOrchestration
  └─ useChatRuntimeStack
  │    ├── useWorkflowHitl
  │    ├── useStreamSubscriptions
  │    └── useChatAgentProjection (3 sub-hooks)
  └─ useChatUiControllerStack
       ├── useChatDispatchController
       ├── useComposerController
       ├── useChatKeyboard
       └── useChatRenderModel
```

### 3.2 Parts System

**Part discriminated union** (`state/parts/types.ts`): 10 types — `TextPart`, `ReasoningPart`, `ToolPart`, `AgentPart`, `TaskListPart`, `SkillLoadPart`, `McpSnapshotPart`, `CompactionPart`, `TaskResultPart`, `WorkflowStepPart`.

**PartId** (`state/parts/id.ts`): Branded string `part_<12-hex-timestamp>_<4-hex-counter>`. Lexicographic sort = chronological order.

**Part store** (`state/parts/store.ts`): Binary search insertion/update maintaining sort order.

### 3.3 Streaming State

See Spec 1.4 for `StreamPartEvent` reducer details.

### 3.4 Runtime State

**ChatUIState** (`state/runtime/chat-ui-controller-types.ts:15`): Mutable state bag with renderer, root, session, timing, abort controllers, run counter, telemetry tracker, EventBus, BatchDispatcher.

**StreamRunRuntime** (`state/runtime/stream-run-runtime.ts:48`): Tracks individual stream runs with Promise-based completion. Run kinds: `foreground`, `workflow-hidden`, `background`, `subagent`.

**createChatUIController** (`state/runtime/chat-ui-controller.ts:21`): Factory returning the runtime controller with `handleSendMessage`, `handleStreamMessage` (creates adapter, starts streaming, handles `SessionExpiredError` with auto-retry), `handleInterrupt`, `handleTerminateBackgroundAgentsFromUI`, `cleanup`, `resetSession`, `createSubagentSession`.

### 3.5 Current Fragilities

1. **9 circular dependency pairs**: `commands <-> services`, `components <-> state`, `screens <-> state`, `components <-> lib`, `lib <-> state`, `lib <-> services`. `state/` is the gravitational center with 270 cross-module imports.

2. **`components/parallel-agents-tree.tsx` imported 30 times from outside `components/`** (25 from `state/`): De facto type definition file. `ParallelAgent` type should be in `types/`.

3. **`screens/chat-screen.tsx` as type-export hub**: Re-exports from `state/chat/exports.ts`, creating circular dependency with state type system.

4. **`lib/ui/` contains ~35 files of domain-specific logic**: Agent lifecycle ledgers, ordering contracts, background agent behavior, stream continuation, task state — consumed by 114 imports from `state/` but belongs closer to its consumers.

5. **`CommandContext` has 7 workflow-specific methods** on a shared interface: `setWorkflowSessionDir`, `setWorkflowSessionId`, `setWorkflowTaskIds`, `updateTaskList`, `onTaskStatusChange`, `updateWorkflowState` — violating Interface Segregation.

6. **`use-workflow-hitl.ts` is 500 lines**: Mixes auto-start logic, auto-answer for permissions/questions, task state sync, session cleanup, and Ralph-specific spec approval in one hook.

7. **~55 React hooks in `state/chat/`**: Deep composition tree with `UseCommandExecutorArgs` having ~100 fields, `ChatShellProps` having ~55 properties.

---

## Spec 4: Workflow & Graph Engine

### 4.1 Graph Execution Engine

**GraphBuilder** (`graph/authoring/builder.ts:60`): Fluent API with `start()`, `then()`, `if()`/`else()`/`endif()`, `parallel()`, `loop()`, `wait()`, `subagent()`, `tool()`, `catch()`, `end()`, `compile()`.

**GraphExecutor** (`graph/runtime/compiled.ts:165`): BFS-style traversal via `executeGraphStreamSteps()`:
1. FIFO node queue (`nodeQueue.shift()`)
2. `executeNodeWithRetry()` with retry/skip/abort/goto error actions
3. State merge via `mergeState()` (additive for `outputs`)
4. Signal handling: `human_input_required` → pause, `checkpoint` → save
5. Next-node resolution via edge condition evaluation or `result.goto`

**Node types**: `agent`, `tool`, `decision`, `wait`, `ask_user`, `subgraph`, `parallel`. 7 node implementations in `graph/nodes/`.

**State annotation system** (`graph/annotation.ts`): LangGraph-inspired with built-in reducers (`replace`, `concat`, `merge`, `mergeById`, `max`, `min`, `sum`).

**Checkpointers**: `MemorySaver`, `FileSaver`, `ResearchDirSaver`, `SessionDirSaver`.

### 4.2 Workflow Runtime

**`executeWorkflow()`** (`runtime/executor/index.ts:68-407`): 6-phase orchestrator:
1. Session initialization (UUID, directory, registration)
2. Graph compilation (priority: `options.compiledGraph` > `definition.createGraph()` > `compileGraphConfig()`)
3. State creation
4. Registry and runtime setup (wires `spawnSubagent`, `spawnSubagentParallel`, `taskIdentity`, `subagentRegistry`, `notifyTaskStatusChange` into `compiled.config.runtime`)
5. Streaming execution (iterates `streamGraph()`, syncs task list, persists tasks)
6. Result reporting

**Task persistence**: Debounced at 100ms via `createWorkflowTaskPersistence()`. Atomic writes to `tasks.json.tmp` then rename.

### 4.3 Ralph Workflow

**7-node graph** (`ralph/definition.ts`): planner → parse-tasks → [loop: select-ready-tasks → worker] → reviewer → [if findings: prepare-fix-tasks → fixer].

**Worker node** (`ralph/graph/index.ts:54-206`): Gets ready tasks, sets all to "in_progress", spawns parallel sub-agents via `spawnSubagentParallel()`, maps results back with task identity resolution and `TaskResultEnvelope` construction.

**Task helpers**: JSON parsing with 3-attempt fallback (direct parse, regex array extraction, individual object extraction). Ready-task selection with normalized ID matching (trim, lowercase, strip `#`).

### 4.4 Runtime Contracts

**WorkflowRuntimeTask** (`runtime-contracts.ts:70`): Zod-validated with defensive normalization. Status: `pending | in_progress | completed | failed | blocked | error`.

**TaskIdentityService** (`task-identity-service.ts:79`): Canonical ID resolution with provider bindings and alias registration.

**Feature flags**: `emitTaskStatusEvents`, `persistTaskStatusEvents`, `strictTaskContract` (all default true).

**Parity observability**: In-process counters, gauges, histograms with label encoding.

### 4.5 Current Fragilities

1. **Workflow completely bypasses EventBus**: The executor communicates entirely through `CommandContext` callbacks (`addMessage`, `setStreaming`, `updateTaskList`, `onTaskStatusChange`). Only content within individual sub-agent sessions flows through the bus. Stage transitions, task status, and progress never touch the EventBus.

2. **Sequential graph execution**: `nodeQueue.shift()` processes one node at a time. Even `parallelNode()` pushes branch IDs to the queue for sequential execution. The Ralph worker node processes `ready[0]` (first ready task) despite `getReadyTasks()` returning all ready tasks. `spawnSubagentParallel` exists but Ralph doesn't use it for task-level parallelism from the graph layer.

3. **WorkflowSDK exists but is unused at runtime**: The `WorkflowSDK` class provides `init()`, `execute()`, `stream()`, `registerWorkflow()` — but Ralph bypasses it entirely, constructing ad-hoc runtime dependencies by directly mutating `compiled.config.runtime`.

4. **Hardcoded Ralph dispatch**: `createWorkflowCommand()` checks `metadata.name === "ralph"` and routes to specialized handling. Non-Ralph workflows get a generic handler that only sets UI state flags — no graph is built or executed.

5. **Custom workflow exports are metadata-only**: Custom workflows can export `name`, `description`, `aliases` but there is no mechanism to export a graph factory function, initial state factory, or runtime dependency requirements.

6. **Ralph-specific fields pollute shared interfaces**: `CommandContext` carries `setRalphSessionDir/Id/TaskIds`, `CommandContextState` has `ralphConfig`, chat state has `ralphSessionId`, `ralphSessionDir`, `ralphTaskIds`.

7. **56 state-layer files reference "workflow"**: Workflow flags propagate through components, hooks, and helpers throughout the entire state tree.

8. **Task list blink gap**: Ralph's worker node doesn't explicitly set task status to `"in_progress"` before spawning a sub-agent. Tasks go directly from `"pending"` to `"completed"`/`"error"`.

9. **Five identified streaming delay sources**: (1) Deferred completion when sub-agents still "running" (30s safety timeout), (2) SDK `session.idle` timing, (3) file I/O from `saveTasksToSession()` in graph loop, (4) React state update batching, (5) `shouldShowCompletionSummary` gate requiring all conditions simultaneously.

---

## Spec 5: UI Layer

### 5.1 Application Bootstrap

**TUI entry** (`app.tsx:103-254`): `startChatUI()` creates model operations, runtime state (EventBus + BatchDispatcher), controller, registers signal handlers, initializes commands + Tree-sitter assets, creates OpenTUI renderer with mouse tracking + alternate screen, renders component tree.

**CLI entry** (`cli.ts:33-215`): Commander.js program with `init`, `chat` (default), `config set`, `update`, `uninstall`, `upload-telemetry` commands.

### 5.2 Screen Architecture

**Single screen** (`screens/chat-screen.tsx:51-198`): `ChatApp` component orchestrates all state through 5 composition hooks, renders `<ChatShell />`.

**ChatShell** (`state/chat/shell/ChatShell.tsx:97-351`): Physical layout with ~55 props:
```
<box height="100%" width="100%">
  <AtomicHeader />
  <scrollbox stickyScroll stickyStart="bottom">
    {compactionSummary}
    {messageContent}
    {activeQuestion → UserQuestionDialog}
    {showModelSelector → ModelSelectorDialog}
    {queueIndicator}
    {inputContainer with textarea}
    {FooterStatus}
    {Autocomplete}
  </scrollbox>
</box>
```

### 5.3 Component System

**PART_REGISTRY** (`components/message-parts/registry.tsx:29-40`): Maps 10 `Part.type` values to renderer components. Each receives `{ part, isLast, syntaxStyle?, onAgentDoneRendered? }`.

**Key components**: `MessageBubble` (user/assistant/system rendering), `ParallelAgentsTree` (sub-agent tree with inline tool summaries), `ToolResult` (tool-specific renderers via `ToolRenderers` catalog), `UserQuestionDialog` (HITL with multi-select), `ModelSelectorDialog` (grouped by provider), `TaskListPanel` (file-driven with topological sort), `Autocomplete` (slash command dropdown).

**Tool renderer catalog**: 12 specialized renderers (Read, Edit, Bash, Write, Glob, Grep, Task, TodoWrite, ApplyPatch, Skill, MCP, AskQuestion) with per-tool icons, title extraction, and content formatting.

**Theme system**: Catppuccin-based with dark (Mocha) / light (Latte) variants. 21 semantic color properties. Gradient ASCII header with 9 color stops.

### 5.4 Message Rendering Pipeline

```
ChatMessage[] → MessageBubble per message
  → getRenderableAssistantParts() (filters, syncs tools, merges agents)
    → MessageBubbleParts iterates parts
      → PART_REGISTRY[part.type] dispatches to renderer
        → TextPartDisplay: <markdown> with StreamingBullet
        → ReasoningPartDisplay: dimmed <markdown> with "∴ Thought" header
        → ToolPartDisplay: <ToolResult> or HITL display
        → AgentPartDisplay: <ParallelAgentsTree>
        → Others: specialized displays
```

**Streaming content**: `part.isStreaming` controls animated bullets, streaming markdown, and `LoadingIndicator` with real-time metrics.

**Performance constraints**: `MAX_VISIBLE_MESSAGES = 50` with overflow to temp file buffer. `viewportCulling: false` for text selection.

### 5.5 Current Fragilities

1. **Sub-agent rendering divergence**: Main chat dispatches parts through `PART_REGISTRY` with full-fidelity renderers. Workflow sub-agent content lands in `agent.inlineParts[]` but is rendered by bespoke `AgentInlineText` (200-char truncated plain text, no markdown) and `AgentInlineTool` (30-char tool name, single line), bypassing `PART_REGISTRY` entirely. Only 2 of 10 part types handled, only latest part shown.

2. **Dual delivery path for agent lifecycle**: Path A (agent lifecycle via direct `useBusSubscription`) and Path B (agent-scoped tool/text via StreamPartEvent pipeline) must coordinate. Event buffering for agents not yet materialized adds complexity.

3. **6 unrendered UI components**: `WorkflowStepPartDisplay`, `UserQuestionInline`, `FooterStatus`, `TimestampDisplay`, `StreamingBullet`, `CodeBlock` — registered or imported but never reached in rendering paths.

4. **`ChatShellProps` has ~55 properties**: Flat interface threading all state through a single component boundary.

5. **`screens/chat-screen.tsx` as both component AND type-export hub**: Re-exports from `state/chat/exports.ts` including component re-exports from `@/components/`, creating cross-layer coupling.

---

## Spec 6: Command & Config System

### 6.1 Command Registry

**CommandRegistry** (`commands/core/registry.ts`): `Map<string, CommandDefinition>` with alias resolution. Category sort priority: workflow(0) > skill(1) > agent(2) > builtin(3) > folder(4) > file(5).

**4 registration sources**:
1. **Builtins** (6 commands): `/theme`, `/clear`, `/compact`, `/exit`, `/model`, `/mcp`
2. **Workflows**: Ralph built-in + custom `.ts` files from `.atomic/workflows/`
3. **Skills**: `SKILL.md` files discovered from provider-specific paths
4. **Agents**: `.md` files discovered from provider-specific paths

**Registration sequence** (`commands/tui/index.ts:101-135`): builtins → workflow files → workflow commands → skills → agents. All idempotent.

### 6.2 Config Loading

**Three-tier provider discovery**: `atomicBaseline` < `userGlobal` < `projectLocal` with per-provider path templates resolved from `PROVIDER_DISCOVERY_CONTRACTS`.

**Config loading chain**: Installation detection → config root resolution → discovery contract lookup → plan building → cache initialization → per-provider loading → MCP discovery → settings resolution.

**Settings**: Two-tier — local `.atomic/settings.json` overrides global `~/.atomic/settings.json`. Model preferences, reasoning effort, trusted workspaces, SCM selection.

**MCP config**: Concurrent per-ecosystem discovery (Claude `.mcp.json`, Copilot `.vscode/mcp.json`, OpenCode `opencode.json`).

### 6.3 Agent Discovery

**Discovery logic** (`services/agent-discovery/discovery.ts:290-375`): Discovers `.md` agent files from provider-compatible paths, parses frontmatter, validates integrity, applies priority override (project > user).

**Active session registry** (`services/agent-discovery/session.ts`): In-memory `Map<string, WorkflowSession>` with register/complete/get operations.

### 6.4 Current Fragilities

1. **`services/workflows/` imports from `commands/tui/`**: Discovery logic, session registration — violating the layered architecture (services must not import from commands).

2. **`--max-iterations` CLI flag parsed then dropped**: Destructured but never passed through to graph execution.

3. **6 dead modules**: debug-subscriber, tool discovery, file-lock, merge, pipeline-logger, tree-hints — zero non-test imports.

4. **`registerCustomTools()` never called at startup**: Custom tools from `.atomic/tools/` are not loaded during TUI initialization.

---

## Spec 7: Cross-Cutting Concerns

### 7.1 Error Handling

**Command layer**: `CommandResult` with `success: boolean` — no exceptions during normal operation.

**Config layer**: Try/catch with silent fallbacks — partial results on per-root/per-ecosystem failures.

**Streaming layer**: Schema validation failures drop events with internal error emission. Handler errors caught per-handler. Stream errors publish `stream.session.error`. Retry logic in Claude adapter with exponential backoff.

**CLI layer**: Top-level catch in `chatCommand()` — telemetry tracking, discovery event emission, stderr logging, exit code 1.

### 7.2 Telemetry

**Architecture**: Consent-gated, anonymous (monthly UUID rotation), file-buffered (JSONL per agent), batch uploaded to Azure Application Insights via OpenTelemetry.

**10 event types**: CLI command, CLI slash command, agent session, TUI session start/end, message submit, command execution, tool lifecycle, interrupt, background termination.

**Upload pipeline**: Atomic file claiming via `rename()` to `.uploading.{id}`, 30-day stale filtering, 100-event batches, OpenTelemetry log records with `microsoft.custom_event.name` routing.

**Workflow telemetry**: `WorkflowTracker` interface with `start/nodeEnter/nodeExit/error/complete` lifecycle, sample-rate gating.

### 7.3 Models System

**Unified `Model` interface** (`services/models/model-transform.ts:5-57`): Normalized model representation with `id` (composite `providerID/modelID`), capabilities, limits, cost, modalities, reasoning effort support.

**Per-provider transforms**: `fromClaudeModelInfo()`, `fromCopilotModelInfo()`, `fromOpenCodeModel()` — each handling different SDK model metadata formats.

**`UnifiedModelOperations`** (`services/models/model-operations.ts:29-227`): Cached model listing, alias resolution, reasoning effort sanitization, pending model for Copilot session restart.

### 7.4 Build & Test Infrastructure

**Build**: `Bun.build()` with compile mode, Tree-sitter WASM embedding via `$bunfs`, cross-platform binary distribution.

**Lint**: `oxlint` + `check-submodule-boundaries.ts` + `check-dependency-direction.ts`.

**Tests**: ~200 test files using Bun's built-in runner with suite decomposition pattern (`.test.ts` imports from `.suite.ts` + `.test-support.ts`). Coverage across app, commands, components, lib, screens, services, state.

**Ordering contract canary**: `ordering-contract-metrics.ts` replays agent ordering scenarios through the full pipeline, verifies done-state projections and rendering counters.

---

## Architecture Documentation

### Current Layered Architecture

```
┌────────────────────────────────────────────────────────────┐
│  CLI Entry:  cli.ts → commands/cli/{chat,init,update}      │
│  TUI Entry:  app.tsx                                       │
└────────────────────────────┬───────────────────────────────┘
                             ▼
┌────────────────────────────────────────────────────────────┐
│  UI Layer (screens/, components/, theme/, hooks/)           │
└────────────────────────────┬───────────────────────────────┘
                             ▼
┌────────────────────────────────────────────────────────────┐
│  State Layer (state/chat/ [8 sub-modules], state/parts/,   │
│              state/streaming/, state/runtime/)              │
└────────────────────────────┬───────────────────────────────┘
                             ▼
┌────────────────────────────────────────────────────────────┐
│  Service Layer (services/agents/, services/events/,         │
│     services/workflows/, services/config/,                  │
│     services/agent-discovery/, services/models/,            │
│     services/telemetry/, services/system/)                  │
└────────────────────────────────────────────────────────────┘
                             ▼
┌────────────────────────────────────────────────────────────┐
│  Shared Layer (types/, lib/)                                │
└────────────────────────────────────────────────────────────┘
```

### Key Architectural Patterns

| Pattern          | Implementation                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Strategy         | `CodingAgentClient` interface with 3 SDK implementations                                       |
| Pub/Sub          | `EventBus` with 26 typed events + batched dispatch                                             |
| Builder          | `GraphBuilder` fluent API (LangGraph-inspired)                                                 |
| Registry         | `ToolRegistry`, `PART_REGISTRY`, `CommandRegistry`, `ProviderRegistry`, `EventHandlerRegistry` |
| Adapter          | 3 SDK-specific stream adapters → unified `BusEvent`                                            |
| Reducer          | `applyStreamPartEvent` pure state reducer                                                      |
| Factory          | `createChatUIController()`, `createStreamAdapter()`, `createCheckpointer()`                    |
| ISP              | `RalphWorkflowContext` (workflow) vs `CommandContext` (shared)                                 |
| Proxy            | Correlating bus proxy wrapping `EventBus.publish()`                                            |
| Double-Buffer    | `BatchDispatcher` swap for zero-allocation flushing                                            |
| WeakMap Registry | `reasoningPartIdBySourceRegistry` across immutable copies                                      |

### Coupling Hotspots (Highest Fan-In Files)

1. `services/agents/types.ts` — 109 imports (54 external)
2. `services/workflows/graph/types.ts` — 55 imports (12 external)
3. `state/chat/types.ts` — 38 imports
4. `state/parts/types.ts` — 36 imports (17 external)
5. `services/events/bus-events.ts` — 35 imports
6. `components/parallel-agents-tree.tsx` — 32 imports (30 external)

---

## Historical Context (from research/)

- `research/docs/2026-03-15-event-bus-workflow-simplification-research.md` — Documents the two parallel event pipelines (EventBus vs CommandContext callbacks) and proposes `workflow.stage.start/end` as two new BusEvent types.
- `research/docs/2026-03-14-event-bus-callback-elimination-sdk-event-types.md` — Documents 8 manual callback patterns, the 210-line CorrelationService switch, and the 240-line StreamPipelineConsumer switch (both now replaced by EventHandlerRegistry).
- `research/docs/2026-03-13-codebase-architecture-modularity-analysis.md` — Identifies 9 circular dependency pairs, `state/` as gravitational center (270 imports), `lib/ui/` containing ~35 domain-specific files.
- `research/docs/2026-02-28-workflow-gaps-architecture.md` — Documents 7 gap categories including unconnected components, dead modules, and unconsumed events.
- `research/docs/2026-02-28-workflow-issues-research.md` — Documents sub-agent tree stuck at "Initializing...", task list blink gap, 5 streaming delay sources.
- `research/docs/2026-02-26-streaming-architecture-event-bus-migration.md` — Original event bus migration design establishing `BusEvent -> BatchDispatcher -> Consumer` pattern.
- `research/docs/2026-02-25-unified-workflow-execution-research.md` — Documents WorkflowSDK unused at runtime, hardcoded Ralph dispatch, sequential graph execution.
- `research/docs/2026-02-25-ui-workflow-coupling.md` — Documents rendering divergence between main chat and workflow sub-agents.
- `research/docs/2026-02-19-sdk-v2-first-unified-layer-research.md` — SDK v2 unified layer research (v2 remains unused in production).
- `research/docs/2026-03-01-opencode-delegation-streaming-parity.md` — OpenCode streaming parity gaps.
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md` — Documents CodingAgentClient strategy pattern and adapter handler architecture.

## Related Research

- `research/docs/2026-02-26-streaming-event-bus-spec-audit.md`
- `research/docs/2026-02-28-workflow-tui-rendering-unification-refactor.md`
- `research/docs/2026-02-27-workflow-tui-rendering-unification.md`
- `research/docs/2026-02-25-workflow-sdk-standardization.md`
- `research/docs/2026-02-25-workflow-sdk-design.md`
- `research/docs/2026-02-25-workflow-registration-flow.md`
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md`
- `research/docs/2026-02-16-atomic-chat-architecture-current.md`
- `research/docs/2026-02-16-chat-system-design-reference.md`
- `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md`

## Open Questions

1. **Workflow event unification**: Should workflows publish `BusEvent`s through the existing pipeline (adding `workflow.stage.start/end`), or should they use a completely separate event channel? The former achieves 1:1 chat parity; the latter may be simpler for graph-level orchestration.

2. **Graph parallelism**: The `parallelNode()` infrastructure exists but isn't used by Ralph. A rebuild should decide: should the graph engine natively support concurrent node execution, or should parallelism remain at the sub-agent spawn level?

3. **State decomposition**: With 270 cross-module imports into `state/` and ~55 hooks, should the state layer be decomposed into framework-agnostic state machines (e.g., XState) with thin React bindings, or should the hook composition pattern be preserved with better boundary enforcement?

4. **Provider event layer**: Is the dual `EventType` / `ProviderStreamEventType` system worth maintaining, or should there be a single event taxonomy with optional native event attachment?

5. **Tool registration unification**: Should all providers use MCP as the common tool protocol, or should a simpler `tool()` → handler abstraction replace the three different mechanisms?

6. **Rendering parity**: Should sub-agent inline content go through `PART_REGISTRY` the same as main chat content, or does the truncated inline view serve a valid UX purpose?
