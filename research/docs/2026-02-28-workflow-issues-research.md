---
date: 2026-02-28 00:48:00 UTC
researcher: Copilot (Claude Opus 4.6)
git_commit: aed66d9f7cb82d4eef22c4d717d57c559fe747e4
branch: lavaman131/feature/workflow-sdk
repository: atomic
topic: "Workflow Issues: Sub-Agent Tree Streaming, Code-Review Timing, and Parallel Task Execution"
tags: [research, codebase, workflows, ralph, sub-agent-tree, parallel-execution, code-review, event-pipeline, task-list-ui, blink-animation, stream-finalization, completion-delay]
status: complete
last_updated: 2026-02-28
last_updated_by: Copilot (Claude Opus 4.6)
last_updated_note: "Added Issue 4: Task list blinker for active tasks, Issue 5: Streaming delay after TODO completion"
---

# Research: Workflow Issues

## Research Question

Research to resolve three issues in the workflow system:

1. **Sub-agent tree state stuck at "Initializing..."** — not streaming tool calls or tool call counts
2. **Code-review stage timing** — should run only at the end of the entire workflow, not after each task
3. **Parallel task execution** — multiple runnable tasks should execute concurrently instead of sequentially
4. **Task list blinker for active tasks** — visual indicator for tasks being actively worked on
5. **Streaming delay after TODO completion** — delay between tasks marked complete and final duration/tokens summary appearing

## Summary

### Issue 1: Sub-Agent Tree "Initializing..." State

The "Initializing..." text in the sub-agent tree UI persists until `agent.toolUses` becomes a number greater than 0. The data flow for tool call counts follows a **dual-channel architecture**: agent lifecycle events (`stream.agent.start/update/complete`) flow through direct `useBusSubscription` hooks in `chat.tsx`, while tool content events (`stream.tool.start/complete`) flow through the `StreamPipelineConsumer` pipeline. The `SubagentToolTracker` publishes `stream.agent.update` events with incrementing `toolUses` counts on each `onToolStart()` call. If these events are not reaching the UI, the issue lies in one of several identified chokepoints: event coalescing dropping updates, the `AgentPart` not yet being created when tool events arrive (causing silent drops), or the `useBusSubscription` handler not correctly merging `toolUses` into the `parallelAgents` React state.

### Issue 2: Code-Review Timing

The code-review stage (`reviewer` node) **already runs only once, after the entire worker loop completes** — not after each individual task. The graph topology is: `planner → parse-tasks → [loop: select-ready-tasks → worker] → reviewer → conditional fixer → END`. The loop exit edge from `loop_check_N` to `reviewer` is only taken when the `until` condition evaluates to true (all tasks completed/errored, or max iterations reached). This issue may stem from a misunderstanding of the current behavior, or from a different workflow configuration not captured in the main `graph.ts`.

### Issue 3: Parallel Task Execution

The current system executes tasks **strictly one at a time**. Two layers enforce this:
1. **Graph engine** (`compiled.ts`): Processes nodes sequentially via a FIFO queue — `nodeQueue.shift()` dequeues one node, executes it, then pushes next nodes.
2. **Worker node** (`graph.ts:154`): Takes only `ready[0]` — the first ready task — even though `getReadyTasks()` may return multiple tasks with satisfied dependencies.

True parallelism exists only _within_ individual nodes via `spawnSubagentParallel` (wired in `executor.ts:235-263`), but the Ralph worker node does not use it.

### Issue 4: Task List Blinker for Active Tasks

The task list widget **already has a blinking indicator** for in-progress tasks. The `AnimatedBlinkIndicator` component (`animated-blink-indicator.tsx`) alternates between `●` and `·` at 500ms and is used by `TaskListIndicator` (`task-list-indicator.tsx:146-149`) for any task with `status === "in_progress"`. However, a potential gap exists: the Ralph workflow's worker node (`graph.ts:141-178`) does not explicitly set task status to `"in_progress"` before spawning a sub-agent. Tasks go directly from `"pending"` → `"completed"`/`"error"` unless the spawned sub-agent writes `status: "in_progress"` to `tasks.json` via TodoWrite during its execution. This means the blinker may not activate for actively-worked-on tasks if the sub-agent doesn't set this intermediate status.

### Issue 5: Streaming Delay After TODO Completion

There is a multi-second delay between the last task being marked complete and the final "⣿ Composed for X · ↓ Y tokens" summary appearing. The pipeline from stream end to summary involves **five identified sources of delay**: (1) **Deferred completion** — if `handleStreamComplete()` fires while sub-agents are still "running" in React state, finalization is deferred with a 30-second safety timeout (`chat.tsx:2527`); resolution requires agent-complete events to flow through the bus → 16ms batch → React state update → re-render → `useEffect` → `setTimeout(…, 0)`; (2) **SDK `session.idle` timing** — for OpenCode/Copilot adapters, the `session.idle` event is SDK-internal; the UI waits for the SDK to signal idle, which may take seconds after the last meaningful action; (3) **`shouldShowCompletionSummary` gate** — requires `!message.streaming && !hasActiveBackgroundAgents && durationMs >= 1000`; background agents that haven't been terminated yet block this; (4) **File I/O in graph loop** — `await saveTasksToSession()` performs atomic file writes in the critical path between node completion and stream finalization; (5) **React state update batching** — multiple state updates (`setMessagesWindowed`, `setParallelAgents`, `setIsStreaming`) may require multiple render cycles to converge.

