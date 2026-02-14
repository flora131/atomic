---
date: 2026-02-13 16:34:26 UTC
researcher: copilot
git_commit: d096473ef88dcaf50c2b12fee794dae4576eb276
branch: lavaman131/hotfix/tool-ui
repository: atomic
topic: "Ralph Command Task List UI: Persistent Deterministic Component"
tags: [research, codebase, ralph, task-list, workflow, ui, opentui, persistent-component]
status: complete
last_updated: 2026-02-13
last_updated_by: copilot
---

# Research: Ralph Command Persistent Task List UI

## Research Question

How to modify the `/ralph` command UI so that when the slash command is run, a deterministic task list component (TSX) is rendered at the bottom of the TUI — pinned below streaming output and above the chat box. The component reads from the workflow session's `tasks.json` file and updates its UI state as tasks are marked complete. The task list persists across `/clear` and `/compact` operations, takes priority over other task lists at the bottom, and the worker agent marks tasks as `done` in `tasks.json` to drive UI updates. Manual context clearing in the ralph loop should be removed (auto-hooks handle it).

## Summary

The codebase already has nearly all the building blocks:
1. **`TaskListIndicator` component** (`src/ui/components/task-list-indicator.tsx`) renders task items with status icons, but is currently only shown inline during streaming and as a summary line when not streaming.
2. **`watchTasksJson()` function** (`src/ui/commands/workflow-commands.ts:874-890`) is fully implemented using `fs.watch` but **never called anywhere** — it's exported but has no consumers.
3. **`saveTasksToActiveSession()`** (`src/ui/commands/workflow-commands.ts:136-158`) writes tasks to `~/.atomic/workflows/sessions/{sessionId}/tasks.json`.
4. **`todoItemsRef`** preserves task state across context clears via `useRef` pattern (`src/ui/chat.tsx:1847-1848, 3235-3237`).
5. **Worker sub-agents** are spawned via `context.spawnSubagent()` and currently mark tasks as `completed` in-memory after each worker completes (`src/ui/commands/workflow-commands.ts:720-722`), then persist to `tasks.json` (`line 726`).
6. **Context clearing** happens manually via `context.clearContext()` after each worker task (`line 728`), but the graph system has `contextMonitorNode` and `clearContextNode` that can handle this automatically.

The key gap is: there is no **persistent, file-driven task list component** pinned at the bottom of the chat layout that reads from `tasks.json` and updates deterministically. The current `TodoPanel` (lines 4926-4935) only shows a summary line and is driven by React state, not by the file.

## Detailed Findings

### 1. Current `/ralph` Command Flow

**File**: `src/ui/commands/workflow-commands.ts`

The `/ralph` command implements a two-step workflow:

#### Step 1: Task Decomposition (lines 845-857)
- Sends `buildSpecToTasksPrompt(parsed.prompt)` via `context.streamAndWait()`
- Parses JSON task list from streaming output via `parseTasks()` (lines 632-655)
- Calls `context.setTodoItems(tasks)` to update TUI state (line 851)
- Saves to `tasks.json` via `saveTasksToActiveSession(tasks, sessionId)` (line 853)
- **Clears context** via `context.clearContext()` (line 857)

#### Step 2: Worker Loop (lines 685-730, called at line 864)
- `findNextAvailableTask()` finds first pending task with all dependencies met (lines 668-677)
- Marks task as `in_progress` and updates both UI and disk (lines 697-699)
- Spawns worker sub-agent: `context.spawnSubagent({ name: "worker", ... })` (lines 714-718)
- On success: marks task as `completed` (line 721)
- Persists to `tasks.json` and updates UI (lines 726-727)
- **Manually clears context** after each task: `context.clearContext()` (line 728) — **this is what should be removed**

#### Resume Flow (lines 758-820)
- Loads `tasks.json` from session directory
- Resets `in_progress` tasks back to `pending`
- Calls `runWorkerLoop()` with loaded tasks

