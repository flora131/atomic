---
date: 2026-02-12 20:00:22 UTC
researcher: Copilot
git_commit: 3f7bd84851507887010cc9b7c468ab630aa92c42
branch: lavaman131/hotfix/tool-ui
repository: atomic
topic: "TUI Layout: How streamed text is positioned relative to task lists and sub-agent outputs"
tags: [research, codebase, tui, layout, streaming, content-ordering, task-list, sub-agent, chat]
status: complete
last_updated: 2026-02-12
last_updated_by: Copilot
---

# Research: TUI Layout & Content Ordering After Task Lists / Sub-Agents

## Research Question

How does the Atomic TUI currently handle layout positioning and content streaming when task lists and sub-agent outputs complete? Specifically: What is the rendering flow that causes new streamed text to appear BEFORE (above) completed task/sub-agent output instead of AFTER (below) it, and what components control this ordering?

## Summary

The Atomic TUI uses a **content-offset-based segmentation system** to interleave text and tool outputs. When a tool call starts, the system captures the current character length of `message.content` as `contentOffsetAtStart`. The `buildContentSegments()` function (in `chat.tsx:1140-1198`) then slices the accumulated content string at these offsets to produce an ordered array of `ContentSegment` objects (text and tool blocks). These segments are rendered top-to-bottom in chronological order.

**The core issue**: Task lists (`TaskListIndicator`) and parallel agent trees (`ParallelAgentsTree`) are rendered **outside** the interleaved segment list — they are placed at fixed positions at the **bottom** of the message bubble (after all segments, after the spinner). Meanwhile, new streamed text is appended to `message.content` and gets sliced into segments that render **above** these fixed-position components. This means when text streams in after a task list or sub-agent tree is shown, the new text appears in the segments area (above), while the task list / agent tree stays pinned below.

## Detailed Findings

### 1. Message Data Model

**File**: `src/ui/chat.tsx:402-470`

The `ChatMessage` interface holds both streamed content and structured metadata:

```typescript
interface ChatMessage {
  content: string;                    // Accumulated streamed text
  toolCalls?: MessageToolCall[];      // Tool calls with offset tracking
  parallelAgents?: ParallelAgent[];   // Baked agent data (post-completion)
  taskItems?: Array<{...}>;           // Baked task items (post-completion)
  streaming?: boolean;                // Live streaming flag
  // ...
}
```

The `MessageToolCall` interface includes the critical positioning field:

```typescript
interface MessageToolCall {
  contentOffsetAtStart?: number;  // Character index in content when tool started
  // ...
}
```

### 2. Content Offset Capture

**File**: `src/ui/chat.tsx:1775-1787`

When a tool starts, `handleToolStart` captures the current content length:

```typescript
const contentOffsetAtStart = msg.content.length;
const newToolCall: MessageToolCall = {
  id: toolId,
  toolName,
  input,
  status: "running",
  contentOffsetAtStart,
};
```

This offset is **immutable** — it never changes after capture. It marks "where in the text stream this tool call occurred."

### 3. Content Segmentation (buildContentSegments)

**File**: `src/ui/chat.tsx:1140-1198`

The `buildContentSegments()` function:

1. Filters out HITL tools (AskUserQuestion, question, ask_user)
2. Sorts tool calls by `contentOffsetAtStart` ascending
3. For each tool call, slices text from `lastOffset` to `tool.contentOffsetAtStart` → creates a text segment
4. Inserts the tool call as a tool segment
5. Appends remaining text after the last tool call

**Result**: A linear array of `ContentSegment[]` alternating between text and tool blocks, ordered chronologically.

### 4. MessageBubble Rendering Order

**File**: `src/ui/chat.tsx:1314-1442`

The `MessageBubble` component renders assistant messages in this fixed top-to-bottom order:

| Order | Component                | Source                                           | Position       |
| ----- | ------------------------ | ------------------------------------------------ | -------------- |
| 1     | Skill load indicators    | `message.skillLoads`                             | Top            |
| 2     | MCP server list          | `message.mcpServers`                             | Top            |
| 3     | Context info display     | `message.contextInfo`                            | Top            |
| 4     | **Interleaved segments** | `buildContentSegments()`                         | Middle         |
| 5     | **Parallel agents tree** | `parallelAgents` prop / `message.parallelAgents` | Below segments |
| 6     | **Loading spinner**      | During `message.streaming`                       | Below agents   |
| 7     | **Task list indicator**  | `todoItems` / `message.taskItems`                | Below spinner  |
| 8     | Completion summary       | After streaming, if > 60s                        | Bottom         |

