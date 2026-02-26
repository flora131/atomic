# WorkflowSDK Design Documentation

**Date:** 2026-02-25
**Scope:** `src/workflows/graph/sdk.ts` and all runtime dependencies

---

## 1. WorkflowSDK Class

**File:** `/home/alilavaee/Documents/projects/workflow-sdk/src/workflows/graph/sdk.ts`

### Overview

`WorkflowSDK` is a high-level facade that wires together provider clients, subagent infrastructure, and graph execution into a single entry point. It is instantiated via the static `WorkflowSDK.init()` factory (line 123) because the constructor is private (line 66). The constructor validates that at least one provider is supplied (line 68-70), then builds four internal dependency objects: `providerRegistry`, `subagentBridge`, `subagentRegistry`, and `runtimeDependencies`.

### Type: `WorkflowSDKConfig`

Defined at lines 32-43, this is the configuration interface passed to `WorkflowSDK.init()`:

| Field | Type | Description |
|---|---|---|
| `providers` | `Record<string, CodingAgentClient>` | **Required.** Keyed by provider name (e.g., `"claude"`, `"copilot"`). Must have at least one entry. |
| `workflows` | `Map<string, WorkflowRegistration<BaseState>>` | Optional. Pre-registered named workflows for subgraph resolution. |
| `agents` | `Map<string, AgentInfo>` | Optional. Agent definitions to populate the `SubagentTypeRegistry`. |
| `checkpointer` | `CheckpointerType` | Optional. One of `"memory"`, `"file"`, `"research"`, `"session"`. |
| `checkpointerOptions` | `CreateCheckpointerOptions<BaseState>` | Optional. Passed to `createCheckpointer()`. |
| `validation` | `boolean` | Optional. Defaults to `true`. When `false`, `outputSchema` is stripped from graphs. |
| `defaultModel` | `ModelSpec` | Optional. Default model spec applied to graphs that lack one. |
| `maxSteps` | `number` | Optional. Safety limit applied to `ExecutionOptions.maxSteps`. |
| `subagentProvider` | `string` | Optional. Explicit provider name for subagent session creation. |
| `subagentSessionDir` | `string` | Optional. Passed to `SubagentGraphBridge` for result persistence. |

### Type: `WorkflowRegistration`

Defined at lines 25-27. A union type representing what can be stored as a named workflow:

```typescript
type WorkflowRegistration<TState extends BaseState = BaseState> =
  | CompiledSubgraph<TState>   // Has an .execute() method
  | CompiledGraph<TState>;     // A full compiled graph
```

The helper `hasExecute()` (lines 45-49) distinguishes between the two at runtime.

### Initialization Flow (`constructor`, lines 66-118)

1. **Provider wrapping** (lines 72-75): Each entry in `config.providers` is wrapped in a `ClientBackedAgentProvider` instance, creating an `agentProviders` record.

2. **ProviderRegistry** (line 77): Constructed from the `agentProviders` record. Stored as the public readonly field `this.providerRegistry`.

3. **Clients map** (line 78): The raw `CodingAgentClient` entries are stored as a `ReadonlyMap<string, CodingAgentClient>` for the `clientProvider` runtime dependency.

4. **Workflows map** (line 79): Initialized from `config.workflows` or an empty map. Mutable -- new workflows can be added via `registerWorkflow()`.

5. **Checkpointer** (lines 80-82): If `config.checkpointer` is provided, calls `createCheckpointer()` from `checkpointer.ts`.

6. **Validation** (line 83): `validationEnabled` defaults to `true`.

7. **Subagent provider resolution** (lines 87-90): Calls `resolveSubagentProviderName()` to determine which provider creates subagent sessions. Resolution order:
   - Explicit `config.subagentProvider` (line 184)
   - Provider name extracted from `defaultModel` if it has a `"provider/model"` format and that provider is registered (lines 188-193)
   - First registered provider in the registry (line 195)

8. **SubagentGraphBridge** (lines 92-101): Created with a `createSession` factory closure that calls `providerRegistry.get(subagentProviderName).createSession(sessionConfig)` and an optional `sessionDir`.

