---
date: 2026-02-17 01:43:24 UTC
researcher: Claude Opus 4.6
git_commit: dcbf84a00404a1279b60f56b344079f8a0d4dac3
branch: lavaman131/hotfix/sub-agent-display
repository: atomic
topic: "Performant message display with 50-message truncation, Ctrl+O full history, and /clear /compact dual-view reset"
tags: [research, codebase, opentui, opencode, message-windowing, truncation, ctrl-o, transcript, performance, frontend-design]
status: complete
last_updated: 2026-02-17
last_updated_by: Claude Opus 4.6
---

# Research: Message Truncation & Dual-View System

## Research Question

How should we implement a performant message display system in our OpenTUI-based TUI application that:
1. Shows only the 50 most recent messages in the active chat to prevent TUI rendering lag
2. Provides access to the complete, untruncated message history via a Ctrl+O keybinding
3. `/clear` and `/compact` both reset the main chat AND the Ctrl+O full history view (with `/compact` preserving the summary prompt)

## Summary

Atomic already implements a complete 50-message windowing system with disk-backed history for Ctrl+O transcript view. The architecture consists of three layers: (1) in-memory bounded message array capped at 50 via `applyMessageWindow`, (2) a temp-file persistence layer for evicted messages via `conversation-history-buffer.ts`, and (3) a full-screen `TranscriptView` component that merges disk history + in-memory messages for Ctrl+O. OpenCode's TUI uses a similar but simpler pattern (hard 100-message cap, no load-more), while OpenTUI provides the rendering primitives (`ScrollBox` with `viewportCulling`, `stickyScroll`) that make this performant. Both `/clear` and `/compact` already reset the history buffer correctly.

---

## Detailed Findings

### 1. Atomic: Current Message Windowing Implementation

#### 1.1 Core Constants and Functions

**`MAX_VISIBLE_MESSAGES = 50`** at `src/ui/chat.tsx:878`

This constant caps the in-memory message array. It is used by both `computeMessageWindow` and `applyMessageWindow`.

**`computeMessageWindow(messages, trimmedMessageCount, maxVisible)`** at `src/ui/utils/message-window.ts:23-34`

Computes what should be visible in the main chat and how many earlier messages are hidden:
```typescript
export function computeMessageWindow<T>(
  messages: T[],
  trimmedMessageCount: number,
  maxVisible: number
): MessageWindowResult<T> {
  const inMemoryOverflow = Math.max(0, messages.length - maxVisible);
  const visibleMessages = inMemoryOverflow > 0 ? messages.slice(-maxVisible) : messages;
  return {
    visibleMessages,
    hiddenMessageCount: trimmedMessageCount + inMemoryOverflow,
  };
}
```

**`applyMessageWindow(messages, maxVisible)`** at `src/ui/utils/message-window.ts:39-56`

Applies a hard in-memory cap by evicting oldest messages:
```typescript
export function applyMessageWindow<T>(
  messages: T[],
  maxVisible: number
): AppliedMessageWindow<T> {
  const overflowCount = Math.max(0, messages.length - maxVisible);
  if (overflowCount === 0) {
    return { inMemoryMessages: messages, evictedMessages: [], evictedCount: 0 };
  }
  return {
    inMemoryMessages: messages.slice(overflowCount),
    evictedMessages: messages.slice(0, overflowCount),
    evictedCount: overflowCount,
  };
}
```

#### 1.2 State Management in ChatApp

**`setMessagesWindowed`** at `src/ui/chat.tsx:1807-1821`

Wraps React's `setMessages` to atomically apply the window cap:
```typescript
const setMessagesWindowed = useCallback((next: React.SetStateAction<ChatMessage[]>) => {
  setMessages((prev) => {
    const nextMessages = typeof next === "function" ? next(prev) : next;
    const { inMemoryMessages, evictedMessages, evictedCount } = applyMessageWindow(
      nextMessages, MAX_VISIBLE_MESSAGES
    );
    if (evictedCount > 0) {
      pendingEvictionsRef.current.push({ messages: evictedMessages, count: evictedCount });
    }
    return inMemoryMessages;
  });
}, []);
```