---

## Detailed Findings

### Issue 1: Sub-Agent Tree Not Streaming Tool Calls

#### 1.1 Where "Initializing..." Comes From

**Primary rendering path** — `AgentRow` in `parallel-agents-tree.tsx:570-633`:

```typescript
// parallel-agents-tree.tsx:573
const isRunning = agent.status === "running" || agent.status === "pending";

// parallel-agents-tree.tsx:579-585
if (isRunning) {
  if (agent.toolUses !== undefined && agent.toolUses > 0) {
    subStatusText = `${agent.name}: (${agent.toolUses} tool uses)`;
  } else {
    subStatusText = `Initializing ${agent.name}…`;
  }
}
```

The gate condition is `agent.toolUses !== undefined && agent.toolUses > 0`. Any agent with `toolUses` of `undefined` or `0` shows "Initializing…".

**Secondary path** — `transcript-formatter.ts:216-218` mirrors this exact logic.

#### 1.2 How `toolUses` Gets Populated

The complete data flow for tool use counts:

1. **Sub-agent stream starts** → `SubagentStreamAdapter` constructor (`subagent-adapter.ts:88-97`) creates `SubagentToolTracker`, calls `registerAgent(agentId)` which initializes `{ toolCount: 0 }`.

2. **Tool use detected** → `handleToolUse()` (`subagent-adapter.ts:266-313`) calls `this.toolTracker.onToolStart(this.agentId, toolName)` at line 297.

3. **Tracker emits update** → `SubagentToolTracker.onToolStart()` (`subagent-tool-tracker.ts:60-66`) increments `toolCount`, publishes `stream.agent.update` to the bus with `data.toolUses = state.toolCount`.

4. **Bus → BatchDispatcher** → Event is coalesced by key `agent.update:${agentId}` (`coalescing.ts:31-34`), keeping only the latest per batch window (~16ms).

5. **Consumer pipeline** → `StreamPipelineConsumer.mapToStreamPart()` returns `null` for `stream.agent.update` (line 214 default case) — **this event type is NOT mapped to a `StreamPartEvent`**.

6. **Direct bus subscription** → `chat.tsx:2882-2895` uses `useBusSubscription("stream.agent.update", ...)` to directly subscribe to the bus. When fired, calls `setParallelAgents()` to merge `data.toolUses` and `data.currentTool` into the matching agent in React state.

7. **React state → Message baking** → `useEffect` at `chat.tsx:3209-3266` watches `parallelAgents` and calls `applyStreamPartEvent(msg, { type: "parallel-agents", agents })` to bake updated agents into the streaming message's `AgentPart`.

8. **AgentRow re-renders** → If `toolUses > 0`, shows tool count instead of "Initializing…".

#### 1.3 Identified Chokepoints

| Chokepoint | Location | Description |
|---|---|---|
| **Event coalescing** | `coalescing.ts:31-34` | `stream.agent.update` events are coalesced per agent per batch window. If the batch window captures no updates (e.g., timing issue), no event reaches the subscriber. |
| **Dual-channel race condition** | `stream-pipeline.ts:917-918` | Tool/text events with `agentId` are routed to `AgentPart.inlineParts` via `routeToAgentInlineParts()`. If the `AgentPart` hasn't been created yet (because `parallel-agents` event hasn't been baked via the React `useEffect` path), these events are **silently dropped**. |
| **`useBusSubscription` bypass** | `chat.tsx:2882-2895` | The `stream.agent.update` handler bypasses the `StreamPipelineConsumer` entirely. If this hook is not mounted, or if the event never reaches it (filtered by `CorrelationService.isOwnedEvent()`), `toolUses` never updates. |
| **Ownership check** | `wire-consumers.ts:83-86` | Events must pass `correlation.isOwnedEvent(event)` which checks `event.runId` matches `_activeRunId`. If the sub-agent's `runId` differs from the active run, events are dropped. |
| **Schema validation** | `event-bus.ts:140-152` | If the `stream.agent.update` event data doesn't match the Zod schema (`BusEventSchemas`), the event is silently dropped. |

#### 1.4 Key Code References

| File | Lines | Function |
|---|---|---|
| `src/ui/components/parallel-agents-tree.tsx` | 570-633 | `AgentRow` — renders "Initializing…" or tool count |
| `src/ui/components/parallel-agents-tree.tsx` | 32-63 | `ParallelAgent` interface — `toolUses?: number` at line 56 |
| `src/events/adapters/subagent-tool-tracker.ts` | 60-66 | `onToolStart()` — increments count, publishes update |
| `src/events/adapters/subagent-tool-tracker.ts` | 95-108 | `publishUpdate()` — constructs `stream.agent.update` event |
| `src/events/adapters/subagent-adapter.ts` | 266-313 | `handleToolUse()` — calls `toolTracker.onToolStart()` |
| `src/events/coalescing.ts` | 31-34 | Coalescing key for `stream.agent.update` |
| `src/events/consumers/stream-pipeline-consumer.ts` | 214 | `mapToStreamPart()` returns `null` for `stream.agent.update` |
| `src/ui/parts/stream-pipeline.ts` | 838-858 | `routeToAgentInlineParts()` — drops events if agent not in parts |
| `src/ui/parts/stream-pipeline.ts` | 917-918 | Silent drop when agent-scoped routing fails |

---

### Issue 2: Code-Review Stage Timing in Ralph Workflow

