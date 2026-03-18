---
date: 2026-03-18 03:34:54 UTC
researcher: GitHub Copilot
git_commit: f56f707e1f8582f3e76bedafb9ce060b1bf7a2fe
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Ralph Workflow Eager Sub-Agent Dispatch — Current Batch Mechanism and Requirements for Eager (As-Soon-As-Unblocked) Dispatch"
tags: [research, ralph, dispatch, dag, parallel, eager, batch, workflow, subagent]
status: complete
last_updated: 2026-03-18
last_updated_by: GitHub Copilot
---

# Research: Ralph Workflow Eager Sub-Agent Dispatch

## Research Question

Document the current Ralph workflow sub-agent dispatch mechanism — specifically how tasks are grouped into batches, how DAG dependencies are resolved, and how/when sub-agents are spawned. Map the complete dispatch lifecycle from task decomposition through execution, identifying the exact code paths that control batch formation and dispatch timing, so we can understand what needs to change to support eager (as-soon-as-unblocked) dispatch instead of batch-based dispatch.

## Summary

The Ralph workflow currently uses a **loop-based batch dispatch** pattern. In each iteration of the worker loop, ALL unblocked ("ready") tasks are collected, dispatched simultaneously via `spawnSubagentParallel` (which uses `Promise.allSettled`), and the system **waits for the entire batch to complete** before checking for newly-unblocked tasks. This creates a head-of-line blocking problem: if a fast task completes and unblocks downstream tasks, those downstream tasks cannot start until every other task in the batch finishes.

**Critical finding**: The infrastructure for eager dispatch already partially exists. The `spawnSubagentParallel` contract already includes an `onAgentComplete` callback parameter that fires per-agent as each completes. The TUI-side implementation already invokes this callback. However, Ralph's `executeWorkerNode` does **not** use this callback — it simply awaits the full batch result.

## Detailed Findings

### 1. Current Dispatch Architecture: The Worker Loop

The Ralph workflow is a three-phase compiled graph:

```
planner (subagent) → parse-tasks (tool)
    ↓
┌─ LOOP ─────────────────────────────────────────────┐
│  select-ready-tasks (tool) → getReadyTasks(tasks)  │
│      ↓                                             │
│  worker (raw NodeDef) → spawnSubagentParallel(ALL) │
│      ↓                                             │
│  loop_check → exit if all done/error/max iters     │
└────────────────────────────────────────────────────┘
    ↓
reviewer (subagent) → conditional fixer (subagent)
```

**Source**: `src/services/workflows/ralph/graph/index.ts:334-451`

The loop body consists of two nodes:
1. **`select-ready-tasks`** (tool node, line 364-374): Calls `getReadyTasks(state.tasks)` and stores the result in `state.currentTasks`
2. **`worker`** (raw `NodeDefinition`, line 377-386): Calls `executeWorkerNode()` which dispatches ALL `state.currentTasks` via `spawnSubagentParallel`

The loop is constructed via the `.loop()` DSL (line 362-396) which generates `loop_start` and `loop_check` decision nodes with conditional edges.

### 2. Batch Formation: `getReadyTasks()`

**Source**: `src/services/workflows/ralph/graph/task-helpers.ts:87-103`

```typescript
export function getReadyTasks(tasks: TaskItem[]): TaskItem[] {
  const completedIds = new Set(
    tasks
      .filter((t) => t.status === "completed")
      .map((t) => t.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => id.trim().toLowerCase().replace(/^#/, ""))
  );

  return tasks.filter((task) => {
    if (task.status !== "pending") return false;
    const deps = (task.blockedBy ?? [])
      .map((d) => d.trim().toLowerCase().replace(/^#/, ""))
      .filter((d) => d.length > 0);
    return deps.every((d) => completedIds.has(d));
  });
}
```

A task is "ready" when:
- Its `status === "pending"`
- ALL entries in its `blockedBy` array correspond to tasks with `status === "completed"`

ID normalization: trimmed, lowercased, leading `#` stripped.

### 3. Batch Dispatch: `executeWorkerNode()`

**Source**: `src/services/workflows/ralph/graph/index.ts:54-206`

The dispatch lifecycle within a single worker node execution:

1. **Read ready tasks** (line 60): `const ready = state.currentTasks` — set by the preceding `select-ready-tasks` node
2. **Mark as in_progress** (lines 73-77): All ready tasks get `status: "in_progress"` in a mapped copy
3. **Build spawn configs** (lines 82-93): One `SubagentSpawnOptions` per ready task, with stable agent IDs (`worker-{taskId}`) and deduplication for duplicate task IDs
4. **Bind provider identities** (lines 104-115): Wire canonical task IDs to provider-specific subagent IDs via `TaskIdentityService`
5. **Notify status change** (lines 118-131): Fire `notifyTaskStatusChange` event with `"in_progress"` status
6. **Dispatch ALL concurrently** (line 134):
   ```typescript
   const results = await spawnSubagentParallel(spawnConfigs, ralphCtx.abortSignal);
   ```
   **This is the blocking call** — execution pauses here until ALL agents complete.
