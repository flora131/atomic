---
date: 2026-03-20 12:34:56 PDT
researcher: Copilot (Claude Opus 4.6)
git_commit: 3da7c0c62940fcdc526e285a82f66c4e9320d1e9
branch: lavaman131/feature/workflow-refactor
repository: workflow-refactor
topic: "Ralph Workflow Redesign: Session-Based Prompt-Chained Architecture Analysis"
tags: [research, codebase, ralph, workflow, orchestrator, subagent, session, interrupt, task-list, graph-engine, redesign]
status: complete
last_updated: 2026-03-20
last_updated_by: Copilot (Claude Opus 4.6)
---

# Research: Ralph Workflow Redesign — Session-Based Prompt-Chained Architecture

## Research Question

Document the complete current Ralph workflow architecture (graph nodes, sub-agent spawning, orchestrator loop, task list UI, session management, and interrupt handling) to enable a redesign where: (1) workflows execute as sequential prompt-chained sessions through the main chat interface with stage indicators, (2) the orchestrator node is replaced by a single prompt to the main agent that inspects the task list widget and spawns parallel sub-agents for non-blocked tasks, (3) all spawnSubagent/manual orchestration logic is removed, (4) each workflow stage (planner→orchestrator→reviewer→debugger) operates in an isolated context window passing only its output to the next stage, and (5) Ctrl+C/ESC stops the current stage (resumable) while double Ctrl+C kills the entire workflow cleanly.

## Summary

The current Ralph workflow is a compiled-graph-based execution engine with 3 phases (plan→worker-loop→review), an `EagerDispatchCoordinator` for parallel sub-agent spawning, file-driven task persistence (`tasks.json`), and a dual-pathway task list UI. The system has accumulated significant complexity: 9+ Ralph-specific fields leak into shared interfaces, 3 different sub-agent spawning paths exist, the orchestrator loop is expressed as graph nodes with conditional back-edges, and workflow sessions share a single context window across all stages. This document provides a complete inventory of what exists today to inform the proposed redesign into a session-per-stage prompt-chained architecture.

---

## Detailed Findings

### 1. Current Ralph Workflow — Graph Structure

The Ralph workflow is defined in `src/services/workflows/ralph/graph/index.ts:235-352` via `createRalphWorkflow()` using the `GraphBuilder` fluent API.

#### Three Phases

**Phase 1 — Task Decomposition (lines 238-260):**
- `planner` subagent node: spawns a planner AI agent with `buildSpecToTasksPrompt(state.yoloPrompt)` → output stored in `state.specDoc`
- `parse-tasks` tool node: calls `parseTasks(args.specDoc)` to extract `TaskItem[]` from planner JSON → stored in `state.tasks` and `state.currentTasks`

**Phase 2 — Worker Loop (lines 263-297):**
- Uses `GraphBuilder.loop()` with two body nodes:
  1. `select-ready-tasks` tool node: calls `getReadyTasks(state.tasks)` → writes to `state.currentTasks`
  2. `worker` custom agent node: delegates to `executeWorkerNode(toRalphWorkflowContext(ctx))`
- Loop termination (lines 290-294): exits when all tasks terminal, no actionable tasks, or iteration limit reached
- `maxIterations: 100` at both graph-level and domain-level

**Phase 3 — Review & Fix (lines 299-351):**
- `reviewer` subagent node: spawns reviewer with `buildReviewPrompt()` → parses via `parseReviewResult()`
- Conditional `.if()` block: if actionable findings exist, `prepare-fix-tasks` converts findings to fix tasks, then `fixer` applies them

#### Loop Mechanics

The `.loop()` DSL at `graph/authoring/iteration-dsl.ts:46-132` compiles into:
- `loop_start` decision node → initializes/reads iteration counter from `state.outputs`
- Body nodes chained: `select-ready-tasks → worker`
- `loop_check` decision node → increments counter
- Back-edge: `loop_check → select-ready-tasks` (condition: `!until(state) && iteration < maxIterations`)
- Exit-edge: `loop_check → reviewer` (condition: `until(state) || iteration >= maxIterations`)

This is an iterative graph traversal, not a programmatic while loop.

### 2. Orchestrator / Worker Dispatch

#### EagerDispatchCoordinator (`graph/eager-dispatch.ts:112-653`)

The core parallel dispatch engine operates with reactive wave-based execution:

