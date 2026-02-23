---
date: 2026-02-23 04:03:35 UTC
researcher: Copilot
git_commit: 938f157b0b6c9135ff9d010b698d80e09f9c7db9
branch: fix/tui-streaming-rendering
repository: fix-tui-streaming-rendering
topic: "Background agents SDK event pipeline — why OpenCode/Copilot show no UI and Claude layout is incorrect"
tags: [research, codebase, background-agents, issue-258, sdk, event-pipeline, parallel-agents, opencode, copilot, claude, ui-layout]
status: complete
last_updated: 2026-02-23
last_updated_by: Copilot
---

# Research: Background Agents SDK Event Pipeline (#258)

## Research Question

Investigate why background agents fail to render UI for OpenCode SDK and Copilot SDK (no UI at all), and why Claude Agent SDK's background agent UI has incorrect layout in the chatbox and tree view. For each SDK, trace the event pipeline from agent creation → stream events → message parts → UI rendering to identify where the data flow breaks or diverges.

## Summary

The background agent UI rendering depends on a multi-stage pipeline: **SDK events → UI integration state → ChatApp parallelAgents state → synthetic `parallel-agents` stream events → message parts → ParallelAgentsTree component**. Each SDK has different issues:

1. **Claude Agent SDK**: The pipeline works end-to-end. Background agents render. The layout issue is in how `ParallelAgentsTree` is embedded within `MessageBubbleParts` (inside the scrollbox) while `BackgroundAgentFooter` sits outside as a sibling — both render but the tree placement within message parts and the chatbox layout interaction needs investigation at the rendering level.

2. **OpenCode SDK**: The SDK properly emits `subagent.start` and `subagent.complete` events. The UI integration layer at `src/ui/index.ts` handles these events identically to Claude. The pipeline architecture is the same — the issue likely lies in whether OpenCode's native SDK actually fires these events during background agent execution, or whether the event data format differs in practice.

3. **Copilot SDK**: **Root cause identified.** Copilot uses native `customAgents` config instead of a `Task` tool. The UI integration layer's eager agent creation (`src/ui/index.ts:641-676`) depends on detecting `tool.start` events with `toolName === "Task"`, which Copilot never emits. Without eager agent creation, the `parallelAgentHandler` callback is never invoked with initial agent data, and no `parallel-agents` events are generated. The `subagent.start` events DO fire, but the correlation logic at `src/ui/index.ts:1053-1058` depends on `pendingTaskEntries` which are only populated by Task tool starts.

## Detailed Findings

### 1. Shared UI Architecture: Event Pipeline End-to-End

The pipeline has 6 stages that must all succeed for background agents to render:

```
Stage 1: SDK Client emits tool.start / subagent.start / subagent.complete events
    ↓
Stage 2: UI Integration (src/ui/index.ts) creates/updates ParallelAgent objects in state.parallelAgents
    ↓
Stage 3: UI Integration calls state.parallelAgentHandler(state.parallelAgents) callback
    ↓
Stage 4: ChatApp (src/ui/chat.tsx) receives agents, applies synthetic parallel-agents event
    ↓
Stage 5: Stream pipeline (src/ui/parts/stream-pipeline.ts) merges agents into AgentPart objects
    ↓
Stage 6: ParallelAgentsTree component renders the agent tree
```

#### Stage 1: SDK Event Emission

Each SDK emits unified events via the `EventEmitter` base class (`src/sdk/base-client.ts:32`):

| Event | Claude Source | OpenCode Source | Copilot Source |
|-------|-------------|----------------|----------------|
| `tool.start` | `PreToolUse` hook (`claude.ts:1421`) | `message.part.updated` SSE with `part.type === "tool"` (`opencode.ts:679`) | `tool.execution_start` (`copilot.ts:595`) |
| `tool.complete` | `PostToolUse` hook (`claude.ts:1428`) | `message.part.updated` SSE with status `"completed"` (`opencode.ts:686`) | `tool.execution_complete` (`copilot.ts:613`) |
| `subagent.start` | `SubagentStart` hook (`claude.ts:1441`) | `message.part.updated` SSE with `part.type === "agent"/"subtask"` (`opencode.ts:710-733`) | `subagent.started` native event (`copilot.ts:627`) |
| `subagent.complete` | `SubagentStop` hook (`claude.ts:1447`) | `message.part.updated` SSE with `part.type === "step-finish"` (`opencode.ts:734`) | `subagent.completed` native event (`copilot.ts:639`) |