7. **Map results back** (lines 154-198): Each result is matched to its task via `taskIdentity.resolveCanonicalTaskId()` and marked `"completed"` or `"error"`
8. **Return state update** (lines 200-205): Updated tasks + incremented iteration counter

### 4. The Batch Problem (Head-of-Line Blocking)

Consider this DAG:
```
A (5 sec) ──→ C (10 sec)
B (60 sec) ──→ D (10 sec)
```

**Current batch behavior:**
| Time | Event |
|------|-------|
| 0s   | Batch 1: dispatch A, B (both ready) |
| 5s   | A completes → C is now unblocked, but CANNOT start |
| 60s  | B completes → Batch 1 finishes |
| 60s  | Loop iterates: select-ready-tasks finds C, D |
| 60s  | Batch 2: dispatch C, D |
| 70s  | C, D complete |
| **Total: 70 seconds** |

**Eager dispatch behavior:**
| Time | Event |
|------|-------|
| 0s   | Dispatch A, B (both ready) |
| 5s   | A completes → C is now ready → dispatch C immediately |
| 15s  | C completes |
| 60s  | B completes → D is now ready → dispatch D immediately |
| 70s  | D completes |
| **Total: 70 seconds** (same for this simple case) |

But with deeper dependency chains, the savings compound:
```
A (5s) → C (5s) → E (5s) → G (5s)
B (60s) → D (5s) → F (5s) → H (5s)
```

**Batch**: 60s + 5s + 5s + 5s = 75s (4 waves)
**Eager**: 60s + 5s + 5s + 5s = 75s for B's chain, but A→C→E→G completes at 20s — the long pole is B's chain regardless. However, if G depends on both E and D, batch dispatch would be significantly slower because E can't start until B's wave completes.

### 5. Existing Infrastructure for Eager Dispatch

#### 5.1 The `onAgentComplete` Callback (Already Exists!)

**Source**: `src/services/workflows/graph/contracts/runtime.ts:112`

```typescript
spawnSubagentParallel?: (
  agents: SubagentSpawnOptions[],
  abortSignal?: AbortSignal,
  onAgentComplete?: (result: SubagentStreamResult) => void  // ← THIS
) => Promise<SubagentStreamResult[]>
```

The third parameter is a **per-agent completion callback** that fires each time an individual agent finishes, before the overall Promise resolves.

**TUI implementation** (`src/state/chat/command/context-factory.ts:247`):
```typescript
// Inside executeWithRetry(), after each agent completes:
onAgentComplete?.(result);
```

**Executor passthrough** (`src/services/workflows/runtime/executor/index.ts:179`):
```typescript
spawnSubagentParallel: async (agents, abortSignal, onAgentComplete) => {
    // ... timeout injection ...
    const results = await spawnFn(agents, signal, onAgentComplete);  // forwarded
    return results;
}
```

**Ralph's usage** (`src/services/workflows/ralph/graph/index.ts:134`):
```typescript
const results = await spawnSubagentParallel(spawnConfigs, ralphCtx.abortSignal);
// ← onAgentComplete NOT passed!
```

#### 5.2 Promise.allSettled Semantics

The TUI implementation uses `Promise.allSettled` (`context-factory.ts:252`), meaning individual agent failures don't crash the batch. This is compatible with eager dispatch — failed agents can be handled without disrupting others.

#### 5.3 Circuit Breaker

When any agent exhausts its stale retries, the entire batch's abort controller fires (`context-factory.ts:238-244`). This safety mechanism would need to be considered in an eager dispatch design.

### 6. Graph Engine Execution Model

**Source**: `src/services/workflows/graph/runtime/execution-ops.ts:256-497`

The graph engine uses a **queue-based BFS traversal**:
```
nodeQueue = [startNode]
while (nodeQueue.length > 0):
    node = nodeQueue.shift()
    result = executeNodeWithRetry(node)
    state = mergeState(state, result)
    nextNodes = getNextExecutableNodes(node, state)
    nodeQueue.push(...nextNodes)
```

Key constraint: **The graph engine executes one node at a time** from the queue. The worker node is a single graph node that internally dispatches multiple subagents. The graph engine doesn't know about or manage the sub-agent parallelism — that's all internal to the worker node.

The loop DSL generates structural nodes:
- `loop_start_N`: Initializes iteration counter
- `loop_check_N`: Increments counter, evaluates exit condition, routes to loop body or next node

### 7. Loop Exit Conditions