**Eviction side-effect processing** at `src/ui/chat.tsx:1824-1837`

Pending evictions are flushed to disk after state commits (keeping the state updater pure):
```typescript
useEffect(() => {
  if (pendingEvictionsRef.current.length === 0) return;
  const evictions = pendingEvictionsRef.current;
  pendingEvictionsRef.current = [];
  let totalEvicted = 0;
  for (const { messages: evicted, count } of evictions) {
    appendToHistoryBuffer(evicted);
    totalEvicted += count;
  }
  if (totalEvicted > 0) {
    setTrimmedMessageCount((c) => c + totalEvicted);
    setMessageWindowEpoch((e) => e + 1);
  }
}, [messages]);
```

**Visible message rendering** at `src/ui/chat.tsx:5071-5086`

```typescript
const pendingEvictionCount = pendingEvictionsRef.current.reduce((sum, e) => sum + e.count, 0);
const { visibleMessages, hiddenMessageCount } = computeMessageWindow(
  messages, trimmedMessageCount + pendingEvictionCount
);

// Truncation indicator
{hiddenMessageCount > 0 && (
  <text style={{ fg: themeColors.muted }}>
    ↑ {hiddenMessageCount} earlier message{hiddenMessageCount !== 1 ? "s" : ""} in transcript (ctrl+o)
  </text>
)}
```

#### 1.3 Tests

**`src/ui/utils/message-window.test.ts`** verifies:
- 120 messages → last 50 visible, 70 hidden (lines 9-17)
- Previously trimmed count is included even without overflow (lines 19-25)
- `applyMessageWindow` evicts oldest correctly (lines 27-38)
- Long streaming sequence stays bounded at 50 (lines 40-57)

**`src/ui/utils/conversation-history-buffer.test.ts`** verifies:
- Evicted messages persist to buffer and full transcript is recoverable (lines 199-234)
- `/clear` resets both in-memory and buffer state (lines 236-248)
- `/compact` replaces buffer with compaction summary only (lines 250-262)
- Buffer survives clear-then-repopulate cycle (lines 264-293)

---

### 2. Atomic: Ctrl+O Transcript View

#### 2.1 Toggle Mechanism

**Ctrl+O keybinding** at `src/ui/chat.tsx:4050-4052`:
```typescript
if (event.ctrl && event.name === "o") {
  setTranscriptMode(prev => !prev);
  return;
}
```

**State**: `const [transcriptMode, setTranscriptMode] = useState(false);` at line 1647.

#### 2.2 Transcript Rendering

**TranscriptView** at `src/ui/chat.tsx:5136-5144`:
```typescript
{transcriptMode ? (
  <TranscriptView
    messages={[...readHistoryBuffer(), ...messages]}
    liveThinkingText={streamingMeta?.thinkingText}
    liveParallelAgents={parallelAgents}
    modelId={model}
    isStreaming={isStreaming}
    streamingMeta={streamingMeta}
  />
) : (/* normal chat view */)}
```

The full transcript is assembled from `readHistoryBuffer()` (disk-backed evicted messages) merged with current in-memory `messages`.

#### 2.3 TranscriptView Component

**`src/ui/components/transcript-view.tsx`** renders all messages in a single `<scrollbox>` with:
- `stickyScroll={true}`, `stickyStart="bottom"` for auto-scroll to latest
- `viewportCulling={false}` (explicitly disabled)
- `scrollY={true}`, `scrollX={false}`
- Hidden scrollbars

Messages are formatted into structured `TranscriptLine[]` via `formatTranscript()` (`src/ui/utils/transcript-formatter.ts`), which converts each `ChatMessage` into typed lines (user-prompt, thinking, tool calls, agent trees, etc.).

#### 2.4 Conversation History Buffer (Disk Persistence)

