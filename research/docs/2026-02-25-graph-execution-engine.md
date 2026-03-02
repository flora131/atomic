# Graph Execution Engine -- Technical Documentation

**Date:** 2026-02-25
**Scope:** `src/workflows/graph/` module -- builder, compiled execution, node factories, and core types.

---

## 1. Graph Builder (`src/workflows/graph/builder.ts`)

### Overview

The `GraphBuilder` class (line 229) provides a fluent API for constructing directed acyclic (or cyclic, via loops) workflow graphs. It accumulates nodes and edges in internal collections and produces a `CompiledGraph` object via `.compile()`. A convenience factory function `graph<TState>()` (line 971) instantiates the builder.

### Internal State

| Field | Type | Line | Purpose |
|---|---|---|---|
| `nodes` | `Map<NodeId, NodeDefinition<TState>>` | 231 | All registered node definitions |
| `edges` | `Edge<TState>[]` | 234 | All directed edges |
| `startNodeId` | `NodeId \| null` | 237 | The entry-point node |
| `endNodeIds` | `Set<NodeId>` | 240 | Explicitly marked terminal nodes |
| `currentNodeId` | `NodeId \| null` | 243 | Tracks the "cursor" for chaining |
| `conditionalStack` | `ConditionalBranch<TState>[]` | 246 | Stack for nested if/else tracking |
| `nodeCounter` | `number` | 249 | Auto-incrementing ID generator |
| `errorHandlerId` | `NodeId \| null` | 252 | Global error handler node |

### Private Helper Methods

- **`generateNodeId(prefix)`** (line 257): Returns `"${prefix}_${++nodeCounter}"`.
- **`addNode(node)`** (line 264): Inserts a `NodeDefinition` into `this.nodes`. Throws if the ID already exists.
- **`addEdge(from, to, condition?, label?)`** (line 274): Pushes an `Edge` object onto `this.edges`.
- **`createNode(id, type, execute, options?)`** (line 286): Assembles a `NodeDefinition` from parameters by spreading `options` onto `{id, type, execute}`.

### Fluent API Methods

#### `.start(node)` (line 318)

Sets the starting node of the workflow. Throws if a start node is already set. Records `node.id` as both `startNodeId` and `currentNodeId`.

**Signature:** `start(node: NodeDefinition<TState>): this`

#### `.then(node)` (line 338)

Adds a node and connects it from the current node via an unconditional edge. If no start node exists, delegates to `.start()`. When inside a conditional branch and `currentNodeId` is `null`, the node is registered as the branch start (`ifBranchStart` or `elseBranchStart`) without creating an edge from the decision node; the conditional edges are deferred to `.endif()`. Otherwise, creates a standard edge from `currentNodeId` to `node.id`.

**Signature:** `then(node: NodeDefinition<TState>): this`

#### `.if(condition)` -- function-based overload (line 374)

Begins a conditional branch. Creates a synthetic decision node (type `"decision"`, ID prefix `"decision"`) that returns `{}` from its execute function. Edges from the decision node to the branch starts are deferred until `.endif()`. Pushes a `ConditionalBranch` record onto `conditionalStack` and sets `currentNodeId` to `null` so the next `.then()` call records the branch start.

**Signature:** `if(condition: EdgeCondition<TState>): this`

#### `.if(config)` -- config-based overload (line 382)

Accepts an `IfConfig<TState>` object (line 167) containing `condition`, `then` (node array), optional `else_if` array, and optional `else` node array. Internally calls the function-based `.if()`, then iterates through `.then(node)` for each branch node, `.else()`, and nested `.if()` calls for `else_if` chains. Each `else_if` entry creates a pass-through decision node (line 451-452), a nested `.if()`, and a corresponding `.endif()`. The main conditional is closed last at line 493.

**Signature:** `if(config: IfConfig<TState>): this`

#### `.else()` (line 503)

Transitions to the else branch. Records the current `currentNodeId` as `ifBranchEnd`, sets `inElseBranch = true`, and resets `currentNodeId` to `null`. Throws if already in an else branch or if no preceding `.if()`.

**Signature:** `else(): this`

#### `.endif()` (line 529)

Closes a conditional block. Pops the top `ConditionalBranch` from the stack. Creates a merge node (type `"decision"`, ID prefix `"merge"`, line 544-545). Wires:
- Decision node -> if-branch start (with the original condition, label `"if-true"`)
- Decision node -> else-branch start (with negated condition, label `"if-false"`) -- or directly to merge node if no else branch
- If-branch end -> merge node
- Else-branch end -> merge node (if exists)

Sets `currentNodeId` to the merge node.

**Signature:** `endif(): this`

#### `.parallel(config)` (line 590)

Creates a parallel node (type `"parallel"`, ID prefix `"parallel"`). The node's execute function stores branch metadata in `outputs[parallelNodeId]`. Adds edges from the parallel node to each branch ID specified in `config.branches`.

**Signature:** `parallel(config: ParallelConfig<TState>): this`

The `ParallelConfig` (line 68) contains:
- `branches: NodeId[]` -- branch node IDs
- `strategy?: MergeStrategy` -- `"all"` | `"race"` | `"any"` (default `"all"`)
- `merge?: (results, state) => Partial<TState>` -- optional result combiner

