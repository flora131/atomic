# Atomic CLI Chat System Architecture

**Document Date:** 2026-02-16  
**Focus:** Current implementation of `src/ui/chat.tsx` and related components

This document provides a comprehensive technical reference for the Atomic CLI chat system architecture. It describes how messages render, how streaming works, how sub-agents integrate, and how the layout is structured.

---

## Table of Contents

1. [Content Segment Model](#1-content-segment-model)
2. [MessageBubble Rendering](#2-messagebubble-rendering)
3. [Streaming Pipeline](#3-streaming-pipeline)
4. [Sub-agent Lifecycle Integration](#4-sub-agent-lifecycle-integration)
5. [HITL/AskUserQuestion Rendering](#5-hitlaskuserquestion-rendering)
6. [Layout Structure](#6-layout-structure)
7. [State Management](#7-state-management)
8. [Related Components](#8-related-components)

---

## 1. Content Segment Model

### `buildContentSegments()` Function

**Location:** `src/ui/chat.tsx:1287-1483`

The `buildContentSegments()` function constructs an ordered list of segments that interleave message text with tool calls, HITL questions, parallel agents, and task items at their chronologically correct positions.

#### Function Signature

```typescript
function buildContentSegments(
  content: string,
  toolCalls: MessageToolCall[],
  agents?: ParallelAgent[] | null,
  agentsOffset?: number,
  taskItems?: TaskItem[] | null,
  tasksOffset?: number,
  tasksExpanded?: boolean,
): ContentSegment[]
```

#### Segment Types

Each segment has a type:

- **`text`**: Raw message content
- **`tool`**: Tool call result display
- **`hitl`**: Completed HITL question (shown as compact inline record)
- **`agents`**: Parallel agents tree
- **`tasks`**: Task list panel (inline)

#### Offset-Based Insertion Logic

**Lines 1286-1428:**

1. **Separate HITL from regular tools** (lines 1296-1302):
   - Running/pending HITL tools are hidden (dialog handles display)
   - Completed HITL tools are rendered as `CompletedQuestionDisplay` components

2. **Build insertion point list** (lines 1304-1328):
   - Each insertion captures:
     - `offset`: Character offset in content where insertion occurs
     - `segment`: The segment to insert
     - `priority`: Type-based priority (text=0, tool=0, hitl=1, agents=2, tasks=3)
     - `sequence`: Insertion order for tie-breaking

3. **Add tool call insertions** (lines 1330-1336):
   - Use `contentOffsetAtStart` captured during `handleToolStart`

4. **Add HITL question insertions** (lines 1338-1344):
   - Only completed HITL calls (status === "completed")

5. **Add agents tree insertions** (lines 1346-1378):
   - Group agents by content offset (from Task tool calls)
   - Create separate tree for each group (supports sequential spawning)

6. **Add task list insertion** (lines 1381-1387):
   - Only when tasks exist, offset is defined, and panel is expanded

7. **Sort insertions** (lines 1389-1394):
   - Primary: offset (chronological)
   - Secondary: priority (type hierarchy)
   - Tertiary: sequence (insertion order)

#### Text Splitting

**Lines 1401-1442:**

- Slice content at insertion offsets
- Trim whitespace to prevent duplication
- Advance `lastOffset` to prevent text overlap

**Paragraph splitting** (lines 1443-1480):
- When non-text insertions exist, split interleaved text at `\n\n` boundaries
- Skip splitting inside fenced code blocks (`^````)
- Each paragraph becomes its own segment with proper bullet indicators

---

## 2. MessageBubble Rendering

### Component Overview

**Location:** `src/ui/chat.tsx:1502-1757`

The `MessageBubble` component renders a single chat message with role-based styling and interleaved content segments.

#### Rendering Flow

**Lines 1502-1757:**

1. **Collapsed mode** (lines 1509-1551):
   - Shows one-line summary per message
   - User: `➜ truncated text`
   - Assistant: `⎿ truncated text · N tools`

2. **User messages** (lines 1554-1593):
   - Highlighted inline box: `➜ message content`
   - File read confirmations below (if `filesRead` exists)

3. **Assistant messages** (lines 1596-1743):
   - Build segments via `buildContentSegments()` (lines 1605-1613)
   - Render MCP snapshot indicator (lines 1622-1626)
   - Render context info display (lines 1628-1632)

#### Segment Rendering

**Lines 1633-1723:**

For each segment:

- **Text segments** (lines 1634-1667):
  - Add bullet prefix (`●`) to first text or text following non-text segment
  - Animated blinking `●` while streaming, static colored `●` when done
  - Render as `<markdown>` if `syntaxStyle` provided, else plain `<text>`

- **Tool segments** (lines 1668-1679):
  - Render `<ToolResult>` component

- **HITL segments** (lines 1680-1686):
  - Render `<CompletedQuestionDisplay>` component

- **Agents segments** (lines 1687-1703):
  - Render `<ParallelAgentsTree>` with compact mode
  - `noTopMargin` when first or following tool/hitl

- **Tasks segments** (lines 1704-1721):
  - Render inline task list with rounded border
  - Shows `N/M tasks` progress header

#### Loading Spinner

**Lines 1726-1733:**

- Displayed at bottom when `message.streaming && !hideLoading`
- Shows elapsed time, output tokens, thinking duration
- Rendered by `<LoadingIndicator>` component (lines 931-969)

#### Completion Summary

**Lines 1735-1740:**

- Only shown when `!message.streaming && durationMs > 60_000`
- Format: `⣿ Worked for 1m 6s · ↓ 16.7k tokens · thought for 54s`
- Rendered by `<CompletionSummary>` component (lines 1009-1030)

---

## 3. Streaming Pipeline

### Chunk Flow from SDK to UI

#### Registration Phase

**Lines 2361-2377:**

Parent component registers handlers via props:
- `registerToolStartHandler` → `handleToolStart`
- `registerToolCompleteHandler` → `handleToolComplete`
- `registerSkillInvokedHandler` → `handleSkillInvoked`

#### Message Streaming Entry Points

**Three entry points:**

1. **Direct `onStreamMessage` call** (line 4903):
   - Used by `sendMessage()` for regular user input

2. **`sendSilentMessage` context method** (lines 3265-3472):
   - Used by slash commands and @mention handlers
   - Creates placeholder assistant message
   - Sets up chunk/complete/meta callbacks

3. **Workflow auto-start** (lines 2404-2510):
   - Triggered when `workflowState.workflowActive` becomes true

#### Chunk Handling

**`handleChunk` callback** (lines 3310-3328):

1. Check streaming state and generation guard (lines 3311-3313)
2. Accumulate content in `lastStreamingContentRef` (line 3315)
3. Skip rendering if `hideStreamContentRef.current` (line 3317)
4. Update message content via `setMessagesWindowed` (lines 3318-3327)

```typescript
setMessagesWindowed((prev: ChatMessage[]) =>
  prev.map((msg: ChatMessage) =>
    msg.id === messageId
      ? { ...msg, content: msg.content + chunk }
      : msg
  )
);
```

#### Tool Event Handling

**`handleToolStart`** (lines 2143-2234):

1. Update streaming state map (line 2150)
2. Set `hasRunningToolRef.current = true` (line 2152)
3. Capture `contentOffsetAtStart` as `msg.content.length` (line 2175)
4. Add tool call to message's `toolCalls` array (lines 2176-2182)
5. Capture `agentsContentOffset` on first sub-agent tool (lines 2196-2198)
6. Handle `TodoWrite` tool: normalize items, persist to tasks.json, capture `tasksContentOffset` (lines 2207-2233)

**`handleToolComplete`** (lines 2241-2347):

1. Update streaming state (lines 2249-2253)
2. Merge input if provided at completion time (lines 2265-2268)
3. Preserve HITL answer if `tc.hitlResponse` exists (lines 2269-2288)
4. Set tool status to "completed" or "error" (lines 2290-2298)
5. Update `hasRunningToolRef.current` by checking if any tools still running (lines 2304-2309)
6. Trigger deferred completion if all tools finished (lines 2311-2314)

#### Metadata Updates

**`handleMeta` callback** (lines 4897-4900 and 3466-3469):

Updates streaming metadata (tokens, thinking duration):

```typescript
const handleMeta = (meta: StreamingMeta) => {
  streamingMetaRef.current = meta;
  setStreamingMeta(meta);
};
```

Message re-renders automatically when `streamingMeta` state updates (passed as prop to `MessageBubble` at line 5291).

#### Completion Handling

**`handleComplete` callback** (lines 3330-3464):

1. **Stale generation guard** (line 3333): Skip if newer stream started
2. **Interrupt check** (line 3341): If interrupted, finalize without overwriting agents
3. **Deferred completion check** (lines 3384-3393):
   - If sub-agents or tools still running, store callback in `pendingCompleteRef`
   - Actual finalization happens when last agent/tool completes

4. **Finalize agents** (lines 3395-3434):
   - Mark running/pending agents as "completed"
   - Calculate `durationMs` from `startedAt`
   - Bake finalized agents into message's `parallelAgents` field
   - Keep background agents in live state

5. **Clear streaming state** (lines 3436-3442)
6. **Resolve streamAndWait promise** (lines 3444-3456): For slash command sync operations
7. **Dequeue next message** (lines 3458-3463): Process message queue

---

## 4. Sub-agent Lifecycle Integration

### Parallel Agent Tracking

**State:** `parallelAgents` (line 1941), `parallelAgentsRef` (line 1993)

**Registration:** Lines 2641-2650

Parent registers handler that updates both state and ref:

```typescript
registerParallelAgentHandler((agents: ParallelAgent[]) => {
  parallelAgentsRef.current = agents;
  setParallelAgents(agents);
});
```

### Anchoring to Streaming Message

**Effect:** Lines 2652-2689

1. **During streaming** (lines 2658-2668):
   - Bake agents into active streaming message via `msg.parallelAgents = parallelAgents`

2. **After stream ends** (lines 2671-2688):
   - Update baked message for background agent completions
   - Use `backgroundAgentMessageIdRef` to track which message owns background agents
   - Clear ref when all background agents reach terminal state

### Agent Content Offset Capture

**Lines 2196-2198 in `handleToolStart`:**

When first sub-agent-spawning tool (Task) starts:

```typescript
if (isSubAgentTool(toolName) && msg.agentsContentOffset === undefined) {
  updatedMsg.agentsContentOffset = msg.content.length;
}
```

This offset is used in `buildContentSegments` (line 1362) to position the agents tree chronologically.

### Deferred Completion Mechanism

**Lines 3384-3393 in `handleComplete`:**

```typescript
const hasActiveAgents = parallelAgentsRef.current.some(
  (a) => a.status === "running" || a.status === "pending"
);
if (hasActiveAgents || hasRunningToolRef.current) {
  pendingCompleteRef.current = handleComplete;
  return;
}
```

**Trigger:** Lines 2691-2706

Effect runs when `parallelAgents` changes or `toolCompletionVersion` increments:

```typescript
if (!hasActive && !hasRunningToolRef.current && pendingCompleteRef.current) {
  const complete = pendingCompleteRef.current;
  pendingCompleteRef.current = null;
  complete();
}
```

### Agent-Only Stream Finalization

**Lines 2707-2782:**

For @mention-triggered streams (no SDK `onComplete`):

1. Check if `isAgentOnlyStreamRef.current` is true
2. Finalize agents when all complete
3. Collect agent result text into message content
4. Clear streaming state
5. Dequeue next message

---

## 5. HITL/AskUserQuestion Rendering

### Question Dialog Positioning

**Fixed-position component within scrollbox** (lines 5358-5364):

```tsx
{activeQuestion && (
  <UserQuestionDialog
    question={activeQuestion}
    onAnswer={handleQuestionAnswer}
    visible={true}
  />
)}
```

The dialog is **not** an inline segment. It renders as a separate component after the message list, inside the scrollbox.

### Tool Call Rendering

**Running HITL tools are hidden** (line 1300):

```typescript
const isHitlTool = (name: string) =>
  name === "AskUserQuestion" || name === "question" || name === "ask_user";
const visibleToolCalls = toolCalls.filter(tc => !isHitlTool(tc.toolName));
```

**Completed HITL tools are rendered inline** (lines 1338-1344, 1680-1686):

- Added as `hitl` segment type
- Rendered via `<CompletedQuestionDisplay>` (lines 1210-1262)
- Shows question header, question text, and user's answer

### Answer Capture Flow

**Lines 2808-2916 in `handleQuestionAnswer`:**

1. Clear active question (line 2812)
2. Call `permissionRespondRef.current` if SDK permission request (lines 2817-2827)
3. Handle askUserNode responses (lines 2829-2851)
4. Store answer on HITL tool call (lines 2854-2887):
   - Find tool call by `activeHitlToolCallIdRef.current`
   - Merge answer into `tc.output`
   - Store `hitlResponse` record with `answerText`, `displayText`, `cancelled`, `responseMode`

5. Fallback: Insert answer as user message if no tool call found (lines 2889-2904)

### Input Capture

**Component:** `src/ui/components/user-question-dialog.tsx`

**Keyboard navigation:** Lines 140-200 (navigateUp/navigateDown)

**Answer submission:** Lines 141-161

Options are displayed as numbered list with radio buttons (single-select) or checkboxes (multi-select). Custom input is captured via textarea when "Type something" option is selected.

---

## 6. Layout Structure

### Overall Structure

**Lines 5300-5502:**

```
┌─────────────────────────────────────┐
│ AtomicHeader                        │ (lines 5308-5313)
├─────────────────────────────────────┤
│ TranscriptView (if transcriptMode)  │ (lines 5315-5324)
│                                     │
│ OR                                  │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ scrollbox (flexGrow:1, sticky)  │ │ (lines 5329-5488)
│ │ ┌─────────────────────────────┐ │ │
│ │ │ Compaction Summary (opt)    │ │ │ (lines 5345-5352)
│ │ ├─────────────────────────────┤ │ │
│ │ │ Message List                │ │ │ (lines 5264-5296)
│ │ │ - Truncation indicator      │ │ │ (lines 5267-5273)
│ │ │ - MessageBubble (each msg)  │ │ │ (lines 5281-5296)
│ │ ├─────────────────────────────┤ │ │
│ │ │ UserQuestionDialog (opt)    │ │ │ (lines 5358-5364)
│ │ ├─────────────────────────────┤ │ │
│ │ │ ModelSelectorDialog (opt)   │ │ │ (lines 5367-5375)
│ │ ├─────────────────────────────┤ │ │
│ │ │ QueueIndicator (opt)        │ │ │ (lines 5378-5392)
│ │ ├─────────────────────────────┤ │ │
│ │ │ Input Box                   │ │ │ (lines 5395-5449)
│ │ │ - Bordered textarea         │ │ │
│ │ │ - Argument hint (opt)       │ │ │ (lines 5429-5432)
│ │ │ - Scrollbar (opt)           │ │ │ (lines 5433-5448)
│ │ ├─────────────────────────────┤ │ │
│ │ │ Streaming hints (opt)       │ │ │ (lines 5451-5460)
│ │ ├─────────────────────────────┤ │ │
│ │ │ Autocomplete (opt)          │ │ │ (lines 5466-5478)
│ │ ├─────────────────────────────┤ │ │
│ │ │ Ctrl+C warning (opt)        │ │ │ (lines 5481-5487)
│ │ └─────────────────────────────┘ │ │
│ └─────────────────────────────────┘ │
│                                     │
│ TaskListPanel (if ralphSessionDir)  │ (lines 5491-5497)
└─────────────────────────────────────┘
```

### Scrollbox Setup

**Lines 5329-5343:**

- **`flexGrow: 1`**: Takes all available vertical space
- **`stickyScroll: true`**: Auto-scrolls to bottom when new content added
- **`stickyStart: "bottom"`**: Anchor point for sticky scroll
- **`scrollY: true, scrollX: false`**: Vertical scroll only
- **`viewportCulling: false`**: Render all content (for text selection)
- **`scrollAcceleration: MacOSScrollAccel`**: Smooth mouse wheel scrolling (line 2021)
- **Key prop:** `chat-window-${messageWindowEpoch}` remounts scrollbox after message eviction (line 5330)

### Pinned Panels

**Compaction Summary** (lines 5345-5352):
- Rendered when `showCompactionHistory && compactionSummary`
- Hidden when parallel agents are active
- Bordered box with rounded corners

**TaskListPanel** (lines 5491-5497):
- Positioned **outside** scrollbox (separate scroll context)
- Only shown when `ralphSessionDir && showTodoPanel`
- `flexShrink: 0` to prevent collapse
- Reads from `tasks.json` via file watcher (lines 48-64 in `task-list-panel.tsx`)

### Input Box Positioning

**Lines 5395-5449:**

Input box is **inside scrollbox**, flows with content:

- Hidden when `activeQuestion || showModelSelector`
- Bordered box with rounded corners
- Textarea has `maxHeight: 8` (line 5427)
- Optional scrollbar rendered to the right (lines 5433-5448)
- Streaming hints below input when `isStreaming` (lines 5451-5460)

---

## 7. State Management

### Core Message State

**Lines 1822-1828:**

```typescript
const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
const [trimmedMessageCount, setTrimmedMessageCount] = useState(0);
const [isStreaming, setIsStreaming] = useState(false);
const [streamingElapsedMs, setStreamingElapsedMs] = useState(0);
const [streamingMeta, setStreamingMeta] = useState<StreamingMeta | null>(null);
const [inputFocused] = useState(true);
```

**Windowed message management** (lines 2024-2058):

`setMessagesWindowed` wrapper applies `MAX_VISIBLE_MESSAGES` cap (line 869), evicting old messages to temp file buffer and incrementing `messageWindowEpoch`.

### Workflow State

**Lines 1830, 765-787:**

```typescript
const [workflowState, setWorkflowState] = useState<WorkflowChatState>(defaultWorkflowChatState);
```

Tracks autocomplete, workflow execution, approval state. Updated via `updateWorkflowState` helper (lines 2123-2125).

### Critical Refs

**Streaming refs** (lines 1979-2000):

- `streamingMessageIdRef`: Current streaming message ID
- `backgroundAgentMessageIdRef`: Message ID for background agent updates
- `streamingStartRef`: Timestamp when streaming started
- `isStreamingRef`: Synchronous copy of streaming state (avoids React state delays)
- `streamingMetaRef`: Synchronous copy of streaming metadata
- `wasInterruptedRef`: Prevents `handleComplete` from overwriting interrupted agents
- `parallelAgentsRef`: Synchronous copy of parallel agents
- `pendingCompleteRef`: Deferred `handleComplete` callback
- `isAgentOnlyStreamRef`: Tracks @mention-only streams
- `streamGenerationRef`: Incremented on each stream start (stale callback guard)
- `hasRunningToolRef`: Synchronous flag for tool completion checks

**Workflow refs** (lines 1947-1976):

- `todoItemsRef`: Synchronous copy of task items
- `ralphSessionDirRef`, `ralphSessionIdRef`: Ralph workflow state
- `lastStreamingContentRef`: Accumulates raw streaming text for parsing
- `streamCompletionResolverRef`: Resolver for `streamAndWait` promises
- `hideStreamContentRef`: Flag to hide streaming chunks from UI

**UI refs** (lines 2930, 2018, 1976):

- `textareaRef`: Textarea element for input manipulation
- `scrollboxRef`: Scrollbox for programmatic scrolling
- `savedInputRef`: Stores input when entering history mode

### Hooks

**`useStreamingState`** (line 1862):

Manages tool executions and pending questions. See [§8: Related Components](#8-related-components).

**`useMessageQueue`** (line 1865):

Manages queued messages during streaming. See [§8: Related Components](#8-related-components).

---

## 8. Related Components

### `src/ui/components/parallel-agents-tree.tsx`

**Interface:** `ParallelAgent` (lines 31-62)

```typescript
export interface ParallelAgent {
  id: string;
  taskToolCallId?: string;
  name: string;
  task: string;
  status: AgentStatus;
  model?: string;
  startedAt: string;
  durationMs?: number;
  background?: boolean;
  error?: string;
  result?: string;
  toolUses?: number;
  tokens?: number;
  currentTool?: string;
  contentOffsetAtStart?: number;
}
```

**Rendering:**

- **SingleAgentView** (lines 245-300): Inline view for single agent
- **Tree layout** (lines 302+): Hierarchical view for multiple agents
- **Status icons** (lines 85-92): Pending, running, completed, error, background, interrupted
- **Theme-aware colors** (lines 98-112): Catppuccin palette mapping

### `src/ui/components/task-list-panel.tsx`

**Props:** (lines 26-33)

```typescript
export interface TaskListPanelProps {
  sessionDir: string;
  sessionId?: string | null;
  expanded?: boolean;
}
```

**Behavior:**

- Reads `tasks.json` from `sessionDir` (lines 48-56)
- Watches file for live updates via `watchTasksJson` (lines 58-63)
- Sorts tasks topologically (line 54)
- Renders as bordered, scrollable panel (lines 78-92)
- Max height: 15 rows (line 88)

### `src/ui/components/user-question-dialog.tsx`

**Props:** (lines 39-43)

```typescript
export interface UserQuestionDialogProps {
  question: UserQuestion;
  onAnswer: (answer: QuestionAnswer) => void;
  visible?: boolean;
}
```

**Options:**

- Regular options from `question.options`
- "Type something" option (`CUSTOM_INPUT_VALUE`)
- "Chat about this" option (`CHAT_ABOUT_THIS_VALUE`)

**Navigation:**

- Arrow keys navigate options
- Enter selects highlighted option
- Tab/Shift+Tab for custom input field

### `src/ui/hooks/use-streaming-state.ts`

**Interface:** (lines 69-94)

Manages:
- `isStreaming`, `streamingMessageId`
- `toolExecutions`: Map of active tool executions
- `pendingQuestions`: Queue of HITL questions

**Methods:**

- `startStreaming`, `stopStreaming`
- `handleChunk` (pass-through)
- `handleToolStart`, `handleToolComplete`, `handleToolError`, `handleToolInterrupt`
- `addPendingQuestion`, `removePendingQuestion`

### `src/ui/hooks/use-message-queue.ts`

**Interface:** (lines 45-66)

```typescript
export interface UseMessageQueueReturn {
  queue: QueuedMessage[];
  enqueue: (content: string, options?: EnqueueMessageOptions) => void;
  dequeue: () => QueuedMessage | undefined;
  clear: () => void;
  count: number;
  currentEditIndex: number;
  setEditIndex: (index: number) => void;
  updateAt: (index: number, content: string) => void;
  moveUp: (index: number) => void;
  moveDown: (index: number) => void;
}
```

**Behavior:**

- FIFO queue for messages submitted during streaming
- Supports editing and reordering
- Warns at 50+ messages, max recommended 100

### `src/ui/tools/registry.ts`

**Tool renderers:**

- `readToolRenderer` (lines 68-160): File path + content display
- `editToolRenderer` (lines 171-200+): File path + diff display
- Additional renderers for bash, write, view, etc.

**Interface:** (lines 50-57)

```typescript
export interface ToolRenderer {
  icon: string;
  getTitle: (props: ToolRenderProps) => string;
  render: (props: ToolRenderProps) => ToolRenderResult;
}
```

### `src/ui/components/tool-result.tsx`

Renders tool calls using registry renderers. Displays:
- Tool icon and title
- Expandable/collapsible content
- Syntax highlighting for code
- Animated status indicator (running/completed/error)

---

## Key Architectural Patterns

### 1. Offset-Based Chronological Rendering

Content segments are inserted at their exact character offsets, preserving the chronological order of events during streaming. This creates an accurate timeline of what happened when.

### 2. Dual State + Ref Pattern

Critical streaming state is stored in both React state (for renders) and refs (for synchronous access in callbacks). This avoids stale closure issues and race conditions.

### 3. Deferred Completion

When sub-agents or tools are still running, `handleComplete` stores itself in `pendingCompleteRef` and returns early. An effect triggers the stored callback when all operations finish.

### 4. Generation Guard

Each stream increments `streamGenerationRef`. Callbacks check if their captured generation matches the current one, making stale callbacks no-ops. This prevents state corruption when round-robin injection happens.

### 5. Baked vs Live State

Parallel agents and task items exist in two forms:
- **Live:** Updated in real-time during streaming
- **Baked:** Frozen snapshot stored in message object on completion

This preserves history while allowing current operations to update.

### 6. Inline vs Fixed Positioning

- Tool calls, HITL questions (completed), agents trees, task lists → Inline segments
- Active HITL dialog, model selector → Fixed-position overlays within scrollbox

---

## Performance Considerations

### Message Window Capping

**Lines 869, 2024-2058:**

Only `MAX_VISIBLE_MESSAGES` (50) are kept in memory. Overflow is evicted to temp file and can be viewed via Ctrl+O transcript mode.

### Viewport Culling Disabled

**Line 5337:**

`viewportCulling: false` on scrollbox ensures all content is rendered, enabling text selection. This is acceptable because message count is capped.

### Scroll Acceleration

**Line 2021:**

`MacOSScrollAccel` provides smooth inertial scrolling for mouse wheel events.

### Remount on Eviction

**Line 5330:**

`key={chat-window-${messageWindowEpoch}}` forces scrollbox remount after message eviction, preventing stale renderables in long sessions.

---

## Error Handling

### Stale Callback Protection

**Generation guard** (lines 3333, 2428-2429, 4803):

```typescript
if (streamGenerationRef.current !== currentGeneration) return;
```

Prevents stale callbacks from corrupting state when a new stream starts.

### Interrupt Detection

**`wasInterruptedRef`** (lines 3341-3382):

When user interrupts, agents are finalized immediately. `handleComplete` checks this flag and skips agent finalization to avoid overwriting.

### Tool Running Tracking

**`hasRunningToolRef`** (lines 2008, 2152, 3390):

Synchronous flag prevents deferred completion from firing while tools are still executing.

---

## Future Considerations

This document describes the current implementation. Key extension points:

- **Content segment types**: Add new types to `buildContentSegments` (e.g., images, attachments)
- **Tool renderers**: Register new renderers in `src/ui/tools/registry.ts`
- **HITL modes**: Extend `UserQuestionDialog` for new interaction patterns
- **Streaming sources**: Add new entry points following the handleChunk/handleComplete pattern
- **Layout customization**: Adjust scrollbox/panel positioning for new UI requirements

---

## References

- Main chat component: `src/ui/chat.tsx`
- Parallel agents tree: `src/ui/components/parallel-agents-tree.tsx`
- Task list panel: `src/ui/components/task-list-panel.tsx`
- User question dialog: `src/ui/components/user-question-dialog.tsx`
- Tool result display: `src/ui/components/tool-result.tsx`
- Streaming state hook: `src/ui/hooks/use-streaming-state.ts`
- Message queue hook: `src/ui/hooks/use-message-queue.ts`
- Tool registry: `src/ui/tools/registry.ts`

---

**End of Document**