1. **`execute()`** (lines 161-173): kicks off first wave via `dispatchReadyTasks()`, then `awaitAllPending()` loops until all batch promises settle
2. **`dispatchReadyTasks()`** (lines 175-194): finds ready task indices (pending, all dependencies completed, not already active), increments wave count, delegates to `dispatchTaskIndices()`
3. **`dispatchTaskIndices()`** (lines 196-286): marks tasks `in_progress`, builds `SubagentSpawnOptions[]` via `buildSpawnConfig()`, calls `spawnSubagentParallel(configs, abortSignal, processBatchResult)`
4. **Reactive cascade** (line 363): on successful task completion, `handleAgentComplete()` calls `dispatchReadyTasks()` again — newly unblocked tasks are dispatched immediately
5. **Retry logic**: up to 3 retries per task; retries exhausted → abort all in-flight

#### WorkerDispatchAdapter (`graph/worker-dispatch.ts:40-182`)

Bridges the graph node and EagerDispatchCoordinator:
- Generates unique agent IDs per task: `worker-${task.id}`
- Binds identity via `taskIdentity.bindProviderId()`
- Builds worker prompts via `buildWorkerAssignment(task, allTasks)` — includes dependency context, completed tasks, and focused instructions
- Status change notifications via `onTaskDispatched` (→ `in_progress`) and `onTaskCompleted` (→ `completed` or `error`)
- `reconcileDispatchedTask()` validates terminal status and builds result envelopes

#### Worker Prompt (`prompts.ts:147-197`)

`buildWorkerAssignment(task, allTasks)` creates a focused markdown prompt with:
- Task Assignment (ID + description)
- Dependencies (resolved from `blockedBy`)
- Completed Tasks (for context)
- Instructions: "Focus solely on this task. Implement it until complete and tested."

### 3. Sub-Agent Spawning — Three Paths

#### Path 1: `spawnSubagent` (Serial)
- Single-slot serial spawning via `context.spawnSubagent()`
- Graph node factory: `subagentNode()` at `graph/nodes/subagent.ts:26`
- Used by planner and reviewer nodes

#### Path 2: `spawnSubagentParallel` (Parallel Batch)
- `context.spawnSubagentParallel()` routes through TUI-provided mechanism
- Graph node factory: `parallelSubagentNode()` at `graph/nodes/parallel.ts:107`
- Used by worker node via EagerDispatchCoordinator

#### Path 3: `SubagentGraphBridge` (Independent Sessions)
- `SubagentGraphBridge.spawn()` / `spawnParallel()` — creates fully independent SDK sessions
- Defined but bypassed at runtime (Ralph routes through `context.spawnSubagentParallel!()`)

#### TUI Spawn Implementation (`state/chat/command/context-factory.ts:66-278`)

`spawnParallelSubagents()` is the actual spawn function:
1. Creates `parallelAbortController` for batch-level cancellation
2. **Per-agent `spawnOne()`** (lines 102-214):
   - Creates SDK session via `args.createSubagentSession!(sessionConfig)`
   - Creates per-agent `AbortController` with stall detection (5-min default, 20-min for workflows)
   - Creates `SubagentStreamAdapter` → publishes `stream.agent.start/update/complete` bus events
   - Calls `session.stream(task, { agent: agentName, abortSignal })` → consumes stream → builds `SubagentStreamResult`
3. **`executeWithRetry()`** (lines 219-250): retries on stall up to 3 times; calls `onAgentComplete` for progressive notification
4. **Batch execution**: `Promise.allSettled(agents.map(executeWithRetry))` — true parallel execution

### 4. Task List UI — Dual Rendering Pathway

#### Data Model

Three task type definitions exist:
- `TaskItem` (UI-level, `task-list-indicator.tsx:28-33`): `id`, `description`, `status: "pending"|"in_progress"|"completed"|"error"`, `blockedBy`
- `TaskItem` (Ralph-level, `prompts.ts:20-28`): adds `summary`, `identity`, `taskResult`
- `NormalizedTaskItem` (persistence-level, `task-status.ts:40-47`): bridges both

#### Path A: TaskListPanel (File-Driven, Persistent)
- `TaskListPanel` at `components/task-list-panel.tsx:159-183`
- Watches `tasks.json` on disk via `watchTasksJson()` (directory-level `fs.watch`)
- Mounted in `MessageBubble` on the last message when `showTodoPanel` is true
- When persistent panel is shown, inline `TaskListPart` parts are filtered out

#### Path B: TaskListPartDisplay (Inline Message Part)
- `TaskListPartDisplay` at `components/message-parts/task-list-part-display.tsx:19-31`
- Registered in `PART_REGISTRY` under key `"task-list"`
- Injected via `StreamPartEvent` of type `"task-list-update"` — deterministic, not AI-generated

