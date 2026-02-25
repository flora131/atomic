---
date: 2026-02-25 08:15:53 UTC
researcher: Copilot CLI
git_commit: ace7e1566ce0e02a003a6508baae7db27d61dea0
branch: lavaman131/feature/workflow-sdk
repository: workflow-sdk
topic: "Workflow SDK Standardization: Graph Engine, Ralph, Sub-Agents, State Management & Declarative API"
tags: [research, codebase, workflow-sdk, graph-engine, ralph, sub-agents, state-management, declarative-api, workflow-discovery]
status: complete
last_updated: 2026-02-25
last_updated_by: Copilot CLI
---

# Research: Workflow SDK Standardization

## Research Question

Research the current workflow implementation and Ralph implementation to standardize a new workflow-sdk. The SDK should be user-friendly, use sub-agents as building blocks, feature a clean declarative chaining API with support for loops, control structures (if/else), parallel branches, and typed state passing. Users should be able to add their own workflows via `~/.atomic/workflows` and `.atomic/workflows` using existing imported sub-agents.

## Summary

The Atomic codebase contains a mature graph-based workflow execution engine (`src/graph/`) with a fluent builder API, typed state annotations with reducers, 12+ node factories, and sub-agent integration. The "Ralph" workflow is the primary built-in workflow implementing a task-decomposition → DAG-dispatch → review cycle. Custom workflows are discovered from `.atomic/workflows/` (local) and `~/.atomic/workflows/` (global) as TypeScript files with standardized exports. The sub-agent system bridges to multiple coding agent SDKs (OpenCode, Claude Agent SDK, Copilot SDK) via a `SubagentGraphBridge` and `SubagentTypeRegistry`. External SDK analysis of LangGraph, Temporal, Inngest, and all three coding agent SDKs reveals converging patterns around typed state with reducers, declarative graph composition, session-first design, and hierarchical error handling. This document synthesizes all findings to inform the design of a standardized workflow SDK.

---

## Table of Contents