#### `.loop(bodyNodes, config)` (line 647)

Creates a loop structure with these components:
1. **Loop start node** (ID prefix `"loop_start"`, type `"decision"`) -- initializes an iteration counter in `outputs[loopStartId + "_iteration"]`
2. **Body nodes** -- the user-supplied node(s), chained sequentially
3. **Loop check node** (ID prefix `"loop_check"`, type `"decision"`) -- increments the iteration counter

Edge structure:
- `currentNodeId` -> loop start
- Loop start -> first body node
- Body nodes chained: `node[i]` -> `node[i+1]`
- Last body node -> loop check
- Loop check -> first body node (conditional: `!config.until(state) && iteration < maxIterations`, label `"loop-continue"`)

The exit from the loop happens implicitly: the next `.then()` or `.end()` call connects from the loop check node. `maxIterations` defaults to 100 (line 660).

**Signature:** `loop(bodyNodes: NodeDefinition<TState> | NodeDefinition<TState>[], config: LoopConfig<TState>): this`

The `LoopConfig` (line 40) contains:
- `until: EdgeCondition<TState>` -- exit condition (exits when true)
- `maxIterations?: number` -- safety limit (default 100)

#### `.wait(promptOrNode)` (line 745)

Creates a wait node (type `"wait"`) for human-in-the-loop. If given a string, generates a node that emits a `human_input_required` signal. If given a `NodeDefinition`, uses it directly. Delegates to `.then()`.

**Signature:** `wait(promptOrNode: string | NodeDefinition<TState>): this`

#### `.subagent(config)` (line 786)

Converts a `SubAgentConfig<TState>` (line 100) to a `SubagentNodeConfig` by mapping `config.agent` to `agentName`, then calls the `subagentNode()` factory. The resulting node is added via `.then()`.

**Signature:** `subagent(config: SubAgentConfig<TState>): this`

`SubAgentConfig` fields: `id`, `agent` (mapped to `agentName`), `task` (string or state function), `systemPrompt?`, `model?`, `tools?`, `outputMapper?`, `retry?`, `name?`, `description?`.

#### `.tool(config)` (line 829)

Converts a `ToolBuilderConfig<TState, TArgs, TResult>` (line 135) to a `ToolNodeConfig` (setting `toolName` to `config.toolName ?? config.id`), then calls the `toolNode()` factory. The resulting node is added via `.then()`.

**Signature:** `tool<TArgs, TResult>(config: ToolBuilderConfig<TState, TArgs, TResult>): this`

`ToolBuilderConfig` fields: `id`, `toolName?`, `execute?`, `args?`, `outputMapper?`, `timeout?`, `retry?`, `name?`, `description?`.

#### `.catch(handler)` (line 859)

Registers a global error handler node. Adds the node to the graph and records its ID as `errorHandlerId`. The handler is stored in `config.metadata.errorHandlerId` during compilation (line 908).

**Signature:** `catch(handler: NodeDefinition<TState>): this`

#### `.end()` (line 871)

Marks `currentNodeId` as a terminal node by adding it to `endNodeIds`.

**Signature:** `end(): this`

#### `.compile(config?)` (line 885)

Produces a `CompiledGraph<TState>` from the accumulated state. Steps:
1. Throws if `startNodeId` is null (line 886-888)
2. If `endNodeIds` is empty, auto-discovers terminal nodes by finding nodes with no outgoing edges (lines 891-898)
3. If `errorHandlerId` is set, stores it in `config.metadata.errorHandlerId` (lines 901-911)
4. Returns `{ nodes: Map(copy), edges: [...copy], startNode, endNodes: Set(copy), config }` (lines 913-919)

**Signature:** `compile(config: GraphConfig<TState> = {}): CompiledGraph<TState>`

### Query Methods

- **`getNode(nodeId)`** (line 928): Looks up a node by ID from the internal map.
- **`getEdgesFrom(nodeId)`** (line 938): Filters edges where `e.from === nodeId`.
- **`getEdgesTo(nodeId)`** (line 948): Filters edges where `e.to === nodeId`.

### Standalone Helper Functions

- **`graph<TState>()`** (line 971): Factory that returns `new GraphBuilder<TState>()`.
- **`createNode(id, type, execute, options?)`** (line 988): Standalone version of the private `createNode` method.
- **`createDecisionNode(id, routes, fallback)`** (line 1018): Creates a decision node that iterates through routes and returns `{ goto: route.target }` for the first matching condition, or `{ goto: fallback }`.
- **`createWaitNode(id, prompt)`** (line 1044): Creates a wait node that emits `human_input_required` signal.

---

## 2. Compiled Graph Execution (`src/workflows/graph/compiled.ts`)

### Overview

The `GraphExecutor` class (line 253) takes a `CompiledGraph<TState>` and provides two execution modes: `execute()` for batch completion and `stream()` for step-by-step async iteration. Top-level convenience functions `executeGraph()` (line 871) and `streamGraph()` (line 888) wrap the class.

### Key Types

#### `ExecutionOptions<TState>` (line 50)