#### Status Indicators
| Status | Icon | Color | Animation |
|--------|------|-------|-----------|
| `pending` | `○` | muted (dim gray) | Static |
| `in_progress` | `●`↔`·` | accent (teal) | Blink 500ms |
| `completed` | `✓` | success (green) | Static |
| `error` | `✗` | error (red) | Static |

#### Task Ordering
- `sortTasksTopologically()` at `components/task-order.ts:186` — Kahn's algorithm topological sort
- `detectDeadlock()` — DFS-based cycle detection + error dependency detection

### 5. Session Management

#### Agent Sessions (`services/agents/contracts/session.ts:66-87`)

The `Session` interface defines: `id`, `send()`, `stream()`, `summarize()`, `getContextUsage()`, `destroy()`, `abort()`, `abortBackgroundAgents()`

Sessions are provider-specific:
- **Claude**: `claude-{timestamp}-{random}`, lazy query creation
- **OpenCode**: SDK-generated ID via `sdkClient.session.create()`

#### Workflow Sessions (`services/workflows/session.ts`)

Separate from agent sessions:
- Storage: `~/.atomic/workflows/sessions/{sessionId}/` with `session.json`, `tasks.json`, `progress.txt`, `agents/`, `checkpoints/`
- `WorkflowSession`: `sessionId`, `workflowName`, `status`, `nodeHistory`, `outputs`
- Generated via `crypto.randomUUID()`

#### Critical Finding: Single Context Window

**The entire workflow shares one context window.** Individual nodes do NOT get their own sessions. Subagent nodes spawn separate agent sessions, but the main workflow execution context accumulates across all nodes. There is no mechanism to isolate stage contexts today.

#### Auto-Compaction
- Threshold: `BACKGROUND_COMPACTION_THRESHOLD = 0.45` (45%)
- Proactive: triggers after stream completes when usage exceeds threshold
- Reactive: on context overflow error, summarizes and retries

### 6. Interrupt Handling — Two-Layer System

#### UI Layer: Keyboard Detection
- `use-keyboard.ts:126-129`: Ctrl+C detected as `event.ctrl && !event.shift && event.name === "c"`
- `use-keyboard.ts:164-173`: ESC detected as `event.name === "escape"`
- Kitty keyboard protocol enabled for reliable detection (`exitOnCtrlC: false`)

#### Ctrl+C State Machine (`use-interrupt-controls.ts:124-285`)

**Branch 1 — Streaming active:**
1. Calls `onInterrupt()` → controller aborts stream
2. Calls `interruptStreaming()` → freezes message, finalizes parts, resolves run
3. Calls `terminateActiveBackgroundAgents()`
4. **Workflow path**: increments `interruptCount`, double-press (≥2 within 1s) → `cancelWorkflow()`
5. **Non-workflow path**: clears confirmation, continues queued conversation

**Branch 2 — Foreground agents running:** interrupts agents, terminates background agents

**Branch 3 — Text in input field:** clears textarea

**Branch 4 — Idle empty input:** double-press → `cancelWorkflow()` (if workflow active) or `onExit()` (app exit)

#### ESC State Machine (`use-interrupt-controls.ts:287-405`)

Key differences from Ctrl+C:
- `shouldContinueAfterInterrupt: !workflowState.workflowActive` — ESC auto-continues queued conversation when NOT in workflow
- No double-press detection — ESC never triggers exit
- No `wasCancelled` flag

#### cancelWorkflow() (`use-interrupt-controls.ts:116-122`)
```typescript
updateWorkflowState({ workflowActive: false, workflowType: null, initialPrompt: null });
waitForUserInputResolverRef.current?.reject(new Error("Workflow cancelled"));
```
- No resume mechanism exists — once cancelled, the workflow cannot be restarted
- Cleanup effect in `useWorkflowHitl` syncs terminal task state and clears session refs

#### Process Signals (`chat-ui-controller.ts:431-453`)
- SIGINT → `handleInterrupt("signal")` → same path as UI Ctrl+C
- SIGTERM → immediate `cleanup()` → full teardown, no double-press

### 7. Workflow SDK Design

#### WorkflowDefinition (`workflow-types.ts:53-66`)
```typescript
interface WorkflowDefinition extends WorkflowMetadata {
  graphConfig?: WorkflowGraphConfig;
  createGraph?: () => CompiledGraph<BaseState>;
  createState?: (params: WorkflowStateParams) => BaseState;
  nodeDescriptions?: Record<string, string>;
  runtime?: { featureFlags?: WorkflowRuntimeFeatureFlagOverrides };
}
```

