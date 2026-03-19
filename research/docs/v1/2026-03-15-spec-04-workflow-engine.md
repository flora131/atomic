---
date: 2026-03-15 18:32:54 UTC
researcher: Claude Opus 4.6
git_commit: d3f22e2b5bf791dcc57580e001ac279c85390fce
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Spec 04: Workflow Engine - Graph execution, Ralph, custom workflows"
tags: [spec, workflow, graph-engine, ralph, v2]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude Opus 4.6
parent: 2026-03-15-atomic-v2-rebuild-spec-index.md
---

# Spec 04: Workflow Engine

## Current State

### Overview (8,725 lines)

The workflow system is a LangGraph-inspired graph execution engine with:

```
services/workflows/                    8,725 lines
├── graph/                             (core engine)
│   ├── authoring/                     (GraphBuilder fluent API)
│   │   ├── builder.ts                 (builder pattern)
│   │   ├── node-factories.ts          (agent, tool, decision, etc.)
│   │   ├── node-adapters.ts           (adapter pattern)
│   │   ├── types.ts                   (authoring types)
│   │   ├── conditional-dsl.ts         (conditional branching)
│   │   └── iteration-dsl.ts           (looping constructs)
│   ├── contracts/
│   │   ├── core.ts                    (BaseState, NodeType, Checkpointer, etc.)
│   │   ├── runtime.ts                 (NodeDefinition, CompiledGraph, GraphConfig, etc.)
│   │   ├── guards.ts                  (type guards)
│   │   └── constants.ts               (constants)
│   ├── nodes/                         (built-in node types)
│   ├── persistence/                   (state persistence)
│   └── runtime/                       (graph execution)
├── ralph/                             (built-in workflow)
│   ├── definition.ts                  (WorkflowDefinition metadata)
│   ├── graph.ts                       (graph construction)
│   ├── state.ts                       (RalphWorkflowState)
│   ├── types.ts                       (RalphWorkflowContext, RalphCommandState)
│   ├── prompts.ts                     (LLM prompts)
│   └── graph/
│       ├── index.ts                   (graph node implementations)
│       └── task-helpers.ts            (task management helpers)
├── runtime/
│   ├── executor.ts                    (workflow execution entry)
│   └── executor/
│       ├── index.ts                   (executor implementation)
│       ├── graph-helpers.ts           (execution helpers)
│       ├── session-runtime.ts         (session management during execution)
│       └── task-persistence.ts        (task state persistence)
├── helpers/                           (shared workflow helpers)
├── runtime-contracts.ts               (WorkflowRuntimeTask, feature flags, 402 lines)
├── workflow-types.ts                  (WorkflowDefinition, WorkflowMetadata)
└── runtime-parity-observability.ts    (observability)
```

### Graph Engine Contracts

**Core Types** (`graph/contracts/core.ts`):
- `BaseState` - Execution state with `executionId`, `lastUpdated`, `outputs`
- `NodeType` - 7 node types: agent, tool, decision, wait, ask_user, subgraph, parallel
- `Checkpointer<TState>` - Save/load/list/delete execution state
- `RetryConfig` - Retry with exponential backoff
- `ErrorAction` - retry, skip, abort, goto
- `Signal` - context_window_warning, checkpoint, human_input_required, debug_report_generated

**Runtime Types** (`graph/contracts/runtime.ts`):
- `NodeDefinition<TState>` - Node with id, type, execute function, schemas, retry, error handling
- `ExecutionContext<TState>` - State + config + errors + abort signal
- `CompiledGraph<TState>` - Nodes map + edges + start/end nodes + config
- `GraphConfig<TState>` - Checkpointer, concurrency, timeout, progress callback, model
- `GraphRuntimeDependencies` - clientProvider, workflowResolver, spawnSubagent, spawnSubagentParallel, taskIdentity, featureFlags, subagentRegistry, notifyTaskStatusChange
- `SubagentSpawnOptions` / `SubagentStreamResult` - Subagent lifecycle
- `WorkflowToolContext` - Context for workflow tools