**`src/ui/utils/conversation-history-buffer.ts`**:
- **Storage**: JSON array in `/tmp/atomic-cli/history-{pid}.json` (line 16)
- **`appendToHistoryBuffer(messages)`**: Deduplicates by ID, appends new messages (lines 22-37)
- **`replaceHistoryBuffer(messages)`**: Full replacement (lines 42-49)
- **`appendCompactionSummary(summary)`**: Creates an assistant message marker (lines 55-63)
- **`readHistoryBuffer()`**: Reads full history from disk (lines 68-79)
- **`clearHistoryBuffer()`**: Writes empty array (lines 84-90)

---

### 3. Atomic: /clear and /compact Behavior

#### 3.1 /clear Command

**Definition** at `src/ui/commands/builtin-commands.ts:193-205`:
```typescript
execute: (_args, _context): CommandResult => ({
  success: true,
  clearMessages: true,
  destroySession: true,
});
```

**Handling** at `src/ui/chat.tsx:3472-3487`:
```typescript
if (result.destroySession && onResetSession) {
  void Promise.resolve(onResetSession());
  // Reset workflow state, UI state
  setCompactionSummary(null);
  setShowCompactionHistory(false);
  setParallelAgents([]);
  setTranscriptMode(false);     // Exit transcript mode
  clearHistoryBuffer();          // Clear disk-backed history
  setTrimmedMessageCount(0);     // Reset trimmed count
}
```

Then at lines 3490-3502 (`clearMessages` handler):
```typescript
if (result.clearMessages) {
  const shouldResetHistory = result.destroySession || Boolean(result.compactionSummary);
  if (shouldResetHistory) {
    clearHistoryBuffer();          // Clear history buffer
    if (result.compactionSummary) {
      appendCompactionSummary(result.compactionSummary);  // Keep summary for /compact
    }
  } else {
    appendToHistoryBuffer(messages);  // Persist current messages before clearing
  }
  setMessagesWindowed([]);
  setTrimmedMessageCount(0);
}
```

**Result**: `/clear` wipes both in-memory messages AND the disk-backed history buffer. Transcript mode is also force-exited.

#### 3.2 /compact Command

**Definition** at `src/ui/commands/builtin-commands.ts:213-245`:
```typescript
execute: async (_args, context): Promise<CommandResult> => {
  await context.session.summarize();
  return {
    success: true,
    message: "Conversation compacted (ctrl+o for history)",
    clearMessages: true,
    compactionSummary: "Conversation context was compacted to reduce token usage. Previous messages are summarized above.",
  };
}
```

**Handling**: Same `clearMessages` path, but `compactionSummary` is truthy:
1. `clearHistoryBuffer()` wipes old history
2. `appendCompactionSummary(result.compactionSummary)` adds a single summary marker
3. `setMessagesWindowed([])` clears in-memory messages
4. `setTrimmedMessageCount(0)` resets count

**Result**: `/compact` clears both views but retains a compaction summary message in the history buffer. When Ctrl+O is pressed after compact, only the summary marker appears (plus any new messages since compact).

---

### 4. OpenCode TUI: Message Display Patterns

#### 4.1 Hard 100-Message Cap

OpenCode's TUI enforces a 100-message in-memory cap.

**Initial fetch** at `packages/opencode/src/cli/cmd/tui/context/sync.tsx:464`:
```typescript
sdk.client.session.messages({ sessionID, limit: 100 })
```

**Real-time truncation** at `sync.tsx:246-264`:
```typescript
if (updated.length > 100) {
  const oldest = updated[0]
  draft.shift()           // remove oldest message
  delete draft[oldest.id] // remove its parts
}
```

No "load more" or history viewing mechanism exists in the TUI. All messages in memory are rendered in a single `<For>` loop inside a `<scrollbox>` with `stickyScroll={true}` and `stickyStart="bottom"`.

#### 4.2 OpenCode Web App: Paginated History

The web app uses a different approach:
- Initial fetch: 400 messages (`messagePageSize = 400`)
- Turn-based render window: Initially renders 20 turns, then backfills via `requestIdleCallback`
- "Load Earlier" / "Render Earlier" buttons for user-initiated history loading
- No in-memory cap (unlike TUI)

Key files:
- `packages/app/src/context/sync.tsx:108,301-330`
- `packages/app/src/pages/session.tsx:1364-1445`
- `packages/app/src/pages/session/message-timeline.tsx:274-295`