#### 2.1 Current Graph Topology

The Ralph workflow graph (`graph.ts:98-236`) has the following edge structure:

```
planner → parse-tasks → loop_start_N → select-ready-tasks → worker → loop_check_N
                                              ↑                           │
                                              └───── (continue) ──────────┘
                                                                          │
                                                                    (exit) ↓
                                                                      reviewer → decision_N
                                                                                    │
                                                         ┌──── (has findings) ──────┘
                                                         ↓                          │
                                                       fixer                  (no findings)
                                                         │                          │
                                                         └────────→ merge_N ←───────┘
                                                                       │
                                                                     (END)
```

#### 2.2 Code-Review Is Already a Post-Loop Step

The reviewer node is connected by an edge from `loop_check_N` that is taken **only when the loop exit condition is met** (`graph.ts:181-184`):

```typescript
until: (state) =>
  state.tasks.every((t) => t.status === "completed" || t.status === "error") ||
  state.iteration >= state.maxIterations ||
  !hasActionableTasks(state.tasks),
```

The builder generates a loop-continue edge (`builder.ts:722-731`) with condition `!config.until(state) && iteration < max`. When this condition is false, the loop exits, and the fall-through edge to `reviewer` is taken.

The executor (`executor.ts:268-332`) does **not** contain any task-specific iteration logic — it simply iterates over graph steps via `for await (const step of streamGraph(compiled, { initialState }))`. The task loop is entirely handled by the graph's `loop` construct.

#### 2.3 Single Reviewer Execution

The `reviewer` node has exactly one incoming edge (from `loop_check_N`) and exactly one outgoing edge (to `decision_N`). It executes precisely once per workflow run, after the loop completes.

#### 2.4 Key Code References

| File | Lines | Function |
|---|---|---|
| `src/workflows/ralph/graph.ts` | 98-236 | `createRalphWorkflow()` — full graph definition |
| `src/workflows/ralph/graph.ts` | 181-184 | Loop `until` condition |
| `src/workflows/ralph/graph.ts` | 190-208 | Reviewer node definition |
| `src/workflows/ralph/graph.ts` | 210-234 | Conditional fixer logic |
| `src/workflows/graph/builder.ts` | 647-737 | `.loop()` method — generates loop structure |
| `src/workflows/graph/builder.ts` | 722-731 | Loop-continue edge condition |
| `src/workflows/graph/compiled.ts` | 758-787 | `getNextNodes()` — edge evaluation |
| `src/workflows/executor.ts` | 268-332 | Main execution loop (graph-agnostic) |

---

### Issue 3: Sequential vs. Parallel Task Execution

#### 3.1 Graph Engine Is Sequential

The `GraphExecutor.streamSteps()` method (`compiled.ts:322-569`) uses a FIFO queue and processes **one node at a time**:

```typescript
// compiled.ts:367
while (nodeQueue.length > 0 && stepCount < maxSteps) {
  // compiled.ts:383
  const currentNodeId = nodeQueue.shift()!;
  // ... execute single node ...
  // compiled.ts:518
  const nextNodes = this.getNextNodes(currentNodeId, state, result);
  // compiled.ts:521
  nodeQueue.push(...nextNodes);
}
```

Even when `getNextNodes()` returns multiple targets (e.g., from parallel edges), they are pushed to the queue and executed sequentially.

The `parallelNode` factory (`nodes.ts:967-1008`) returns `goto: branches` (line 1004) which pushes all branch IDs into the queue, but they still execute one at a time through the while loop.

#### 3.2 Worker Node Processes One Task Per Iteration

In `graph.ts:141-178`, the worker node's execute function:

```typescript
// graph.ts:154 — only the first ready task
const task = ready[0];
```

Despite `getReadyTasks()` (`graph.ts:57-73`) returning all tasks whose dependencies are satisfied, the worker only processes the first one. After processing, all `currentTasks` are marked as completed/error based on the single spawn result (`graph.ts:168-174`).

#### 3.3 Available Parallelism Infrastructure

The runtime does have parallel spawning capability:

1. **`spawnSubagentParallel`** — wired in `executor.ts:235-263`:
   ```typescript
   // executor.ts:247
   compiled.config.runtime.spawnSubagentParallel = async (configs) => {
     return spawnSubagentParallel(configs);
   };
   ```

2. **`spawnSubagentParallel` from context** — available via `context.spawnSubagentParallel` (set at `executor.ts:203`), which supports concurrent agent execution.

3. **`getReadyTasks()`** (`graph.ts:57-73`) — already correctly identifies all tasks whose `blockedBy` dependencies are satisfied. It returns the full array of ready tasks, not just one.

However, the worker node does not use `spawnSubagentParallel`. It calls `spawnSubagent` (singular) with `ready[0]`.

#### 3.4 Dependency Checking Logic

`getReadyTasks()` (`graph.ts:57-73`):
1. Builds a `completedIds` set: collects IDs of all tasks where status is `"completed"`, `"complete"`, or `"done"`. IDs are normalized (trimmed, lowercased, `#` prefix stripped).
2. A task is "ready" if:
   - `task.status === "pending"`
   - All entries in `task.blockedBy` (also normalized) are present in `completedIds`

`hasActionableTasks()` (`graph.ts:78-84`):
- Returns `true` if any task is `"in_progress"` or is a pending task that would appear in `getReadyTasks()`
- Used as a deadlock detector for the loop exit condition