9. **SubagentTypeRegistry** (lines 103-110): A fresh `SubagentTypeRegistry` is created. If `config.agents` is provided, each entry is registered with `name`, `info`, and `source` fields.

10. **Runtime dependencies** (lines 112-117): The `GraphRuntimeDependencies` object is assembled with four fields:
    - `clientProvider`: A closure that looks up clients from `this.clients` by agent type name.
    - `subagentBridge`: The `SubagentGraphBridge` instance.
    - `subagentRegistry`: The `SubagentTypeRegistry` instance.
    - `workflowResolver`: A closure calling `this.resolveWorkflow(name)`.

### Public Methods

#### `static init(config: WorkflowSDKConfig): WorkflowSDK` (line 123)

Factory method. Delegates to the private constructor.

#### `graph<TState>(): GraphBuilder<TState>` (lines 130-132)

Returns a fresh `GraphBuilder` instance by calling the `graph()` factory function from `builder.ts`. This is a convenience method that does not inject any SDK context into the builder itself -- the runtime dependencies are applied later when `execute()` or `stream()` is called.

#### `execute<TState>(compiled, options?): Promise<ExecutionResult<TState>>` (lines 137-144)

Executes a compiled graph to completion:
1. Calls `applyGraphDefaults(compiled)` to inject SDK-level checkpointer, defaultModel, validation settings, and runtime dependencies into the graph config.
2. Calls `applyExecutionDefaults(options)` to inject `maxSteps` if configured.
3. Delegates to `executeGraph()` from `compiled.ts`.

#### `stream<TState>(compiled, options?): AsyncGenerator<StreamEvent<TState>>` (lines 149-157)

Streams execution events:
1. Destructures `modes` from options.
2. Calls `applyGraphDefaults(compiled)`.
3. Creates a `GraphExecutor` via `createExecutor()`.
4. Calls `routeStream()` on the executor's stream with the selected modes.

#### `registerWorkflow(name, workflow): void` (lines 162-164)

Adds a workflow to the internal `workflows` map. This makes it available for subgraph resolution via the `workflowResolver` dependency.

#### `destroy(): Promise<void>` (lines 169-171)

Stops all managed provider clients by calling `.stop()` on each `CodingAgentClient` in `this.clients`.

#### `getSubagentBridge(): SubagentGraphBridge` (lines 176-178)

Accessor for the internal subagent bridge instance.

### Private Methods

#### `resolveSubagentProviderName(explicitProvider, defaultModel): string` (lines 180-196)

Determines which provider to use for subagent sessions. Resolution priority:
1. `explicitProvider` if provided.
2. Provider name parsed from `defaultModel` (format: `"provider/model"`) if that provider exists in the registry.
3. First provider in the registry.

#### `resolveWorkflow(name): CompiledSubgraph<BaseState> | null` (lines 198-214)

Looks up a named workflow from the `workflows` map. If the workflow is a `CompiledSubgraph` (has `.execute()`), it is returned directly. If it is a `CompiledGraph`, it is wrapped in a `CompiledSubgraph` adapter that calls `this.execute(workflow, { initialState: state })` and returns `result.state`.

#### `applyGraphDefaults<TState>(compiled): CompiledGraph<TState>` (lines 216-263)

Merges SDK-level defaults into a compiled graph's config, producing a new graph object only if changes are needed:
- Injects `this.checkpointer` if the graph has none (lines 222-225).
- Injects `this.defaultModel` if the graph has none (lines 227-229).
- Strips `outputSchema` if validation is disabled (lines 232-235).
- Fills in runtime dependencies (`clientProvider`, `workflowResolver`, `subagentBridge`, `subagentRegistry`) where the graph config does not already define them (lines 237-253).

#### `applyExecutionDefaults<TState>(options?): ExecutionOptions<TState> | undefined` (lines 265-276)

Injects `this.maxSteps` into execution options if the SDK has a maxSteps configured and the caller did not provide one.

---

## 2. WorkflowSDK Tests

**File:** `/home/alilavaee/Documents/projects/workflow-sdk/src/workflows/graph/sdk.test.ts`

### Test Infrastructure

