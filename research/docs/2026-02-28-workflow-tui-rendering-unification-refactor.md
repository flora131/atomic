---
date: 2026-02-28 19:08:57 UTC
researcher: Copilot (Claude Opus 4.6)
git_commit: c88d4d1512f962b7cf0a1d770351efc7af52932e
branch: lavaman131/feature/workflow-sdk
repository: workflow-sdk
topic: "Refactoring workflows to use the same UI engine as the main TUI"
tags:
    [
        research,
        codebase,
        workflow,
        tui,
        rendering,
        unification,
        sub-agent-tree,
        event-bus,
        parts-pipeline,
        ralph,
    ]
status: complete
last_updated: 2026-02-28
last_updated_by: Copilot (Claude Opus 4.6)
last_updated_note: "Updated summary to reflect refined approach: replace bespoke AgentInline renderers with PART_REGISTRY dispatch (rendering-only change, event pipeline already shared)"
---

# Research: Workflow TUI Rendering Unification Refactor

## Research Question

Document the current workflow execution system (`src/workflows/`, including the `/ralph` workflow) and the main TUI rendering engine (`src/ui/`) to understand: (1) how workflows currently display progress/output to users, (2) how the main TUI renders sub-agent trees, tool calls, text blocks, and other UI elements, and (3) what the specific architectural differences and coupling points are between these two rendering paths — so that a future refactor could unify them under a single UI engine.

## Summary

The event bus and reducer layers are **already shared** between the main chat and workflow sub-agents. `spawnSubagentParallel()` at `chat.tsx:4083` already creates `SubagentStreamAdapter` instances that publish all 9 event types to the shared `AtomicEventBus`, and the reducer `applyStreamPartEvent()` in `stream-pipeline.ts` already routes sub-agent events to `agent.inlineParts[]` using the same helpers (`handleTextDelta`, `upsertToolPartStart`, `upsertToolPartComplete`) as top-level parts. The `Part` objects in `inlineParts` are structurally identical to top-level `parts[]`.

**The divergence is only in the rendering layer.** Main chat dispatches `parts[]` through `PART_REGISTRY` — 9 full-fidelity renderers for markdown, tool chrome with expandable I/O, reasoning blocks, etc. Workflow sub-agent content lands in `agent.inlineParts[]` but is rendered by bespoke `AgentInlineText` (200-char truncated plain text, no markdown) and `AgentInlineTool` (30-char tool name, single line) — bypassing `PART_REGISTRY` entirely. Only 2 of 9 part types are handled, and only the latest part is shown.

**The fix is straightforward**: replace `AgentInlineParts`/`AgentInlineText`/`AgentInlineTool` with `PART_REGISTRY` dispatch so workflow sub-agents render through the exact same renderers as the main chat. Route all part types (including `ReasoningPart`, currently missing) to `inlineParts`. Delete the bespoke workflow rendering code.

---

## Detailed Findings

### 1. How Workflows Currently Display Progress/Output

#### The Workflow Executor (`src/workflows/executor.ts`)

The `executeWorkflow()` function (line 123) orchestrates workflow execution in 6 phases:

1. **Session initialization** (lines 134-168): Generates session IDs, creates a `WorkflowEventAdapter`, publishes a synthetic `stream.session.start` event, and calls `context.updateWorkflowState()` with `{ workflowActive: true }`.

2. **Graph resolution** (lines 178-194): Compiles the declarative `WorkflowGraphConfig` into a `CompiledGraph` via `compileGraphConfig()`.

3. **State creation** (lines 197-201): Calls `definition.createState()` to initialize workflow-specific state.

4. **Runtime setup** (lines 203-278): Injects runtime dependencies into the compiled graph:
    - `spawnSubagent()` wraps `context.spawnSubagentParallel()` and publishes `stream.agent.start`/`stream.agent.complete` events via the adapter
    - `spawnSubagentParallel()` does the same for parallel dispatch
    - `notifyTaskStatusChange()` publishes `workflow.task.statusChange` to the event bus

5. **Streaming execution** (lines 280-415): Iterates `streamGraph()` yields. On each node transition:
    - Publishes `workflow.step.start` and `workflow.step.complete` via the adapter
    - Syncs `state.tasks` to disk via debounced atomic writes to `tasks.json`
    - Publishes `workflow.task.update` via the adapter

6. **Result reporting** (lines 417-491): Calls `context.addMessage()` with static success/failure text and returns a `CommandResult`.

**Key observation:** The executor publishes 8 different event types to the bus, but many of them are never consumed by the UI pipeline (see Finding 3).

#### Current Sub-Agent Output Handling

At `src/ui/chat.tsx:3970-3984`, workflow sub-agent streams are consumed in a silent loop:

```typescript
for await (const msg of stream) {
    if (msg.type === "tool_use") {
        toolUses++;
    } else if (msg.type === "text") {
        summaryParts.push(msg.content);
    }
}
```

This discards:

- All streaming text deltas (text accumulated but never rendered incrementally)
- All thinking blocks (not even checked)
- All token counts (usage events ignored)
- All tool lifecycle events (counted but not displayed)
- Output truncated to 4000 characters via `MAX_SUMMARY_LENGTH`

**User experience:** Users see "Starting workflow..." then nothing until "Workflow completed." — a black box during the most complex, long-running operations.

#### The Ralph Workflow (`src/workflows/ralph/`)

Ralph is a three-phase compiled graph:

1. **Planning** (`planner` + `parse-tasks` nodes): A planner sub-agent decomposes the user prompt into a `TaskItem[]` JSON array.
2. **Worker loop** (`select-ready-tasks` + `worker` nodes): Ready tasks (pending with resolved dependencies) are dispatched to parallel worker sub-agents. The loop continues until all tasks are completed/errored or max iterations reached.
3. **Review & fix** (`reviewer` + conditional `fixer` nodes): A reviewer sub-agent evaluates the work; if issues are found, a fixer (debugger) sub-agent applies corrections.

State management uses annotation-defined reducers (e.g., `mergeByIdReducer` for tasks) to safely merge concurrent worker updates.

**Ralph-specific UI communications:**

- Node descriptions map (`definition.ts:17-24`) provides human-readable progress strings (e.g., `"⌕ Planning: Analyzing requirements..."`)
- Task status change notifications via `notifyTaskStatusChange()` in the worker node
- Session directory and task IDs registered with the TUI via `context.setWorkflowSessionDir/Id/TaskIds()`

#### Dual-Source Task List Display

Task data enters the UI through two independent channels:

1. **Stream events** (`workflow.task.update` → `TaskListPart` in message parts) — currently broken (events dropped)
2. **File watching** (`tasks.json` on disk → `watchTasksJson()` → `TaskListPanel` component) — working, provides persistent display

---

### 2. How the Main TUI Renders Sub-Agent Trees, Tool Calls, and Text Blocks

#### The Parts-Based Rendering Pipeline

The main TUI uses a multi-stage event-driven pipeline:

```
SDK (Claude/OpenCode/Copilot)
  → SDKStreamAdapter.startStreaming()           [src/ui/index.ts:475]
    → AtomicEventBus.publish()                  [src/events/event-bus.ts:139]
      → BatchDispatcher.enqueue()               [16ms frame-aligned batching]
        → CorrelationService.enrich()           [adds metadata, filters]
          → StreamPipelineConsumer.processBatch() [maps bus events → StreamPartEvents]
            → useStreamConsumer callback         [React hook in chat.tsx]
              → applyStreamPartEvent()           [immutable reducer]
                → ChatMessage.parts[]            [Part union array]
                  → MessageBubbleParts           [React component]
                    → PART_REGISTRY[type]        [type-specific renderer]
```