#### 3.5 Key Code References

| File | Lines | Function |
|---|---|---|
| `src/workflows/graph/compiled.ts` | 322-569 | `streamSteps()` — sequential FIFO node execution |
| `src/workflows/graph/compiled.ts` | 367 | Main while loop — one node at a time |
| `src/workflows/graph/compiled.ts` | 383 | `nodeQueue.shift()!` — dequeue single node |
| `src/workflows/graph/compiled.ts` | 518-521 | `getNextNodes()` + `push()` — sequential queuing |
| `src/workflows/graph/nodes.ts` | 967-1008 | `parallelNode()` — returns `goto: branches` (still sequential) |
| `src/workflows/ralph/graph.ts` | 141-178 | Worker node — processes `ready[0]` only |
| `src/workflows/ralph/graph.ts` | 154 | `const task = ready[0]` — single task selection |
| `src/workflows/ralph/graph.ts` | 57-73 | `getReadyTasks()` — finds all ready tasks |
| `src/workflows/ralph/graph.ts` | 78-84 | `hasActionableTasks()` — deadlock detection |
| `src/workflows/executor.ts` | 235-263 | `spawnSubagentParallel` wiring — exists but unused by Ralph worker |

---

## Architecture Documentation

### Event Pipeline Architecture

```
SDK Stream (AsyncIterable/EventEmitter)
    │
    ▼
SDK Adapter (claude/copilot/subagent-adapter.ts)
    │ Normalizes SDK events to BusEvent types
    │ Creates SubagentToolTracker for tool counting
    ▼
AtomicEventBus (event-bus.ts)
    │ Validates via Zod schemas
    │ Dispatches to typed + wildcard handlers
    ▼
BatchDispatcher (batch-dispatcher.ts)
    │ ~16ms batching, coalescing by key
    │ Double-buffer swap for flushing
    ▼
wireConsumers pipeline (wire-consumers.ts)
    │ Filters: isOwnedEvent()
    │ Enriches: CorrelationService.enrich()
    │ Suppresses: suppressFromMainChat
    ▼
StreamPipelineConsumer (stream-pipeline-consumer.ts)
    │ Maps BusEvent → StreamPartEvent
    │ NOTE: stream.agent.update → null (NOT mapped)
    ▼
useStreamConsumer hook (hooks.ts)
    │ Forwards StreamPartEvent[] to chat.tsx
    ▼
applyStreamPartEvent reducer (stream-pipeline.ts)
    │ Mutates ChatMessage with Parts
    ▼
React components render Parts
```

**Parallel channel for agent lifecycle:**
```
AtomicEventBus
    │
    ▼
useBusSubscription("stream.agent.start/update/complete") in chat.tsx
    │ Direct bus subscription (bypasses BatchDispatcher/Consumer pipeline)
    │ Updates parallelAgents React state
    ▼
useEffect watches parallelAgents → bakes into ChatMessage.parts
    │ Creates/updates AgentPart entries
    ▼
ParallelAgentsTree component renders agent rows
```

### Workflow Graph Execution Architecture

```
WorkflowDefinition + GraphBuilder API
    │
    ▼
CompiledGraph (nodes: Map, edges: Edge[], startNode, endNodes)
    │
    ▼
GraphExecutor.streamSteps() — FIFO queue, one node at a time
    │ Initialize: nodeQueue = [startNode]
    │ Loop: shift() → execute → mergeState → getNextNodes() → push()
    │ Exit: current is endNode AND queue empty
    ▼
executeWorkflow() — iterates streamGraph() steps
    │ Wires runtime (spawnSubagent, spawnSubagentParallel)
    │ Syncs task state to UI after each step
    ▼
Results
```

### Ralph Workflow Phase Architecture

```
Phase 1: Planning
  planner (sub-agent) → parse-tasks (tool)

Phase 2: Implementation Loop
  select-ready-tasks (tool) → worker (sub-agent, 1 task/iteration)
  ↑ loop continues until all tasks done or max iterations

Phase 3: Review & Fix
  reviewer (sub-agent) → conditional fixer (sub-agent, uses "debugger" agent)
```

---

## Code References

- `src/workflows/executor.ts` — Generic workflow executor, graph-agnostic
- `src/workflows/ralph/graph.ts` — Ralph workflow graph definition
- `src/workflows/ralph/definition.ts` — Ralph workflow metadata
- `src/workflows/ralph/state.ts` — Ralph state shape and reducers
- `src/workflows/ralph/prompts.ts` — Prompt templates for all Ralph stages
- `src/workflows/graph/compiled.ts` — Graph execution engine (FIFO queue)
- `src/workflows/graph/builder.ts` — Fluent graph builder API
- `src/workflows/graph/nodes.ts` — Node factory functions
- `src/ui/components/parallel-agents-tree.tsx` — Sub-agent tree rendering
- `src/ui/parts/stream-pipeline.ts` — Stream event reducer
- `src/ui/parts/store.ts` — Parts store utilities
- `src/events/adapters/subagent-adapter.ts` — Sub-agent event adapter
- `src/events/adapters/subagent-tool-tracker.ts` — Tool call counting
- `src/events/adapters/claude-adapter.ts` — Claude SDK adapter
- `src/events/adapters/copilot-adapter.ts` — Copilot SDK adapter
- `src/events/adapters/workflow-adapter.ts` — Workflow event adapter
- `src/events/bus-events.ts` — Event type definitions
- `src/events/event-bus.ts` — Event bus implementation
- `src/events/batch-dispatcher.ts` — Batched event dispatching
- `src/events/coalescing.ts` — Event coalescing logic
- `src/events/consumers/wire-consumers.ts` — Consumer wiring
- `src/events/consumers/correlation-service.ts` — Event correlation
- `src/events/consumers/stream-pipeline-consumer.ts` — Stream pipeline consumer
- `src/events/hooks.ts` — React event hooks
- `src/ui/chat.tsx` — Main chat component with agent state management