**Builder API** (`graph/authoring/builder.ts`):
- Fluent API: `new GraphBuilder().addNode(...).addEdge(...).addConditionalEdge(...).compile()`
- Node factories for agent, tool, decision, wait, ask_user
- Conditional and iteration DSLs

### Ralph Workflow

Ralph is the only built-in workflow. It implements a plan-implement-review loop:

```
planner → parse-tasks → select-ready-tasks → worker → reviewer → (iterate or complete)
                                                 ↓
                                          prepare-fix-tasks → fixer
```

**Ralph-specific constructs**:
- `RalphWorkflowState` extends `BaseState` with tasks, iteration counters, prompts
- `RalphWorkflowContext` extracts runtime deps from generic `ExecutionContext`
- `RalphCommandState` for UI display (currentNode, iteration, featureProgress, etc.)
- `ralphNodeDescriptions` maps node IDs to human-readable phase descriptions

### Workflow Runtime Contracts (`runtime-contracts.ts`, 402 lines)

Extensive Zod-validated task contract:
- `WorkflowRuntimeTask` with id, title, status, blockedBy, identity, taskResult
- `WorkflowRuntimeTaskIdentity` with canonicalId and providerBindings
- `WorkflowRuntimeTaskResultEnvelope` with task_id, tool_name, metadata, status, output
- Normalization functions: `toWorkflowRuntimeTask()`, `toWorkflowRuntimeTasks()`
- Feature flags: `emitTaskStatusEvents`, `persistTaskStatusEvents`, `strictTaskContract`
- Runtime parity observability with counters and histograms

### Issues Documented

1. **Over-Engineering**: The graph engine supports 7 node types, subgraphs, parallel execution, checkpointing, persistence, Zod schemas on nodes, error recovery with 4 actions, and debug report generation - all for a single workflow (Ralph). The engine is ~5,000 lines for one consumer.

2. **Runtime Contracts Complexity**: `runtime-contracts.ts` at 402 lines includes extensive normalization, identity tracking, provider bindings, and parity observability for what is fundamentally a task list with status tracking.

3. **WorkflowDefinition Duality**: Workflows can be defined either declaratively (`graphConfig`) or programmatically (`createGraph()`), but Ralph uses `createGraph()` exclusively. The declarative path may be untested dead code.

4. **Ralph Context Extraction**: `toRalphWorkflowContext()` manually extracts fields from the generic `ExecutionContext`, suggesting the generic context is too broad.

5. **asBaseGraph Cast**: The `asBaseGraph()` function uses `unknown` intermediate cast to widen generics, working around TypeScript's type system rather than with it.

---

## V2 Spec: Workflow Engine

### Design Principle: Right-Sized Engine

Build only what Ralph needs today. Design for extension, not for speculation.

### 1. Minimal Graph Engine

```typescript
// services/workflows/engine/types.ts

/** Workflow state - simple key-value store */
interface WorkflowState {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly outputs: Map<string, unknown>;
  readonly tasks: WorkflowTask[];
}

/** A node in the workflow graph */
interface WorkflowNode {
  readonly id: string;
  readonly name: string;
  execute(ctx: WorkflowContext): Promise<NodeResult>;
}

/** Context passed to every node */
interface WorkflowContext {
  readonly state: WorkflowState;
  readonly abortSignal: AbortSignal;
  readonly spawnAgent: (options: AgentOptions) => Promise<AgentResult>;
  readonly spawnParallel: (agents: AgentOptions[]) => Promise<AgentResult[]>;
  readonly emit: (event: WorkflowEvent) => void;
}

/** Result from a node execution */
interface NodeResult {
  /** State updates to merge */
  stateUpdate?: Record<string, unknown>;
  /** Next node(s) to execute. Omit for default edge. */
  goto?: string | string[];
  /** Tasks to update */
  taskUpdates?: TaskUpdate[];
}

/** Workflow event for UI progress */
type WorkflowEvent =
  | { type: "node.start"; nodeId: string }
  | { type: "node.complete"; nodeId: string }
  | { type: "task.update"; tasks: WorkflowTask[] }
  | { type: "phase.change"; phase: string; description: string };
```

