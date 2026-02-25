---
date: 2026-02-25 16:08:19 UTC
researcher: Copilot
git_commit: baa0a67de3dc4f5231219f789755c6f2ef8ca024
branch: lavaman131/feature/workflow-sdk
repository: workflow-sdk
topic: "Workflow SDK Refactor: Simplified Syntax, Module Consolidation, and Ralph TUI Freeze"
tags: [research, codebase, workflow-sdk, graph, ralph, refactor, tui-freeze, module-consolidation]
status: complete
last_updated: 2026-02-25
last_updated_by: Copilot
---

# Research: Workflow SDK Refactor

## Research Question

Research the codebase to refactor the workflow SDK so it uses a simpler syntax with sub-agents and tools with subagent and tool nodes, allowing chaining with a declarative `.if()`, `.else()`, etc. syntax. Focus on keeping things elegant and simple in favor of complex/intrusive logic. Consolidate everything to a `workflows` module with `graph` as a submodule. Ensure all nodes in ralph are working because currently after the review node the entire TUI freezes and is unresponsive.

## Summary

The codebase has a mature graph execution engine at `src/graph/` with a fluent builder API (`graph<State>().start().then().if().else().endif().loop().compile()`) supporting 7 node types, conditional branching, loops, parallel execution, and error handling. However, the Ralph workflow at `src/workflows/ralph/` does **not use** the graph engine — it's implemented as a procedural command handler in `src/ui/commands/workflow-commands.ts`. The TUI freeze after the review node is most likely caused by a deferred completion handler never executing due to sub-agent lifecycle tracking issues. The module structure has `graph/` and `workflows/` as sibling directories, and consolidation requires moving `graph/` under `workflows/`.

---

## Detailed Findings

### 1. Current Graph Module API (`src/graph/`)

The graph module provides a comprehensive declarative workflow engine with 206 lines of exports in its barrel file.

#### 1.1 Node Types

**`NodeType`** (`src/graph/types.ts:104`)
```typescript
type NodeType = "agent" | "tool" | "decision" | "wait" | "ask_user" | "subgraph" | "parallel";
```

**12 Node Factory Functions** (`src/graph/nodes.ts`):
| Factory | Purpose |
|---------|---------|
| `agentNode()` | Executes agent interaction via SDK client |
| `toolNode()` | Runs a tool function with input/output mapping |
| `decisionNode()` | Routes execution based on conditions |
| `waitNode()` | Pauses for human input |
| `askUserNode()` | Presents options to user |
| `parallelNode()` | Runs branches concurrently |
| `subgraphNode()` | Embeds sub-workflow |
| `contextMonitorNode()` | Monitors context window usage |
| `clearContextNode()` | Clears/compacts context |
| `customToolNode()` | User-defined tool execution |
| `subagentNode()` | Spawns single sub-agent via bridge |
| `parallelSubagentNode()` | Spawns multiple sub-agents in parallel |

#### 1.2 Builder API (Fluent Chaining)

**`GraphBuilder<TState>`** (`src/graph/builder.ts:136-678`)

Current chaining methods:
- `.start(node)` — Set starting node (line 225)
- `.then(node)` — Chain next node with edge (line 245)
- `.if(condition)` — Begin conditional branch, creates decision node (line 281)
- `.else()` — Begin alternative branch (line 316)
- `.endif()` — Close conditional, creates merge node (line 342)
- `.loop(bodyNodes, config)` — Add loop with exit condition (line 460)
- `.parallel(config)` — Add parallel branches (line 402)
- `.wait(promptOrNode)` — Add human-in-the-loop pause (line 558)
- `.catch(handler)` — Set graph-level error handler (line 586)
- `.end()` — Mark terminal node (line 598)
- `.compile(config)` — Produce `CompiledGraph` (line 612)

**Factory function**: `graph<TState>()` at `builder.ts:698`

**Helper functions**:
- `createNode()` — Generic node creation (line 715)
- `createDecisionNode()` — Routing node with condition array (line 745)
- `createWaitNode()` — Pause node with prompt (line 771)