- **`createMockSession(id)`** (lines 18-41): Returns a mock `Session` with `send`, `stream`, `summarize`, `getContextUsage`, `getSystemToolsTokens`, and `destroy` methods. The `stream` method yields a single text message.

- **`createMockClient(agentType, options?)`** (lines 43-88): Returns a mock `CodingAgentClient` with optional hooks: `onCreateSession` callback for tracking session creation, and `streamPrefix` for customizing stream output content.

- **Cleanup** (lines 90-95): An `afterEach` hook destroys all SDK instances tracked in the `sdkInstances` array.

### Test Scenarios

1. **"init throws when providers are empty"** (lines 98-102): Verifies that `WorkflowSDK.init({ providers: {} })` throws the expected error message.

2. **"init uses defaultModel provider for subagent sessions when available"** (lines 104-142): Creates an SDK with `claude` and `copilot` providers, sets `defaultModel: "copilot/gpt-5"`, and executes a subagent node. Asserts that the subagent output contains `"copilot:Summarize"`, confirming the `copilot` provider was used because `defaultModel` starts with `"copilot/"`.

3. **"init honors explicit subagentProvider over defaultModel provider"** (lines 144-183): Same setup as above but with `subagentProvider: "claude"`. Asserts output contains `"claude:Summarize"`, confirming the explicit provider takes precedence over the `defaultModel`-derived provider.

4. **"init wires provider and workflow resolver runtime dependencies"** (lines 185-217): Creates an SDK with a mock workflow (a `CompiledSubgraph` with an `execute` function that sets `outputs.resolved = true`). Builds a graph with an `agentNode` followed by a `subgraphNode("demo")`. Asserts that both nodes execute successfully: the agent node produces output and the subgraph workflow's `resolved: true` appears in the final state.

5. **"init configures subagent bridge and registry entries for node execution"** (lines 219-254): Registers an agent named `"codebase-analyzer"` via `config.agents`. Executes a subagent node that references that agent name. Asserts the output contains `"stream:Summarize"`, confirming the bridge and registry are wired correctly.

6. **"subagent node spawning resolves provider via ProviderRegistry"** (lines 256-306): Creates an SDK with two providers (`claude` and `copilot`), sets `subagentProvider: "copilot"`. Runs a graph with an `agentNode` (type `"claude"`) followed by a `subagentNode`. Tracks session creation callbacks. Asserts: (a) subagent output comes from copilot (`"copilot:Delegated task"`), (b) claude created exactly 1 session (for the agentNode), (c) copilot created exactly 1 session (for the subagent).

7. **"execute and stream use SDK entry points"** (lines 308-330): Creates a simple tool node, executes via `sdk.execute()`, then streams via `sdk.stream()` with `modes: ["updates"]`. Asserts execute returns `"completed"` status and stream yields exactly one update event.

8. **"stream uses router defaults and validator-protected state"** (lines 332-384): Creates a node that sets `counter: 1` but the compile-time `outputSchema` requires `counter >= 2`. Streams with `modes: ["updates"]` and gets zero events (update is rejected by validation). Then streams with no explicit modes (defaults to `"values"`) and gets one event where `counter` is `undefined` (the invalid update was not applied).

9. **"stream executes full WorkflowSDK.stream() path across modes"** (lines 386-478): A two-node graph where the first node has a retry config (`maxAttempts: 2`) and an outputSchema requiring `counter >= 2`. The first node increments a counter and emits a `"progress"` event. The test verifies all four stream modes (`values`, `updates`, `events`, `debug`) produce the correct events in the expected order, including retry count and resolved model in debug traces.

---

## 3. Provider Registry

**File:** `/home/alilavaee/Documents/projects/workflow-sdk/src/workflows/graph/provider-registry.ts`

### AgentProvider Interface (lines 6-10)

```typescript
interface AgentProvider {
  name: string;
  createSession(config: SessionConfig): Promise<Session>;
  supportedModels(): string[];
}
```

Defines the contract for any provider that can create agent sessions.

### ProviderRegistry Class (lines 15-33)

An immutable registry that stores `AgentProvider` instances keyed by name.