**What's removed vs. current**:
- No `Checkpointer` interface (add when needed)
- No Zod schemas on nodes (validate at input boundary instead)
- No `ErrorAction` union (retry at the node level if needed)
- No `Signal` system (use WorkflowEvent)
- No `subgraph` or `parallel` node types (spawn parallel agents directly)
- No `GraphRuntimeDependencies` (inject via WorkflowContext)
- No `DebugReport` (log errors normally)
- 7 node types → just `WorkflowNode` (one type, no discrimination needed)

### 2. Graph Definition

Replace the fluent builder with a declarative graph definition:

```typescript
// services/workflows/engine/graph.ts

interface WorkflowGraph {
  readonly name: string;
  readonly nodes: WorkflowNode[];
  readonly edges: EdgeDefinition[];
  readonly startNode: string;
}

interface EdgeDefinition {
  from: string;
  to: string | ((state: WorkflowState) => string);
}

/** Create a graph from a definition */
function createGraph(definition: WorkflowGraph): CompiledWorkflow {
  // Validate: all edge targets exist, start node exists, no orphan nodes
  const nodeMap = new Map(definition.nodes.map(n => [n.id, n]));
  for (const edge of definition.edges) {
    if (!nodeMap.has(edge.from)) throw new Error(`Unknown source node: ${edge.from}`);
    if (typeof edge.to === "string" && !nodeMap.has(edge.to)) throw new Error(`Unknown target node: ${edge.to}`);
  }
  if (!nodeMap.has(definition.startNode)) throw new Error(`Unknown start node: ${definition.startNode}`);

  return { nodeMap, edges: definition.edges, startNode: definition.startNode };
}
```

### 3. Executor

A simple loop that runs nodes and follows edges:

```typescript
// services/workflows/engine/executor.ts

async function executeWorkflow(
  graph: CompiledWorkflow,
  initialState: WorkflowState,
  ctx: { abortSignal: AbortSignal; spawnAgent: SpawnFn; emit: EmitFn },
  options?: { maxIterations?: number },
): Promise<WorkflowResult> {
  let state = initialState;
  let currentNode = graph.startNode;
  let iterations = 0;
  const maxIterations = options?.maxIterations ?? 100;

  while (currentNode && iterations < maxIterations) {
    iterations++;

    const node = graph.nodeMap.get(currentNode);
    if (!node) throw new Error(`Unknown node: ${currentNode}`);

    ctx.emit({ type: "node.start", nodeId: node.id });

    try {
      const result = await node.execute({
        state,
        abortSignal: ctx.abortSignal,
        spawnAgent: ctx.spawnAgent,
        spawnParallel: (agents) => Promise.all(agents.map(a => ctx.spawnAgent(a))),
        emit: ctx.emit,
      });

      // Apply state updates
      if (result.stateUpdate) {
        state = {
          ...state,
          data: { ...state.data, ...result.stateUpdate },
          outputs: new Map([...state.outputs, [node.id, result.stateUpdate]]),
        };
      }

      // Apply task updates
      if (result.taskUpdates) {
        state = { ...state, tasks: applyTaskUpdates(state.tasks, result.taskUpdates) };
        ctx.emit({ type: "task.update", tasks: state.tasks });
      }

      ctx.emit({ type: "node.complete", nodeId: node.id });

      // Determine next node
      if (result.goto) {
        currentNode = typeof result.goto === "string" ? result.goto : result.goto[0];
      } else {
        currentNode = resolveNextNode(graph, currentNode, state);
      }
    } catch (error) {
      if (ctx.abortSignal.aborted) {
        return { success: false, state, error: "aborted" };
      }
      return { success: false, state, error: String(error) };
    }
  }

  return { success: true, state };
}
```

