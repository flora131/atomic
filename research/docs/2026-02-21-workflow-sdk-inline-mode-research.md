---
date: 2026-02-21 05:21:04 UTC
researcher: Copilot
git_commit: 06b2a8f6c411b6ffb6a4928a33d6ab1cbeb3191d
branch: lavaman131/hotfix/ralph
repository: ralph
topic: "Workflow SDK Inline Mode, Clear Node Removal, Visual Mode Indicators, and Ralph Task List Persistence"
tags: [research, codebase, workflow-sdk, ralph, tui, opentui, keyboard-handling, theme, task-list, clear-nodes]
status: complete
last_updated: 2026-02-21
last_updated_by: Copilot
---

# Research: Workflow SDK Inline Mode & Visual Mode Indicators

## Research Question

Document the current workflow SDK architecture (including the `/ralph` workflow command) and the TUI chat system to understand:
1. How the workflow SDK executes and whether its output appears in the main chat context
2. How the chat box outline/border styling works in OpenTUI
3. How keyboard input (specifically Ctrl+C) is handled
4. How tasks.json and task list widgets work with session IDs
5. How the reviewer agent updates task state
6. How clear nodes function in the workflow SDK

This research informs a feature that makes workflows run inline in the chat context with visual mode indicators (teal border), double Ctrl+C workflow exit, persistent task list display for `/ralph`, and removal of clear nodes.

## Summary

The workflow system already runs **inline within the main chat context** — workflow commands like `/ralph` use `streamAndWait()` which sends prompts through the existing chat streaming pipeline. Clear nodes (`clearContextNode()`) emit signals that trigger session reset and message clearing via `context.clearContext()`. The chat box border uses `themeColors.inputFocus` (currently `#585b70` dark / `#acb0be` light), which is a static theme color. Ctrl+C handling already supports double-press exit, but has no concept of "workflow mode" — it either interrupts streaming, cancels workflows, or exits the TUI. The task list panel is already conditionally rendered based on `ralphSessionDir` state and watches `tasks.json` for updates.

---

## Detailed Findings

### 1. Workflow SDK Architecture

#### Graph-Based Execution Engine (`src/graph/`)

The workflow SDK is a full graph execution engine with these components:

- **Type System** (`src/graph/types.ts`): Defines `BaseState`, `NodeDefinition`, `ExecutionContext`, `NodeResult`, `CompiledGraph`, and `GraphConfig` interfaces. Seven node types: `agent`, `tool`, `decision`, `wait`, `ask_user`, `subgraph`, `parallel`.

- **Builder API** (`src/graph/builder.ts:136-696`): `GraphBuilder` class with fluent API — `start()`, `then()`, `if()`, `else()`, `endif()`, `loop()`, `wait()`, `catch()`, `compile()`. Entry point: `graph<TState>()` factory at line 694.

- **Execution Engine** (`src/graph/compiled.ts:213-695`): `GraphExecutor` class executes compiled graphs via streaming BFS-style traversal. Factory functions: `createExecutor()`, `executeGraph()`, `streamGraph()` at lines 721-757.

- **Node Factories** (`src/graph/nodes.ts`): Pre-built node types:
  - `agentNode()` (line 170) — AI agent execution
  - `clearContextNode()` (line 494) — Context window clearing
  - `decisionNode()` (line 577) — Conditional routing
  - `waitNode()` (line 668) — Human-in-the-loop pause
  - `askUserNode()` (line 816) — Structured user questions
  - `parallelNode()` (line 988) — Concurrent branch execution
  - `subgraphNode()` (line 1126) — Nested workflow execution
  - `contextMonitorNode()` (line 1374) — Context usage monitoring

#### How Workflows Execute in Chat Context

Workflows are NOT separate processes — they execute **within the main chat event loop**:

1. User types `/ralph <prompt>` (`src/ui/chat.tsx:5344`)
2. `parseSlashCommand()` extracts command (`src/ui/commands/index.ts:148`)
3. `executeCommand()` looks up command in `globalRegistry` (`chat.tsx:3420`)
4. `CommandContext` created with session, helpers, and state (`chat.tsx:3451-3781`)
5. Command's `execute()` function invoked with context (`chat.tsx:3807`)
6. Command uses `context.streamAndWait()` to send prompts through normal chat pipeline
7. `streamAndWait()` returns a `Promise<StreamResult>` that resolves on stream completion