**Constructor** (lines 18-19): Accepts a `Record<string, AgentProvider>` and converts it to a `ReadonlyMap`.

**Methods:**
- `get(name): AgentProvider | undefined` (lines 22-24) -- Lookup by name.
- `list(): string[]` (lines 26-28) -- Returns all registered provider names as an array.
- `has(name): boolean` (lines 30-32) -- Checks if a provider exists.

The registry is immutable after construction. It is constructed once during `WorkflowSDK.init()` at line 77 of `sdk.ts` and stored as the public readonly field `providerRegistry`.

---

## 4. Agent Providers

**File:** `/home/alilavaee/Documents/projects/workflow-sdk/src/workflows/graph/agent-providers.ts`

### ClientBackedAgentProvider (lines 24-57)

Wraps a `CodingAgentClient` as an `AgentProvider`. This is the core adapter used by `WorkflowSDK`.

**Constructor** (lines 30-34): Accepts `ClientBackedProviderConfig` with `name`, `client`, and optional `supportedModels`.

**Lazy start** (lines 45-56): The `ensureStarted()` method lazily calls `client.start()` the first time a session is created. The resulting promise is stored in `startPromise` so subsequent calls await the same promise. If `start()` fails, `startPromise` is reset to `null` so the next attempt retries.

**`createSession(config)`** (lines 36-39): Awaits `ensureStarted()`, then delegates to `this.client.createSession(config)`.

**`supportedModels()`** (lines 41-43): Returns a copy of the models array.

### Provider Factory Functions

Each factory creates a `ClientBackedAgentProvider` with a provider-specific client:

- **`createClaudeAgentProvider(options?)`** (lines 97-105): Uses `createClaudeAgentClient()` from the SDK clients. Default supported models: `["opus", "sonnet", "haiku"]` (line 12).

- **`createOpenCodeAgentProvider(options?)`** (lines 110-118): Uses `createOpenCodeClient(options.clientOptions)`. Default supported models: empty array.

- **`createCopilotAgentProvider(options?)`** (lines 123-131): Uses `createCopilotClient(options.clientOptions)`. Default supported models: empty array.

### createDefaultProviderRegistry (lines 136-144)

Constructs a `ProviderRegistry` with all three providers (claude, opencode, copilot) pre-registered. Each provider uses defaults unless overridden via `DefaultProviderRegistryOptions`.

---

## 5. SubagentGraphBridge

**File:** `/home/alilavaee/Documents/projects/workflow-sdk/src/workflows/graph/subagent-bridge.ts`

### Overview

The bridge creates one session per sub-agent invocation, sends the task as a message, collects the streaming response, and destroys the session. It relies on the provider's native sub-agent dispatch for tool configuration and model selection.

### Key Types

- **`CreateSessionFn`** (line 57): `(config?: SessionConfig) => Promise<Session>` -- Factory function injected at construction.

- **`SubagentSpawnOptions`** (lines 62-79): Configuration for a single sub-agent spawn. Fields: `agentId`, `agentName`, `task`, optional `systemPrompt`, `model`, `tools`, `timeout`, and `abortSignal`.

- **`SubagentResult`** (lines 84-97): Returned after sub-agent completes. Fields: `agentId`, `success`, `output` (truncated to 4000 chars), optional `error`, `toolUses`, `durationMs`.

### Constructor (lines 132-135)

Accepts a `SubagentGraphBridgeConfig` with:
- `createSession`: The session factory closure (provided by `WorkflowSDK` at line 93-98 of `sdk.ts`).
- `sessionDir`: Optional path for persisting results.

### `setSessionDir(dir)` (lines 137-139)

Allows updating the session directory after construction.

### `spawn(options): Promise<SubagentResult>` (lines 144-268)

The primary execution method:

1. **Session creation** (lines 152-157): Builds a `SessionConfig` from `options` (systemPrompt, model, tools) and calls `this.createSession(sessionConfig)`.

2. **Abort handling** (lines 159-176): Creates an `AbortController`. If `options.timeout` is set, a `setTimeout` calls `abort()`. If `options.abortSignal` is provided, its abort event is forwarded to the internal controller.