#### Registration Path
1. `ralphWorkflowDefinition` at `ralph/definition.ts:63` — with `createGraph: () => asBaseGraph(createRalphWorkflow())`
2. Registered in `BUILTIN_WORKFLOW_DEFINITIONS` at `workflow-files.ts:215`
3. `createWorkflowCommand()` at `workflow-commands/index.ts` — creates `/ralph` slash command
4. Hardcoded dispatch: `if (metadata.name === "ralph")` — non-Ralph workflows get generic handler

#### Node Types
7 types: `"agent"`, `"tool"`, `"decision"`, `"wait"`, `"ask_user"`, `"subgraph"`, `"parallel"`

Each has factories:
- `agentNode()` — creates AI agent session, streams
- `subagentNode()` — spawns named sub-agent
- `toolNode()` — executes function
- `decisionNode()` — evaluates routes
- `waitNode()` / `askUserNode()` — HITL pauses
- `parallelNode()` / `parallelSubagentNode()` — fan-out

#### Executor (`runtime/executor/index.ts:68-406`)
- Full lifecycle orchestrator: session init → graph compile → state init → runtime wiring → stream execution → cleanup
- Wires `spawnSubagent` and `spawnSubagentParallel` from TUI's `CommandContext` into graph runtime
- Streams graph steps via `AsyncGenerator`, syncing task lists and tracking progress

### 8. Chat State Module — Message Processing Pipeline

#### Module Organization
8 sub-modules in `src/state/chat/`: `agent/`, `command/`, `composer/`, `controller/`, `keyboard/`, `session/`, `shell/`, `stream/`, plus `shared/` and `exports.ts`

#### Message Submission Flow
1. User keystroke → `handleComposerSubmit()` at `composer/submit.ts:45`
2. Slash command detection: `/ralph` parsed by `parseSlashCommand()` at `commands/tui/index.ts:176`
3. Command execution via `useCommandExecutor()` → creates `CommandContext` → executes command
4. `sendMessage()` → `startAssistantStream()` → `onStreamMessage(content)` → SDK invocation
5. Stream events consumed via bus subscriptions → projected into messages/parts

#### Workflow Input Handling
- `waitForUserInputResolverRef` — a promise resolver for workflow HITL pauses
- If set, user input is consumed by `consumeWorkflowInputSubmission()` instead of normal chat
- `useWorkflowHitl()` manages spec approval and question dialogs

#### Key Pattern: onStreamMessage Callback
The system prompt and AI invocation happen OUTSIDE the chat state module. `ChatAppProps.onStreamMessage` is the external callback that invokes the SDK. The chat module only manages UI state projection.

---

## Code References

### Core Ralph Files
- `src/services/workflows/ralph/definition.ts` — Workflow definition & metadata
- `src/services/workflows/ralph/types.ts` — RalphCommandState, RalphWorkflowContext
- `src/services/workflows/ralph/state.ts` — State annotation, creation, update
- `src/services/workflows/ralph/prompts.ts` — All prompt builders
- `src/services/workflows/ralph/graph/index.ts` — Graph builder, node implementations
- `src/services/workflows/ralph/graph/worker-dispatch.ts` — Worker dispatch adapter
- `src/services/workflows/ralph/graph/eager-dispatch.ts` — EagerDispatchCoordinator
- `src/services/workflows/ralph/graph/task-helpers.ts` — Task parsing, dependency resolution

### Graph Engine
- `src/services/workflows/graph/authoring/builder.ts` — GraphBuilder fluent DSL
- `src/services/workflows/graph/authoring/iteration-dsl.ts` — Loop/parallel compilation
- `src/services/workflows/graph/authoring/conditional-dsl.ts` — If/else compilation
- `src/services/workflows/graph/runtime/execution-ops.ts` — Core execution loop
- `src/services/workflows/graph/runtime/compiled.ts` — GraphExecutor, compilation
- `src/services/workflows/graph/contracts/runtime.ts` — Core types (NodeResult, ExecutionContext)

### Sub-Agent System
- `src/state/chat/command/context-factory.ts:66-278` — `spawnParallelSubagents()` TUI implementation
- `src/services/events/adapters/subagent-adapter/index.ts` — SubagentStreamAdapter
- `src/state/chat/stream/use-agent-subscriptions.ts` — Bus event → ParallelAgent[] projection
- `src/components/parallel-agents-tree.tsx` — Agent tree UI