**Target**: ~150 lines for the executor (down from 1,000+ across executor/ directory).

### 4. Ralph Workflow Definition

Ralph uses the engine directly:

```typescript
// services/workflows/ralph/graph.ts

const ralphNodes: WorkflowNode[] = [
  {
    id: "planner",
    name: "Planning",
    async execute(ctx) {
      const result = await ctx.spawnAgent({
        task: buildPlannerPrompt(ctx.state),
        model: "claude-sonnet-4-6",
      });
      const tasks = parseTasks(result.output);
      return { stateUpdate: { plan: result.output }, taskUpdates: tasks.map(t => ({ ...t, status: "pending" })) };
    },
  },
  {
    id: "select-ready",
    name: "Selecting ready tasks",
    async execute(ctx) {
      const ready = ctx.state.tasks.filter(t => t.status === "pending" && !hasBlockedDeps(t, ctx.state.tasks));
      return { stateUpdate: { readyTasks: ready } };
    },
  },
  {
    id: "worker",
    name: "Implementing",
    async execute(ctx) {
      const ready = ctx.state.data.readyTasks as WorkflowTask[];
      const results = await ctx.spawnParallel(
        ready.map(task => ({ task: buildWorkerPrompt(task), model: "claude-sonnet-4-6" })),
      );
      return {
        taskUpdates: ready.map((task, i) => ({
          id: task.id,
          status: results[i].success ? "completed" : "failed",
          result: results[i].output,
        })),
      };
    },
  },
  {
    id: "reviewer",
    name: "Reviewing",
    async execute(ctx) {
      const result = await ctx.spawnAgent({
        task: buildReviewPrompt(ctx.state),
        model: "claude-opus-4-6",
      });
      const fixes = parseReviewFixes(result.output);
      return { stateUpdate: { reviewResult: result.output, fixes } };
    },
  },
  {
    id: "fixer",
    name: "Applying fixes",
    async execute(ctx) {
      const fixes = ctx.state.data.fixes as FixItem[];
      if (!fixes?.length) return { goto: "done" };
      const results = await ctx.spawnParallel(
        fixes.map(fix => ({ task: buildFixPrompt(fix), model: "claude-sonnet-4-6" })),
      );
      return { stateUpdate: { fixResults: results } };
    },
  },
];

const ralphEdges: EdgeDefinition[] = [
  { from: "planner", to: "select-ready" },
  { from: "select-ready", to: "worker" },
  { from: "worker", to: "reviewer" },
  { from: "reviewer", to: (state) => {
    const fixes = state.data.fixes as FixItem[] | undefined;
    if (fixes?.length) return "fixer";
    const remaining = state.tasks.filter(t => t.status === "pending");
    return remaining.length > 0 ? "select-ready" : "done";
  }},
  { from: "fixer", to: "select-ready" },
];

export const ralphWorkflow: WorkflowGraph = {
  name: "ralph",
  nodes: ralphNodes,
  edges: ralphEdges,
  startNode: "planner",
};
```

### 5. Workflow Task Contract

Simplify the 402-line runtime-contracts.ts:

```typescript
// services/workflows/tasks.ts

interface WorkflowTask {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "blocked";
  blockedBy?: string[];
  error?: string;
  result?: string;
}

type TaskUpdate = Partial<WorkflowTask> & { id: string };

function applyTaskUpdates(tasks: WorkflowTask[], updates: TaskUpdate[]): WorkflowTask[] {
  const updateMap = new Map(updates.map(u => [u.id, u]));
  return tasks.map(task => {
    const update = updateMap.get(task.id);
    return update ? { ...task, ...update } : task;
  });
}
```

