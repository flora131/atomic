---
date: 2026-02-15 19:07:09 UTC
researcher: Claude Opus 4.6
git_commit: dbda8029862ba9e7bda5acce3a867a67d56cb048
branch: lavaman131/hotfix/sub-agents-ui
repository: atomic
topic: "Ralph Orchestrator UI Cleanup: Debug Text, Sub-Agent Trees, and Streaming Order"
tags:
    [
        research,
        codebase,
        ralph,
        orchestrator,
        ui,
        sub-agents,
        parallel-agents-tree,
        content-segments,
        streaming,
    ]
status: complete
last_updated: 2026-02-15
last_updated_by: Claude Opus 4.6
---

# Research: Ralph Orchestrator UI Cleanup

## Research Question

Research the Ralph orchestrator's UI rendering pipeline to document: (1) where the red debugging/dispatch messages originate (ralph.ts node), (2) how they flow into the chat content segments, (3) how sub-agent trees (parallel-agents-tree) are currently rendered for non-Ralph workflows, and (4) the content segment ordering/streaming mechanism — so we can replace the debug text with proper sub-agent tree components and fix rendering order.

## Summary

The Ralph DAG orchestrator emits red debugging text via `context.addMessage("system", ...)` calls in `workflow-commands.ts`. These appear as standalone `ChatMessage` objects with `role: "system"` and render in red (`themeColors.error` = `#f38ba8` Mocha Red). The core problem is that Ralph's worker sub-agents are dispatched through `SubagentGraphBridge.spawn()` which creates independent SDK sessions that **bypass** the main session's sub-agent event tracking pipeline. Non-Ralph sub-agents (spawned via the `Task` tool) integrate with the UI through SDK event subscriptions (`tool.start` → `subagent.start` → `subagent.complete`) that drive `ParallelAgentsTree` rendering via the `parallelAgents` state. Ralph's workers have no equivalent integration — their status is communicated only through disk writes to `tasks.json` (picked up by `TaskListPanel`) and the red system messages.

## Detailed Findings

### 1. Source of Red Debugging Text

**File**: `src/ui/commands/workflow-commands.ts`
**Function**: `runDAGOrchestrator()` (lines 234-408)

The DAG orchestrator uses `context.addMessage("system", ...)` at these locations:

| Line | Message                                                    | When                                      |
| ---- | ---------------------------------------------------------- | ----------------------------------------- |
| 267  | `"DAG orchestration complete: all tasks finished."`        | All tasks completed                       |
| 287  | `"Dispatching N ready task(s): #1, #2. In-flight: M"`      | Dispatch wave                             |
| 345  | `"Deadlock detected: ..."`                                 | Cycle or error-dependency deadlock        |
| 350  | `"DAG orchestration stalled: ..."`                         | No ready tasks, no in-flight, no deadlock |
| 392  | `"Task #N completed successfully. Remaining in-flight: M"` | Worker success                            |
| 396  | `"Task #N failed (attempt X/3), retrying..."`              | Worker failure with retry                 |
| 398  | `"Task #N failed after 3 attempts, marked as error."`      | Terminal failure                          |

Additional system messages from `createRalphCommand()`:

- Line 950: `"Resuming session {uuid}"` (on `--resume`)

### 2. How System Messages Flow to the Chat UI

**Data flow**:

```
workflow-commands.ts context.addMessage("system", text)
  → chat.tsx:3087  addMessage callback (useCallback)
    → createMessage("system", content) → ChatMessage { role: "system", content }
      → setMessagesWindowed(prev => [...prev, msg])
        → applyMessageWindow (50-message cap)
          → React re-render → MessageBubble
```

**Rendering**: `MessageBubble` in `chat.tsx:1720-1730`:

```tsx
// System message: inline red text (no separate header/modal)
<text wrapMode="char" style={{ fg: themeColors.error }}>
    {message.content}
</text>
```

In collapsed mode (`chat.tsx:1528-1533`):

```tsx
<text wrapMode="char" style={{ fg: themeColors.error }}>
    {truncate(message.content, 80)}
</text>
```

**Color**: `themeColors.error` = `#f38ba8` (Catppuccin Mocha Red in dark mode) defined at `src/ui/theme.tsx:226`.

System messages are rendered as standalone `ChatMessage` objects — they are **not** content segments within an assistant message. They appear as separate messages in the chat history, each rendered with red text.

