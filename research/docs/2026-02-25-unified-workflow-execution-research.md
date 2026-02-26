---
date: 2026-02-26 00:00:45 UTC
researcher: Claude Opus 4.6
git_commit: 0756a9cd380a7d153963fc96a09c2afedbffdc6f
branch: lavaman131/feature/workflow-sdk
repository: workflow-sdk
topic: "Unified Workflow Execution Interface: Current Architecture and Hardcoded Patterns"
tags: [research, codebase, workflow-sdk, graph-engine, ralph, unified-execution, command-registry, workflow-discovery]
status: complete
last_updated: 2026-02-25
last_updated_by: Claude Opus 4.6
---

# Research: Unified Workflow Execution Interface

## Research Question

Document the current workflow execution architecture, including: (1) how workflows are defined, registered, and triggered; (2) how the Ralph workflow is hardcoded via `createRalphCommand` and related patterns; (3) what abstractions exist (or are missing) for a generic workflow execution interface; and (4) how the UI/CLI layer couples to specific workflow implementations. The goal is to understand the current state so we can design a unified workflow SDK that allows any workflow to be executed through a common interface rather than requiring per-workflow command scaffolding.

## Summary

The codebase contains a mature graph execution engine with a fluent builder API, typed state management, 12+ node factories, and a `WorkflowSDK` facade class designed for generic workflow execution. However, the UI command layer has a hardcoded dispatch pattern where `createWorkflowCommand()` checks `metadata.name === "ralph"` and routes to a specialized `createRalphCommand()` handler that performs actual graph execution. All non-Ralph workflows receive a generic handler that only sets UI state flags and sends the user prompt through normal chat — no graph is built or executed. The `WorkflowSDK` class is never used at runtime; Ralph bypasses it entirely with ad-hoc runtime dependency construction. Custom workflow files (`.atomic/workflows/*.ts`) can export metadata (name, description, version) but have no mechanism to export a graph definition or factory function. This document maps the complete architecture and the specific points where generalization is needed.

---

## Table of Contents