#### Stage 2: UI Integration — Agent Creation (`src/ui/index.ts`)

**Two-path agent creation:**

**Path A — Eager (Task tool detection, lines 638-730):**
- Triggered by `tool.start` events where `toolName === "Task"` or `"task"` (line 588)
- Extracts `run_in_background` from tool input (line 644)
- Creates `ParallelAgent` immediately with `status: "background"` or `"running"` (line 672)
- Stores in `pendingTaskEntries` queue for later correlation (line 645)
- **This path provides immediate UI feedback before `subagent.start` fires**

**Path B — Subagent.start correlation (lines 1028-1164):**
- Triggered by `subagent.start` events
- Attempts to correlate with pending Task entry from Path A (lines 1053-1058)
- If eager agent exists: merges real `subagentId` into it (lines 1102-1115)
- If no eager agent: creates new `ParallelAgent` from scratch (lines 1135-1150)
- Background flag extracted from pending entry or fallback input (line 1091-1092)

#### Stage 3: Handler Callback

- Registered at `src/ui/index.ts:1814-1816`
- ChatApp registers via `setParallelAgentsHandler` prop
- Invoked with full `state.parallelAgents` array after every mutation

#### Stage 4: ChatApp State Update (`src/ui/chat.tsx`)

- `parallelAgents` state at line 1856
- `parallelAgentsRef` sync ref at line 1935
- During streaming: applies `parallel-agents` event to active message (lines 2791-2806)
- After streaming: applies to background message via `backgroundAgentMessageIdRef` (lines 2809-2832)

#### Stage 5: Stream Pipeline (`src/ui/parts/stream-pipeline.ts`)

- `applyStreamPartEvent()` at line 812 handles `parallel-agents` case (lines 863-877)
- `mergeParallelAgentsIntoParts()` at line 637 creates `AgentPart` objects
- Groups agents by `taskToolCallId` or consolidates into single tree

#### Stage 6: Rendering

- `PART_REGISTRY["agent"]` maps to `AgentPartDisplay` (`src/ui/components/parts/registry.tsx:26`)
- `AgentPartDisplay` wraps `ParallelAgentsTree` (`src/ui/components/parts/agent-part-display.tsx:24`)
- `BackgroundAgentFooter` renders at bottom of chat layout (`src/ui/chat.tsx:5996`)

---

### 2. Claude Agent SDK — Working Pipeline, Layout Issues

#### Event Flow (Working)

1. Model calls Task tool → Claude SDK fires `PreToolUse` hook → `tool.start` event emitted
2. UI integration detects `toolName === "Task"` → creates eager `ParallelAgent` with `background: true`
3. Claude SDK fires `SubagentStart` hook → `subagent.start` event → merges with eager agent
4. `parallelAgentHandler` callback → ChatApp updates state → `parallel-agents` synthetic event applied
5. Stream pipeline creates `AgentPart` → `ParallelAgentsTree` renders

**Key Claude-specific details:**
- Hook callbacks provide `agent_id`, `agent_type`, `toolUseID` for correlation (`claude.ts:1441-1450`)
- Session ID resolution via `resolveHookSessionId()` handles SDK → wrapped ID mapping (`claude.ts:1257-1285`)
- Post-stream background agent continuation works via guard at `src/ui/index.ts:1186-1191`

#### Layout Architecture (Current State)

The chat app layout hierarchy:

```
Root Box (100% height, column) — src/ui/chat.tsx:5779
├── AtomicHeader (flexShrink={0})
├── [Chat Mode]:
│   └── Box (flexGrow={1}, column)
│       └── Scrollbox (flexGrow={1}, stickyScroll, paddingLeft/Right={1})
│           ├── Messages Array
│           │   └── MessageBubble (paddingLeft/Right={1}, marginBottom={1})
│           │       └── MessageBubbleParts (column, gap={1})
│           │           └── AgentPartDisplay (column)
│           │               └── ParallelAgentsTree (paddingLeft={1})
│           ├── Input Area (textarea + hints)
│           ├── Ctrl+F warning (line 5985)
│           └── ...
└── BackgroundAgentFooter (flexShrink={0}) — line 5996
```

**Layout observations:**
- `ParallelAgentsTree` is embedded inside message parts within the scrollbox
- `BackgroundAgentFooter` is a sibling to the scrollbox wrapper, at the bottom
- The input area is INSIDE the scrollbox (lines 5876+), not below it
- Ctrl+F warning text is rendered inside scrollbox (line 5985)
- Tree uses `paddingLeft={SPACING.CONTAINER_PAD}` (1 cell) and conditional `marginTop`
- `AgentPartDisplay` passes `noTopMargin` to tree, relying on parent `gap` for spacing

**Chatbox layout context:**
- The footer is at line 5996, AFTER the scrollbox closing tag
- Footer uses `flexShrink={0}` to maintain its single-line height
- Scrollbox uses `flexGrow={1}` to take remaining space
- `FooterStatus` component exists (`src/ui/components/footer-status.tsx:99`) but is NOT mounted — only `BackgroundAgentFooter` is used

---

### 3. OpenCode SDK — Event Pipeline Analysis

#### Event Emission (Documented)

OpenCode client maps SDK events to unified events via `handleSdkEvent()` (`opencode.ts:599-750`):

- `part.type === "agent"` → `subagent.start` with `{ subagentId: part.id, subagentType: part.name }` (lines 710-716)
- `part.type === "subtask"` → `subagent.start` with `{ subagentId: part.id, subagentType: part.agent, task: part.description }` (lines 717-733)
- `part.type === "step-finish"` → `subagent.complete` with `{ subagentId: part.id, success, result }` (lines 734-742)
- `part.type === "tool"` with `status === "pending"/"running"` → `tool.start` (line 679)
- `part.type === "tool"` with `status === "completed"` → `tool.complete` (line 686)

**Task tool detection path:**
- The UI integration at `src/ui/index.ts:588` checks `data.toolName === "Task"` or `"task"`
- OpenCode SDK's `tool.start` events include `toolName` from `part.name` field
- If OpenCode's model invokes a tool named "Task", the eager agent creation path (lines 641-676) is triggered
- The `run_in_background` flag is read from `toolInput` (line 644)

**Two OpenCode part variants for sub-agents:**

| Variant | Part Type | Fields | Used When |
|---------|-----------|--------|-----------|
| AgentPart | `"agent"` | `id`, `name`, `sessionID`, `messageID` | Agent-style dispatch |
| SubtaskPart | `"subtask"` | `id`, `prompt`, `description`, `agent` | Task-style dispatch |

**Critical observation:** OpenCode emits `tool.start` for both `pending` AND `running` status updates for the same tool (line 679). The SDK sends richer `input` data in the `running` update. The UI integration at `src/ui/index.ts:685-721` handles this update path, re-checking the background flag at line 704.

#### Where the Pipeline Could Break

The code path is architecturally identical to Claude's for the shared UI integration layer. Potential failure points:

1. **OpenCode SDK may not emit `tool.start` with `toolName: "Task"`** — If OpenCode's native tool naming differs, the eager agent creation at `src/ui/index.ts:641` would be bypassed
2. **`subagent.start` events may not correlate** — If `toolCallId` or `toolUseID` fields aren't populated in the OpenCode event data, the correlation at `src/ui/index.ts:1053-1058` would fail
3. **SSE event stream may not fire sub-agent events** — OpenCode's `part.type === "agent"` and `"subtask"` events depend on the SDK server emitting these part types
4. **Session ID mismatch** — OpenCode session IDs come from `properties.info.id` (line 606), which differs from Claude's hook-based session resolution
5. **Tool ID correlation** — OpenCode uses `part.callID` for tool correlation, while Claude uses `toolUseID` from hooks