**Source**: `src/services/workflows/ralph/graph/index.ts:389-395`

```typescript
until: (state) =>
  state.tasks.length === 0 ||
  state.tasks.every((t) => t.status === "completed" || t.status === "error") ||
  state.iteration >= state.maxIterations ||
  !hasActionableTasks(state.tasks),
```

`hasActionableTasks` (`task-helpers.ts:105-111`) returns `true` if any task is `"in_progress"` or is a pending task that would be returned by `getReadyTasks`.

### 8. Test Coverage for Dispatch Behavior

**Source**: `tests/services/workflows/ralph/graph.parallel-dispatch-core.suite.ts`

Five tests verify batch dispatch behavior. All assume **synchronous all-at-once batch dispatch**:

1. **"dispatches all independent tasks in a single spawnSubagentParallel call"** — Verifies exactly 1 worker batch containing all 3 independent tasks
2. **"returns error when spawnSubagentParallel is not available"** — Validates runtime contract enforcement
3. **"maps results independently — failed tasks get error, successful get completed"** — Individual failure isolation
4. **"assigns unique worker agent IDs when task IDs are duplicated"** — Agent ID deduplication
5. **"increments iteration by 1 per batch, not per task"** — Verifies `state.iteration` increments once per batch

**Source**: `tests/services/workflows/ralph/graph.parallel-dispatch-status.suite.ts`

Three tests verify status tracking:
1. **"calls notifyTaskStatusChange with in_progress before spawning"** — Status event ordering
2. **"attaches task result envelope with canonical identity metadata"** — Result envelope structure
3. **"worker prompt includes completed task context from previous batches"** — Cross-batch context (dependency chain test: `#2` blocked by `#1`)

**Source**: `tests/services/workflows/ralph/graph.flow.suite.ts`

Six tests verify end-to-end flow lifecycle. The dependency test verifies `#1` executes before `#2` when `#2.blockedBy = ["#1"]`.

**No test verifies or expects eager/incremental dispatch behavior.** All mock `spawnSubagentParallel` implementations resolve all promises synchronously.

## Code References

### Core Dispatch Path
- `src/services/workflows/ralph/graph/index.ts:54-206` — `executeWorkerNode()`: batch dispatch entry point
- `src/services/workflows/ralph/graph/index.ts:134` — **The blocking `await spawnSubagentParallel()`** call
- `src/services/workflows/ralph/graph/task-helpers.ts:87-103` — `getReadyTasks()`: DAG dependency resolution
- `src/services/workflows/ralph/graph/task-helpers.ts:105-111` — `hasActionableTasks()`: loop exit condition helper

### Graph Construction
- `src/services/workflows/ralph/graph/index.ts:334-451` — `createRalphWorkflow()`: graph definition
- `src/services/workflows/ralph/graph/index.ts:362-396` — Worker loop construction (`.loop()` DSL)

### Infrastructure (Already Supports Eager Dispatch)
- `src/services/workflows/graph/contracts/runtime.ts:112` — `onAgentComplete` callback in `spawnSubagentParallel` type
- `src/state/chat/command/context-factory.ts:247` — TUI calls `onAgentComplete?.(result)` per-agent
- `src/services/workflows/runtime/executor/index.ts:169-183` — Executor forwards `onAgentComplete`

### Loop DSL
- `src/services/workflows/graph/authoring/iteration-dsl.ts:46-132` — `addLoopSegment()`: generates loop nodes
- `src/services/workflows/graph/authoring/builder.ts:248-254` — `GraphBuilder.loop()`

### Graph Engine
- `src/services/workflows/graph/runtime/execution-ops.ts:256-497` — `executeGraphStreamSteps()`: BFS node traversal
- `src/services/workflows/graph/runtime/compiled.ts:165-321` — `GraphExecutor` class

### State & Types
- `src/services/workflows/ralph/types.ts` — `RalphWorkflowContext`, `RalphRuntimeDependencies`
- `src/services/workflows/ralph/state.ts` — `RalphWorkflowState`, annotation reducers
- `src/services/workflows/runtime-contracts.ts` — `WorkflowRuntimeTask`, task status types

### Tests
- `tests/services/workflows/ralph/graph.parallel-dispatch-core.suite.ts` — Batch dispatch tests (5 tests)
- `tests/services/workflows/ralph/graph.parallel-dispatch-status.suite.ts` — Status tracking tests (3 tests)
- `tests/services/workflows/ralph/graph.flow.suite.ts` — Flow lifecycle tests (6 tests)
- `tests/services/workflows/ralph/graph.fixtures.ts` — Mock helpers and fixtures

## Architecture Documentation

### Dispatch Delegation Chain

