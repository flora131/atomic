# Graph Execution Engine - Technical Documentation

**Document Version:** 1.0  
**Last Updated:** 2024  
**Purpose:** Comprehensive technical analysis of the graph execution engine implementation

---

## Table of Contents

1. [GraphBuilder (builder.ts)](#1-graphbuilder-builderts)
2. [GraphExecutor (compiled.ts)](#2-graphexecutor-compiledts)
3. [Type System (types.ts)](#3-type-system-typests)
4. [Node Factories (nodes.ts)](#4-node-factories-nodests)
5. [Error Handling (errors.ts)](#5-error-handling-errorsts)
6. [Data Flow Summary](#6-data-flow-summary)

---

## 1. GraphBuilder (builder.ts)

### Overview

The `GraphBuilder` class at `src/graph/builder.ts` provides a fluent API for constructing graph-based workflows declaratively. It manages nodes, edges, and control flow structures (conditionals, loops, parallel execution), then compiles them into an executable `CompiledGraph`.

### 1.1 Core State Management

#### Private Fields (lines 138-159)

```typescript
private nodes: Map<NodeId, NodeDefinition<TState>> = new Map();
private edges: Edge<TState>[] = [];
private startNodeId: NodeId | null = null;
private endNodeIds: Set<NodeId> = new Set();
private currentNodeId: NodeId | null = null;
private conditionalStack: ConditionalBranch<TState>[] = [];
private nodeCounter = 0;
private errorHandlerId: NodeId | null = null;
```

**Data Structures:**
- `nodes`: Map storing all node definitions by ID
- `edges`: Array of edge objects connecting nodes
- `startNodeId`: Entry point for graph execution
- `endNodeIds`: Set of terminal nodes
- `currentNodeId`: Tracks the current position for chaining operations
- `conditionalStack`: Stack for nested if/else structures
- `nodeCounter`: Incremental counter for unique ID generation
- `errorHandlerId`: Optional global error handler node

### 1.2 Configuration Types

#### LoopConfig (lines 38-50)

```typescript
export interface LoopConfig<TState extends BaseState = BaseState> {
  until: EdgeCondition<TState>;
  maxIterations?: number; // Default: 100
}
```

**Purpose:** Configures loop exit conditions and safety limits.

- `until`: Function returning `true` when loop should exit
- `maxIterations`: Safety limit to prevent infinite loops (default: 100)

#### ParallelConfig (lines 66-86)

```typescript
export interface ParallelConfig<TState extends BaseState = BaseState> {
  branches: NodeId[];
  strategy?: MergeStrategy; // "all" | "race" | "any"
  merge?: (results: Map<NodeId, unknown>, state: TState) => Partial<TState>;
}
```

**Purpose:** Configures parallel branch execution.

- `branches`: Array of node IDs to execute concurrently
- `strategy`: Controls completion behavior:
  - `"all"` (default): Wait for all branches (Promise.all semantics)
  - `"race"`: Wait for first branch (Promise.race semantics)
  - `"any"`: Wait for first success (Promise.any semantics)
- `merge`: Optional function to combine branch results into state

#### ConditionalBranch (lines 95-110)

**Internal structure for tracking if/else state:**

```typescript
interface ConditionalBranch<TState> {
  decisionNodeId: NodeId;
  condition: EdgeCondition<TState>;
  ifBranchStart?: NodeId;
  ifBranchEnd?: NodeId;
  elseBranchStart?: NodeId;
  elseBranchEnd?: NodeId;
  inElseBranch: boolean;
}
```

**Usage:** Pushed to `conditionalStack` by `if()` at line 294, popped by `endif()` at line 339.

### 1.3 Builder Methods

#### start() (lines 221-231)

**Flow:**
1. Validates that `startNodeId` is null (line 222)
2. Adds node to graph via `addNode()` (line 226)
3. Sets `startNodeId` and `currentNodeId` to new node's ID (lines 227-228)
4. Returns `this` for chaining (line 230)

**State Changes:**
- `startNodeId`: `null` → `node.id`
- `currentNodeId`: `null` → `node.id`
- `nodes`: Adds entry for `node.id`

#### then() (lines 240-269)

**Flow:**
1. If no start node exists, delegates to `start()` (line 244)
2. Adds node via `addNode()` (line 247)
3. Checks for conditional branch context (line 250)
4. If in conditional branch and `currentNodeId` is null:
   - Sets `ifBranchStart` or `elseBranchStart` based on `inElseBranch` flag (lines 254-260)
5. If `currentNodeId` is not null, creates edge from current to new node (line 263)
6. Updates `currentNodeId` to new node's ID (line 266)
7. Returns `this` for chaining (line 268)

**Edge Creation:** Line 263 calls `addEdge(this.currentNodeId, node.id)`, appending to `edges` array.

#### if() (lines 277-305)

**Flow:**
1. Validates `currentNodeId` is not null (line 278)
2. Generates unique decision node ID via `generateNodeId("decision")` (line 283)
3. Creates decision node with no-op execute function (lines 284-288)
4. Adds decision node and edge from current node (lines 290-291)
5. Pushes `ConditionalBranch` onto stack with:
   - `decisionNodeId`: The generated ID
   - `condition`: The provided condition function
   - `inElseBranch`: `false`
6. Sets `currentNodeId = null` to signal next `then()` starts branch (line 302)

**Key Detail:** The decision node itself doesn't evaluate conditions—edge conditions at `endif()` handle routing.

#### else() (lines 311-331)

**Flow:**
1. Pops current branch from stack (line 313)
2. Validates branch exists and not already in else (lines 315-321)
3. Records `ifBranchEnd = currentNodeId` (line 324)
4. Sets `inElseBranch = true` (line 325)
5. Resets `currentNodeId = null` for else branch start (line 328)

#### endif() (lines 338-391)

**Flow:**
1. Pops branch from `conditionalStack` (line 339)
2. Records branch end: `elseBranchEnd` or `ifBranchEnd` depending on state (lines 346-350)
3. Creates merge node (lines 353-355)
4. Adds conditional edges:
   - From decision node to `ifBranchStart` with `condition` (line 359)
   - From decision node to `elseBranchStart` with `!condition` (line 366)
   - Or directly to merge node if no else branch (lines 370-376)
5. Connects branch ends to merge node (lines 380-386)
6. Sets `currentNodeId = mergeNodeId` (line 388)

**Edge Labeling:** Uses `"if-true"` and `"if-false"` labels (lines 359, 367) for visualization.

#### parallel() (lines 399-434)

**Flow:**
1. Generates parallel node ID (line 400)
2. Creates parallel node that stores config in state outputs (lines 402-416)
3. Adds node and connects from current node (lines 418-424)
4. Creates edges to all branch nodes with labels `"parallel-{branchId}"` (lines 427-429)
5. Sets `currentNodeId = parallelNodeId` (line 431)

**State Storage:** Line 408 stores parallel config in `state.outputs[parallelNodeId]` for execution engine access.

#### loop() (lines 456-546)

**Flow:**
1. Normalizes `bodyNodes` to array (line 461)
2. Generates `loopStartId` and `loopCheckId` (lines 467-468)
3. Creates loop start node that initializes iteration counter in state (lines 472-484)
4. Creates loop check node that increments iteration counter (lines 487-500)
5. Adds all nodes to graph (lines 503-507)
6. Connects current node to loop start (lines 510-514)
7. Chains body nodes together sequentially (lines 521-523)
8. Creates loop structure: `start → first body → ... → last body → check` (lines 526-527)
9. Adds conditional edge from check back to first body node when:
   - `!config.until(state)` AND
   - `currentIteration < maxIterations`
   (lines 531-540)
10. Sets `currentNodeId = loopCheckId` for next node to connect to exit edge (line 543)

**Iteration Tracking:** Uses key `${loopStartId}_iteration` in `state.outputs` (lines 473, 488).

**Loop Structure:** When continuing, returns to the **first** body node (line 533), not the loop start.

#### wait() (lines 554-574)

**Flow:**
1. If `promptOrNode` is string, creates wait node that emits `human_input_required` signal (lines 559-568)
2. Otherwise uses provided node directly (line 570)
3. Delegates to `then()` for node addition (line 573)

**Signal Structure:** Line 562-565 creates signal with `type: "human_input_required"` and `message: promptOrNode`.

#### catch() (lines 582-587)

**Flow:**
1. Adds handler node to graph (line 583)
2. Sets `errorHandlerId = handler.id` (line 584)
3. Returns `this` for chaining (line 586)

**Note:** Error routing is handled by execution engine, not by explicit edges. The ID is stored in config metadata (line 631).

#### end() (lines 593-600)

**Flow:**
1. If `currentNodeId` is not null, adds to `endNodeIds` set (line 596)
2. Returns `this` for chaining (line 598)

**Purpose:** Marks terminal nodes explicitly. If not called, `compile()` auto-detects nodes without outgoing edges.

#### compile() (lines 608-643)

**Flow:**
1. Validates `startNodeId` is not null (line 609)
2. If `endNodeIds` is empty, finds nodes without outgoing edges (lines 614-620):
   - Creates set of source nodes from all edges (line 616)
   - Adds nodes not in this set to `endNodeIds` (lines 617-620)
3. If `errorHandlerId` is set, adds to config metadata (lines 624-634)
4. Returns `CompiledGraph` object with:
   - `nodes`: Cloned map of node definitions
   - `edges`: Cloned edge array
   - `startNode`: The start node ID
   - `endNodes`: Cloned set of end node IDs
   - `config`: Merged configuration with metadata

**Return Type:** `CompiledGraph<TState>` (line 636)

### 1.4 Helper Methods

#### generateNodeId() (lines 164-166)

**Implementation:**
```typescript
private generateNodeId(prefix: string = "node"): NodeId {
  return `${prefix}_${++this.nodeCounter}`;
}
```

**Generates:** `"prefix_N"` where N is incrementing counter.

#### addNode() (lines 171-176)

**Validation:** Throws error if node ID already exists (line 172).

**Action:** Adds to `nodes` map (line 175).

#### addEdge() (lines 181-188)

**Parameters:**
- `from`: Source node ID
- `to`: Target node ID
- `condition`: Optional edge condition function
- `label`: Optional label for visualization

**Action:** Appends edge object to `edges` array (line 187).

#### createNode() (lines 193-209)

**Purpose:** Factory for creating `NodeDefinition` objects.

**Returns:** Object with `id`, `type`, `execute`, and optional `name`, `description`, `retry` fields.

### 1.5 Query Methods

#### getNode() (lines 651-653)

Returns node definition by ID or `undefined`.

#### getEdgesFrom() (lines 661-663)

Filters `edges` array for edges with `from === nodeId`.

#### getEdgesTo() (lines 671-673)

Filters `edges` array for edges with `to === nodeId`.

---

## 2. GraphExecutor (compiled.ts)

### Overview

The `GraphExecutor` class at `src/graph/compiled.ts` executes compiled graphs using breadth-first traversal with state management, retry logic, checkpointing, and signal handling.

### 2.1 Core Architecture

#### Class Structure (lines 213-224)

```typescript
export class GraphExecutor<TState extends BaseState = BaseState> {
  private readonly graph: CompiledGraph<TState>;
  private readonly config: GraphConfig<TState>;

  constructor(graph: CompiledGraph<TState>) {
    this.graph = graph;
    this.config = { ...DEFAULT_GRAPH_CONFIG, ...graph.config };
  }
}
```

**Initialization:** Merges `DEFAULT_GRAPH_CONFIG` with graph-specific config (line 222).

### 2.2 Execution Methods

#### execute() (lines 232-258)

**High-Level Flow:**
1. Iterates over `stream()` generator (line 235)
2. Stores each `StepResult` in `lastResult` (line 236)
3. Breaks on terminal states: `completed`, `failed`, `cancelled`, `paused` (lines 238-246)
4. Validates result exists (lines 249-251)
5. Returns `ExecutionResult` with final state, status, and snapshot (lines 253-257)

**Return Type:** `Promise<ExecutionResult<TState>>` containing:
- `state`: Final workflow state
- `status`: Terminal execution status
- `snapshot`: Complete execution snapshot

#### stream() (lines 266-501)

**Generator Function:** `async *stream()` yields `StepResult<TState>` after each node execution.

**Initialization (lines 267-307):**

1. **Generate execution ID** (line 267):
   ```typescript
   const executionId = options.executionId ?? generateExecutionId();
   ```
   Uses `options.executionId` or generates via `generateExecutionId()` (line 116).

2. **Set max steps** (line 268):
   ```typescript
   const maxSteps = options.maxSteps ?? 1000;
   ```

3. **Initialize telemetry** (lines 272-282):
   - Creates `WorkflowTracker` if `options.telemetry` provided (lines 272-274)
   - Tracks workflow start with name and metadata (lines 277-282)

4. **Initialize or resume state** (lines 285-304):

   **If resuming from snapshot** (lines 292-299):
   ```typescript
   state = snapshot.state;
   visitedNodes = [...snapshot.visitedNodes];
   errors = [...snapshot.errors];
   signals = [...snapshot.signals];
   nodeQueue = snapshot.currentNodeId ? [snapshot.currentNodeId] : [];
   ```

   **If fresh start** (lines 300-304):
   ```typescript
   state = initializeExecutionState<TState>(executionId, options.initialState);
   nodeQueue = [this.graph.startNode];
   ```

5. **Initialize loop detection** (line 307):
   ```typescript
   const executionVisited = new Set<string>();
   ```

**Main Execution Loop (lines 309-500):**

**While condition** (line 309): `nodeQueue.length > 0 && stepCount < maxSteps`

**Abort check** (lines 311-323):
- Checks `options.abortSignal?.aborted`
- If aborted, tracks cancellation and yields `cancelled` status
- Returns early

**Node retrieval** (lines 325-336):
1. Shifts next node ID from queue (line 325)
2. Gets node definition from `graph.nodes` map (line 326)
3. If not found, records error and continues to next iteration (lines 328-336)

**Loop detection** (lines 338-344):
1. Creates visit key: `"${currentNodeId}:${stepCount}"` (line 339)
2. If already visited AND not loop node, skips (lines 340-343)
3. Adds visit key to `executionVisited` set (line 344)
4. Uses `isLoopNode()` helper to exempt loop nodes from check (line 340)

**Node execution** (lines 346-392):

1. **Track node enter** (lines 347-350):
   ```typescript
   const nodeStartTime = Date.now();
   if (tracker) tracker.nodeEnter(currentNodeId, node.type);
   ```

2. **Execute with retry** (line 357):
   ```typescript
   result = await this.executeWithRetry(node, state, errors, options.abortSignal);
   ```

3. **Handle errors** (lines 358-387):
   - Creates `ExecutionError` object (lines 359-364)
   - Pushes to `errors` array (line 365)
   - Tracks telemetry (lines 368-377)
   - Yields `failed` status with error (lines 379-386)
   - Returns to stop execution (line 387)

4. **Track node exit** (lines 390-392)

**State update** (lines 395-397):
```typescript
if (result.stateUpdate) {
  state = mergeState(state, result.stateUpdate);
}
```
Uses `mergeState()` helper for immutable merge (line 396).

**Tracking** (lines 400-401):
```typescript
visitedNodes.push(currentNodeId);
stepCount++;
```

**Signal handling** (lines 404-431):

1. **Human input signal** (lines 408-419):
   - Searches for `human_input_required` signal (lines 408-410)
   - If found, yields `paused` status and returns (lines 411-419)

2. **Checkpoint signal** (lines 422-430):
   - Searches for `checkpoint` signal (line 422)
   - If found AND checkpointer exists, saves checkpoint (lines 423-430)

3. **Auto-checkpoint** (lines 433-441):
   - If `config.autoCheckpoint` enabled and checkpointer exists
   - Saves checkpoint with label `"step_${stepCount}"` (lines 435-440)

**Progress callback** (lines 444-451):
- Calls `config.onProgress()` if defined (lines 444-451)
- Emits event with type `"node_completed"`, nodeId, state, and timestamp

**Next node determination** (line 454):
```typescript
const nextNodes = this.getNextNodes(currentNodeId, state, result);
```

**Queue update** (line 457):
```typescript
nodeQueue.push(...nextNodes);
```

**End node detection** (lines 461-462):
```typescript
const isEndNode = this.graph.endNodes.has(currentNodeId) && nodeQueue.length === 0;
```

**Completion tracking** (lines 465-467):
- If end node reached, tracks completion BEFORE yield (lines 465-467)

**Yield result** (lines 469-474):
```typescript
yield {
  nodeId: currentNodeId,
  state,
  result,
  status: isEndNode ? "completed" : "running",
};
```

**Early return on completion** (lines 476-478)

**Max steps exceeded** (lines 482-500):
- Tracks error telemetry (lines 484-487)
- Yields `failed` status with error (lines 488-500)

### 2.3 Model Resolution

#### resolveModel() (lines 510-542)

**Purpose:** Determines which LLM model to use for a node based on hierarchy.

**Resolution Order (lines 526-538):**

1. **Node-level model** (lines 527-529):
   ```typescript
   if (node.model && node.model !== "inherit") {
     result = node.model;
   }
   ```

2. **Parent context model** (lines 531-533):
   ```typescript
   else if (parentContext?.model) {
     result = parentContext.model;
   }
   ```

3. **Graph default model** (lines 535-537):
   ```typescript
   else if (this.config.defaultModel && this.config.defaultModel !== "inherit") {
     result = this.config.defaultModel;
   }
   ```

4. **Undefined** (line 539):
   - Returns `undefined` to let SDK use its default

**Debug Logging:** Lines 517-522 and 540 log resolution details to console.

**Return Type:** `string | undefined`

### 2.4 Retry Logic

#### executeWithRetry() (lines 547-617)

**Parameters:**
- `node`: Node definition to execute
- `state`: Current state
- `errors`: Array of execution errors
- `abortSignal`: Optional abort signal
- `parentContext`: Optional parent execution context

**Retry Configuration:** Lines 554-555 get retry config from node or default:
```typescript
const retryConfig = node.retry ?? DEFAULT_RETRY_CONFIG;
```

**Retry Loop (lines 558-614):**

**While condition** (line 558): `attempt < retryConfig.maxAttempts`

**Attempt counter:** Line 559 increments before each try (1-based).

**Try block (lines 561-592):**

1. **Resolve model** (line 563):
   ```typescript
   const resolvedModel = this.resolveModel(node, parentContext);
   ```

2. **Build execution context** (lines 566-577):
   ```typescript
   const context: ExecutionContext<TState> = {
     state,
     config: this.config as unknown as GraphConfig,
     errors,
     abortSignal,
     model: resolvedModel,
     emit: (_signal) => { /* Signals collected in result */ },
     getNodeOutput: (nodeId) => state.outputs[nodeId],
   };
   ```

3. **Execute node** (line 580):
   ```typescript
   const result = await node.execute(context);
   ```

4. **Emit progress** (lines 583-590):
   - Calls `config.onProgress()` if defined
   - Emits `"node_started"` event

5. **Return result** (line 592)

**Catch block (lines 593-613):**

1. **Capture error** (line 594):
   ```typescript
   lastError = error instanceof Error ? error : new Error(String(error));
   ```

2. **Check retry condition** (lines 597-599):
   ```typescript
   if (retryConfig.retryOn && !retryConfig.retryOn(lastError)) {
     throw lastError;
   }
   ```

3. **Last attempt check** (lines 602-604):
   - If `attempt >= maxAttempts`, throws error

4. **Calculate backoff** (lines 607-609):
   ```typescript
   const delay = retryConfig.backoffMs * Math.pow(retryConfig.backoffMultiplier, attempt - 1);
   ```
   **Formula:** `backoffMs × (backoffMultiplier ^ (attempt - 1))`
   
   **Example:** With defaults (backoffMs=1000, multiplier=2):
   - Attempt 1: 1000ms (1s)
   - Attempt 2: 2000ms (2s)
   - Attempt 3: 4000ms (4s)

5. **Sleep before retry** (line 612):
   ```typescript
   await sleep(delay);
   ```

**Post-loop error** (line 616):
- Throws `lastError` if all attempts exhausted

### 2.5 Edge Evaluation

#### getNextNodes() (lines 622-651)

**Purpose:** Determines which nodes to execute next based on edges and node result.

**Override handling (lines 628-630):**
```typescript
if (result.goto) {
  return Array.isArray(result.goto) ? result.goto : [result.goto];
}
```
If node returns `goto`, uses that directly (single node or array).

**Edge filtering (line 633):**
```typescript
const outgoingEdges = this.graph.edges.filter((e) => e.from === currentNodeId);
```

**Empty check (lines 635-637):**
- Returns empty array if no outgoing edges

**Conditional evaluation (lines 640-646):**

```typescript
const matchingEdges: Edge<TState>[] = [];

for (const edge of outgoingEdges) {
  if (!edge.condition || edge.condition(state)) {
    matchingEdges.push(edge);
  }
}
```

**Logic:**
- If edge has no condition, includes it
- If edge has condition AND condition returns true, includes it
- Evaluates conditions with current state

**Deduplication (lines 649-650):**
```typescript
const targets = new Set(matchingEdges.map((e) => e.to));
return Array.from(targets);
```

**Purpose:** Multiple edges may target same node; set ensures each node queued once.

### 2.6 Checkpointing

#### saveCheckpoint() (lines 656-677)

**Flow:**
1. Calls `checkpointer.save(executionId, state, label)` (line 663)
2. If successful, emits progress event (lines 665-671)
3. If error, logs but doesn't fail (line 675)

**Error Handling:** Catches checkpoint errors to prevent workflow failure (lines 662-676).

#### createSnapshot() (lines 682-695)

**Purpose:** Creates `ExecutionSnapshot` from step result.

**Returns:**
```typescript
{
  executionId: stepResult.state.executionId,
  state: stepResult.state,
  status: stepResult.status,
  currentNodeId: stepResult.nodeId,
  visitedNodes: [], // Would need tracking during execution
  errors: stepResult.error ? [stepResult.error] : [],
  signals: stepResult.result.signals ?? [],
  startedAt: stepResult.state.lastUpdated,
  updatedAt: now(),
  nodeExecutionCount: 0, // Would need tracking
}
```

**Note:** Some fields return placeholder values (empty arrays, 0) due to incomplete tracking.

### 2.7 Helper Functions

#### generateExecutionId() (lines 115-117)

**Format:** `"exec_{timestamp}_{random}"` where random is 7-character alphanumeric.

**Implementation:**
```typescript
return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
```

#### now() (lines 122-124)

**Returns:** ISO 8601 timestamp via `new Date().toISOString()`.

#### sleep() (lines 129-131)

**Implementation:**
```typescript
return new Promise((resolve) => setTimeout(resolve, ms));
```

#### isLoopNode() (lines 136-138)

**Logic:**
```typescript
return nodeId.includes("loop_start") || nodeId.includes("loop_check");
```

**Purpose:** Identifies loop-related nodes for exemption from duplicate visit detection.

#### initializeExecutionState() (lines 148-169)

**Flow:**
1. Creates base state with `executionId`, `lastUpdated`, `outputs` (lines 153-157)
2. Extracts initial outputs from partial state (line 160)
3. Merges base state with initial values (lines 162-167)
4. Ensures `executionId` and `lastUpdated` not overwritten (lines 166-167)

**Return Type:** Fully initialized `TState` extending `BaseState`.

#### mergeState() (lines 179-195)

**Flow:**
1. Handles outputs specially—merges rather than replaces (lines 184-187):
   ```typescript
   const outputs = update.outputs !== undefined
     ? { ...current.outputs, ...update.outputs }
     : current.outputs;
   ```
2. Spreads current state, update, merged outputs (lines 189-193)
3. Always updates `lastUpdated` to current time (line 193)

**Immutability:** Creates new object; never mutates `current` or `update`.

---

## 3. Type System (types.ts)

### Overview

The type system at `src/graph/types.ts` defines all core types for the graph execution engine, including state management, node definitions, execution context, and graph structure.

### 3.1 Base Types

#### NodeId (line 64)

```typescript
export type NodeId = string;
```

**Purpose:** Unique identifier for nodes. Used throughout for referencing nodes in edges and control flow.

#### NodeType (line 99)

```typescript
export type NodeType = "agent" | "tool" | "decision" | "wait" | "ask_user" | "subgraph" | "parallel";
```

**Node Types:**
- `agent`: AI agent session execution
- `tool`: Function/tool execution
- `decision`: Conditional routing
- `wait`: Legacy human input pause
- `ask_user`: Structured human input with options
- `subgraph`: Nested graph execution
- `parallel`: Concurrent branch execution

#### ModelSpec (line 86)

```typescript
export type ModelSpec = string | "inherit";
```

**Special Values:**
- `"inherit"`: Use model from parent context or graph default
- Otherwise: SDK-specific model identifier (e.g., `"claude-3-5-sonnet-20241022"`)

### 3.2 State Management

#### BaseState (lines 109-116)

```typescript
export interface BaseState {
  executionId: string;
  lastUpdated: string;
  outputs: Record<NodeId, unknown>;
}
```

**Required Fields:**
- `executionId`: Unique execution instance identifier
- `lastUpdated`: ISO timestamp of last state update
- `outputs`: Map of node outputs keyed by node ID

**Extension:** All workflow states must extend this interface.

#### ContextWindowUsage (lines 121-130)

```typescript
export interface ContextWindowUsage {
  inputTokens: number;
  outputTokens: number;
  maxTokens: number;
  usagePercentage: number;
}
```

**Purpose:** Tracks token consumption for context window monitoring.

### 3.3 Signals

#### Signal (line 144)

```typescript
export type Signal =
  | "context_window_warning"
  | "checkpoint"
  | "human_input_required"
  | "debug_report_generated";
```

**Signal Types:**
- `context_window_warning`: Context approaching capacity
- `checkpoint`: Request to save state
- `human_input_required`: Pause for user input
- `debug_report_generated`: Debug report created for error

#### SignalData (lines 153-160)

```typescript
export interface SignalData {
  type: Signal;
  message?: string;
  data?: Record<string, unknown>;
}
```

**Fields:**
- `type`: The signal type
- `message`: Optional human-readable message
- `data`: Additional signal-specific data

### 3.4 Error Handling

#### ExecutionError (lines 169-178)

```typescript
export interface ExecutionError {
  nodeId: NodeId;
  error: Error | string;
  timestamp: string;
  attempt: number;
}
```

**Fields:**
- `nodeId`: Where error occurred
- `error`: The error object or message
- `timestamp`: ISO timestamp
- `attempt`: Retry attempt number (1-based)

#### RetryConfig (lines 183-195)

```typescript
export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryOn?: (error: Error) => boolean;
}
```

**Fields:**
- `maxAttempts`: Maximum retry attempts (default: 3)
- `backoffMs`: Initial backoff delay (default: 1000ms)
- `backoffMultiplier`: Exponential multiplier (default: 2)
- `retryOn`: Optional predicate to filter retryable errors

**Default Values:** Line 636 defines `DEFAULT_RETRY_CONFIG` with 3/1000/2.

#### DebugReport (lines 202-216)

```typescript
export interface DebugReport {
  errorSummary: string;
  stackTrace?: string;
  relevantFiles: string[];
  suggestedFixes: string[];
  generatedAt: string;
  nodeId?: NodeId;
  executionId?: string;
}
```

**Purpose:** Contains diagnostic information for error resolution.

### 3.5 Node Execution

#### NodeResult (lines 228-245)

```typescript
export interface NodeResult<TState extends BaseState = BaseState> {
  stateUpdate?: Partial<TState>;
  goto?: NodeId | NodeId[];
  signals?: SignalData[];
}
```

**Fields:**
- `stateUpdate`: Partial state update to merge
- `goto`: Override next node(s) to execute
- `signals`: Signals to emit

**Usage:** Returned by node execution functions.

#### ExecutionContext (lines 253-291)

```typescript
export interface ExecutionContext<TState extends BaseState = BaseState> {
  state: TState;
  config: GraphConfig;
  errors: ExecutionError[];
  abortSignal?: AbortSignal;
  contextWindowUsage?: ContextWindowUsage;
  contextWindowThreshold?: number;
  emit?: (signal: SignalData) => void;
  getNodeOutput?: (nodeId: NodeId) => unknown;
  model?: string;
}
```

**Provided to Node Execute Functions:**
- `state`: Current workflow state
- `config`: Graph configuration
- `errors`: Errors that occurred during execution
- `abortSignal`: Signal for cancellation
- `contextWindowUsage`: Current token usage (for agents)
- `contextWindowThreshold`: Threshold for warnings (0-100)
- `emit`: Function to emit signals
- `getNodeOutput`: Get output from previous node
- `model`: Resolved model for this context

#### NodeExecuteFn (lines 300-302)

```typescript
export type NodeExecuteFn<TState extends BaseState = BaseState> = (
  context: ExecutionContext<TState>
) => Promise<NodeResult<TState>>;
```

**Purpose:** Type signature for node execution functions.

#### NodeDefinition (lines 309-337)

```typescript
export interface NodeDefinition<TState extends BaseState = BaseState> {
  id: NodeId;
  type: NodeType;
  execute: NodeExecuteFn<TState>;
  retry?: RetryConfig;
  name?: string;
  description?: string;
  model?: ModelSpec;
}
```

**Core Fields:**
- `id`: Unique node identifier
- `type`: Node type (agent/tool/decision/etc.)
- `execute`: Execution function
- `retry`: Optional retry configuration
- `name`: Human-readable name
- `description`: What the node does
- `model`: Model specification (for agent nodes)

### 3.6 Graph Structure

#### Edge (lines 435-447)

```typescript
export interface Edge<TState extends BaseState = BaseState> {
  from: NodeId;
  to: NodeId;
  condition?: EdgeCondition<TState>;
  label?: string;
}
```

**Fields:**
- `from`: Source node ID
- `to`: Target node ID
- `condition`: Optional condition function (edge followed if returns true)
- `label`: Optional label for visualization

#### EdgeCondition (lines 426-428)

```typescript
export type EdgeCondition<TState extends BaseState = BaseState> = (
  state: TState
) => boolean;
```

**Purpose:** Function type for conditional edges. Returns true if edge should be followed.

#### CompiledGraph (lines 459-470)

```typescript
export interface CompiledGraph<TState extends BaseState = BaseState> {
  nodes: Map<NodeId, NodeDefinition<TState>>;
  edges: Edge<TState>[];
  startNode: NodeId;
  endNodes: Set<NodeId>;
  config: GraphConfig<TState>;
}
```

**Created By:** `GraphBuilder.compile()` at `builder.ts:608`.

**Fields:**
- `nodes`: Map of all node definitions
- `edges`: Array of all edges
- `startNode`: Entry point node ID
- `endNodes`: Set of terminal node IDs
- `config`: Graph configuration

### 3.7 Graph Configuration

#### GraphConfig (lines 364-413)

```typescript
export interface GraphConfig<TState extends BaseState = BaseState> {
  checkpointer?: Checkpointer<TState>;
  maxConcurrency?: number;
  timeout?: number;
  onProgress?: (event: ProgressEvent<TState>) => void;
  contextWindowThreshold?: number;
  autoCheckpoint?: boolean;
  metadata?: Record<string, unknown>;
  defaultModel?: ModelSpec;
}
```

**Configuration Options:**
- `checkpointer`: Checkpoint storage implementation
- `maxConcurrency`: Max concurrent nodes (default: 1)
- `timeout`: Max execution time in milliseconds
- `onProgress`: Callback for progress events
- `contextWindowThreshold`: Threshold percentage for context warnings (default: 45)
- `autoCheckpoint`: Auto-checkpoint after each node (default: true)
- `metadata`: Custom metadata for checkpoints
- `defaultModel`: Default model for agent nodes

**Default Values:** Lines 645-649 define `DEFAULT_GRAPH_CONFIG`.

#### ProgressEvent (lines 346-357)

```typescript
export interface ProgressEvent<TState extends BaseState = BaseState> {
  type: "node_started" | "node_completed" | "node_error" | "checkpoint_saved";
  nodeId: NodeId;
  state: TState;
  error?: ExecutionError;
  timestamp: string;
}
```

**Event Types:**
- `node_started`: Node execution began
- `node_completed`: Node execution finished successfully
- `node_error`: Node execution failed
- `checkpoint_saved`: State checkpoint saved

### 3.8 Execution State

#### ExecutionStatus (line 479)

```typescript
export type ExecutionStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
```

**Status Values:**
- `pending`: Not yet started
- `running`: Currently executing
- `paused`: Waiting for human input
- `completed`: Successfully finished
- `failed`: Terminated with error
- `cancelled`: Aborted by user/system

#### ExecutionSnapshot (lines 493-516)

```typescript
export interface ExecutionSnapshot<TState extends BaseState = BaseState> {
  executionId: string;
  state: TState;
  status: ExecutionStatus;
  currentNodeId?: NodeId;
  visitedNodes: NodeId[];
  errors: ExecutionError[];
  signals: SignalData[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  nodeExecutionCount: number;
}
```

**Purpose:** Complete state snapshot for checkpointing and resumption.

**Fields:**
- `executionId`: Unique execution identifier
- `state`: Current workflow state
- `status`: Current execution status
- `currentNodeId`: Currently executing node (if running)
- `visitedNodes`: IDs of completed nodes
- `errors`: All errors that occurred
- `signals`: All emitted signals
- `startedAt`: Start timestamp
- `updatedAt`: Last update timestamp
- `completedAt`: Completion timestamp (if completed)
- `nodeExecutionCount`: Total nodes executed

### 3.9 Checkpointer Interface

#### Checkpointer (lines 25-54)

```typescript
export interface Checkpointer<TState extends BaseState = BaseState> {
  save(executionId: string, state: TState, label?: string): Promise<void>;
  load(executionId: string): Promise<TState | null>;
  list(executionId: string): Promise<string[]>;
  delete(executionId: string, label?: string): Promise<void>;
}
```

**Methods:**
- `save()`: Save checkpoint with optional label
- `load()`: Load most recent checkpoint
- `list()`: List all checkpoint labels for execution
- `delete()`: Delete checkpoint(s)

**Implementations:** See `checkpointer.ts` for `MemorySaver`, `FileSaver`, `ResearchDirSaver`.

### 3.10 Workflow Tool Context

#### WorkflowToolContext (lines 660-677)

```typescript
export interface WorkflowToolContext {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  abort: AbortSignal;
  workflowState: Readonly<Record<string, unknown>>;
  nodeId: string;
  executionId: string;
}
```

**Purpose:** Extended context for custom tools invoked from graph nodes.

**Fields:**
- `sessionID`: Maps to execution ID
- `messageID`: Unique message ID for tool invocation
- `agent`: Set to `"workflow"` for graph-invoked tools
- `directory`: Current working directory
- `abort`: Abort signal for timeout/cancellation
- `workflowState`: Read-only snapshot of workflow state
- `nodeId`: The graph node invoking this tool
- `executionId`: Workflow execution ID

**Usage:** Passed to custom tool handlers via `customToolNode()` at `nodes.ts:1641`.

### 3.11 Constants

#### BACKGROUND_COMPACTION_THRESHOLD (line 629)

```typescript
export const BACKGROUND_COMPACTION_THRESHOLD = 0.45;
```

**Usage:** Context compaction triggers at 45% usage.

#### BUFFER_EXHAUSTION_THRESHOLD (line 631)

```typescript
export const BUFFER_EXHAUSTION_THRESHOLD = 0.6;
```

**Usage:** Context buffer exhaustion at 60% usage.

---

## 4. Node Factories (nodes.ts)

### Overview

The `nodes.ts` file at `src/graph/nodes.ts` (1838 lines) provides factory functions for creating typed graph nodes. Each factory returns a `NodeDefinition` with appropriate type and execute function.

### 4.1 Agent Node

#### agentNode() (lines 170-270)

**Purpose:** Creates a node that executes an AI agent session.

**Configuration Type:** `AgentNodeConfig<TState>` (lines 64-101)

**Key Fields:**
- `id`: Node identifier
- `agentType`: `"claude" | "opencode" | "copilot"`
- `systemPrompt`: System prompt for agent
- `tools`: Available tools (string array)
- `outputMapper`: Function to map agent messages to state
- `buildMessage`: Function to build user message from state
- `sessionConfig`: Additional session configuration
- `retry`: Retry configuration (default: `AGENT_NODE_RETRY_CONFIG` at line 138)

**Execution Flow (lines 192-268):**

1. **Get client** (line 193):
   ```typescript
   const client = globalClientProvider?.(agentType);
   ```
   Uses global client provider set via `setClientProvider()` (line 121).

2. **Validate client exists** (lines 195-200):
   Throws error if no client provider set.

3. **Build session config** (lines 203-208):
   ```typescript
   const fullSessionConfig: SessionConfig = {
     ...sessionConfig,
     model: ctx.model ?? sessionConfig?.model,
     systemPrompt: systemPrompt ?? sessionConfig?.systemPrompt,
     tools: tools ?? sessionConfig?.tools,
   };
   ```
   Merges node config with resolved model from context.

4. **Create session** (line 211):
   ```typescript
   const session = await client.createSession(fullSessionConfig);
   ```

5. **Build and send message** (lines 215-221):
   ```typescript
   const message = buildMessage ? buildMessage(ctx.state) : "";
   const messages: AgentMessage[] = [];
   for await (const chunk of session.stream(message)) {
     messages.push(chunk);
   }
   ```
   Streams agent response and collects messages.

6. **Get context usage** (line 224):
   ```typescript
   const contextUsage = await session.getContextUsage();
   ```

7. **Map output to state** (lines 228-239):
   - If `outputMapper` provided, calls it with messages and state (line 230)
   - Otherwise stores messages in `outputs[id]` (lines 233-238)

8. **Check context window** (lines 245-258):
   - Calculates usage percentage (lines 246-249)
   - If exceeds threshold, emits `context_window_warning` signal (lines 251-257)

9. **Return result** (lines 260-263):
   ```typescript
   return {
     stateUpdate,
     signals: signals.length > 0 ? signals : undefined,
   };
   ```

10. **Cleanup** (line 266):
    ```typescript
    await session.destroy();
    ```
    Always executed via finally block.

**Retry Config:** Lines 138-142 define `AGENT_NODE_RETRY_CONFIG`:
- `maxAttempts: 3`
- `backoffMs: 1000`
- `backoffMultiplier: 2`

**Client Provider:** Global variable `globalClientProvider` at line 113, set via `setClientProvider()` at line 120.

### 4.2 Tool Node

#### toolNode() (lines 369-437)

**Purpose:** Creates a node that executes a specific tool function.

**Configuration Type:** `ToolNodeConfig<TState, TArgs, TResult>` (lines 305-345)

**Key Fields:**
- `id`: Node identifier
- `toolName`: Name of the tool
- `execute`: Tool execution function (required)
- `args`: Static args or function to build from state
- `outputMapper`: Function to map result to state
- `timeout`: Execution timeout in milliseconds
- `retry`: Retry configuration (default: `DEFAULT_RETRY_CONFIG`)

**Execution Flow (lines 396-435):**

1. **Resolve arguments** (line 398):
   ```typescript
   const resolvedArgs = typeof args === "function" ? args(ctx.state) : args;
   ```

2. **Setup timeout** (lines 401-408):
   ```typescript
   const abortController = new AbortController();
   if (timeout) {
     timeoutId = setTimeout(() => {
       abortController.abort(new Error(`Tool "${toolName}" timed out after ${timeout}ms`));
     }, timeout);
   }
   ```

3. **Execute tool** (line 412):
   ```typescript
   const result = await execute(resolvedArgs as TArgs, abortController.signal);
   ```

4. **Map output** (lines 417-427):
   - If `outputMapper` provided, uses it (line 418)
   - Otherwise stores result in `outputs[id]` (lines 421-426)

5. **Return result** (line 429)

6. **Cleanup timeout** (lines 431-433):
   ```typescript
   if (timeoutId) {
     clearTimeout(timeoutId);
   }
   ```
   Always executed via finally block.

### 4.3 Decision Node

#### decisionNode() (lines 593-615)

**Purpose:** Creates a node that routes based on conditions.

**Configuration Type:** `DecisionNodeConfig<TState>` (lines 551-569)

**Key Fields:**
- `id`: Node identifier
- `routes`: Array of `{ condition, target, label? }` objects
- `fallback`: Default target if no route matches

**DecisionRoute Type (lines 535-544):**
```typescript
export interface DecisionRoute<TState extends BaseState = BaseState> {
  condition: (state: TState) => boolean;
  target: NodeId;
  label?: string;
}
```

**Execution Flow (lines 603-613):**

1. **Evaluate routes in order** (lines 605-609):
   ```typescript
   for (const route of routes) {
     if (route.condition(ctx.state)) {
       return { goto: route.target };
     }
   }
   ```

2. **Use fallback** (line 612):
   ```typescript
   return { goto: fallback };
   ```

**Routing Logic:** First matching route wins. Conditions evaluated with current state.

### 4.4 Wait Node

#### waitNode() (lines 683-718)

**Purpose:** Creates a node that pauses for human input.

**Configuration Type:** `WaitNodeConfig<TState>` (lines 636-660)

**Key Fields:**
- `id`: Node identifier
- `prompt`: Static string or function to build from state
- `autoApprove`: If true, auto-approves and continues (for testing)
- `inputMapper`: Function to map user input to state

**Execution Flow (lines 693-716):**

1. **Resolve prompt** (line 695):
   ```typescript
   const resolvedPrompt = typeof prompt === "function" ? prompt(ctx.state) : prompt;
   ```

2. **Auto-approve path** (lines 697-701):
   - If `autoApprove` is true, applies `inputMapper` with empty string
   - Returns state update without signal

3. **Emit signal** (lines 704-715):
   ```typescript
   return {
     signals: [
       {
         type: "human_input_required",
         message: resolvedPrompt,
         data: {
           nodeId: id,
           inputMapper: inputMapper ? true : false,
         },
       },
     ],
   };
   ```

**Signal Structure:** Includes `nodeId` and `inputMapper` flag in data field.

### 4.5 Ask User Node

#### askUserNode() (lines 840-893)

**Purpose:** Creates a node that pauses for explicit user input with structured options.

**Configuration Type:** `AskUserNodeConfig<TState>` (lines 752-766)

**AskUserOptions Type (lines 738-745):**
```typescript
export interface AskUserOptions {
  question: string;
  header?: string;
  options?: AskUserOption[];
}
```

**AskUserOption Type (lines 727-732):**
```typescript
export interface AskUserOption {
  label: string;
  description?: string;
}
```

**State Extension (lines 772-779):**
```typescript
export interface AskUserWaitState {
  __waitingForInput?: boolean;
  __waitNodeId?: string;
  __askUserRequestId?: string;
}
```

**Execution Flow (lines 850-891):**

1. **Resolve options** (lines 852-853):
   ```typescript
   const resolvedOptions: AskUserOptions =
     typeof options === "function" ? options(ctx.state) : options;
   ```

2. **Generate request ID** (line 856):
   ```typescript
   const requestId = crypto.randomUUID();
   ```

3. **Build event data** (lines 859-865):
   ```typescript
   const eventData: AskUserQuestionEventData = {
     requestId,
     question: resolvedOptions.question,
     header: resolvedOptions.header,
     options: resolvedOptions.options,
     nodeId: id,
   };
   ```

4. **Emit signal via context** (lines 868-874):
   - If `ctx.emit` exists, calls it with signal data

5. **Return with state update and signal** (lines 877-890):
   ```typescript
   return {
     stateUpdate: {
       __waitingForInput: true,
       __waitNodeId: id,
       __askUserRequestId: requestId,
     } as Partial<TState>,
     signals: [{
       type: "human_input_required",
       message: resolvedOptions.question,
       data: eventData,
     }],
   };
   ```

**Key Difference from waitNode:** Uses `crypto.randomUUID()` for request correlation and sets wait state flags.

### 4.6 Parallel Node

#### parallelNode() (lines 988-1027)

**Purpose:** Creates a node for concurrent branch execution.

**Configuration Type:** `ParallelNodeConfig<TState>` (lines 919-949)

**Key Fields:**
- `id`: Node identifier
- `branches`: Array of node IDs to execute in parallel
- `strategy`: `"all" | "race" | "any"` (default: `"all"`)
- `merge`: Optional function to combine branch results

**Execution Flow (lines 1002-1025):**

1. **Build parallel context** (lines 1004-1008):
   ```typescript
   const parallelContext: ParallelExecutionContext<TState> = {
     branches,
     strategy,
     merge,
   };
   ```

2. **Store config in state** (lines 1013-1021):
   ```typescript
   return {
     stateUpdate: {
       outputs: {
         ...ctx.state.outputs,
         [id]: {
           _parallel: true,
           ...parallelContext,
         },
       },
     } as Partial<TState>,
     goto: branches,
   };
   ```

**Note:** Actual parallel execution handled by graph execution engine. Node marks parallel point and returns all branch IDs via `goto`.

### 4.7 Subgraph Node

#### subgraphNode() (lines 1166-1223)

**Purpose:** Creates a node that executes a nested graph.

**Configuration Type:** `SubgraphNodeConfig<TState, TSubState>` (lines 1059-1098)

**SubgraphRef Type (lines 1049-1051):**
```typescript
export type SubgraphRef<TSubState extends BaseState = BaseState> =
  | CompiledSubgraph<TSubState>
  | string;
```

**Key Fields:**
- `id`: Node identifier
- `subgraph`: Compiled graph instance or workflow name string
- `inputMapper`: Map parent state to subgraph initial state
- `outputMapper`: Map subgraph final state to parent state update

**Execution Flow (lines 1177-1221):**

1. **Resolve subgraph** (lines 1179-1200):

   **If string** (lines 1181-1196):
   ```typescript
   const resolver = globalWorkflowResolver;
   if (!resolver) {
     throw new Error("No workflow resolver set. Call setWorkflowResolver().");
   }
   const resolved = resolver(subgraph);
   if (!resolved) {
     throw new Error(`Workflow not found: ${subgraph}`);
   }
   resolvedSubgraph = resolved as unknown as CompiledSubgraph<TSubState>;
   ```

   **If object** (lines 1197-1200):
   ```typescript
   resolvedSubgraph = subgraph;
   ```

2. **Map input state** (lines 1203-1205):
   ```typescript
   const subState = inputMapper
     ? inputMapper(ctx.state)
     : (ctx.state as unknown as TSubState);
   ```

3. **Execute subgraph** (line 1208):
   ```typescript
   const finalSubState = await resolvedSubgraph.execute(subState);
   ```

4. **Map output state** (lines 1211-1218):
   - If `outputMapper` provided, uses it (lines 1211-1212)
   - Otherwise stores subgraph final state in `outputs[id]` (lines 1213-1218)

5. **Return result** (line 1220)

**Workflow Resolver:** Global variable at line 1110, set via `setWorkflowResolver()` at line 1118.

### 4.8 Clear Context Node

#### clearContextNode() (lines 494-524)

**Purpose:** Creates a node that clears context window by emitting summarization signal.

**Configuration Type:** `ClearContextNodeConfig<TState>` (lines 448-463)

**Key Fields:**
- `id`: Node identifier
- `name`: Optional display name
- `description`: Optional description
- `message`: Optional message (static or function)

**Execution Flow (lines 504-522):**

1. **Resolve message** (line 505):
   ```typescript
   const resolvedMessage = typeof message === "function" ? message(ctx.state) : message;
   ```

2. **Emit signal** (lines 508-521):
   ```typescript
   return {
     signals: [
       {
         type: "context_window_warning",
         message: resolvedMessage ?? "Clearing context window",
         data: {
           usage: 100, // Force summarization
           threshold: ctx.contextWindowThreshold ?? BUFFER_EXHAUSTION_THRESHOLD * 100,
           nodeId: id,
           action: "summarize",
         },
       },
     ],
   };
   ```

**Force Mechanism:** Sets `usage: 100` to force summarization regardless of actual usage (line 515).

### 4.9 Context Monitor Node

#### contextMonitorNode() (lines 1374-1512)

**Purpose:** Creates a node that checks and manages context window usage.

**Configuration Type:** `ContextMonitorNodeConfig<TState>` (lines 1248-1300)

**Key Fields:**
- `id`: Node identifier
- `agentType`: `"opencode" | "claude" | "copilot"`
- `threshold`: Percentage threshold (default: 45)
- `action`: `"summarize" | "recreate" | "warn" | "none"`
- `getSession`: Function to retrieve session from state
- `getContextUsage`: Function to get current usage
- `onCompaction`: Callback when compaction performed

**Execution Flow (lines 1394-1509):**

1. **Get context usage** (lines 1396-1415):

   **Priority order:**
   - If `customGetContextUsage` provided, uses it (lines 1398-1399)
   - Else if `getSession` provided, calls `session.getContextUsage()` (lines 1400-1404)
   - Else uses `ctx.contextWindowUsage` if available (lines 1406-1414)

2. **Build state update** (lines 1418-1420):
   ```typescript
   const stateUpdate: Partial<TState> = {
     contextWindowUsage: usage ? toContextWindowUsage(usage) : null,
   } as Partial<TState>;
   ```

3. **Check threshold** (lines 1423-1426):
   - If under threshold, returns state update without action
   - Uses `isContextThresholdExceeded()` helper at line 1343

4. **Handle threshold exceeded** (lines 1429-1504):

   **Action: "summarize"** (lines 1432-1468):
   - Gets session via `getSession()` (line 1434)
   - Calls `session.summarize()` (line 1437)
   - Invokes `onCompaction()` callback (line 1438)
   - Updates usage after summarization (lines 1441-1442)
   - On error, emits warning signal (lines 1443-1455)
   - If no session, emits warning (lines 1457-1467)

   **Action: "recreate"** (lines 1471-1484):
   - Invokes `onCompaction()` callback (line 1473)
   - Emits signal with `shouldRecreateSession: true` (lines 1474-1483)

   **Action: "warn"** (lines 1487-1498):
   - Emits warning signal only (lines 1489-1497)

   **Action: "none"** (lines 1501-1503):
   - No action taken

5. **Return result** (lines 1506-1509):
   ```typescript
   return {
     stateUpdate,
     signals: signals.length > 0 ? signals : undefined,
   };
   ```

**Default Action:** Line 1308 maps agent type to default action:
- `opencode` → `"summarize"`
- `claude` → `"recreate"`
- `copilot` → `"warn"`

### 4.10 Custom Tool Node

#### customToolNode() (lines 1600-1674)

**Purpose:** Creates a node that resolves and executes a tool from the ToolRegistry.

**Configuration Type:** `CustomToolNodeConfig<TState, TArgs, TResult>` (lines 1572-1585)

**Key Fields:**
- `id`: Node identifier
- `toolName`: Tool name in registry
- `name`, `description`: Display fields
- `inputSchema`: Zod schema for input validation
- `args`: Static args or function to build from state
- `outputMapper`: Function to map result to state
- `timeout`: Execution timeout
- `retry`: Retry configuration

**Execution Flow (lines 1611-1672):**

1. **Get tool from registry** (lines 1612-1619):
   ```typescript
   const registry = getToolRegistry();
   const entry = registry.get(config.toolName);
   if (!entry) {
     throw new Error(
       `Custom tool "${config.toolName}" not found in registry. ` +
       `Available tools: ${registry.getAll().map(t => t.name).join(", ")}`
     );
   }
   ```

2. **Resolve arguments** (lines 1621-1623):
   ```typescript
   const rawArgs = typeof config.args === "function"
     ? config.args(ctx.state)
     : config.args ?? {};
   ```

3. **Validate with Zod** (lines 1626-1639):
   - If `inputSchema` provided, validates `rawArgs` (line 1628)
   - On validation failure, throws `SchemaValidationError` (lines 1630-1635)
   - On success, uses parsed data (line 1636)

4. **Build tool context** (lines 1641-1652):
   ```typescript
   const toolContext: WorkflowToolContext = {
     sessionID: ctx.state.executionId,
     messageID: crypto.randomUUID(),
     agent: "workflow",
     directory: process.cwd(),
     abort: config.timeout
       ? AbortSignal.timeout(config.timeout)
       : new AbortController().signal,
     workflowState: Object.freeze({ ...ctx.state }),
     nodeId: config.id,
     executionId: ctx.state.executionId,
   };
   ```

5. **Execute tool** (line 1655):
   ```typescript
   const result = await entry.definition.handler(args, toolContext) as TResult;
   ```

6. **Map output** (lines 1657-1659):
   - If `outputMapper` provided, uses it
   - Otherwise stores result in `outputs[config.id]`

7. **Error handling** (lines 1662-1671):
   - Re-throws `SchemaValidationError` as-is (lines 1663-1665)
   - Wraps other errors in `NodeExecutionError` (lines 1666-1670)

**Schema Validation Error:** Triggers ancestor agent retry mechanism (line 1630).

**Tool Registry:** Accessed via `getToolRegistry()` from `src/sdk/tools/registry.ts`.

### 4.11 Subagent Node

#### subagentNode() (lines 1710-1767)

**Purpose:** Creates a node that spawns a single sub-agent within graph execution.

**Configuration Type:** `SubagentNodeConfig<TState>` (lines 1684-1698)

**Key Fields:**
- `id`: Node identifier
- `agentName`: Agent name resolved from SubagentTypeRegistry
- `task`: Task string or function to build from state
- `systemPrompt`: Optional system prompt override
- `model`: Optional model override
- `tools`: Optional tools array
- `outputMapper`: Function to map result to state
- `retry`: Retry configuration

**Execution Flow (lines 1719-1765):**

1. **Get subagent bridge** (lines 1720-1726):
   ```typescript
   const bridge = getSubagentBridge();
   if (!bridge) {
     throw new Error(
       "SubagentGraphBridge not initialized. " +
       "Ensure setSubagentBridge() is called before graph execution."
     );
   }
   ```

2. **Get agent from registry** (lines 1728-1735):
   ```typescript
   const registry = getSubagentRegistry();
   const entry = registry.get(config.agentName);
   if (!entry) {
     throw new Error(
       `Sub-agent "${config.agentName}" not found in registry. ` +
       `Available agents: ${registry.getAll().map(a => a.name).join(", ")}`
     );
   }
   ```

3. **Resolve task and system prompt** (lines 1737-1743):
   ```typescript
   const task = typeof config.task === "function"
     ? config.task(ctx.state)
     : config.task;
   const systemPrompt = typeof config.systemPrompt === "function"
     ? config.systemPrompt(ctx.state)
     : config.systemPrompt;
   ```

4. **Spawn subagent** (lines 1745-1752):
   ```typescript
   const result = await bridge.spawn({
     agentId: `${config.id}-${ctx.state.executionId}`,
     agentName: config.agentName,
     task,
     systemPrompt,
     model: config.model ?? ctx.model,
     tools: config.tools,
   });
   ```

5. **Check result** (lines 1754-1758):
   ```typescript
   if (!result.success) {
     throw new Error(
       `Sub-agent "${config.agentName}" failed: ${result.error ?? "Unknown error"}`
     );
   }
   ```

6. **Map output** (lines 1760-1762):
   - If `outputMapper` provided, uses it
   - Otherwise stores `result.output` in `outputs[config.id]`

7. **Return result** (line 1764)

**Bridge:** Global variable accessed via `getSubagentBridge()` from `subagent-bridge.ts`.

**Registry:** Global variable accessed via `getSubagentRegistry()` from `subagent-registry.ts`.

### 4.12 Parallel Subagent Node

#### parallelSubagentNode() (lines 1802-1838)

**Purpose:** Creates a node that spawns multiple sub-agents concurrently.

**Configuration Type:** `ParallelSubagentNodeConfig<TState>` (lines 1776-1789)

**Key Fields:**
- `id`: Node identifier
- `agents`: Array of agent configs with `agentName`, `task`, `systemPrompt`, `model`, `tools`
- `merge`: Function to aggregate results into state update
- `retry`: Retry configuration

**Execution Flow (lines 1811-1836):**

1. **Get subagent bridge** (lines 1812-1815):
   ```typescript
   const bridge = getSubagentBridge();
   if (!bridge) {
     throw new Error("SubagentGraphBridge not initialized.");
   }
   ```

2. **Build spawn options** (lines 1817-1824):
   ```typescript
   const spawnOptions: SubagentSpawnOptions[] = config.agents.map((agent, i) => ({
     agentId: `${config.id}-${i}-${ctx.state.executionId}`,
     agentName: agent.agentName,
     task: typeof agent.task === "function" ? agent.task(ctx.state) : agent.task,
     systemPrompt: agent.systemPrompt,
     model: agent.model ?? ctx.model,
     tools: agent.tools,
   }));
   ```

3. **Spawn in parallel** (line 1826):
   ```typescript
   const results = await bridge.spawnParallel(spawnOptions);
   ```

4. **Build result map** (lines 1828-1832):
   ```typescript
   const resultMap = new Map<string, SubagentResult>();
   results.forEach((result, i) => {
     const key = `${config.agents[i]!.agentName}-${i}`;
     resultMap.set(key, result);
   });
   ```

5. **Merge results** (line 1834):
   ```typescript
   const stateUpdate = config.merge(resultMap, ctx.state);
   ```

6. **Return result** (line 1835)

**Parallel Execution:** Uses `bridge.spawnParallel()` which internally uses `Promise.allSettled()`.

**Result Persistence:** Individual results persisted to workflow session directory by bridge.

---

## 5. Error Handling (errors.ts)

### Overview

The `errors.ts` file at `src/graph/errors.ts` (58 lines) defines custom error classes for graph node execution failures. Both error types trigger the ancestor agent retry mechanism.

### 5.1 SchemaValidationError

#### Class Definition (lines 16-24)

```typescript
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: ZodError,
  ) {
    super(message);
    this.name = "SchemaValidationError";
  }
}
```

**Purpose:** Thrown when a node's input fails Zod schema validation.

**Fields:**
- `message`: Human-readable error description
- `zodError`: The underlying Zod validation error

**Trigger:** Input contract violation—arguments don't match expected Zod schema.

**Behavior:** Triggers ancestor agent retry so LLM can regenerate conforming output.

**Usage:** Thrown by `customToolNode()` at `nodes.ts:1630` when `inputSchema.safeParse()` fails.

### 5.2 NodeExecutionError

#### Class Definition (lines 30-39)

```typescript
export class NodeExecutionError extends Error {
  constructor(
    message: string,
    public readonly nodeId: string,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = "NodeExecutionError";
  }
}
```

**Purpose:** Wraps runtime failures from tool handlers and sub-agent execution.

**Fields:**
- `message`: Human-readable error description
- `nodeId`: ID of the node that failed
- `cause`: The underlying error (optional)

**Trigger:** Runtime failures during node execution.

**Behavior:** Triggers ancestor agent retry with structured error context.

**Usage:** Thrown by `customToolNode()` at `nodes.ts:1666` when tool handler fails.

### 5.3 ErrorFeedback

#### Interface Definition (lines 44-57)

```typescript
export interface ErrorFeedback {
  failedNodeId: string;
  errorMessage: string;
  errorType: string;
  attempt: number;
  maxAttempts: number;
  previousOutput?: unknown;
}
```

**Purpose:** Error feedback injected into ancestor agent context on downstream failure.

**Fields:**
- `failedNodeId`: The node that failed
- `errorMessage`: The error message from the failed node
- `errorType`: The error type (e.g., "SchemaValidationError")
- `attempt`: Current retry attempt (1-indexed)
- `maxAttempts`: Maximum attempts before workflow failure
- `previousOutput`: The output that led to failure (if available)

**Usage:** Structured feedback for agent to learn from failures and adjust output.

---

## 6. Data Flow Summary

### 6.1 Graph Construction Flow

1. **Initialization:**
   - User calls `graph<TState>()` factory → creates `GraphBuilder` instance
   - Builder initializes empty `nodes` map, `edges` array, and state tracking

2. **Node Addition:**
   - `start(node)` → Sets `startNodeId`, adds node to `nodes` map
   - `then(node)` → Adds node, creates edge from current node, updates `currentNodeId`
   - Each node addition increments `nodeCounter` for unique IDs

3. **Control Flow:**
   - `if(condition)` → Creates decision node, pushes to `conditionalStack`
   - `else()` → Records if-branch end, sets `inElseBranch = true`
   - `endif()` → Creates merge node, connects conditional edges, pops stack
   - `loop(bodyNodes, config)` → Creates loop start/check nodes, chains body nodes, adds conditional back-edge

4. **Compilation:**
   - `compile(config)` → Validates graph, finds end nodes, returns `CompiledGraph`
   - Compiled graph contains cloned `nodes` map, `edges` array, and merged `config`

### 6.2 Execution Flow

1. **Initialization:**
   - `executor.stream(options)` → Generates execution ID, initializes state
   - If resuming, loads snapshot; otherwise calls `initializeExecutionState()`
   - Initializes node queue with `graph.startNode`

2. **Main Loop:**
   - While `nodeQueue.length > 0 && stepCount < maxSteps`:
     - Shift next node from queue
     - Check loop detection via `executionVisited` set
     - Execute node via `executeWithRetry()`
     - Merge state update via `mergeState()`
     - Handle signals (human_input_required, checkpoint)
     - Get next nodes via `getNextNodes()`
     - Push next nodes to queue
     - Yield `StepResult` to consumer

3. **Node Execution:**
   - `executeWithRetry()` → Retry loop with exponential backoff
   - Resolves model via `resolveModel()` hierarchy
   - Builds `ExecutionContext` with state, config, errors, model
   - Calls `node.execute(context)` to get `NodeResult`
   - On error, checks `retryOn` predicate and retries up to `maxAttempts`

4. **Edge Evaluation:**
   - `getNextNodes()` → Filters outgoing edges from current node
   - Evaluates edge conditions with current state
   - Returns deduplicated array of target node IDs
   - If node result has `goto`, uses that instead

5. **Completion:**
   - When `isEndNode && nodeQueue.length === 0`, yields `completed` status
   - Tracks telemetry completion before yield
   - Returns from generator

### 6.3 State Management Flow

1. **State Initialization:**
   - `initializeExecutionState()` → Creates base state with `executionId`, `lastUpdated`, `outputs`
   - Merges with optional `initialState` parameter
   - Returns fully typed `TState` extending `BaseState`

2. **State Updates:**
   - Node returns `NodeResult` with optional `stateUpdate`
   - `mergeState()` → Immutably merges update into current state
   - Handles `outputs` specially—merges rather than replaces
   - Always updates `lastUpdated` to current timestamp

3. **State Propagation:**
   - Updated state passed to next node via `ExecutionContext`
   - Previous node outputs accessible via `ctx.getNodeOutput(nodeId)` or `ctx.state.outputs[nodeId]`
   - Entire state history preserved in `outputs` map

### 6.4 Signal Flow

1. **Signal Emission:**
   - Nodes return `signals` array in `NodeResult`
   - Executor collects signals during execution (line 404)

2. **Signal Types:**
   - `human_input_required` → Pauses execution, yields `paused` status (lines 408-419)
   - `checkpoint` → Saves state via checkpointer (lines 422-430)
   - `context_window_warning` → Logs warning, optionally compacts context
   - `debug_report_generated` → Indicates debug report created

3. **Signal Handling:**
   - Executor checks signals after each node execution
   - Human input signals cause immediate pause and return
   - Checkpoint signals trigger `saveCheckpoint()` call
   - Context window warnings logged but don't affect execution flow

### 6.5 Error and Retry Flow

1. **Node Execution Error:**
   - Node throws error during `execute()`
   - `executeWithRetry()` catches and stores in `lastError`

2. **Retry Decision:**
   - Checks `retryConfig.retryOn(error)` predicate if defined
   - If predicate returns false, throws immediately
   - Otherwise attempts retry up to `maxAttempts`

3. **Exponential Backoff:**
   - Calculates delay: `backoffMs × (backoffMultiplier ^ (attempt - 1))`
   - Sleeps for calculated delay via `sleep()`
   - Increments attempt counter and retries

4. **Retry Exhaustion:**
   - After max attempts, throws final error
   - Error caught by executor, pushed to `errors` array
   - Yields `failed` status with error, stops execution

5. **Schema Validation:**
   - `customToolNode()` validates input with Zod schema
   - On failure, throws `SchemaValidationError` with Zod details
   - Error propagates to ancestor agent for retry with feedback

### 6.6 Checkpointing Flow

1. **Auto-Checkpoint:**
   - If `config.autoCheckpoint` enabled (default: true)
   - After each node execution, calls `saveCheckpoint()`
   - Label format: `"step_${stepCount}"`

2. **Manual Checkpoint:**
   - Node emits `checkpoint` signal
   - Executor detects signal and calls `saveCheckpoint()`
   - Label from signal data or generated

3. **Checkpoint Save:**
   - Calls `checkpointer.save(executionId, state, label)`
   - On success, emits `checkpoint_saved` progress event
   - On error, logs but doesn't fail execution

4. **Checkpoint Resume:**
   - Pass `resumeFrom` snapshot to `stream()` options
   - Executor restores state, visitedNodes, errors, signals
   - Resumes from `snapshot.currentNodeId` if present

### 6.7 Model Resolution Flow

1. **Resolution Hierarchy:**
   - Check `node.model` (if not "inherit")
   - Check `parentContext.model` (inherited from parent)
   - Check `config.defaultModel` (if not "inherit")
   - Return `undefined` (let SDK use default)

2. **Context Propagation:**
   - Resolved model stored in `ExecutionContext.model`
   - Passed to node execution functions
   - Agent nodes use `ctx.model` for session config (line 205)
   - Subagent nodes pass `ctx.model` to bridge (line 1750)

3. **Model Override:**
   - Nodes can specify `model` in definition
   - Overrides parent and default models (unless "inherit")
   - Allows per-node model specification for heterogeneous workflows

---

## Appendix: Key File Locations

- **GraphBuilder:** `src/graph/builder.ts` (780 lines)
- **GraphExecutor:** `src/graph/compiled.ts` (758 lines)
- **Type Definitions:** `src/graph/types.ts` (678 lines)
- **Node Factories:** `src/graph/nodes.ts` (1838 lines)
- **Error Classes:** `src/graph/errors.ts` (58 lines)
- **Checkpointers:** `src/graph/checkpointer.ts` (implementation details)
- **Main Export:** `src/graph/index.ts` (re-exports all public APIs)

---

**End of Technical Documentation**
