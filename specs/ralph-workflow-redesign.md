# Ralph Workflow Redesign — Session-Based Prompt-Chained Architecture

| Document Metadata      | Details     |
| ---------------------- | ----------- |
| Author(s)              | Alex Lavaee |
| Status                 | Draft (WIP) |
| Team / Owner           | Atomic CLI  |
| Created / Last Updated | 2026-03-20  |

## 1. Executive Summary

This RFC proposes replacing the current Ralph workflow's compiled-graph-based execution engine with a **session-based prompt-chained architecture**. The current system uses an 8,725-line LangGraph-inspired graph engine, an `EagerDispatchCoordinator` for parallel sub-agent spawning, 3 separate sub-agent spawn paths, and 9+ Ralph-specific fields leaking into shared interfaces. The proposed redesign replaces all of this with a lightweight **Workflow Session Conductor** — a simple state machine that sequences isolated context-window stages (`PLANNER → ORCHESTRATOR → REVIEWER → DEBUGGER`), where each stage is a fresh agent session with a targeted prompt, and the orchestrator stage delegates parallel task execution to the main agent's native sub-agent capabilities. This eliminates ~2,000+ lines of custom orchestration code, removes all Ralph-specific coupling from shared interfaces, wires workflow events through the existing (but currently broken) event pipeline for full rendering parity, and enables per-stage interrupt/resume semantics.

**Key research references:**
- `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md` — Primary redesign analysis
- `research/docs/2026-03-18-ralph-eager-dispatch-research.md` — Eager dispatch analysis
- `research/docs/v1/2026-03-15-spec-04-workflow-engine.md` — V2 workflow engine spec
- `research/docs/2026-02-28-workflow-gaps-architecture.md` — Architecture gap inventory
- `research/docs/2026-02-28-workflow-issues-research.md` — Concrete workflow issues catalog
- `research/docs/2026-02-28-workflow-tui-rendering-unification-refactor.md` — Rendering parity analysis
- `research/docs/2026-02-25-ui-workflow-coupling.md` — Ralph coupling in shared interfaces
- `research/docs/2026-02-25-ralph-workflow-implementation.md` — Ralph implementation reference
- `research/docs/2026-02-15-ralph-dag-orchestration-blockedby.md` — DAG dependency enforcement
- `research/docs/2026-03-13-codebase-architecture-modularity-analysis.md` — Circular dependency analysis
- `research/docs/v1/2026-03-15-event-bus-workflow-simplification-research.md` — SDK session API reference

---

## 2. Context and Motivation

### 2.1 Current State

The Ralph workflow is a three-phase compiled graph (`plan → worker-loop → review+fix`) defined via a fluent `GraphBuilder` API and executed by a BFS-based `GraphExecutor`. The worker loop uses an `EagerDispatchCoordinator` that dispatches ready tasks as parallel sub-agents, tracks completion via reactive callbacks, and manages the task DAG lifecycle.

**Current architecture:**
```
User: /ralph [PROMPT]
  │
  ▼
parseSlashCommand() → executeCommand("ralph", prompt)
  │
  ▼
createWorkflowCommand() → executeWorkflow(ralphWorkflowDefinition, prompt, context)
  │
  ▼
compileGraph() + createState() + wireRuntime()
  │
  ▼
streamGraph() → [AsyncGenerator of StepResults]
  │
  ├─▶ PLANNER (subagent node) ─────────── spawnSubagent()
  ├─▶ PARSE-TASKS (tool node) ─────────── parseTasks()
  ├─▶ LOOP START (decision) ◄────────────────────────┐
  ├─▶ SELECT-READY-TASKS (tool) ─── getReadyTasks()  │
  ├─▶ WORKER (custom node) ─── EagerDispatchCoord()   │
  ├─▶ LOOP CHECK (decision) ───── continue? ──────────┘
  ├─▶ REVIEWER (subagent node) ── spawnSubagent()
  └─▶ CONDITIONAL FIX ─────────── if findings → FIXER
```

*(Ref: `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md`, Section 1)*

**Key metrics:**
- `services/workflows/` — 8,725 total lines
- Graph engine alone — ~5,000 lines for a single consumer (Ralph)
- `runtime-contracts.ts` — 402 lines for what is fundamentally task status tracking
- 3 sub-agent spawn paths: `spawnSubagent`, `spawnSubagentParallel`, `SubagentGraphBridge`
- 9+ Ralph-specific fields in shared interfaces (`CommandContext`, `CommandContextState`, `WorkflowChatState`)

*(Ref: `research/docs/v1/2026-03-15-spec-04-workflow-engine.md`, Issues section)*

### 2.2 The Problem

**Architectural Complexity:**
- The graph engine supports 7 node types, subgraphs, parallel execution, checkpointing, Zod schemas on nodes, error recovery with 4 action types — all for a single consumer (Ralph). This violates YAGNI.
- The `EagerDispatchCoordinator` (653 lines), `WorkerDispatchAdapter` (182 lines), and `executeWorkerNode()` manually orchestrate what the agent can do natively through its own sub-agent tools.
- `toRalphWorkflowContext()` manually narrows a generic `ExecutionContext` to a focused context, proving the generic context is over-abstracted.