**Key Insight**: `streamAndWait()` wraps the regular message streaming — it creates placeholder assistant messages, processes chunks through the parts system, and renders in the chat transcript. The only difference is that `hideContent: true` option suppresses rendering while still accumulating content.

#### Workflow Output Integration (`src/ui/chat.tsx:3714-3724`)

```
streamAndWait(prompt, options?)
  └─> sendSilentMessage(prompt)     // Triggers streaming without user msg
  └─> handleChunk(chunk)            // Accumulates in lastStreamingContentRef
  └─> if !hideContent: handleTextDelta()  // Updates parts for display
  └─> handleComplete()              // Resolves promise with {content, wasInterrupted}
```

- When `hideContent: false` (default in Step 2 loop), output renders normally in chat
- When `hideContent: true` (Step 1 task decomposition), output is accumulated but not rendered
- Empty placeholder messages are removed on completion when content was hidden

### 2. Clear Nodes — Current Implementation

#### `clearContextNode()` (`src/graph/nodes.ts:494-524`)

Creates a node that emits a `context_window_warning` signal with `data.action = "summarize"` and `data.usage = 100` (forcing summarization). It does NOT directly call session methods — it relies on the workflow handler to respond to the signal.

**Usage Pattern**:
```typescript
const clearNode = clearContextNode({
  id: "clear-after-research",
  message: "Clearing context for spec creation"
});
graph().start(researchNode).then(clearNode).then(specNode).compile();
```

**In Loops**:
```typescript
builder.loop([clearContextNode, processNode], {
  until: (s) => s.done
});
// Chains: clearContextNode → processNode → loop_check
// On continue: returns to clearContextNode (first body node)
```

#### `context.clearContext()` (`src/ui/chat.tsx:3726-3744`)

The actual clearing is performed by `CommandContext.clearContext()`:
1. Calls `onResetSession()` to destroy SDK session (line 3728)
2. Moves messages to history buffer via `appendToHistoryBuffer()` (line 3731)
3. Clears messages array: `setMessagesWindowed([])` (line 3732)
4. Resets UI state: `trimmedMessageCount`, `compactionSummary`, `showCompactionHistory`, `parallelAgents` (lines 3734-3737)
5. **Preserves**: `todoItems`, `ralphSessionDir`, `ralphSessionId` from refs (lines 3738-3743)

#### Where Clear Context Is Called in Ralph (`src/ui/commands/workflow-commands.ts:684`)

In the Ralph workflow, `context.clearContext()` is called before the review phase (Step 3, line 684) to give the reviewer agent a clean context window. Task state is preserved across this clear.

#### Other Context Management

- `contextMonitorNode()` (line 1374): Monitors token usage and triggers compaction based on agent type (OpenCode: summarize, Claude: recreate session, Copilot: warn only)
- `compactContext()` (line 1549): Direct session compaction function

### 3. Chat Box Border/Outline Styling

#### Current Border Rendering (`src/ui/chat.tsx:5685-5694`)

```tsx
<box
  border
  borderStyle="rounded"
  borderColor={themeColors.inputFocus}
  paddingLeft={SPACING.CONTAINER_PAD}
  paddingRight={SPACING.CONTAINER_PAD}
  marginTop={messages.length > 0 ? SPACING.ELEMENT : SPACING.NONE}
  flexDirection="row"
  alignItems="flex-start"
  flexShrink={0}
>
```

- **`borderColor`**: Uses `themeColors.inputFocus` — a static theme color
- **Dark theme value**: `#585b70` (Catppuccin Mocha Surface 2, `theme.tsx:230`)
- **Light theme value**: `#acb0be` (Catppuccin Latte Surface 2, `theme.tsx:262`)
- **`inputFocused`** state exists (line 1799) but is hardcoded to `true`

#### Theme System (`src/ui/theme.tsx`)

**ThemeColors Interface** (lines 20-61) — key border-related properties:
- `inputFocus: string` — Input border when focused (line 44)
- `inputStreaming: string` — Input border when streaming (line 46)
- `border: string` — General container borders (line 28)
- `dim: string` — Faded elements (line 54)

**Theme Context** (lines 78-87):
```typescript
interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  isDark: boolean;
}
```