#### 1.3 Templates (`src/graph/templates.ts`)

Pre-built workflow patterns returning `GraphBuilder` for further chaining:
- `sequential(nodes)` — Linear chain: A → B → C (line 110)
- `mapReduce({ splitter, worker, merger })` — Split-process-merge (line 152)
- `reviewCycle({ executor, reviewer, fixer, until })` — Execute-review-fix loop (line 180)
- `taskLoop({ decomposer, worker, reviewer?, until? })` — Decompose-work-review loop (line 196)

#### 1.4 State Management (`src/graph/annotation.ts`)

LangGraph-inspired annotation system:
```typescript
const MyAnnotation = {
  count: annotation<number>(0, Reducers.sum),
  items: annotation<string[]>([], Reducers.concat),
  config: annotation<Config>({}, Reducers.merge),
};
```

**Built-in Reducers**: `replace`, `concat`, `merge`, `mergeById`, `max`, `min`, `sum`, `or`, `and`, `ifDefined`

#### 1.5 Execution Engine (`src/graph/compiled.ts`)

`GraphExecutor` at `compiled.ts:323-569`:
- BFS traversal with node queue
- Exponential backoff retry per node
- State merged immutably after each node via annotation reducers
- Edge evaluation with `goto` override support
- Loop detection via `Set<"nodeId:stepCount">`
- Yields `StepResult` for streaming consumption
- Supports abort via `AbortSignal`

#### 1.6 Streaming (`src/graph/stream.ts`)

`StreamRouter` with 5 modes: `"values"`, `"updates"`, `"custom"`, `"debug"`, `"all"`

#### 1.7 Sub-Agent Integration

- `SubagentGraphBridge` (`src/graph/subagent-bridge.ts`) — Spawns agents via SDK sessions with `spawn()` and `spawnParallel()` using `Promise.allSettled()`
- `SubagentTypeRegistry` (`src/graph/subagent-registry.ts`) — Registry of available sub-agent types
- `ProviderRegistry` (`src/graph/provider-registry.ts`) — Maps agent type names to SDK clients

#### 1.8 Checkpointing (`src/graph/checkpointer.ts`)

4 implementations: `MemorySaver`, `FileSaver`, `ResearchDirSaver`, `SessionDirSaver`
Factory: `createCheckpointer(options)`

---

### 2. Ralph Workflow Implementation

#### 2.1 Critical Finding: Ralph Does NOT Use the Graph Engine

The Ralph workflow is implemented as a **procedural, imperative command handler** in `src/ui/commands/workflow-commands.ts` (1195 lines), NOT as a graph with nodes and edges.

**Three Phases** (all sequential code blocks):
1. **Task Decomposition** (lines 723-757): Spawns a sub-agent to create a spec/task list
2. **Worker Dispatch Loop** (lines 778-845): Sequential `while` loop dispatching workers
3. **Review & Fix Phase** (lines 847-1025): Spawns reviewer, processes fixes

#### 2.2 Ralph State Files (Exist but Unused by Graph)

**`src/workflows/ralph/state.ts`** (lines 50-75): Defines `RalphWorkflowState` extending `BaseState` with fields like `tasks`, `currentTask`, `iteration`, `reviewResult`, etc. — but this state type is NOT used by the graph engine for Ralph.

**`src/workflows/ralph/prompts.ts`**: 8 prompt builder functions; only 4 are actually used.

**`src/graph/nodes/ralph.ts`**: Contains graph-compatible node definitions for Ralph but these are NOT wired into the actual Ralph execution flow.

#### 2.3 Ralph Execution Flow

```
/ralph command → workflow-commands.ts handler
  ├─ Phase 1: Task Decomposition
  │   └─ context.spawnSubagent({ name: "planner", message: specPrompt })
  │   └─ Parse spec into task list
  ├─ Phase 2: Worker Loop (while iteration < 100)
  │   └─ for each pending task:
  │       └─ context.spawnSubagent({ name: "worker", message: taskPrompt })
  │   └─ Check if all completed → break
  └─ Phase 3: Review (for i < MAX_REVIEW_ITERATIONS=1)
      └─ context.spawnSubagent({ name: "reviewer", message: reviewPrompt })
      └─ Parse review result
      └─ If fixes needed → spawn fix workers
      └─ Return success/failure
```