#### 4.3 /clear and /compact in OpenCode

**/clear** is aliased to `/new`. It navigates to a fresh home session without modifying the current session's data. The old session remains intact.

**/compact** (aliased `/summarize`, keybind `ctrl+x c`):
1. A `SessionCompaction.create()` inserts a compaction marker message
2. `SessionCompaction.process()` sends all messages + a compaction prompt to the LLM
3. The LLM produces a structured summary (Goal, Instructions, Discoveries, Accomplished, Relevant files)
4. After compaction, only the summary + subsequent messages are sent to the LLM
5. Auto-compaction triggers when tokens exceed context limit minus 20,000 buffer

Key files:
- `packages/opencode/src/cli/cmd/tui/app.tsx:371-391` - /clear registration
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:404-430` - /compact TUI command
- `packages/opencode/src/session/compaction.ts` - Core compaction logic

---

### 5. OpenTUI: Relevant Primitives

#### 5.1 ScrollBox Component

**File**: `docs/opentui/packages/core/src/renderables/ScrollBox.ts`

Internal structure:
```
ScrollBoxRenderable (root, flexDirection: "row")
  ├── BoxRenderable (wrapper, flexDirection: "column")
  │     ├── BoxRenderable (viewport, overflow: "hidden")
  │     │     └── ContentRenderable (content)
  │     │           └── [user children]
  │     └── ScrollBarRenderable (horizontal)
  └── ScrollBarRenderable (vertical)