**Usage**: `const themeColors = useThemeColors()` returns `ThemeColors` object. Colors are reactive — changing theme via `setTheme()` or `toggleTheme()` triggers re-renders across all consuming components.

#### OpenTUI Border API

OpenTUI `<box>` component supports:
- `border`: `boolean | BorderSides[]` — enables border
- `borderStyle`: `"single" | "double" | "rounded" | "heavy"` — border line style
- `borderColor`: `string | RGBA` — hex colors, named CSS colors, RGBA objects
- `focusedBorderColor`: `ColorInput` — color when `focused={true}` (default: `#00AAFF`)
- `focused`: `boolean` — toggles between `borderColor` and `focusedBorderColor`

**Dynamic Color Changes**: OpenTUI supports state-driven border color changes via React state. When `borderColor` prop changes, `BoxRenderable` calls `this.requestRender()` for visual update.

### 4. Keyboard Input / Ctrl+C Handling

#### Ctrl+C Decision Tree (`src/ui/chat.tsx:4212-4402`)

The handler processes Ctrl+C through a priority chain:

1. **Text selection?** → Copy to clipboard, return (lines 4214-4220)
2. **Streaming?** → Interrupt stream: abort controller, map agents to "interrupted", cancel workflow (lines 4222-4306)
3. **Sub-agents running?** → Interrupt sub-agents, finalize tasks (lines 4308-4349)
4. **Workflow active?** → Cancel workflow via state update (lines 4351-4366)
5. **Textarea has content?** → Clear textarea (lines 4368-4374)
6. **Empty/idle** → Double-press exit logic (lines 4376-4401)

#### Double-Press Exit Logic (lines 4376-4401)

```
First press:
  interruptCount = 1
  setCtrlCPressed(true)    // Shows "Press Ctrl-C again to exit"
  setTimeout(1000ms)       // Reset counter after 1 second

Second press (within 1s):
  interruptCount >= 2
  onExit()                 // Calls cleanup() → process exit
```

#### Warning Display (`src/ui/chat.tsx:5766-5773`)

```tsx
{ctrlCPressed && (
  <box paddingLeft={1} flexShrink={0}>
    <text style={{ fg: themeColors.muted }}>
      Press Ctrl-C again to exit
    </text>
  </box>
)}
```

#### Signal Handler Setup (`src/ui/index.ts:1513-1540`)

- `exitOnCtrlC: false` in renderer options — disables default exit-on-Ctrl+C
- `useKittyKeyboard: { disambiguate: true }` — Ctrl+C arrives as keyboard event, not SIGINT
- SIGINT handler calls `handleInterrupt("signal")` as fallback for non-Kitty terminals
- AbortController wraps SDK stream for immediate cancellation

#### Dual Source Handling (`src/ui/index.ts:1448-1510`)

`handleInterrupt(sourceType: "ui" | "signal")` handles both keyboard and signal Ctrl+C:
- If streaming: aborts controller, resets state, tracks telemetry
- If idle: increments counter, shows warning, exits on double-press

**Key State Variables** (`chat.tsx`):
- `interruptCount` (line 1806) — consecutive press counter
- `interruptTimeoutRef` (line 1807) — 1s reset timeout
- `ctrlCPressed` (line 1810) — warning visibility
- `isStreamingRef` (line 1974) — synchronous streaming check

### 5. Ralph Workflow Specifics

#### Session & Task Lifecycle (`src/ui/commands/workflow-commands.ts:547-800`)

**Initialization** (lines 581-591):
1. `sessionId = crypto.randomUUID()`
2. `initWorkflowSession("ralph", sessionId)` creates directory at `~/.atomic/workflows/sessions/{sessionId}/`
3. Stored in `activeSessions` map
4. Updates workflow state: `workflowActive: true`, `workflowType: "ralph"`

**Step 1 — Task Decomposition** (lines 593-617):
1. `streamAndWait(buildSpecToTasksPrompt(prompt), { hideContent: true })`
2. Parses tasks from JSON via `parseTasks(step1.content)`
3. `saveTasksToActiveSession(tasks, sessionId)` writes `tasks.json` to session dir
4. Seeds in-memory state via `context.setTodoItems()`
5. Sets `ralphSessionDir`, `ralphSessionId`, `ralphTaskIds`