1. [Workflow Lifecycle: End-to-End Flow](#1-workflow-lifecycle-end-to-end-flow)
2. [The Hardcoded Ralph Dispatch](#2-the-hardcoded-ralph-dispatch)
3. [Non-Ralph Workflow Path (The Gap)](#3-non-ralph-workflow-path-the-gap)
4. [WorkflowSDK Class (Unused at Runtime)](#4-workflowsdk-class-unused-at-runtime)
5. [Graph Execution Engine](#5-graph-execution-engine)
6. [Ralph Workflow Implementation](#6-ralph-workflow-implementation)
7. [Custom Workflow Discovery](#7-custom-workflow-discovery)
8. [UI-to-Workflow Coupling](#8-ui-to-workflow-coupling)
9. [Existing Abstractions for Unification](#9-existing-abstractions-for-unification)
10. [Architecture Documentation](#10-architecture-documentation)
11. [Code References](#11-code-references)
12. [Historical Context](#12-historical-context)
13. [Open Questions](#13-open-questions)

---

## 1. Workflow Lifecycle: End-to-End Flow

### 1.1 App Startup → Command Registration

The workflow registration flow from app boot to command availability:

```
src/cli.ts:281 (Commander.js default command)
  → src/commands/chat.ts:196 (chatCommand → startChatUI)
    → src/ui/index.ts:306 (startChatUI)
      → src/ui/index.ts:2022 (initializeCommandsAsync)
        → src/ui/commands/index.ts:87-95
          1. registerBuiltinCommands()          // /help, /clear, /model, etc.
          2. await loadWorkflowsFromDisk()      // Discover .atomic/workflows/*.ts
          3. registerWorkflowCommands()          // Register all workflow commands
          4. await loadSkillsFromDisk()          // Discover skills
          5. registerAgentCommands()              // Register agent commands
```

`registerWorkflowCommands()` at `src/ui/commands/workflow-commands.ts:899-907` calls `getAllWorkflows()` → `createWorkflowCommand()` for each, and registers with `globalRegistry`.

### 1.2 Command Invocation

When a user types `/ralph <prompt>` in the TUI:

```
src/ui/chat.tsx:3516 (executeCommand callback)
  → globalRegistry.get("ralph")                          // line 3525
  → Builds CommandContext with 18+ fields                 // lines 3540-3971
  → command.execute(args, context)                        // line 4017
  → Applies result.stateUpdate to UI state                // lines 4072-4091
```

The `CommandContext` object (defined at `src/ui/commands/registry.ts:75-168`) includes both generic helpers (`addMessage`, `setStreaming`, `sendMessage`) and Ralph-specific helpers (`setRalphSessionDir`, `setRalphSessionId`, `setRalphTaskIds`).

---

## 2. The Hardcoded Ralph Dispatch

### 2.1 The Dispatch Check

The central dispatch point is in `createWorkflowCommand()`:

```typescript
// src/ui/commands/workflow-commands.ts:543-548
function createWorkflowCommand(metadata: WorkflowMetadata): CommandDefinition {
    // Use specialized handler for ralph workflow
    if (metadata.name === "ralph") {
        return createRalphCommand(metadata);
    }
    // ... generic path follows
}
```

This is the only mechanism for routing a workflow to actual graph execution. Any workflow not named "ralph" falls through to the generic path.

### 2.2 What `createRalphCommand()` Does

The Ralph command handler at `src/ui/commands/workflow-commands.ts:597-793` performs:

1. **Argument parsing**: `parseRalphArgs(args)` at line 616
2. **Session initialization**: Creates UUID session ID, initializes `WorkflowSession` at lines 631-635
3. **UI state updates**: Sets `workflowActive`, `workflowType`, `ralphConfig` at lines 637-641
4. **State construction**: `createRalphState()` with session ID, prompt, and max iterations at lines 654-658
5. **Ad-hoc bridge construction**: Wraps `context.spawnSubagentParallel!()` into a bridge object at lines 661-676
6. **Subagent registry construction**: `new SubagentTypeRegistry()` populated with `discoverAgentInfos()` at lines 679-687
7. **Graph creation**: `createRalphWorkflow()` at line 690
8. **Runtime injection**: Directly mutates `compiled.config.runtime` at lines 691-695
9. **Graph streaming**: `for await (const step of streamGraph(compiled, { initialState }))` at lines 702-741
10. **UI progress updates**: Updates task list, session tracking, and messages in the streaming loop

This is approximately 200 lines of orchestration code specific to the Ralph workflow.

### 2.3 Ralph-Specific Artifacts Throughout the Codebase

The Ralph workflow creates coupling in multiple layers:

| Location | Ralph-Specific Code |
|----------|-------------------|
| `src/ui/commands/registry.ts:135-145` | `setRalphSessionDir`, `setRalphSessionId`, `setRalphTaskIds` methods on `CommandContext` |
| `src/ui/commands/registry.ts:211-214` | `ralphConfig` field on `CommandContextState` |
| `src/ui/chat.tsx:1841-1849` | Ralph-specific state variables (`ralphSessionId`, `ralphSessionDir`, `ralphTaskIds`) |
| `src/ui/chat.tsx:2328-2346` | TodoWrite filtering guard using `ralphTaskIds` |
| `src/ui/chat.tsx:2762-2766` | Auto-approve behavior during active workflows |
| `src/ui/chat.tsx:4480-4528` | Ctrl+C cancellation flow with Ralph state cleanup |
| `src/ui/commands/workflow-commands.ts:51` | `MAX_RALPH_ITERATIONS` constant |
| `src/ui/commands/workflow-commands.ts:57-69` | `getNodePhaseDescription()` with hardcoded Ralph node phase names |
| `src/ui/commands/workflow-commands.ts:78-93` | `RalphCommandArgs` interface and `parseRalphArgs()` |
| `src/ui/commands/workflow-commands.ts:200-235` | `saveTasksToActiveSession()` referencing Ralph session |

---

## 3. Non-Ralph Workflow Path (The Gap)

### 3.1 The Generic Handler

When `metadata.name !== "ralph"`, the generic handler at `src/ui/commands/workflow-commands.ts:549-594` does:

```typescript
execute: (args: string, context: CommandContext): CommandResult => {
    // 1. Check if a workflow is already active
    if (context.state.workflowActive) {
        return { success: false, message: `A workflow is already active...` };
    }

    // 2. Extract the prompt
    const initialPrompt = args.trim() || null;
    if (!initialPrompt) {
        return { success: false, message: `Please provide a prompt...` };
    }

    // 3. Add a system message
    context.addMessage("system", `Starting **${metadata.name}** workflow...`);

    // 4. Return success with state flags
    return {
        success: true,
        message: `Workflow **${metadata.name}** initialized.`,
        stateUpdate: {
            workflowActive: true,
            workflowType: metadata.name,
            initialPrompt,
            pendingApproval: false,
            specApproved: undefined,
            feedback: null,
        },
    };
}
```

### 3.2 What Happens After the Generic Handler

The `stateUpdate` with `workflowActive: true` triggers a React effect in `src/ui/chat.tsx:2534-2689` which:
1. Detects that `workflowActive` is true and `initialPrompt` has a value
2. Sends the `initialPrompt` through the standard `onStreamMessage` handler as a regular agent chat message
3. No graph is built, no session is created, no structured execution occurs

### 3.3 What Is Missing

For a non-Ralph workflow to have actual graph execution, the generic path would need:

1. **Graph factory**: A way to get a `CompiledGraph` from the workflow definition
2. **State factory**: A way to create the initial state for the workflow
3. **Runtime dependencies**: Bridge, registry, provider setup
4. **Streaming integration**: Progress updates, task list, session management
5. **Node phase descriptions**: UI labels for each node
6. **Error/cancellation handling**: Ctrl+C flow, cleanup

None of these exist in the generic path today.

---

## 4. WorkflowSDK Class (Unused at Runtime)

### 4.1 Design

The `WorkflowSDK` class at `src/workflows/graph/sdk.ts` is a facade designed for exactly this purpose:

```typescript
export class WorkflowSDK {
    // Initialized with providers, workflows, agents, checkpointing, model config
    static init(config: WorkflowSDKConfig): WorkflowSDK;

    // Create a graph builder
    graph<TState>(): GraphBuilder<TState>;

    // Execute a compiled workflow
    execute<TState>(compiled: CompiledGraph<TState>, options?): Promise<ExecutionResult<TState>>;

    // Stream workflow execution events
    stream<TState>(compiled: CompiledGraph<TState>, options?): AsyncGenerator<StreamEvent<TState>>;

    // Register named workflows for subgraph resolution
    registerWorkflow(name: string, workflow: WorkflowRegistration): void;

    // Stop all provider clients
    destroy(): Promise<void>;
}
```

`WorkflowSDKConfig` (`sdk.ts:32-43`) accepts:
- `providers`: Record of coding agent clients (Claude, OpenCode, Copilot)
- `workflows`: Named workflow map for resolution
- `agents`: Agent info map for subagent registry
- `checkpointer`: Checkpoint type and options
- `defaultModel`: Default model specification
- `maxSteps`: Step limit
- `subagentProvider`: Provider name for sub-agents

### 4.2 What It Manages

The `WorkflowSDK` constructor (`sdk.ts:66-118`) sets up:
1. **ProviderRegistry**: Wraps raw clients into `ClientBackedAgentProvider` instances
2. **SubagentGraphBridge**: Creates sessions via the provider registry
3. **SubagentTypeRegistry**: Populated from `agents` config
4. **RuntimeDependencies**: Assembled object with `clientProvider`, `subagentBridge`, `subagentRegistry`, `workflowResolver`
5. **Graph defaults**: Auto-injects checkpointer, model, runtime deps into compiled graphs via `applyGraphDefaults()`

### 4.3 Why It's Bypassed

The Ralph command at `workflow-commands.ts:597-793` bypasses `WorkflowSDK` because:

1. **Different bridge pattern**: Ralph routes sub-agent spawning through `context.spawnSubagentParallel!()` (TUI-provided), not through the SDK's `SubagentGraphBridge` which creates its own sessions
2. **No provider setup**: The TUI already has an active session; the SDK would create redundant sessions
3. **Direct graph mutation**: Ralph directly mutates `compiled.config.runtime` instead of going through `applyGraphDefaults()`
4. **Only partial deps needed**: Ralph only uses `subagentBridge` and `subagentRegistry`, not `clientProvider` or `workflowResolver`

### 4.4 SDK Test Usage

Tests at `src/workflows/graph/sdk.test.ts` (9 test scenarios) demonstrate the intended usage:
- Creating SDK with multiple providers
- Executing compiled graphs through `sdk.execute()`
- Streaming through `sdk.stream()`
- Runtime dependency injection validation
- Subagent provider resolution

---

## 5. Graph Execution Engine

### 5.1 GraphBuilder (`src/workflows/graph/builder.ts`)

Fluent API for constructing workflows:

```typescript
graph<MyState>()
    .start(startNode)
    .then(nodeA)
    .subagent({ id: "planner", agent: "planner", task: (s) => s.prompt, ... })
    .tool({ id: "parser", toolName: "parse", execute: fn, args: fn, ... })
    .loop([nodeA, nodeB], { until: (s) => s.done, maxIterations: 100 })
    .if({ condition: fn, then: [...], else: [...] })
    .parallel([branch1, branch2], { strategy: "all" })
    .wait({ prompt: "Continue?" })
    .catch(errorHandler)
    .compile(config?)
```

Key methods: `.start()`, `.then()`, `.subagent()`, `.tool()`, `.loop()`, `.if()/.else()/.endif()`, `.parallel()`, `.wait()`, `.catch()`, `.end()`, `.compile()`

### 5.2 Node Types (`src/workflows/graph/nodes.ts`)

12 factory functions:

| Factory | Purpose |
|---------|---------|
| `agentNode()` | AI agent session execution |
| `toolNode()` | Explicit tool function execution |
| `subagentNode()` | Single sub-agent spawning via bridge |
| `parallelSubagentNode()` | Concurrent multi-agent spawning |
| `decisionNode()` | Condition-based routing |
| `waitNode()` | Human-in-the-loop pause |
| `askUserNode()` | Structured user questions |
| `parallelNode()` | Concurrent branch execution |
| `subgraphNode()` | Nested graph execution |
| `contextMonitorNode()` | Context window monitoring |
| `customToolNode()` | Registry-resolved tool with validation |
| `clearContextNode()` | Context window clearing |

### 5.3 Compiled Graph Execution (`src/workflows/graph/compiled.ts`)

`GraphExecutor` handles:
- Queue-based node traversal
- Loop detection and iteration limits
- Retry with exponential backoff
- State merging with annotation reducers
- Signal handling (human_input_required, checkpoint saves)
- Abort support
- Progress callbacks

Entry points: `executeGraph()` (batch) and `streamGraph()` (async generator yielding `StepResult`).

### 5.4 State Management (`src/workflows/graph/annotation.ts`)

Annotation system for typed state:
- `annotation<T>(default, reducer?)` — defines a state field
- Reducers: `Reducers.replace`, `Reducers.append`, `Reducers.merge`, custom functions
- `initializeState(annotations)` — creates initial state from annotations
- `applyStateUpdate(annotations, current, update)` — applies partial update using reducers

### 5.5 Workflow Templates (`src/workflows/graph/templates.ts`)

Four reusable graph patterns:

| Template | Pattern |
|----------|---------|
| `sequential(nodes)` | Linear chain of nodes |
| `mapReduce(options)` | Splitter → parallel workers → reducer |
| `reviewCycle(options)` | Execute → review → conditional fix loop |
| `taskLoop(options)` | Task decomposition → worker loop |

**Note**: Ralph does not use these templates; it builds its graph directly via the GraphBuilder fluent API.

---

## 6. Ralph Workflow Implementation

### 6.1 Graph Structure (`src/workflows/ralph/graph.ts`)

`createRalphWorkflow()` at line 98 builds a 3-phase compiled graph:

```
Phase 1: Task Decomposition
  planner (subagent) → parse-tasks (tool)

Phase 2: Worker Loop
  loop([select-ready-tasks (tool), worker (custom agent)])
    until: all tasks completed/errored OR maxIterations reached OR no actionable tasks

Phase 3: Review & Fix
  reviewer (subagent) → if(findings && !correct) → fixer (subagent)
```

### 6.2 State (`src/workflows/ralph/state.ts`)

`RalphWorkflowState` interface (line 51) has 30 fields:
- **Base fields**: `executionId`, `lastUpdated`, `outputs`
- **Workflow pipeline**: `researchDoc`, `specDoc`, `tasks`, `currentTasks`, `reviewResult`, `fixesApplied`, `featureList`, `currentFeature`, `debugReports`
- **Ralph-specific**: `ralphSessionId`, `ralphSessionDir`, `yolo`, `yoloPrompt`, `yoloComplete`, `maxIterations`, `shouldContinue`, `completedFeatures`

`RalphStateAnnotation` (line 82) defines reducers per field, notably:
- `tasks`: `mergeByIdReducer("id")` — merge-by-ID preserving task identity
- `debugReports`: `concatReducer` — append-only
- `currentTasks`: replace reducer (always overwrites)

### 6.3 Session Management (`src/workflows/session.ts`)

Session management is **generic** (not Ralph-specific):
- `WorkflowSession` interface with `sessionId`, `workflowName`, `sessionDir`, `status`, `nodeHistory`, `outputs`
- `initWorkflowSession(workflowName, sessionId?)` — creates session directory at `~/.atomic/workflows/sessions/{sessionId}/`
- `saveWorkflowSession()` — persists session metadata
- `saveSubagentOutput()` — stores per-agent results

---

## 7. Custom Workflow Discovery

### 7.1 Search Paths

`CUSTOM_WORKFLOW_SEARCH_PATHS` at `src/ui/commands/workflow-commands.ts:268-273`:
1. `.atomic/workflows` — project-local (highest priority)
2. `~/.atomic/workflows` — user-global

### 7.2 Discovery (`discoverWorkflowFiles()`)

At `workflow-commands.ts:343-372`:
- Scans each search path for `.ts` files
- Returns `{ path, source }` pairs (source: "local" | "global")

### 7.3 Loading (`loadWorkflowsFromDisk()`)

At `workflow-commands.ts:401-471`:
- Dynamic `import()` of each discovered file
- Extracts exports: `name`, `description`, `aliases`, `version`, `minSDKVersion`, `stateVersion`, `migrateState`
- Local workflows take priority over global by name deduplication
- Validates `minSDKVersion` against current `VERSION`

### 7.4 What Custom Workflows Can Export

Currently supported exports (metadata only):

```typescript
// .atomic/workflows/my-workflow.ts
export const name = "my-workflow";
export const description = "My custom workflow";
export const aliases = ["mw"];
export const version = "1.0.0";
export const minSDKVersion = "1.0.0";
export const stateVersion = 1;
export function migrateState(oldState: unknown, fromVersion: number): BaseState { ... }
```

### 7.5 What Custom Workflows Cannot Export

There is **no mechanism** for custom workflows to export:
- A graph factory function (e.g., `export function createGraph(): CompiledGraph`)
- An initial state factory (e.g., `export function createState(prompt: string): MyState`)
- Node phase descriptions for UI progress
- Runtime dependency requirements
- A `WorkflowRegistration` compatible with `WorkflowSDK.registerWorkflow()`

### 7.6 Workflow Metadata Interface

`WorkflowMetadata` at `workflow-commands.ts:110-131`:

```typescript
export interface WorkflowMetadata {
    name: string;
    description: string;
    aliases?: string[];
    defaultConfig?: Record<string, unknown>;
    version?: string;
    minSDKVersion?: string;
    stateVersion?: number;
    migrateState?: WorkflowStateMigrator;
    source?: "builtin" | "global" | "local";
    argumentHint?: string;
}
```

Missing from this interface: any reference to graph construction, state factories, or execution logic.

---

## 8. UI-to-Workflow Coupling

### 8.1 CommandContext Ralph-Specific Fields

The `CommandContext` interface at `src/ui/commands/registry.ts:75-168` includes:

| Method/Field | Purpose | Ralph-Specific? |
|-------------|---------|-----------------|
| `setRalphSessionDir(dir)` | Set session directory for task panel | Yes |
| `setRalphSessionId(id)` | Set session ID for task panel | Yes |
| `setRalphTaskIds(ids)` | Guard TodoWrite persistence | Yes |
| `spawnSubagentParallel?()` | Parallel sub-agent spawning | No (generic) |
| `streamAndWait()` | Send prompt and wait for response | No (generic) |
| `setTodoItems(items)` | Update task list UI | No (generic) |
| `clearContext()` | Clear context window | No (generic) |
| `setStreaming(streaming)` | Set streaming state | No (generic) |

### 8.2 CommandContextState Ralph-Specific Fields

The `CommandContextState` at `registry.ts:185-215` includes:

```typescript
ralphConfig?: {
    userPrompt: string | null;
    sessionId?: string;
};
```

### 8.3 Chat UI (`src/ui/chat.tsx`) Ralph State

Ralph-specific state variables declared in the chat component:
- `ralphSessionId` (line ~1841)
- `ralphSessionDir` (line ~1843)
- `ralphTaskIds` (line ~1845)

These are used for:
- TodoWrite filtering (lines 2328-2346): Only persist task updates from Ralph's own tasks
- Session tracking for the persistent task list panel
- Ctrl+C cancellation cleanup (lines 4480-4528)

### 8.4 CommandResult Workflow Fields

`CommandResult` at `registry.ts:220-251` does not have workflow-specific fields — it uses generic `stateUpdate` to communicate workflow state changes.

---

## 9. Existing Abstractions for Unification

### 9.1 Already Generic

These components are already designed for multi-workflow use:

1. **GraphBuilder** (`builder.ts`): Fully generic, parameterized by `TState`
2. **GraphExecutor** (`compiled.ts`): Executes any `CompiledGraph<TState>`
3. **streamGraph()** (`compiled.ts`): Streams any compiled graph
4. **Node factories** (`nodes.ts`): 12 generic node types
5. **WorkflowSDK** (`sdk.ts`): Designed as a generic facade
6. **Session management** (`session.ts`): Generic `WorkflowSession` with `workflowName` field
7. **Annotation system** (`annotation.ts`): Generic typed state management
8. **SubagentGraphBridge** (`subagent-bridge.ts`): Generic sub-agent spawning
9. **SubagentTypeRegistry** (`subagent-registry.ts`): Generic agent type registry
10. **ProviderRegistry** (`provider-registry.ts`): Generic provider management
11. **Workflow templates** (`templates.ts`): Reusable graph patterns
12. **Command Registry** (`registry.ts`): Generic command registration

### 9.2 Ralph-Specific (Would Need Generalization)

These are currently hardcoded to Ralph:

1. **`createWorkflowCommand()`** dispatch — the `if (metadata.name === "ralph")` check
2. **`createRalphCommand()`** — 200 lines of Ralph-specific orchestration in the UI layer
3. **`getNodePhaseDescription()`** — hardcoded node-to-description mapping for Ralph nodes
4. **`CommandContext` Ralph methods** — `setRalphSessionDir`, `setRalphSessionId`, `setRalphTaskIds`
5. **`CommandContextState.ralphConfig`** — Ralph-specific state field
6. **Chat.tsx Ralph state** — `ralphSessionId`, `ralphSessionDir`, `ralphTaskIds` variables
7. **TodoWrite guard** — Filters task persistence by Ralph task IDs
8. **`WorkflowMetadata`** — Missing graph/state factory fields
9. **Custom workflow exports** — No graph export mechanism

### 9.3 Patterns That Could Bridge the Gap

1. **`WorkflowSDK.registerWorkflow()`** accepts `WorkflowRegistration<TState>` which is `CompiledSubgraph<TState> | CompiledGraph<TState>` — this is the registration interface
2. **`WorkflowSDK.stream()`** returns `AsyncGenerator<StreamEvent<TState>>` — this is the execution interface
3. **`WorkflowSDK.execute()`** returns `Promise<ExecutionResult<TState>>` — batch alternative
4. **`taskLoop` template** already implements decompose→worker pattern generically
5. **`reviewCycle` template** already implements execute→review→fix generically

---

## 10. Architecture Documentation

### 10.1 Current Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI LAYER                                 │
│                                                                   │
│  chat.tsx ──── executeCommand() ──── globalRegistry.get()        │
│     │                                        │                    │
│     │ Ralph state:                    CommandDefinition           │
│     │  - ralphSessionId              execute(args, context)      │
│     │  - ralphSessionDir                     │                    │
│     │  - ralphTaskIds                        ▼                    │
│     │                          ┌─────────────────────┐           │
│     │                          │ createWorkflowCommand│           │
│     │                          │   (dispatch check)   │           │
│     │                          └────────┬────────────┘           │
│     │                            ┌──────┴──────┐                 │
│     │                    name==="ralph"   name!=="ralph"          │
│     │                            │              │                 │
│     │                            ▼              ▼                 │
│     │                  createRalphCommand   generic handler       │
│     │                  (200 lines)          (sets state only)     │
│     │                            │              │                 │
│     │                            ▼              ▼                 │
│     │                  Graph execution    onStreamMessage          │
│     │                  + streaming        (regular chat)          │
│     │                            │                                │
└─────┼────────────────────────────┼────────────────────────────────┘
      │                            │
┌─────┼────────────────────────────┼────────────────────────────────┐
│     │            WORKFLOW LAYER  │                                 │
│     │                            ▼                                │
│     │              createRalphWorkflow()                          │
│     │                     │                                       │
│     │                     ▼                                       │
│     │              graph<RalphWorkflowState>()                   │
│     │                .subagent("planner")                         │
│     │                .tool("parse-tasks")                         │
│     │                .loop([select, worker], {until})             │
│     │                .subagent("reviewer")                        │
│     │                .if({condition, then: [fixer]})             │
│     │                .compile()                                   │
│     │                     │                                       │
│     │                     ▼                                       │
│     │              streamGraph(compiled, {initialState})         │
│     │                     │                                       │
│     │                     ▼                                       │
│     │              GraphExecutor.streamSteps()                   │
│     │                                                             │
│     │   ┌─────────────────────────────────────────────────┐      │
│     │   │  WorkflowSDK (exists but unused at runtime)     │      │
│     │   │  - init(config)                                  │      │
│     │   │  - execute(compiled, options)                     │      │
│     │   │  - stream(compiled, options)                      │      │
│     │   │  - registerWorkflow(name, workflow)               │      │
│     │   └─────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

### 10.2 Data Flow: Ralph Workflow Execution

```
User types "/ralph fix auth bug"
  → parseRalphArgs("fix auth bug")
  → createRalphState(sessionId, { yoloPrompt: "fix auth bug", ... })
  → createRalphWorkflow()  →  CompiledGraph<RalphWorkflowState>
  → Inject ad-hoc bridge + registry into compiled.config.runtime
  → for await (step of streamGraph(compiled, { initialState }))
      → step.nodeId: "planner" → UI shows "Planning..."
      → step.nodeId: "parse-tasks" → UI shows "Parsing..."
      → step.nodeId: "select-ready-tasks" → UI shows "Selecting..."
      → step.nodeId: "worker" → UI shows "Working..."
      → (loop repeats until all tasks done)
      → step.nodeId: "reviewer" → UI shows "Reviewing..."
      → step.nodeId: "fixer" (conditional) → UI shows "Fixing..."
  → Workflow complete → clear workflowActive state
```

### 10.3 Data Flow: Non-Ralph Workflow (What Happens Today)

```
User types "/my-workflow do something"
  → Generic handler sets stateUpdate: { workflowActive: true, initialPrompt: "do something" }
  → React effect detects workflowActive + initialPrompt
  → onStreamMessage("do something")  ← regular chat message, no graph
  → Agent responds as if it were a normal conversation
  → No structured execution, no task decomposition, no review
```

---

## 11. Code References

### Core Files

| File | Lines | Description |
|------|-------|-------------|
| `src/ui/commands/workflow-commands.ts` | 926 | Workflow command creation, Ralph handler, session management |
| `src/workflows/graph/sdk.ts` | 278 | WorkflowSDK facade class (unused at runtime) |
| `src/workflows/graph/builder.ts` | ~700 | GraphBuilder fluent API |
| `src/workflows/graph/compiled.ts` | ~600 | GraphExecutor, executeGraph, streamGraph |
| `src/workflows/graph/nodes.ts` | ~900 | 12 node factory functions |
| `src/workflows/graph/types.ts` | ~350 | Core type definitions |
| `src/workflows/graph/annotation.ts` | ~200 | State annotation system |
| `src/workflows/graph/templates.ts` | ~250 | Reusable workflow templates |
| `src/workflows/ralph/graph.ts` | 237 | Ralph graph definition |
| `src/workflows/ralph/state.ts` | 210 | Ralph state and annotations |
| `src/workflows/ralph/prompts.ts` | ~350 | Ralph prompt builders |
| `src/workflows/session.ts` | 96 | Generic session management |
| `src/ui/commands/registry.ts` | 535 | Command registry, CommandContext, CommandResult |
| `src/ui/chat.tsx` | ~5000 | Chat UI with Ralph-specific state and effects |
| `src/ui/index.ts` | ~2100 | App initialization, command registration |
| `src/ui/commands/index.ts` | ~100 | Command initialization orchestration |

### Key Functions

| Function | File:Line | Purpose |
|----------|-----------|---------|
| `createWorkflowCommand()` | `workflow-commands.ts:543` | Dispatch: Ralph vs generic |
| `createRalphCommand()` | `workflow-commands.ts:597` | Ralph-specific command handler |
| `createRalphWorkflow()` | `ralph/graph.ts:98` | Build Ralph compiled graph |
| `createRalphState()` | `ralph/state.ts:128` | Initialize Ralph state |
| `streamGraph()` | `compiled.ts` | Stream any compiled graph |
| `executeGraph()` | `compiled.ts` | Execute any compiled graph |
| `WorkflowSDK.init()` | `sdk.ts:123` | Create SDK instance |
| `WorkflowSDK.stream()` | `sdk.ts:149` | Stream through SDK |
| `loadWorkflowsFromDisk()` | `workflow-commands.ts:401` | Discover custom workflows |
| `registerWorkflowCommands()` | `workflow-commands.ts:899` | Register all workflow commands |
| `getAllWorkflows()` | `workflow-commands.ts:477` | Get builtin + disk workflows |
| `discoverAgentInfos()` | `agent-commands.ts:259` | Discover agent definitions |

---

## 12. Historical Context

### 12.1 Relevant Prior Research

The `research/` directory contains 48 relevant documents spanning 2026-01-19 to 2026-02-25. Key documents:

| Document | Summary |
|----------|---------|
| `research/docs/2026-02-25-workflow-sdk-standardization.md` | Comprehensive standardization research covering graph engine, Ralph, sub-agents, and declarative API |
| `research/docs/2026-02-25-workflow-sdk-refactor-research.md` | Simplified syntax, module consolidation, and Ralph TUI freeze fix |
| `research/docs/2026-02-25-workflow-sdk-patterns.md` | External SDK patterns from LangGraph, Temporal, Inngest, and coding agent SDKs |
| `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` | Original pluggable SDK design with entity registry and provider normalization |
| `research/docs/2026-02-03-custom-workflow-file-format.md` | Custom workflow file format: required/optional exports, search paths, precedence |
| `research/docs/2026-02-03-workflow-composition-patterns.md` | Subgraph composition, circular dependency detection, state passing |
| `research/docs/2026-02-11-workflow-sdk-implementation.md` | Custom tools, sub-agents, and graph execution integration |
| `research/docs/2026-01-31-atomic-current-workflow-architecture.md` | Current architecture: SDK layer, graph engine, workflow definitions, command system |

### 12.2 Related Specs

| Spec | Summary |
|------|---------|
| `specs/workflow-sdk-standardization.md` | Unified graph engine, declarative API, provider-agnostic execution |
| `specs/workflow-sdk-refactor.md` | Simplified syntax, module consolidation |
| `specs/pluggable-workflows-sdk.md` | Unified entity registry normalizing commands/skills/agents |
| `specs/workflow-sdk-implementation.md` | Custom tools, sub-agents, graph execution bridging |

### 12.3 Evolution Timeline

1. **Jan 31**: Initial architecture — SDK research, graph execution pattern design (LangGraph-inspired)
2. **Feb 2-5**: Built-in workflows, pluggable SDK design, custom file formats, workflow composition
3. **Feb 9-11**: Ralph loop enhancements, workflow SDK implementation with custom tools/sub-agents
4. **Feb 13-15**: Ralph task list UI, DAG orchestration, manual worker dispatch pivot
5. **Feb 19-21**: SDK v2 unified layer, workflow inline mode
6. **Feb 25**: Standardization research, refactor planning, external patterns analysis

---

## 13. Open Questions

1. **Custom workflow graph exports**: What should the export interface look like for custom workflow files to provide graph factories? Should they export a `createGraph()` function, a compiled graph directly, or use the template system?

2. **WorkflowSDK integration**: Should the unified interface route through `WorkflowSDK.stream()`, or should the TUI continue to use `streamGraph()` directly with injected runtime dependencies? The SDK adds overhead (redundant sessions) but provides a cleaner abstraction.

3. **Bridge pattern**: The TUI's `context.spawnSubagentParallel!()` and the SDK's `SubagentGraphBridge` are two different sub-agent spawning mechanisms. Which should the unified interface use? Can they be reconciled?

4. **UI progress abstraction**: `getNodePhaseDescription()` is hardcoded to Ralph node IDs. A generic workflow would need a way to declare node-level UI descriptions. Should this be part of `NodeDefinition`, `WorkflowMetadata`, or a separate mapping?

5. **State factory pattern**: Each workflow needs an initial state factory. Should this be part of `WorkflowMetadata`, exported from the workflow file, or inferred from state annotations?

6. **Session management scope**: `WorkflowSession` is generic but `CommandContext` has Ralph-specific session helpers. How should session management be abstracted for any workflow?

7. **Task list integration**: The tasks.json persistence and TodoWrite guard are Ralph-specific patterns. Should all graph-executing workflows support task lists, or should this be opt-in?

8. **Ctrl+C / cancellation**: The cancellation flow references Ralph state. How should workflow cancellation be generalized?

---

## Supporting Research Documents

This synthesis drew from 6 parallel sub-agent investigations:

1. `research/docs/2026-02-25-graph-execution-engine.md` — Graph builder, compiled execution, node types, core types
2. `research/docs/2026-02-25-ui-workflow-coupling.md` — Chat UI, command registry, UI-to-workflow coupling
3. `research/docs/2026-02-25-workflow-sdk-design.md` — WorkflowSDK class, providers, subagent bridge/registry
4. `research/docs/2026-02-25-ralph-workflow-implementation.md` — Ralph graph, state, prompts, tests, sessions, templates
5. `research/docs/2026-02-25-workflow-registration-flow.md` — Custom workflow discovery, registration, non-Ralph gap, config, CLI entry
6. Discovery scan of 48 existing research documents in `research/`