## Historical Context (from research/)

- `research/docs/2026-02-25-ralph-workflow-implementation.md` — Prior research on Ralph implementation
- `research/docs/2026-02-27-workflow-tui-rendering-unification.md` — TUI rendering unification research
- `research/docs/2026-02-15-subagent-event-flow-diagram.md` — Sub-agent event flow diagram
- `research/docs/2026-02-15-subagent-premature-completion-investigation.md` — Sub-agent premature completion investigation
- `research/docs/2026-02-16-sub-agent-tree-inline-state-lifecycle-research.md` — Sub-agent tree inline state lifecycle
- `research/docs/2026-02-23-sdk-subagent-api-research.md` — SDK sub-agent API research
- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` — Sub-agent SDK integration analysis
- `research/ralph-workflow.md` — Original issue description for these three workflow issues

## Related Research

- `research/docs/2026-02-25-unified-workflow-execution-research.md` — Unified workflow execution patterns
- `research/docs/2026-02-25-workflow-sdk-standardization.md` — Workflow SDK standardization
- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` — Pluggable workflow SDK design

---

### Issue 4: Task List Blinker for Active Tasks

#### 4.1 Current State — Already Implemented

The task list widget **already has a blinking indicator for in-progress tasks**. The `TaskListIndicator` component (`task-list-indicator.tsx:146-149`) renders an `AnimatedBlinkIndicator` for any task with `status === "in_progress"`:

```typescript
// task-list-indicator.tsx:146-149
{isActive ? (
  <AnimatedBlinkIndicator color={color} speed={500} />
) : (
  <span style={{ fg: textColor }}>{icon}</span>
)}
```

Where `isActive` is `status === "in_progress"` (line 115).

The `AnimatedBlinkIndicator` (`animated-blink-indicator.tsx:1-33`) alternates between `●` (STATUS.active) and `·` (MISC.separator) every 500ms, colored in `themeColors.accent` (teal: `#94e2d5` dark / `#179299` light).

#### 4.2 Animation Architecture

The canonical blink component uses React state and `setInterval`:

```typescript
// animated-blink-indicator.tsx:16-33
export function AnimatedBlinkIndicator({ color, speed = 500 }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const interval = setInterval(() => setVisible((prev) => !prev), speed);
    return () => clearInterval(interval);
  }, [speed]);
  return <span style={{ fg: color }}>{visible ? STATUS.active : MISC.separator}</span>;
}
```

#### 4.3 When Tasks Enter "in_progress" Status

Tasks transition to `in_progress` when agents update the `tasks.json` file via TodoWrite. The data flow is:

1. Agent calls TodoWrite with `status: "in_progress"` for a task
2. `tasks.json` is written to disk in the workflow session directory
3. `watchTasksJson()` (`workflow-commands.ts:719`) detects the file change
4. `TaskListPanel` (`task-list-panel.tsx:157-179`) parses, normalizes via `normalizeTaskItem()`, sorts topologically
5. `TaskListIndicator` renders each task — `in_progress` tasks get the `AnimatedBlinkIndicator`

#### 4.4 Status Visual Summary

| Status | Icon | Color | Animation |
|---|---|---|---|
| `pending` | `○` (White Circle) | `muted` (dim gray) | Static |
| `in_progress` | `●` ↔ `·` (blink) | `accent` (teal) | **AnimatedBlinkIndicator at 500ms** |
| `completed` | `✓` (Check Mark) | `success` (green) | Static |
| `error` | `✗` (Ballot X) | `error` (red) | Static, with `[FAILED]` label |

#### 4.5 Status Aliases

The `TASK_STATUS_ALIASES` map (`task-status.ts:19-37`) normalizes many runtime values to canonical statuses:

| Aliases → | Canonical |
|---|---|
| `pending`, `todo`, `open`, `not_started` | `"pending"` |
| `in_progress`, `inprogress`, `doing`, `running`, `active` | `"in_progress"` |
| `completed`, `complete`, `done`, `success`, `succeeded` | `"completed"` |
| `error`, `failed`, `failure` | `"error"` |

#### 4.6 Other Blink Patterns in the Codebase

The same blink pattern is used across the UI:

| Component | Location | Context |
|---|---|---|
| `AnimatedBlinkIndicator` | `animated-blink-indicator.tsx` | Shared reusable component |
| `TaskListIndicator` | `task-list-indicator.tsx:147` | In-progress task items |
| `ToolResult` / `StatusIndicator` | `tool-result.tsx:81` | Running tool executions |
| `StreamingBullet` | `chat.tsx:1152` | Streaming text prefix |
| `AnimatedDot` | `skill-load-indicator.tsx:103` | Skill loading state |

All use the same pattern: `setInterval` toggling a boolean at 500ms, alternating `●` / `·`.

#### 4.7 Potential Gap: Workflow-Spawned Tasks vs. TodoWrite Tasks