### 2. Existing `TaskListIndicator` Component

**File**: `src/ui/components/task-list-indicator.tsx`

A presentational component that renders task items with status icons:

```
TaskItem interface (lines 27-32):
- id?: string
- content: string  
- status: "pending" | "in_progress" | "completed" | "error"
- blockedBy?: string[]
```

Status icons (lines 47-52):
- `pending`: ○ (muted)
- `in_progress`: ● (accent, blinking via `AnimatedBlinkIndicator`)
- `completed`: ● (green)
- `error`: ✕ (red)

Features: max 10 visible items, overflow indicator, truncation at 60 chars, expanded mode.

**This component can be reused directly** — it accepts a `TaskItem[]` prop and renders deterministically.

### 3. Current Task List Rendering in Chat UI

**File**: `src/ui/chat.tsx`

The task list is currently displayed in two modes:

#### During Streaming (inline in message bubble)
- `todoItems` prop passed to `MessageBubble` only when `msg.streaming === true` (line 4879)
- Inside `MessageBubble`, the `buildContentSegments()` function positions tasks chronologically in the message (lines 1340-1346)
- However, task segments currently render as `null` (line 1617-1619) — they're suppressed in favor of the panel

#### When Not Streaming (summary panel)
- Rendered above the scrollbox (lines 4926-4935)
- Shows only a one-line summary: `"☑ N tasks (X done, Y open) │ ctrl+t to hide"`
- **Does NOT show individual task items** — only counts
- Conditional: `showTodoPanel && !isStreaming && todoItems.length > 0`

#### State Management
- `todoItems` state: `useState<TodoItem[]>([])` (line 1847)
- `todoItemsRef`: `useRef<TodoItem[]>([])` (line 1848) — preserves across context clears
- Synchronized: `useEffect(() => { todoItemsRef.current = todoItems; }, [todoItems])` (lines 1930-1933)
- Preserved on context clear: `const saved = todoItemsRef.current; setTodoItems(saved);` (lines 3235-3237)
- **Cleared on new stream start**: `todoItemsRef.current = []; setTodoItems([]);` (lines 2200-2202)

### 4. `watchTasksJson()` — Implemented But Unused

**File**: `src/ui/commands/workflow-commands.ts:874-890`

```typescript
export function watchTasksJson(
  sessionDir: string,
  onUpdate: (items: TodoItem[]) => void,
): () => void {
  const tasksPath = join(sessionDir, "tasks.json");
  if (!existsSync(tasksPath)) return () => {};
  const watcher = watch(tasksPath, async () => {
    try {
      const content = await readFile(tasksPath, "utf-8");
      const tasks = JSON.parse(content) as TodoItem[];
      onUpdate(tasks);
    } catch { /* File may not exist yet or be mid-write */ }
  });
  return () => watcher.close();
}
```

- Uses Node.js native `fs.watch`
- Returns cleanup function
- **Not imported or called anywhere in the codebase**
- Was designed for this exact use case (spec reference: `specs/ralph-loop-enhancements.md:126`)

### 5. Workflow Session Storage

**File**: `src/workflows/session.ts`

Sessions stored at: `~/.atomic/workflows/sessions/{sessionId}/`

Directory structure:
```
{sessionId}/
├── session.json          # WorkflowSession metadata
├── tasks.json            # TodoItem[] task list (created by saveTasksToActiveSession)
├── agents/               # Sub-agent outputs ({agentId}.json)
├── checkpoints/          # Workflow state checkpoints
└── logs/                 # Session logs
```

- 339 existing session directories found
- ~10 sessions have `tasks.json` files
- `WORKFLOW_SESSIONS_DIR = join(homedir(), ".atomic", "workflows", "sessions")` (lines 32-37)

### 6. Chat Layout Structure

**File**: `src/ui/chat.tsx:4889-5090`

