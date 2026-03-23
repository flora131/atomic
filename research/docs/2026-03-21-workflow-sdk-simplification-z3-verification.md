---
date: 2026-03-21 17:52:30 UTC
researcher: Claude Opus 4.6
git_commit: 9b8fe5e0e0e2a75a5178ff7e27ecaab2a0bdac99
branch: lavaman131/feature/workflow-refactor
repository: workflow-refactor
topic: "Workflow SDK simplification to single-file declarative definitions with Z3 formal verification"
tags: [research, codebase, workflow-sdk, z3-solver, graph-builder, ralph, formal-verification, dsl-design, conductor]
status: complete
last_updated: 2026-03-21
last_updated_by: Claude Opus 4.6
---

# Research: Workflow SDK Simplification & Z3 Formal Verification

## Research Question

Document the current workflow SDK architecture to support a redesign toward single-file, declaratively-defined, formally-verifiable workflows. Specifically: (1) current workflow file structure, (2) Ralph workflow as a case study, (3) tool & agent session invocation, (4) control flow mechanisms, (5) Z3 solver TypeScript bindings API, and (6) declarative DSL patterns.

## Summary

The current workflow SDK spans **~65 files** across `services/workflows/` and requires developers to spread a single workflow definition across 7+ files (state, prompts, stages, graph, definition, helpers, conductor-graph). The graph builder uses a fluent API (`graph<S>().start(a).then(b).if(cond).then(c).endif().end().compile()`) that produces a `CompiledGraph<TState>` with nodes, edges, and configuration. The Ralph workflow—the only production workflow—uses a conductor-based execution model where four stages (planner, orchestrator, reviewer, debugger) run sequentially in isolated agent sessions.

The `z3-solver` npm package provides TypeScript bindings for the Z3 theorem prover via WebAssembly. It exposes a high-level API with `Bool`, `Int`, `Solver`, `And`, `Or`, `Not`, `Implies`, `ForAll`, and `Exists` primitives that can encode workflow graph properties as SMT constraints. Key verifiable properties include reachability (all nodes reachable from START), termination (all paths reach END), loop bound proofs (bounded iteration counts), and deadlock-freedom (no stuck states).

A redesign combining a single-file declarative DSL with Z3 compile-time verification is feasible. The existing graph builder's `IfConfig` and `LoopConfig` declarative forms, the `StageDefinition` pattern from the conductor, and the `WorkflowDefinition` registration interface provide clear foundations.

---

## Detailed Findings

### 1. Current Workflow SDK File Structure

The workflow SDK lives in `src/services/workflows/` and is organized into four subsystems:

```
src/services/workflows/
├── graph/                          # Graph authoring & compilation (~30 files)
│   ├── authoring/                  # Builder DSL
│   │   ├── builder.ts              # GraphBuilder class (fluent API)
│   │   ├── conditional-dsl.ts      # if/else/endif branching
│   │   ├── iteration-dsl.ts        # loop and parallel segments
│   │   ├── node-factories.ts       # createNode, createDecisionNode, etc.
│   │   ├── node-adapters.ts        # Builder-to-node adapters
│   │   └── types.ts                # LoopConfig, IfConfig, ConditionalBranch, etc.
│   ├── contracts/                  # Type contracts
│   │   ├── core.ts                 # BaseState, NodeId, NodeType, Edge, etc.
│   │   ├── runtime.ts             # NodeDefinition, ExecutionContext, CompiledGraph
│   │   ├── constants.ts           # DEFAULT_RETRY_CONFIG, thresholds
│   │   └── guards.ts             # Type guard functions
│   ├── nodes/                      # Node type factories
│   │   ├── agent.ts               # agentNode()
│   │   ├── tool.ts                # toolNode(), customToolNode()
│   │   ├── control.ts            # decisionNode(), waitNode(), askUserNode()
│   │   ├── context.ts            # contextMonitorNode()
│   │   ├── subgraph.ts           # subgraphNode()
│   │   └── parallel.ts           # parallelNode(), parallelSubagentNode()
│   ├── runtime/                    # Runtime utilities
│   │   ├── compiled.ts            # Re-exports
│   │   ├── execution-state.ts     # initializeExecutionState(), mergeState()
│   │   └── model-resolution.ts    # resolveNodeModel()
│   ├── persistence/                # Checkpointing (4 implementations)
│   ├── annotation.ts              # State annotation system (Reducers)
│   ├── agent-providers.ts         # 3 SDK-backed AgentProvider factories
│   ├── provider-registry.ts       # ProviderRegistry (immutable map)
│   ├── subagent-registry.ts       # SubagentTypeRegistry (discovered from config dirs)
│   ├── state-validator.ts         # Zod-based state validation
│   ├── templates.ts               # sequential(), mapReduce(), reviewCycle(), taskLoop()
│   └── errors.ts                  # SchemaValidationError, NodeExecutionError
├── conductor/                      # Conductor execution engine (~8 files)
│   ├── conductor.ts               # WorkflowSessionConductor class
│   ├── graph-traversal.ts         # getNextExecutableNodes()
│   ├── event-bridge.ts            # createTaskUpdatePublisher()
│   ├── context-pressure.ts        # Context window monitoring + continuation
│   ├── truncate.ts                # UTF-8 aware output truncation
│   ├── guards.ts                  # Runtime type guards
│   └── types.ts                   # StageDefinition, ConductorConfig, StageOutput, etc.
├── runtime/executor/               # Runtime executor layer (~4 files)
│   ├── conductor-executor.ts      # executeConductorWorkflow() entry point
│   ├── session-runtime.ts         # Session initialization
│   ├── graph-helpers.ts           # compileGraphConfig()
│   └── task-persistence.ts        # Debounced task saving
├── ralph/                          # Ralph workflow definition (~7 files)
│   ├── definition.ts              # WorkflowDefinition entry point
│   ├── stages.ts                  # 4 StageDefinition objects
│   ├── prompts.ts                 # Prompt templates & parsers
│   ├── state.ts                   # RalphWorkflowState + annotations
│   ├── conductor-graph.ts         # CompiledGraph with 4 agent nodes
│   ├── graph.ts                   # Barrel re-export
│   └── graph/task-helpers.ts      # Task parsing, readiness, runtime conversion
├── workflow-types.ts               # WorkflowDefinition interface
├── runtime-contracts.ts            # Zod schemas, WorkflowRuntimeTask
├── session.ts                      # Session directory management
├── task-identity-service.ts        # Canonical task ID management
├── task-result-envelope.ts         # Task result formatting
├── runtime-parity-observability.ts # Metrics collection
└── helpers/workflow-input-resolver.ts # Human-in-the-loop input
```

**Key observation**: A developer creating a new workflow must understand and create files across at least 4-5 of these directories. The Ralph workflow alone requires 7 files with complex cross-references.

---

### 2. Ralph Workflow Case Study

The Ralph workflow is the only production workflow. It implements an autonomous implementation pipeline: **Planner → Orchestrator → Reviewer → Debugger**. Each stage runs in a fresh agent session with an isolated context window.

#### Files Required (7 files)

| File | Purpose | Lines |
|------|---------|-------|
| `ralph/definition.ts` | Top-level `WorkflowDefinition` registration | ~70 |
| `ralph/stages.ts` | 4 `StageDefinition` objects wiring prompts to parsers | ~240 |
| `ralph/prompts.ts` | Prompt construction + output parsing | ~580 |
| `ralph/state.ts` | `RalphWorkflowState` (28 fields) + annotation reducers | ~215 |
| `ralph/conductor-graph.ts` | `CompiledGraph<BaseState>` with 4 no-op agent nodes | ~95 |
| `ralph/graph.ts` | Barrel re-export | ~10 |
| `ralph/graph/task-helpers.ts` | Task parsing, readiness, dependency algorithms | ~260 |

**Total: ~1,470 lines across 7 files** for a 4-stage linear workflow.

#### Execution Flow