The blinker works for tasks that have `status === "in_progress"` in `tasks.json`. However, in the Ralph workflow, the worker node (`graph.ts:141-178`) does **not** explicitly set task status to `"in_progress"` before spawning the sub-agent. The flow is:

1. `select-ready-tasks` node calls `getReadyTasks()` → sets `currentTasks` (status still `"pending"`)
2. `worker` node spawns sub-agent with `ready[0]`
3. After spawn completes, maps tasks to `"completed"` or `"error"` (`graph.ts:168-174`)

There is no intermediate step setting `ready[0].status = "in_progress"` before the spawn. The blinker would only activate if the spawned sub-agent itself writes `status: "in_progress"` to `tasks.json` via TodoWrite during its execution.

#### 4.8 Key Code References

| File | Lines | Function |
|---|---|---|
| `src/ui/components/animated-blink-indicator.tsx` | 1-33 | `AnimatedBlinkIndicator` — canonical blink component |
| `src/ui/components/task-list-indicator.tsx` | 113-162 | Per-task row rendering with blink |
| `src/ui/components/task-list-indicator.tsx` | 146-149 | `AnimatedBlinkIndicator` usage for `in_progress` |
| `src/ui/components/task-list-indicator.tsx` | 52-57 | Status icon constants |
| `src/ui/components/task-list-indicator.tsx` | 66-74 | `getStatusColorKey()` — status-to-color mapping |
| `src/ui/components/task-list-panel.tsx` | 72-151 | `TaskListBox` — container with progress bar |
| `src/ui/components/task-list-panel.tsx` | 157-179 | `TaskListPanel` — file-driven wrapper |
| `src/ui/utils/task-status.ts` | 19-37 | `TASK_STATUS_ALIASES` — status normalization |
| `src/ui/utils/task-status.ts` | 149-156 | `normalizeTaskStatus()` — canonical normalization |
| `src/ui/constants/icons.ts` | 1-108 | Icon constants (`STATUS.active`, `MISC.separator`, etc.) |
| `src/workflows/ralph/graph.ts` | 141-178 | Worker node — no `in_progress` intermediate status set |

---

### Issue 5: Streaming Delay After TODO Completion

#### 5.1 The Final Summary Message

The "⣿ Composed for X · ↓ Y tokens" line is rendered by `CompletionSummary` (`chat.tsx:1114-1140`). It uses `SPINNER_COMPLETE` (`⣿` U+28FF) from `icons.ts:62`, formats duration via `formatCompletionDuration()` (`chat.tsx:1095-1103`), and tokens via `formatTokenCount()` (`chat.tsx:1019-1027`). The verb is deterministic: `"Reasoned"` when `thinkingMs >= 1000`, else `"Composed"`.

#### 5.2 Visibility Gate

`shouldShowCompletionSummary()` at `loading-state.ts:69-77` requires ALL of:
- `!message.streaming` — message must not be in streaming state
- `!hasActiveBackgroundAgents` — no background agents still running
- `message.durationMs != null` — duration must be stamped
- `message.durationMs >= 1000` — minimum 1 second duration

The summary cannot appear until all four conditions are met.

#### 5.3 Three Stream Completion Signals

The system has three distinct completion signals depending on the SDK adapter:

| Signal | Adapter | Trigger |
|---|---|---|
| `stream.text.complete` | Claude, Sub-agent | `for await` loop over `session.stream()` finishes |
| `stream.session.idle` | OpenCode, Copilot | SDK emits `session.idle` event |
| Deferred completion | All (when agents/tools active) | `pendingCompleteRef` resolved via `useEffect` |

**Claude/Sub-agent path**: `publishTextComplete()` → bus → BatchDispatcher (≤16ms) → StreamPipelineConsumer → `text-complete` StreamPartEvent → `handleStreamComplete()` at `chat.tsx:2692`.

**OpenCode/Copilot path**: SDK `session.idle` → bus → direct `useBusSubscription` at `chat.tsx:2754-2761` → `batchDispatcher.flush()` → `handleStreamComplete()`.

**Copilot deferred finalization**: When `message.complete` has `toolRequests`, `stream.text.complete` is intentionally NOT emitted (`copilot-adapter.ts:523-544`). Finalization deferred to `session.idle`.

#### 5.4 `handleStreamComplete` — Three Code Paths

Located at `chat.tsx:2466-2630`:

**Path 1 — Interrupt** (lines 2480-2513): Sets `streaming: false`, stamps `durationMs`/`outputTokens`/`thinkingMs`, calls `stopSharedStreamState()`.

**Path 2 — Deferred** (lines 2516-2556): **PRIMARY DELAY SOURCE**. If `hasActiveForegroundAgents(parallelAgentsRef.current)` or `hasRunningToolRef.current` is true:
1. Stores a `deferredComplete` closure in `pendingCompleteRef.current`
2. Sets a **30-second safety timeout** (`chat.tsx:2555`)
3. Returns early — message stays `streaming: true`
4. Resolution chain: `stream.agent.complete` → 16ms batch → React state update → re-render → `useEffect` (line 3268) → `shouldFinalizeDeferredStream()` → `setTimeout(…, 0)` → `pendingComplete()`

**Path 3 — Normal** (lines 2559-2612): Happy path when no agents/tools active. Calculates `durationMs = Date.now() - streamingStartRef.current`, stamps metadata onto message, calls `stopSharedStreamState()`.