| Field | Type | Purpose |
|---|---|---|
| `initialState?` | `Partial<TState>` | Override default state initialization |
| `executionId?` | `string` | Custom execution ID (auto-generated if absent) |
| `resumeFrom?` | `ExecutionSnapshot<TState>` | Snapshot to resume from |
| `abortSignal?` | `AbortSignal` | Cancellation signal |
| `maxSteps?` | `number` | Safety limit on node executions |
| `workflowName?` | `string` | Telemetry label |
| `telemetry?` | `WorkflowTelemetryConfig` | Telemetry configuration |

#### `StepResult<TState>` (line 78)

Yielded after each node execution. Contains `nodeId`, current `state`, the `result` (NodeResult), `status` (ExecutionStatus), optional `error`, `executionTime`, `retryCount`, `modelUsed`, and `emittedEvents`.

#### `ExecutionResult<TState>` (line 121)

Final result of `execute()`. Contains `state`, `status`, and `snapshot`.

### `GraphExecutor<TState>` Class

#### Constructor (line 258)

Takes a `CompiledGraph<TState>`. Merges `DEFAULT_GRAPH_CONFIG` with `graph.config` to form `this.config`. Initializes a `StateValidator` from the graph config via `StateValidator.fromGraphConfig()` (line 265).

#### `execute(options)` (line 274)

Iterates over `this.stream(options)`, collecting each `StepResult`. Breaks on terminal statuses: `"completed"`, `"failed"`, `"cancelled"`, `"paused"`. Returns an `ExecutionResult` containing the final state, status, and a snapshot created by `createSnapshot()` (line 818).

#### `stream(options)` (line 309)

Overloaded:
- Without `modes`: yields `StepResult<TState>` directly from `streamSteps()`.
- With `modes` (via `RoutedExecutionOptions`): wraps `streamSteps()` through `routeStream()` from `stream.ts`, yielding `StreamEvent<TState>`.

The `hasRoutedModes()` function (line 142) distinguishes the overloads by checking for the `modes` property.

#### `streamSteps(options)` -- Core Execution Loop (line 322)

This is the main execution engine. It operates as a queue-based traversal:

1. **Initialization** (lines 325-362):
   - Generates or uses provided `executionId`
   - Sets `maxSteps` (default 1000)
   - Initializes telemetry tracker if configured
   - If `resumeFrom` snapshot exists: restores `state`, `visitedNodes`, `errors`, `signals`, and `nodeQueue` from the snapshot
   - Otherwise: calls `initializeExecutionState()` with `executionId` and optional `initialState`, starts `nodeQueue` with `[this.graph.startNode]`

2. **Main Loop** (lines 367-547): `while (nodeQueue.length > 0 && stepCount < maxSteps)`

   a. **Abort Check** (lines 369-381): If `abortSignal` is aborted, yields a `"cancelled"` status step and returns.

   b. **Node Lookup** (lines 383-394): Shifts the next node ID from the queue. If the node is not found in the graph, records an `ExecutionError` and continues.

   c. **Loop Detection** (lines 397-402): Creates a visit key `"${currentNodeId}:${stepCount}"`. If this exact key was already visited and the node is not a loop node (checked via `isLoopNode()` at line 176, which tests for `"loop_start"` or `"loop_check"` in the node ID), the node is skipped.

   d. **Node Execution** (lines 410-447): Calls `executeWithRetry(node, state, errors, abortSignal)`. On success, extracts `result`. On error, pushes to `errors`, yields a `"failed"` step, tracks telemetry, and returns.

   e. **State Merge** (lines 454-457): If `result.stateUpdate` exists, calls `mergeState(state, result.stateUpdate)` to produce the new state.

   f. **Signal Handling** (lines 464-495):
      - `human_input_required`: yields `"paused"` status and returns
      - `checkpoint`: saves checkpoint if checkpointer is configured

   g. **Auto-Checkpoint** (lines 498-505): If `config.autoCheckpoint` is true and a checkpointer exists, saves after each node.

   h. **Progress Callback** (lines 508-515): Calls `config.onProgress()` with a `"node_completed"` event.

   i. **Next Node Resolution** (lines 518-521): Calls `getNextNodes()` and pushes results onto `nodeQueue`.

   j. **Termination Check** (lines 525-546): A node is considered terminal if it's in `graph.endNodes` AND `nodeQueue` is empty. Yields the step with `"completed"` or `"running"` status accordingly.

3. **Max Steps Exceeded** (lines 550-568): If the loop exits due to `stepCount >= maxSteps`, yields a `"failed"` step with an error message.

#### `resolveModel(node, parentContext?)` (line 578)

Model resolution follows a priority chain:
1. `node.model` if set and not `"inherit"`
2. `parentContext.model` if available
3. `config.defaultModel` if set and not `"inherit"`
4. `undefined` (SDK default)

#### `executeWithRetry(node, state, errors, abortSignal?, parentContext?)` (line 615)

Implements retry logic with exponential backoff:

1. Loops up to `retryConfig.maxAttempts` (default 3 from `DEFAULT_RETRY_CONFIG`)
2. On each attempt:
   - Resolves model via `resolveModel()`
   - Builds `ExecutionContext` with `state`, `config`, `errors`, `abortSignal`, `model`, `emit` function (captures to `emittedEvents` array), and `getNodeOutput` helper
   - Validates node input via `stateValidator.validateNodeInput()` (line 652)
   - Calls `node.execute(context)` (line 655)
   - On success: validates output state via `stateValidator.validateNodeOutput()` and `stateValidator.validate()` (lines 658-660)
   - Returns `{ result, retryCount: attempt - 1, modelUsed, emittedEvents }`
3. On error with `node.onError` handler (line 682): the handler returns an `ErrorAction`:
   - `"skip"`: returns with optional `fallbackState`
   - `"abort"`: rethrows the error
   - `"goto"`: returns `{ goto: nodeId }` (target must have `isRecoveryNode: true`)
   - `"retry"`: uses optional custom delay or falls back to exponential backoff
4. Without `onError`: checks `retryConfig.retryOn` predicate (line 733). If it returns false, throws immediately.
5. Backoff formula: `retryConfig.backoffMs * Math.pow(retryConfig.backoffMultiplier, attempt - 1)` (line 744)

#### `getNextNodes(currentNodeId, state, result)` (line 758)

Determines the next nodes to execute:
1. If `result.goto` is set, uses that (supports single ID or array)
2. Otherwise, filters outgoing edges from `currentNodeId` and evaluates edge conditions
3. Edges without conditions are always followed; conditional edges are followed when `condition(state)` returns true
4. Returns unique target node IDs

#### `saveCheckpoint(checkpointer, executionId, state, label)` (line 792)

Delegates to `checkpointer.save()`. Calls `onProgress` with `"checkpoint_saved"` event. Errors are caught and logged (not propagated).

#### `createSnapshot(stepResult)` (line 818)

Builds an `ExecutionSnapshot` from a step result with `executionId`, `state`, `status`, `currentNodeId`, and error/signal data.

### State Management Functions

#### `initializeExecutionState(executionId, initial?)` (line 188)

Creates a fresh `BaseState` with `executionId`, `lastUpdated` (ISO timestamp), and empty `outputs`. Merges `initial` values, but preserves `executionId` and always overwrites `lastUpdated`. Outputs are shallow-merged.

#### `mergeState(current, update)` (line 219)

Immutably merges `update` into `current`. The `outputs` field is specially handled: if `update.outputs` is defined, it is shallow-merged with `current.outputs` rather than replacing it. `lastUpdated` is always refreshed.

### Convenience Functions

- **`createExecutor(graph)`** (line 857): Returns `new GraphExecutor(graph)`.
- **`executeGraph(graph, options?)`** (line 871): Creates executor and calls `.execute()`.
- **`streamGraph(graph, options?)`** (line 888): Overloaded -- creates executor and delegates to `.stream()`. Returns `StepResult` or `StreamEvent` depending on whether `modes` is present in options.

### Stream Routing (`src/workflows/graph/stream.ts`)

The `StreamRouter` class (line 56) wraps an `AsyncIterable<StepResult>` and projects each step into one or more `StreamEvent` types based on the selected modes:

- `"values"`: emits `{ mode: "values", nodeId, state }`
- `"updates"`: emits `{ mode: "updates", nodeId, update }` (only if `stateUpdate` exists)
- `"events"`: emits one event per `emittedEvent` from the step
- `"debug"`: emits `{ mode: "debug", nodeId, trace }` with execution time, retry count, model, and state snapshot

`routeStream(source, modes)` (line 123) is the convenience wrapper.

---

## 3. Node Types (`src/workflows/graph/nodes.ts`)

### Overview

This module provides factory functions that produce `NodeDefinition<TState>` objects. Each factory accepts a config object, validates it, and returns a node with an `execute` function that operates on `ExecutionContext<TState>`.

### Factory Functions

#### `agentNode(config)` (line 144)

**Config type:** `AgentNodeConfig<TState>` (line 62)

| Field | Type | Required | Default |
|---|---|---|---|
| `id` | `NodeId` | Yes | -- |
| `agentType` | `string` | Yes | -- |
| `systemPrompt` | `string` | No | -- |
| `tools` | `string[]` | No | -- |
| `outputMapper` | `OutputMapper<TState>` | No | Stores messages in `outputs[id]` |
| `sessionConfig` | `Partial<SessionConfig>` | No | -- |
| `retry` | `RetryConfig` | No | `AGENT_NODE_RETRY_CONFIG` (3 attempts, 1s, 2x) |
| `name` | `string` | No | `"${agentType} agent"` |
| `description` | `string` | No | -- |
| `buildMessage` | `(state: TState) => string` | No | Returns `""` |

**Produced NodeDefinition:** type `"agent"`

**Execute behavior** (lines 166-243):
1. Resolves `CodingAgentClient` from `ctx.config.runtime.clientProvider(agentType)` -- throws if not found
2. Builds `SessionConfig` merging `sessionConfig`, resolved model from `ctx.model`, `systemPrompt`, and `tools`
3. Creates session via `client.createSession(fullSessionConfig)`
4. Sends message built from `buildMessage(state)` and streams the response into an `AgentMessage[]` array
5. Gets context usage via `session.getContextUsage()`
6. Maps output via `outputMapper` or stores messages in `outputs[id]`
7. If context usage exceeds `config.contextWindowThreshold`, emits `"context_window_warning"` signal
8. Calls `session.destroy()` in `finally` block