1. User invokes `/ralph "prompt"` → workflow definition looked up from `BUILTIN_WORKFLOW_DEFINITIONS`
2. `definition.createState(params)` → `createRalphState()` initializes 28-field state with annotation defaults
3. `definition.createConductorGraph()` → `CompiledGraph` with `planner → orchestrator → reviewer → debugger` (no-op execute functions)
4. `ConductorConfig` assembled from `CommandContext` callbacks (`createSession`, `streamSession`, `destroySession`, `onStageTransition`, `onTaskUpdate`)
5. `WorkflowSessionConductor.execute(prompt)` walks the graph:
   - For each agent node: look up `StageDefinition`, call `buildPrompt(context)`, create session, stream, capture output, call `parseOutput(response)`, store `StageOutput`
   - `debuggerStage.shouldRun()` checks if reviewer found actionable findings
6. Result mapped to `CommandResult`

#### Key Patterns in Ralph

- **Stage Definition pattern**: Each stage is `{ id, name, indicator, buildPrompt(ctx), parseOutput?(response), shouldRun?(ctx) }`
- **Annotation-based state**: Fields declared with `annotation<T>(default, reducer?)`, custom reducers for `mergeById`, `concat`, `replace`
- **No-op graph nodes**: Agent nodes have dummy `execute` because the conductor bypasses `node.execute()` and uses `StageDefinition` methods instead
- **Multi-strategy parsing**: Both `parseReviewResult` and `extractJsonArray` try 3 parsing strategies (direct JSON, code fence extraction, regex extraction)
- **Prompt-driven orchestration**: The orchestrator stage's prompt instructs the agent to spawn sub-agents itself — parallel dispatch is not programmatic
- **Inter-stage context threading**: Each stage's `buildPrompt` reads prior `StageOutput` records from `context.stageOutputs`

---

### 3. Tool & Agent Session Invocation

#### Agent Providers (Strategy Pattern)

Three SDK implementations behind `CodingAgentClient` interface (`src/services/agents/contracts/client.ts`):

| Provider | Factory | Models |
|----------|---------|--------|
| Claude | `createClaudeAgentProvider()` | opus, sonnet, haiku |
| OpenCode | `createOpenCodeAgentProvider()` | (empty) |
| Copilot | `createCopilotAgentProvider()` | (empty) |

Providers are wrapped in `ClientBackedAgentProvider` (lazy-start adapter) and stored in an immutable `ProviderRegistry` (string-keyed `ReadonlyMap`).

#### Agent Nodes (`nodes/agent.ts:61-146`)

`agentNode()` creates a node that:
1. Gets `CodingAgentClient` via `ctx.config.runtime.clientProvider(agentType)`
2. Creates session: `client.createSession(fullSessionConfig)`
3. Streams: iterates `session.stream(message)` collecting chunks
4. Maps output via `outputMapper` or stores raw in `state.outputs[id]`
5. Destroys session in `finally`

#### Tool Nodes (`nodes/tool.ts`)

Two variants:
- `toolNode()`: Direct function execution with optional timeout, args resolution, and output mapping
- `customToolNode()`: Resolves tools from `ToolRegistry` at runtime, validates args against Zod schema

#### Sub-Agent Discovery (`services/agent-discovery/`)

Sub-agents are discovered from configuration directories by reading `.md` files with YAML frontmatter:
- `.claude/agents`, `.opencode/agents`, `.github/agents` (project-local)
- `~/.claude/agents` (global)

`discoverAgentInfos()` scans directories, parses frontmatter for `name` and `description`, validates, and deduplicates (project-local overrides global). Results populate the `SubagentTypeRegistry`.

#### Conductor Sessions (Isolated Per-Stage)

The conductor creates a **fresh session per stage** via `config.createSession(stage.sessionConfig)`. Context window pressure is monitored after each stage; if critical (≥60%), a continuation session is created with a prompt summarizing prior work (up to 3 continuations per stage).

---

### 4. Control Flow Mechanisms

#### 4a. Sequential Flows (Default)

The `GraphBuilder` maintains a `currentNodeId` cursor. Each `.then(node)` call creates an unconditional edge from the cursor to the new node:

```typescript
graph<S>().start(nodeA).then(nodeB).then(nodeC).end()
// Produces: nodeA -> nodeB -> nodeC
```