```

Key properties for message display:

| Property | Default | Purpose |
|---|---|---|
| `stickyScroll` | `false` | Pin scroll to an edge; pauses on manual scroll, re-engages when user returns |
| `stickyStart` | `undefined` | Which edge to pin: `"top"`, `"bottom"`, `"left"`, `"right"` |
| `viewportCulling` | `true` | Skip rendering off-screen children (binary search O(log n)) |
| `scrollY` | `true` | Enable vertical scrolling |
| `scrollAcceleration` | `LinearScrollAccel` | Pluggable; `MacOSScrollAccel` provides velocity-based acceleration |

**Sticky scroll mechanism** (lines 87-227):
- `_hasManualScroll` flag tracks user scroll state
- Any user-initiated scroll sets `_hasManualScroll = true`
- `updateStickyState()` detects return to sticky edge and re-engages
- Programmatic scrolls are wrapped in `_isApplyingStickyScroll` guard to avoid false manual detection

#### 5.2 Viewport Culling Performance

**File**: `docs/opentui/packages/core/src/lib/objects-in-viewport.ts:25-153`

- **Short-circuit**: returns all children for < 16 elements (no filtering overhead)
- **Binary search** O(log n) to find overlapping child on primary axis
- **Backward expansion**: up to 50 elements
- **Forward expansion**: until past viewport
- **Cross-axis filtering** and z-index sort
- **Benchmarks**: 1,000 objects culled < 10ms, 10,000 < 50ms

Culled children still get `updateFromLayout()` (position computed) but skip `updateLayout()` (no rendering).

**Note**: Atomic's `TranscriptView` explicitly sets `viewportCulling={false}`. The main chat `scrollbox` does not set it explicitly (defaults to `true`).

#### 5.3 Keyboard Handling

**File**: `docs/opentui/packages/core/src/lib/KeyHandler.ts`

Two-tier dispatch:
1. **Global handlers** (registered via `useKeyboard` hook) -- fire first
2. **Internal/renderable handlers** (focused component) -- fire second if not prevented

Ctrl+O parsed from raw control character `\x0f` (ASCII 15) → `{name: "o", ctrl: true}` at `parse.keypress.ts:291-294`.

#### 5.4 Rendering Performance

- **Cell-level diffing**: Zig renderer compares current vs next buffer, only emits ANSI for changed cells
- **Double buffering**: Two `OptimizedBuffer` instances with 2MB preallocated output buffers
- **Frame throttling**: 30 FPS default, 60 FPS max for immediate re-renders
- **Synchronized updates**: `syncSet`/`syncReset` markers prevent tearing

---

### 6. Frontend Design Patterns: Atomic's Dual-View Architecture

#### 6.1 Pattern: Split-History with Disk-Backed Eviction

Atomic implements a three-tier message management system:

```
┌─────────────────────────────────────────┐
│ Layer 1: In-Memory (≤50 messages)       │
│   - React state: messages[]             │
│   - Bounded by applyMessageWindow()     │
│   - Renders in main chat scrollbox      │
├─────────────────────────────────────────┤
│ Layer 2: Disk Buffer (evicted messages) │
│   - /tmp/atomic-cli/history-{pid}.json  │
│   - appendToHistoryBuffer() on eviction │
│   - Deduplication by message ID         │
├─────────────────────────────────────────┤
│ Layer 3: Full Transcript (Ctrl+O)       │
│   - readHistoryBuffer() + messages      │
│   - Rendered in TranscriptView          │
│   - All messages, no cap                │
└─────────────────────────────────────────┘
```

#### 6.2 Pattern: Epoch-Based ScrollBox Re-keying

The main chat `scrollbox` uses `key={`chat-window-${messageWindowEpoch}`}` (`src/ui/chat.tsx:5150`). When messages are evicted, `messageWindowEpoch` increments, forcing React to destroy and recreate the scrollbox. This ensures the scroll position resets cleanly rather than showing a jump from content removal.

#### 6.3 Pattern: Pure State Updater + Deferred Side-Effects

`setMessagesWindowed` keeps the React state updater pure by deferring disk I/O (history buffer writes) and counter updates to a `useEffect` that runs after state commits. This prevents inconsistencies between render and side-effect timing.

#### 6.4 Pattern: Truncation Indicator with Affordance

The "↑ N earlier messages in transcript (ctrl+o)" text provides both information (how many hidden) and affordance (how to see them), following OpenCode's web app pattern of providing controls for history access.

---

## Code References

- `src/ui/chat.tsx:878` - `MAX_VISIBLE_MESSAGES = 50` constant
- `src/ui/chat.tsx:884-890` - `computeMessageWindow` wrapper
- `src/ui/chat.tsx:1601-1602` - Core message state (`messages`, `trimmedMessageCount`)
- `src/ui/chat.tsx:1647` - `transcriptMode` state
- `src/ui/chat.tsx:1807-1821` - `setMessagesWindowed` with atomic window cap
- `src/ui/chat.tsx:1824-1837` - Eviction side-effect processing
- `src/ui/chat.tsx:3472-3502` - `/clear` and `/compact` command handling
- `src/ui/chat.tsx:4050-4052` - Ctrl+O keybinding
- `src/ui/chat.tsx:5071-5086` - Visible message rendering + truncation indicator
- `src/ui/chat.tsx:5136-5144` - TranscriptView rendering with merged history
- `src/ui/chat.tsx:5150` - Epoch-based scrollbox re-keying
- `src/ui/utils/message-window.ts:23-56` - Core windowing logic
- `src/ui/utils/conversation-history-buffer.ts:15-90` - Disk-backed history persistence
- `src/ui/components/transcript-view.tsx:73-139` - Full transcript rendering
- `src/ui/utils/transcript-formatter.ts:79-end` - Transcript line formatting
- `src/ui/commands/builtin-commands.ts:193-245` - `/clear` and `/compact` definitions

## Architecture Documentation

### Message Flow

```
New message arrives
  → setMessagesWindowed(prev => [...prev, msg])
    → applyMessageWindow(nextMessages, 50)
      → if overflow: push to pendingEvictionsRef
      → return inMemoryMessages (≤50)
    → useEffect fires:
      → appendToHistoryBuffer(evicted)
      → setTrimmedMessageCount += evictedCount
      → setMessageWindowEpoch += 1

Render cycle:
  → computeMessageWindow(messages, trimmedCount + pendingCount)
    → visibleMessages (≤50), hiddenMessageCount
  → if hiddenMessageCount > 0: show "↑ N earlier messages" indicator
  → map visibleMessages to MessageBubble components