#### OpenCode Event Test Gaps

From `src/sdk/clients/opencode.events.test.ts`:
- Tests `subtask` → `subagent.start` mapping (lines 108-156)
- Does NOT test `agent` part type mapping
- Does NOT test `step-finish` → `subagent.complete` mapping
- Does NOT test Task tool detection for background agents

---

### 4. Copilot SDK — Root Cause: No Task Tool

#### The Fundamental Problem

Copilot's custom agent system does NOT use a `Task` tool. The UI integration's eager agent creation depends entirely on detecting Task tool starts:

```typescript
// src/ui/index.ts:588
const isTaskToolName = data.toolName === "Task" || data.toolName === "task";

// src/ui/index.ts:641-648 — Only triggered when isTaskToolName is true
if (isTaskToolName && data.toolInput && !isUpdate) {
  const input = typeof data.toolInput === "string" ? JSON.parse(data.toolInput) : data.toolInput;
  const isBackground = input.run_in_background === true;
  pendingTaskEntries.push({ toolId, prompt, isBackground, runId: activeRunId });
  // ... creates eager ParallelAgent
}
```

**Copilot never triggers this path** because:
- Copilot loads agents via `customAgents` SDK config (`copilot.ts:883`)
- The SDK internally dispatches to agents without emitting `tool.start` with `toolName: "Task"`
- Copilot emits `subagent.started` directly → mapped to `subagent.start` at `copilot.ts:627-632`

#### What Copilot's `subagent.start` Event Contains

```typescript
// src/sdk/clients/copilot.ts:627-632
{
  subagentId: data.toolCallId,      // ✅ Present
  subagentType: data.agentName,     // ✅ Present
  task: undefined,                   // ❌ Not extracted from SDK event
  toolUseID: undefined,             // ❌ Claude-specific field
  toolCallId: data.toolCallId,     // ✅ Present
}
```

#### Why `subagent.start` Handler Fails to Create Agent

At `src/ui/index.ts:1027-1164`, the `subagent.start` handler:

1. Tries to find pending Task entry: `pendingTaskEntries.find(...)` (line 1053) → **empty queue, finds nothing**
2. Tries to find eager agent by `toolUseID`: `toolCallToAgentMap.get(toolUseID)` (line 1041) → **undefined (no Claude hook ID)**
3. Tries to find eager agent by `toolCallId`: searches `state.parallelAgents` (line 1045-1071) → **empty array, finds nothing**
4. Falls through to fresh agent creation at line 1135-1150

**BUT** the fresh creation path has its own guard:

```typescript
// src/ui/index.ts:1039-1042
if (!state.isStreaming && !state.activeRunId) return;
if (!state.parallelAgentHandler || !data.subagentId) return;
```

If streaming state or `parallelAgentHandler` is not set up when the `subagent.start` event fires, the handler returns early.

#### Comparison Table

| Pipeline Stage | Claude | OpenCode | Copilot |
|---------------|--------|----------|---------|
| **Tool invocation model** | Model calls `Task` tool | Model calls `Task` tool | SDK dispatches to `customAgents` |
| **`tool.start` with Task name** | ✅ Via PreToolUse hook | ✅ Via SSE `tool` part | ❌ No Task tool exists |
| **Eager agent creation** | ✅ Triggered at line 641 | ✅ Triggered at line 641 | ❌ Never triggered |
| **`pendingTaskEntries` populated** | ✅ At line 645 | ✅ At line 645 | ❌ Empty queue |
| **`subagent.start` emitted** | ✅ Via SubagentStart hook | ✅ Via `agent`/`subtask` part | ✅ Via `subagent.started` |
| **Agent correlation succeeds** | ✅ Via `toolUseID` | ✅ Via `toolCallId`/queue | ❌ No entries to correlate |
| **Background flag available** | ✅ From `run_in_background` | ✅ From `run_in_background` | ❌ Not in event data |
| **`parallelAgentHandler` called** | ✅ At line 1151 | ✅ At line 1151 | ⚠️ Only if fresh creation succeeds |
| **`parallel-agents` event created** | ✅ In ChatApp | ✅ In ChatApp | ❌ No agents to create event for |
| **UI renders tree** | ✅ | ⚠️ (reported broken) | ❌ No rendering |