#### 4b. Conditional Branching (`if`/`else`/`endif`)

**Imperative form**:
```typescript
graph<S>()
  .start(nodeA)
  .if(state => state.condition)
    .then(nodeB)
  .else()
    .then(nodeC)
  .endif()
  .then(nodeD)
  .end()
```

Implementation inserts noop decision nodes as routing waypoints. The resulting topology:
```
nodeA -> decision_N --(cond=true)--> nodeB --> merge_M
                     --(cond=false)-> nodeC --> merge_M --> nodeD
```

**Declarative form** (`IfConfig`):
```typescript
interface IfConfig<TState> {
  condition: (state: TState) => boolean;
  then: NodeDefinition<TState>[];
  else_if?: { condition: (state: TState) => boolean; then: NodeDefinition<TState>[]; }[];
  else?: NodeDefinition<TState>[];
}
```

Nested `else_if` entries are implemented as chained nested conditionals.

#### 4c. Loops with Termination Conditions

```typescript
graph<S>()
  .start(nodeA)
  .loop([workerNode, reviewerNode], {
    until: state => state.allTasksComplete,
    maxIterations: 10
  })
  .then(nodeB)
  .end()
```

Implementation creates `loop_start` and `loop_check` decision nodes:
```
nodeA -> loop_start -> workerNode -> reviewerNode -> loop_check
                ^                                       |
                |------(continue: !until && iter<max)---|
         (exit: until || iter>=max) -> nodeB
```

The iteration counter is stored in `state.outputs["loop_start_N_iteration"]` and incremented by `loop_check`. Default `maxIterations` is 100.

#### 4d. Dynamic Node-to-Node Transitions (`goto`)

Any node's `execute` function can return `{ goto: nodeId }` in its `NodeResult`, bypassing static edge evaluation entirely:

```typescript
const decisionNode = createDecisionNode('router', [
  { condition: state => state.needsFix, target: 'fixer' },
  { condition: state => state.needsReview, target: 'reviewer' },
], 'end');  // fallback
```

The graph traversal function `getNextExecutableNodes()` checks `result.goto` first, then falls back to edge condition evaluation.

#### 4e. Edge Conditions

All branching is modeled as `EdgeCondition<TState> = (state: TState) => boolean` predicates on edges, evaluated by the runtime:

```typescript
interface Edge<TState> {
  from: NodeId;
  to: NodeId;
  condition?: (state: TState) => boolean;
  label?: string;  // "if-true", "if-false", "loop-continue", "loop-exit"
}
```

#### 4f. Graph Templates

Pre-built patterns in `templates.ts`:
- `sequential(nodes)` — Linear chain
- `mapReduce(splitter, worker, merger)` — Fan-out/fan-in
- `reviewCycle(executor, reviewer, fixer, config)` — Loop with review
- `taskLoop(decomposer, worker, reviewer?, config?)` — Task decomposition loop

---

### 5. Z3 Solver TypeScript Bindings

#### Installation

```bash
bun add z3-solver
```

**Package**: `z3-solver` on npm. Z3 is compiled to WebAssembly. Requires `SharedArrayBuffer` support (available in Node.js and Bun natively).

**Sources**:
- npm: https://www.npmjs.com/package/z3-solver
- TypeDoc API: https://z3prover.github.io/api/html/js/index.html
- JavaScript guide: https://microsoft.github.io/z3guide/programming/Z3%20JavaScript%20Examples
- GitHub: https://github.com/Z3Prover/z3/tree/master/src/api/js

#### Initialization

```typescript
import { init } from 'z3-solver';

const { Context } = await init();
const { Solver, Int, Bool, And, Or, Not, Implies, If, ForAll, Exists } = new Context('main');
```

`init()` is async — it loads the Z3 WASM module. Returns `{ Z3 (low-level API), Context (high-level API constructor) }`.

#### Key Concepts