#### Nine Part Types

All parts extend `BasePart` (`id: PartId`, `type: string`, `createdAt: string`):

| Part Type          | `type` Discriminant | Key Fields                                                                                                | Renderer                  |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| `TextPart`         | `"text"`            | `content`, `isStreaming`                                                                                  | `TextPartDisplay`         |
| `ReasoningPart`    | `"reasoning"`       | `thinkingSourceKey`, `content`, `durationMs`, `isStreaming`                                               | `ReasoningPartDisplay`    |
| `ToolPart`         | `"tool"`            | `toolCallId`, `toolName`, `input`, `output`, `state` (5-state machine), `hitlResponse`, `pendingQuestion` | `ToolPartDisplay`         |
| `AgentPart`        | `"agent"`           | `agents: ParallelAgent[]`, `parentToolPartId`                                                             | `AgentPartDisplay`        |
| `TaskListPart`     | `"task-list"`       | `items: TaskItem[]`, `expanded`                                                                           | `TaskListPartDisplay`     |
| `SkillLoadPart`    | `"skill-load"`      | `skills: MessageSkillLoad[]`                                                                              | `SkillLoadPartDisplay`    |
| `McpSnapshotPart`  | `"mcp-snapshot"`    | `snapshot: McpSnapshotView`                                                                               | `McpSnapshotPartDisplay`  |
| `CompactionPart`   | `"compaction"`      | `summary`                                                                                                 | `CompactionPartDisplay`   |
| `WorkflowStepPart` | `"workflow-step"`   | `nodeId`, `nodeName`, `status`, `startedAt`, `completedAt`, `durationMs`                                  | `WorkflowStepPartDisplay` |

#### Sub-Agent Tree Display Architecture

Sub-agent rendering uses a **dual delivery path**:

**Path A — Agent lifecycle events** (NOT through `StreamPipelineConsumer`):

- `stream.agent.start/update/complete` events are consumed via direct React `useBusSubscription` hooks in `chat.tsx` (lines 2946-3052)
- These update `parallelAgents` React state
- A `useEffect` bridge (lines 3356-3413) emits synthetic `parallel-agents` events into the stream pipeline reducer
- The reducer calls `mergeParallelAgentsIntoParts()` to create/update `AgentPart` nodes in `message.parts[]`

**Path B — Agent-scoped tool/text events** (through `StreamPipelineConsumer`):

- `stream.tool.start/complete` and `stream.text.delta` with `parentAgentId` are mapped to `StreamPartEvents` with `agentId`
- The reducer routes them to the matching agent's `inlineParts` sub-array via `routeToAgentInlineParts()`
- Events arriving before the `AgentPart` exists are buffered and replayed when the agent materializes

**Visual rendering:**

- `AgentPartDisplay` splits agents into foreground/background groups
- `ParallelAgentsTree` renders a tree with `├─●` connectors, status indicators, task labels, current tool, and inline parts
- Agent colors are mapped via Catppuccin palette per agent type

#### Key Design Patterns in the Main TUI

1. **Immutable reducer**: `applyStreamPartEvent()` returns new objects at every level — no in-place mutation
2. **Binary-search sorted arrays**: Parts kept in `PartId`-sorted order via `upsertPart()` for chronological display
3. **WeakMap registry**: Reasoning part source-key tracking uses `WeakMap<ChatMessage, Map<string, PartId>>` for automatic GC
4. **Agent event buffering**: Module-level `Map<string, StreamPartEvent[]>` buffers events for agents not yet in parts
5. **Double rendering path**: Parts populated during streaming via reducer, then augmented at render time by `getRenderableAssistantParts()`
6. **Frame-aligned batching**: `BatchDispatcher` at 16ms intervals coalesces state updates while preserving text deltas

---

### 3. Architectural Differences and Coupling Points

#### The Three-Point Disconnection

The workflow rendering path has three disconnection points that prevent workflow events from reaching the UI:

| Disconnection    | Location                                          | Current State                                                                     |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Consumer gap** | `stream-pipeline-consumer.ts` `mapToStreamPart()` | `workflow.step.*` events hit `default: return null` — silently dropped            |
| **Type system**  | `src/ui/parts/types.ts`                           | `WorkflowStepPart` IS defined and IS in the `Part` union (lines 121-129, 136-145) |
| **Registry**     | `src/ui/components/parts/registry.tsx`            | `"workflow-step"` IS registered in `PART_REGISTRY` (line 32)                      |

**Note:** The type system and registry gaps have been resolved since the earlier research was conducted. The remaining gap is solely in `StreamPipelineConsumer.mapToStreamPart()` which needs `case` handlers for `workflow.step.start`, `workflow.step.complete`, and `workflow.task.update`.

**Update (from latest code analysis):** The `StreamPipelineConsumer` at `stream-pipeline-consumer.ts` lines 190-216 **already has** handlers for `workflow.step.start` → `workflow-step-start`, `workflow.step.complete` → `workflow-step-complete`, and `workflow.task.update` → `task-list-update`. This means the full pipeline IS connected for workflow step and task events. The remaining gap is solely the **silent sub-agent stream consumption** in `chat.tsx`.

#### Silent Sub-Agent Sessions — The Core Gap

The fundamental difference is how sub-agent streams are consumed:

**Main chat (works):**

```
SubagentStreamAdapter.consumeStream()
  → For each AgentMessage:
    → bus.publish("stream.text.delta", { agentId })      ← rendered in agent inline parts
    → bus.publish("stream.tool.start", { parentAgentId }) ← rendered in agent inline parts
    → bus.publish("stream.tool.complete", { parentAgentId })
    → toolTracker.onToolStart/Complete()
      → bus.publish("stream.agent.update", { currentTool, toolUses })
```

**Workflow executor (broken):**

```
for await (const msg of stream) {
  summaryParts.push(msg.content);  ← silently accumulated, never rendered
}
return { output: summaryParts.join("").slice(0, 4000) };  ← truncated
```

#### Feature Parity Gap

| Feature               | Main Chat                                             | Workflow Executor                         |
| --------------------- | ----------------------------------------------------- | ----------------------------------------- |
| Streaming text        | ✅ Incremental via `stream.text.delta`                | ❌ Accumulated silently, truncated        |
| Token counts          | ✅ Via `stream.usage` → `CompletionSummary`           | ❌ Not tracked                            |
| Thinking blocks       | ✅ Via `stream.thinking.delta` → `ReasoningPart`      | ❌ Not captured                           |
| Spinner with metadata | ✅ Elapsed time, tokens, thinking duration            | ⚠️ Boolean flag only                      |
| Sub-agent tree        | ✅ Full tree with tool counts, current tool, duration | ⚠️ Tree shows but no live inline progress |
| Tool call rendering   | ✅ Inline with status, collapsible output             | ❌ Counted but not rendered               |
| Text blocks           | ✅ Markdown rendering                                 | ❌ Only static start/completion messages  |
| Completion summary    | ✅ Duration, tokens, thinking time                    | ❌ No per-agent or per-step summary       |
| Parts-based rendering | ✅ Full `Part[]` pipeline                             | ❌ Only `context.addMessage()`            |