**Key observation**: Items 5-7 (parallel agents, spinner, task list) are rendered at **fixed positions below all content segments**. They are not part of the interleaved segment array.

### 5. The Root Cause of the Layout Issue

The content ordering problem stems from the separation between:

- **Interleaved segments** (items rendered via `buildContentSegments()`) — text + tool blocks that maintain chronological order based on content offsets
- **Fixed-position components** (parallel agents tree, spinner, task list) — always rendered below ALL segments

**Scenario that causes the issue:**

```
Time 0: Stream starts, empty content
Time 1: Text "Let me analyze this..." streams → segment area
Time 2: Tool "Task" starts (sub-agent spawned) → captured at offset 22
Time 3: ParallelAgentsTree appears below segments (fixed position)
Time 4: TaskListIndicator appears below spinner (fixed position)
Time 5: Sub-agent completes → ParallelAgentsTree updates in-place
Time 6: Text "Based on the results..." streams → appended to content
```

At Time 6, the new text gets sliced by `buildContentSegments()` into a segment that appears in the **segments area** (position 4 in the table). But the parallel agents tree is at position 5, and the task list is at position 7. So visually:

```
● Let me analyze this...          ← Text segment (before tool offset)
  ● Task (sub-agent)              ← Tool segment (at offset 22)
  Based on the results...         ← Text segment (AFTER offset 22, but ABOVE agents tree!)
  ◉ explore(Find files)           ← Parallel agents tree (FIXED position 5)
  ⣷ Thinking...                   ← Spinner (FIXED position 6)
  ☑ 3 tasks (1 done, 2 open)     ← Task list (FIXED position 7)
```

The text "Based on the results..." appears **above** the agents tree because it's part of the segments, while the agents tree is a fixed-position component rendered after all segments.

**However**, if the `Task` tool itself appears in `toolCalls` (which it does for inline task tools), the tool block would be in the segments. The issue is specifically with `ParallelAgentsTree` and `TaskListIndicator` which are NOT in the segments — they are separate UI components.

### 6. How ParallelAgentsTree is Managed

**File**: `src/ui/chat.tsx:1400-1416`

During streaming, the tree shows live agent data from the `parallelAgents` prop. After completion, it shows baked data from `message.parallelAgents`. It is always rendered at a fixed position after all content segments.

**File**: `src/ui/components/parallel-agents-tree.tsx`

The component renders a tree visualization with status indicators:
- Running: blinking `●` with current tool activity
- Completed: green `●` with summary (tool uses, tokens, duration)
- Error: red `✕` with error message

### 7. How TaskListIndicator is Managed

**File**: `src/ui/chat.tsx:1427-1433`

During streaming: rendered from `todoItems` state (updated via `handleToolStart` when `TodoWrite` is called).
After completion: rendered from `message.taskItems` (baked on completion).

Always positioned below the spinner, which is below all segments.

**File**: `src/ui/components/task-list-indicator.tsx:73-121`

Renders task items with tree-style connectors (`⎿`) and status icons.

### 8. Streaming Chunk Handling

**File**: `src/ui/chat.tsx:4154-4168`

Text chunks are appended via direct string concatenation:

```typescript
const handleChunk = (chunk: string) => {
  setMessages((prev) =>
    prev.map((msg) =>
      msg.id === messageId && msg.streaming
        ? { ...msg, content: msg.content + chunk }
        : msg
    )
  );
};
```

Each chunk triggers a React re-render, which re-runs `buildContentSegments()`, re-slicing the content at the fixed tool offsets. New text always appears after the last tool's offset as a trailing text segment.

### 9. OpenTUI Layout Engine

**Source**: OpenTUI repo (`anomalyco/opentui`)