**What's removed vs. current:**
- No `WorkflowRuntimeTaskIdentity` with canonicalId and providerBindings
- No `WorkflowRuntimeTaskResultEnvelope` with metadata and structural output
- No normalization functions with fallback parsing
- No runtime parity observability (counters, histograms, debug logging)
- No feature flags for task events
- No Zod schema validation on tasks (validate at input boundary)

If identity tracking and provider bindings are needed later, they can be added to this simpler base.

### 6. Workflow Registration

```typescript
// services/workflows/registry.ts

interface WorkflowDefinition {
  name: string;
  description: string;
  aliases?: string[];
  createGraph: () => WorkflowGraph;
  nodeDescriptions?: Record<string, string>;
}

class WorkflowRegistry {
  private workflows = new Map<string, WorkflowDefinition>();

  register(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.name, workflow);
    workflow.aliases?.forEach(a => this.workflows.set(a, workflow));
  }

  get(name: string): WorkflowDefinition | undefined {
    return this.workflows.get(name);
  }

  list(): WorkflowDefinition[] {
    return [...new Set(this.workflows.values())];
  }
}
```

### 7. Custom Workflow Support

Users define workflows as TypeScript files in `.atomic/workflows/`:

```typescript
// .atomic/workflows/my-workflow.ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow({
  name: "my-workflow",
  description: "Custom workflow",
  nodes: [
    { id: "step1", name: "First step", execute: async (ctx) => { /* ... */ } },
    { id: "step2", name: "Second step", execute: async (ctx) => { /* ... */ } },
  ],
  edges: [
    { from: "step1", to: "step2" },
  ],
  startNode: "step1",
});
```

### 8. Module Structure

```
services/workflows/
├── engine/
│   ├── types.ts              # WorkflowNode, WorkflowContext, NodeResult
│   ├── graph.ts              # createGraph(), validation
│   └── executor.ts           # executeWorkflow() loop
├── ralph/
│   ├── graph.ts              # Ralph graph definition
│   ├── prompts.ts            # LLM prompts
│   └── types.ts              # Ralph-specific state
├── tasks.ts                  # WorkflowTask, TaskUpdate
├── registry.ts               # WorkflowRegistry
└── loader.ts                 # Load custom workflows from filesystem
```

**Target**: ~12 files, ~1,500 lines (down from 8,725 lines).

## Code References (Current)

- `src/services/workflows/graph/contracts/core.ts:1-66` - BaseState, NodeType, Checkpointer, etc.
- `src/services/workflows/graph/contracts/runtime.ts:1-218` - Full runtime contracts
- `src/services/workflows/graph/authoring/builder.ts` - GraphBuilder fluent API
- `src/services/workflows/ralph/definition.ts:1-67` - Ralph workflow definition
- `src/services/workflows/ralph/types.ts:1-152` - RalphWorkflowContext, RalphCommandState
- `src/services/workflows/ralph/graph.ts` - Ralph graph construction
- `src/services/workflows/runtime/executor.ts` - Workflow executor entry
- `src/services/workflows/runtime-contracts.ts:1-402` - Runtime task contracts
- `src/services/workflows/workflow-types.ts:1-67` - WorkflowDefinition, WorkflowMetadata

## Related Research

- `research/docs/2026-01-31-graph-execution-pattern-design.md`
- `research/docs/2026-02-25-graph-execution-engine.md`
- `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md`
- `research/docs/2026-02-25-ralph-workflow-implementation.md`
- `research/docs/2026-02-25-workflow-sdk-design.md`
- `research/docs/2026-02-25-workflow-sdk-standardization.md`
- `research/docs/2026-02-25-workflow-sdk-refactor-research.md`
- `research/docs/2026-02-28-workflow-gaps-architecture.md`
- `research/docs/2026-02-28-workflow-issues-research.md`
- `research/docs/2026-02-25-unified-workflow-execution-research.md`
- `research/docs/2026-02-11-workflow-sdk-implementation.md`