#### `toolNode(config)` (line 343)

**Config type:** `ToolNodeConfig<TState, TArgs, TResult>` (line 279)

| Field | Type | Required | Default |
|---|---|---|---|
| `id` | `NodeId` | Yes | -- |
| `toolName` | `string` | Yes | -- |
| `execute` | `ToolExecuteFn<TArgs, TResult>` | Yes (throws if missing, line 360) | -- |
| `args` | `TArgs \| ((state: TState) => TArgs)` | No | -- |
| `outputMapper` | `ToolOutputMapper<TState, TResult>` | No | Stores result in `outputs[id]` |
| `timeout` | `number` (ms) | No | -- |
| `retry` | `RetryConfig` | No | `DEFAULT_RETRY_CONFIG` |
| `name` | `string` | No | `toolName` |
| `description` | `string` | No | -- |

**Produced NodeDefinition:** type `"tool"`

**Execute behavior** (lines 370-410):
1. Resolves args: if `args` is a function, calls it with `ctx.state`; otherwise uses as-is
2. If `timeout` is set, creates an `AbortController` that aborts after the timeout
3. Calls `execute(resolvedArgs, abortController.signal)`
4. Maps output via `outputMapper` or stores in `outputs[id]`
5. Clears timeout in `finally` block

#### `clearContextNode(config)` (line 468)

**Config type:** `ClearContextNodeConfig<TState>` (line 422)

Fields: `id`, `name?`, `description?`, `message?` (string or state function).

**Produced NodeDefinition:** type `"tool"`, name `"clear-context"`

**Execute behavior** (lines 478-497): Emits a `"context_window_warning"` signal with `usage: 100` and `action: "summarize"` to force summarization.

#### `decisionNode(config)` (line 567)

**Config type:** `DecisionNodeConfig<TState>` (line 525)

Fields: `id`, `routes: DecisionRoute<TState>[]`, `fallback: NodeId`, `name?`, `description?`.

Each `DecisionRoute` (line 509) has `condition: (state) => boolean`, `target: NodeId`, and optional `label`.

**Produced NodeDefinition:** type `"decision"`

**Execute behavior** (lines 577-588): Iterates `routes` in order. Returns `{ goto: route.target }` for the first matching condition. Falls back to `{ goto: fallback }` if none match.

#### `waitNode(config)` (line 657)

**Config type:** `WaitNodeConfig<TState>` (line 610)

Fields: `id`, `prompt` (string or state function), `autoApprove?` (boolean, default `false`), `inputMapper?: InputMapper<TState>`, `name?`, `description?`.

**Produced NodeDefinition:** type `"wait"`

**Execute behavior** (lines 667-691):
- If `autoApprove` is true: applies `inputMapper("")` and continues without signal
- Otherwise: emits `"human_input_required"` signal with the resolved prompt

#### `askUserNode(config)` (line 814)

**Config type:** `AskUserNodeConfig<TState>` (line 726)

Fields: `id`, `options` (static `AskUserOptions` or state function), `name?`, `description?`.

`AskUserOptions` (line 712): `question: string`, `header?: string`, `options?: AskUserOption[]`.

**Produced NodeDefinition:** type `"ask_user"`

**Execute behavior** (lines 824-862):
1. Resolves options (static or function of state)
2. Generates `requestId` via `crypto.randomUUID()`
3. Calls `ctx.emit("human_input_required", eventData)` if `emit` is available
4. Returns state update with wait flags (`__waitingForInput`, `__waitNodeId`, `__askUserRequestId`)
5. Emits `"human_input_required"` signal

#### `parallelNode(config)` (line 967)

**Config type:** `ParallelNodeConfig<TState>` (line 889)

Fields: `id`, `branches: NodeId[]` (must be non-empty), `strategy?: ParallelMergeStrategy` (`"all"` | `"race"` | `"any"`, default `"all"`), `outputMapper?` (or deprecated `merge?`), `name?`, `description?`.

**Produced NodeDefinition:** type `"parallel"`

**Execute behavior** (lines 982-1007):
1. Stores parallel context (branches, strategy, outputMapper) in `outputs[id]` with `_parallel: true` marker
2. Returns `{ goto: branches }` to direct the execution engine to all branch nodes

#### `subgraphNode(config)` (line 1121)

**Config type:** `SubgraphNodeConfig<TState, TSubState>` (line 1040)

Fields: `id`, `subgraph` (`CompiledSubgraph<TSubState>` or workflow name string), `inputMapper?`, `outputMapper?`, `name?`, `description?`.

**Produced NodeDefinition:** type `"subgraph"`

**Execute behavior** (lines 1132-1176):
1. If `subgraph` is a string: resolves via `ctx.config.runtime.workflowResolver` -- throws if resolver is missing or workflow not found
2. If `subgraph` is an object: uses directly
3. Maps parent state to subgraph state via `inputMapper` (or casts state directly)
4. Calls `resolvedSubgraph.execute(subState)`
5. Maps subgraph output back via `outputMapper` or stores in `outputs[id]`