### Task List UI
- `src/components/task-list-panel.tsx` — TaskListBox, TaskListPanel
- `src/components/task-list-indicator.tsx` — Per-task row renderer
- `src/components/message-parts/task-list-part-display.tsx` — Inline part display
- `src/components/task-order.ts` — Topological sort, deadlock detection
- `src/commands/tui/workflow-commands/tasks-watcher.ts` — File watcher

### Session Management
- `src/services/agents/contracts/session.ts` — Session interface
- `src/services/workflows/session.ts` — Workflow session persistence
- `src/services/workflows/runtime/executor/session-runtime.ts` — Workflow session init

### Interrupt Handling
- `src/state/chat/keyboard/use-interrupt-controls.ts` — Ctrl+C/ESC state machines
- `src/state/chat/keyboard/use-interrupt-confirmation.ts` — Double-press detection
- `src/state/chat/stream/interrupt-execution.ts` — Stream interruption mechanics
- `src/state/runtime/chat-ui-controller.ts:366-453` — Controller-level interrupt + signals

### Chat State
- `src/state/chat/composer/submit.ts` — Message submission flow
- `src/state/chat/command/use-executor.ts` — Slash command execution
- `src/state/chat/controller/use-ui-controller-stack/controller.ts` — Top-level composition
- `src/state/chat/controller/use-workflow-hitl.ts` — Workflow HITL bridge

### Workflow Registration
- `src/commands/tui/workflow-commands/index.ts` — `/ralph` command creation & dispatch
- `src/commands/tui/workflow-commands/workflow-files.ts` — BUILTIN_WORKFLOW_DEFINITIONS
- `src/services/workflows/workflow-types.ts` — WorkflowDefinition, WorkflowMetadata

---

## Architecture Documentation

### Current Flow Diagram

```
User: /ralph [PROMPT]
  │
  ▼
parseSlashCommand() → executeCommand("ralph", prompt)
  │
  ▼
createWorkflowCommand() → executeWorkflow(ralphWorkflowDefinition, prompt, context)
  │
  ▼
initializeWorkflowExecutionSession() → creates ~/.atomic/workflows/sessions/{id}/
  │
  ▼
compileGraph() + createState() + wireRuntime()
  │
  ▼
streamGraph() → [AsyncGenerator of StepResults]
  │
  ├─▶ PLANNER (subagent node)
  │     └─ spawnSubagent({agentName: "planner", task: buildSpecToTasksPrompt(prompt)})
  │        └─ SDK session → stream → collect → state.specDoc
  │
  ├─▶ PARSE-TASKS (tool node)
  │     └─ parseTasks(specDoc) → state.tasks = TaskItem[]
  │
  ├─▶ LOOP START (decision node) ◄─────────────────────────────┐
  │                                                              │
  ├─▶ SELECT-READY-TASKS (tool node)                             │
  │     └─ getReadyTasks(state.tasks) → state.currentTasks       │
  │                                                              │
  ├─▶ WORKER (custom node)                                       │
  │     └─ executeWorkerNode() →                                 │
  │        ├─ createWorkerDispatchAdapter()                       │
  │        └─ EagerDispatchCoordinator.execute()                  │
  │           ├─ dispatchReadyTasks() →                           │
  │           │  └─ spawnSubagentParallel(configs, signal, cb)    │
  │           ├─ onAgentComplete → dispatchReadyTasks() (reactive)│
  │           └─ awaitAllPending()                                │
  │                                                              │
  ├─▶ LOOP CHECK (decision node) ──────── continue? ─────────────┘
  │     └─ exit when: all terminal || no actionable || max iterations
  │
  ├─▶ REVIEWER (subagent node)
  │     └─ spawnSubagent({agentName: "reviewer", task: buildReviewPrompt()})
  │
  └─▶ CONDITIONAL FIX
        ├─ if findings → PREPARE-FIX-TASKS → FIXER
        └─ else → END
```

### Proposed Flow (from user's redesign request)