---

### 5. Background Agent Termination Flow (Ctrl+F)

The termination flow exists and is implemented for all SDKs:

1. **Key detection**: `isBackgroundTerminationKey(event)` at `src/ui/utils/background-agent-termination.ts:22`
2. **Decision logic**: `getBackgroundTerminationDecision()` at line 29 — returns `warn` on first press, `terminate` on second
3. **Chat handler**: `src/ui/chat.tsx:4440-4520` — Ctrl+F branch in `useKeyboard`
4. **First press**: Sets `ctrlFPressed` state, shows warning at line 5985, starts 1s timeout (line 4514-4520)
5. **Second press**: Calls `interruptActiveBackgroundAgents()`, updates message parts, clears state, invokes parent callback, appends "All background agents killed" message (lines 4465-4511)
6. **Parent callback**: `src/ui/index.ts:1809-1823` — resets stream/run state, aborts session

---

### 6. Background Agent Footer

**Component**: `BackgroundAgentFooter` at `src/ui/components/background-agent-footer.tsx:12-36`

**Resolution logic**: `resolveBackgroundAgentsForFooter()` at `src/ui/utils/background-agent-footer.ts:24-33`:
- Prefers live `parallelAgents` state (line 28)
- Falls back to most recent message with background agents (line 33)
- Returns empty if no background agents active

**Mount location**: `src/ui/chat.tsx:5996` — outside scrollbox, at bottom of root column
- Uses `flexShrink={0}` — maintains height
- Returns `null` if no label (no agents) at `background-agent-footer.tsx:19-21`

**Contract**: `BACKGROUND_FOOTER_CONTRACT` at `src/ui/utils/background-agent-contracts.ts:49-54`:
- Shows when ≥1 agent active
- Includes `"ctrl+f terminate"` hint
- Uses `"agents"` count format

---

### 7. Tree Hint Generation

**Builder**: `buildParallelAgentsHeaderHint()` at `src/ui/utils/background-agent-tree-hints.ts:22`

**Hint values** (from `BACKGROUND_TREE_HINT_CONTRACT` at `background-agent-contracts.ts:70-74`):
- Running: `"background running · ctrl+f terminate"` (line 29)
- Complete: `"background complete · ctrl+o to expand"` (line 33)
- Default: `"ctrl+o to expand"` (line 37)

**Used at**: `src/ui/components/parallel-agents-tree.tsx:550` — rendered in header alongside agent count text

---

## Code References

### SDK Clients
- `src/sdk/clients/claude.ts:1421-1450` — Claude hook callbacks for tool/subagent events
- `src/sdk/clients/opencode.ts:670-742` — OpenCode SSE event mapping for tools/subagents
- `src/sdk/clients/copilot.ts:527-661` — Copilot SDK event transformation
- `src/sdk/clients/copilot.ts:627-632` — Copilot subagent.started event data extraction
- `src/sdk/clients/copilot.ts:153-171` — Copilot event type mapping table
- `src/sdk/base-client.ts:32-87` — EventEmitter base class

### UI Integration
- `src/ui/index.ts:588` — Task tool name detection (`isTaskToolName`)
- `src/ui/index.ts:638-730` — Eager agent creation on Task tool.start
- `src/ui/index.ts:1028-1164` — subagent.start event handler and correlation logic
- `src/ui/index.ts:1166-1226` — subagent.complete event handler
- `src/ui/index.ts:1809-1823` — Background agent termination parent callback

### Chat App
- `src/ui/chat.tsx:1856` — `parallelAgents` state declaration
- `src/ui/chat.tsx:2774-2833` — Parallel agent effect (state → message parts)
- `src/ui/chat.tsx:2920-2938` — Post-stream background agent preservation
- `src/ui/chat.tsx:4440-4520` — Ctrl+F termination handler
- `src/ui/chat.tsx:5701-5704` — Footer agent resolution
- `src/ui/chat.tsx:5996` — BackgroundAgentFooter mount

