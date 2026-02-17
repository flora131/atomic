# Chat System Design Reference — Atomic CLI TUI

> **Date:** 2026-02-16  
> **Status:** Design Reference (Production-Grade)  
> **Scope:** Message rendering pipeline, part-based model, sub-agent lifecycle, HITL inline rendering, stream ordering  
> **Constraint:** Chatbox top-to-bottom streaming with bottom-pinning behavior MUST NOT change.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Message Part Model](#3-message-part-model)
4. [Rendering Pipeline](#4-rendering-pipeline)
5. [Component Composition](#5-component-composition)
6. [Sub-Agent Lifecycle](#6-sub-agent-lifecycle)
7. [Stream Ordering](#7-stream-ordering)
8. [Layout & ScrollBox](#8-layout--scrollbox)
9. [Migration Strategy](#9-migration-strategy)
10. [Appendix: Reference Patterns](#appendix-reference-patterns)

---

## 1. Executive Summary

### Current State

Atomic's chat UI uses an **offset-based segment model** (`buildContentSegments()`) that captures character offsets at tool/agent start time and slices streamed text at those positions to interleave non-text elements. This approach has three critical problems:

1. **Sub-agent tree state bugs** — Multiple finalization paths mark agents "completed" prematurely; `background` status defined in types but never assigned at runtime.
2. **Incorrect stream ordering** — `ask_question` prompts render as fixed-position dialogs instead of inline at their chronological position; sub-agent trees appear at fixed positions after all segments rather than at their actual content offset.
3. **Fragile offset arithmetic** — Character-offset-based insertion is sensitive to whitespace, concurrent tool starts, and race conditions during round-robin injection.

### Target State

Adopt a **parts-based message model** inspired by OpenCode's architecture, where each message contains an ordered array of typed `Part` objects. Each part type maps to a renderer via a registry. Parts are ordered by monotonically increasing IDs that sort lexicographically = chronologically. All content types (text, tools, sub-agents, HITL prompts) appear **inline at their correct chronological position** within the message stream.

### Non-Goals

- Changing the ScrollBox streaming direction or bottom-pinning behavior
- Changing the SDK event types or `EventDataMap`
- Modifying OpenTUI internals
- Changing the visual design language (Catppuccin theme, Unicode tree characters)

---

## 2. Architecture Overview

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Layer 1: SDK Events                       │
│  Claude (Hooks) | OpenCode (SSE) | Copilot (Session Events) │
│           ↓ normalize to unified EventType ↓                 │
│   tool.start, tool.complete, subagent.start,                │
│   subagent.complete, permission.requested,                  │
│   message.delta, message.complete, session.idle             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Layer 2: Message Store                       │
│  ChatMessage → Part[] (ordered by ascending partId)          │
│  Binary search insertion maintains sorted order              │
│  Part state machine: pending → running → completed|error     │
│  Dual state+ref pattern for stale closure protection         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                Layer 3: Component Rendering                   │
│  PART_REGISTRY dispatches Part → Renderer Component          │
│  ScrollBox: stickyScroll=true, stickyStart="bottom"          │
│  Delta rendering with viewport culling                       │
│  Throttled text rendering (100ms intervals)                  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow (End-to-End)

```
SDK Native Event
  → SDK Client normalizes fields (tool_name→toolName, etc.)
  → emitEvent(type, sessionId, data)
  → UI event handler (src/ui/index.ts)
  → Creates/updates Part in ChatMessage.parts[]
  → Binary search insertion by partId
  → React state update triggers re-render
  → MessageBubble iterates parts via <For each={parts}>
  → PART_REGISTRY[part.type] → Component
  → OpenTUI Yoga layout → terminal output
```

---

## 3. Message Part Model

### 3.1 Part Types (Discriminated Union)

Replace the current `ContentSegment` type with a discriminated union of `Part` types:

```typescript
// ─── Part ID Generation ───
// IDs encode creation timestamp for lexicographic = chronological sorting.
// Format: `part_<timestamp_hex>_<counter_hex>`
// Example: `part_0191a3b4c5d6_0001`
//
// Binary search by ID maintains sorted order without explicit sequence numbers.

type PartId = string; // Opaque, sortable string

function createPartId(): PartId {
  const timestamp = Date.now();
  const counter = globalPartCounter++;
  return `part_${timestamp.toString(16).padStart(12, "0")}_${counter.toString(16).padStart(4, "0")}`;
}

// ─── Part Type Definitions ───

interface BasePart {
  id: PartId;
  type: string;
  createdAt: string; // ISO 8601, for display only (ordering uses id)
}

interface TextPart extends BasePart {
  type: "text";
  content: string;        // Accumulated text (appended via deltas)
  isStreaming: boolean;    // True while receiving deltas
}

interface ReasoningPart extends BasePart {
  type: "reasoning";
  content: string;        // Accumulated thinking text
  durationMs: number;     // Thinking block duration
  isStreaming: boolean;
}

interface ToolPart extends BasePart {
  type: "tool";
  toolCallId: string;     // SDK-native ID for correlation
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  state: ToolState;       // Discriminated union (see §3.2)
  hitlResponse?: HitlResponseRecord; // Inline HITL answer (see §3.3)
}

interface AgentPart extends BasePart {
  type: "agent";
  agents: ParallelAgent[];  // Group of agents spawned at this point
  // Agents are grouped by the ToolPart that spawned them (Task tool)
  parentToolPartId?: PartId;
}

interface TaskListPart extends BasePart {
  type: "task-list";
  items: TaskItem[];
  expanded: boolean;
}

interface SkillLoadPart extends BasePart {
  type: "skill-load";
  skills: MessageSkillLoad[];
}

interface McpSnapshotPart extends BasePart {
  type: "mcp-snapshot";
  snapshot: McpSnapshotView;
}

interface ContextInfoPart extends BasePart {
  type: "context-info";
  info: ContextDisplayInfo;
}

interface CompactionPart extends BasePart {
  type: "compaction";
  summary: string;
}

// ─── Union Type ───

type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | AgentPart
  | TaskListPart
  | SkillLoadPart
  | McpSnapshotPart
  | ContextInfoPart
  | CompactionPart;
```

### 3.2 Tool State Machine

Replace the current flat `ToolExecutionStatus` string with a discriminated union that carries state-specific data:

```typescript
type ToolState =
  | ToolStatePending
  | ToolStateRunning
  | ToolStateCompleted
  | ToolStateError
  | ToolStateInterrupted;

interface ToolStatePending {
  status: "pending";
}

interface ToolStateRunning {
  status: "running";
  startedAt: string; // ISO 8601
}

interface ToolStateCompleted {
  status: "completed";
  output: unknown;
  durationMs: number;
}

interface ToolStateError {
  status: "error";
  error: string;
  output?: unknown;
}

interface ToolStateInterrupted {
  status: "interrupted";
  partialOutput?: unknown;
}
```

**Transition diagram:**

```
pending ──→ running ──→ completed
                    ├──→ error
                    └──→ interrupted
```

No backward transitions. Once terminal (completed/error/interrupted), state is immutable.

### 3.3 HITL as Tool Part Overlay

HITL prompts (ask_question, permission requests) are **NOT separate parts**. They are overlays on the `ToolPart` that triggered them, linked via `toolCallId`.

```typescript
// When permission.requested event arrives:
// 1. Find the ToolPart with matching toolCallId
// 2. Store the question on the ToolPart (not as a separate part)
// 3. Render the question prompt INLINE after the tool part

interface ToolPart extends BasePart {
  type: "tool";
  // ... existing fields ...

  // HITL overlay fields (set when permission.requested fires)
  pendingQuestion?: {
    requestId: string;
    header: string;
    question: string;
    options: PermissionOption[];
    multiSelect: boolean;
    respond: (answer: string | string[]) => void;
  };

  // Preserved answer after user responds
  hitlResponse?: HitlResponseRecord;
}
```

**Lifecycle:**

1. `tool.start` → ToolPart created with `state: { status: "running" }`
2. `permission.requested` → `pendingQuestion` set on matching ToolPart
3. User answers → `hitlResponse` set, `pendingQuestion` cleared
4. `tool.complete` → `state` transitions to `completed`

**Rendering:** The tool renderer checks `pendingQuestion` and `hitlResponse`:
- If `pendingQuestion` exists → render interactive `UserQuestionDialog` inline below tool
- If `hitlResponse` exists → render compact `CompletedQuestionDisplay` inline below tool
- Otherwise → render tool output only

### 3.4 ChatMessage Structure

```typescript
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: Part[];          // Ordered by part.id (ascending = chronological)
  timestamp: string;      // Message creation time
  streaming: boolean;     // True while receiving parts
  durationMs?: number;
  modelId?: string;
  wasInterrupted?: boolean;
  outputTokens?: number;
  thinkingMs?: number;
}
```

**Key changes from current `ChatMessage`:**
- `content: string` → replaced by `TextPart[]` within `parts`
- `toolCalls: MessageToolCall[]` → replaced by `ToolPart[]` within `parts`
- `parallelAgents: ParallelAgent[]` → replaced by `AgentPart[]` within `parts`
- `taskItems: TaskItem[]` → replaced by `TaskListPart[]` within `parts`
- `agentsContentOffset` / `tasksContentOffset` → eliminated (ordering via part IDs)
- `skillLoads` / `mcpSnapshot` / `contextInfo` → become parts in the array

**Getting text content:** Helper to extract accumulated text:

```typescript
function getMessageText(msg: ChatMessage): string {
  return msg.parts
    .filter((p): p is TextPart => p.type === "text")
    .map(p => p.content)
    .join("");
}
```

---

## 4. Rendering Pipeline

### 4.1 Event → Part Mapping

Each SDK event creates or updates a Part in the message's `parts[]` array.

| SDK Event | Action | Part Type |
|---|---|---|
| `message.delta` (text) | Append to active TextPart or create new | `TextPart` |
| `message.delta` (reasoning) | Append to active ReasoningPart or create new | `ReasoningPart` |
| `tool.start` | Create new ToolPart with `state: running` | `ToolPart` |
| `tool.complete` | Update existing ToolPart state → `completed\|error` | `ToolPart` |
| `permission.requested` | Set `pendingQuestion` on matching ToolPart | `ToolPart` (overlay) |
| `subagent.start` | Find/create AgentPart, add agent to `agents[]` | `AgentPart` |
| `subagent.complete` | Update agent status within AgentPart | `AgentPart` |
| `skill.invoked` | Create SkillLoadPart | `SkillLoadPart` |
| `session.idle` | Mark message `streaming: false` | — |

### 4.2 Binary Search Insertion

When a new part arrives, insert it at the correct position to maintain sorted order:

```typescript
function upsertPart(parts: Part[], newPart: Part): Part[] {
  const idx = binarySearchById(parts, newPart.id);

  if (idx >= 0) {
    // Part exists → update in place (reconcile)
    const updated = [...parts];
    updated[idx] = newPart;
    return updated;
  }

  // Part doesn't exist → insert at correct position
  const insertIdx = ~idx; // Bitwise NOT of negative index = insertion point
  const updated = [...parts];
  updated.splice(insertIdx, 0, newPart);
  return updated;
}

function binarySearchById(parts: Part[], targetId: PartId): number {
  let lo = 0;
  let hi = parts.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cmp = parts[mid].id.localeCompare(targetId);

    if (cmp === 0) return mid;       // Found
    if (cmp < 0) lo = mid + 1;       // Search right
    else hi = mid - 1;               // Search left
  }

  return ~lo; // Not found, return insertion point as negative
}
```

### 4.3 Text Delta Accumulation

Text deltas append to the most recent `TextPart` if it's still streaming, or create a new one:

```typescript
function handleTextDelta(msg: ChatMessage, delta: string): ChatMessage {
  const parts = [...msg.parts];
  const lastTextIdx = findLastIndex(parts, p => p.type === "text");

  if (lastTextIdx >= 0 && (parts[lastTextIdx] as TextPart).isStreaming) {
    // Append to existing streaming TextPart
    const textPart = parts[lastTextIdx] as TextPart;
    parts[lastTextIdx] = {
      ...textPart,
      content: textPart.content + delta,
    };
  } else {
    // Create new TextPart (e.g., text arriving after a tool completes)
    parts.push({
      id: createPartId(),
      type: "text",
      content: delta,
      isStreaming: true,
      createdAt: new Date().toISOString(),
    });
  }

  return { ...msg, parts };
}
```

**Why new TextParts after tool completion:**
When text streams, then a tool runs, then more text streams — each text segment becomes a separate `TextPart`. This naturally creates the interleaving that `buildContentSegments()` currently achieves through offset arithmetic.

```
Timeline:
  "Let me analyze..." → TextPart(id=001, content="Let me analyze...")
  [tool starts]       → ToolPart(id=002, toolName="Bash")
  [tool completes]    → ToolPart(id=002) updated: state=completed
  "The result is..."  → TextPart(id=003, content="The result is...")

Parts array: [TextPart₁, ToolPart, TextPart₂]
Renders as:  text → tool block → text  ← correct chronological order
```

### 4.4 Throttled Rendering

Text deltas arrive rapidly. Throttle re-renders to 100ms intervals:

```typescript
function useThrottledValue<T>(value: T, intervalMs: number = 100): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdateRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;

    if (elapsed >= intervalMs) {
      lastUpdateRef.current = now;
      setThrottled(value);
    } else {
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = setTimeout(() => {
        lastUpdateRef.current = Date.now();
        setThrottled(value);
        pendingRef.current = null;
      }, intervalMs - elapsed);
    }

    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, [value, intervalMs]);

  return throttled;
}
```

**Usage:** Apply to TextPart content before rendering:

```tsx
function TextPartDisplay({ part }: { part: TextPart }) {
  const throttledContent = useThrottledValue(part.content, 100);
  return <MarkdownText content={throttledContent} />;
}
```

---

## 5. Component Composition

### 5.1 Part Registry

Map each part type to its renderer component:

```typescript
type PartRenderer = (props: { part: Part; isLast: boolean }) => JSX.Element;

const PART_REGISTRY: Record<Part["type"], PartRenderer> = {
  "text":         TextPartDisplay,
  "reasoning":    ReasoningPartDisplay,
  "tool":         ToolPartDisplay,
  "agent":        AgentPartDisplay,
  "task-list":    TaskListPartDisplay,
  "skill-load":   SkillLoadPartDisplay,
  "mcp-snapshot": McpSnapshotPartDisplay,
  "context-info": ContextInfoPartDisplay,
  "compaction":   CompactionPartDisplay,
};
```

### 5.2 MessageBubble Composition

```tsx
function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <box flexDirection="column">
      {/* Message header: role, model, timestamp */}
      <MessageHeader message={message} />

      {/* Parts rendered in order */}
      {message.parts.map((part, index) => {
        const Renderer = PART_REGISTRY[part.type];
        if (!Renderer) return null;

        const isLast = index === message.parts.length - 1;
        return (
          <Renderer
            key={part.id}
            part={part}
            isLast={isLast}
          />
        );
      })}

      {/* Streaming indicator (only on last message while streaming) */}
      {message.streaming && (
        <StreamingIndicator />
      )}

      {/* Message footer: duration, tokens */}
      {!message.streaming && (
        <MessageFooter message={message} />
      )}
    </box>
  );
}
```

### 5.3 Individual Part Renderers

#### TextPartDisplay

```tsx
function TextPartDisplay({ part, isLast }: { part: TextPart; isLast: boolean }) {
  const throttledContent = useThrottledValue(part.content, 100);

  // First text part or text after non-text gets bullet prefix
  const showBullet = shouldShowBullet(part);

  return (
    <box flexDirection="column">
      {showBullet && (
        part.isStreaming
          ? <StreamingBullet /> // Animated blinking ●
          : <StaticBullet />   // Colored ●
      )}
      <MarkdownText content={throttledContent} />
    </box>
  );
}
```

#### ToolPartDisplay (with inline HITL)

```tsx
function ToolPartDisplay({ part }: { part: ToolPart }) {
  const renderer = getToolRenderer(part.toolName);
  const result = renderer.render({
    input: part.input,
    output: part.state.status === "completed" ? part.state.output : undefined,
  });

  return (
    <box flexDirection="column">
      {/* Tool header + collapsible output */}
      <ToolResult
        toolName={part.toolName}
        state={part.state}
        title={result.title}
        content={result.content}
        language={result.language}
      />

      {/* HITL: Active question prompt (inline, not a dialog) */}
      {part.pendingQuestion && (
        <UserQuestionInline
          question={part.pendingQuestion}
          onAnswer={(answer) => {
            part.pendingQuestion.respond(answer);
            // State update: clear pendingQuestion, set hitlResponse
          }}
        />
      )}

      {/* HITL: Completed question record (inline) */}
      {part.hitlResponse && !part.pendingQuestion && (
        <CompletedQuestionDisplay hitlResponse={part.hitlResponse} />
      )}
    </box>
  );
}
```

**Key change:** `UserQuestionDialog` moves from a fixed-position overlay inside the ScrollBox to an **inline component** rendered as a child of `ToolPartDisplay`. This places it at the exact chronological position where the question was asked.

#### AgentPartDisplay

```tsx
function AgentPartDisplay({ part }: { part: AgentPart }) {
  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <ParallelAgentsTree
        agents={part.agents}
        compact={!isAnyAgentActive(part.agents)}
        maxVisible={5}
      />
    </box>
  );
}

function isAnyAgentActive(agents: ParallelAgent[]): boolean {
  return agents.some(a =>
    a.status === "running" || a.status === "pending" || a.status === "background"
  );
}
```

### 5.4 HITL Rendering Modes

| Mode | Location | Trigger | Component |
|---|---|---|---|
| **Active prompt** | Inline after ToolPart | `part.pendingQuestion` is set | `UserQuestionInline` |
| **Completed record** | Inline after ToolPart | `part.hitlResponse` is set | `CompletedQuestionDisplay` |

The `UserQuestionDialog` component (keyboard-navigable option list) is **reused** inside `UserQuestionInline` but rendered inline rather than as a positioned overlay:

```tsx
function UserQuestionInline({ question, onAnswer }) {
  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={accent}
      marginTop={1}
    >
      <text bold>╭─ {question.header} ─╮</text>
      <text wrapMode="word">{question.question}</text>

      {/* Reuse existing option list with keyboard navigation */}
      <OptionList
        options={question.options}
        multiSelect={question.multiSelect}
        onSelect={onAnswer}
      />
    </box>
  );
}
```

---

## 6. Sub-Agent Lifecycle

### 6.1 State Machine

```
         ┌──────────┐
         │ pending   │ (created, not yet started)
         └─────┬─────┘
               │ subagent.start
               ▼
         ┌──────────┐
    ┌────│ running   │────┐
    │    └──────────┘     │
    │         │           │
    │  mode="background"  │ subagent.complete
    │         │           │ (success=true)
    │         ▼           ▼
    │   ┌──────────┐ ┌──────────┐
    │   │background│ │completed │
    │   └─────┬────┘ └──────────┘
    │         │
    │   subagent.complete
    │         │
    │         ▼
    │   ┌──────────┐
    │   │completed │
    │   └──────────┘
    │
    │ error / interrupt
    ▼
┌──────────┐  ┌──────────────┐
│  error   │  │ interrupted  │
└──────────┘  └──────────────┘
```

### 6.2 Status Assignment Rules

```typescript
function determineInitialAgentStatus(toolInput: Record<string, unknown>): ParallelAgentStatus {
  const mode = toolInput.mode as string | undefined;
  if (mode === "background") return "background";
  return "running";
}

function determineTerminalStatus(
  agent: ParallelAgent,
  event: SubagentCompleteEventData
): ParallelAgentStatus {
  if (!event.success) return "error";
  return "completed";
}

function shouldFinalizeOnToolComplete(agent: ParallelAgent): boolean {
  // Background agents should NOT be finalized when tool.complete fires
  // because tool.complete means "spawned", not "finished"
  if (agent.background) return false;
  if (agent.status === "background") return false;
  return true;
}
```

### 6.3 Event Handler (Corrected)

```typescript
// tool.start for Task tool
function handleTaskToolStart(event: AgentEvent<"tool.start">) {
  const input = event.data.toolInput as Record<string, unknown>;
  const mode = (input.mode as string) ?? "sync";

  const agent: ParallelAgent = {
    id: `temp_${event.data.toolUseId}`,
    taskToolCallId: event.data.toolUseId,
    name: (input.agent_type as string) ?? "task",
    task: (input.description as string) ?? "",
    status: mode === "background" ? "background" : "running",
    background: mode === "background",
    startedAt: event.timestamp,
  };

  // Create AgentPart at current position in parts array
  const agentPart: AgentPart = {
    id: createPartId(),
    type: "agent",
    agents: [agent],
    parentToolPartId: findToolPartId(event.data.toolUseId),
    createdAt: event.timestamp,
  };

  upsertPartInMessage(streamingMessageId, agentPart);
}

// tool.complete for Task tool
function handleTaskToolComplete(event: AgentEvent<"tool.complete">) {
  updateAgentInParts(streamingMessageId, event.data.toolUseId, (agent) => {
    // CRITICAL: Check background flag before finalizing
    if (!shouldFinalizeOnToolComplete(agent)) {
      return agent; // Keep current status (background)
    }
    return {
      ...agent,
      status: event.data.success ? "completed" : "error",
      result: extractResult(event.data.toolResult),
      durationMs: Date.now() - new Date(agent.startedAt).getTime(),
    };
  });
}

// subagent.complete (real completion)
function handleSubagentComplete(event: AgentEvent<"subagent.complete">) {
  updateAgentInParts(streamingMessageId, event.data.subagentId, (agent) => ({
    ...agent,
    status: determineTerminalStatus(agent, event.data),
    result: extractResult(event.data.result),
    durationMs: Date.now() - new Date(agent.startedAt).getTime(),
  }));
}
```

### 6.4 Multiple Finalization Paths (Audit)

Current codebase has 4+ paths that finalize agent status. Each MUST check `agent.background`:

| Location | Current Behavior | Required Fix |
|---|---|---|
| `tool.complete` handler | Unconditionally sets "completed" | Guard with `shouldFinalizeOnToolComplete()` |
| Stream finalization effect | Marks all running → completed | Skip agents where `background === true` |
| `handleComplete()` | Deferred completion finalizes all | Only finalize non-background agents |
| Agent-only stream finalization | Maps all running → completed | Only finalize non-background agents |

### 6.5 Deferred Completion

When SDK stream completes but agents are still running:

```typescript
function handleComplete(completionData: CompletionData) {
  const activeNonBackground = msg.parts
    .filter((p): p is AgentPart => p.type === "agent")
    .flatMap(p => p.agents)
    .some(a => a.status === "running" && !a.background);

  if (activeNonBackground) {
    // Store completion callback; will be triggered by effect
    // when all non-background agents finish
    pendingCompleteRef.current = () => finalizeMessage(completionData);
    return;
  }

  finalizeMessage(completionData);
}
```

### 6.6 Agent Group Correlation

Multiple agents spawned by the same parent message are grouped into `AgentPart` nodes by proximity:

```typescript
function getOrCreateAgentPart(
  msg: ChatMessage,
  taskToolCallId: string
): { part: AgentPart; partIndex: number } {
  // Find existing AgentPart that references this tool
  const existingIdx = msg.parts.findIndex(
    p => p.type === "agent" && p.parentToolPartId === taskToolCallId
  );

  if (existingIdx >= 0) {
    return { part: msg.parts[existingIdx] as AgentPart, partIndex: existingIdx };
  }

  // Create new AgentPart positioned after the ToolPart
  const toolPartIdx = msg.parts.findIndex(
    p => p.type === "tool" && (p as ToolPart).toolCallId === taskToolCallId
  );

  const newPart: AgentPart = {
    id: createPartId(), // Timestamp after tool start = sorts after tool
    type: "agent",
    agents: [],
    parentToolPartId: taskToolCallId,
    createdAt: new Date().toISOString(),
  };

  return { part: newPart, partIndex: toolPartIdx + 1 };
}
```

---

## 7. Stream Ordering

### 7.1 Ordering Guarantee

**Invariant:** Parts in `ChatMessage.parts[]` are always sorted by `part.id` ascending (lexicographic). Since IDs encode creation timestamps, this guarantees chronological ordering.

**Why this is better than offset-based ordering:**
- **No character arithmetic** — No need to capture `msg.content.length` at tool start
- **No race conditions** — Each part gets a unique timestamp-based ID at creation time
- **No sorting post-hoc** — Binary search insertion maintains order incrementally
- **Multiple text segments** — Text after a tool naturally becomes a new TextPart with a later ID
- **HITL is a tool overlay** — Question position comes from the ToolPart's position, not a separate offset

### 7.2 Concurrent Tool Starts

When multiple tools start simultaneously (same timestamp):

```typescript
// Counter in createPartId() ensures uniqueness even at same millisecond:
// part_0191a3b4c5d6_0001  ← first tool
// part_0191a3b4c5d6_0002  ← second tool (same ms, higher counter)
```

### 7.3 Text Splitting at Tool Boundaries

The key insight: when a tool starts during text streaming, the current TextPart is **finalized** (isStreaming → false) and a new TextPart is created after the tool completes:

```typescript
function handleToolStart(event: AgentEvent<"tool.start">) {
  // 1. Finalize current text part
  const lastTextPart = findLastStreamingTextPart(msg.parts);
  if (lastTextPart) {
    updatePart(msg, lastTextPart.id, { isStreaming: false });
  }

  // 2. Create tool part (ID > last text part ID = sorts after it)
  const toolPart: ToolPart = {
    id: createPartId(),
    type: "tool",
    toolCallId: event.data.toolUseId ?? event.data.toolCallId ?? "",
    toolName: event.data.toolName,
    input: event.data.toolInput as Record<string, unknown>,
    state: { status: "running", startedAt: event.timestamp },
    createdAt: event.timestamp,
  };

  upsertPartInMessage(msg.id, toolPart);
}

// When text resumes after tool, handleTextDelta creates a new TextPart
// because the last TextPart has isStreaming=false
```

### 7.4 Ordering Examples

**Simple tool call:**
```
parts: [
  TextPart(001, "Let me check..."),
  ToolPart(002, "Bash", state=completed),
  TextPart(003, "The file contains..."),
]
```

**Tool with HITL question:**
```
parts: [
  TextPart(001, "I need to run this command..."),
  ToolPart(002, "Bash", state=completed, hitlResponse={answer: "Yes"}),
  TextPart(003, "Done. The command output..."),
]
Renders: text → tool block → [compact HITL record] → text
```

**Multiple agents with interleaved text:**
```
parts: [
  TextPart(001, "I'll analyze this in parallel..."),
  ToolPart(002, "Task", state=completed),  // First agent spawn
  AgentPart(003, agents=[explore, analyzer]),
  ToolPart(004, "Task", state=completed),  // Second agent spawn
  AgentPart(005, agents=[debugger]),
  TextPart(006, "Based on the analysis..."),
]
Renders: text → tool → agent tree → tool → agent tree → text
```

**Background agent (still running after stream):**
```
parts: [
  TextPart(001, "Starting background task..."),
  ToolPart(002, "Task", state=completed),  // Spawn returned
  AgentPart(003, agents=[{status: "background", background: true}]),
  TextPart(004, "The task is running in the background."),
]
// AgentPart.agents[0].status stays "background" until subagent.complete
```

---

## 8. Layout & ScrollBox

### 8.1 ScrollBox Configuration (UNCHANGED)

The current ScrollBox configuration MUST be preserved:

```tsx
<scrollbox
  ref={scrollboxRef}
  flexGrow={1}
  stickyScroll={true}
  stickyStart="bottom"
  scrollY={true}
  scrollX={false}
  viewportCulling={false}     // Keep false for selectable text
  paddingLeft={1}
  paddingRight={1}
  verticalScrollbarOptions={{ visible: false }}
  horizontalScrollbarOptions={{ visible: false }}
  scrollAcceleration={scrollAcceleration}
>
```

### 8.2 Sticky Scroll Behavior (UNCHANGED)

OpenTUI's ScrollBox sticky scroll state machine:

```
Content grows → recalculateBarProps()
  → If stickyScroll && !_hasManualScroll:
    → applyStickyStart("bottom")
    → scrollPosition snaps to max
  → process.nextTick(requestRender)

User scrolls up:
  → _hasManualScroll = true
  → Sticky behavior paused

User scrolls back to bottom:
  → updateStickyState() detects scrollTop >= maxScrollTop
  → _hasManualScroll = false
  → Sticky behavior resumes
```

### 8.3 Content Layout Within ScrollBox

```tsx
<scrollbox stickyScroll={true} stickyStart="bottom">
  {/* Compaction summary (if applicable) */}
  {compactionSummary && <CompactionBanner />}

  {/* Message stream */}
  {messages.map(msg => (
    <MessageBubble key={msg.id} message={msg} />
  ))}

  {/* Active HITL dialog is now INLINE within ToolPartDisplay */}
  {/* (no longer a fixed-position overlay here) */}

  {/* Queue indicator */}
  {messageQueue.count > 0 && <QueueIndicator count={messageQueue.count} />}

  {/* Input area flows inside scrollbox */}
  <InputArea />
</scrollbox>

{/* Persistent panels OUTSIDE scrollbox (e.g., Ralph task panel) */}
{showTaskPanel && (
  <box flexShrink={0}>
    <TaskListPanel items={taskItems} />
  </box>
)}
```

### 8.4 Message Window Eviction (UNCHANGED)

The 50-message window with history buffer persistence is preserved:

```typescript
// Max 50 messages in memory
const MAX_VISIBLE_MESSAGES = 50;

// Evicted messages saved to temp file for Ctrl+O transcript
function evictOldMessages(messages: ChatMessage[]): EvictionResult {
  if (messages.length <= MAX_VISIBLE_MESSAGES) return noEviction;
  const evictCount = messages.length - MAX_VISIBLE_MESSAGES;
  return {
    kept: messages.slice(evictCount),
    evicted: messages.slice(0, evictCount),
  };
}

// Force scrollbox remount after eviction to clear stale renderables
setMessageWindowEpoch(e => e + 1);
```

---

## 9. Migration Strategy

### 9.1 Phase 1: Introduce Part Types (Non-Breaking)

1. Define all `Part` types alongside existing types
2. Add `parts: Part[]` to `ChatMessage` (optional, defaults to `[]`)
3. Add `createPartId()` utility
4. Add `binarySearchById()` and `upsertPart()` utilities
5. No rendering changes — existing `buildContentSegments()` continues to work

### 9.2 Phase 2: Populate Parts from Events

1. Modify event handlers to create Parts alongside existing state:
   - `handleChunk` → create/update TextPart
   - `handleToolStart` → create ToolPart
   - `handleToolComplete` → update ToolPart state
   - `handleSubagentStart` → create/update AgentPart
   - `handleSubagentComplete` → update agent in AgentPart
   - `handlePermissionRequest` → set `pendingQuestion` on ToolPart
2. Both `parts[]` and legacy fields (`content`, `toolCalls`, `parallelAgents`) are populated
3. Add tests comparing parts-based output vs segment-based output

### 9.3 Phase 3: Build Part Renderers

1. Create `PART_REGISTRY` and individual part renderer components
2. Build `MessageBubbleParts` component that renders from `parts[]`
3. Move `UserQuestionDialog` from overlay to inline `UserQuestionInline`
4. Feature-flag: `usePartsRendering` toggle between old and new

### 9.4 Phase 4: Fix Sub-Agent Lifecycle

1. Add `background` status assignment in `handleTaskToolStart`
2. Add `shouldFinalizeOnToolComplete()` guard to all finalization paths
3. Audit all 4+ finalization sites with the guard
4. Add tests for background agent lifecycle

### 9.5 Phase 5: Remove Legacy Code

1. Remove `buildContentSegments()`
2. Remove `ContentSegment` type
3. Remove `contentOffsetAtStart` from `MessageToolCall`
4. Remove `agentsContentOffset` / `tasksContentOffset` from `ChatMessage`
5. Remove `content: string` from `ChatMessage` (use `getMessageText()` helper)
6. Remove feature flag

### 9.6 Risk Mitigations

| Risk | Mitigation |
|---|---|
| Part ordering bugs | Binary search + monotonic IDs make ordering deterministic |
| HITL position wrong | HITL is overlaid on ToolPart, inherits its position |
| Background agent premature completion | `shouldFinalizeOnToolComplete()` guard at every finalization site |
| Performance regression | Throttled text rendering (100ms) + viewport culling available |
| Stale closure bugs | Dual state+ref pattern preserved (refs for sync access, state for renders) |
| Message window eviction | Part model is contained within ChatMessage, eviction logic unchanged |

---

## Appendix: Reference Patterns

### A.1 OpenCode Part Model (Reference Implementation)

Source: `packages/opencode/src/session/message-v2.ts`, `packages/sdk/js/src/gen/types.gen.ts`

- Parts: TextPart, ToolPart, ReasoningPart, FilePart, AgentPart, SubtaskPart, PatchPart, RetryPart, CompactionPart, StepStartPart, StepFinishPart, SnapshotPart
- IDs: `Identifier.ascending("part")` → timestamp × 0x1000 + counter in first 6 bytes
- Storage: `PartTable` in SQLite, `ORDER BY id` = chronological
- Events: `message.part.updated` via SSE → binary search insertion in SolidJS store
- Rendering: `PART_MAPPING` registry → `<Dynamic component={PART_MAPPING[part.type]}>`
- HITL: `QuestionRequest` with optional `tool` field linking to `tool.callID`
- Throttling: `createThrottledValue()` at 100ms (`TEXT_RENDER_THROTTLE_MS`)

### A.2 OpenTUI ScrollBox (Reference Implementation)

Source: `packages/core/src/components/ScrollBoxRenderable.ts`

- `stickyScroll: true` + `stickyStart: "bottom"` for auto-scroll
- `_hasManualScroll` flag distinguishes user scroll from programmatic scroll
- `_isApplyingStickyScroll` guard prevents programmatic scrolls from triggering manual scroll detection
- `recalculateBarProps()` called when content size changes → re-applies sticky if at edge
- `viewportCulling: true` for performance (O(log n + k) visible children algorithm)
- Three-pass rendering: Lifecycle → Layout Calculation → Update & Render

### A.3 OpenCode Auto-Scroll (Reference Implementation)

Source: `packages/ui/src/components/message-list.tsx`

- `createAutoScroll()` hook with ResizeObserver on content container
- 250ms window to distinguish auto-scroll from user scroll
- `scrollToBottom(false)` called on content height change when at bottom
- Momentum detection prevents fighting with user's scroll intent

### A.4 Atomic Dual State+Ref Pattern (Preserve)

Source: `src/ui/chat.tsx`

```typescript
// State for React renders
const [parallelAgents, setParallelAgents] = useState<ParallelAgent[]>([]);
// Ref for synchronous access in async callbacks
const parallelAgentsRef = useRef<ParallelAgent[]>([]);

// Always update both
function updateAgents(agents: ParallelAgent[]) {
  parallelAgentsRef.current = agents;  // Sync first
  setParallelAgents(agents);           // Then async React
}
```

This pattern MUST be preserved in the parts-based model for any state accessed in async callbacks (event handlers, deferred completion, queue processing).

### A.5 Generation Guard Pattern (Preserve)

Source: `src/ui/chat.tsx`

```typescript
const streamGenerationRef = useRef(0);

function startStream() {
  const generation = ++streamGenerationRef.current;

  return {
    isStale: () => generation !== streamGenerationRef.current,
    handleComplete: () => {
      if (generation !== streamGenerationRef.current) return; // Stale guard
      finalizeMessage();
    },
  };
}
```

This pattern prevents a `handleComplete` callback from a previous stream from corrupting the current stream's state. MUST be preserved.

### A.6 SDK Event Normalization Summary

| SDK | Native Event | Unified Event | Key Field Mapping |
|---|---|---|---|
| **Claude** | `PreToolUse` hook | `tool.start` | `tool_name` → `toolName`, `tool_input` → `toolInput` |
| **Claude** | `PostToolUse` hook | `tool.complete` | `tool_response` → `toolResult`, `success: true` |
| **Claude** | `PostToolUseFailure` hook | `tool.complete` | `error` → `error`, `success: false` |
| **Claude** | `SubagentStart` hook | `subagent.start` | `agent_id` → `subagentId`, `agent_type` → `subagentType` |
| **Claude** | `SubagentStop` hook | `subagent.complete` | `agent_id` → `subagentId`, `success: true` |
| **Claude** | `canUseTool("AskUserQuestion")` | `permission.requested` | `questions[0]` → `question`, `options`, `respond` |
| **OpenCode** | `message.part.updated` (type=tool, status=running) | `tool.start` | `part.tool` → `toolName`, `state.input` → `toolInput` |
| **OpenCode** | `message.part.updated` (type=tool, status=completed) | `tool.complete` | `state.output` → `toolResult`, `success: true` |
| **OpenCode** | `message.part.updated` (type=agent) | `subagent.start` | `part.id` → `subagentId`, `part.name` → `subagentType` |
| **OpenCode** | `message.part.updated` (type=step-finish) | `subagent.complete` | `part.id` → `subagentId` |
| **OpenCode** | `question.asked` | `permission.requested` | `questions[0]` → `question`, `respond` via `question.reply()` |
| **Copilot** | Session event (tool started) | `tool.start` | `toolName` → `toolName` |
| **Copilot** | Session event (tool completed) | `tool.complete` | `toolResult` → `toolResult` |
| **Copilot** | `subagent.started` | `subagent.start` | `subagentId` → `subagentId` |
| **Copilot** | `subagent.completed` | `subagent.complete` | `subagentId` → `subagentId` |

### A.7 Color Semantics (Catppuccin Theme)

| Status | Color | Hex (Dark) | Usage |
|---|---|---|---|
| Running | Blue | `#89b4fa` | Active tool, streaming text bullet |
| Completed | Green | `#a6e3a1` | Finished tool, completed agent |
| Error | Red | `#f38ba8` | Failed tool, failed agent |
| Interrupted | Yellow | `#f9e2af` | User-cancelled tool/agent |
| Pending | Grey (Surface1) | `#585b70` | Queued, waiting |
| Background | Grey (Overlay0) | `#6c7086` | Detached background agent |
| Accent | Teal | `#94e2d5` | HITL prompts, highlights |
| Muted | Overlay0 | `#6c7086` | Timestamps, descriptions |

### A.8 Agent Status Icons

| Status | Icon | Description |
|---|---|---|
| Pending | `○` | Empty circle |
| Running | `◐` | Half-filled (animated blink) |
| Completed | `●` | Filled circle (green) |
| Error | `✕` | Cross mark (red) |
| Interrupted | `●` | Filled circle (yellow) |
| Background | `⧈` | Squared dot (grey) |

---

## Summary of Key Decisions

1. **Parts replace segments** — Ordered `Part[]` array with timestamp-encoded IDs replaces offset-based `buildContentSegments()`
2. **HITL is a tool overlay** — Questions render inline after their ToolPart, not as fixed-position dialogs
3. **Background agents have distinct lifecycle** — `shouldFinalizeOnToolComplete()` guard at every finalization path
4. **Text splits naturally** — New TextPart created after each tool boundary, eliminating offset arithmetic
5. **Binary search maintains order** — Incremental insertion, no full re-sort
6. **Throttled rendering** — 100ms debounce on TextPart content prevents UI thrashing
7. **ScrollBox untouched** — `stickyScroll=true, stickyStart="bottom"` preserved exactly
8. **Dual state+ref pattern preserved** — Critical for stale closure protection in async event handlers
9. **Generation guards preserved** — Prevent cross-stream state corruption
10. **Part registry for extensibility** — New part types added by registering in `PART_REGISTRY`