---

### 3. TUI Freeze Bug: Root Cause Analysis

#### 3.1 Most Likely Root Cause: Deferred Completion Never Triggering

**The freeze happens when `await context.spawnSubagent()` never resolves** after the review node.

**Event chain that should happen:**
1. `spawnSubagent()` creates a Promise storing its resolver in `streamCompletionResolverRef.current` (`chat.tsx:3782`)
2. Calls `sendSilentMessage()` → triggers SDK streaming
3. SDK stream completes → `onComplete()` fires (`index.ts:1871`)
4. `handleComplete()` callback runs → should resolve the stored promise

**Where it breaks** (`chat.tsx:3638-3647`):
```typescript
const hasActiveAgents = hasActiveForegroundAgents(parallelAgentsRef.current);
if (hasActiveAgents || hasRunningToolRef.current) {
  pendingCompleteRef.current = handleComplete;  // ← Defers completion
  return;  // ← EXITS without resolving the spawnSubagent promise!
}
```

The reviewer sub-agent may be incorrectly tracked as an active foreground agent. When `handleComplete` defers, it relies on `subagent.complete` or `tool.complete` events to call `tryFinalizeParallelTracking()` which would execute the pending completion. If those events never fire (or are filtered), the promise hangs.

#### 3.2 Contributing Factors

**Issue A: Stream Generation Mismatch** (`chat.tsx:3589-3591`)
```typescript
if (!isCurrentStreamCallback(streamGenerationRef.current, currentGeneration)) return;
```
If `streamGenerationRef.current` is incremented before `handleComplete` fires (e.g., by a concurrent operation), the stale guard silently drops the completion.

**Issue B: AbortError Doesn't Call onComplete** (`index.ts:1875-1877`)
```typescript
if (error instanceof Error && error.name === "AbortError") {
  // Stream was intentionally aborted — NO onComplete() call in this branch
}
```
If the stream is aborted, `onComplete()` may not fire, leaving the promise unresolved. (Note: the code after the if-else block does call `onComplete()`, but control flow may not always reach it.)

**Issue C: Different Spawn Paths**
- **Workers** use `context.spawnSubagentParallel!()` → goes through `SubagentGraphBridge` → simpler, independent sessions
- **Reviewer** uses `context.spawnSubagent()` → goes through main session stream → more complex event flow with more failure points

#### 3.3 Historical Context

Research doc `2026-02-15-subagent-premature-completion-SUMMARY.md` documented a related bug where `tool.complete` events unconditionally finalize sub-agent status without checking background mode. The fix involved checking `agent.background` flag before marking as completed.

Research doc `2026-02-15-ralph-dag-orchestration-implementation.md` documented that `streamCompletionResolverRef` is single-slot — only one worker can be awaited at a time, creating a serial bottleneck.

---

### 4. Module Structure

#### 4.1 Current Layout

```
src/
├── graph/           ← Core execution engine (206-line barrel, 16+ modules)
│   ├── index.ts
│   ├── builder.ts   ← GraphBuilder fluent API
│   ├── compiled.ts  ← GraphExecutor BFS engine
│   ├── types.ts     ← All type definitions
│   ├── nodes.ts     ← 12 node factory functions
│   ├── nodes/       ← Node implementations
│   │   └── ralph.ts ← Ralph graph nodes (unused by runtime)
│   ├── annotation.ts
│   ├── templates.ts
│   ├── stream.ts
│   ├── sdk.ts       ← WorkflowSDK class
│   ├── agent-providers.ts
│   ├── provider-registry.ts
│   ├── subagent-bridge.ts
│   ├── subagent-registry.ts
│   ├── checkpointer.ts
│   ├── state-validator.ts
│   └── errors.ts
├── workflows/       ← Session management + Ralph prompts/state
│   ├── index.ts     ← Minimal barrel (session exports only)
│   ├── session.ts   ← Workflow session persistence
│   └── ralph/
│       ├── state.ts
│       └── prompts.ts
├── sdk/             ← Unified agent client abstraction
│   ├── index.ts
│   ├── types.ts
│   ├── base-client.ts
│   ├── init.ts
│   └── clients/
│       ├── claude.ts
│       ├── opencode.ts
│       └── copilot.ts
└── ui/              ← TUI layer (OpenTUI + React)
    ├── chat.tsx      ← Main chat component (243K, 3800+ lines)
    ├── index.ts      ← Stream handler (94K, 1895 lines)
    └── commands/
        └── workflow-commands.ts  ← Ralph procedural handler (1195 lines)
```