#### Coupling Surface Between Workflow and UI Layers

**UI → Workflow (direct imports):**

| UI File                                   | What It Imports                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/ui/commands/workflow-commands.ts`    | `session.ts`, `executor.ts`, `ralph/graph.ts`, `ralph/definition.ts`, `graph/types.ts` |
| `src/ui/chat.tsx`                         | `graph/types.ts`, `graph/index.ts`                                                     |
| `src/ui/commands/registry.ts`             | `graph/types.ts` (`SubagentSpawnOptions`, `SubagentStreamResult`)                      |
| `src/sdk/clients/copilot.ts`              | `graph/types.ts`                                                                       |
| `src/events/adapters/subagent-adapter.ts` | `graph/types.ts`                                                                       |

**Workflow → UI (via `CommandContext` only):**

The workflow graph has zero direct imports from the UI layer. All communication flows through the `CommandContext` interface:

- Task updates: `setWorkflowSessionDir()`, `setWorkflowSessionId()`, `setWorkflowTaskIds()`
- Status: `addMessage()`, `setStreaming()`, `updateWorkflowState()`
- Sub-agent dispatch: `spawnSubagentParallel()`

**Ralph-Specific Fields in Shared Interfaces:**

- `CommandContext.setRalphSessionDir` (`registry.ts:135`) — should be generalized
- `CommandContext.setRalphSessionId` (`registry.ts:139`) — should be generalized
- `CommandContext.setRalphTaskIds` (`registry.ts:145`) — should be generalized
- `WorkflowChatState.ralphConfig` (`chat.tsx:886-890`) — should be generalized

#### Event Bus Architecture

The `AtomicEventBus` (`src/events/event-bus.ts`) implements a centralized pub/sub system with:

- 26 event types in 8 categories (text, thinking, tool, agent, session, turn, workflow, interaction)
- Zod schema validation on every publish
- Error isolation per handler (try/catch prevents cascade)
- `BatchDispatcher` with 16ms frame-aligned batching and double-buffer swap
- Key-based coalescing (state events coalesced, text deltas never coalesced)
- `CorrelationService` for sub-agent event enrichment and ownership tracking
- `EchoSuppressor` for filtering duplicate text from SDK echo

**Workflow events published by executor:**

| Event                        | Published At          | Consumer Status                                |
| ---------------------------- | --------------------- | ---------------------------------------------- |
| `stream.session.start`       | `executor.ts:147-153` | ✅ Consumed by `CorrelationService.startRun()` |
| `workflow.step.start`        | `executor.ts:346-351` | ✅ Mapped by `StreamPipelineConsumer`          |
| `workflow.step.complete`     | `executor.ts:337-342` | ✅ Mapped by `StreamPipelineConsumer`          |
| `workflow.task.update`       | `executor.ts:368-374` | ✅ Mapped by `StreamPipelineConsumer`          |
| `workflow.task.statusChange` | `executor.ts:268-277` | ✅ Consumed by executor's own subscriber       |
| `stream.agent.start`         | `executor.ts:217-219` | ✅ Consumed by `chat.tsx` bus subscription     |
| `stream.agent.complete`      | `executor.ts:227-233` | ✅ Consumed by `chat.tsx` bus subscription     |

---

## Code References

### Workflow Executor System

- `src/workflows/executor.ts:123` — `executeWorkflow()` main entry point
- `src/workflows/executor.ts:211-265` — `spawnSubagent`/`spawnSubagentParallel` runtime injection
- `src/workflows/executor.ts:326-391` — Streaming execution loop with step events
- `src/workflows/session.ts:51-77` — `initWorkflowSession()` session lifecycle
- `src/workflows/index.ts` — Barrel exports

### Ralph Workflow

- `src/workflows/ralph/definition.ts:50-63` — `ralphWorkflowDefinition` registration
- `src/workflows/ralph/definition.ts:17-24` — Node descriptions for UI progress
- `src/workflows/ralph/graph.ts:98-263` — `createRalphWorkflow()` graph construction
- `src/workflows/ralph/state.ts:51-80` — `RalphWorkflowState` interface (30 fields)
- `src/workflows/ralph/prompts.ts:37-77` — Planner prompt template

### Main TUI Rendering Pipeline

- `src/ui/parts/types.ts:20-145` — Part type definitions (9 types)
- `src/ui/parts/stream-pipeline.ts:961-1167` — `applyStreamPartEvent()` main reducer
- `src/ui/parts/handlers.ts:21-52` — `handleTextDelta()` text streaming handler
- `src/ui/parts/store.ts:20-53` — Binary-search sorted part store
- `src/ui/components/parts/registry.tsx:23-33` — `PART_REGISTRY` type-to-renderer mapping
- `src/ui/components/parts/message-bubble-parts.tsx:130-166` — Message rendering orchestrator
- `src/ui/index.ts:207-798` — `startChatUI()` bootstrapping
- `src/ui/chat.tsx:1589-6286` — `ChatApp` main component

### Sub-Agent Tree Display

- `src/ui/components/parallel-agents-tree.tsx:774` — `ParallelAgentsTree` tree renderer
- `src/ui/components/parts/agent-part-display.tsx:53` — `AgentPartDisplay` part renderer
- `src/ui/utils/background-agent-tree-hints.ts:24` — Tree hint computation
- `src/events/adapters/subagent-adapter.ts:62` — `SubagentStreamAdapter` event bridge
- `src/workflows/graph/subagent-registry.ts:33` — `SubagentTypeRegistry`

### Event Bus Architecture

- `src/events/event-bus.ts:58-234` — `AtomicEventBus` pub/sub hub
- `src/events/bus-events.ts:33` — 26 event type definitions
- `src/events/adapters/workflow-adapter.ts:31-214` — `WorkflowEventAdapter`
- `src/events/consumers/wire-consumers.ts:65-108` — Pipeline assembly
- `src/events/consumers/stream-pipeline-consumer.ts:61-241` — Bus-to-StreamPart mapping
- `src/events/consumers/correlation-service.ts:64-439` — Event enrichment/correlation
- `src/events/batch-dispatcher.ts:72-223` — Frame-aligned batching

### Workflow Step Rendering

- `src/ui/components/parts/workflow-step-part-display.tsx:25-53` — Step renderer
- `src/ui/utils/workflow-task-state.ts` — Workflow task state utilities
- `src/ui/components/task-list-panel.tsx:157-179` — File-driven task list panel
- `src/ui/components/task-list-indicator.tsx:93-183` — Per-task item renderer
- `src/ui/components/footer-status.tsx:39-101` — Workflow status footer

### Workflow Commands (UI Bridge)

- `src/ui/commands/workflow-commands.ts:623-712` — `createWorkflowCommand()` factory
- `src/ui/commands/workflow-commands.ts:718-781` — `watchTasksJson()` file watcher
- `src/ui/commands/workflow-commands.ts:250-285` — `saveTasksToActiveSession()` atomic writes

---

## Architecture Documentation

### Current Rendering Pipeline Comparison

```
MAIN CHAT PIPELINE (fully functional):
═══════════════════════════════════════
SDK Session ──→ SDKStreamAdapter ──→ AtomicEventBus ──→ BatchDispatcher
                                                              │
                                                    ┌────────────────────┐
                                                    │ CorrelationService │
                                                    │  • ownership check │
                                                    │  • enrichment      │
                                                    │  • suppression     │
                                                    └────────────────────┘
                                                              │
                                                    ┌────────────────────────┐
                                                    │ StreamPipelineConsumer │
                                                    │  mapToStreamPart()     │
                                                    └────────────────────────┘
                                                              │
                                                    ┌────────────────────────┐
                                                    │ useStreamConsumer hook │
                                                    │  → onStreamParts()     │
                                                    └────────────────────────┘
                                                              │
                                                    ┌────────────────────────┐
                                                    │ applyStreamPartEvent() │
                                                    │  immutable reducer     │
                                                    └────────────────────────┘
                                                              │
                                                    ┌────────────────────────┐
                                                    │ ChatMessage.parts[]    │
                                                    │  → PART_REGISTRY       │
                                                    │  → type-specific       │
                                                    │    renderers           │
                                                    └────────────────────────┘