*(Ref: `research/docs/v1/2026-03-15-spec-04-workflow-engine.md`, Issue #1, #4)*

**Interface Pollution:**
- 9+ Ralph-specific fields leak into shared interfaces: `setRalphSessionDir`, `setRalphSessionId`, `setRalphTaskIds`, `ralphConfig`, `isRalphTaskUpdate` guard, TodoWrite filtering, and more.
- `chat.tsx` contains extensive Ralph-specific state management (5 state variables, 2 guard functions, 6+ filtering code blocks).

*(Ref: `research/docs/2026-02-25-ui-workflow-coupling.md`, Ralph-Specific Code section)*

**Dead Code & Gaps:**
- 6 dead modules (912 lines, zero non-test imports)
- 6 unrendered UI components
- 12 unconsumed event types
- `WorkflowSDK` class is fully built but **completely unused at runtime**
- `--max-iterations` CLI flag parsed then silently dropped
- Declarative `graphConfig` path in `WorkflowDefinition` likely untested dead code

*(Ref: `research/docs/2026-02-28-workflow-gaps-architecture.md`, Gaps 1-7)*

**Context Window Waste:**
- The entire workflow shares a single context window across all stages. The planner's full output, all worker sub-agent prompts, and review content accumulate in one context, leading to faster context exhaustion and less focused agent behavior per stage.

*(Ref: `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md`, Section 5 — "Critical Finding: Single Context Window")*

**Rendering Gap:**
- Workflow sub-agents use a minimal rendering path (`context.addMessage()` + silent consumption) while the main chat uses the full event pipeline (SDK → Adapter → BusEvent → BatchDispatcher → CorrelationService → StreamPipelineConsumer → Part[] → React). Sub-agent output is truncated to 4,000 chars with no streaming, no thinking blocks, no tool call rendering.

*(Ref: `research/docs/2026-02-27-workflow-tui-rendering-unification.md`, Feature Gap Summary)*

---

## 3. Goals and Non-Goals

### 3.1 Functional Goals

- [ ] **Session-per-stage execution**: Each workflow stage (planner, orchestrator, reviewer, debugger) runs in an isolated agent session with a fresh context window
- [ ] **Prompt-chained transitions**: Each stage's output is captured and injected as context into the next stage's prompt — no shared mutable state across stages
- [ ] **Native orchestration**: The orchestrator stage prompts the main agent to use its own native sub-agent tools (Task tool, @-mentions) to spawn parallel workers — removing all custom dispatch infrastructure
- [ ] **Stage indicators**: Visual stage indicators (`[PLANNER]`, `[ORCHESTRATOR]`, `[REVIEWER]`, `[DEBUGGER]`) in the chat UI
- [ ] **Per-stage interrupt**: Single Ctrl+C/ESC stops the current stage (preserving partial output); double Ctrl+C kills the entire workflow
- [ ] **Full rendering parity**: All stage sessions render through the full event pipeline — streaming text, thinking blocks, tool calls, token counts — identical to main chat
- [ ] **Remove Ralph coupling from shared interfaces**: All 9+ Ralph-specific fields removed from `CommandContext`, `CommandContextState`, and `WorkflowChatState`; replaced with generic workflow session management
- [ ] **Remove custom orchestration code**: `EagerDispatchCoordinator`, `WorkerDispatchAdapter`, `SubagentGraphBridge`, and all manual sub-agent spawning infrastructure eliminated
- [ ] **Task list UI preserved**: The existing `TaskListPanel`, `TaskListIndicator`, and `TaskListBox` components remain — they are core to the user experience

### 3.2 Non-Goals (Out of Scope)

- [ ] We will NOT rebuild the graph engine from scratch (the V2 spec covers that separately — we simplify Ralph's usage of it)
- [ ] We will NOT implement custom workflow support or `defineWorkflow()` in this phase
- [ ] We will NOT address the 12 unconsumed event types or 6 dead modules (separate cleanup effort)
- [ ] We will NOT change the task list data model (`TaskItem`) — only how tasks are managed
- [ ] We will NOT modify the SDK adapter layer (`SubagentStreamAdapter`) — sessions continue to use it
- [ ] We will NOT address Copilot SDK's lack of independent context windows — the orchestrator prompt must work within Copilot's shared-context model

---

## 4. Proposed Solution (High-Level Design)

### 4.1 System Architecture Diagram

```
User: /ralph [PROMPT]
  │
  ▼
WorkflowSessionConductor.start(prompt)
  │
  ▼
[PLANNER STAGE] ─── fresh session ─── isolated context
  ├─ Stage indicator: [PLANNER]
  ├─ System prompt: planning-focused
  ├─ User prompt: buildSpecToTasksPrompt(userPrompt)
  ├─ Agent creates task list (streamed to UI via full pipeline)
  ├─ Output: task list JSON captured from agent response
  └─ Ctrl+C → stop stage (resumable), Double Ctrl+C → kill workflow
       │
       ▼ (task list output passed forward)
[TASK PARSING] ─── deterministic (no agent session)
  ├─ parseTasks(plannerOutput) → TaskItem[]
  ├─ Task list widget renders in UI
  └─ No interrupt handling needed (instant)
       │
       ▼ (task list + context passed forward)
[ORCHESTRATOR STAGE] ─── fresh session ─── isolated context
  ├─ Stage indicator: [ORCHESTRATOR]
  ├─ System prompt: orchestration-focused
  ├─ User prompt: "Here is the task list. Spawn sub-agents for
  │   non-blocked tasks. Monitor completions. Spawn newly-unblocked
  │   tasks. Report when all tasks are done."
  ├─ Agent uses native Task tool / sub-agent capabilities
  ├─ Agent manages parallelism naturally
  ├─ Task list widget updates as tasks complete
  └─ Output: completion summary
       │
       ▼ (task results passed forward)
[REVIEWER STAGE] ─── fresh session ─── isolated context
  ├─ Stage indicator: [REVIEWER]
  ├─ Review prompt with task results context
  ├─ Agent reviews all changes
  └─ Output: review findings (may be empty)
       │
       ▼ (review findings passed forward — conditional)
[DEBUGGER STAGE] ─── fresh session ─── isolated context (if findings exist)
  ├─ Stage indicator: [DEBUGGER]
  ├─ Fix prompt with review findings
  ├─ Agent applies fixes
  └─ Output: fix results
       │
       ▼
WORKFLOW COMPLETE
```

### 4.2 Architectural Pattern

The redesign adopts a **Graph-Driven Stage Conductor** pattern — the existing fluent `GraphBuilder` DSL is retained as the authoring surface, but node execution semantics are redefined:

- **`.subagent()` nodes** become **stage transitions**: each creates a fresh agent session with an isolated context window, sends a prompt, captures the response, and destroys the session on completion.
- **`.tool()` nodes** become **deterministic stateless operations**: pure functions executed outside any agent session (e.g., `parseTasks()`, `getReadyTasks()`).
- **`.loop()` and `.if()`** retain their control-flow semantics but orchestrate stage transitions rather than sub-agent dispatch.

This preserves the expressive graph DSL for workflow authors while eliminating the over-engineered execution engine underneath.

**Core insight** *(Ref: `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md`, "Critical Clarification: Sessions ≠ Sub-Agents")*:

> Each workflow stage is simply a new session with a fresh context window and a specific prompt. The "sub-agent" nodes in the current graph DSL are not literally sub-agents requiring spawning infrastructure — they are conceptually just "send this prompt to a fresh session and capture the output."

### 4.3 Key Components

| Component                             | Responsibility                                                                 | Replaces                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `WorkflowSessionConductor`            | Executes graph nodes as stage sessions or deterministic calls                  | `GraphExecutor` BFS traversal, `streamGraph()`, runtime dep injection      |
| `StageDefinition` (via `.subagent()`) | Declares a stage's prompt builder, output parser, and UI indicator             | Current `subagentNode()` factory that spawns sub-agents inline             |
| `toolNode()` (simplified)             | Executes pure deterministic functions outside any session                      | Current `toolNode()` (semantics preserved, execution simplified)           |
| Orchestrator Prompt                   | Instructs the main agent to use native sub-agent tools for task execution      | `EagerDispatchCoordinator`, `WorkerDispatchAdapter`, `executeWorkerNode()` |
| Stage-Aware Interrupt Controller      | Per-stage stop/resume + double-press kill                                      | Extended `useInterruptConfirmation`                                        |
| Inter-Stage Output Capture            | Captures last assistant message as structured output per stage                 | `RalphWorkflowState` accumulation across nodes                             |
| Generic Workflow State                | `workflowSessionId`, `currentStage`, `stageOutputs` — no Ralph-specific fields | `ralphConfig`, `ralphSessionDir/Id/TaskIds` on shared interfaces           |

---

## 5. Detailed Design

### 5.1 WorkflowSessionConductor

The conductor interprets compiled graphs by executing each node as either a **session stage** (for `.subagent()` nodes) or a **deterministic function call** (for `.tool()` nodes). It retains the graph's edge structure for sequencing and conditional routing.

**Interface:**

```typescript
// services/workflows/conductor/types.ts

interface StageDefinition {
  readonly id: string;
  readonly name: string;
  readonly indicator: string; // e.g., "[PLANNER]", "[ORCHESTRATOR]"
  readonly buildPrompt: (context: StageContext) => string;
  readonly parseOutput?: (response: string) => unknown;
  readonly shouldRun?: (context: StageContext) => boolean; // defaults to true
  readonly sessionConfig?: Partial<SessionConfig>;
}

interface StageContext {
  readonly userPrompt: string;
  readonly stageOutputs: Map<string, StageOutput>;
  readonly tasks: TaskItem[];
  readonly abortSignal: AbortSignal;
}

interface StageOutput {
  readonly stageId: string;
  readonly rawResponse: string;
  readonly parsedOutput?: unknown;
  readonly status: "completed" | "interrupted" | "error";
}

interface ConductorConfig {
  readonly graph: CompiledGraph<BaseState>; // the authored graph
  readonly createSession: (config?: SessionConfig) => Promise<Session>;
  readonly destroySession: (session: Session) => Promise<void>;
  readonly onStageTransition: (from: string | null, to: string) => void;
  readonly onTaskUpdate: (tasks: TaskItem[]) => void;
  readonly abortSignal: AbortSignal;
}
```

**Execution model:**

The conductor walks the compiled graph's node sequence (following edges and evaluating conditions), but interprets each node differently based on its type:

- **`"agent"` nodes (from `.subagent()`)**: Create a fresh `Session`, build the prompt from `StageContext`, stream via `session.stream()` through the full event pipeline, capture the response as `StageOutput`, destroy the session.
- **`"tool"` nodes (from `.tool()`)**: Execute the tool's `execute()` function directly with the current state. No session created. Result merged into state.
- **`"decision"` nodes (from `.if()`, `.loop()`)**: Evaluate the condition against current state to determine the next edge. No session created.

```typescript
// services/workflows/conductor/conductor.ts

class WorkflowSessionConductor {
  private currentStage: string | null = null;
  private currentSession: Session | null = null;
  private stageOutputs: Map<string, StageOutput> = new Map();
  private tasks: TaskItem[] = [];
  private state: BaseState;

  constructor(private config: ConductorConfig) {
    this.state = {} as BaseState;
  }

  async execute(userPrompt: string, initialState: BaseState): Promise<WorkflowResult> {
    this.state = initialState;
    let currentNodeId: string | null = this.config.graph.startNode;

    while (currentNodeId && !this.config.abortSignal.aborted) {
      const node = this.config.graph.nodes.get(currentNodeId);
      if (!node) break;

      if (node.type === "agent") {
        // Stage: create session, stream, capture output
        await this.executeStageNode(node, userPrompt);
      } else if (node.type === "tool") {
        // Deterministic: run function, merge state
        await this.executeToolNode(node);
      } else if (node.type === "decision") {
        // Control flow: evaluate condition, no session
      }

      // Follow edges to next node (evaluating conditions)
      currentNodeId = this.resolveNextNode(currentNodeId);
    }

    return {
      success: !this.config.abortSignal.aborted,
      stageOutputs: this.stageOutputs,
      tasks: this.tasks,
      state: this.state,
    };
  }

  private async executeStageNode(node: NodeDefinition<BaseState>, userPrompt: string): Promise<void> {
    this.config.onStageTransition(this.currentStage, node.id);
    this.currentStage = node.id;

    // Create fresh session for this stage
    this.currentSession = await this.config.createSession();

    try {
      const context: StageContext = {
        userPrompt,
        stageOutputs: this.stageOutputs,
        tasks: this.tasks,
        abortSignal: this.config.abortSignal,
      };

      // Build prompt — the node's execute function provides the prompt builder
      const result = await node.execute({
        state: this.state,
        config: { runtime: { session: this.currentSession } },
        errors: [],
        abortSignal: this.config.abortSignal,
      });

      // Capture output and merge state
      if (result.stateUpdate) {
        this.state = { ...this.state, ...result.stateUpdate };
      }

      this.stageOutputs.set(node.id, {
        stageId: node.id,
        rawResponse: String(result.stateUpdate?.output ?? ""),
        status: "completed",
      });
    } catch (error) {
      this.stageOutputs.set(node.id, {
        stageId: node.id,
        rawResponse: String(error),
        status: this.config.abortSignal.aborted ? "interrupted" : "error",
      });
    } finally {
      // Destroy session immediately on transition (per Q6 decision)
      if (this.currentSession) {
        await this.config.destroySession(this.currentSession);
        this.currentSession = null;
      }
    }
  }

  /** Stop current stage (preserves session for resume per Q1 decision) */
  interrupt(): void {
    this.currentSession?.abort();
  }

  getCurrentStage(): string | null {
    return this.currentStage;
  }
}
```

### 5.2 Ralph Workflow Definition (Using Existing DSL)

The Ralph workflow is still defined using the fluent `GraphBuilder` DSL, but the node semantics change. `.subagent()` nodes create fresh sessions (stages), `.tool()` nodes run deterministic functions, and control flow (`.loop()`, `.if()`) works as before.

```typescript
// services/workflows/ralph/graph/index.ts (simplified)

export function createRalphWorkflow(): CompiledGraph<RalphWorkflowState> {
  return graph<RalphWorkflowState>()
    // Phase 1: Planner → creates fresh session, streams through UI
    .subagent({
      id: "planner",
      agentName: "planner",
      task: (state) => buildSpecToTasksPrompt(state.yoloPrompt ?? ""),
      indicator: "⌕ PLANNER",
      outputMapper: (result) => ({ specDoc: result.output ?? "" }),
    })

    // Phase 1b: Parse tasks — deterministic, no session
    .tool({
      id: "parse-tasks",
      execute: (args) => parseTasks(args.specDoc),
      args: (state) => ({ specDoc: state.specDoc }),
      outputMapper: (tasks) => ({
        tasks,
        currentTasks: tasks,
        iteration: 0,
      }),
    })

    // Phase 2: Orchestrator → creates fresh session, agent spawns workers natively
    .subagent({
      id: "orchestrator",
      agentName: "orchestrator",
      task: (state) => buildOrchestratorPrompt(state.tasks),
      indicator: "⚡ ORCHESTRATOR",
      outputMapper: (result) => ({
        orchestratorOutput: result.output ?? "",
      }),
    })

    // Phase 3: Reviewer → creates fresh session
    .subagent({
      id: "reviewer",
      agentName: "reviewer",
      task: (state) => buildReviewPrompt(state.orchestratorOutput ?? ""),
      indicator: "🔍 REVIEWER",
      outputMapper: (result) => ({
        rawReviewResult: result.output ?? "",
        reviewResult: parseReviewResult(result.output ?? ""),
      }),
    })

    // Phase 4: Conditional Debugger → only if findings exist
    .if({
      condition: (state) => hasActionableFindings(state.reviewResult),
      then: [
        {
          id: "debugger",
          type: "agent",
          agentName: "debugger",
          task: (state) => buildFixPrompt(state.reviewResult),
          indicator: "🔧 DEBUGGER",
          outputMapper: (result) => ({
            fixesApplied: true,
            debugOutput: result.output ?? "",
          }),
        },
      ],
    })

    .compile();
}
```

**Key change**: The `.subagent()` factory no longer calls `context.spawnSubagent()` internally. Instead, the conductor interprets `"agent"` nodes by creating a fresh `Session` via `CodingAgentClient.createSession()`, streaming the prompt through the full event pipeline, and capturing the response. The worker loop (Phase 2) is replaced by a single orchestrator stage where the agent manages parallelism natively.

### 5.3 Orchestrator Prompt Design

The orchestrator prompt is the critical replacement for `EagerDispatchCoordinator`. Instead of custom dispatch infrastructure, we instruct the main agent to use its **native sub-agent capabilities**.

```typescript
// services/workflows/ralph/prompts.ts (new function)

export function buildOrchestratorPrompt(tasks: TaskItem[]): string {
  const taskListJson = JSON.stringify(
    tasks.map((t) => ({
      id: t.id,
      description: t.description,
      status: t.status,
      blockedBy: t.blockedBy ?? [],
    })),
    null,
    2
  );

  return `You are an orchestrator managing a set of implementation tasks.

## Task List
${taskListJson}

## Instructions

1. **Identify non-blocked tasks**: Tasks with status "pending" whose blockedBy
   dependencies are all "completed" are ready to execute.

2. **Spawn parallel sub-agents**: For each ready task, spawn a sub-agent using
   the Task tool. Give each sub-agent a focused prompt with:
   - The task description
   - Context about completed dependency tasks
   - Instructions to implement the task fully and test it

3. **Monitor completions**: As sub-agents complete, check if any blocked tasks
   are now unblocked. Spawn new sub-agents for newly-unblocked tasks immediately.

4. **Continue until all tasks are complete or have errors.**

5. **Report a summary** when finished, listing each task and its final status.

IMPORTANT: Spawn ALL ready tasks in parallel — do not wait for one to finish
before starting another unblocked task.`;
}
```

**SDK-specific considerations** *(Ref: `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md`, Section on SDK Sub-Agent Support)*:

| SDK      | Independent Context | Mechanism                        | Impact                                                                       |
| -------- | ------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Claude   | ✅                   | `AgentDefinition` with `query()` | Agent naturally spawns sub-agents with isolated context                      |
| OpenCode | ✅                   | `Session.fork()`                 | Agent can fork sessions for parallel workers                                 |
| Copilot  | ❌                   | Sub-agents share parent session  | Prompt must work within shared-context model; parallelism via `customAgents` |

### 5.4 Generic Workflow State (Replaces Ralph-Specific Fields)

**Remove from shared interfaces:**

| Field                         | Current Location      | Action                                                |
| ----------------------------- | --------------------- | ----------------------------------------------------- |
| `setRalphSessionDir`          | `CommandContext`      | Replace with `setWorkflowSessionDir` (already exists) |
| `setRalphSessionId`           | `CommandContext`      | Replace with `setWorkflowSessionId` (already exists)  |
| `setRalphTaskIds`             | `CommandContext`      | Replace with `setWorkflowTaskIds` (already exists)    |
| `ralphConfig`                 | `CommandContextState` | Replace with generic `workflowConfig`                 |
| `ralphConfig`                 | `WorkflowChatState`   | Replace with `workflowConfig`                         |
| `ralphSessionDir` (state+ref) | `chat.tsx:1841-1843`  | Replace with `workflowSessionDir`                     |
| `ralphSessionId` (state+ref)  | `chat.tsx:1844-1845`  | Replace with `workflowSessionId`                      |
| `ralphTaskIdsRef`             | `chat.tsx:1849`       | Replace with `workflowTaskIdsRef`                     |
| `isRalphTaskUpdate`           | `chat.tsx:2104-2108`  | Replace with generic `isWorkflowTaskUpdate`           |

*(Ref: `research/docs/2026-02-25-ui-workflow-coupling.md`, Complete field inventory)*

**New generic workflow state:**

```typescript
// state/chat/shared/types/workflow.ts (modified)

interface WorkflowChatState {
  // Existing generic fields (keep)
  workflowActive: boolean;
  workflowType: string | null;
  initialPrompt: string | null;

  // New generic fields (replace Ralph-specific)
  workflowConfig?: {
    userPrompt: string | null;
    sessionId?: string;
    workflowName?: string;
  };
  currentStage: string | null;
  stageIndicator: string | null;

  // Autocomplete fields (keep, unrelated to Ralph)
  showAutocomplete: boolean;
  autocompleteInput: string;
  // ... etc.
}
```

### 5.5 Stage-Aware Interrupt Controller

**Current behavior** *(Ref: `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md`, Section 6)*:
- Single Ctrl+C: aborts stream, terminates background agents, increments interrupt count
- Double Ctrl+C (≥2 within 1s): calls `cancelWorkflow()` which sets `workflowActive: false` and rejects pending HITL promise — **no resume possible**

**Proposed behavior:**

| Input                | During Stage | Effect                                                                                |
| -------------------- | ------------ | ------------------------------------------------------------------------------------- |
| Single Ctrl+C or ESC | Streaming    | Abort current session stream. Stage output is "interrupted". Conductor pauses.        |
| Single Ctrl+C or ESC | Paused       | Show resume prompt: "Stage [X] interrupted. Resume / Skip to next / Cancel workflow?" |
| Double Ctrl+C        | Any          | Immediately terminate entire workflow. Destroy all sessions. Clean up.                |

**Implementation extends existing `useInterruptConfirmation`** (`state/chat/keyboard/use-interrupt-controls.ts:124-285`):

```typescript
// Extended interrupt handler (pseudocode)
if (workflowActive && streaming) {
  conductor.interrupt(); // stops current stage session
  interruptCount++;

  if (interruptCount >= 2 && withinWindow) {
    cancelWorkflow(); // kill everything
  } else {
    // Show stage-level resume prompt
    showStageInterruptPrompt(conductor.getCurrentStage());
  }
}
```

### 5.6 Task List Integration

The task list UI components are **preserved unchanged**. What changes is how tasks flow into the UI:

**Current path:**
```
EagerDispatchCoordinator → notifyTaskStatusChange → bus event → StreamPartEvent → TaskListPanel
                         ↘ tasks.json file → file watcher → TaskListPanel (Path A)
```

**Proposed path:**
```
Planner session response → parseTasks() → conductor.onTaskUpdate() → StreamPartEvent → TaskListPanel
Orchestrator session → agent updates tasks naturally → task status events → TaskListPanel
```

The conductor's `onTaskUpdate` callback publishes `"task-list-update"` `StreamPartEvent`s through the existing pipeline. The orchestrator stage's agent manages task status updates through its native tool calls — task completions are reflected via the standard stream event pipeline.

### 5.7 Session Lifecycle

```
Stage Start:
  1. conductor creates fresh Session via CodingAgentClient.createSession()
  2. Stage indicator published to UI
  3. Prompt sent via session.stream() — goes through full SDK adapter → EventBus pipeline
  4. User sees streaming output in main chat (identical to normal chat)

Stage End:
  5. Response captured as StageOutput
  6. Optional: parseOutput() extracts structured data (tasks, review findings)
  7. Session destroyed via session.destroy()
  8. Transition to next stage

Workflow End:
  9. Final stage completes or workflow cancelled
  10. All sessions destroyed
  11. workflowActive set to false
  12. Task list persisted to disk
```

### 5.8 TodoWrite Filtering Generalization

**Current problem** *(Ref: `research/docs/2026-02-25-ui-workflow-coupling.md`, TodoWrite Filtering section)*:

The `isRalphTaskUpdate()` guard in `chat.tsx` uses `hasRalphTaskIdOverlap()` to prevent sub-agent `TodoWrite` tool calls from overwriting Ralph's task state during the planning phase. This is Ralph-specific and must be generalized.

**Proposed solution:**

The `WorkflowSessionConductor` owns the canonical task state. All external `TodoWrite` mutations from sub-agents are filtered against the conductor's active task ID set:

```typescript
// state/chat/shared/helpers/workflow-task-guard.ts

export function isWorkflowTaskUpdate(
  todoWritePayload: TodoWritePayload,
  activeWorkflowTaskIds: Set<string>
): boolean {
  return todoWritePayload.todos.some((todo) =>
    activeWorkflowTaskIds.has(todo.id)
  );
}
```

The conductor registers its task IDs when tasks are parsed and deregisters them on workflow completion. This replaces the hardcoded `ralphTaskIdsRef` with a generic `workflowTaskIdsRef` that any workflow can populate.

### 5.9 Event Pipeline Wiring for Stage Visualization

**Current problem** *(Ref: `research/docs/2026-02-28-workflow-gaps-architecture.md`, Gap 1, Gap 7)*:

Three workflow event types (`workflow.step.start`, `workflow.step.complete`, `workflow.task.update`) have ready-made reducers in `stream-pipeline.ts` but **no consumer wiring**. `WorkflowStepPartDisplay` exists as a component but is **not registered** in `PART_REGISTRY`. Events are emitted but silently dropped at `mapToStreamPart()`.

**Proposed solution:**

Wire the existing infrastructure during the refactor rather than building parallel systems:

1. Register `WorkflowStepPartDisplay` in `PART_REGISTRY` for `"workflow-step"` part type
2. Map conductor stage transitions to `workflow.step.start` / `workflow.step.complete` events
3. Map conductor task updates to `workflow.task.update` events
4. Ensure `mapToStreamPart()` handles the `workflow.*` event types → existing reducers consume them

This means stage indicators (`[PLANNER]`, `[ORCHESTRATOR]`, etc.) render via the standard parts pipeline rather than a bespoke rendering path.

### 5.10 Error Propagation in DAG Dependencies

**Current problem** *(Ref: `research/docs/2026-02-15-ralph-dag-orchestration-blockedby.md`)*:

If task A fails and task B depends on A, `getReadyTasks()` never marks B as ready (A never reaches `"completed"`). B stays `"pending"` forever — no deadlock detection, no skip logic, no user notification.

**Proposed solution:**

The orchestrator prompt includes explicit error-handling instructions:

```
## Error Handling for Dependencies
- If a task FAILS, mark all tasks that directly or transitively depend on it as
  "blocked-by-failure" and report why.
- If a failed task can be retried (transient error), retry it ONCE before
  marking dependents as blocked.
- If ALL remaining tasks are blocked-by-failure, report the dependency chain
  and stop.
```

Additionally, `getReadyTasks()` is updated to recognize `"error"` status and propagate failure:

```typescript
export function getReadyTasks(tasks: TaskItem[]): TaskItem[] {
  const statusMap = new Map(tasks.map((t) => [t.id, t.status]));
  return tasks.filter((t) => {
    if (t.status !== "pending") return false;
    const deps = t.blockedBy ?? [];
    // All deps must be completed (not errored, not pending)
    const allDepsCompleted = deps.every((d) => statusMap.get(d) === "completed");
    // If any dep errored, this task is blocked-by-failure
    const anyDepErrored = deps.some((d) => statusMap.get(d) === "error");
    if (anyDepErrored) return false; // skip, will be reported
    return allDepsCompleted;
  });
}
```

### 5.11 Concurrency Management

**Current problem** *(Ref: `research/docs/2026-03-18-ralph-eager-dispatch-research.md`, Open Question #4)*:

No cap on simultaneously-running sub-agents. With native orchestration, the agent could spawn 50+ parallel workers for large task lists, causing API rate-limit exhaustion and memory pressure.

**Proposed solution:**

The orchestrator prompt includes concurrency guidance:

```
## Concurrency Guidelines
- Spawn at most 4 sub-agents in parallel at any time.
- When a sub-agent completes, check for newly-unblocked tasks and spawn
  replacements up to the concurrency limit.
- This prevents API rate-limiting and keeps resource usage manageable.
```

The concurrency limit (default: 4) is configurable via the workflow definition:

```typescript
interface WorkflowConfig {
  maxConcurrency?: number; // default: 4
  maxIterations?: number;  // default: 100 (fixes --max-iterations gap)
}
```

**`--max-iterations` fix** *(Ref: `research/docs/2026-02-28-workflow-gaps-architecture.md`, Gap 4)*: The CLI flag is currently parsed but dropped. The conductor accepts `maxIterations` from the workflow config and enforces it as a safety limit on total stage executions.

### 5.12 Context Window Management Per Stage

**Current problem** *(Ref: `research/docs/2026-03-20-ralph-workflow-redesign-analysis.md`, "Critical Finding: Single Context Window")*:

Long-running orchestrator sessions can exhaust context. OpenCode auto-compacts at 45% usage; Claude recreates sessions; Copilot warns only.

**Proposed solution:**

Session isolation per stage inherently mitigates this — each stage starts with a fresh context. However, the **orchestrator stage** may be long-running (managing many tasks), so:

1. The conductor monitors context usage via `session.getContextUsage()` after each sub-agent completion
2. If context usage exceeds 70%, the conductor summarizes completed work and creates a **continuation session** with the summary + remaining tasks
3. This is transparent to the user — the stage indicator remains `[ORCHESTRATOR]`

```typescript
private async checkContextPressure(): Promise<void> {
  if (!this.currentSession) return;
  const usage = await this.currentSession.getContextUsage();
  if (usage.percentUsed > 0.7) {
    const summary = await this.summarizeCompletedWork();
    await this.config.destroySession(this.currentSession);
    this.currentSession = await this.config.createSession();
    // Re-inject summary + remaining tasks as new prompt
  }
}
```

### 5.13 Inter-Stage Output Handling

**Current problem** *(Ref: `research/docs/2026-02-25-workflow-sdk-standardization.md`)*:

Current `SubagentResult.output` is truncated to **4,000 characters**. For a planner producing detailed task lists or a reviewer producing comprehensive findings, this is insufficient.

**Proposed solution:**

Per Open Question #2 (resolved), inter-stage output is raw text passed as-is. With session-based stages, the full response is captured directly from the session stream — no `SubagentResult` intermediary and **no truncation**. The captured output size is bounded only by the receiving stage's context window capacity.

For very large outputs (e.g., planner producing 20+ tasks with detailed descriptions), the conductor applies a configurable size limit (default: 50,000 chars) and summarizes if exceeded:

```typescript
interface StageDefinition {
  // ... existing fields
  readonly maxOutputChars?: number; // default: 50_000
}
```

### 5.14 Worker `in_progress` Status Emission

**Current problem** *(Ref: `research/docs/2026-02-28-workflow-issues-research.md`, Issue #4)*:

The worker node doesn't set tasks to `"in_progress"` before spawning sub-agents. Tasks jump from `"pending"` to `"completed"` / `"error"`, so the task list blinker animation never activates.

**Proposed solution:**

The orchestrator prompt explicitly instructs status tracking:

```
## Task Status Protocol
- BEFORE spawning a sub-agent for a task, report the task as "in_progress"
  using the TodoWrite tool.
- AFTER a sub-agent completes, report the task as "completed" or "error".
- This ensures the UI shows real-time progress for all active tasks.
```

Additionally, the conductor's `onTaskUpdate` callback validates that tasks transition through `in_progress` before reaching terminal states, emitting a warning if a task jumps directly to `"completed"`.

### 5.15 `blockedBy` Enforcement

**Current problem** *(Ref: `research/docs/2026-02-15-ralph-dag-orchestration-blockedby.md`)*:

`blockedBy` exists in the task data model but is **never enforced during execution** — only used for display ordering via topological sort. The current worker loop filters only on `status !== "completed"` without checking dependency satisfaction.

**Proposed solution:**

With native orchestration, `blockedBy` enforcement shifts to the orchestrator prompt. The task list JSON injected into the orchestrator includes `blockedBy` arrays, and the prompt explicitly states:

```
A task is READY to execute only when:
1. Its status is "pending"
2. ALL tasks listed in its "blockedBy" array have status "completed"

Do NOT spawn a sub-agent for a task whose dependencies are not yet completed.
```

The deterministic `getReadyTasks()` function (section 5.10) also enforces this as a safety net — it's called in the task parsing tool node and its output seeds the orchestrator prompt.

### 5.16 Rendering Parity for Workflow Sub-Agents

**Current problem** *(Ref: `research/docs/2026-02-28-workflow-tui-rendering-unification-refactor.md`, Feature Gap Summary)*:

Workflow sub-agents use bespoke `AgentInlineText` (200-char truncated plain text) and `AgentInlineTool` (30-char single line), bypassing `PART_REGISTRY` entirely. Main chat renders full markdown, thinking blocks, tool calls with rich formatting, and token counts. Feature parity gap is HIGH.

**Proposed solution:**

With session-based stages, all stage output flows through the **full event pipeline** (SDK → Adapter → BusEvent → BatchDispatcher → CorrelationService → StreamPipelineConsumer → Part[] → React). No bespoke rendering paths needed.

For the orchestrator's spawned sub-agents (native sub-agent tool calls within the session), they render through the existing `ParallelAgentsTree` component, which already handles sub-agent lifecycle events (`stream.agent.start`, `stream.agent.update`, `stream.agent.complete`).

**Key migration**: Replace `AgentInlineParts` / `AgentInlineText` / `AgentInlineTool` with `PART_REGISTRY` dispatch for any remaining bespoke rendering paths.

---

## 6. Alternatives Considered

| Option                                        | Pros                                                                                                          | Cons                                                                                                                    | Reason for Rejection                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **A: Keep Graph Engine + Fix Eager Dispatch** | Minimal change; existing tests. Leverage existing `onAgentComplete` callback.                                 | Retains 8,725-line over-engineered engine. Doesn't solve context window waste or rendering gap. Ralph coupling remains. | Doesn't address root architectural problems. *(Ref: `research/docs/2026-03-18-ralph-eager-dispatch-research.md`)*                          |
| **B: V2 Minimal Graph Engine (from spec-04)** | Right-sized (~1,500 lines). Declarative graphs. Solves over-engineering.                                      | Still requires custom sub-agent dispatch infra. Doesn't address session isolation. Needs implementation from scratch.   | Good long-term but over-invests in engine when stages are deterministic. *(Ref: `research/docs/v1/2026-03-15-spec-04-workflow-engine.md`)* |
| **C: Session-Based Conductor (Selected)**     | Eliminates custom orchestration. Session isolation. Full rendering parity. Simple (~300 lines for conductor). | Agent-dependent orchestration quality. Copilot shared-context limitation. Less control over dispatch timing.            | **Selected**: The simplicity and natural leveraging of agent capabilities outweigh the loss of fine-grained dispatch control.              |
| **D: Hybrid (Conductor + Lightweight Graph)** | Best of both: simple stages + graph for complex orchestrator.                                                 | Over-complex for current needs. Two execution models to maintain.                                                       | Violates YAGNI. Can evolve from Option C if needed.                                                                                        |

---

## 7. Cross-Cutting Concerns

### 7.1 Security and Privacy

No new security concerns introduced. Session isolation actually **improves** security posture:
- Each stage operates with minimal context (only the previous stage's output)
- No accumulated context across stages reduces risk of prompt injection propagation
- Session destruction at stage transitions ensures no stale context persists

### 7.2 Observability Strategy

- **Stage events**: Conductor emits `workflow.stage.start`, `workflow.stage.complete`, `workflow.stage.error` via the event bus
- **Task events**: Task status updates flow through the existing `"task-list-update"` StreamPartEvent mechanism
- **Session metrics**: Each stage's session provides token usage via `session.getContextUsage()`
- **Stage indicators**: UI displays current stage prominently (e.g., `[PLANNER]`, `[ORCHESTRATOR]`)
- **Logging**: Conductor logs stage transitions and inter-stage output summaries

### 7.3 Circular Dependency Resolution

**Current problem** *(Ref: `research/docs/2026-03-13-codebase-architecture-modularity-analysis.md`)*:

`services/workflows/` imports `discoverAgentInfos` and `registerActiveSession` from `commands/tui/` — a circular dependency that violates the layered architecture (services must NOT import from commands).

**Proposed solution:**

Move shared discovery logic to `services/agent-discovery/` (already exists as a module) and session registration to `services/system/`. The conductor uses these service-layer APIs instead of command-layer imports.

### 7.4 HITL Auto-Approval Policy

**Current behavior**: When `workflowActive` is true, ALL SDK permission requests (file writes, command execution, etc.) are auto-approved.

**Proposed behavior**: Retain auto-approval as the default for workflow stages. The conductor's `StageDefinition` supports an optional `requireApproval: boolean` flag (default: `false`) for stages that should prompt the user. This preserves the current behavior while enabling future stages that require explicit user consent.

### 7.5 Memory Pressure for Long Workflows

With full rendering parity, parallel sub-agents produce streaming content that accumulates in `ChatMessage.parts[]`. For workflows with 20+ tasks and full-fidelity rendering, memory pressure is a concern.

**Mitigation:**

1. The conductor emits a `workflow.stage.complete` event that triggers parts compaction — completed sub-agent parts are summarized (title + status + truncated output) and the full streaming parts are released.
2. A configurable `maxRetainedParts` per stage (default: 100) triggers compaction when exceeded.
3. Full output is persisted to the session directory (`{sessionDir}/stages/{stageId}/output.txt`) before compaction.

### 7.6 Dead Code and Broken Features

**Dead code to remove** *(Ref: `research/docs/2026-02-28-workflow-gaps-architecture.md`, Gap 5)*:

The following modules have 0 non-test imports and should be removed during Phase 4 cleanup:

| Module             | Lines   | Status        |
| ------------------ | ------- | ------------- |
| `debug-subscriber` | 179     | Dead — remove |
| `tool-discovery`   | 287     | Dead — remove |
| `file-lock`        | 290     | Dead — remove |
| `merge`            | 45      | Dead — remove |
| `pipeline-logger`  | 68      | Dead — remove |
| `tree-hints`       | 43      | Dead — remove |
| **Total**          | **912** |               |

**`WorkflowSDK` fate** *(Ref: `research/docs/2026-02-25-unified-workflow-execution-research.md`)*:

The `WorkflowSDK` class is fully built and tested (9 test scenarios) but completely bypassed at runtime. Its `SubagentGraphBridge` lifecycle pattern (create session → stream → destroy) is nearly identical to the conductor pattern. **Decision**: Remove `WorkflowSDK` and `SubagentGraphBridge` — their responsibilities are subsumed by `WorkflowSessionConductor`. The bridge's session lifecycle logic informs the conductor's implementation but is not reused directly.

### 7.7 Testing Strategy

**Existing tests affected** *(Ref: `research/docs/2026-03-18-ralph-eager-dispatch-research.md`, Section 8)*:
- `graph.parallel-dispatch-core.suite.ts` (5 tests) — batch dispatch verification → **Remove** (dispatch logic eliminated)
- `graph.parallel-dispatch-status.suite.ts` (3 tests) — status tracking → **Migrate** to conductor stage events
- `graph.flow.suite.ts` (6 tests) — end-to-end flow → **Rewrite** for conductor stage sequencing
- `graph.fixtures.ts` — mock helpers → **Simplify** (no graph mocks needed)

**New tests needed:**
- `conductor.test.ts` — stage sequencing, inter-stage output passing, conditional stage skipping
- `conductor-interrupt.test.ts` — per-stage interrupt, resume, double-press kill
- `orchestrator-prompt.test.ts` — prompt generation with various task configurations
- `stage-output-capture.test.ts` — response parsing and structured output extraction

---

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

**Phase 1 — Conductor Foundation:**
- Implement `WorkflowSessionConductor` and `StageDefinition` types
- Implement Ralph stage definitions (planner, orchestrator, reviewer, debugger)
- Unit test conductor logic in isolation with mock sessions

**Phase 2 — Wiring & Integration:**
- Wire conductor into the `/ralph` command path (replace `createRalphCommand()`)
- Replace Ralph-specific fields in shared interfaces with generic workflow state
- Implement stage-aware interrupt controller
- Implement stage indicator UI
- Integration test full workflow with mock SDK sessions

**Phase 3 — Orchestrator Prompt Engineering:**
- Engineer and test the orchestrator prompt across all 3 SDKs (Claude, OpenCode, Copilot)
- Verify parallel task dispatch behavior
- Verify task list widget updates correctly
- Tune prompt for reliable completion reporting

**Phase 4 — Event Pipeline & Rendering Parity:**
- Wire `WorkflowStepPartDisplay` into `PART_REGISTRY` for stage visualization (section 5.9)
- Replace `AgentInlineParts` / `AgentInlineText` / `AgentInlineTool` with `PART_REGISTRY` dispatch (section 5.16)
- Wire conductor stage transitions to `workflow.step.start` / `workflow.step.complete` events
- Wire conductor task updates to `workflow.task.update` events
- Verify full rendering parity: streaming text, thinking blocks, tool calls, token counts
- Fix `in_progress` status emission (section 5.14)

**Phase 5 — Cleanup & Removal:**
- Remove `EagerDispatchCoordinator` (`graph/eager-dispatch.ts`, 653 lines)
- Remove `WorkerDispatchAdapter` (`graph/worker-dispatch.ts`, 182 lines)
- Remove `executeWorkerNode()` and `executeFixerNode()` from `graph/index.ts`
- Remove `buildWorkerAssignment()` from `prompts.ts`
- Remove Ralph-specific spawn paths from `context-factory.ts`
- Remove `SubagentGraphBridge` and `WorkflowSDK` (section 7.6)
- Remove Ralph-specific fields from `CommandContext`, `CommandContextState`, `chat.tsx`
- Remove 6 dead modules (912 lines — section 7.6)
- Break `services/workflows/ → commands/tui/` circular dependency (section 7.3)
- Fix `--max-iterations` CLI flag passthrough (section 5.11)
- Update/remove affected tests

### 8.2 Files Changed

**New files (~6):**

| File                                                             | Purpose                                                    | Est. Lines |
| ---------------------------------------------------------------- | ---------------------------------------------------------- | ---------- |
| `src/services/workflows/conductor/types.ts`                      | Conductor & stage type definitions                         | ~80        |
| `src/services/workflows/conductor/conductor.ts`                  | `WorkflowSessionConductor` implementation                  | ~200       |
| `src/services/workflows/ralph/stages.ts`                         | Ralph stage definitions                                    | ~80        |
| `src/state/chat/shared/helpers/workflow-task-guard.ts`           | Generic TodoWrite filtering (replaces `isRalphTaskUpdate`) | ~30        |
| `tests/services/workflows/conductor/conductor.test.ts`           | Conductor unit tests                                       | ~250       |
| `tests/services/workflows/conductor/conductor-interrupt.test.ts` | Interrupt/resume tests                                     | ~150       |

**Modified files (~14):**

| File                                                 | Change                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/commands/tui/workflow-commands/index.ts`        | Replace `createRalphCommand()` with conductor-based command                             |
| `src/services/workflows/ralph/prompts.ts`            | Add `buildOrchestratorPrompt()`, keep `buildSpecToTasksPrompt()`, `buildReviewPrompt()` |
| `src/services/workflows/ralph/definition.ts`         | Update to use conductor + stages instead of graph                                       |
| `src/state/chat/shared/types/workflow.ts`            | Remove `ralphState`, add generic `currentStage`, `stageIndicator`                       |
| `src/state/chat/keyboard/use-interrupt-controls.ts`  | Extend with stage-aware interrupt logic                                                 |
| `src/state/chat/command/context-factory.ts`          | Remove `spawnParallelSubagents()` and Ralph-specific context wiring                     |
| `src/types/command.ts`                               | Remove Ralph-specific fields from `CommandContext`                                      |
| `src/state/chat/controller/use-workflow-hitl.ts`     | Simplify for conductor-based workflow                                                   |
| `src/components/task-list-panel.tsx`                 | Wire to conductor's `onTaskUpdate` (minor)                                              |
| `src/state/streaming/part-registry.ts`               | Register `WorkflowStepPartDisplay` for `"workflow-step"` part type                      |
| `src/services/workflows/ralph/graph/task-helpers.ts` | Update `getReadyTasks()` with error propagation + `blockedBy` enforcement               |
| `src/services/events/event-bus.ts`                   | Wire `workflow.*` events to existing reducers                                           |
| `src/services/agent-discovery/index.ts`              | Accept discovery logic moved from `commands/tui/`                                       |
| `src/state/chat/stream/use-agent-subscriptions.ts`   | Fix dual-channel race condition for agent events                                        |

**Removed files (~8):**

| File                                                                     | Lines | Reason                                                               |
| ------------------------------------------------------------------------ | ----- | -------------------------------------------------------------------- |
| `src/services/workflows/ralph/graph/eager-dispatch.ts`                   | 653   | Replaced by orchestrator prompt — agent manages parallelism natively |
| `src/services/workflows/ralph/graph/worker-dispatch.ts`                  | 182   | Replaced by orchestrator prompt — no manual dispatch adapter needed  |
| `src/services/workflows/graph/subagent-registry.ts`                      | ~100  | SubagentGraphBridge removed — sessions managed by conductor          |
| `src/services/workflows/workflow-sdk.ts` (if exists)                     | ~200  | Dead code — never used at runtime (section 7.6)                      |
| `tests/services/workflows/ralph/graph.parallel-dispatch-core.suite.ts`   | ~150  | Tests for removed dispatch code                                      |
| `tests/services/workflows/ralph/graph.parallel-dispatch-status.suite.ts` | ~100  | Tests for removed dispatch code                                      |
| 6 dead modules (see section 7.6)                                         | 912   | Zero non-test imports                                                |

**Simplified files (graph engine retained but refactored):**

| File                                                    | Change                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/services/workflows/graph/nodes/subagent.ts`        | Refactor: `subagentNode()` creates sessions instead of calling `spawnSubagent()`              |
| `src/services/workflows/graph/runtime/execution-ops.ts` | Simplify: BFS traversal replaced with sequential conductor interpretation                     |
| `src/services/workflows/graph/runtime/compiled.ts`      | Simplify: `GraphExecutor` delegates to `WorkflowSessionConductor`                             |
| `src/services/workflows/graph/contracts/runtime.ts`     | Simplify: remove `GraphRuntimeDependencies`, `SubagentSpawnOptions`, and spawn function types |

### 8.3 Test Plan

- **Unit Tests**: Conductor stage sequencing, output capture, conditional stage skipping, interrupt handling
- **Integration Tests**: Full `/ralph` command → conductor → mock sessions → stage transitions
- **E2E Tests**: Full workflow execution with real SDK sessions across Claude, OpenCode, Copilot
- **Prompt Tests**: Orchestrator prompt generates correct task dispatch instructions for various DAG shapes

---

## 9. Open Questions / Unresolved Issues

1. **Resume semantics**: ✅ **Resolved** — When Ctrl+C stops a stage, the session is preserved (not destroyed). All active sub-agents, background agents, and streams are stopped. On resume, the user's next message is sent to the same session and the model responds based on its existing context. This mirrors the main chat's existing interrupt-resume behavior. Sessions are only destroyed on stage transition or workflow cancellation.

2. **Inter-stage output format**: ✅ **Resolved** — Raw text. Each stage's full agent response is passed as-is to the next stage's prompt. The receiving stage's prompt instructs the agent how to interpret the input. The planner stage still uses `parseTasks()` internally to extract the task list for the UI widget, but the raw response is what flows to the orchestrator. This is simpler, preserves nuance, and avoids brittle structured parsing at stage boundaries.

3. **Task list widget injection for orchestrator**: ✅ **Resolved** — Injected into the user prompt as JSON. The orchestrator prompt includes the full task list (IDs, descriptions, statuses, blockedBy) as a JSON block. This is stateless, works across all 3 SDKs, and ensures the agent sees the complete task state upfront. The agent manages task status tracking through its own capabilities during execution.

4. **Debugger stage conditionality**: ✅ **Resolved** — Conditional, only runs when the reviewer produces actionable findings. The decision is **deterministic**: a parsing function (`hasActionableFindings()`) inspects the reviewer's structured output for concrete issues. This is not an LLM decision — it's a programmatic check on the parsed review result, consistent with how the current conditional fix branch works (`graph/index.ts:322-325`).

5. **Graph engine retention**: ✅ **Resolved** — Retain the graph engine and its fluent DSL (`.subagent()`, `.tool()`, `.loop()`, `.if()`, etc.), but **redefine the semantics** of each node type:
   - **`.subagent()` nodes → stage transitions**: Each subagent node creates a fresh session (isolated context window), sends its prompt, captures output, and destroys the session. These are the "stages" of the conductor.
   - **`.tool()` nodes → deterministic stateless operations**: Tool nodes execute pure functions (like `parseTasks()`, `getReadyTasks()`) outside of any agent session context. No SDK interaction.
   - **Control structures (`.loop()`, `.if()`)**: Retain the same DSL for conditional branching and iteration, but the loop body now orchestrates stage transitions rather than dispatching sub-agents.
   - The `GraphBuilder` API remains the authoring surface. The `GraphExecutor` is simplified: instead of BFS node traversal with runtime dependency injection, it becomes a sequential stage runner that interprets node types as session operations or deterministic calls. This preserves the expressive DSL while eliminating the over-engineering.

6. **Session destruction timing**: ✅ **Resolved** — Destroy immediately on stage transition. When the conductor advances from one stage to the next, the previous stage's session is destroyed immediately to free memory. Resume (per Q1) only applies to the *current* active stage — once a stage completes and transitions, its session is gone. This keeps the lifecycle simple and predictable.

7. **Copilot shared-context workaround**: ✅ **Resolved** — Not a concern. Sub-agents spawned by the orchestrator are tool calls within the agent's session — they don't require independent context windows at the workflow infrastructure level. The SDK's native sub-agent/tool-call mechanism handles parallelism internally. The only session isolation that matters is at the **stage level** (each stage gets a fresh main session), which all 3 SDKs support. No SDK-specific workarounds needed.

### Questions 8–13 (Resolved)

8. **Per-stage vs per-workflow message rendering**: ✅ **Resolved** — Separate message per stage. Each workflow stage produces its own assistant message in the chat, providing clear visual separation and easier scrollback. The stage indicator (e.g., `[PLANNER]`) appears at the start of each stage's message. This is consistent with how multiple turns work in the main chat — each stage is conceptually a separate interaction.

9. **Token count aggregation**: ✅ **Resolved** — Same as main chat sessions. Token usage displays in the spinner identically to regular chat. Each stage session is treated as conceptually equivalent to the main session — no special workflow-specific token UI. The footer shows the current active session's tokens, and on completion the standard token summary appears. This preserves UX consistency and avoids workflow-specific rendering logic.

10. **Checkpointing and crash recovery**: ✅ **Resolved** — No persistence. On crash, the workflow restarts from the beginning. This is the simplest approach and avoids the complexity of checkpointer wiring. The existing 4 checkpointer implementations remain in the codebase (they're part of the graph engine, which is retained) but are not wired into the conductor. Can be added later if crash recovery becomes a real user need.

11. **Workflow state migration for in-flight sessions**: ✅ **Resolved** — Clean break. Active workflows using the old `RalphWorkflowState` format will terminate, and users restart with the new format. This is acceptable because (a) Ralph workflows are relatively short-lived (minutes to hours, not days), (b) the migration is a major architectural change, and (c) transparent migration would require maintaining compatibility with the old 30-field state shape indefinitely.

12. **Dual-channel race condition mitigation**: ✅ **Resolved** — Follow the main session's existing implementation. The conductor does not reinvent event routing — each stage session is wired identically to how the main chat session handles agent lifecycle and content events. The existing `SubagentStreamAdapter` + `CorrelationService` + `StreamPipelineConsumer` pipeline already handles this for the main session; workflow stage sessions use the same code path. No custom buffering or synchronization needed at the conductor level.

13. **Reviewer → task state feedback loop**: ✅ **Resolved** — Raw text. The reviewer's full response (including findings) is passed as-is to the debugger stage's prompt. The debugger interprets the findings naturally and applies fixes. No structured task status updates from the reviewer — this keeps the review stage simple and avoids coupling the reviewer to the task data model. The debugger stage's prompt includes instructions to reference the review findings and address each issue.