#### 4.2 Dependency Flow

```
telemetry/types.ts
  ↑ (AgentType)
sdk/types.ts ← sdk/base-client.ts ← sdk/init.ts
  ↑ (CodingAgentClient)
graph/sdk.ts ← graph/* (internal)
  ↑
graph/index.ts

workflows/session.ts  ← independent, no cross-module deps
workflows/index.ts
```

- **graph** depends on **sdk** (for `CodingAgentClient` type)
- **workflows** is independent (only session persistence)
- **No circular dependencies**

#### 4.3 Package Configuration

- Entry: `src/cli.ts`
- Module: ESM (`"type": "module"`)
- Resolution: `"moduleResolution": "bundler"` (Bun)
- No path aliases — direct relative imports
- No explicit `"exports"` field in package.json

---

### 5. Node Factory Functions Deep Dive

These are the key functions for the simplified syntax proposal:

#### 5.1 `subagentNode()` (`src/graph/nodes.ts`)

```typescript
interface SubagentNodeConfig<TState extends BaseState> {
  id: NodeId;
  agentType: string;        // e.g., "copilot", "claude", "opencode"
  instruction: string | ((state: TState) => string);
  outputMapper?: OutputMapper<TState>;
  model?: ModelSpec;
  name?: string;
  description?: string;
}
```

Creates a node that spawns a sub-agent via `SubagentGraphBridge.spawn()`. Returns `NodeDefinition` usable in the builder chain.

#### 5.2 `toolNode()` (`src/graph/nodes.ts`)

```typescript
interface ToolNodeConfig<TState extends BaseState> {
  id: NodeId;
  execute: ToolExecuteFn<TState>;
  outputMapper?: ToolOutputMapper<TState>;
  name?: string;
  description?: string;
}
```

Creates a node that executes a tool function. The `execute` function receives the current state and returns tool output.

#### 5.3 `agentNode()` (`src/graph/nodes.ts`)

```typescript
interface AgentNodeConfig<TState extends BaseState> {
  id: NodeId;
  agentType: string;
  prompt: string | ((state: TState) => string);
  outputMapper?: OutputMapper<TState>;
  model?: ModelSpec;
  clientProvider?: ClientProvider;
  name?: string;
  description?: string;
  retry?: RetryConfig;
  onError?: NodeDefinition<TState>["onError"];
}
```

Creates a node that executes an agent interaction via the SDK client. Similar to `subagentNode` but uses the provider registry directly.

---

### 6. Workflow SDK Class (`src/graph/sdk.ts`)

**`WorkflowSDK`** (lines 33-160):
- Constructor accepts `WorkflowSDKConfig` with `providers` (Record<string, CodingAgentClient>), `workflows`, `subagentTypes`
- Converts clients to `ClientBackedAgentProvider` instances
- Provides `runtimeDependencies` injected into `GraphConfig.runtime`
- Methods: `register()`, `get()`, `has()`, `list()`, `run()`, `stream()`
- `run()` calls `executeGraph()` with injected runtime deps
- `stream()` calls `streamGraph()` for streaming execution

---

## Code References