WORKFLOW PIPELINE (mostly broken):
═══════════════════════════════════
executeWorkflow()
  │
  ├── context.addMessage("Starting workflow...")     ← static text
  │
  ├── WorkflowEventAdapter.publishStep*()            ← events published ✅
  │     → bus events reach StreamPipelineConsumer     ← mapped correctly ✅
  │       → applyStreamPartEvent() handles them      ← reducer works ✅
  │         → WorkflowStepPartDisplay renders         ← renderer exists ✅
  │
  ├── spawnSubagentParallel():
  │     → publishAgentStart()                        ← tree shows agent ✅
  │     → for await (msg of stream):
  │         summaryParts.push(msg.content)            ← SILENT consumption ❌
  │     → publishAgentComplete()                     ← tree updates ✅
  │     → return { output: text.slice(0, 4000) }     ← truncated ❌
  │
  └── context.addMessage("Workflow completed.")      ← static text
```

### The Unification Path

The selected architecture (from `specs/workflow-tui-rendering-unification.md`) is **Bus-Integrated Sub-Agent Sessions**: replace the silent stream consumption loop with `SubagentStreamAdapter` instances that publish to the shared `AtomicEventBus`.

**Why this approach:**

- Reuses the existing rendering pipeline — no new rendering paths
- All 9 part types work automatically for workflow sub-agents
- Event buffering, coalescing, and batching already handle concurrency
- `AgentPartDisplay` already supports inline parts for sub-agent streaming content

**Key changes needed:**

1. Replace `for await` silent loop in `chat.tsx:3970-3984` with `SubagentStreamAdapter.consumeStream()` calls
2. Remove `MAX_SUMMARY_LENGTH` truncation — full output flows through parts pipeline
3. Ensure `CorrelationService` properly registers workflow sub-agents
4. Verify concurrent stream handling (Ralph dispatches 3-5+ parallel workers)

---

## Historical Context (from research/)

### Directly Related Research

- `research/docs/2026-02-27-workflow-tui-rendering-unification.md` — Primary architecture audit identifying the two-pipeline problem, the three-point disconnection, and the silent sub-agent consumption pattern
- `research/docs/2026-02-28-workflow-gaps-architecture.md` — Maps every gap to exact file paths and line numbers; identifies 7 categories of gaps including the broken rendering pipeline
- `research/docs/2026-02-25-ui-workflow-coupling.md` — Documents the coupling surface between UI and workflow layers, identifies Ralph-specific fields that need generalization
- `research/workflow-gaps.md` — High-level gap inventory covering WorkflowStep rendering, custom tool discovery, MCP bridge, and dropped CLI flags

### Supporting Research

- `research/docs/2026-02-26-streaming-architecture-event-bus-migration.md` — Documents the callback-to-event-bus migration that created the current architecture
- `research/docs/2026-02-25-ralph-workflow-implementation.md` — Ralph autonomous implementation workflow and graph execution details
- `research/docs/2026-02-25-graph-execution-engine.md` — Graph execution engine architecture
- `research/docs/2026-02-16-opentui-rendering-architecture.md` — OpenTUI core rendering architecture
- `research/docs/2026-02-16-atomic-chat-architecture-current.md` — Current chat system architecture

### Related Specs

- `specs/workflow-tui-rendering-unification.md` — RFC/Design doc for unifying rendering (Draft/WIP — not yet implemented)
- `specs/unified-workflow-execution.md` — Companion spec for unified workflow execution interface
- `specs/chat-system-parts-based-rendering.md` — Parts-based rendering system design
- `specs/streaming-architecture-event-bus-migration.md` — Streaming architecture migration design

---

## Related Research

- `research/docs/2026-02-25-workflow-sdk-standardization.md`
- `research/docs/2026-02-25-workflow-sdk-refactor-research.md`
- `research/docs/2026-02-25-unified-workflow-execution-research.md`
- `research/docs/2026-02-23-258-background-agents-sdk-event-pipeline.md`
- `research/docs/2026-02-15-subagent-event-flow-diagram.md`

---

## Open Questions

1. **Concurrent stream handling capacity**: Ralph dispatches 3-5+ parallel worker sub-agents simultaneously. The `BatchDispatcher` coalesces at 16ms intervals, but has the system been load-tested with this many concurrent `SubagentStreamAdapter` instances publishing to the same bus?

2. **Agent inline parts nesting depth**: The spec limits nesting to 1 level (sub-sub-agents summarized in parent's tool count). Does the current `routeToAgentInlineParts()` implementation enforce this, or could deeply nested workflows cause display issues?

3. **Task list dual-source reconciliation**: When both the stream-based `TaskListPart` (from `workflow.task.update` events) and the file-based `TaskListPanel` (from `watchTasksJson()`) are active, how are conflicts handled? Could they show different data simultaneously?

4. **Ralph-specific coupling**: The `CommandContext` interface contains Ralph-specific fields (`setRalphSessionDir`, `setRalphSessionId`, `setRalphTaskIds`). When generalizing for all workflows, what is the migration path for these?

5. **Breaking change impact**: Replacing `SubagentResult` with `SubagentStreamResult` (which adds `tokenUsage`, `thinkingDurationMs`, `toolDetails`) is a breaking change for all callers of `spawnSubagentParallel`. How many call sites exist outside the workflow executor?

6. **Memory pressure**: With full streaming content for multiple parallel sub-agents, the `ChatMessage.parts[]` array and agent `inlineParts[]` sub-arrays could grow significantly. Is there an eviction or windowing strategy for long-running workflows?

---

## Follow-up Research: Full Feature Parity — Spinner, Tokens, Thinking, Compact UI

### Background

The follow-up research maps exactly which streaming UI features exist in the main chat, how they're driven, and what specifically would need to happen for workflow sub-agents to have full parity — including the animated spinner with live token counters, thinking duration display, compact UI modes, and completion summaries.

### Finding 1: The `spawnSubagentParallel` Path Already Uses `SubagentStreamAdapter`

**Critical correction** to the initial research: The `spawnSubagentParallel()` implementation at `src/ui/chat.tsx:4083-4240` **already creates a `SubagentStreamAdapter`** for each sub-agent (lines 4163-4169) and calls `adapter.consumeStream(stream, agentAbort.signal)` at line 4182. The adapter publishes **all event types** to the shared `AtomicEventBus`:

| Chunk Type                     | Bus Event Published                            | Adapter Lines |
| ------------------------------ | ---------------------------------------------- | ------------- |
| `text`                         | `stream.text.delta`                            | 212-231       |
| `thinking` (with content)      | `stream.thinking.delta`                        | 248-261       |
| `thinking` (complete)          | `stream.thinking.complete`                     | 275-287       |
| `tool_use`                     | `stream.tool.start` + `stream.agent.update`    | 293-343       |
| `tool_result`                  | `stream.tool.complete` + `stream.agent.update` | 348-414       |
| Every chunk (if usage present) | `stream.usage`                                 | 420-448       |
| On completion                  | `stream.text.complete`                         | 453-466       |
| On error                       | `stream.session.error`                         | 471-483       |

**This means the events ARE being published.** The question is whether they're being properly consumed and rendered.

### Finding 2: Spinner / Token Counter Architecture

The main chat spinner (`LoadingIndicator` at `chat.tsx:1033-1071`) is driven by:

1. **Elapsed time**: `streamingStartRef.current = Date.now()` (set at `chat.tsx:3079`), ticked every 1s via `useEffect` interval (`chat.tsx:2009-2022`) → `streamingElapsedMs` state
2. **Token counter**: `useBusSubscription("stream.usage")` at `chat.tsx:2888-2919` → `streamingMeta.outputTokens` → monotonic max accumulation → baked onto `ChatMessage.outputTokens`
3. **Thinking seconds**: `useBusSubscription("stream.thinking.complete")` at `chat.tsx:2922-2943` → `streamingMeta.thinkingMs` → baked onto `ChatMessage.thinkingMs`

**Display logic**: `⣾ Composing… (6m 22s · ↓ 16.7k tokens · thought for 54s)` — braille spinner (8 frames at 120ms), accent verb, muted info parts joined by `·`.

**Verb override for workflows**: At `chat.tsx:3868-3874`, workflow messages get `msg.spinnerVerb = "Running workflow"`, changing spinner text to `"⣾ Running workflow…"`.

**Gap for workflow sub-agents**: The `stream.usage` bus subscription at `chat.tsx:2888-2919` updates `streamingMeta` and bakes tokens onto `streamingMessageIdRef.current ?? lastStreamedMessageIdRef.current`. For workflow sub-agents, these events DO arrive on the bus (published by `SubagentStreamAdapter`), but:

- `streamingMessageIdRef.current` points to the **workflow wrapper message**, not per-agent messages
- Token counts from ALL sub-agents are accumulated onto a single message counter — there's no per-agent token display
- The `agentId` in the event payload is available but not used to route tokens to per-agent display

### Finding 3: Thinking Duration Display Architecture

Thinking events flow through **two parallel paths**:

**Path A — Pipeline (content rendering)**:

```
stream.thinking.delta → StreamPipelineConsumer → ThinkingMetaEvent
  → useStreamConsumer callback (chat.tsx:2720-2774)
    → thinkingTextBySource map accumulation
    → applyStreamPartEvent → creates/updates ReasoningPart
      → ReasoningPartDisplay renders thinking text