| Concept | API |
|---------|-----|
| **Sorts (types)** | `Bool`, `Int`, `Real`, `BitVec`, `Array`, `Set` |
| **Constants** | `Bool.const('x')`, `Int.const('x')`, `Int.consts('x y z')` |
| **Literals** | `Bool.val(true)`, `Int.val(5)` |
| **Arithmetic** | `.add()`, `.sub()`, `.mul()`, `.div()`, `.mod()`, `.le()`, `.lt()`, `.gt()`, `.ge()`, `.eq()`, `.neq()` |
| **Logic** | `And(...)`, `Or(...)`, `Not(...)`, `Implies(a,b)`, `Iff(a,b)`, `Xor(a,b)`, `If(cond,then,else)` |
| **Bool methods** | `.and()`, `.or()`, `.not()`, `.implies()` |
| **Quantifiers** | `ForAll([x,y], body)`, `Exists([x,y], body)` |
| **Solver** | `new Solver()`, `.add(constraint)`, `.check()` → `'sat'|'unsat'|'unknown'`, `.model()`, `.push()`, `.pop()` |
| **Optimize** | `new Optimize()`, `.maximize()`, `.minimize()`, `.addSoft()` |

#### Graph Verification Patterns

##### 5a. Reachability — Can every node be reached from START?

```typescript
const reach = Array.from({ length: N }, (_, i) => Bool.const(`reach_${i}`));
const solver = new Solver();

// START is always reachable
solver.add(reach[0]);

// Node j is reachable iff some predecessor with an edge to j is reachable
for (let j = 1; j < N; j++) {
  const predecessors = edges.filter(([_, dst]) => dst === j).map(([src]) => reach[src]);
  solver.add(predecessors.length > 0 ? reach[j].eq(Or(...predecessors)) : Not(reach[j]));
}

// Negate: assert some node is NOT reachable
solver.add(Or(...reach.map(r => Not(r))));
const result = await solver.check();
// 'unsat' => all nodes reachable (verified)
```

##### 5b. Termination — Do all paths reach END?

Model using distance-to-END encoding:
```typescript
const dist = Array.from({ length: N }, (_, i) => Int.const(`dist_${i}`));
solver.add(dist[END].eq(0));

for (let i = 0; i < N; i++) {
  if (i === END) continue;
  const successors = edges.filter(([src]) => src === i).map(([_, dst]) => dst);
  if (successors.length > 0) {
    solver.add(dist[i].gt(0));
    solver.add(Or(...successors.map(j => dist[i].eq(dist[j].add(1)))));
  }
}
// 'sat' => every node has a finite distance to END
```

##### 5c. Loop Bound Proofs

Prove that a loop with a counter variable and `maxIterations` always terminates:
```typescript
const maxIter = Int.const('maxIter');
const iterCount = Int.const('iterCount');
const ranking = maxIter.sub(iterCount);

solver.add(maxIter.gt(0), iterCount.ge(0), ranking.ge(0));
solver.add(iterCount.lt(maxIter), ranking.le(0));
// 'unsat' => loop always terminates within maxIter iterations
```

##### 5d. Deadlock-Freedom

For each reachable non-END node, at least one outgoing edge must be enabled:
```typescript
for (let i = 0; i < N; i++) {
  if (i === END) continue;
  const outgoing = edges.filter(([src]) => src === i).map((_, idx) => edgeEnabled[idx]);
  solver.add(Implies(reach[i], Or(...outgoing)));
}
```

##### 5e. Conditional Edge Encoding

For exclusive branching:
```typescript
const cond_AB = Bool.const('cond_AB');
const cond_AC = Bool.const('cond_AC');
solver.add(Or(cond_AB, cond_AC));          // at least one taken
solver.add(Not(And(cond_AB, cond_AC)));    // at most one taken
```

#### Z3 Limitations

1. **Fixedpoint API**: Less documented for JS/TS compared to Python. Use bounded unrolling for reachability instead.
2. **Bun compatibility**: No official compatibility statements from Z3 team. Needs early testing.
3. **Not thread-safe**: Only one long-running Z3 operation at a time. Serialize calls or use separate contexts.
4. **No EnumSort in JS**: Use integer constants with range constraints instead.
5. **Async operations**: `solver.check()` and `Z3_simplify` run on separate threads and return Promises.

---

### 6. Declarative DSL Patterns in the Codebase