#### `contextMonitorNode(config)` (line 1328)

**Config type:** `ContextMonitorNodeConfig<TState>` (line 1202)

Fields: `id`, `agentType`, `threshold?` (default 45%), `action?` (auto-detected by agent type), `getSession?`, `getContextUsage?`, `onCompaction?`, `name?`, `description?`.

**Produced NodeDefinition:** type `"tool"`, name `"context-monitor"`

**Execute behavior** (lines 1348-1465):
1. Gets context usage from: `customGetContextUsage`, or `getSession().getContextUsage()`, or `ctx.contextWindowUsage`
2. Updates `contextWindowUsage` in state
3. If threshold exceeded, takes action based on `action`:
   - `"summarize"`: calls `session.summarize()`, gets updated usage
   - `"recreate"`: emits signal with `shouldRecreateSession: true`
   - `"warn"`: emits warning signal only
   - `"none"`: does nothing

Default actions by agent type (via `getDefaultCompactionAction()`, line 1262):
- `"opencode"` -> `"summarize"`
- `"claude"` -> `"recreate"`
- `"copilot"` -> `"warn"`

#### `customToolNode(config)` (line 1554)

**Config type:** `CustomToolNodeConfig<TState, TArgs, TResult>` (line 1526)

Fields: `id`, `toolName`, `name?`, `description?`, `inputSchema?` (Zod), `args?`, `outputMapper?`, `timeout?`, `retry?`.

**Produced NodeDefinition:** type `"tool"`

**Execute behavior** (lines 1565-1627):
1. Resolves tool from `getToolRegistry().get(config.toolName)` -- throws if not found
2. Resolves args (static or state function)
3. If `inputSchema` provided, validates via Zod `.safeParse()` -- throws `SchemaValidationError` on failure
4. Builds `WorkflowToolContext` with `sessionID`, `messageID`, `agent: "workflow"`, `directory: process.cwd()`, frozen state snapshot
5. Calls `entry.definition.handler(args, toolContext)`
6. Maps result via `outputMapper` or stores in `outputs[id]`
7. Wraps non-schema errors in `NodeExecutionError`

#### `subagentNode(config)` (line 1664)

**Config type:** `SubagentNodeConfig<TState>` (line 1638)

Fields: `id`, `name?`, `description?`, `agentName`, `task` (string or state function), `systemPrompt?` (string or state function), `model?`, `tools?`, `outputMapper?`, `retry?`.

**Produced NodeDefinition:** type `"agent"`

**Execute behavior** (lines 1673-1726):
1. Gets `subagentBridge` from `ctx.config.runtime` -- throws if missing
2. Gets `subagentRegistry` from `ctx.config.runtime` -- throws if missing
3. Looks up agent entry by `config.agentName` -- throws if not found
4. Resolves `task` and `systemPrompt` (static or state function)
5. Calls `bridge.spawn({ agentId, agentName, task, systemPrompt, model, tools })`
6. Throws if `result.success` is false
7. Maps result via `outputMapper` or stores `result.output` in `outputs[id]`

#### `parallelSubagentNode(config)` (line 1764)

**Config type:** `ParallelSubagentNodeConfig<TState>` (line 1736)

Fields: `id`, `name?`, `description?`, `agents` (array of `{ agentName, task, systemPrompt?, model?, tools? }`), `outputMapper?` (or deprecated `merge?`), `retry?`.

**Produced NodeDefinition:** type `"parallel"`

**Execute behavior** (lines 1780-1808):
1. Gets `subagentBridge` from `ctx.config.runtime` -- throws if missing
2. Maps each agent config to `SubagentSpawnOptions` with unique `agentId` (`${config.id}-${i}-${executionId}`)
3. Calls `bridge.spawnParallel(spawnOptions)` (runs all agents concurrently)
4. Builds a `Map<string, SubagentResult>` keyed by `"${agentName}-${index}"`
5. Calls `outputMapper(resultMap, state)` -- throws at construction time if no outputMapper provided (line 1768)

### Helper Functions

- **`getDefaultCompactionAction(agentType)`** (line 1262): Maps agent type to compaction action.
- **`toContextWindowUsage(usage)`** (line 1281): Converts SDK `ContextUsage` to graph `ContextWindowUsage`.
- **`isContextThresholdExceeded(usage, threshold)`** (line 1297): Returns `usage.usagePercentage >= threshold`.
- **`checkContextUsage(session, options?)`** (line 1486): Gets usage from session and checks threshold.
- **`compactContext(session, agentType)`** (line 1503): Calls `session.summarize()` for opencode agents.

---

## 4. Types (`src/workflows/graph/types.ts`)

### Core Identity and Classification Types

- **`NodeId`** (line 69): `string` -- Unique identifier for graph nodes.
- **`ModelSpec`** (line 91): `string | "inherit"` -- LLM model specification. `"inherit"` means use parent/graph-level model.
- **`NodeType`** (line 104): `"agent" | "tool" | "decision" | "wait" | "ask_user" | "subgraph" | "parallel"` -- Enumeration of supported node types.

### State Management

#### `BaseState` (line 114)

The root state interface all workflow states must extend.