```

**Path B — Direct bus subscription (duration tracking)**:

```
stream.thinking.complete → useBusSubscription (chat.tsx:2922-2943)
  → Math.max(prev.thinkingMs, event.durationMs)
  → bake onto ChatMessage.thinkingMs
```

**Gap for workflow sub-agents**: Both paths fire for sub-agent thinking events (the adapter publishes them), but:

- Path A: Thinking text from sub-agents would need to be routed to agent `inlineParts` (similar to text deltas) rather than the main message's parts
- Path B: Thinking duration is accumulated into a single `streamingMeta.thinkingMs` for the whole message — there's no per-agent thinking time tracking

### Finding 4: Compact UI — Six Distinct Mechanisms

The codebase has 6 independent compact/collapse mechanisms:

| Mechanism                           | Component                          | What It Controls                             | Toggle                                           |
| ----------------------------------- | ---------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| **Context compaction** (`/compact`) | `builtin-commands.ts:239`          | SDK conversation token count                 | Slash command                                    |
| **Transcript mode** (Ctrl+O)        | `chat.tsx:5086` → `TranscriptView` | Full-screen detailed history view            | Keyboard                                         |
| **Collapsed messages**              | `MessageBubble` `collapsed` prop   | Single-line message summaries                | Prop (hardcoded `false`)                         |
| **Verbose mode** (Ctrl+E)           | `use-verbose-mode.ts:63`           | Tool output expansion, timestamps            | Keyboard                                         |
| **ParallelAgentsTree compact**      | `agent-part-display.tsx:83`        | Agent tree label truncation (40 vs 50 chars) | Auto (active agents = full, completed = compact) |
| **TaskListPart expansion**          | `task-list-indicator.tsx:134`      | Task content truncation (60 chars)           | Part property                                    |

**Gap for workflow sub-agents**: Most compact modes apply at the `ChatMessage`/`MessageBubble` level, so they would automatically apply to workflow messages IF workflow content is rendered through the parts pipeline. The `ParallelAgentsTree` compact mode already works for workflow agents since it's driven by `stream.agent.*` events.

### Finding 5: Completion Summary Architecture

`CompletionSummary` (`chat.tsx:1112-1134`) renders: `⣿ Reasoned for 1m 6s · ↓ 16.7k tokens · thought for 54s`

**Gating**: `shouldShowCompletionSummary()` at `loading-state.ts:69-77` requires:

1. `message.streaming === false`
2. `hasActiveBackgroundAgents === false`
3. `message.durationMs >= 1000`

**Data source**: All three values (`durationMs`, `outputTokens`, `thinkingMs`) are baked onto the `ChatMessage` in `handleStreamComplete()` at `chat.tsx:2493-2623`.

**Gap for workflow sub-agents**: The completion summary shows for the **overall workflow message** once streaming stops. There's no per-sub-agent completion summary. The `SubagentStreamAdapter.buildResult()` (lines 533-566 of `subagent-adapter.ts`) already computes per-agent `tokenUsage` and `thinkingDurationMs` in the returned `SubagentStreamResult`, but these values are not surfaced in any UI component.

### Finding 6: Correlation and Event Routing for Sub-Agents

**How sub-agent events are routed** (`src/ui/chat.tsx:4119-4175`):

1. `parentSessionId = getSession?.()?.id ?? "workflow"` — all events carry the parent session's ID
2. `correlationService.addOwnedSession(parentSessionId)` — so events pass ownership check
3. `correlationService.registerSubagent(agentId, { parentAgentId, workflowRunId })` — enables agent-aware enrichment

**Event routing details**:

- `stream.text.delta` with `agentId` → flows through pipeline → arrives in `useStreamConsumer` → at `chat.tsx:2676`, it does NOT update `lastStreamingContentRef` (only main-stream text does) → but it IS dispatched to `applyStreamPartEvent` which routes to agent `inlineParts` via `routeToAgentInlineParts()`
- `stream.text.complete` from sub-agents → `CorrelationService` (line 248-263) sets `suppressFromMainChat = true` → filtered at `wire-consumers.ts:94` → never triggers `handleStreamComplete()`
- `stream.usage` → reaches the **direct bus subscription** at `chat.tsx:2888` → updates `streamingMeta` for whichever message `streamingMessageIdRef.current` points to

### Revised Feature Parity Gap (Detailed)

| Feature                            | Main Chat                               | Workflow Status                                         | What's Missing                                                                                                 |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Spinner animation**              | ✅ 8 braille frames at 120ms            | ✅ Shows "Running workflow…"                            | Nothing — verb override at `chat.tsx:3868` works                                                               |
| **Elapsed timer**                  | ✅ 1s interval ticks                    | ✅ Works for workflow message                           | Nothing — `streamingStartRef` is set at `chat.tsx:3874`                                                        |
| **Token counter (aggregate)**      | ✅ Live `↓ Xk tokens`                   | ⚠️ Partially works                                      | Sub-agent `stream.usage` events DO hit bus → `streamingMeta.outputTokens` accumulates from all agents combined |
| **Token counter (per-agent)**      | N/A                                     | ❌ Not shown                                            | `SubagentStreamResult.tokenUsage` computed but not displayed in agent tree                                     |
| **Thinking seconds (aggregate)**   | ✅ `thought for Xs`                     | ⚠️ Partially works                                      | `stream.thinking.complete` hits bus → `streamingMeta.thinkingMs` uses `Math.max` across all agents             |
| **Thinking seconds (per-agent)**   | N/A                                     | ❌ Not shown                                            | `SubagentStreamResult.thinkingDurationMs` computed but not displayed                                           |
| **Thinking blocks content**        | ✅ `ReasoningPart` with text            | ⚠️ Needs routing                                        | Sub-agent thinking deltas need `routeToAgentInlineParts()` handling for `thinking-meta` events                 |
| **Streaming text**                 | ✅ Incremental via `TextPart`           | ⚠️ Events published, rendering depends on pipeline path | `stream.text.delta` with `agentId` → should route to agent `inlineParts`                                       |
| **Tool calls**                     | ✅ `ToolPart` with lifecycle            | ⚠️ Events published                                     | `stream.tool.*` with `parentAgentId` → should route to agent `inlineParts`                                     |
| **Sub-agent tree**                 | ✅ Full tree                            | ✅ Works                                                | `stream.agent.*` events from `WorkflowEventAdapter` drive the tree                                             |
| **Sub-agent inline parts**         | ✅ Text/tool within agent row           | ❌ Not populated                                        | Agent `inlineParts[]` remains empty because events aren't routed there                                         |
| **Completion summary (overall)**   | ✅ `⣿ Reasoned for Xm Xs · ↓ Xk tokens` | ⚠️ Shows but missing per-agent data                     | `durationMs` works; `outputTokens`/`thinkingMs` reflect aggregate of all agents                                |
| **Completion summary (per-agent)** | N/A                                     | ❌ Not shown                                            | `AgentRow` in `ParallelAgentsTree` shows elapsed time but no tokens/thinking                                   |
| **Context compaction**             | ✅ `/compact` clears and summarizes     | ❌ Not applicable                                       | Workflow sessions are independent — compaction doesn't apply mid-workflow                                      |
| **Verbose mode (Ctrl+E)**          | ✅ Toggles tool expansion               | ✅ Would work                                           | Parts-based rendering respects verbose mode automatically                                                      |
| **Task list**                      | ✅ `TaskListPart`                       | ✅ Works via file watcher                               | `watchTasksJson()` at `workflow-commands.ts:718` drives `TaskListPanel`                                        |

### Key State Variables for Workflow Feature Parity

| State/Ref                            | Location             | Workflow Behavior                                        |
| ------------------------------------ | -------------------- | -------------------------------------------------------- |
| `streamingMeta` / `streamingMetaRef` | `chat.tsx:1627,1854` | Accumulates tokens/thinking from ALL sub-agents combined |
| `streamingElapsedMs`                 | `chat.tsx:1626`      | Ticks for the workflow message (works)                   |
| `streamingStartRef`                  | `chat.tsx:1847`      | Set at workflow start (`chat.tsx:3874`)                  |
| `streamingMessageIdRef`              | `chat.tsx:1839`      | Points to the workflow wrapper message                   |
| `ChatMessage.spinnerVerb`            | `chat.tsx:618`       | Set to `"Running workflow"` at `chat.tsx:3868`           |
| `ChatMessage.outputTokens`           | `chat.tsx:612`       | Baked from aggregate `streamingMeta`                     |
| `ChatMessage.thinkingMs`             | `chat.tsx:614`       | Baked from aggregate `streamingMeta`                     |
| `ChatMessage.durationMs`             | `chat.tsx:594`       | Set on `handleStreamComplete()`                          |

### Architecture Summary: What's Actually Working vs What's Not

```
WORKFLOW SUB-AGENT EVENT FLOW (current state):
═══════════════════════════════════════════════