### 3. How Non-Ralph Sub-Agent Trees Are Rendered

For non-Ralph workflows (e.g., `@agent` mentions, SDK `Task` tool calls), sub-agents integrate with the UI through a multi-layer event tracking system:

#### Event Pipeline (`src/ui/index.ts:subscribeToToolEvents()`)

1. **`tool.start` for Task tools** (line 507-530): Eagerly creates a `ParallelAgent` with `id: toolId`, `status: "running"`, pushes to `state.parallelAgentHandler`.

2. **`subagent.start` event** (line 780-851): Merges the eager agent — replaces temporary `toolId` with real `subagentId`, updates `name` and `task`.

3. **Sub-agent internal `tool.start` events** (line 544-560): Updates agent's `currentTool` and `toolUses`. Suppresses tool from main ToolResult UI via `subagentToolIds`.

4. **`subagent.complete` event** (line 854-888): Sets `status: "completed"` or `"error"`, clears `currentTool`, sets `durationMs`.

5. **`tool.complete` for Task tools** (line 614-723): Parses result via `parseTaskToolResult()`, correlates to agent by ID, sets `result`.

#### React State Flow (`src/ui/chat.tsx`)

1. **Handler registration** (line 2609-2616): `registerParallelAgentHandler` registers a callback that updates both `parallelAgentsRef` and `setParallelAgents()`.

2. **Message anchoring** (line 2620-2631): `useEffect` stamps current `parallelAgents` onto the streaming message's `parallelAgents` field.

3. **Content segment creation** (line 1336-1365 in `buildContentSegments`): Groups agents by their content offset (from Task tool `contentOffsetAtStart`) and creates `"agents"` type `ContentSegment` entries.

4. **Rendering** (line 1676-1692): `<ParallelAgentsTree agents={segment.agents} compact={true} maxVisible={5} />`.

#### Why Ralph Workers Don't Get This Treatment

The DAG orchestrator at `workflow-commands.ts:313-317` calls:

```typescript
const workerPromise = bridge
    .spawn({
        agentId,
        agentName: "worker",
        task: workerPrompt,
    })
    .then((result) => ({ taskId, result }));
```

`SubagentGraphBridge.spawn()` (`subagent-bridge.ts:106-178`) creates a **new independent SDK session** per worker. This session:

- Does NOT emit `tool.start`/`subagent.start`/`subagent.complete` events to the main session's event handler
- Does NOT go through the `subscribeToToolEvents()` pipeline
- Has no connection to the main session's `state.parallelAgents` array

Therefore, Ralph workers are invisible to the `ParallelAgentsTree` rendering system.

### 4. Content Segment Ordering and Streaming Mechanism

#### `buildContentSegments()` (`chat.tsx:1283-1466`)

This pure function interleaves text with tools, agents, and tasks using recorded byte offsets:

1. **Captures offsets at event time**: When tools start, `handleToolStart` (line 2102) records `msg.content.length` as `contentOffsetAtStart` on the tool call. First sub-agent tool sets `agentsContentOffset`, first TodoWrite sets `tasksContentOffset`.

2. **Creates insertion points**: For each visible tool, completed HITL, agent group, and task list, an `InsertionPoint { offset, segment, consumesText }` is created.

3. **Sorts and slices**: Insertions are sorted by offset ascending. Text is sliced between insertion offsets to produce interleaved `ContentSegment[]`.

4. **Paragraph splitting**: Text segments between non-text segments are split on `\n\n+` boundaries for proper block rendering.

#### Streaming Order

The streaming system uses:

- `streamGenerationRef` to prevent stale stream events from corrupting state
- `pendingCompleteRef` to defer stream completion when agents/tools are still active
- `parallelAgents` useEffect to continuously anchor live agents to the streaming message
- Message windowing (50-message cap) to prevent memory issues

**For Ralph**: The system messages (`context.addMessage`) create separate message objects that appear in the order they're called. They don't use the offset-based interleaving system — they're standalone messages, not segments within a streaming assistant response. This means:

- Dispatch waves appear as red text messages
- Worker completion appears as red text messages
- The `TaskListPanel` (pinned below chat) shows task status via file watcher
- Sub-agent trees never appear because workers bypass the tracking pipeline