```
User: /ralph [PROMPT]
  │
  ▼
[PLANNER SESSION] — isolated context window
  ├─ Stage indicator: [PLANNER]
  ├─ Prompt sent to main chat interface
  ├─ Planner AI creates task list
  ├─ Output: task list JSON
  └─ Ctrl+C/ESC stops just this stage (resumable)
       │
       ▼ (only task list output passed forward)
[DETERMINISTIC_TOOL_CALL] — task list widget renders
       │
       ▼ (task list + instructions passed forward)
[ORCHESTRATOR SESSION] — new isolated context window
  ├─ Stage indicator: [ORCHESTRATOR]
  ├─ Single optimized prompt to main agent:
  │   "Look at the task list widget. Spawn parallel sub-agents
  │    for all non-blocked tasks. Monitor completions and spawn
  │    newly-unblocked tasks. Report when all tasks are done."
  ├─ Main agent uses native Task/sub-agent tools
  ├─ Agent manages parallelism naturally via its own capabilities
  ├─ Ctrl+C/ESC stops current stage (resumable)
  └─ Output: completed task results + summary
       │
       ▼ (task results passed forward)
[CODE_REVIEWER SESSION] — new isolated context window
  ├─ Stage indicator: [CODE_REVIEWER]
  ├─ Review prompt loaded with task results
  ├─ Output: review findings
  └─ Ctrl+C/ESC stops just this stage
       │
       ▼ (review findings passed forward)
[DEBUGGER SESSION] — new isolated context window
  ├─ Stage indicator: [DEBUGGER]
  ├─ Review output sent to debugger
  ├─ Debugger fixes issues
  └─ Output: fix results
       │
       ▼
WORKFLOW COMPLETE

Double Ctrl+C at any point → kills entire workflow cleanly
```

### Key Differences: Current vs. Proposed

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Context Window** | Single shared context across all nodes | Isolated per-stage (new session each transition) |
| **Orchestration** | `EagerDispatchCoordinator` + graph loop | Main agent prompted to use native sub-agent tools |
| **Sub-Agent Spawning** | 3 code paths: `spawnSubagent`, `spawnSubagentParallel`, `SubagentGraphBridge` | Main agent spawns via its own `Task` tool naturally |
| **Stage Transitions** | Graph edges + conditional routing | Deterministic: planner→task-list→orchestrator→reviewer→debugger |
| **UI** | Graph step events, file-driven task panel | Main chat interface with stage indicators |
| **Interrupt** | Double Ctrl+C cancels workflow (no resume) | Single Ctrl+C/ESC stops current stage (resumable), double Ctrl+C kills all |
| **User Visibility** | Sub-agents mostly hidden, task list is primary UI | User sees everything in main chat per-stage |
| **Graph Engine** | Full compiled graph with BFS execution | Not needed — stages are sequential with deterministic transitions |

---

## What Can Be Removed in the Redesign

### Definitely Removable

1. **`EagerDispatchCoordinator`** (`graph/eager-dispatch.ts`) — 653 lines. Orchestration moves to the main agent's natural sub-agent capabilities
2. **`WorkerDispatchAdapter`** (`graph/worker-dispatch.ts`) — 182 lines. No longer needed to bridge graph nodes and dispatch
3. **`executeWorkerNode()`** (`graph/index.ts:53-107`) — Worker node logic replaced by main agent prompt
4. **Graph loop mechanics** for Ralph (`iteration-dsl.ts` loop compilation for Ralph) — Stages are sequential, not graph loops
5. **`buildWorkerAssignment()`** prompt builder — Main agent reads task list widget directly
6. **`spawnSubagentParallel` in CommandContext** — If the main agent spawns via its own tools
7. **Ralph-specific fields in CommandContext**: `setRalphSessionDir`, `setRalphSessionId`, `setRalphTaskIds` — Replace with generic workflow session management

### Partially Removable

1. **Graph engine** — Still useful for defining the stage sequence (planner→task-list→orchestrator→reviewer→debugger), but the worker loop and conditional fix compilation can be simplified
2. **`SubagentStreamAdapter`** — May still be needed if the main agent spawns sub-agents that stream through the adapter
3. **Task list file watcher** — Task list widget still needed; file persistence may change

### Must Keep

1. **Task list UI components** (`TaskListPanel`, `TaskListIndicator`, `TaskListBox`) — Core to the user experience
2. **Task status normalization** — Still needed for task state management
3. **Interrupt handling infrastructure** — Must be extended, not replaced
4. **Workflow session directory** — Persistent state still needed

---

## Components Needing New Implementation

### 1. Workflow Session Conductor
A lightweight state machine that manages the sequential flow of stages:
- Tracks current stage: `PLANNER | TASK_LIST_DISPLAY | ORCHESTRATOR | REVIEWER | DEBUGGER`
- Creates a fresh agent session for each stage via `CodingAgentClient.createSession()`
- Injects the previous stage's output into the next stage's prompt
- Transitions deterministically between stages
- **Not a graph** — a simple ordered list of stage definitions with deterministic transitions

### 2. Stage Indicator System
- Visual indicators in chat UI: `[PLANNER]`, `[ORCHESTRATOR]`, `[CODE_REVIEWER]`, `[DEBUGGER]`
- Shows which stage is currently active
- Persists across messages within a stage
- Similar to how the current workflow sets `workflowType` but per-stage

