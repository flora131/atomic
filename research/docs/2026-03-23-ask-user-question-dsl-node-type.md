---
date: 2026-03-23 07:50:13 UTC
researcher: Claude Opus 4.6
git_commit: d44241d9958f83953c04d4c09c882c411bc1dbed
branch: lavaman131/feature/workflow-refactor
repository: workflow-refactor
topic: "askUserQuestion() DSL Node Type — Inheriting from Tool Node with Workflow HITL UI"
tags: [research, codebase, dsl, ask-user, tool-node, hitl, workflow, ui]
status: complete
last_updated: 2026-03-23
last_updated_by: Claude Opus 4.6
---

# Research: askUserQuestion() DSL Node Type

## Research Question

How is the workflow DSL's tool node type currently implemented (types, compiler, UI rendering), and how does the existing ask-user-question widget work in workflows? Document all relevant code paths, types, and UI components so we can design an `askUserQuestion(...)` DSL node type that extends/inherits from the tool node type and reuses the existing ask-user-question widget UI.

## Summary

The DSL currently supports two node types — `stage` (agent sessions) and `tool` (deterministic functions). An existing `askUserNode()` factory at the graph level creates `"ask_user"` type nodes with rich question/answer semantics, but this is **not exposed through the DSL**. The HITL UI system (`UserQuestionDialog` + `HitlResponseWidget`) is fully built and renders interactive question dialogs with option selection, custom text input, and "chat about this" functionality. Adding `askUserQuestion(...)` to the DSL requires: (1) a new `AskUserQuestionOptions` type, (2) a new instruction variant in the `Instruction` union, (3) a new builder method, (4) compiler support to generate `"ask_user"` nodes, and (5) wiring to the existing HITL UI pipeline.

## Detailed Findings

### 1. Current Tool Node Implementation in the DSL

#### Type Definition (`src/services/workflows/dsl/types.ts:120-146`)

```ts
interface ToolOptions {
  readonly name: string;
  readonly execute: (context: ExecutionContext<BaseState>) => Promise<Record<string, unknown>>;
  readonly description?: string;
  readonly reads?: string[];
  readonly outputs?: string[];
}
```

The tool node is a synchronous/async function that transforms workflow state without an agent session. It receives an `ExecutionContext<BaseState>` and returns a record of state updates.

#### Instruction Recording (`src/services/workflows/dsl/types.ts:274`)

Tool instructions are recorded as: `{ type: "tool", id: string, config: ToolOptions }`

#### Builder Method (`src/services/workflows/dsl/define-workflow.ts:127-130`)

```ts
tool(id: string, options: ToolOptions): this {
  this.instructions.push({ type: "tool", id, config: options });
  return this;
}
```

Unlike `.stage()`, the `.tool()` method does not check for duplicate IDs at definition time — duplicate detection is deferred to the compiler's `validateInstructions()`.

#### Compiler Graph Generation (`src/services/workflows/dsl/compiler.ts:380-386`)

Tool instructions produce nodes with `type: "tool"` via the `addNode()` helper:

```ts
case "tool": {
  const nodeId = addNode(instruction.id, "tool", instruction.config);
  connectPrevious(nodeId);
  previousNodeId = nodeId;
  break;
}
```

The `addNode()` function (`compiler.ts:316-342`) creates a `NodeDefinition<BaseState>` with:
- `type: "tool"` for tool nodes
- `execute` wrapping the `ToolOptions.execute` function — calls it and wraps the result in `{ stateUpdate: result }`

#### Compiler Stage Generation

Tool instructions are **skipped** in `generateStageDefinitions()` (`compiler.ts:217`) — only `"stage"` instructions produce `StageDefinition` entries. Tool nodes execute through the graph executor directly, not through the conductor's session-based stage pipeline.

#### Compiler Validation (`compiler.ts:62-78`)

Both `"stage"` and `"tool"` instructions count as valid nodes. Their IDs are checked for uniqueness together.

---

### 2. Existing askUserNode at the Graph Level

#### Factory (`src/services/workflows/graph/nodes/control.ts:179-225`)

`askUserNode<TState>()` creates a `NodeDefinition` with `type: "ask_user"`. It is one of four control node factories in `control.ts` alongside `clearContextNode`, `decisionNode`, and `waitNode`.