| Field | Type | Purpose |
|---|---|---|
| `executionId` | `string` | Unique execution instance ID |
| `lastUpdated` | `string` | ISO timestamp of last state update |
| `outputs` | `Record<NodeId, unknown>` | Node outputs keyed by node ID |

#### `ContextWindowUsage` (line 126)

Tracks token consumption: `inputTokens`, `outputTokens`, `maxTokens`, `usagePercentage` (0-100).

### Signals

#### `Signal` (line 149)

Union type: `"context_window_warning" | "checkpoint" | "human_input_required" | "debug_report_generated"`.

#### `SignalData` (line 158)

Contains `type: Signal`, optional `message: string`, and optional `data: Record<string, unknown>`.

### Error Handling

#### `ExecutionError` (line 174)

Records a node execution failure: `nodeId`, `error` (Error or string), `timestamp` (ISO), `attempt` (1-based).

#### `RetryConfig` (line 188)

| Field | Type | Default |
|---|---|---|
| `maxAttempts` | `number` | 3 |
| `backoffMs` | `number` | 1000 |
| `backoffMultiplier` | `number` | 2 |
| `retryOn?` | `(error: Error) => boolean` | All errors retried |

#### `ErrorAction<TState>` (line 205)

Discriminated union returned by `onError` handlers:
- `{ action: "retry"; delay?: number }` -- retry with optional custom delay
- `{ action: "skip"; fallbackState?: Partial<TState> }` -- skip node with fallback
- `{ action: "abort"; error?: Error }` -- abort execution
- `{ action: "goto"; nodeId: NodeId }` -- jump to recovery node

#### `DebugReport` (line 215)

Diagnostic information: `errorSummary`, `stackTrace?`, `relevantFiles`, `suggestedFixes`, `generatedAt`, `nodeId?`, `executionId?`.

### Node Execution Types

#### `NodeResult<TState>` (line 242)

Return type from node execute functions:
- `stateUpdate?: Partial<TState>` -- state changes to merge
- `goto?: NodeId | NodeId[]` -- override next node(s)
- `signals?: SignalData[]` -- execution flow signals

#### `ExecutionContext<TState>` (line 267)

Provided to every node execution:

| Field | Type | Purpose |
|---|---|---|
| `state` | `TState` | Current workflow state |
| `config` | `GraphConfig` | Graph configuration |
| `errors` | `ExecutionError[]` | Accumulated errors |
| `abortSignal?` | `AbortSignal` | Cancellation signal |
| `contextWindowUsage?` | `ContextWindowUsage` | Current token usage |
| `contextWindowThreshold?` | `number` | Threshold percentage |
| `emit?` | `(type, data?) => void` | Custom event emitter |
| `getNodeOutput?` | `(nodeId) => unknown` | Access previous node outputs |
| `model?` | `string` | Resolved model for this context |

#### `NodeExecuteFn<TState>` (line 314)

Type alias: `(context: ExecutionContext<TState>) => Promise<NodeResult<TState>>`.

#### `NodeDefinition<TState>` (line 323)

The complete node specification:

| Field | Type | Required |
|---|---|---|
| `id` | `NodeId` | Yes |
| `type` | `NodeType` | Yes |
| `execute` | `NodeExecuteFn<TState>` | Yes |
| `inputSchema?` | `z.ZodType<TState>` | No |
| `outputSchema?` | `z.ZodType<TState>` | No |
| `retry?` | `RetryConfig` | No |
| `onError?` | `(error, context) => ErrorAction \| Promise<ErrorAction>` | No |
| `isRecoveryNode?` | `boolean` | No |
| `name?` | `string` | No |
| `description?` | `string` | No |
| `model?` | `ModelSpec` | No |

### Graph Configuration

#### `ProgressEvent<TState>` (line 379)

Progress callback payload: `type` (`"node_started" | "node_completed" | "node_error" | "checkpoint_saved"`), `nodeId`, `state`, `error?`, `timestamp`.

#### `GraphRuntimeDependencies` (line 396)

Runtime services injected by `WorkflowSDK.init()`:
- `clientProvider?: (agentType: string) => CodingAgentClient | null`
- `workflowResolver?: (name: string) => RuntimeSubgraph | null`
- `subagentBridge?: { spawn(...), spawnParallel(...) }`
- `subagentRegistry?: { get(name), getAll() }`

#### `GraphConfig<TState>` (line 414)

| Field | Type | Default |
|---|---|---|
| `checkpointer?` | `Checkpointer<TState>` | None (in-memory only) |
| `maxConcurrency?` | `number` | 1 |
| `timeout?` | `number` (ms) | No limit |
| `onProgress?` | `(event: ProgressEvent<TState>) => void` | -- |
| `contextWindowThreshold?` | `number` | 45 |
| `autoCheckpoint?` | `boolean` | `true` |
| `metadata?` | `Record<string, unknown>` | -- |
| `defaultModel?` | `ModelSpec` | -- |
| `outputSchema?` | `z.ZodType<TState>` | -- |
| `runtime?` | `GraphRuntimeDependencies` | -- |

### Edge Definitions

#### `EdgeCondition<TState>` (line 488)

Type alias: `(state: TState) => boolean`.

#### `Edge<TState>` (line 497)