#### 6a. `IfConfig` Declarative Conditional (`authoring/types.ts:54-62`)

Already supports a fully declarative conditional definition:
```typescript
interface IfConfig<TState> {
  condition: (state: TState) => boolean;
  then: NodeDefinition<TState>[];
  else_if?: { condition: (state: TState) => boolean; then: NodeDefinition<TState>[]; }[];
  else?: NodeDefinition<TState>[];
}
```

#### 6b. `LoopConfig` Declarative Loop (`authoring/types.ts:10-13`)

```typescript
interface LoopConfig<TState> {
  until: EdgeCondition<TState>;  // (state) => boolean; true = stop
  maxIterations?: number;        // default 100
}
```

#### 6c. `StageDefinition` Declarative Stage (`conductor/types.ts`)

```typescript
interface StageDefinition {
  id: string;
  name: string;
  indicator: string;
  buildPrompt(context: StageContext): string;
  parseOutput?(response: string): unknown;
  shouldRun?(context: StageContext): boolean;
  sessionConfig?: SessionConfig;
  maxOutputBytes?: number;
}
```

#### 6d. `WorkflowDefinition` Registration Interface (`workflow-types.ts`)

```typescript
interface WorkflowDefinition {
  name: string;
  description: string;
  aliases?: string[];
  version?: string;
  source?: "builtin" | "custom";
  createState?(params: WorkflowStateParams): BaseState;
  conductorStages?: readonly StageDefinition[];
  createConductorGraph?(): CompiledGraph<BaseState>;
  createGraph?(state: BaseState): CompiledGraph<BaseState>;
  nodeDescriptions?: Record<string, string>;
  argumentHint?: string;
}
```

#### 6e. Custom Workflow File Format

Custom workflows are discovered from `.atomic/workflows/` (local) and `~/.atomic/workflows/` (global) as `.ts` files loaded via dynamic `import()`. Currently they export `{ name, description, graphConfig?, createGraph? }` but do **not** support `conductorStages` or `createConductorGraph`.

#### 6f. Graph Templates as Declarative Patterns

Templates in `templates.ts` provide higher-level abstractions:
- `sequential(nodes)` — Simplest declarative pattern
- `taskLoop(decomposer, worker, reviewer?, config?)` — Encapsulates the decompose-execute-review pattern

---

## Code References

### Graph Builder Core
- `src/services/workflows/graph/authoring/builder.ts:57-334` — `GraphBuilder` class
- `src/services/workflows/graph/authoring/builder.ts:332-334` — `graph<TState>()` factory
- `src/services/workflows/graph/contracts/core.ts:1-66` — Foundational types (`BaseState`, `NodeId`, `NodeType`)
- `src/services/workflows/graph/contracts/runtime.ts:46-61` — `NodeDefinition<TState>`
- `src/services/workflows/graph/contracts/runtime.ts:24-28` — `NodeResult<TState>` (goto, stateUpdate, signals)
- `src/services/workflows/graph/contracts/runtime.ts:162-167` — `Edge<TState>` with conditions
- `src/services/workflows/graph/contracts/runtime.ts:169-175` — `CompiledGraph<TState>`

### Control Flow
- `src/services/workflows/graph/authoring/conditional-dsl.ts:21-40` — `beginConditionalBranch()`
- `src/services/workflows/graph/authoring/conditional-dsl.ts:115-163` — `closeConditionalBranch()`
- `src/services/workflows/graph/authoring/conditional-dsl.ts:42-94` — `applyIfConfig()` declarative
- `src/services/workflows/graph/authoring/iteration-dsl.ts:46-132` — `addLoopSegment()`
- `src/services/workflows/graph/nodes/control.ts:65-85` — `decisionNode()` (runtime goto)
- `src/services/workflows/graph/templates.ts:110-211` — Graph templates

### Ralph Workflow
- `src/services/workflows/ralph/definition.ts:53-70` — `ralphWorkflowDefinition`
- `src/services/workflows/ralph/stages.ts:90-238` — 4 stage definitions + `RALPH_STAGES`
- `src/services/workflows/ralph/prompts.ts:39-582` — All prompt builders + parsers
- `src/services/workflows/ralph/state.ts:51-213` — `RalphWorkflowState` + annotations
- `src/services/workflows/ralph/conductor-graph.ts:44-92` — Linear 4-node compiled graph