3. **Streaming** (lines 182-189): Wraps `session.stream(options.task)` in `abortableAsyncIterable()` (lines 23-48) which races each iterator step against the abort signal. Collects text content into `summaryParts` and counts `tool_use` messages.

4. **Abort result** (lines 202-218): If aborted, optionally calls `session.abort()`, then returns a failure result distinguishing between external abort ("was cancelled") and timeout.

5. **Success result** (lines 220-239): Truncates the summary to `MAX_SUMMARY_LENGTH` (4000 chars, line 104). If `sessionDir` is set, calls `saveSubagentOutput()` from `../session.ts`.

6. **Error handling** (lines 240-258): Catches any error, constructs a failure result, and optionally persists it.

7. **Cleanup** (lines 259-266): Always destroys the session in a `finally` block.

### `spawnParallel(agents, abortSignal?): Promise<SubagentResult[]>` (lines 276-303)

Spawns multiple sub-agents concurrently using `Promise.allSettled()`. If an external `abortSignal` is provided, it is forwarded to each individual spawn call. Rejected promises are converted to failure results.

### Helper: `abortableAsyncIterable` (lines 23-48)

Wraps an `AsyncIterable<T>` so that it rejects immediately when the abort signal fires, using `Promise.race()` between `iterator.next()` and an abort-triggered rejection promise.

---

## 6. SubagentTypeRegistry

**File:** `/home/alilavaee/Documents/projects/workflow-sdk/src/workflows/graph/subagent-registry.ts`

### SubagentEntry (lines 20-24)

```typescript
interface SubagentEntry {
  name: string;
  info: AgentInfo;
  source: AgentSource;
}
```

### SubagentTypeRegistry Class (lines 33-55)

An in-memory `Map<string, SubagentEntry>` with these methods:
- `register(entry)` (lines 36-38): Stores an entry keyed by `entry.name`.
- `get(name)` (lines 40-42): Lookup by name.
- `has(name)` (lines 44-46): Existence check.
- `getAll()` (lines 48-50): Returns all entries as an array.
- `clear()` (lines 52-54): Removes all entries.

### `populateSubagentRegistry(registry)` (lines 64-75)

Calls `discoverAgentInfos()` from `agent-commands.ts` to find agent definitions from config directories. Iterates over discovered agents and registers each one. Project-local agents overwrite user-global agents on name conflict (because `discoverAgentInfos()` returns them in that priority order). Returns the total count of agents in the registry.

### Usage in WorkflowSDK

In `sdk.ts` lines 103-110, the `WorkflowSDK` constructor creates a `SubagentTypeRegistry` and populates it from `config.agents` (not from disk discovery via `populateSubagentRegistry`). This means the SDK relies on pre-discovered agents passed in via configuration, rather than discovering them itself.

---

## 7. Runtime Dependencies (`GraphRuntimeDependencies`)

**File:** `/home/alilavaee/Documents/projects/workflow-sdk/src/workflows/graph/types.ts`, lines 396-407

```typescript
interface GraphRuntimeDependencies {
  clientProvider?: (agentType: string) => CodingAgentClient | null;
  workflowResolver?: (name: string) => RuntimeSubgraph | null;
  subagentBridge?: {
    spawn(agent: SubagentSpawnOptions, abortSignal?: AbortSignal): Promise<SubagentResult>;
    spawnParallel(agents: SubagentSpawnOptions[], abortSignal?: AbortSignal): Promise<SubagentResult[]>;
  };
  subagentRegistry?: {
    get(name: string): SubagentEntry | undefined;
    getAll(): SubagentEntry[];
  };
}
```

These are attached to `GraphConfig.runtime` (line 474 of `types.ts`). The `WorkflowSDK` fills them in at construction time (lines 112-117 of `sdk.ts`) and applies them to every graph via `applyGraphDefaults()` (lines 237-253 of `sdk.ts`).

Node factories consume these dependencies from `ctx.config.runtime`:
- `agentNode` reads `clientProvider` at `nodes.ts:167`
- `subgraphNode` reads `workflowResolver` at `nodes.ts:1137`
- `subagentNode` reads `subagentBridge` at `nodes.ts:1674` and `subagentRegistry` at `nodes.ts:1682`