#### Types

**`AskUserOption`** (`control.ts:145-148`):
```ts
interface AskUserOption {
  label: string;
  description?: string;
}
```

**`AskUserOptions`** (`control.ts:150-154`):
```ts
interface AskUserOptions {
  question: string;
  header?: string;
  options?: AskUserOption[];
}
```

**`AskUserNodeConfig<TState>`** (`control.ts:156-161`):
```ts
interface AskUserNodeConfig<TState extends BaseState = BaseState> {
  id: NodeId;
  options: AskUserOptions | ((state: TState) => AskUserOptions);
  name?: string;
  description?: string;
}
```

**`AskUserWaitState`** (`control.ts:163-167`):
```ts
interface AskUserWaitState {
  __waitingForInput?: boolean;
  __waitNodeId?: string;
  __askUserRequestId?: string;
}
```

**`AskUserQuestionEventData`** (`control.ts:169-177`):
```ts
interface AskUserQuestionEventData {
  requestId: string;
  question: string;
  header?: string;
  options?: AskUserOption[];
  nodeId: string;
  respond?: (answer: string | string[]) => void;
  toolCallId?: string;
}
```

#### Execute Function Behavior (`control.ts:189-223`)

1. Resolves `options` — if it's a function, calls it with `ctx.state`; otherwise uses static value
2. Generates a `requestId` via `crypto.randomUUID()`
3. Constructs `AskUserQuestionEventData`
4. Emits `"human_input_required"` via `ctx.emit()` (real-time channel to UI)
5. Returns `NodeResult` with:
   - `stateUpdate`: sets `__waitingForInput: true`, `__waitNodeId: id`, `__askUserRequestId: requestId`
   - `signals`: `[{ type: "human_input_required", message: question, data: eventData }]`

#### NodeType Union (`src/services/workflows/graph/contracts/core.ts:10`)

```ts
type NodeType = "agent" | "tool" | "decision" | "wait" | "ask_user" | "subgraph" | "parallel";
```

`"ask_user"` is already a valid `NodeType`. However, the `isNodeType()` runtime guard at `contracts/guards.ts:12-16` does **not** include `"ask_user"` in its checked array.

---

### 3. HITL UI Components

#### UserQuestionDialog (`src/components/user-question-dialog.tsx:53-404`)

The primary interactive dialog. Renders when `activeQuestion` is non-null in `ChatShell` (`state/chat/shell/ChatShell.tsx:252-258`). When visible, it replaces the normal input composer.

**Visual layout:**
```
╭─ ○ Header Text ─╮
Question text (bold)

❯ 1  Option A label
     Option A description
  2  Option B label
  3  Type something.
  4  Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
```

**Features:**
- Header badge with rounded connectors (`╭─` / `─╮`) in `colors.border`, pending icon (`○`), header text in `colors.foreground`
- Question text in bold
- Scrollable option list in a `<scrollbox>` with calculated `listHeight = terminalHeight - 12` (min 5)
- Highlighted option shows `❯` cursor and uses `colors.accent` with bold
- Two synthetic appended options: "Type something." (`__custom_input__`) and "Chat about this" (`__chat_about_this__`)
- Multi-select mode with `[✓]`/`[ ]` checkboxes
- Custom text input via `<textarea>` with `borderStyle="rounded"` in `colors.accent`
- Keyboard: arrow/j/k navigation, number keys for direct-select, Enter/Space to select/toggle, Ctrl+Enter for multi-select submit, Escape to cancel
- Mouse scroll support

**Answer submission:** Constructs `QuestionAnswer` with `selected` (string or string[]), `cancelled: boolean`, and `responseMode` (`"option"` | `"custom_input"` | `"chat_about_this"` | `"declined"`).

#### HitlResponseWidget (`src/components/hitl-response-widget.tsx:24-88`)

Post-answer read-only display in the chat transcript. Renders when a `ChatMessage` has a `hitlContext` property.

**Visual layout:**
```
╭─ ✓ Header Text ─╮    (or ✗ for declined)
  question text          (muted)
  ❯ Answer text          (bold, user bubble colors)
```