### 5. Existing Ralph UI Components

#### TaskListPanel (`src/ui/components/task-list-panel.tsx:39-101`)

Rendered at `chat.tsx:5429-5434`, outside the scrollbox, pinned below the chat:

```tsx
{
    ralphSessionDir && (
        <TaskListPanel
            sessionDir={ralphSessionDir}
            sessionId={ralphSessionId}
            expanded={tasksExpanded}
        />
    );
}
```

Shows "Task Progress · N/M tasks" with per-task status indicators:

- `○` pending (muted)
- `●` in_progress (animated blink)
- `●` completed (green)
- `✕` error (red)
- `blockedBy` dependency indicators

Driven by `watchTasksJson()` file watcher on `tasks.json`.

#### `normalizeInterruptedTasks()` (`src/ui/utils/ralph-task-state.ts:17-25`)

Maps `in_progress` tasks to `pending` on resume/interrupt.

#### `snapshotTaskItems()` (`src/ui/utils/ralph-task-state.ts:30-40`)

Creates shallow copies of task fields for baking into completed messages.

## Code References

### Debug Text Sources

- `src/ui/commands/workflow-commands.ts:267` - Completion message
- `src/ui/commands/workflow-commands.ts:285-288` - Dispatch wave message
- `src/ui/commands/workflow-commands.ts:345` - Deadlock message
- `src/ui/commands/workflow-commands.ts:350` - Stall message
- `src/ui/commands/workflow-commands.ts:392` - Task success message
- `src/ui/commands/workflow-commands.ts:396-398` - Retry/error messages
- `src/ui/commands/workflow-commands.ts:950` - Resume message

### System Message Rendering

- `src/ui/chat.tsx:1720-1730` - Non-collapsed system message rendering (red text)
- `src/ui/chat.tsx:1528-1533` - Collapsed system message rendering (red text, truncated)
- `src/ui/theme.tsx:226` - `error: "#f38ba8"` (Mocha Red in dark theme)
- `src/ui/theme.tsx:258` - `error: "#d20f39"` (Latte Red in light theme)
- `src/ui/chat.tsx:3087-3090` - `addMessage` callback implementation

### Sub-Agent Tree Integration

- `src/ui/index.ts:507-530` - Eager ParallelAgent creation on tool.start
- `src/ui/index.ts:780-851` - Agent merge on subagent.start
- `src/ui/index.ts:854-888` - Agent completion on subagent.complete
- `src/ui/index.ts:614-723` - Result attribution on tool.complete
- `src/ui/chat.tsx:2609-2616` - parallelAgentHandler registration
- `src/ui/chat.tsx:2620-2631` - Live agent anchoring to streaming message
- `src/ui/chat.tsx:1336-1365` - Agent grouping in buildContentSegments
- `src/ui/chat.tsx:1676-1692` - ParallelAgentsTree rendering in MessageBubble

### Worker Dispatch (Bypasses UI Tracking)

- `src/ui/commands/workflow-commands.ts:311-317` - bridge.spawn() call
- `src/graph/subagent-bridge.ts:106-178` - spawn() method (independent session)
- `src/graph/subagent-bridge.ts:90-94` - SubagentGraphBridge class (createSession)

### Content Segment System

- `src/ui/chat.tsx:1268-1276` - ContentSegment type definition
- `src/ui/chat.tsx:1283-1466` - buildContentSegments function
- `src/ui/chat.tsx:2102-2163` - handleToolStart offset capture
- `src/ui/chat.tsx:2154-2156` - agentsContentOffset setting
- `src/ui/chat.tsx:2177-2184` - tasksContentOffset setting
- `src/ui/chat.tsx:1584-1592` - buildContentSegments invocation

### Task List Panel

- `src/ui/components/task-list-panel.tsx:39-101` - TaskListPanel component
- `src/ui/chat.tsx:5429-5434` - TaskListPanel render site
- `src/ui/commands/workflow-commands.ts:1026-1045` - watchTasksJson file watcher
- `src/ui/chat.tsx:1931-1934` - ralphSessionDir/Id state

### ParallelAgentsTree Component

- `src/ui/components/parallel-agents-tree.tsx:563-677` - Main component
- `src/ui/components/parallel-agents-tree.tsx:365-537` - AgentRow component
- `src/ui/components/parallel-agents-tree.tsx:252-334` - SingleAgentView component
- `src/ui/components/parallel-agents-tree.tsx:80-107` - Status icons and colors