### Conductor & Runtime
- `src/services/workflows/conductor/conductor.ts:74-673` — `WorkflowSessionConductor`
- `src/services/workflows/conductor/conductor.ts:125-202` — `execute()` main loop
- `src/services/workflows/conductor/graph-traversal.ts:23-46` — `getNextExecutableNodes()`
- `src/services/workflows/runtime/executor/conductor-executor.ts:48-339` — `executeConductorWorkflow()`

### Agent Providers & Discovery
- `src/services/workflows/graph/agent-providers.ts:97-144` — 3 provider factories
- `src/services/workflows/graph/provider-registry.ts:15-33` — `ProviderRegistry`
- `src/services/workflows/graph/subagent-registry.ts:33-75` — `SubagentTypeRegistry` + `populateSubagentRegistry()`
- `src/services/agent-discovery/discovery.ts:290-375` — `discoverAgentInfos()` pipeline
- `src/services/agents/contracts/client.ts:7-23` — `CodingAgentClient` interface

### Node Types
- `src/services/workflows/graph/nodes/agent.ts:61-146` — `agentNode()`
- `src/services/workflows/graph/nodes/tool.ts:44-215` — `toolNode()`, `customToolNode()`
- `src/services/workflows/graph/nodes/control.ts:65-225` — `decisionNode()`, `waitNode()`, `askUserNode()`
- `src/services/workflows/graph/nodes/subgraph.ts:36-87` — `subgraphNode()`
- `src/services/workflows/graph/nodes/parallel.ts:39-167` — `parallelNode()`, `parallelSubagentNode()`

### State System
- `src/services/workflows/graph/annotation.ts:184-284` — `annotation()`, `initializeState()`, `applyStateUpdate()`
- `src/services/workflows/graph/annotation.ts:67-164` — `Reducers` (replace, concat, merge, mergeById, max, min, etc.)

---

## Architecture Documentation

### Current Architecture (As-Is)

```
WorkflowDefinition
├── name, description, aliases, version
├── createState(params) → BaseState
├── conductorStages: StageDefinition[]
│   └── { id, name, buildPrompt(ctx), parseOutput?(resp), shouldRun?(ctx) }
├── createConductorGraph() → CompiledGraph<BaseState>
│   └── Map<NodeId, NodeDefinition> + Edge[] + startNode + endNodes
└── nodeDescriptions: Record<string, string>

CompiledGraph<TState>
├── nodes: Map<NodeId, NodeDefinition<TState>>
│   └── { id, type, execute(ctx) → NodeResult, retry?, onError? }
├── edges: Edge<TState>[]
│   └── { from, to, condition?(state) → boolean, label? }
├── startNode: NodeId
├── endNodes: Set<NodeId>
└── config: GraphConfig<TState>

WorkflowSessionConductor
├── execute(prompt) → WorkflowResult
├── Main loop: queue-based graph walk
├── Agent stages: fresh session per stage
├── Deterministic stages: direct node.execute(ctx)
└── Context pressure monitoring + continuation
```

### Dependency Chain for a New Workflow

To create a custom workflow today, a developer must:

1. Create a state type extending `BaseState` with annotations (`state.ts`)
2. Write prompt templates for each stage (`prompts.ts`)
3. Define `StageDefinition` objects wiring prompts to parsers (`stages.ts`)
4. Build a `CompiledGraph` with agent/tool nodes (`conductor-graph.ts` or `graph.ts`)
5. Create a `WorkflowDefinition` assembling everything (`definition.ts`)
6. Register in `BUILTIN_WORKFLOW_DEFINITIONS` or place in `.atomic/workflows/`

This requires understanding the `GraphBuilder` API, the conductor system, the annotation/reducer pattern, and the provider registry — a significant learning curve.

---

## Historical Context (from research/)

### Directly Relevant Research