### 3. Orchestrator Prompt (replaces EagerDispatchCoordinator)
- A carefully optimized prompt that tells the main agent:
  - "Here is the task list. Spawn a sub-agent for each non-blocked task."
  - "When tasks complete, check for newly-unblocked tasks and spawn them too."
  - "When all tasks are complete, say you're done."
- The agent uses its **own native capabilities** (Task tool, sub-agent tools) — no custom spawning infra needed
- Must be engineered for reliable parallel spawning behavior across all 3 SDKs

### 4. Stage-Aware Interrupt Controller
- Single Ctrl+C/ESC: stops current stage's session, preserves partial output, allows resume or skip
- Double Ctrl+C: kills entire workflow conductor, destroys all sessions, cleans up cleanly
- Must extend existing `useInterruptConfirmation` and `cancelWorkflow()` with stage awareness

### 5. Inter-Stage Output Capture
- Each stage produces structured output that feeds the next:
  - Planner → task list JSON (already parsed by `parseTasks()`)
  - Orchestrator → completion summary (agent's final message)
  - Reviewer → review findings (agent's final message)
  - Debugger → fix results (agent's final message)
- The conductor captures the last assistant message from each session as the stage output

---

## Historical Context (from research/)

### Architectural Evolution (from existing research)

| Date | Document | Key Decision |
|------|----------|-------------|
| 2026-02-09 | `ralph-loop-enhancements.md` | Original issue #163, dual tracking systems identified |
| 2026-02-13 | `ralph-task-list-ui.md` | Persistent file-driven task panel design |
| 2026-02-15 | `ralph-dag-orchestration-*.md` | DAG orchestrator with wave-based batch dispatch (implemented then evolved) |
| 2026-02-15 | `ralph-loop-manual-worker-dispatch.md` | Manual vs automatic orchestration pivot |
| 2026-02-25 | `ralph-workflow-implementation.md` | Graph-based 3-phase pipeline finalized |
| 2026-02-25 | `graph-execution-engine*.md` | GraphBuilder, GraphExecutor documented |
| 2026-02-25 | `workflow-sdk-*.md` | WorkflowSDK class (unused at runtime) |
| 2026-02-25 | `ui-workflow-coupling.md` | Ralph-specific fields in shared interfaces identified |
| 2026-02-28 | `workflow-gaps-architecture.md` | 7 categories of gaps across ~40 files |
| 2026-03-18 | `ralph-eager-dispatch-research.md` | Eager dispatch vs batch dispatch analysis |

### Known Gaps and Dead Code (from 2026-02-28 research)

| Issue | Status | Relevance to Redesign |
|-------|--------|----------------------|
| `WorkflowStepPartDisplay` not in `PART_REGISTRY` | Broken | Fix or remove during redesign |
| `registerCustomTools()` never called | Dead code | Remove |
| `WorkflowSDK` class bypassed at runtime | Dead code | Remove if graph engine simplified |
| 12 unconsumed event types | Dead infrastructure | Clean up during redesign |
| `file-lock.ts` module (0 imports) | Dead code | Remove |
| Debug subscriber never attached | Dead code | Remove |

### SDK-Specific Sub-Agent Support

| SDK | Independent Context | Mechanism |
|-----|-------------------|-----------|
| **Claude** | ✅ Yes | `AgentDefinition` with `query()`, V2 sessions |
| **OpenCode** | ✅ Yes | `Session.fork()` with parent-child relationships |
| **Copilot** | ❌ No | Sub-agents share parent session context |

**Critical**: Copilot cannot render agents via the UI integration's `Task` tool detection because Copilot uses native `customAgents` config instead. This may impact the proposed design where the main agent spawns sub-agents via native tools.

---

## Related Research

- `research/docs/2026-02-25-ralph-workflow-implementation.md` — Current implementation documentation
- `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md` — Graph engine deep dive
- `research/docs/2026-03-18-ralph-eager-dispatch-research.md` — Eager dispatch analysis
- `research/docs/2026-02-25-ui-workflow-coupling.md` — Ralph fields in shared interfaces
- `research/docs/2026-02-28-workflow-gaps-architecture.md` — Architecture gaps inventory
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` — Independent context per SDK

---

## Critical Clarification: Sessions ≠ Sub-Agents

**Each workflow stage is simply a new session with a fresh context window and a specific prompt.** The "sub-agent" nodes in the current graph DSL are not literally sub-agents requiring spawning infrastructure — they are conceptually just "send this prompt to a fresh session and capture the output."

### Mental Model

```
Stage = New Session + System Prompt + User Prompt → Agent Response → Capture Output
```

- The **planner** is a session where the user prompt is `buildSpecToTasksPrompt(userPrompt)` → agent responds with task list
- The **orchestrator** is a session where the prompt says "here's the task list, spawn sub-agents for non-blocked tasks" → agent uses its own native sub-agent capabilities (Task tool, etc.)
- The **reviewer** is a session where the prompt says "review these changes" → agent responds with findings
- The **debugger** is a session where the prompt says "fix these issues" → agent fixes them

### Key Implications

1. **No `spawnSubagent`/`spawnSubagentParallel` at the workflow level** — The orchestrator session's agent naturally spawns sub-agents via its own tools (Task tool, @-mentions, etc.). The workflow infrastructure doesn't need to know about parallelism.

2. **No `EagerDispatchCoordinator`, `WorkerDispatchAdapter`, or `SubagentGraphBridge`** — All of this was manual orchestration of what the agent can do natively within a single session.

3. **TUI history is preserved across sessions** — The user sees a continuous stream of output in the TUI, but each stage operates on a clean context window. The visual history persists; the agent's context does not.

4. **Sessions are just like the main chat** — Each stage is equivalent to the user typing a message in a fresh chat. The only difference is: (a) the prompt is auto-generated from the previous stage's output, (b) there's a stage indicator, and (c) transitions between stages are deterministic.

### What "Sub-Agent Spawning" Becomes

| Current | Proposed |
|---------|----------|
| `spawnSubagent({agentName: "planner", task: ...})` | Create new session → send planner prompt as user message |
| `spawnSubagentParallel(configs, signal, callback)` | Orchestrator session's agent uses native Task tool to spawn parallel workers |
| `EagerDispatchCoordinator.execute()` | Not needed — agent manages this naturally |
| `WorkerDispatchAdapter` | Not needed — agent reads task list widget directly |
| `SubagentStreamAdapter` | Still needed for the session's streaming, but wired like main chat |

### Removable Infrastructure (Expanded)

Everything related to **workflow-level agent management** can be removed:

1. `src/services/workflows/ralph/graph/eager-dispatch.ts` — entire file (653 lines)
2. `src/services/workflows/ralph/graph/worker-dispatch.ts` — entire file (182 lines)
3. `src/services/workflows/ralph/graph/index.ts` `executeWorkerNode()` (lines 53-107) and `executeFixerNode()`
4. `src/services/workflows/ralph/prompts.ts` `buildWorkerAssignment()` (lines 147-197)
5. `src/services/workflows/graph/nodes/subagent.ts` — `subagentNode()` factory
6. `src/services/workflows/graph/nodes/parallel.ts` — `parallelSubagentNode()` factory
7. `src/state/chat/command/context-factory.ts` `spawnParallelSubagents()` (lines 66-278) — the TUI spawn implementation
8. `context.spawnSubagent` and `context.spawnSubagentParallel` from `CommandContext`
9. The executor's runtime wiring for spawn functions (`executor/index.ts:148-194`)
10. `SubagentGraphBridge` and related bridge code

### What Stays

1. **`SubagentStreamAdapter`** — Still needed within each session for streaming agent responses through the event bus
2. **Task list UI components** — `TaskListPanel`, `TaskListIndicator`, `TaskListBox`
3. **Session creation** — `CodingAgentClient.createSession()` — used to create each stage's session
4. **Stream infrastructure** — `useStreamSessionSubscriptions`, bus events, message projection
5. **Interrupt handling** — Extended for stage-aware behavior

---

## Open Questions

1. **Resume semantics**: When Ctrl+C/ESC stops a stage, what state is preserved? Can the agent session be resumed mid-stream, or does the stage restart from scratch with its prompt?

2. **Inter-stage output format**: What's the optimal format for passing stage outputs? Raw text? Structured JSON? The task list is already structured, but review findings may be free-form.

3. **Task list widget injection**: How does the orchestrator session's agent "see" the task list? Injected into the system prompt? Available as a tool? Rendered in the TUI and referenced by instruction?

4. **Debugger stage conditionality**: Should the debugger stage always run, or only when the reviewer produces findings?

5. **Graph engine retention**: Is the graph engine still needed for the sequential stage transitions, or is a simpler deterministic state machine (`PLANNER → TASK_LIST → ORCHESTRATOR → REVIEWER → DEBUGGER`) sufficient?

6. **Session destruction timing**: When transitioning to the next stage, should the previous session be immediately destroyed, or kept alive briefly for potential Ctrl+C resume?