**Step 2 — Implementation Loop** (lines 636-668):
1. Loops until all tasks completed or `MAX_RALPH_ITERATIONS = 100`
2. First iteration: `buildBootstrappedTaskContext()` injects task list
3. Subsequent iterations: `buildContinuePrompt()`
4. `streamAndWait(prompt)` without `hideContent` — output visible in chat
5. `readTasksFromDisk()` after each iteration to update UI state
6. Exits if `allCompleted` or `!hasActionableTasks()`

**Step 3 — Review & Fix** (lines 670-794):
1. Only runs if all tasks completed
2. `context.clearContext()` before review (line 684)
3. `context.spawnSubagent()` spawns `reviewer` agent (lines 694-697)
4. `parseReviewResult()` extracts findings
5. Saves `review-{iteration}.json` to session directory
6. `buildFixSpecFromReview()` generates fix specification
7. If fixes needed, re-invokes Steps 1-2 with fix spec

#### tasks.json File Format

Tasks are written via `saveTasksToActiveSession()` using `atomicWrite()` (temp file + rename):
```json
[
  { "id": "#1", "content": "Task description", "status": "pending", "blockedBy": [] },
  { "id": "#2", "content": "Another task", "status": "in_progress", "blockedBy": ["#1"] }
]
```

- File path: `~/.atomic/workflows/sessions/{sessionId}/tasks.json`
- `atomicWrite()` (lines 133-156) uses temp file + rename for safe updates
- Task status values: `"pending"`, `"in_progress"`, `"completed"`, `"error"`

#### Task List Panel Visibility (`src/ui/chat.tsx:5674-5679`)

```tsx
{ralphSessionDir && showTodoPanel && (
  <TaskListPanel sessionDir={ralphSessionDir} expanded={tasksExpanded} />
)}
```

- `ralphSessionDir` (line 1926) — set by `context.setRalphSessionDir()`
- `showTodoPanel` (line 1922) — toggled by Ctrl+T, default `true`
- Task list watches `tasks.json` via `watchTasksJson()` (file watcher on session directory)

#### File Watching System (`src/ui/commands/workflow-commands.ts:806-858`)

- Watches **directory** (not file) to catch creation events (line 846)
- Reads `tasks.json` on change, parses JSON, normalizes via `normalizeTodoItems()`
- Debounces reads to handle rapid file updates
- Ignores errors for missing/mid-write files

### 6. Reviewer Agent Integration

#### Reviewer Agent Definitions

Three parallel definitions for each coding agent:
- `.claude/agents/reviewer.md`
- `.github/agents/reviewer.md`
- `.opencode/agents/reviewer.md`

#### Reviewer in Ralph Workflow (`workflow-commands.ts:694-697`)

```typescript
context.spawnSubagent({
  type: "reviewer",
  instruction: buildReviewPrompt(...)
})
```

The reviewer is spawned as a sub-agent via `context.spawnSubagent()` which:
1. Formats instruction into `sendSilentMessage()` call
2. Sets `hideStreamContentRef = true` to suppress UI rendering
3. Accumulates output in `lastStreamingContentRef`
4. Returns result via Promise resolution

**Current Behavior**: The reviewer does NOT currently update `tasks.json` directly. It returns a structured review result that is parsed by `parseReviewResult()`. If fixes are needed, the workflow creates a new fix specification and re-runs Steps 1-2, which generates a NEW set of tasks.

### 7. Subagent Bridge Architecture (`src/graph/subagent-bridge.ts`)

The bridge uses a multi-layered event-driven architecture:

1. **SubagentGraphBridge**: Created in chat component with a session factory (`createSubagentSession`)
2. **Session Factory**: Creates isolated sessions per subagent (no shared context)
3. **SDK Event System**: Three event types route through handlers in `ui/index.ts`:
   - `subagent.start` (line 963): Creates `ParallelAgent` in UI state
   - `tool.complete` (line 702): Parses Task tool result, finalizes agent status
   - `subagent.complete` (line 1080): Updates agent status to completed/error

**Correlation ID Chain**: `SDK IDs → internal toolId → agentId` tracked in `sdkToolIdMap`, `toolCallToAgentMap`, `sdkCorrelationToRunMap`.

### 8. Workflow State Management (`src/ui/chat.tsx`)