---

## 8. How the Ralph Workflow Actually Runs Today (Bypasses WorkflowSDK)

**File:** `/home/alilavaee/Documents/projects/workflow-sdk/src/ui/commands/workflow-commands.ts`

The `/ralph` command handler (function `createRalphCommand`, lines 597-793) does **not** use `WorkflowSDK.init()`. Instead, it manually constructs each dependency and injects them directly into the compiled graph's config.

### Execution Path

1. **Parse args** (lines 616-623): Calls `parseRalphArgs(args)`.

2. **Session setup** (lines 631-641): Creates a `sessionId`, resolves the `sessionDir`, initializes a `WorkflowSession`.

3. **Initial state** (lines 654-658): Calls `createRalphState(sessionId, { yoloPrompt, ralphSessionDir, maxIterations: 100 })`.

4. **Bridge construction** (lines 661-676): Creates an ad-hoc bridge object (not a `SubagentGraphBridge` instance) with `spawn` and `spawnParallel` methods that delegate to `context.spawnSubagentParallel!()`. This is a different bridge interface than what `WorkflowSDK` would create -- it uses the chat UI's native sub-agent spawning mechanism.

5. **Registry construction** (lines 679-687): Creates a fresh `SubagentTypeRegistry` and populates it by calling `discoverAgentInfos()` and registering each agent. This mirrors what `populateSubagentRegistry()` does, but is done inline.

6. **Graph compilation** (line 690): Calls `createRalphWorkflow()` from `src/workflows/ralph/graph.ts` to get a `CompiledGraph<RalphWorkflowState>`.

7. **Runtime injection** (lines 691-695): Directly mutates `compiled.config.runtime` to set `subagentBridge` and `subagentRegistry`. Note: `clientProvider` and `workflowResolver` are **not** set, which means `agentNode` and `subgraphNode` factories would fail if the Ralph workflow used them. The Ralph workflow only uses `subagentNode` and `toolNode`, which only need the bridge and registry.

8. **Streaming execution** (lines 702-741): Calls `streamGraph(compiled, { initialState })` from `compiled.ts` directly (not `sdk.stream()`). Iterates over `StepResult` objects, updating the UI for each node:
   - Displays phase descriptions via `getNodePhaseDescription()` (lines 57-69)
   - Persists tasks to disk and updates the TUI task list (lines 718-739)

### Ralph Workflow Graph Structure

**File:** `/home/alilavaee/Documents/projects/workflow-sdk/src/workflows/ralph/graph.ts`

`createRalphWorkflow()` (lines 98-236) builds a three-phase graph using the fluent builder API:

**Phase 1 -- Task Decomposition:**
- `.subagent("planner")` -- Sends the user prompt through `buildSpecToTasksPrompt()`, maps output to `specDoc`.
- `.tool("parse-tasks")` -- Parses `specDoc` into `TaskItem[]`, maps to `tasks`, `currentTasks`, `iteration: 0`.

**Phase 2 -- Worker Loop:**
- `.loop([select-ready-tasks, worker], { until: ... })` -- Two-node loop body:
  - `select-ready-tasks` (toolNode): Calls `getReadyTasks(state.tasks)`, maps to `currentTasks`.
  - `worker` (custom NodeDefinition): Reads `ctx.config.runtime.subagentBridge`, spawns a single worker sub-agent for the first ready task, marks tasks as `"completed"` or `"error"` based on the result.
- Loop exits when: all tasks are completed/error, `iteration >= maxIterations`, or no actionable tasks remain.

**Phase 3 -- Review & Fix:**
- `.subagent("reviewer")` -- Reviews completed work via `buildReviewPrompt()`, maps to `reviewResult`.
- `.if({ condition, then: [fixer] })` -- If review finds issues and `overall_correctness !== "patch is correct"`, runs a fixer subagent (`"debugger"` agent).

### Ralph State

**File:** `/home/alilavaee/Documents/projects/workflow-sdk/src/workflows/ralph/state.ts`