Directed edge: `from: NodeId`, `to: NodeId`, `condition?: EdgeCondition<TState>`, `label?: string`.

### Compiled Graph

#### `CompiledGraph<TState>` (line 521)

The compiled graph ready for execution:
- `nodes: Map<NodeId, NodeDefinition<TState>>` -- all node definitions
- `edges: Edge<TState>[]` -- all edges
- `startNode: NodeId` -- entry point
- `endNodes: Set<NodeId>` -- terminal nodes
- `config: GraphConfig<TState>` -- graph configuration

### Execution State

#### `ExecutionStatus` (line 541)

Union: `"pending" | "running" | "paused" | "completed" | "failed" | "cancelled"`.

#### `ExecutionSnapshot<TState>` (line 555)

Full snapshot for checkpointing/resumption:
- `executionId`, `state`, `status`, `currentNodeId?`, `visitedNodes: NodeId[]`, `errors: ExecutionError[]`, `signals: SignalData[]`, `startedAt`, `updatedAt`, `completedAt?`, `nodeExecutionCount`

### Checkpointer Interface (line 30)

| Method | Signature |
|---|---|
| `save` | `(executionId: string, state: TState, label?: string) => Promise<void>` |
| `load` | `(executionId: string) => Promise<TState \| null>` |
| `list` | `(executionId: string) => Promise<string[]>` |
| `delete` | `(executionId: string, label?: string) => Promise<void>` |

### Type Guards

- **`isNodeType(value)`** (line 587): Checks if value is a valid `NodeType`.
- **`isSignal(value)`** (line 597): Checks if value is a valid `Signal`.
- **`isExecutionStatus(value)`** (line 612): Checks if value is a valid `ExecutionStatus`.
- **`isBaseState(value)`** (line 624): Checks for `executionId`, `lastUpdated`, and `outputs` fields.
- **`isNodeResult(value)`** (line 640): Validates optional `stateUpdate`, `goto`, and `signals` fields.
- **`isDebugReport(value)`** (line 661): Checks for `errorSummary`, `relevantFiles`, `suggestedFixes`, `generatedAt`.

### Utility Types

- **`StateOf<T>`** (line 681): Extracts `TState` from a `NodeDefinition<TState>`.
- **`StateUpdate<TState>`** (line 686): `Partial<Omit<TState, keyof BaseState>> & { outputs?: Record<NodeId, unknown> }`.

### Constants

| Name | Value | Line |
|---|---|---|
| `BACKGROUND_COMPACTION_THRESHOLD` | `0.45` | 691 |
| `BUFFER_EXHAUSTION_THRESHOLD` | `0.6` | 693 |
| `DEFAULT_RETRY_CONFIG` | `{ maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2 }` | 698 |
| `DEFAULT_GRAPH_CONFIG` | `{ maxConcurrency: 1, contextWindowThreshold: 45, autoCheckpoint: true }` | 707 |

### Error Types (`src/workflows/graph/errors.ts`)

- **`SchemaValidationError`** (line 16): Extends `Error` with `zodError: ZodError`. Thrown when Zod schema validation fails.
- **`NodeExecutionError`** (line 30): Extends `Error` with `nodeId: string` and optional `cause: Error`. Wraps runtime tool/agent failures.
- **`ErrorFeedback`** (line 44): Interface for error context injected into retry attempts: `failedNodeId`, `errorMessage`, `errorType`, `attempt`, `maxAttempts`, `previousOutput?`.

---

## Data Flow Summary

```
graph<TState>()           GraphBuilder
  .start(node)               |
  .then(node)                |-- accumulates nodes/edges
  .loop(body, config)        |
  .if(cond).then().endif()   |
  .end()                     |
  .compile(config)        CompiledGraph<TState>
                              |
              createExecutor(compiledGraph)
                              |
                        GraphExecutor<TState>
                              |
              .execute()  or  .stream()
                              |
                        streamSteps()  [AsyncGenerator]
                              |
          +---------+---------+---------+
          |         |         |         |
      init state  node queue  retry   signals
          |         |         |         |
          v         v         v         v
      mergeState  getNextNodes  executeWithRetry  checkpoint/pause
```

1. **Build phase**: `GraphBuilder` accumulates `NodeDefinition` objects and `Edge` objects via fluent calls.
2. **Compile phase**: `.compile()` copies internal maps/arrays into a frozen `CompiledGraph` object with auto-discovered end nodes.
3. **Execute phase**: `GraphExecutor.streamSteps()` runs a queue-based traversal. Each node is executed via `executeWithRetry()`, state is merged via `mergeState()`, and next nodes are determined by `getNextNodes()` (edges + conditions + `result.goto`).
4. **Loops**: Loop check nodes use conditional back-edges to the first body node. The `isLoopNode()` check in the executor allows re-visiting loop infrastructure nodes.
5. **Conditionals**: Decision nodes route via conditional edges created by `.endif()`. Merge nodes rejoin branches.
6. **Signals**: Nodes can emit signals (`human_input_required`, `checkpoint`, `context_window_warning`) that alter execution flow.
7. **Streaming**: `StreamRouter` projects `StepResult` items into typed `StreamEvent` objects based on requested modes.