### Graph Module Core
- `src/graph/index.ts` — Barrel file with 206 lines of categorized exports
- `src/graph/builder.ts:136-678` — `GraphBuilder` class with fluent API
- `src/graph/builder.ts:698-700` — `graph<TState>()` factory function
- `src/graph/compiled.ts:323-569` — `GraphExecutor.streamSteps()` BFS engine
- `src/graph/types.ts:104` — `NodeType` union type
- `src/graph/types.ts:323-370` — `NodeDefinition<TState>` interface
- `src/graph/types.ts:267-305` — `ExecutionContext<TState>` interface
- `src/graph/types.ts:242-259` — `NodeResult<TState>` interface
- `src/graph/nodes.ts` — 12 node factory functions
- `src/graph/annotation.ts:67-164` — `Reducers` object with 10 built-in reducers
- `src/graph/annotation.ts:308-335` — `AtomicStateAnnotation` pre-defined schema
- `src/graph/templates.ts:110-211` — 4 template patterns

### Ralph Workflow
- `src/ui/commands/workflow-commands.ts:673-1063` — Ralph command handler (procedural)
- `src/ui/commands/workflow-commands.ts:874-877` — Reviewer sub-agent spawn
- `src/ui/commands/workflow-commands.ts:53` — `MAX_REVIEW_ITERATIONS = 1`
- `src/workflows/ralph/state.ts:50-75` — `RalphWorkflowState` (unused by runtime)
- `src/workflows/ralph/prompts.ts` — 8 prompt builder functions (4 unused)
- `src/graph/nodes/ralph.ts` — Graph-compatible ralph nodes (unused by runtime)

### TUI Freeze Location
- `src/ui/chat.tsx:3747-3795` — `spawnSubagent()` Promise creation
- `src/ui/chat.tsx:3777-3786` — Promise resolver stored in `streamCompletionResolverRef`
- `src/ui/chat.tsx:3588-3710` — `handleComplete()` callback
- `src/ui/chat.tsx:3638-3647` — Deferred completion check (likely freeze point)
- `src/ui/chat.tsx:3697-3706` — Promise resolution path
- `src/ui/index.ts:1871` — `onComplete()` call after stream ends
- `src/ui/index.ts:1232-1290` — `subagent.complete` event handler

### Module Structure
- `src/graph/index.ts` — Graph barrel (206 lines, 16 modules)
- `src/workflows/index.ts` — Workflows barrel (17 lines, session only)
- `src/sdk/index.ts` — SDK barrel (90 lines, 3 modules)
- `src/graph/sdk.ts` — WorkflowSDK class connecting graph ↔ SDK
- `package.json` — Entry: `src/cli.ts`, ESM, no explicit exports field

---

## Architecture Documentation

### Current Execution Architecture

```
User → CLI (src/cli.ts) → Commander.js
  ├─ chat command → TUI (src/ui/chat.tsx)
  │   ├─ SDK clients (src/sdk/clients/*.ts)
  │   ├─ Stream handler (src/ui/index.ts)
  │   └─ Commands (src/ui/commands/)
  │       ├─ builtin-commands.ts
  │       ├─ workflow-commands.ts ← Ralph lives here (procedural)
  │       └─ skill-commands.ts
  ├─ config command
  └─ init command

Graph Engine (src/graph/) ← NOT used by Ralph at runtime
  ├─ GraphBuilder → CompiledGraph → GraphExecutor
  ├─ NodeDefinition → NodeResult → state merge
  ├─ ProviderRegistry → AgentProvider → SDK client
  ├─ SubagentGraphBridge → spawn/spawnParallel
  └─ StreamRouter → StreamEvent
```

### Key Design Patterns

1. **Fluent Builder**: All builder methods return `this` for chaining
2. **Annotation Reducers**: LangGraph-inspired state management
3. **Factory Functions**: Type-safe node creation (`agentNode()`, `toolNode()`, etc.)
4. **Template Patterns**: Pre-built `sequential`, `mapReduce`, `reviewCycle`, `taskLoop`
5. **Provider Abstraction**: `ProviderRegistry` maps names to SDK clients
6. **Signal-Based Communication**: Nodes emit signals (e.g., `human_input_required`)
7. **BFS Graph Traversal**: Queue-based execution with loop detection