OpenTUI uses the **Yoga layout engine** (Facebook's Flexbox implementation) for terminal UIs.

Key layout capabilities:
- `<box flexDirection="column">` — children stack vertically
- `<scrollbox stickyScroll={true} stickyStart="bottom">` — auto-scrolls to bottom
- Automatic reflow when child dimensions change
- Delta rendering for efficient terminal updates

The `<scrollbox>` in chat.tsx uses `stickyScroll={true}` and `stickyStart="bottom"` to keep the viewport at the bottom during streaming.

### 10. SDK Event Processing

Each SDK (Claude, OpenCode, Copilot) produces events that map to unified UI events:

- `message.delta` → text chunk → appended to `message.content`
- `tool.start` → captures `contentOffsetAtStart`, adds to `toolCalls`
- `tool.complete` → updates tool status/output in-place (no position change)

**Claude SDK** (`src/sdk/claude-client.ts:497-558`): Yields `text_delta` events incrementally.
**OpenCode SDK** (`src/sdk/opencode-client.ts:455-523`): Uses `message.part.updated` with part types.

## Code References

- `src/ui/chat.tsx:1129-1198` — `ContentSegment` interface and `buildContentSegments()` function
- `src/ui/chat.tsx:1217-1445` — `MessageBubble` component with full rendering order
- `src/ui/chat.tsx:1351-1398` — Segment iteration and rendering
- `src/ui/chat.tsx:1400-1416` — ParallelAgentsTree fixed position rendering
- `src/ui/chat.tsx:1418-1433` — Spinner and TaskListIndicator fixed position rendering
- `src/ui/chat.tsx:1775-1787` — Content offset capture in `handleToolStart`
- `src/ui/chat.tsx:4154-4168` — Chunk handling (content concatenation)
- `src/ui/components/parallel-agents-tree.tsx` — Sub-agent tree visualization
- `src/ui/components/task-list-indicator.tsx` — Task list rendering
- `src/ui/components/tool-result.tsx` — Tool output display with collapsibility
- `src/ui/tools/registry.ts` — Tool renderer registry (12+ specialized renderers)
- `src/ui/hooks/use-streaming-state.ts` — Streaming state management hook
- `src/sdk/claude-client.ts:497-558` — Claude SDK event processing
- `src/sdk/opencode-client.ts:455-523` — OpenCode SDK event processing

## Architecture Documentation

### Current Content Ordering Architecture

The system has **two separate content channels**:

1. **Interleaved Segments Channel**: Text and tool-call blocks ordered by `contentOffsetAtStart`. These are dynamically positioned based on when they occurred in the stream.

2. **Fixed-Position Components Channel**: ParallelAgentsTree, LoadingIndicator, and TaskListIndicator. These always appear after all segments, regardless of when they were created or updated.

This dual-channel approach means:
- Tool calls (read, write, bash, grep, etc.) correctly interleave with text
- But "meta" components (agent trees, task lists) are always at the bottom
- Post-completion text that streams after these meta components appears above them (in the segments channel)

### Rendering Pipeline

```
SDK Events → handleChunk/handleToolStart/handleToolComplete
  → ChatMessage state updates (content string, toolCalls array)
  → React re-render
  → buildContentSegments(content, toolCalls)
  → MessageBubble renders: [segments...] + [agents] + [spinner] + [tasks]
  → OpenTUI Yoga layout → terminal output
```

## Historical Context (from research/)

- `research/docs/2026-02-01-chat-tui-parity-implementation.md` — Chat TUI parity implementation progress
- `research/docs/2026-01-31-opentui-library-research.md` — OpenTUI library research and capabilities
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md` — SDK UI standardization modeling Atomic TUI after Claude Code design
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` — Sub-agent UI with OpenTUI and independent context windows
- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` — Sub-agent SDK integration analysis
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` — Claude Code CLI UI patterns for Atomic TUI (message queuing, autocomplete, timing display, collapsible outputs)
- `research/docs/2026-01-19-cli-ordering-fix.md` — Prior fix for banner and intro text ordering
- `research/docs/2026-02-09-opentui-markdown-capabilities.md` — OpenTUI markdown rendering capabilities
- `research/docs/2026-02-09-token-count-thinking-timer-bugs.md` — Streaming metadata pipeline audit
- `research/tickets/2026-02-09-171-markdown-rendering-tui.md` — Markdown rendering for TUI (Issue #171)

## Related Research

- `research/docs/2026-02-12-sdk-ui-standardization-research.md` — Standardizing UI across coding agent SDKs
- `research/docs/2026-02-12-opencode-tui-empty-file-fix-ui-consistency.md` — OpenCode TUI UI consistency fixes

## Open Questions

1. **Should ParallelAgentsTree and TaskListIndicator become part of the interleaved segments?** They would need their own `contentOffsetAtStart` values to position correctly within the text/tool stream.

2. **How does Claude Code handle this same scenario?** Claude Code's CLI also shows sub-agent trees and task lists — does it interleave them with text or keep them fixed?

3. **What happens with multiple sequential tool calls that each spawn sub-agents?** Do the agents from different tool calls all merge into a single tree at the bottom, or should each appear near its spawning tool call?

4. **Should the task list be treated as a tool segment?** The `TodoWrite` tool already appears in `toolCalls` — the `TaskListIndicator` is an additional "live" view. Should it be unified with the tool segment rendering?

5. **Does collapsing a completed task list/agent tree after completion affect the visual flow?** If these components shrink on completion, does content below them shift up unexpectedly?