```
Ralph Worker Node (executeWorkerNode)
    ↓ spawnSubagentParallel(configs, abortSignal)
Executor Shim (runtime/executor/index.ts:169-183)
    ↓ spawnFn(agents, signal, onAgentComplete)  // adds stale timeout
CommandContext.spawnSubagentParallel
    ↓
TUI spawnParallelSubagents (context-factory.ts:66-278)
    ↓ Promise.allSettled(agents.map(executeWithRetry))
Per-Agent: executeWithRetry → spawnOne → session.stream()
    ↓ onAgentComplete?.(result)  // fires per-agent
```

### State Flow Through Worker Loop Iteration

```
Loop Start
    ↓
select-ready-tasks:
    Input:  state.tasks (all tasks)
    Output: state.currentTasks = getReadyTasks(tasks)  // only ready ones
    ↓
worker:
    Input:  state.currentTasks (ready tasks from above)
    Action: Mark all as in_progress → notify → spawnSubagentParallel(ALL)
            → await ALL results → map to completed/error
    Output: state.tasks (updated statuses), state.iteration + 1
    ↓
loop_check:
    Evaluates: until(state) → exit if all done/error/maxIters
    Continue:  → back to select-ready-tasks
```

### Key Architectural Constraints

1. **Graph engine is single-node sequential**: The BFS queue processes one graph node at a time. Parallelism is internal to nodes, not managed by the engine.
2. **Worker node owns all dispatch logic**: The worker node is a raw `NodeDefinition`, not using the generic `subagentNode` or `parallelSubagentNode` factories, giving it full control over dispatch strategy.
3. **State is immutable between nodes**: `mergeState()` creates new state objects. Within a node, state can be freely mutated (the worker builds intermediate arrays).
4. **Iteration counter is per-batch**: `state.iteration` increments by 1 per worker node execution, regardless of how many tasks were dispatched.

## Historical Context (from research/)

### Evolution of Dispatch Models
The Ralph dispatch mechanism went through three architectural phases:

1. **Serial dispatch** (pre-2026-02-15): A `for` loop spawning one worker at a time via `context.spawnSubagent()`. No DAG enforcement.
2. **DAG orchestrator** (2026-02-15): `runDAGOrchestrator()` with wave-based batch dispatch via `bridge.spawnParallel()`. Was implemented but later removed.
3. **Current graph-based loop** (2026-02-25+): The current architecture with `select-ready-tasks` → `worker` → `loop_check`, dispatching all ready tasks per iteration via `spawnSubagentParallel`.

### Relevant Research Documents
- `research/docs/2026-02-15-ralph-dag-orchestration-implementation.md` — Original DAG orchestrator research; identified the `onAgentComplete` gap and `Promise.race()` alternative for eager dispatch
- `research/docs/2026-02-15-ralph-dag-orchestration-blockedby.md` — DAG dependency analysis; confirmed `blockedBy` was display-only at the time
- `research/docs/2026-02-15-ralph-loop-manual-worker-dispatch.md` — Manual dispatch research; proposed removing `runDAGOrchestrator()` (the approach that was ultimately taken)
- `research/docs/2026-02-25-ralph-workflow-implementation.md` — Current graph-based implementation documentation
- `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md` — Graph execution engine technical reference

### Relevant Specs
- `specs/ralph-dag-orchestration.md` — DAG orchestrator TDD; Section 9 explicitly called for `Promise.race()` for eager dispatch — the same problem we're solving now
- `specs/ralph-loop-manual-worker-dispatch.md` — Manual dispatch TDD; proposed removing the orchestrator

## Open Questions

1. **Scope of eager dispatch**: Should newly-unblocked tasks be dispatched within the same worker node execution (via `onAgentComplete` callback + dynamic `spawnSubagentParallel` calls), or should the loop structure itself be modified to support partial-batch processing?

2. **Iteration counter semantics**: Currently `state.iteration` increments once per batch. With eager dispatch, what constitutes an "iteration"? Each individual dispatch? Each time we return to `select-ready-tasks`? This affects the `maxIterations` safety limit.

3. **State update timing**: Currently, task statuses are updated atomically when the entire batch completes. With eager dispatch, should `notifyTaskStatusChange` fire per-task as each completes? This affects the UI task list panel responsiveness.

4. **Concurrency limits**: Should there be a cap on the number of simultaneously-running subagents? The current system has no limit (all ready tasks dispatch at once). With eager dispatch continuously spawning new tasks, this could lead to resource exhaustion with large DAGs.

5. **Error propagation**: If a task fails and its dependents cannot run, should the eager dispatcher immediately skip/block those dependents, or wait until the next readiness check?

6. **Test refactoring**: All existing parallel dispatch tests assume batch semantics. They will need significant updates to verify eager dispatch behavior (e.g., verifying multiple `spawnSubagentParallel` calls within a single worker node execution, or verifying dispatch timing relative to individual completions).