Ctrl+O toggle:
  → transcriptMode = !transcriptMode
  → if true: render TranscriptView with [...readHistoryBuffer(), ...messages]
  → if false: render normal chat view

/clear:
  → clearHistoryBuffer()       (wipe disk)
  → setMessagesWindowed([])    (wipe memory)
  → setTrimmedMessageCount(0)  (reset counter)
  → setTranscriptMode(false)   (exit transcript)
  → onResetSession()           (destroy session)

/compact:
  → session.summarize()        (LLM compaction)
  → clearHistoryBuffer()       (wipe disk)
  → appendCompactionSummary()  (add summary marker)
  → setMessagesWindowed([])    (wipe memory)
  → setTrimmedMessageCount(0)  (reset counter)
```

### OpenTUI ScrollBox Usage Comparison

| Property | Main Chat (chat.tsx:5149) | TranscriptView (transcript-view.tsx:94) |
|---|---|---|
| `stickyScroll` | `true` | `true` |
| `stickyStart` | `"bottom"` | `"bottom"` |
| `viewportCulling` | not set (default `true`) | `false` |
| `scrollY` | `true` | `true` |
| `scrollX` | `false` | `false` |
| Scrollbar visible | default | hidden |

### OpenCode vs Atomic Comparison

| Aspect | OpenCode TUI | Atomic |
|---|---|---|
| Message cap | 100 | 50 |
| Eviction strategy | Drop oldest, no persistence | Evict to disk, persist for Ctrl+O |
| Full history view | Not available | Ctrl+O TranscriptView |
| Truncation indicator | None | "↑ N earlier messages in transcript (ctrl+o)" |
| /clear behavior | Navigate to new session (old intact) | Destroy session + wipe all views |
| /compact behavior | LLM summarize + prune tool outputs | LLM summarize + clear both views + add summary marker |
| Auto-compaction | Yes (on overflow) | Background threshold (`BACKGROUND_COMPACTION_THRESHOLD`) |
| Render optimization | No culling (renders all in memory) | viewportCulling=true in main chat, false in transcript |

## Historical Context (from research/)

- `research/docs/2026-02-15-opentui-opencode-message-truncation-research.md` - Prior research on the same topic, confirming the 50-message cap and dual-view architecture
- `research/docs/2026-02-16-opentui-rendering-architecture.md` - Detailed OpenTUI rendering pipeline documentation
- `research/docs/2026-02-16-opencode-message-rendering-patterns.md` - OpenCode message part rendering patterns
- `research/docs/2026-02-16-opencode-tui-chat-architecture.md` - OpenCode TUI event-driven architecture and part model
- `research/docs/2026-02-01-chat-tui-parity-implementation.md` - Earlier /clear and /compact parity work
- `research/docs/2026-01-31-opentui-library-research.md` - Initial OpenTUI library research
- `research/docs/2026-01-31-opencode-implementation-analysis.md` - OpenCode implementation analysis
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md` - TUI layout and content ordering patterns

## Related Research

- `research/docs/2026-02-15-ui-inline-streaming-vs-pinned-elements.md`
- `research/docs/2026-02-16-chat-system-design-reference.md`
- `research/docs/2026-02-16-chat-system-design-ui-research.md`
- `research/docs/2026-02-09-opentui-markdown-capabilities.md`

## Open Questions

1. **TranscriptView viewportCulling**: Currently set to `false`. For very long conversation histories (hundreds of messages), enabling culling could improve Ctrl+O performance. However, the transcript renders flat `<text>` elements (not complex `MessageBubble` components), so the per-element cost is lower.

2. **History buffer size**: The disk-backed buffer has no size limit. For extremely long sessions, `readHistoryBuffer()` could load a large JSON file into memory on every Ctrl+O toggle. A streaming/paginated approach might be needed for sessions exceeding thousands of messages.

3. **Epoch re-keying trade-off**: The `messageWindowEpoch` pattern forces scrollbox destruction/recreation on every eviction batch. This ensures clean scroll state but could cause a visible flash if evictions happen during active scrolling.

---

## Dual-View State Machine