SubagentStreamAdapter.consumeStream()       [subagent-adapter.ts:136]
  │
  ├── publishes stream.text.delta           ✅ Published to bus
  │     → CorrelationService enriches       ✅ agentId resolved
  │     → StreamPipelineConsumer maps       ✅ Creates text-delta StreamPartEvent
  │     → useStreamConsumer callback        ✅ Receives event
  │     → applyStreamPartEvent reducer      ⚠️ Routes to agent inlineParts IF agentId matches
  │     → AgentPartDisplay renders          ❓ Depends on timing (agent may not exist in parts yet)
  │
  ├── publishes stream.usage                ✅ Published to bus
  │     → useBusSubscription callback       ✅ Updates streamingMeta.outputTokens
  │     → bakes onto workflow message       ✅ Aggregate token count visible in spinner
  │     → per-agent display                 ❌ Not wired
  │
  ├── publishes stream.thinking.delta       ✅ Published to bus
  │     → StreamPipelineConsumer maps       ✅ Creates thinking-meta StreamPartEvent
  │     → useStreamConsumer callback        ✅ Accumulates thinkingText
  │     → applyStreamPartEvent reducer      ⚠️ Creates ReasoningPart on main message, not per-agent
  │
  ├── publishes stream.thinking.complete    ✅ Published to bus
  │     → useBusSubscription callback       ✅ Updates streamingMeta.thinkingMs (Math.max)
  │     → bakes onto workflow message       ✅ Aggregate thinking time visible
  │     → per-agent display                 ❌ Not wired
  │
  ├── publishes stream.tool.start/complete  ✅ Published to bus
  │     → CorrelationService enriches       ✅ parentAgentId resolved
  │     → StreamPipelineConsumer maps       ✅ Creates tool-start/tool-complete StreamPartEvent
  │     → useStreamConsumer callback        ✅ Receives event
  │     → applyStreamPartEvent reducer      ⚠️ Routes to agent inlineParts IF agentId matches
  │
  ├── publishes stream.agent.start          ✅ Published to bus
  │     → useBusSubscription (chat.tsx:2946)✅ Creates ParallelAgent entry
  │     → useEffect bridge → AgentPart      ✅ Agent appears in tree
  │
  └── publishes stream.agent.complete       ✅ Published to bus
        → useBusSubscription (chat.tsx:2973)✅ Updates agent status to complete
        → tree shows completion icon        ✅ Visual feedback

SUMMARY:
  ✅ Events are published by SubagentStreamAdapter
  ✅ Aggregate token/thinking counters work on the workflow message spinner
  ✅ Agent tree (start/complete lifecycle) works
  ⚠️ Agent inline parts (text/tool/thinking within agent rows) may work
     but depends on reducer timing and agent materialization in parts[]
  ❌ Per-agent token and thinking metrics not displayed in tree
  ❌ Per-agent completion summary not implemented