## Architecture Documentation

### Current Architecture (As Documented)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Non-Ralph Sub-Agent Flow                      │
│                                                                  │
│  SDK Tool Call → tool.start event → subscribeToToolEvents()      │
│       → ParallelAgent created → state.parallelAgentHandler       │
│           → setParallelAgents() → useEffect stamps on message    │
│               → buildContentSegments() → ParallelAgentsTree      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Ralph Worker Flow (Current)                   │
│                                                                  │
│  runDAGOrchestrator() → bridge.spawn() → Independent Session     │
│       → NO events to main session → NO ParallelAgent tracking    │
│                                                                  │
│  Status communicated via:                                        │
│    1. context.addMessage("system", ...) → Red text in chat       │
│    2. saveTasksToActiveSession() → tasks.json → file watcher     │
│       → TaskListPanel (pinned panel below chat)                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Architectural Gap

The `SubagentGraphBridge.spawn()` creates a fully independent SDK session per worker. This session:

- Has its own streaming loop (`for await` over `session.stream()`)
- Collects tool uses and text internally
- Returns a `SubagentResult` promise
- Does NOT participate in the main session's event system

The main session's `subscribeToToolEvents()` function only sees events from tools invoked by the main SDK session's LLM. Ralph's workers are invisible because they exist in their own sessions.

### Rendering Pipeline Summary

For non-Ralph agent-spawning assistant messages:

```
Streaming text + Tool calls + Agent events
  → ContentSegments [text, tool, agents, hitl, tasks]
    → MessageBubble renders interleaved segments
      → ParallelAgentsTree for agents
      → ToolResult for tools
      → Text with ● bullets for content
```

For Ralph orchestrator output:

```
System messages (red text) + TaskListPanel (pinned)
  → Each context.addMessage("system", ...) = new ChatMessage
    → Rendered as standalone red text block
  → tasks.json updates → file watcher → TaskListPanel re-render
```

## Historical Context (from research/)

### Directly Related Research

- `research/docs/2026-02-15-ralph-dag-orchestration-implementation.md` - Ralph DAG-Based Orchestration implementation path
- `research/docs/2026-02-15-ralph-dag-orchestration-blockedby.md` - Ralph DAG with blockedBy dependency enforcement
- `research/docs/2026-02-13-ralph-task-list-ui.md` - Ralph Command Persistent Task List UI
- `research/docs/2026-02-14-subagent-output-propagation-issue.md` - Sub-Agent Output Propagation: Why Agent Tree Shows Only "Done"
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md` - TUI Layout: Streamed text positioning relative to task lists and sub-agent outputs

### Related Specs

- `specs/ralph-dag-orchestration.md` - Ralph DAG-Based Orchestration Technical Design
- `specs/ralph-task-list-ui.md` - Ralph Persistent Task List UI Technical Design
- `specs/subagent-output-propagation-fix.md` - Sub-Agent Output Propagation Fix
- `specs/tui-layout-streaming-content-ordering.md` - TUI Layout Streaming Content Ordering Fix

### Contextual Research

- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md` - SDK UI Standardization
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` - Claude Code CLI UI Patterns
- `research/docs/2026-02-13-emoji-unicode-icon-usage-catalog.md` - Emoji/Icon Usage Catalog

## Open Questions

1. **Worker-to-UI integration**: How should the DAG orchestrator's `bridge.spawn()` calls integrate with the `ParallelAgentsTree`? The bridge creates independent sessions with no event emission to the main session.

2. **System message replacement**: Should the dispatch/completion system messages be completely removed, or should some be retained as muted status lines rather than prominent red text?

3. **Streaming order with parallel workers**: When multiple workers are running in parallel and completing at different times, how should the agent tree updates be ordered within the chat flow?

4. **TaskListPanel coexistence**: The `TaskListPanel` (pinned below chat) already shows per-task status. If agent trees are added for workers, how do they relate to the panel? Should the panel remain as-is, be removed, or be redesigned?

5. **Content offset tracking for bridge-spawned agents**: The current offset system relies on `contentOffsetAtStart` from tool events. If Ralph workers don't go through the tool system, what offset mechanism would position their agent trees correctly in the content flow?