This section formalizes the state machine governing transitions between the normal chat pane and the full-screen transcript view, including how `/clear`, `/compact`, and message overflow interact with each mode.

### States

1. **`CHAT_VIEW`** — Normal chat pane. At most 50 messages are visible in the scrollbox. A truncation indicator ("N earlier messages in transcript (ctrl+o)") appears when evicted messages exist in the history buffer.

2. **`TRANSCRIPT_VIEW`** — Full-screen transcript activated via Ctrl+O. Displays the merged result of `readHistoryBuffer()` (disk-backed evicted messages) concatenated with the current in-memory `messages` array, providing a complete session history.

### Transition Table

| From | Trigger | To | Side Effects |
|---|---|---|---|
| `CHAT_VIEW` | Ctrl+O | `TRANSCRIPT_VIEW` | `readHistoryBuffer()` + merge with `messages` |
| `TRANSCRIPT_VIEW` | Ctrl+O | `CHAT_VIEW` | Release transcript data |
| `CHAT_VIEW` | `/clear` | `CHAT_VIEW` | `clearHistoryBuffer()`, `messages=[]`, `trimmedMessageCount=0`, `compactionSummary=null` |
| `TRANSCRIPT_VIEW` | `/clear` | `CHAT_VIEW` | Same as above + force exit transcript (`transcriptMode=false`) |
| `CHAT_VIEW` | `/compact` | `CHAT_VIEW` | `appendCompactionSummary(summary)`, `messages=[]`, `trimmedMessageCount=0` |
| `TRANSCRIPT_VIEW` | `/compact` | `CHAT_VIEW` | Same as above + force exit transcript |
| `CHAT_VIEW` | message overflow (>50) | `CHAT_VIEW` | `applyMessageWindow` evicts oldest to buffer, `epoch++` |

### Invariants

- **Total message conservation**: `readHistoryBuffer().length + messages.length` equals the total session message count (when no compaction has occurred).
- **After `/clear`**: `readHistoryBuffer()` returns `[]` AND `messages` is `[]`. Both views are fully wiped.
- **After `/compact`**: `readHistoryBuffer()` returns `[summary_marker]` AND `messages` is `[]`. The summary marker is the only persisted history entry.
- **`trimmedMessageCount`**: Tracks cumulative eviction count. Reset to `0` on both `/clear` and `/compact`.
- **`messageWindowEpoch`**: Increments exactly once per eviction flush cycle (i.e., per `useEffect` that processes `pendingEvictionsRef`). Forces scrollbox re-keying for clean scroll state.
- **`transcriptMode`**: Forced to `false` on `/clear` (explicit in the `/clear` handler). On `/compact`, transcript mode is only exited if the command is issued from within the transcript view.

### ASCII State Diagram

```
                    ┌─────────────────┐
                    │   CHAT_VIEW     │
        ┌──────────│  (≤50 messages)  │◄──────────┐
        │          └────────┬─────────┘           │
        │                   │                     │
        │ /clear            │ Ctrl+O              │ /clear
        │ /compact          │                     │ /compact
        │ (reset)           ▼                     │ (reset + exit)
        │          ┌─────────────────┐            │
        └──────────│ TRANSCRIPT_VIEW │────────────┘
                   │ (full history)  │
                   └────────┬────────┘
                            │
                            │ Ctrl+O
                            │ (toggle back)
                            ▼
                   ┌─────────────────┐
                   │   CHAT_VIEW     │
                   └─────────────────┘
```

### State Machine Notes

- The `CHAT_VIEW` state has an internal self-transition on message overflow: when the in-memory array exceeds 50, `applyMessageWindow` evicts the oldest messages to the disk buffer without changing the view mode. This is transparent to the user except for the truncation indicator updating.
- Ctrl+O is a pure toggle: it does not modify any message data, only switches which rendering path is active. The transcript is assembled on-demand from disk + memory.
- Both `/clear` and `/compact` are "resetting" transitions that always land in `CHAT_VIEW`, regardless of the current state. The key difference is that `/clear` destroys the session entirely (including the disk buffer), while `/compact` preserves a summary marker in the buffer for future transcript access.