#### 5.5 Identified Sources of Delay

**Source A: Deferred completion with active foreground agents** (`chat.tsx:2516-2556`)
When `handleStreamComplete()` fires while sub-agents are still "running" in React state, completion is deferred. The resolution chain involves:
1. `stream.agent.complete` event published to bus
2. ≤16ms batch dispatch window
3. React state update for `parallelAgents`
4. React re-render
5. `useEffect` dependency re-evaluation (line 3268)
6. `setTimeout(…, 0)` microtask delay
7. `handleStreamComplete()` re-entry
8. Another `setMessagesWindowed` call
9. Another React re-render
10. `shouldShowCompletionSummary()` evaluated

This chain adds **tens to hundreds of milliseconds** through React batching. The 30-second safety timeout is a worst-case fallback.

**Source B: SDK `session.idle` timing** (adapter-specific)
For OpenCode and Copilot adapters, the `session.idle` event is emitted by the SDK after all tool-use loops complete. The delay between the last SDK action and `session.idle` is **SDK-internal** and outside this codebase's control. If the SDK takes seconds to signal idle, the UI shows the spinner for that entire duration.

**Source C: BatchDispatcher 16ms flush window** (`batch-dispatcher.ts:20`)
For the Claude adapter path, `stream.text.complete` goes through `enqueue → scheduleFlush → 16ms timer → flush → consumer`. Maximum **16ms** delay.

**Source D: File I/O in graph execution loop** (`executor.ts:301-306`)
`await options.saveTasksToSession(...)` performs `atomicWrite()` (temp file write + rename) in the critical path of each graph step. This occurs **before** the `for await` loop completes and `setStreaming(false)` is called. Multiple task updates compound this.

**Source E: React state update batching**
Finalization at `chat.tsx:2585-2605` calls `setMessagesWindowed()` inside `setParallelAgents()`. React may batch state updates, meaning `shouldShowCompletionSummary()` may not see `streaming: false` + `durationMs` + cleared agents until a subsequent render cycle.

**Source F: `shouldShowMessageLoadingIndicator` task progress check** (`loading-state.ts:35-55`)
The loading indicator checks `isTaskProgressComplete(taskItems)`. If task progress items haven't been fully updated in the message state, the loading indicator stays visible longer, blocking the transition to the completion summary.

#### 5.6 Data Flow: Stream End → Summary Rendered

```
SDK Stream Ends
    │
    ├─[Claude/SubAgent] for-await loop finishes
    │   └─ publishTextComplete() → bus.publish("stream.text.complete")
    │       └─ BatchDispatcher.enqueue() → ≤16ms flush
    │           └─ StreamPipelineConsumer → "text-complete" StreamPartEvent
    │               └─ chat.tsx useStreamConsumer (line 2666-2693)
    │                   └─ text reconciliation → handleStreamComplete()
    │
    ├─[OpenCode/Copilot] SDK emits session.idle
    │   └─ bus.publish("stream.session.idle")
    │       └─ useBusSubscription (line 2754) [DIRECT, not batched]
    │           └─ batchDispatcher.flush() → handleStreamComplete()
    │
    └─ handleStreamComplete()
        │
        ├─[Deferred] hasActiveForegroundAgents || hasRunningTool
        │   └─ Store closure in pendingCompleteRef
        │       └─ Wait for agents/tools to finish
        │           └─ useEffect (line 3268) re-evaluates
        │               └─ shouldFinalizeDeferredStream() = true
        │                   └─ setTimeout(pendingComplete, 0)
        │                       └─ handleStreamComplete() [re-entry]
        │
        └─[Normal]
            ├─ durationMs = Date.now() - streamingStartRef.current
            ├─ finalMeta = streamingMetaRef.current
            ├─ setMessagesWindowed: stamp {streaming: false, durationMs, ...}
            ├─ stopSharedStreamState()
            └─ React re-render
                └─ shouldShowCompletionSummary() = true
                    └─ <CompletionSummary /> renders "⣿ Composed for X · ↓ Y tokens"
```

#### 5.7 Spinner-to-Summary Transition

`LoadingIndicator` (`chat.tsx:1030-1078`) and `CompletionSummary` (`chat.tsx:1114-1140`) are **mutually exclusive** by design (`chat.tsx:1536-1556`):
- `shouldShowMessageLoadingIndicator()` returns `true` while `streaming`, or while agents/tools are active
- `shouldShowCompletionSummary()` returns `true` only when `!streaming && !hasActiveBackgroundAgents && durationMs >= 1000`

The gap between spinner disappearing and summary appearing is the time it takes for:
1. `streaming` to flip to `false` in the message
2. `durationMs` to be stamped on the message
3. `hasActiveBackgroundAgents` to evaluate to `false`
4. React to re-render with the updated state

#### 5.8 Key Code References