Current layout hierarchy (flexDirection="column"):
```
<box height="100%" width="100%">
  <AtomicHeader />                    ← Fixed header
  
  {/* Normal mode: */}
  <CompactionHistory />               ← Pinned above scrollbox (conditional)
  <TodoPanel (summary) />             ← Pinned above scrollbox (conditional)
  
  <scrollbox flexGrow={1} stickyScroll stickyStart="bottom">
    {messageContent}                  ← Chat messages
    <UserQuestionDialog />            ← Inline
    <ModelSelectorDialog />           ← Inline
    <QueueIndicator />                ← Bottom of scrollbox
    <InputBox />                      ← Bottom of scrollbox
    <StreamingHints />                ← Below input
    <Autocomplete />                  ← Below input
    <CtrlCWarning />                  ← Below input
  </scrollbox>
</box>
```

**Key observation**: The todo panel is currently rendered **above** the scrollbox (before it), not **below** it. For the ralph task list to be "pinned at the bottom", it should be rendered **after** the scrollbox but **before** or inside the scrollbox just above the input box, or as a new persistent element between the scrollbox and footer area.

### 7. Context Management — Auto-Clearing Hooks

**File**: `src/graph/nodes.ts`

The codebase has graph-based context monitoring:

#### `contextMonitorNode()` (lines 1374-1527)
- Checks context window usage against threshold (default 45%)
- Actions: "summarize" (OpenCode), "recreate" (Claude), "warn", "none"
- Emits `context_window_warning` signal

#### `clearContextNode()` (lines 494-524)
- Emits signal with `usage: 100` to force summarization

#### Constants (`src/graph/types.ts:628-631`)
- `BACKGROUND_COMPACTION_THRESHOLD = 0.45` (45%)
- `BUFFER_EXHAUSTION_THRESHOLD = 0.6` (60%)

**Current manual clearing in worker loop** (line 728): `await context.clearContext()` — this is called after every worker task, regardless of context usage. The automatic hooks (`contextMonitorNode`) exist in the graph system but are not wired into the ralph workflow's worker loop.

### 8. Worker Agent Configuration

Three identical worker agent definitions:
- `.github/agents/worker.md` — for Copilot SDK
- `.claude/agents/worker.md` — for Claude SDK (uses `model: opus`)
- `.opencode/agents/worker.md` — for OpenCode SDK

Key worker instructions (from `.github/agents/worker.md`):
- Only work on ONE highest priority task (line 66-67)
- Delegate errors to debugger agent (line 70)
- Mark features complete only after testing (line 76)
- Commit with `/commit` command (line 78)

**Current worker prompt** (`src/ui/commands/workflow-commands.ts:703-711`):
```
# Your Task
**Task ${task.id}**: ${task.content}
# Full Task List
```json
${taskListJson}
```
```

The worker receives the full task list as context but **does not write to `tasks.json` itself** — task status updates happen in the ralph loop after the worker completes (`line 721-727`).

### 9. Sub-Agent Spawning Mechanism

**File**: `src/ui/chat.tsx:3196-3216`

`context.spawnSubagent()` implementation:
1. Builds instruction: `"Use the ${agentName} sub-agent to handle this task: ${task}"`
2. Queues display name via `queueSubagentName(options.name)`
3. Sends silently via `context.sendSilentMessage(instruction)`
4. Waits for stream completion via Promise resolver pattern (`streamCompletionResolverRef`)
5. Returns `{ success: !result.wasInterrupted, output: result.content }`

### 10. TodoItem vs TaskItem Type Differences

**TodoItem** (`src/sdk/tools/todo-write.ts:53-59`):
```typescript
{ id?, content, status: "pending"|"in_progress"|"completed", activeForm, blockedBy? }
```

**TaskItem** (`src/ui/components/task-list-indicator.tsx:27-32`):
```typescript
{ id?, content, status: "pending"|"in_progress"|"completed"|"error", blockedBy? }
```

Differences:
- TaskItem adds `"error"` status (for UI error display)
- TaskItem omits `activeForm` field
- Conversion happens at multiple points in `chat.tsx` (lines 2260, 2274, 2582)