### Stream Pipeline
- `src/ui/parts/stream-pipeline.ts:637-765` — `mergeParallelAgentsIntoParts()`
- `src/ui/parts/stream-pipeline.ts:863-877` — `parallel-agents` event case handler
- `src/ui/parts/guards.ts:19-23` — `shouldFinalizeOnToolComplete()` background guard
- `src/ui/parts/types.ts:86-90` — `AgentPart` interface

### Components
- `src/ui/components/parallel-agents-tree.tsx:480-587` — Main tree component
- `src/ui/components/parallel-agents-tree.tsx:280-454` — `AgentRow` component
- `src/ui/components/background-agent-footer.tsx:12-36` — Footer component
- `src/ui/components/parts/agent-part-display.tsx:17-31` — Parts bridge to tree
- `src/ui/components/parts/registry.tsx:26` — Part registry entry for "agent"
- `src/ui/components/footer-status.tsx:99` — FooterStatus (exists but NOT mounted)

### Utilities
- `src/ui/utils/background-agent-footer.ts:24-33` — Footer agent resolver
- `src/ui/utils/background-agent-termination.ts:22-57` — Termination key/decision/interrupt
- `src/ui/utils/background-agent-tree-hints.ts:22-37` — Tree header hint builder
- `src/ui/utils/background-agent-contracts.ts:37-74` — Contract definitions

### Tests
- `src/sdk/unified-event-parity.test.ts` — Verifies all SDKs register same event types (NOT that they emit them)
- `src/sdk/clients/opencode.events.test.ts` — OpenCode event mapping tests (missing `agent` and `step-finish`)
- `src/sdk/clients/copilot.test.ts` — Copilot tests (NO subagent event tests)
- `src/ui/parallel-agent-background-lifecycle.test.ts` — Background agent lifecycle
- `src/ui/parts/background-agent-e2e.test.ts` — Background agent E2E
- `src/ui/utils/background-agent-provider-parity.test.ts` — Provider parity tests

## Architecture Documentation

### Event Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SDK Clients                              │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                   │
│  │  Claude   │   │ OpenCode │   │  Copilot │                   │
│  │  Hooks    │   │  SSE     │   │  Events  │                   │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘                   │
│       │              │              │                           │
│       ▼              ▼              ▼                           │
│  emitEvent()    emitEvent()    emitEvent()                     │
│  (tool.start,   (tool.start,   (subagent.started              │
│   subagent.     subagent.       → subagent.start)             │
│   start, etc)   start, etc)    ❌ NO tool.start               │
│                                   for "Task"                   │
└──────────┬──────────┬──────────────┬───────────────────────────┘
           │          │              │
           ▼          ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│              UI Integration (src/ui/index.ts)                   │
│                                                                 │
│  ┌──────────────────────────────────────────────┐              │
│  │ tool.start handler (line 638)                 │              │
│  │   if toolName === "Task":                     │              │
│  │     → create eager ParallelAgent              │              │
│  │     → populate pendingTaskEntries             │   ← COPILOT │
│  │     → call parallelAgentHandler()             │     SKIPPED  │
│  └──────────────────────────────────────────────┘              │
│                                                                 │
│  ┌──────────────────────────────────────────────┐              │
│  │ subagent.start handler (line 1028)            │              │
│  │   → correlate with pendingTaskEntries         │   ← COPILOT │
│  │   → merge with eager agent OR create fresh    │     NO ENTRY │
│  │   → call parallelAgentHandler()               │              │
│  └──────────────────────────────────────────────┘              │
│                                                                 │
│  ┌──────────────────────────────────────────────┐              │
│  │ subagent.complete handler (line 1166)          │              │
│  │   → update agent status                       │              │
│  │   → call parallelAgentHandler()               │              │
│  └──────────────────────────────────────────────┘              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              ChatApp (src/ui/chat.tsx)                          │
│                                                                 │
│  parallelAgents state ← parallelAgentHandler callback          │
│       │                                                         │
│       ▼                                                         │
│  useEffect: apply parallel-agents synthetic event               │
│       │                                                         │
│       ▼                                                         │
│  applyStreamPartEvent({ type: "parallel-agents", agents })      │
│       │                                                         │
│       ▼                                                         │
│  mergeParallelAgentsIntoParts() → AgentPart in message.parts   │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────┐    ┌──────────────────────┐               │
│  │ Scrollbox        │    │ BackgroundAgentFooter │               │
│  │  └─ MessageParts │    │ (outside scrollbox)   │               │
│  │     └─ AgentPart │    │ flexShrink={0}        │               │
│  │        └─ Tree   │    └──────────────────────┘               │
│  └─────────────────┘                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Per-SDK Pipeline Status