**Key State Variables for Workflow Mode**:
- `workflowState.workflowActive` (boolean) — whether a workflow is currently running
- `workflowState.workflowType` (string) — type of active workflow (e.g., "ralph")
- `ralphSessionDir` (line 1926) — session directory path
- `ralphSessionId` (line 1928) — session UUID
- `todoItems` (line 1920) — current task items for display
- `showTodoPanel` (line 1922) — task panel visibility toggle

**Default Workflow State** (`defaultWorkflowChatState`):
- `workflowActive: false`
- `workflowType: undefined`
- `ralphConfig: undefined`

---

## Code References

### Workflow SDK Core
- `src/graph/types.ts` — All workflow type definitions
- `src/graph/builder.ts:136-696` — GraphBuilder fluent API
- `src/graph/compiled.ts:213-695` — GraphExecutor engine
- `src/graph/nodes.ts:494-524` — `clearContextNode()` implementation
- `src/graph/nodes.ts:1374-1512` — `contextMonitorNode()` implementation
- `src/graph/index.ts:14-304` — Public API exports

### Ralph Workflow
- `src/ui/commands/workflow-commands.ts:547-800` — Ralph command implementation
- `src/ui/commands/workflow-commands.ts:415-423` — Ralph metadata definition
- `src/ui/commands/workflow-commands.ts:806-858` — `watchTasksJson()` file watcher
- `src/ui/commands/workflow-commands.ts:133-156` — `atomicWrite()` for tasks.json
- `src/graph/nodes/ralph.ts` — Ralph graph node implementation
- `src/workflows/session.ts` — Workflow session management

### Chat Box & TUI
- `src/ui/chat.tsx:5685-5694` — Chat box border rendering
- `src/ui/chat.tsx:4212-4402` — Ctrl+C handler
- `src/ui/chat.tsx:4376-4401` — Double-press exit logic
- `src/ui/chat.tsx:5766-5773` — Ctrl+C warning display
- `src/ui/chat.tsx:3726-3744` — `clearContext()` implementation
- `src/ui/chat.tsx:3714-3724` — `streamAndWait()` implementation

### Theme & Styling
- `src/ui/theme.tsx:20-61` — ThemeColors interface
- `src/ui/theme.tsx:215-240` — Dark theme (inputFocus: `#585b70`)
- `src/ui/theme.tsx:247-272` — Light theme (inputFocus: `#acb0be`)
- `src/ui/theme.tsx:358-390` — ThemeProvider component

### Task List UI
- `src/ui/components/task-list-panel.tsx:156` — TaskListPanel wrapper
- `src/ui/components/task-list-panel.tsx:71` — TaskListBox presentational component
- `src/ui/components/task-list-indicator.tsx:93` — TaskListIndicator items
- `src/ui/utils/ralph-task-state.ts` — Ralph task state management
- `src/ui/utils/task-status.ts` — Task status normalization utilities

### Keyboard & Signal Handling
- `src/ui/index.ts:1448-1510` — `handleInterrupt()` unified handler
- `src/ui/index.ts:1513-1540` — Signal handler setup
- `src/ui/index.ts:1566-1573` — Renderer options (exitOnCtrlC, Kitty keyboard)
- `src/ui/index.ts:1612` — `handleInterruptFromUI()` bridge

### Subagent System
- `src/graph/subagent-bridge.ts` — Subagent-to-workflow bridge
- `src/graph/subagent-registry.ts` — Subagent type registry
- `src/ui/parts/handlers.ts` — Part event handlers
- `src/ui/parts/store.ts` — Binary search-based part storage

---

## Architecture Documentation

### Current Patterns

1. **Workflows run inline in chat**: Workflow commands use `streamAndWait()` which pipes through the normal chat streaming pipeline. Output already appears in the main chat context.

2. **Static border color**: The chat box border is always `themeColors.inputFocus` — there is no dynamic mode-based color switching. The `inputStreaming` color exists in the theme but is not used for the chat input border.

3. **No "workflow mode" concept in UI**: The system tracks `workflowState.workflowActive` but does not visually differentiate workflow mode from normal mode (no border color change, no mode indicator).

4. **Ctrl+C priority chain**: Streaming interrupt → sub-agent interrupt → workflow cancel → clear input → double-press exit. When a workflow is active, Ctrl+C cancels it (step 4 in the chain) — it does NOT require double-press to exit the workflow.