### 11. OpenTUI Layout Patterns

From DeepWiki research on `anomalyco/opentui`:

- **Pinning to bottom**: Use flexbox with `flexGrow={1}` for content area and fixed-height box at bottom
- **Persistent components**: Stay in React tree, survive re-renders as long as parent doesn't unmount
- **Sticky scroll**: `<scrollbox stickyScroll={true} stickyStart="bottom">` — auto-scrolls to show new content
- **File watcher integration**: Use standard `useState` + `useEffect` with `fs.watch` — external state changes trigger React re-renders
- **No special "persistent panel" API** — persistence is achieved through component tree structure

## Code References

### Core Implementation Files
- `src/ui/commands/workflow-commands.ts:136-158` — `saveTasksToActiveSession()`
- `src/ui/commands/workflow-commands.ts:685-730` — `runWorkerLoop()`
- `src/ui/commands/workflow-commands.ts:732-867` — `createRalphCommand()`
- `src/ui/commands/workflow-commands.ts:874-890` — `watchTasksJson()` (unused)
- `src/ui/components/task-list-indicator.tsx:74-120` — `TaskListIndicator` component
- `src/ui/chat.tsx:1847-1848` — `todoItems` state + ref
- `src/ui/chat.tsx:3224-3241` — `clearContext()` with todo preservation
- `src/ui/chat.tsx:4926-4935` — Current todo summary panel
- `src/ui/chat.tsx:4939-5085` — Scrollbox layout structure

### Type Definitions
- `src/sdk/tools/todo-write.ts:53-59` — `TodoItem` interface
- `src/ui/components/task-list-indicator.tsx:27-32` — `TaskItem` interface
- `src/ui/commands/registry.ts:64-118` — `CommandContext` interface
- `src/ui/commands/registry.ts:135-166` — `CommandContextState` interface
- `src/workflows/session.ts:17-26` — `WorkflowSession` interface

### Worker Agent Definitions
- `.github/agents/worker.md` — Copilot worker
- `.claude/agents/worker.md` — Claude worker
- `.opencode/agents/worker.md` — OpenCode worker

### Graph System (Auto-Context)
- `src/graph/nodes.ts:494-524` — `clearContextNode()`
- `src/graph/nodes.ts:1374-1527` — `contextMonitorNode()`
- `src/graph/types.ts:628-631` — Threshold constants

## Architecture Documentation

### Current Data Flow (Ralph → Task List UI)

```
/ralph "prompt"
  → streamAndWait(buildSpecToTasksPrompt) → parseTasks()
  → context.setTodoItems(tasks)            ← In-memory React state
  → saveTasksToActiveSession(tasks)        ← Writes tasks.json
  → context.clearContext()
  → runWorkerLoop(tasks):
      for each task:
        → task.status = "in_progress"
        → context.setTodoItems(tasks)      ← Updates React state
        → saveTasksToActiveSession(tasks)  ← Updates tasks.json
        → context.spawnSubagent("worker")
        → task.status = "completed"
        → saveTasksToActiveSession(tasks)  ← Updates tasks.json
        → context.setTodoItems(tasks)      ← Updates React state
        → context.clearContext()           ← MANUAL CLEAR (to be removed)
```

### Proposed Data Flow (File-Driven)

```
/ralph "prompt"
  → streamAndWait → parseTasks()
  → saveTasksToActiveSession(tasks)       ← Writes tasks.json
  → [NEW] Start watchTasksJson(sessionDir, callback)
  → runWorkerLoop(tasks):
      for each task:
        → saveTasksToActiveSession(tasks)  ← Updates tasks.json
        → fs.watch triggers callback       ← watchTasksJson fires
        → callback updates React state     ← Deterministic UI update
        → context.spawnSubagent("worker")
        → saveTasksToActiveSession(tasks)  ← Updates tasks.json
        → fs.watch triggers again          ← UI updates automatically
        ← NO manual context.clearContext() (auto-hooks handle it)
```