| Stage | Claude | OpenCode | Copilot |
|-------|--------|----------|---------|
| 1. SDK emits tool.start for Task | ✅ | ✅ | ❌ No Task tool |
| 2. Eager agent created | ✅ | ✅ | ❌ Bypassed |
| 3. pendingTaskEntries populated | ✅ | ✅ | ❌ Empty |
| 4. SDK emits subagent.start | ✅ | ✅ | ✅ |
| 5. Correlation with pending entry | ✅ | ✅ | ❌ Nothing to correlate |
| 6. Background flag extracted | ✅ | ✅ | ❌ Not in event data |
| 7. parallelAgentHandler called | ✅ | ✅* | ⚠️ Only if fresh creation succeeds |
| 8. parallel-agents event applied | ✅ | ✅* | ❌ |
| 9. AgentPart in message.parts | ✅ | ✅* | ❌ |
| 10. ParallelAgentsTree renders | ✅ | ✅* | ❌ |

*\* OpenCode is architecturally identical to Claude in the UI layer, but the user reports no UI. The issue may be in whether the native OpenCode SDK actually fires the expected events during sub-agent execution.*

## Historical Context (from research/)

- `research/tickets/2026-02-23-0258-background-agents-ui.md` — Prior ticket research documenting component locations and existing implementations
- `research/docs/2026-02-23-gh-issue-258-background-agents-ui.md` — GitHub issue extraction with screenshot URLs
- `research/docs/2026-02-23-sdk-subagent-api-research.md` — External SDK documentation research via DeepWiki
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md` — Prior lifecycle/status research
- `research/docs/2026-02-15-subagent-event-flow-diagram.md` — Prior event flow documentation
- `research/docs/2026-02-16-sub-agent-tree-inline-state-lifecycle-research.md` — Prior inline state lifecycle research
- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` — Prior SDK integration analysis

## Related Research

- `research/docs/2026-02-23-sdk-subagent-api-research.md` — DeepWiki-sourced SDK API research (companion document)
- `research/docs/2026-02-16-sub-agent-tree-inline-state-lifecycle-research.md`
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md`
- `research/docs/2026-02-15-subagent-premature-completion-investigation.md`

## Open Questions

1. **OpenCode runtime behavior**: The code architecture supports background agents for OpenCode (same UI integration path as Claude), but the user reports no UI. Need to verify whether the OpenCode SDK server actually emits `part.type === "subtask"` or `"agent"` events during sub-agent execution, or whether the tool naming differs from "Task".

2. **Copilot fresh agent creation path**: At `src/ui/index.ts:1135-1150`, a fresh agent creation path exists for `subagent.start` events without prior Task entries. If `state.isStreaming` and `state.parallelAgentHandler` are properly set, this path SHOULD create agents for Copilot. Need to verify whether streaming state guards at line 1039-1042 are blocking Copilot's events.

3. **Claude layout specifics**: The tree renders inside message parts within the scrollbox, while the footer is outside. The exact nature of the "incorrect layout" for Claude needs visual verification — whether it's spacing, positioning, or content ordering.

4. **Background flag for Copilot**: Even if the fresh creation path works, Copilot's `subagent.started` events don't carry `run_in_background`. All Copilot agents would render as foreground. Need to determine if Copilot's custom agent system supports background execution.