`RalphWorkflowState` (lines 51-80) extends `BaseState` with fields for tasks, review results, iteration counters, session info, and feature tracking. Uses annotation-based reducers for merge semantics (e.g., `mergeByIdReducer` for `tasks`, `concatReducer` for `debugReports`).

---

## 9. Summary: Designed vs. Actual Usage

### What WorkflowSDK Provides

The `WorkflowSDK` class is designed as a complete runtime container that:
- Wraps raw `CodingAgentClient` instances into `ClientBackedAgentProvider` objects with lazy start
- Manages a `ProviderRegistry` for multi-provider lookup
- Creates a `SubagentGraphBridge` bound to a specific provider for session creation
- Maintains a `SubagentTypeRegistry` from pre-discovered agent definitions
- Provides a `workflowResolver` for named subgraph lookup
- Injects all four runtime dependencies into any compiled graph via `applyGraphDefaults()`
- Applies SDK-level defaults (checkpointer, defaultModel, maxSteps, validation)
- Offers `execute()` and `stream()` methods that handle all wiring automatically

### How Ralph Actually Uses It

The Ralph command handler in `workflow-commands.ts` bypasses `WorkflowSDK` entirely:
- It creates its own ad-hoc bridge object that delegates to the chat UI's `context.spawnSubagentParallel!()` -- this is because the TUI needs to control how sub-agents are spawned (e.g., for UI tracking, tree rendering)
- It creates its own `SubagentTypeRegistry` populated via `discoverAgentInfos()`
- It directly mutates `compiled.config.runtime` to inject only `subagentBridge` and `subagentRegistry`
- It calls `streamGraph()` directly instead of `sdk.stream()`
- It does not use `clientProvider` or `workflowResolver` because the Ralph workflow only uses `subagentNode` and `toolNode` factories (no `agentNode` or `subgraphNode`)

The reason the Ralph workflow can bypass the SDK is that it only needs two of the four runtime dependencies (`subagentBridge` and `subagentRegistry`), and it needs a custom bridge implementation that routes through the TUI's sub-agent spawning mechanism rather than through the SDK's provider-based session creation.

---

## 10. Graph Execution Engine (Supporting Context)

### GraphExecutor (`compiled.ts`, lines 253-832)

The executor that `WorkflowSDK.execute()` and `WorkflowSDK.stream()` both use internally:

- `stream()` (lines 311-320): The overloaded method that either yields raw `StepResult` objects or routes them through `StreamRouter` when `modes` are provided.
- `streamSteps()` (lines 322-569): The core execution loop. Uses a BFS-style queue starting from `graph.startNode`. For each node: resolves the model, executes with retry, merges state, handles signals, auto-checkpoints, determines next nodes from edges.
- `executeWithRetry()` (lines 615-753): Retries node execution up to `retryConfig.maxAttempts` with exponential backoff. Supports custom `onError` handlers with `retry`, `skip`, `abort`, and `goto` actions.

### StreamRouter (`stream.ts`, lines 56-118)

Projects raw `StepResult` streams into typed `StreamEvent` unions based on selected modes:
- `"values"` -- Full state snapshot after each node.
- `"updates"` -- Only the `stateUpdate` partial from each node result.
- `"events"` -- Custom events emitted via `ctx.emit()` during node execution.
- `"debug"` -- Execution metadata: timing, retry count, resolved model.

### GraphBuilder (`builder.ts`, lines 229-951)

Fluent API for constructing graphs:
- `.start(node)` -- Set the entry node.
- `.then(node)` -- Chain a sequential node.
- `.subagent(config)` -- Create and chain a subagent node.
- `.tool(config)` -- Create and chain a tool node.
- `.if(condition)` / `.else()` / `.endif()` or `.if(configObject)` -- Conditional branching.
- `.loop(bodyNodes, config)` -- Looping construct with exit condition.
- `.parallel(config)` -- Parallel branch execution.
- `.wait(prompt)` -- Human-in-the-loop pause.
- `.catch(handler)` -- Error handler node.
- `.end()` -- Mark terminal node.
- `.compile(config?)` -- Produce a `CompiledGraph`.