### Persistent Task List UI Component Pattern

The new component should follow the existing pattern used by `CompactionSummary` and `TodoPanel`:
- Rendered **outside** the scrollbox as a pinned element
- Uses `useState` driven by `watchTasksJson()` file watcher
- Persists across `/clear` and `/compact` (not cleared by those operations)
- Takes priority at bottom via flexbox ordering

Layout change:
```
<box height="100%" width="100%">
  <AtomicHeader />
  
  <scrollbox flexGrow={1}>
    {messageContent}
    <QueueIndicator />
    <InputBox />
    ...
  </scrollbox>
  
  [NEW] <RalphTaskListPanel />        ← Pinned below scrollbox, above nothing
</box>
```

Or alternatively, inside the scrollbox but always at the bottom:
```
<scrollbox flexGrow={1}>
  {messageContent}
  <QueueIndicator />
  [NEW] <RalphTaskListPanel />        ← Always visible, before input
  <InputBox />
</scrollbox>
```

### Key Patterns for Implementation

1. **File-driven state**: Use `watchTasksJson()` (already implemented) to read `tasks.json` and update React state
2. **Reuse `TaskListIndicator`**: The existing component is purely presentational — pass `TaskItem[]` props from file watcher state
3. **Persist across clears**: Store session dir in a `useRef` that survives `clearContext()` calls
4. **Remove manual `clearContext()`**: Delete line 728 in `workflow-commands.ts`; let graph-based `contextMonitorNode` handle compaction
5. **Worker writes `tasks.json`**: Modify the worker prompt to instruct it to update task status in `tasks.json` via the TodoWrite tool, OR keep the current pattern where the ralph loop updates `tasks.json` after each worker completes (the file watcher will detect changes either way)

## Historical Context (from research/)

- `research/docs/2026-02-09-163-ralph-loop-enhancements.md` — Previous research on ralph loop enhancements, includes design for `watchTasksJson()` and task persistence strategy
- `specs/ralph-loop-enhancements.md` — Specification for ralph loop enhancements including `writeTasksJson()` design (line 124), `watchTasksJson()` design (line 126)
- `specs/workflow-sdk-implementation.md` — Workflow SDK spec with `WORKFLOW_SESSIONS_DIR` definition (lines 592-605)

## Related Research

- `research/docs/2026-01-31-opentui-library-research.md` — OpenTUI library research (layout, components)
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` — Sub-agent UI in OpenTUI
- `research/docs/2026-02-11-workflow-sdk-implementation.md` — WorkflowSession system documentation

## Open Questions

1. **Task list panel position**: Should the ralph task list be rendered above or below the scrollbox? Above (like current `TodoPanel`) is simpler but doesn't match "pinned at bottom" requirement. Below scrollbox gives true bottom-pinning but changes layout significantly. Inside scrollbox just above input is another option.
2. **Worker-driven vs loop-driven task updates**: Should the worker agent itself write to `tasks.json` (via TodoWrite tool), or should the ralph loop continue to handle status updates after each worker completes? The current approach (loop-driven) is simpler and already works with `saveTasksToActiveSession()`.
3. **Clearing behavior**: When `/clear` or `/compact` is run during a ralph workflow, should the ralph task list panel survive? Current `todoItemsRef` preserves state across `clearContext()` calls — but a file-watcher-based approach would inherently survive since it reads from disk.
4. **Priority over other task lists**: If a regular `TodoWrite` tool call creates task items during streaming, should those be hidden when the ralph task list is active? Need a way to distinguish "ralph workflow tasks" from "ad-hoc TodoWrite tasks".
5. **Auto-context hooks**: The `contextMonitorNode` exists in the graph system but isn't wired into the ralph command's `runWorkerLoop()`. The current flow uses `context.spawnSubagent()` which routes through the main SDK session — context monitoring may need to be integrated at the SDK level rather than the graph level.