- Status icon: `✓` in `colors.success` (green) for answered, `✗` in `colors.warning` for declined
- Answer text: bold with `colors.userBubbleFg` / `colors.userBubbleBg` for accepted; `colors.muted` for declined

#### Inline HITL in ToolPartDisplay (`src/components/message-parts/tool-part-display.tsx:165-213`)

When `isHitlToolName(toolName)` is true, `ToolPartDisplay` renders one of three states inline:

**Completed HITL:**
```
✓ ask_user
  ╰ question text     (muted)
  ╰ answer text       (success green)
```

**Pending HITL:**
```
● ask_user
  ╰ question text     (muted)
```

**Running (no pending dialog):**
```
● ask_user
```

#### HITL Tool Name Detection (`src/state/streaming/pipeline-tools/shared.ts:4-13`)

```ts
const HITL_EXACT_NAMES = new Set(["askuserquestion", "question", "ask_user", "ask_question"]);
const HITL_SUFFIXES = ["/ask_user", "__ask_user", "/ask_question", "__ask_question"];
```

`isHitlToolName()` matches case-insensitively against these, excluding MCP tools (`"mcp__"` prefix).

---

### 4. HITL Event Lifecycle

#### Event Flow

1. **Emission**: Agent SDK emits `stream.human_input_required` (or `stream.permission.requested`) on the EventBus
2. **Subscription**: `use-session-subscriptions.ts:535` subscribes, constructs `AskUserQuestionEventData`, calls `handleAskUserQuestion`
3. **Queuing**: `useWorkflowHitl` (`use-workflow-hitl.ts:126`) manages a FIFO queue (`pendingQuestionsRef`); only one question displays at a time
4. **Message mutation**: `enqueueAndApplyHitlRequest` sets `pendingQuestion` on the matching `ToolPart` via `applyStreamPartEvent` with a `tool-hitl-request` event
5. **UI render**: `ChatShell` mounts `UserQuestionDialog` when `activeQuestion` is non-null
6. **Answer**: User's selection triggers `handleQuestionAnswer`, which normalizes the answer, calls `respond()` callback (or `session.send()`), and applies `tool-hitl-response` to clear `pendingQuestion` and set `hitlResponse` on the `ToolPart`
7. **Transcript**: `ChatMessageBubble` renders `HitlResponseWidget` for messages with `hitlContext`

#### Workflow Auto-Answer Bypass (`use-workflow-hitl.ts:321-329`)

When `workflowStateRef.current.workflowActive` is true, questions are auto-answered with the first option's label or `"continue"` — no UI is shown. This is relevant for the DSL node type: we may want to bypass this auto-answer for `askUserQuestion()` nodes since they explicitly request user interaction.

---

### 5. WorkflowDefinition and Conductor Integration

#### WorkflowDefinition (`src/services/workflows/types/definition.ts:47-77`)

Key fields for DSL compilation:
- `conductorStages?: readonly StageDefinition[]` — only `"stage"` instructions produce entries
- `createConductorGraph?: () => CompiledGraph<BaseState>` — factory returning the node/edge graph
- `nodeDescriptions?: Record<string, string>` — human-readable names for nodes

#### Conductor Execution (`src/services/workflows/conductor/types.ts:340-483`)

The conductor walks the `CompiledGraph`, matching `"agent"` nodes to `StageDefinition` entries by ID. Non-agent nodes (including `"tool"` and `"ask_user"`) are executed directly through the graph executor's `NodeDefinition.execute` function.

---

### 6. Workflow Step Part Display (`src/components/message-parts/workflow-step-part-display.tsx:35-62`)

Renders stage banners as: `│ NODE_ID_UPPERCASED (duration)`

Color by status: running=accent(teal), completed=success(green), error=red, skipped=warning(yellow).

The `WorkflowStepPart` type (`src/state/parts/types.ts:143-153`) has fields: `type: "workflow-step"`, `workflowId`, `nodeId`, `status`, `startedAt`, `completedAt?`, `durationMs?`, `result?`, `error?`.

---

### 7. DSL Builder Implementation (`src/services/workflows/dsl/define-workflow.ts`)