1. [Graph Execution Engine](#1-graph-execution-engine)
2. [State Management & Annotations](#2-state-management--annotations)
3. [Node Factory System](#3-node-factory-system)
4. [Sub-Agent System](#4-sub-agent-system)
5. [Ralph Workflow Implementation](#5-ralph-workflow-implementation)
6. [Workflow Discovery & Custom Workflows](#6-workflow-discovery--custom-workflows)
7. [External SDK Patterns](#7-external-sdk-patterns)
8. [Cross-Component Connections](#8-cross-component-connections)
9. [Architecture Documentation](#9-architecture-documentation)
10. [Code References](#10-code-references)
11. [Historical Context](#11-historical-context)
12. [Open Questions](#12-open-questions)

---

## 1. Graph Execution Engine

### 1.1 GraphBuilder (`src/graph/builder.ts`)

The `GraphBuilder` class (line 136) provides a fluent API for constructing graph-based workflows declaratively. Entry point is the `graph<TState>()` factory function (line 694).

**Core API surface:**

```typescript
const workflow = graph<MyState>()
  .start(startNode)
  .then(nodeA)
  .if(condition)
    .then(nodeB)
  .else()
    .then(nodeC)
  .endif()
  .loop([nodeD, nodeE], { until: (state) => state.done, maxIterations: 100 })
  .parallel([branchA, branchB], { strategy: "all", merge: mergeFunction })
  .wait({ prompt: "Continue?" })
  .catch(errorHandler)
  .end()
  .compile(config);
```

**Internal state:**

| Field | Type | Purpose |
|-------|------|---------|
| `nodes` | `Map<NodeId, NodeDefinition<TState>>` | All node definitions by ID |
| `edges` | `Edge<TState>[]` | Connections between nodes |
| `startNodeId` | `NodeId \| null` | Entry point for execution |
| `endNodeIds` | `Set<NodeId>` | Terminal nodes |
| `currentNodeId` | `NodeId \| null` | Tracks position for chaining |
| `conditionalStack` | `ConditionalBranch<TState>[]` | Stack for nested if/else |
| `nodeCounter` | `number` | Unique ID generation |
| `errorHandlerId` | `NodeId \| null` | Global error handler |

**Control flow implementations:**

- **if/else/endif** (lines 287-395): Pushes a `ConditionalBranch` onto a stack. The `if()` method creates a decision node, `else()` switches to the else branch, and `endif()` creates a merge node. Supports nesting via stack.
- **loop** (lines 456-530): Creates `loop_start` → body nodes → `loop_check` with a back-edge to the first body node. Uses `LoopConfig.until` predicate and `maxIterations` (default: 100).
- **parallel** (lines 399-453): Creates a parallel node with configurable `strategy`: `"all"` (Promise.all), `"race"` (Promise.race), `"any"` (Promise.any). Accepts optional `merge` function to combine branch results.

### 1.2 GraphExecutor (`src/graph/compiled.ts`)

The `GraphExecutor` class (line 213) executes compiled graphs via BFS traversal with a node queue. Key method is `stream()` (line 266) which yields `StepResult` per node.

**Execution flow:**

1. Initialize state and step counter
2. Push start node onto queue
3. Dequeue node → execute via `executeWithRetry()` (line 547)
4. Merge `NodeResult.stateUpdate` into state (immutable merge; `outputs` is spread-merged)
5. Evaluate outgoing edges, push matching targets onto queue
6. Yield `StepResult` with node info, state snapshot, signals
7. Check `maxSteps` and loop detection (`Set<string>` with `nodeId:stepCount` keys)

**Retry logic:** Exponential backoff: `backoffMs × backoffMultiplier^(attempt-1)` with configurable `maxAttempts`.

**Model resolution order:** node → parent config → GraphConfig → SDK default.

**Factory functions:** `createExecutor()`, `executeGraph()`, `streamGraph()` at lines 721-757.

### 1.3 Core Types (`src/graph/types.ts`)

| Type | Line | Purpose |
|------|------|---------|
| `BaseState` | 109 | `{ executionId, lastUpdated, outputs: Record<NodeId, unknown> }` |
| `NodeType` | 99 | `"agent" \| "tool" \| "decision" \| "wait" \| "ask_user" \| "subgraph" \| "parallel"` |
| `NodeDefinition<TState>` | 309 | Node shape: id, type, name, description, retry?, execute(ctx) |
| `NodeResult<TState>` | varies | Execution result: stateUpdate?, signals?, goto? |
| `ExecutionContext<TState>` | 253 | Context passed to execute: state, config, model, emit?, contextWindowUsage? |
| `CompiledGraph<TState>` | varies | Compiled executable: nodes Map, edges array, startNode, endNodes, config |
| `GraphConfig` | 364 | maxSteps, contextWindowThreshold, defaultModel, checkpointer?, telemetryProvider? |
| `RetryConfig` | varies | maxAttempts, backoffMs, backoffMultiplier |
| `SignalData` | varies | Signals: `context_window_warning`, `human_input_required` |

**Constants:** `BACKGROUND_COMPACTION_THRESHOLD = 0.45`, `BUFFER_EXHAUSTION_THRESHOLD = 0.6`

---

## 2. State Management & Annotations

### 2.1 Annotation System (`src/graph/annotation.ts`)

Inspired by LangGraph's annotation pattern. The `annotation<T>(default, reducer)` function creates an `Annotation<T>` that defines how state fields merge during updates.

```typescript
const messages = annotation<string[]>(
  () => [],              // default factory
  Reducers.concat        // reducer: (current, update) => [...current, ...update]
);
```

**`AnnotationRoot`**: A schema of annotations that defines the full state shape. Created with `annotationRoot({ field1: annotation1, field2: annotation2, ... })`.

### 2.2 Built-in Reducers (`Reducers` object)

| Reducer | Behavior |
|---------|----------|
| `replace` | Overwrites current value entirely |
| `concat` | Appends arrays: `[...current, ...update]` |
| `merge` | Shallow merge objects: `{ ...current, ...update }` |
| `mergeById` | Merge arrays of objects by `id` field |
| `max` | Keeps the larger numeric value |
| `min` | Keeps the smaller numeric value |
| `sum` | Adds values: `current + update` |
| `or` | Logical OR: `current \|\| update` |
| `and` | Logical AND: `current && update` |
| `ifDefined` | Only updates if new value is not undefined |

### 2.3 Predefined State Schemas

**`AtomicStateAnnotation`** (line 312): Base schema for general workflows with fields for messages, outputs, and execution metadata.

**`RalphStateAnnotation`** (line 552): Extended schema for the Ralph workflow:
- `researchDoc`, `specDoc`: Document content
- `featureList`, `currentFeature`: Feature tracking
- `yolo`: Boolean for auto-accept mode
- `session` fields: sessionId, sessionDir
- `completedFeatures`: Array tracking completion
- Additional workflow-specific state

**`RalphWorkflowState` interface** (line 466): TypeScript interface mirroring the Ralph annotation schema for type-safe access.

---

## 3. Node Factory System

### 3.1 Overview (`src/graph/nodes.ts`)

The codebase provides 12 node factory functions, each returning a `NodeDefinition<TState>`:

| Factory | Line | Type | Purpose |
|---------|------|------|---------|
| `agentNode()` | 170 | `agent` | AI agent execution with model/prompt |
| `toolNode()` | ~300 | `tool` | Execute a tool function |
| `decisionNode()` | 577 | `decision` | Conditional routing based on state |
| `waitNode()` | 668 | `wait` | Pause for human input |
| `askUserNode()` | 816 | `ask_user` | Structured user questions |
| `parallelNode()` | 988 | `parallel` | Concurrent branch execution |
| `subgraphNode()` | 1126 | `subgraph` | Nested workflow execution |
| `clearContextNode()` | 494 | `tool` | Context window clearing |
| `contextMonitorNode()` | 1374 | `tool` | Context usage monitoring |
| `customToolNode()` | ~1500 | `tool` | User-defined custom tools |
| `subagentNode()` | 1710 | `agent` | Sub-agent execution by name |
| `parallelSubagentNode()` | 1802 | `parallel` | Parallel sub-agent execution |

### 3.2 Sub-Agent Node Factories

**`subagentNode()`** (line 1710):
- Looks up agent by `name` in `SubagentTypeRegistry`
- Spawns via `SubagentGraphBridge.spawn()`
- Maps result to state via user-provided `outputMapper`
- Supports `timeout` and model override

```typescript
const workerNode = subagentNode<MyState>({
  id: "worker",
  name: "worker",               // Registry lookup name
  promptBuilder: (state) => state.taskPrompt,
  outputMapper: (result, state) => ({ taskResult: result.text }),
  timeout: 120_000,
});
```

**`parallelSubagentNode()`** (line 1802):
- Spawns multiple agents via `bridge.spawnParallel()` (uses `Promise.allSettled`)
- Merges results via user-provided `merge` function
- Each agent gets its own prompt from `promptBuilder`

```typescript
const parallelWorkers = parallelSubagentNode<MyState>({
  id: "parallel-workers",
  agents: [
    { name: "worker", prompt: (s) => s.task1Prompt },
    { name: "worker", prompt: (s) => s.task2Prompt },
  ],
  merge: (results, state) => ({
    allResults: results.map(r => r.text),
  }),
});
```

### 3.3 Subgraph Node

**`subgraphNode()`** (line 1126):
- Executes a nested compiled workflow as a single node
- `inputMapper`: Transforms parent state → child state
- `outputMapper`: Transforms child result → parent state update
- Supports both direct `CompiledGraph` reference and string name resolution via `getWorkflowResolver()`

```typescript
const nested = subgraphNode<ParentState, ChildState>({
  id: "deep-analysis",
  subgraph: "analysis-workflow",  // Resolved by name at runtime
  inputMapper: (state) => ({ doc: state.document, outputs: {}, errors: [] }),
  outputMapper: (subState, parentState) => ({ analysisResults: subState.results }),
});
```

---

## 4. Sub-Agent System

### 4.1 SubagentGraphBridge (`src/graph/subagent-bridge.ts`)

The `SubagentGraphBridge` class (line 129) manages sub-agent lifecycle:

- **`spawn()`** (line 145): Creates a session per agent, streams response, collects text and tool_use content blocks, truncates output to 4000 chars. Returns `SubagentResult` with `text`, `toolUses`, `success`.
- **`spawnParallel()`** (line 277): Spawns multiple agents concurrently using `Promise.allSettled()`. Returns array of results.
- **Abort support**: Uses `abortableAsyncIterable()` to support timeout and external abort signal.
- **Session isolation**: Each sub-agent runs in its own session with its own context window.

### 4.2 SubagentTypeRegistry (`src/graph/subagent-registry.ts`)

Singleton map populated by `populateSubagentRegistry()` (line 79):

- Scans agent definition directories:
  - `.claude/agents/` (project + global `~/.claude/agents/`)
  - `.opencode/agents/` (project + global `~/.opencode/agents/`)
  - `.github/agents/` (project + global `~/.config/.copilot/agents/`)
- Uses `discoverAgentInfos()` to parse agent YAML/JSON definitions
- Stores `AgentInfo` objects keyed by agent name
- Accessed via `SubagentTypeRegistry.get(name)` for lookup

### 4.3 Agent Discovery Flow

```
populateSubagentRegistry()
  └─> discoverAgentInfos()
       ├─> scan .claude/agents/*.md (local + global)
       ├─> scan .opencode/agents/*.yaml (local + global)
       └─> scan .github/agents/*.md (local + global)
  └─> For each AgentInfo: registry.set(name, info)
```

### 4.4 Global Singleton Pattern

The sub-agent system uses a global setter pattern to avoid circular dependencies:

| Setter | Purpose |
|--------|---------|
| `setClientProvider()` | SDK client factory for agent sessions |
| `setSubagentBridge()` | SubagentGraphBridge instance |
| `setSubagentRegistry()` | SubagentTypeRegistry instance |
| `setWorkflowResolver()` | Subgraph name → CompiledGraph resolver |

---

## 5. Ralph Workflow Implementation

### 5.1 Overview

Ralph is the primary built-in workflow implementing an autonomous implementation cycle:

```
User Prompt → Task Decomposition → DAG Worker Dispatch → Review → Fix Cycle
```

### 5.2 Phase 1: Task Decomposition

**File:** `src/graph/nodes/ralph.ts`

- `buildSpecToTasksPrompt()` (line 36): Takes user prompt, generates an LLM prompt requesting JSON `TodoItem[]` array
- Each `TodoItem` has: `id`, `title`, `description`, `status`, `blockedBy` (dependency array)
- LLM output is parsed via `parseTasks()` which attempts direct JSON parse with regex fallback

### 5.3 Phase 2: DAG Worker Dispatch

**File:** `src/ui/commands/workflow-commands.ts` + `src/graph/nodes/ralph.ts`

- `getReadyTasks()`: Computes the "ready set" — tasks whose `blockedBy` dependencies are all `"completed"`
- `buildWorkerAssignment()` (line 101): Creates per-task prompts with full context
- `buildDagDispatchPrompt()` (line 210): Creates a prompt for orchestrating multiple workers
- Workers dispatched via `context.spawnSubagent()` — currently **serial** (one worker at a time)
- Each worker receives full task list with its assignment highlighted

**Current limitation:** The worker loop is sequential due to the single-slot `streamCompletionResolverRef` in the TUI chat system. `SubagentGraphBridge.spawnParallel()` exists but is unused by Ralph.

### 5.4 Phase 3: Review & Fix

- `buildReviewPrompt()`: Generates review prompt for completed work
- `parseReviewResult()`: Extracts pass/fail and feedback
- `buildFixSpecFromReview()`: Creates fix spec for recursive fix iterations
- Constants: `MAX_RALPH_ITERATIONS = 100`, `MAX_REVIEW_ITERATIONS = 1`

### 5.5 Session Management

**File:** `src/workflows/session.ts`

- `WorkflowSession` interface (line 17): `{ sessionId, sessionDir, tasksFile, checkpointDir }`
- `initWorkflowSession()` (line 51): Creates `~/.atomic/workflows/sessions/{uuid}/` with subdirs: `checkpoints/`, `agents/`, `logs/`
- Tasks persisted to `tasks.json` with atomic file writes (temp file + rename)
- `fs.watch` on `tasks.json` triggers reactive UI updates in the TUI

---

## 6. Workflow Discovery & Custom Workflows

### 6.1 Discovery System

Custom workflows are TypeScript files discovered from two locations:

| Location | Priority | Scope |
|----------|----------|-------|
| `.atomic/workflows/` | Highest | Project-local |
| `~/.atomic/workflows/` | Lower | User-global |

Built-in workflows (e.g., Ralph) have lowest priority and are overridden by custom workflows with the same name.

### 6.2 Required Exports

Each workflow TypeScript file must export:

```typescript
// Required
export const name: string;           // Workflow identifier (used as slash command)
export const description: string;    // Human-readable description

// Optional
export const aliases: string[];      // Alternative names
export const defaultConfig: Partial<GraphConfig>;  // Default execution config
export function buildGraph<TState extends BaseState>(): CompiledGraph<TState>;
```

### 6.3 Loading Pipeline

```
loadWorkflowsFromDisk()
  ├─> Scan .atomic/workflows/*.ts (local)
  ├─> Scan ~/.atomic/workflows/*.ts (global)
  ├─> For each file: dynamic import → extract exports
  ├─> Priority: local > global > built-in
  └─> Register as slash command in CommandRegistry
```

### 6.4 Workflow Resolution for Subgraphs

`setWorkflowResolver()` / `getWorkflowResolver()` enables string-based workflow references in `subgraphNode()`:

```typescript
// At initialization
setWorkflowResolver((name) => {
  const workflow = loadedWorkflows.get(name);
  return workflow?.buildGraph();
});

// In workflow definition
subgraphNode({ subgraph: "my-workflow" }); // Resolved at runtime
```

### 6.5 Search Path Constants

Defined in `src/ui/commands/workflow-commands.ts`:

```typescript
export const CUSTOM_WORKFLOW_SEARCH_PATHS = [
  ".atomic/workflows",       // Local project workflows (highest priority)
  "~/.atomic/workflows",     // Global user workflows
];
```

---

## 7. External SDK Patterns

### 7.1 Coding Agent SDKs

**Claude Agent SDK** (`anthropics/claude-agent-sdk-typescript`):
- Session-based architecture with V2 APIs: `createSession()`, `resumeSession()`, `prompt()`
- Sub-agents defined inline via `agents: Record<string, AgentConfig>`
- Streaming via `Session.stream()` with events: `task_started`, `task_notification`, `TaskCompleted`
- MCP protocol for tool integration with annotations

**GitHub Copilot SDK** (`github/copilot-sdk`):
- Session persistence to disk (`~/.copilot/session-state/`)
- Custom agents with tool scoping and permission controls
- Rich hook system: `onPreToolUse`, `onPostToolUse`, `onErrorOccurred`
- Multi-language support (TypeScript, Python, Go, .NET)

**OpenCode SDK** (`anomalyco/opencode`):
- Primary/subagent architecture with Task tool for delegation
- File-based tool discovery with plugin system
- 40+ streaming event types via Server-Sent Events (SSE)
- Permission-based task invocation with glob patterns

### 7.2 Workflow Orchestration Frameworks

**LangGraph** (LangChain):
- `StateGraph` with typed state and reducers for merging — directly inspired the current annotation system
- Declarative graph composition with conditional edges via `addConditionalEdges()`
- Checkpointing with multiple backends (Memory, SQLite, PostgreSQL)
- Three durability modes: sync, async, exit
- Multiple streaming modes: values, updates, custom, messages, tasks, debug

**Temporal** (TypeScript):
- Workflow-as-code with deterministic execution
- Event sourcing for durable execution and replay
- Failure type hierarchy: `ApplicationFailure`, `ActivityFailure`, `TimeoutFailure`
- Child workflows with cancellation policies
- Compensation logic via `CancellationScope`

**Inngest**:
- Step API: `step.run()`, `step.sleep()`, `step.waitForEvent()`, `step.invoke()`
- Memoization-based state management — each step result is cached
- Fan-out/fan-in with `group.Parallel`
- Declarative CUE schema for function definition
- Function and step-level retry policies

### 7.3 Converging Patterns Across All SDKs

| Pattern | Present In | Current Implementation |
|---------|-----------|----------------------|
| **Typed state with reducers** | LangGraph, current codebase | `annotation()` + `Reducers` in `annotation.ts` |
| **Fluent builder API** | LangGraph, current codebase | `GraphBuilder` with `.then()`, `.if()`, `.loop()` |
| **Session-first design** | All coding agent SDKs | `WorkflowSession` + per-agent sessions |
| **Sub-agent composition** | All SDKs | `subagentNode()`, `parallelSubagentNode()` |
| **String-based resolution** | LangGraph, current codebase | `subgraphNode()` with name strings |
| **Checkpointing** | LangGraph, Temporal | `checkpointer?` in `GraphConfig` |
| **Exponential retry** | Temporal, Inngest, current | `RetryConfig` with backoff |
| **Parallel branches** | LangGraph, Inngest, current | `parallel()` with merge strategies |
| **Context window management** | Claude Agent SDK, current | `contextMonitorNode()` with thresholds |

---

## 8. Cross-Component Connections

### 8.1 Data Flow: Workflow Definition → Execution

```
User TypeScript file (.atomic/workflows/my-flow.ts)
  └─> loadWorkflowsFromDisk() discovers and imports
  └─> Exports: name, description, buildGraph()
  └─> buildGraph() uses GraphBuilder fluent API
       ├─> Creates NodeDefinitions via factory functions
       ├─> Wires edges with conditions
       └─> compile() produces CompiledGraph
  └─> GraphExecutor.stream() runs the compiled graph
       ├─> BFS traversal through nodes
       ├─> Each node's execute(ctx) called with ExecutionContext
       ├─> State updated immutably after each node
       └─> Yields StepResult stream
```

### 8.2 Sub-Agent Integration Path

```
subagentNode({ name: "worker", ... })
  └─> SubagentTypeRegistry.get("worker")
       └─> Returns AgentInfo from discovery
  └─> SubagentGraphBridge.spawn(agentInfo, prompt)
       ├─> Creates session via ClientProvider
       ├─> Streams response chunks
       ├─> Collects text + tool_use blocks
       └─> Returns SubagentResult { text, toolUses, success }
  └─> outputMapper(result, state) → state update
```

### 8.3 State Flow Through Nodes

```
BaseState { executionId, lastUpdated, outputs }
  └─> Node execute(ctx) reads ctx.state
  └─> Returns NodeResult { stateUpdate: Partial<TState> }
  └─> Executor merges: { ...state, ...stateUpdate, outputs: { ...state.outputs, ...stateUpdate.outputs } }
  └─> Updated state passed to next node
```

### 8.4 Custom Workflow → Sub-Agent → Graph Interplay

A user-defined workflow in `~/.atomic/workflows/my-flow.ts` can:

1. Import node factories: `subagentNode`, `parallelSubagentNode`, `subgraphNode`
2. Reference agents by name (auto-discovered from `.claude/agents/`, `.opencode/agents/`, `.github/agents/`)
3. Reference other workflows by name via `subgraphNode("other-workflow")`
4. Define custom state extending `BaseState`
5. Use all control flow: `.if()`, `.loop()`, `.parallel()`

---

## 9. Architecture Documentation

### 9.1 Module Dependency Graph

```
src/graph/
├── types.ts          ← Foundation types (BaseState, NodeDefinition, etc.)
├── annotation.ts     ← State annotations + reducers (depends on types.ts)
├── builder.ts        ← GraphBuilder fluent API (depends on types.ts)
├── compiled.ts       ← GraphExecutor (depends on types.ts)
├── nodes.ts          ← Node factories (depends on types.ts, annotation.ts)
├── nodes/
│   └── ralph.ts      ← Ralph prompt utilities (depends on types.ts)
├── subagent-bridge.ts ← Sub-agent session management
├── subagent-registry.ts ← Agent type discovery
├── errors.ts         ← Error types
└── index.ts          ← Barrel exports (304 lines)

src/workflows/
├── session.ts        ← WorkflowSession management

src/ui/commands/
├── workflow-commands.ts ← Ralph command handler + workflow discovery
```

### 9.2 Design Patterns

| Pattern | Usage | Files |
|---------|-------|-------|
| **Fluent Builder** | GraphBuilder chaining API | `builder.ts` |
| **Factory Function** | Node creation (`agentNode()`, etc.) | `nodes.ts` |
| **Global Singleton** | `setClientProvider()`, `setSubagentBridge()`, etc. | Various |
| **Immutable State** | State merging in executor | `compiled.ts` |
| **BFS Traversal** | Graph execution order | `compiled.ts` |
| **Stack-based Nesting** | if/else conditional tracking | `builder.ts` |
| **Annotation/Reducer** | LangGraph-inspired state management | `annotation.ts` |
| **Atomic File Writes** | Task state persistence (temp + rename) | `workflow-commands.ts` |
| **Registry Pattern** | SubagentTypeRegistry, CommandRegistry | `subagent-registry.ts` |

### 9.3 Execution Modes

| Mode | Description | Entry Point |
|------|-------------|-------------|
| **Streaming** | Yields `StepResult` per node | `GraphExecutor.stream()` |
| **Full execution** | Runs to completion, returns final state | `executeGraph()` |
| **Stream helper** | Convenience async generator | `streamGraph()` |
| **Inline (TUI)** | Runs within main chat event loop via `streamAndWait()` | `workflow-commands.ts` |

---

## 10. Code References

### Core Graph Engine
- `src/graph/builder.ts:136` — `GraphBuilder` class
- `src/graph/builder.ts:694` — `graph<TState>()` factory function
- `src/graph/builder.ts:287-395` — if/else/endif implementation
- `src/graph/builder.ts:456-530` — loop implementation
- `src/graph/builder.ts:399-453` — parallel implementation
- `src/graph/compiled.ts:213` — `GraphExecutor` class
- `src/graph/compiled.ts:266` — `stream()` generator method
- `src/graph/compiled.ts:547` — `executeWithRetry()` with exponential backoff
- `src/graph/compiled.ts:510` — `resolveModel()` chain
- `src/graph/compiled.ts:721-757` — Factory functions (`createExecutor`, `executeGraph`, `streamGraph`)

### Types & State
- `src/graph/types.ts:109` — `BaseState` interface
- `src/graph/types.ts:99` — `NodeType` union
- `src/graph/types.ts:309` — `NodeDefinition<TState>` interface
- `src/graph/types.ts:253` — `ExecutionContext<TState>` interface
- `src/graph/types.ts:364` — `GraphConfig` interface
- `src/graph/annotation.ts:312` — `AtomicStateAnnotation`
- `src/graph/annotation.ts:552` — `RalphStateAnnotation`
- `src/graph/annotation.ts:466` — `RalphWorkflowState` interface

### Node Factories
- `src/graph/nodes.ts:170` — `agentNode()`
- `src/graph/nodes.ts:494` — `clearContextNode()`
- `src/graph/nodes.ts:577` — `decisionNode()`
- `src/graph/nodes.ts:668` — `waitNode()`
- `src/graph/nodes.ts:816` — `askUserNode()`
- `src/graph/nodes.ts:988` — `parallelNode()`
- `src/graph/nodes.ts:1126` — `subgraphNode()`
- `src/graph/nodes.ts:1374` — `contextMonitorNode()`
- `src/graph/nodes.ts:1710` — `subagentNode()`
- `src/graph/nodes.ts:1802` — `parallelSubagentNode()`

### Sub-Agent System
- `src/graph/subagent-bridge.ts:129` — `SubagentGraphBridge` class
- `src/graph/subagent-bridge.ts:145` — `spawn()` method
- `src/graph/subagent-bridge.ts:277` — `spawnParallel()` method
- `src/graph/subagent-registry.ts:28` — `SubagentTypeRegistry` singleton
- `src/graph/subagent-registry.ts:79` — `populateSubagentRegistry()`

### Ralph Workflow
- `src/graph/nodes/ralph.ts:36` — `buildSpecToTasksPrompt()`
- `src/graph/nodes/ralph.ts:101` — `buildWorkerAssignment()`
- `src/graph/nodes/ralph.ts:210` — `buildDagDispatchPrompt()`
- `src/workflows/session.ts:17` — `WorkflowSession` interface
- `src/workflows/session.ts:51` — `initWorkflowSession()`

### Workflow Discovery
- `src/ui/commands/workflow-commands.ts:64` — `parseRalphArgs()`
- `src/ui/commands/workflow-commands.ts:84` — `WorkflowMetadata`

### Barrel Exports
- `src/graph/index.ts` — Full public API (304 lines)

---

## 11. Historical Context

### Related Research Documents

| Document | Date | Relevance |
|----------|------|-----------|
| `research/docs/2026-01-31-graph-execution-pattern-design.md` | 2026-01-31 | Original graph execution pattern design with LangGraph, XState, Effect-TS comparisons |
| `research/docs/2026-01-31-sdk-migration-and-graph-execution.md` | 2026-01-31 | SDK migration paths for OpenCode, Claude, Copilot with graph execution API design |
| `research/docs/2026-02-03-workflow-composition-patterns.md` | 2026-02-03 | Subgraph usage, workflow resolution by name, state passing between workflows |
| `research/docs/2026-02-03-custom-workflow-file-format.md` | 2026-02-03 | Custom workflow TypeScript file format, exports, discovery paths |
| `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` | 2026-02-05 | Pluggable SDK design with unified entity registry and provider-agnostic execution |
| `research/docs/2026-02-11-workflow-sdk-implementation.md` | 2026-02-11 | Workflow SDK implementation with custom tools and sub-agent integration |
| `research/docs/2026-02-15-ralph-dag-orchestration-implementation.md` | 2026-02-15 | Ralph DAG orchestration with blockedBy enforcement and parallel worker dispatch |
| `research/docs/2026-02-15-ralph-dag-orchestration-blockedby.md` | 2026-02-15 | blockedBy field enforcement analysis in Ralph task dispatch |
| `research/docs/2026-02-21-workflow-sdk-inline-mode-research.md` | 2026-02-21 | Workflow SDK inline execution in TUI chat context |
| `research/graph-execution-engine-technical-documentation.md` | 2026-02-25 | Comprehensive graph engine technical docs (2234 lines) — created during this research |
| `research/workflow_sdk_patterns.md` | 2026-02-25 | External SDK patterns analysis (2189 lines) — created during this research |

### Existing Specs

| Spec | Relevance |
|------|-----------|
| `specs/workflow-sdk-implementation.md` | Implementation spec for customToolNode, subagentNode, parallelSubagentNode |
| `specs/ralph-dag-orchestration.md` | Spec for Ralph DAG-based orchestration with parallel dispatch |

---

## 12. Open Questions

1. **Serial vs Parallel Worker Dispatch in Ralph:** The `SubagentGraphBridge.spawnParallel()` exists but Ralph's worker loop is serial due to the TUI's single-slot `streamCompletionResolverRef`. How should the standardized SDK handle this architectural constraint?

2. **State Schema Enforcement:** The annotation system supports reducers, but there's no runtime validation that state updates conform to the schema. Should the SDK add Zod-based runtime validation?

3. **Workflow Versioning:** No mechanism exists for workflow versioning or migration. As workflows evolve, how should state compatibility be handled across versions?

4. **Error Propagation in Subgraphs:** When a nested subgraph fails, how should errors propagate to the parent graph? Currently the `catch()` handler is graph-level, not node-level.

5. **Custom Tool Integration in Workflows:** Custom tools from `.atomic/tools/*.ts` are registered at the SDK client level but not yet directly composable within workflow graph nodes. How should the SDK bridge this gap?

6. **Checkpointing Implementation:** `GraphConfig` includes a `checkpointer?` field, but the actual checkpointing backends are not yet implemented. What persistence strategies should the SDK support?

7. **User Workflow Authoring DX:** The current export-based workflow format requires knowledge of the full graph API. Should the SDK provide a higher-level DSL or template system for common patterns?

8. **Provider-Agnostic Sub-Agent Execution:** Sub-agents are tied to specific coding agent SDKs. How should the workflow SDK abstract over different providers for the same agent type?

---

## Supporting Research Documents

The following documents were created during this research session and contain detailed deep-dive analysis:

- **`research/docs/2026-02-25-graph-execution-engine-technical-documentation.md`** — 2234-line comprehensive technical analysis of the graph execution engine (GraphBuilder, GraphExecutor, types, node factories, error handling, data flow)
- **`research/docs/2026-02-25-workflow-sdk-patterns.md`** — 2189-line analysis of external SDK patterns (Claude Agent SDK, Copilot SDK, OpenCode SDK, LangGraph, Temporal, Inngest) with comparative tables and code examples