- `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md` — Complete inventory of Ralph architecture informing the conductor redesign that replaced the compiled-graph engine
- `research/docs/2026-02-25-workflow-sdk-standardization.md` — Comprehensive research on standardizing the workflow SDK with unified entry point, synthesizing LangGraph, Temporal, and Inngest patterns
- `research/docs/2026-02-25-workflow-sdk-design.md` — Documentation of a `WorkflowSDK` class facade (since deprecated)
- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` — Design for pluggable SDK with entity registry normalizing commands/skills/agents from all providers
- `research/docs/2026-02-03-workflow-composition-patterns.md` — Subgraph usage, circular dependency detection, state passing between workflows
- `research/docs/2026-02-03-custom-workflow-file-format.md` — File format, required exports, discovery paths for custom workflows
- `research/docs/2026-02-11-workflow-sdk-implementation.md` — Graph-based execution engine, fluent builder API, 12+ node types, custom tools integration
- `research/docs/2026-01-31-graph-execution-pattern-design.md` — Comprehensive design synthesizing LangGraph.js, XState, Effect-TS patterns
- `research/docs/2026-01-31-atomic-current-workflow-architecture.md` — SDK layer, graph engine, workflow definitions, command system

### Formal Specs

- `specs/ralph-workflow-redesign.md` (2026-03-20) — RFC that introduced the conductor model replacing the compiled-graph engine
- `specs/workflow-sdk-standardization.md` (2026-02-25) — RFC for unified `WorkflowSDK` entry point
- `specs/pluggable-workflows-sdk.md` (2026-02-05) — RFC for unified SDK with entity registry
- `specs/atomic-v2-rebuild.md` (2026-03-15) — RFC proposing ground-up rebuild reducing the graph engine from 8.7K lines to ~1K
- `specs/unified-workflow-execution.md` (2026-02-26) — RFC for generic workflow execution replacing `if (name === "ralph")` dispatch

### V2 Rebuild Specs

- `research/docs/v1/2026-03-15-spec-04-workflow-engine.md` — Formal V2 spec for workflow engine: graph execution, Ralph, and custom workflows
- `research/docs/v1/2026-03-15-atomic-from-scratch-rebuild-spec.md` — Comprehensive rebuild specification

---

## Related Research

- `research/docs/2026-02-25-workflow-sdk-patterns.md` — External SDK patterns (LangGraph, Temporal, Inngest)
- `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md` — Full technical analysis of graph execution engine
- `research/docs/2026-02-15-ralph-dag-orchestration-implementation.md` — DAG-based orchestration with dependency enforcement
- `research/docs/2026-02-28-workflow-gaps-architecture.md` — Inventory of ~40 source files with gap categories

---

## Open Questions

1. **Bun compatibility with z3-solver**: The `z3-solver` package uses Emscripten-compiled WASM with pthreads. While Bun supports `SharedArrayBuffer` and WASM, there are no official Z3 compatibility statements for Bun. Early testing (`bun add z3-solver && bun -e "const { init } = require('z3-solver'); init().then(console.log)"`) is needed.

2. **Verification scope**: Should Z3 verification run at workflow compile-time (blocking deployment of invalid workflows) or as a separate lint/check step? The async nature of `solver.check()` (~ms for small graphs) makes compile-time verification feasible.

3. **Conditional edge encoding**: Current edge conditions are arbitrary `(state: TState) => boolean` predicates. For Z3 verification, these need to be constrained to a decidable subset (e.g., simple boolean state checks). How to enforce this constraint in the DSL without losing expressiveness?

4. **State type erasure**: Z3 operates on `Bool`, `Int`, `Real` sorts. Mapping arbitrary TypeScript state fields to Z3 sorts requires a translation layer. The annotation system's reducers add complexity — should verified workflows use a simpler state model?

5. **Custom workflow migration**: Existing custom workflows in `.atomic/workflows/` use the `graphConfig`/`createGraph` path, not the conductor stages path. A new single-file DSL would need a migration path or backward compatibility layer.

6. **Parallel branches**: The research question excludes parallel branches "for now." The current SDK has `parallelNode()` and `parallelSubagentNode()`. Should the new DSL explicitly prevent parallel constructs at the type level, or just not provide syntax for them?