The `WorkflowBuilder` class records `Instruction[]` and delegates to `compileWorkflow()`. Key patterns:
- `stageNames: Set<string>` for uniqueness checking
- `loopDepth: number` for break/endLoop validation
- `getStateSchema()` merges global and loop state schemas
- `.compile()` brands the result with `__compiledWorkflow: true`

---

## Code References

### DSL Core
- `src/services/workflows/dsl/types.ts:120-146` — `ToolOptions` interface
- `src/services/workflows/dsl/types.ts:272-281` — `Instruction` discriminated union
- `src/services/workflows/dsl/types.ts:334-418` — `WorkflowBuilderInterface`
- `src/services/workflows/dsl/define-workflow.ts:55-57` — `defineWorkflow()` entry point
- `src/services/workflows/dsl/define-workflow.ts:127-130` — `.tool()` builder method
- `src/services/workflows/dsl/compiler.ts:58-122` — `validateInstructions()`
- `src/services/workflows/dsl/compiler.ts:306-502` — `generateGraph()`
- `src/services/workflows/dsl/compiler.ts:316-342` — `addNode()` helper
- `src/services/workflows/dsl/compiler.ts:380-386` — Tool instruction handling in graph generation

### Graph-Level Ask User
- `src/services/workflows/graph/nodes/control.ts:145-225` — All ask-user types and `askUserNode()` factory
- `src/services/workflows/graph/contracts/core.ts:10` — `NodeType` union with `"ask_user"`
- `src/services/workflows/graph/contracts/core.ts:12-16` — `BaseState`
- `src/services/workflows/graph/contracts/runtime.ts:46-65` — `NodeDefinition`
- `src/services/workflows/graph/contracts/runtime.ts:24-28` — `NodeResult` (with `signals`)
- `src/services/workflows/graph/contracts/runtime.ts:30-40` — `ExecutionContext`

### HITL UI
- `src/components/user-question-dialog.tsx:53-404` — Interactive question dialog
- `src/components/hitl-response-widget.tsx:24-88` — Post-answer display widget
- `src/components/message-parts/tool-part-display.tsx:165-213` — Inline HITL rendering
- `src/state/chat/shared/types/hitl.ts:1-26` — `UserQuestion`, `QuestionOption`, `QuestionAnswer` types
- `src/state/chat/controller/use-workflow-hitl.ts:126` — HITL orchestrator hook
- `src/state/chat/controller/use-workflow-hitl.ts:321-329` — Workflow auto-answer bypass
- `src/state/streaming/pipeline-tools/hitl.ts:11-92` — ToolPart mutation for HITL request/response
- `src/state/streaming/pipeline-tools/shared.ts:4-13` — HITL tool name detection
- `src/state/parts/types.ts:86-93` — `ToolPart.pendingQuestion` field
- `src/state/chat/shell/ChatShell.tsx:252-258` — Dialog mount point

### Workflow Step Rendering
- `src/components/message-parts/workflow-step-part-display.tsx:35-62` — Stage banner display
- `src/components/message-parts/registry.tsx:57-69` — `PART_REGISTRY`
- `src/state/parts/types.ts:143-153` — `WorkflowStepPart`
- `src/state/streaming/pipeline-workflow.ts:79-175` — Part creation/update

### Conductor
- `src/services/workflows/conductor/types.ts:237-262` — `StageContext`
- `src/services/workflows/conductor/types.ts:277-327` — `StageDefinition`
- `src/services/workflows/types/definition.ts:47-77` — `WorkflowDefinition`

### Event Bus
- `src/services/events/bus-events/schemas.ts:142-152` — `stream.human_input_required` schema
- `src/state/chat/stream/use-session-subscriptions.ts:535-558` — Bus event subscription

## Architecture Documentation

### Current DSL Node Type Architecture

```
defineWorkflow(options)
  → WorkflowBuilder
    → .stage(StageOptions)   → Instruction { type: "stage", id, config }
    → .tool(id, ToolOptions) → Instruction { type: "tool", id, config }
    → .compile()
      → compileWorkflow(builder)
        → validateInstructions()
        → generateStageDefinitions()  // only "stage" → StageDefinition[]
        → generateGraph()             // "stage" → agent node, "tool" → tool node
        → createStateFactory()
        → WorkflowDefinition { conductorStages, createConductorGraph, ... }
```

### HITL Event Architecture