| File | Lines | Function |
|---|---|---|
| `src/ui/chat.tsx` | 1114-1140 | `CompletionSummary` — renders "⣿ Composed for X · ↓ Y tokens" |
| `src/ui/chat.tsx` | 1095-1103 | `formatCompletionDuration()` — ms → human duration |
| `src/ui/chat.tsx` | 1019-1027 | `formatTokenCount()` — token count formatting |
| `src/ui/chat.tsx` | 1030-1078 | `LoadingIndicator` — braille spinner during streaming |
| `src/ui/chat.tsx` | 1536-1556 | Spinner ↔ CompletionSummary mutual exclusion render |
| `src/ui/chat.tsx` | 2466-2630 | `handleStreamComplete()` — main finalization function |
| `src/ui/chat.tsx` | 2516-2556 | Deferred completion path (30s safety timeout) |
| `src/ui/chat.tsx` | 2585-2605 | Normal path — stamps durationMs, outputTokens, thinkingMs |
| `src/ui/chat.tsx` | 2754-2761 | `stream.session.idle` subscription — fallback finalization |
| `src/ui/chat.tsx` | 3268-3374 | `useEffect` — deferred completion resolution |
| `src/ui/chat.tsx` | 2123-2159 | `stopSharedStreamState()` — clears all streaming refs |
| `src/ui/utils/loading-state.ts` | 35-55 | `shouldShowMessageLoadingIndicator()` |
| `src/ui/utils/loading-state.ts` | 69-77 | `shouldShowCompletionSummary()` — visibility gate |
| `src/ui/parts/guards.ts` | 42-47 | `shouldFinalizeDeferredStream()` — checks agents/tools done |
| `src/events/batch-dispatcher.ts` | 20, 183-194 | 16ms flush interval, `scheduleFlush()` |
| `src/events/adapters/copilot-adapter.ts` | 523-544 | Deferred text.complete when tool requests present |
| `src/events/adapters/opencode-adapter.ts` | 730-751 | `session.idle` → `stream.session.idle` |
| `src/events/consumers/stream-pipeline-consumer.ts` | 178-181 | `stream.text.complete` → `text-complete` part |
| `src/ui/utils/stream-continuation.ts` | 39, 139-145 | 50ms queued message dispatch delay |
| `src/workflows/executor.ts` | 301-306 | `await saveTasksToSession()` — file I/O in graph loop |
| `src/ui/constants/icons.ts` | 51-62 | `SPINNER_FRAMES`, `SPINNER_COMPLETE` |

---

## Open Questions

1. **Issue 1 — Is the `useBusSubscription` for `stream.agent.update` actually being called?** The `chat.tsx` handler at lines 2882-2895 directly subscribes to the bus, but it's unclear whether this subscription is properly registered before sub-agent events start flowing. If the component mounts after the first `stream.agent.update`, early events are lost.

2. **Issue 1 — Does event coalescing cause lost updates?** The coalescing window is ~16ms. If `stream.agent.update` events arrive and are coalesced before the consumer processes them, only the last update per agent survives. This is normally fine (we want the latest count), but if the subscription isn't yet active, all coalesced events are lost.

3. **Issue 1 — Is the `CorrelationService` correctly registering sub-agents?** Sub-agents spawned by the workflow executor are registered via `correlation.registerSubagent()`. If this registration happens after tool events start flowing, tool events may be filtered as "unowned" by `isOwnedEvent()`.

4. **Issue 2 — Is the reported behavior ("code review runs after each task") actually observed?** The graph topology shows code review runs once after the loop. If users observe repeated code reviews, it may be caused by a different mechanism (e.g., workflow restart, or the fixer triggering additional review cycles — though this is not present in the current graph).

5. **Issue 3 — What is the desired behavior for task status updates when running in parallel?** Currently, the worker marks ALL `currentTasks` as completed/error based on a single spawn result. With parallel execution, each task's status would need to be independently tracked based on its own spawn result.

6. **Issue 3 — How should the loop iteration counter work with parallel tasks?** Currently, `iteration` increments by 1 per loop pass, processing 1 task. With parallel execution, should `iteration` increment by 1 per batch of parallel tasks, or by the number of tasks processed?

7. **Issue 3 — Should parallel task execution use the graph-level `parallelNode` construct, or should it be implemented within the worker node using `spawnSubagentParallel`?** The graph engine's `parallelNode` still executes branches sequentially. True concurrency requires using `ctx.config.runtime.spawnSubagentParallel` within the worker node.

8. **Issue 4 — Does the Ralph worker node need to explicitly set task status to `"in_progress"` before spawning?** Currently, the worker node goes directly from `"pending"` → `"completed"`/`"error"` without an intermediate `"in_progress"` step. The blinker only activates for `"in_progress"` tasks. If the sub-agent sets this status via TodoWrite during execution, the blinker works; otherwise, actively worked-on tasks appear as `"pending"` (static `○`) until they jump to `"completed"` (static `✓`).

9. **Issue 5 — Is the delay primarily caused by deferred completion (active foreground agents), or by SDK `session.idle` latency?** The two most likely sources are: (a) sub-agents still showing as "running" in React state when `handleStreamComplete()` fires (causing deferred path with multi-step React resolution), and (b) the SDK not emitting `session.idle` promptly. Instrumentation/logging at `handleStreamComplete()` entry and at the deferred resolution `useEffect` would disambiguate.

10. **Issue 5 — Does `shouldShowCompletionSummary`'s `hasActiveBackgroundAgents` check cause an additional delay?** The `hasActiveBackgroundAgents` check uses **baked** `message.parallelAgents` from finalization time. If background agents were stamped with `status: "background"` at finalization, the summary is blocked until those agents complete or are cleaned up.

11. **Issue 5 — Could `saveTasksToSession` file I/O in the graph loop contribute to delay at scale?** Each graph step performs `await atomicWrite()` if tasks exist. With many tasks, the cumulative file I/O time between the last node completing and the graph loop exiting could be measurable.