---

## Historical Context (from research/)

### Workflow SDK Design Evolution

- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` — Original design for unified entity registry with provider parsers, name-based node references, and CLI hints system
- `research/docs/2026-02-11-workflow-sdk-implementation.md` — Custom tool discovery (`.atomic/tools/`), workflow TypeScript format, sub-agent session manager with concurrency limiting
- `research/docs/2026-02-21-workflow-sdk-inline-mode-research.md` — Workflows run inline via `streamAndWait()` within chat event loop, not separate processes
- `research/docs/2026-02-25-workflow-sdk-standardization.md` — Comprehensive architecture analysis, identified serial worker dispatch bottleneck
- `research/docs/2026-02-25-workflow-sdk-patterns.md` — External SDK comparison (LangGraph, Temporal, Inngest patterns)

### Ralph Workflow History

- `research/docs/2026-02-09-163-ralph-loop-enhancements.md` — Ralph loop enhancement proposal
- `research/docs/2026-02-13-ralph-task-list-ui.md` — Task list UI implementation
- `research/docs/2026-02-15-ralph-dag-orchestration-implementation.md` — Identified `blockedBy` exists but unenforced, serial worker bottleneck, `streamCompletionResolverRef` single-slot limitation
- `research/docs/2026-02-15-ralph-loop-manual-worker-dispatch.md` — Manual worker dispatch patterns
- `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md` — Full graph engine technical docs

### Sub-Agent Integration Issues

- `research/docs/2026-02-15-subagent-premature-completion-SUMMARY.md` — `tool.complete` event unconditionally marks sub-agents as completed without checking background mode
- `research/docs/2026-02-15-subagent-premature-completion-investigation.md` — Detailed bug investigation
- `research/docs/2026-02-14-subagent-output-propagation-issue.md` — Sub-agent output not propagating correctly
- `research/docs/2026-02-23-258-background-agents-sdk-event-pipeline.md` — Background agent event pipeline analysis

### TUI Architecture

- `research/docs/2026-02-16-atomic-chat-architecture-current.md` — Current chat architecture
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md` — TUI layout and streaming
- `research/docs/2026-02-15-ui-inline-streaming-vs-pinned-elements.md` — Inline streaming patterns

---

## Related Research

- `research/docs/2026-02-25-workflow-sdk-standardization.md` — Most comprehensive current state analysis
- `research/docs/2026-02-25-workflow-sdk-patterns.md` — External SDK patterns (LangGraph, Temporal, Inngest)
- `research/docs/2026-02-25-graph-execution-engine-technical-documentation.md` — Graph engine deep dive
- `research/docs/2026-02-03-workflow-composition-patterns.md` — Composition pattern design
- `research/docs/2026-02-03-custom-workflow-file-format.md` — Custom workflow file format spec
- `research/docs/2026-01-31-graph-execution-pattern-design.md` — Original graph execution design
- `research/docs/2026-01-31-sdk-migration-and-graph-execution.md` — SDK migration planning

---

## Open Questions

1. **Graph Migration for Ralph**: Should Ralph be rewritten to use the graph engine, or should the procedural handler be kept and the freeze fixed independently?
2. **Module Consolidation Strategy**: Should `graph/` physically move under `workflows/`, or should it be re-exported through `workflows/index.ts`?
3. **Subagent vs Agent Node**: The codebase has both `agentNode()` and `subagentNode()` — should these be unified for the simplified syntax?
4. **Custom Tool Integration**: How should `.atomic/tools/` discovered tools become first-class graph nodes?
5. **Checkpointing Completeness**: Current checkpointer backends (Memory, File) are basic — is SQLite/PostgreSQL support needed for the refactor?
6. **Template Extensibility**: Should templates like `reviewCycle` and `taskLoop` be preserved as convenience functions or replaced by the new simplified syntax?
7. **Test Coverage**: 13 test files exist in `src/graph/` covering builder, compiled, templates, types, annotations, providers, streaming, validation, and nodes. What additional tests are needed for the refactored API?