5. **Clear context in review phase**: The Ralph workflow only clears context before the review phase (Step 3). This is the only use of `clearContext()` in the Ralph workflow.

6. **Task state survives context clears**: `todoItems`, `ralphSessionDir`, and `ralphSessionId` are stored in refs and restored after `clearContext()` operations.

7. **Reviewer does not update tasks.json**: The reviewer returns structured findings; the workflow generates new tasks from the fix spec if needed.

8. **File-based task watching**: `TaskListPanel` watches the session directory for `tasks.json` changes and re-renders on updates.

---

## Historical Context (from research/)

### Workflow SDK Research
- `research/docs/2026-02-11-workflow-sdk-implementation.md` — Comprehensive workflow SDK implementation research
- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` — Original pluggable workflows design
- `research/docs/2026-02-03-workflow-composition-patterns.md` — Workflow composition pattern research
- `research/docs/2026-02-03-custom-workflow-file-format.md` — Custom workflow file format research
- `research/docs/2026-01-31-workflow-config-semantics.md` — Workflow configuration semantics

### Ralph-Specific Research
- `research/docs/2026-02-15-ralph-dag-orchestration-implementation.md` — DAG-based orchestration implementation
- `research/docs/2026-02-15-ralph-dag-orchestration-blockedby.md` — BlockedBy feature for task dependencies
- `research/docs/2026-02-15-ralph-loop-manual-worker-dispatch.md` — Manual worker dispatch
- `research/docs/2026-02-13-ralph-task-list-ui.md` — Task list UI design research
- `research/docs/qa-ralph-task-list-ui.md` — QA analysis of task list UI
- `research/docs/2026-02-09-163-ralph-loop-enhancements.md` — Loop enhancements (Issue #163)

### TUI Architecture Research
- `research/docs/2026-02-16-atomic-chat-architecture-current.md` — Current chat architecture
- `research/docs/2026-02-16-chat-system-design-ui-research.md` — Chat system design research
- `research/docs/2026-02-16-opentui-rendering-architecture.md` — OpenTUI rendering architecture

### Related Specs
- `specs/workflow-sdk-implementation.md` — Workflow SDK implementation spec
- `specs/ralph-task-list-ui.md` — Ralph task list UI spec
- `specs/ralph-dag-orchestration.md` — Ralph DAG orchestration spec
- `specs/pluggable-workflows-sdk.md` — Pluggable workflows SDK spec

---

## Related Research

- `research/docs/2026-02-19-sdk-v2-first-unified-layer-research.md` — SDK v2 unified layer
- `research/docs/2026-02-15-ralph-orchestrator-ui-cleanup.md` — Ralph orchestrator UI cleanup
- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` — Sub-agent SDK integration

---

## Open Questions

1. **Workflow mode border color**: The `inputStreaming` theme color (`#6c7086`/`#9ca0b0`) exists but is unused for the input border. Should "workflow mode" reuse this property or introduce a new `inputWorkflow` theme color for teal blue?

2. **Double Ctrl+C behavior change**: Currently, Ctrl+C when a workflow is active immediately cancels the workflow (single press, step 4 in the priority chain). The proposed change requires double Ctrl+C to exit workflow mode. This means the priority chain needs restructuring — the workflow cancel step needs to become a double-press step, and the existing double-press exit needs to be layered on top.

3. **Reviewer updating tasks.json**: Currently the reviewer does not update tasks.json. The proposed feature requires the reviewer to write back task updates (new tasks, blockers). This would need changes to the reviewer agent prompt and the review result handling in `workflow-commands.ts`.

4. **Context preservation on workflow exit**: When exiting workflow mode via double Ctrl+C, should the workflow messages remain in the chat transcript? The current `clearContext()` moves messages to history buffer — but the proposal says "the context will still have the ralph run."

5. **Clear node removal scope**: Does "remove clear nodes" mean removing `clearContextNode()` from the SDK entirely, or just not using it in the Ralph workflow? The Ralph workflow currently only calls `clearContext()` before the review phase, not via `clearContextNode()` graph nodes.

6. **Task list widget lifecycle**: The task list panel currently shows/hides based on `ralphSessionDir` being set. When exiting workflow mode, should `ralphSessionDir` be cleared (hiding the panel) or should it persist until the user explicitly dismisses it?