```

---

## Follow-up Research: Additional Feature Parity Gaps

### Finding 7: Workflow Errors Are Plain Text, Not Structured Error Parts

**Main chat:** Tool errors produce structured `ToolState` with `status: "error"` (`stream-pipeline.ts:380-382`), rendered with red icons (`STATUS.error` = ✗), red borders (`colors.error`), and inline error content via `ToolResult` at `tool-result.tsx:55-74`.

**Workflow:** The executor produces plain text `context.addMessage()` calls for failures:

- Graph step failure: `executor.ts:437-439` → `context.addMessage("assistant", \`**${definition.name}** workflow failed at node "${lastNodeId}"...\`)`
- Catch block: `executor.ts:482-485` → `CommandResult` with `success: false, message: "Workflow failed: ..."`

Sub-agent tool errors within a workflow DO get proper `ToolPart` error states (they flow through the event bus pipeline), but workflow-level failures (node failure, uncaught exception) are plain text.

### Finding 8: HITL/Tool Approval Auto-Approved During Workflows

All SDK permission requests are auto-approved when `workflowState.workflowActive` is true:

- `chat.tsx:3208-3213`: Permission requests → auto-responds with `options[0]?.value ?? "allow"`
- `chat.tsx:3277-3283`: AskUserQuestion events → auto-responds with `options?.[0]?.label ?? "continue"`

The `UserQuestionDialog` is never shown during workflows. The only exception is graph-level `human_input_required` signals (`compiled.ts:468-483`) which pause the graph — but this is a graph signal, not SDK-level tool approval.

### Finding 9: Ctrl+C Requires Double-Press to Terminate Workflows

**Main chat:** Single Ctrl+C fully stops the operation, interrupts tools, separates foreground/background agents.

**Workflow:**

- Single Ctrl+C (`chat.tsx:4876`): Cancels only the current sub-agent stream; workflow continues to next graph step
- Double Ctrl+C while streaming (`chat.tsx:4852-4854`): Sets `wasCancelled: true` on stream resolver
- Double Ctrl+C not streaming (`chat.tsx:4960-4966`): Calls `updateWorkflowState({ workflowActive: false })` and rejects `waitForUserInputResolverRef`

### Finding 10: MCP Snapshots and Skill Loading Inaccessible During Workflows

**MCP snapshots:** Triggered exclusively by the `/mcp` slash command (`builtin-commands.ts:510-564`). The workflow executor never invokes slash commands, and sub-agent SDK sessions don't have access to the command registry.

**Skill loading:** Triggered exclusively by skill slash commands (`skill-commands.ts:336-341`). The `skillLoaded` field on `CommandResult` populates `SkillLoadPart` in `chat.tsx:4488-4504`. Workflows and sub-agents have no mechanism to trigger skill loading.

### Finding 11: Session Recovery Infrastructure Exists but Is Not Wired

**What's persisted:**

- `session.json` with `sessionId`, `workflowName`, `status: "running"`, `nodeHistory`, `outputs` (`session.ts:64-76`)
- `tasks.json` via debounced atomic writes (`workflow-commands.ts:250-285`)
- Per-agent results at `agents/{agentId}.json` (`session.ts:87-95`)

**What's not wired:**

- Checkpointer infrastructure exists (`MemoryCheckpointSaver`, `FileSaver`, `ResearchCheckpointSaver` at `checkpointer.ts`)
- `resumeFrom?: ExecutionSnapshot` is accepted by `streamSteps()` (`compiled.ts:350-362`)
- But `executeWorkflow()` never configures a checkpointer and never passes `resumeFrom`
- `session.json` status is never updated from `"running"` to `"completed"`/`"failed"`

### Finding 12: Agent Inline Parts Render as Plain Text, Not Markdown

**Main chat text:** `TextPartDisplay` at `text-part-display.tsx:41-86` renders full markdown with syntax highlighting via `<markdown>` or `<code filetype="markdown">`, streaming cursor support, and text selection.

**Agent inline text:** `AgentInlineText` at `parallel-agents-tree.tsx:642-668` renders as a plain `<text>` element, truncated to 200 characters, with a `●` prefix. No markdown parsing, no syntax highlighting, no concealment.

The `TextPart` objects within `agent.inlineParts` are structurally identical to top-level `TextPart` objects (same type, same `isStreaming` flag), but they bypass `PART_REGISTRY` dispatch entirely — `ParallelAgentsTree` has its own internal `AgentInlineParts` renderer.

### Finding 13: Message Queue Blocked During Workflow Execution

Users CAN enqueue messages during workflows via Ctrl+Shift+Enter (no `workflowActive` guard in the keyboard handler at `chat.tsx:5487-5510`). However, dequeue is blocked because `isStreaming` stays `true` across graph step boundaries (`chat.tsx:4248-4255` skips `setStreamingWithFinalize(false)` when `workflowActiveRef.current` is true).

Even after ESC interrupt, queued messages are not auto-dispatched if `workflowState.workflowActive` is true (`chat.tsx:5197`).

### Finding 14: Input Submission Can Resolve `waitForUserInput` After Ctrl+C

The textarea is never disabled during workflows. When a user types after single Ctrl+C, if `waitForUserInputResolverRef.current` is set (`chat.tsx:5908-5916`), the submission resolves the pending promise and feeds the response back into the graph's `human_input_required` handler — not into a new stream.

### Finding 15: WorkflowStepPartDisplay and TaskListPanel Are Workflow-Exclusive

Two UI components exist only in the workflow rendering path:

- `WorkflowStepPartDisplay` (`workflow-step-part-display.tsx:25-53`): Renders step transition markers `── Step: {name} ● ──`
- `TaskListPanel` (`task-list-panel.tsx:157`): Progress bar (`━`/`╌`), header with counter, status summary, numbered task rows — rendered only when `workflowSessionDir` is set

These are workflow advantages over main chat, not gaps.

### Finding 16: Text Accumulation in Agent InlineParts Has No `message.content` Mirror

Main chat text accumulates into both `TextPart.content` (in `parts[]`) AND `message.content` (flat string) at `stream-pipeline.ts:995-998`. Agent inline text accumulates only into `TextPart.content` within `inlineParts[]` — no `message.content` equivalent exists per-agent. This means search, copy, or transcript features that rely on `message.content` would not include sub-agent text.

### Comprehensive Feature Parity Matrix

| Feature                        | Main Chat                          | Workflow (Current)                                  | Gap Severity       |
| ------------------------------ | ---------------------------------- | --------------------------------------------------- | ------------------ |
| Spinner animation              | ✅ Braille 120ms                   | ✅ "Running workflow…"                              | None               |
| Elapsed timer                  | ✅ 1s ticks                        | ✅ Works                                            | None               |
| Token counter (aggregate)      | ✅ Live `↓ Xk tokens`              | ✅ Accumulates from all agents                      | None               |
| Token counter (per-agent)      | N/A                                | ❌ Not displayed                                    | Medium             |
| Thinking seconds (aggregate)   | ✅ `thought for Xs`                | ✅ Math.max across agents                           | None               |
| Thinking seconds (per-agent)   | N/A                                | ❌ Not displayed                                    | Medium             |
| Thinking block content         | ✅ ReasoningPart rendered          | ⚠️ Routed to inlineParts but rendered as plain text | High               |
| Streaming text                 | ✅ Incremental markdown            | ⚠️ InlineParts: plain text, 200 char truncation     | High               |
| Tool call rendering            | ✅ ToolPart lifecycle with rich UI | ⚠️ InlineParts: plain text summary                  | High               |
| Sub-agent tree                 | ✅ Full tree with status           | ✅ Works                                            | None               |
| Agent inline parts (markdown)  | N/A (main chat has no agents)      | ❌ Plain text only                                  | High               |
| Completion summary (overall)   | ✅ `⣿ Reasoned for Xm`             | ✅ Works with aggregate data                        | None               |
| Completion summary (per-agent) | N/A                                | ❌ Not implemented                                  | Low                |
| Error display                  | ✅ Structured ToolState.error      | ❌ Plain text addMessage                            | High               |
| HITL / Tool approval           | ✅ Interactive dialog              | ❌ Auto-approved                                    | Medium             |
| Abort behavior                 | ✅ Single Ctrl+C                   | ⚠️ Double Ctrl+C required                           | Low                |
| MCP snapshots                  | ✅ Via /mcp command                | ❌ Not accessible                                   | Low                |
| Skill loading                  | ✅ Via skill commands              | ❌ Not accessible                                   | Low                |
| Session recovery               | N/A                                | ❌ Infrastructure exists but unwired                | Medium             |
| Markdown rendering             | ✅ Full syntax highlighting        | ❌ Plain text in agent rows                         | High               |
| Queue during workflow          | ✅ Enqueue + auto-dequeue          | ⚠️ Enqueue works, dequeue blocked                   | Low                |
| Context compaction             | ✅ /compact                        | ❌ Not applicable mid-workflow                      | N/A                |
| Verbose mode (Ctrl+E)          | ✅ Toggles tool expansion          | ✅ Would work via parts pipeline                    | None               |
| Task list                      | ✅ TaskListPart                    | ✅ File watcher + TaskListPanel                     | None               |
| Workflow step markers          | N/A                                | ✅ WorkflowStepPartDisplay                          | Workflow advantage |
| Progress bar                   | N/A                                | ✅ TaskListPanel progress bar                       | Workflow advantage |

### Additional Code References (Follow-up 2)

#### Error Handling

- `src/ui/parts/types.ts:42-43` — `ToolState` error/interrupted variants
- `src/ui/parts/stream-pipeline.ts:380-382` — Tool error state assignment
- `src/ui/components/tool-result.tsx:55-74` — Error icon/color mapping
- `src/workflows/executor.ts:435-451` — Graph step failure (plain text addMessage)
- `src/workflows/executor.ts:466-491` — Catch block error handling

#### HITL / Tool Approval

- `src/ui/chat.tsx:3208-3213` — Auto-approve permissions during workflow
- `src/ui/chat.tsx:3277-3283` — Auto-approve AskUserQuestion during workflow
- `src/workflows/graph/compiled.ts:468-483` — Graph-level `human_input_required` signal

#### Abort / Interrupt

- `src/ui/chat.tsx:4779-4890` — Main Ctrl+C handler with workflow branching
- `src/ui/chat.tsx:4852-4854` — Double Ctrl+C while streaming
- `src/ui/chat.tsx:4960-4966` — Double Ctrl+C not streaming (terminates workflow)
- `src/workflows/graph/compiled.ts:368-381` — AbortSignal check per graph step

#### Markdown / Agent Inline Rendering

- `src/ui/components/parts/text-part-display.tsx:41-86` — Full markdown rendering
- `src/ui/components/parallel-agents-tree.tsx:642-668` — `AgentInlineText` plain text rendering
- `src/ui/components/parallel-agents-tree.tsx:605-639` — `AgentInlineParts` dispatch

#### Session Recovery

- `src/workflows/session.ts:51-85` — Session init and metadata persistence
- `src/workflows/graph/checkpointer.ts:52,186,420` — MemoryCheckpointSaver, FileSaver, ResearchCheckpointSaver
- `src/workflows/graph/compiled.ts:350-362` — `resumeFrom` snapshot handling (dormant)

#### Queue / Input

- `src/ui/hooks/use-message-queue.ts:129-286` — Queue hook implementation
- `src/ui/chat.tsx:5487-5510` — Enqueue keyboard handler (no workflow guard)
- `src/ui/utils/stream-continuation.ts:133-135` — `shouldDispatchQueuedMessage` (blocked by isStreaming)
- `src/ui/chat.tsx:5908-5916` — Input resolves `waitForUserInput` after Ctrl+C

### Additional Code References (Follow-up)

#### Spinner & Token Counter

- `src/ui/chat.tsx:1033-1071` — `LoadingIndicator` component (braille spinner + info parts)
- `src/ui/chat.tsx:2888-2919` — `stream.usage` bus subscription (token accumulation)
- `src/ui/chat.tsx:2009-2022` — Elapsed time interval tick
- `src/ui/chat.tsx:3079` — `streamingStartRef.current = Date.now()` in `startAssistantStream()`
- `src/ui/chat.tsx:3868-3874` — Workflow spinner verb override: `"Running workflow"`
- `src/ui/constants/icons.ts:51-60` — `SPINNER_FRAMES` braille characters
- `src/ui/constants/icons.ts:62` — `SPINNER_COMPLETE` = `⣿`

#### Thinking Duration

- `src/events/adapters/claude-adapter.ts:227-268` — Thinking delta/complete emission
- `src/events/consumers/stream-pipeline-consumer.ts:138-148` — `thinking-meta` mapping
- `src/ui/chat.tsx:2720-2774` — Thinking meta processing in stream consumer
- `src/ui/chat.tsx:2922-2943` — `stream.thinking.complete` bus subscription
- `src/ui/components/parts/reasoning-part-display.tsx:47-97` — Thinking block renderer

#### Compact UI

- `src/ui/commands/builtin-commands.ts:239-277` — `/compact` command
- `src/ui/chat.tsx:1416-1461` — Collapsed message rendering
- `src/ui/hooks/use-verbose-mode.ts:63-101` — Verbose mode hook (Ctrl+E)
- `src/ui/components/parts/compaction-part-display.tsx:18-33` — Compaction banner renderer
- `src/ui/utils/auto-compaction-lifecycle.ts:18-29` — Auto-compaction detection
- `src/ui/components/parts/agent-part-display.tsx:77-104` — Dynamic compact toggle for agent trees

#### Completion Summary

- `src/ui/chat.tsx:1112-1134` — `CompletionSummary` component
- `src/ui/utils/loading-state.ts:69-77` — `shouldShowCompletionSummary()` gating
- `src/ui/chat.tsx:2493-2623` — `handleStreamComplete()` data baking
- `src/events/adapters/subagent-adapter.ts:533-566` — `SubagentStreamResult.buildResult()` with per-agent metrics

#### Other Streaming UI

- `src/ui/components/footer-status.tsx:39-101` — Footer status bar (streaming/workflow hints)
- `src/ui/components/animated-blink-indicator.tsx:16-33` — Shared blinking `●`/`·` indicator
- `src/ui/chat.tsx:1146-1158` — `StreamingBullet` animated text prefix
- `src/ui/components/task-list-panel.tsx:157-179` — File-driven task list
- `src/ui/components/queue-indicator.tsx:25-38` — Message queue indicator