```
askUserNode.execute()
  ├─ ctx.emit("human_input_required", eventData)  ──→ EventBus
  │                                                     │
  │                                              stream.human_input_required
  │                                                     │
  │                                              use-session-subscriptions.ts
  │                                                     │
  │                                              handleAskUserQuestion()
  │                                                     │
  │                                   ┌─ workflow active? → auto-answer
  │                                   └─ not active → enqueue question
  │                                                        │
  │                                                 UserQuestionDialog
  │                                                        │
  │                                                 handleQuestionAnswer()
  │                                                     │
  │                                   respond(answer) ──→ SDK / session.send()
  │
  └─ returns NodeResult { stateUpdate: AskUserWaitState, signals: [...] }
      → graph executor pauses/continues based on signals
```

### Key Design Decision Points for `askUserQuestion()` DSL Node

1. **Node type**: Should use `"ask_user"` (already in `NodeType` union), not `"tool"`
2. **Instruction type**: New variant `{ type: "askUserQuestion", id, config }` in the `Instruction` union
3. **Builder method**: `.askUserQuestion(id, options)` following the `.tool(id, options)` pattern
4. **Compiler handling**: New `case "askUserQuestion"` in `generateGraph()` that creates an `"ask_user"` node
5. **Stage definitions**: Like tools, ask-user nodes should NOT produce `StageDefinition` entries — they execute through the graph executor directly
6. **Validation**: Should be validated like tool nodes (unique ID check)
7. **Workflow auto-answer bypass**: Must be addressed — the current `useWorkflowHitl` auto-answers when `workflowActive` is true. DSL-level ask-user nodes need to reach the UI.
8. **State**: The `AskUserWaitState` fields (`__waitingForInput`, `__waitNodeId`, `__askUserRequestId`) need to be part of the workflow state

## Historical Context (from research/)

The following research documents provide relevant historical context:

- `research/docs/2026-03-21-workflow-sdk-simplification-z3-verification.md` — Most recent DSL design, covers the chainable builder pattern and instruction-based compilation approach
- `research/docs/2026-02-25-workflow-sdk-design.md` — Original SDK design including node types
- `research/docs/2026-02-11-workflow-sdk-implementation.md` — SDK implementation research covering custom tools and graph execution
- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` — Pluggable workflows design research
- `research/docs/v1/2026-03-15-spec-04-workflow-engine.md` — V2 rebuild workflow engine spec

## Related Specs

- `specs/2026-03-23-workflow-sdk-simplification-z3-verification.md` — Section 5.1.5 referenced by DSL types
- `specs/2026-02-11-workflow-sdk-implementation.md` — Custom tools, sub-agents, graph execution
- `specs/2026-03-02-workflow-sdk-standardization.md` — Unified graph engine, declarative API

## Open Questions

1. **Workflow auto-answer bypass**: When a DSL workflow hits an `askUserQuestion()` node, should the HITL auto-answer logic in `useWorkflowHitl` be bypassed? The current behavior auto-answers with the first option when `workflowActive` is true, which would defeat the purpose of an explicit ask-user node.

2. **Dynamic vs static options**: Should the DSL node support dynamic options via `(state: BaseState) => AskUserOptions` (like the graph-level `askUserNode`), or only static `AskUserOptions`?

3. **State field naming**: The `AskUserWaitState` uses dunder-prefixed fields (`__waitingForInput`, etc.). Should these be merged into the workflow's global state schema automatically, or should the user declare them?

4. **Conditional ask-user inside loops**: Should `askUserQuestion()` be allowed inside `.loop()` / `.endLoop()` blocks? If so, how does the repeated question interact with the HITL queue?

5. **Multi-select support**: The `UserQuestionDialog` supports `multiSelect` mode, but `AskUserOptions` does not include a `multiSelect` field. Should the DSL node expose this?

6. **Answer routing into state**: The tool node maps its execute result into state updates via `{ stateUpdate: result }`. Should `askUserQuestion()` provide an `outputMapper` (like stages) to map the user's answer into structured state updates?

7. **`isNodeType` guard gap**: The `isNodeType()` runtime guard at `contracts/guards.ts:12-16` omits `"ask_user"` from its includes array. This may need fixing if the conductor uses this guard.
