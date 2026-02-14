---
date: 2026-02-14 06:51:38 UTC
researcher: GitHub Copilot CLI
git_commit: 9e875832c52690a7cc3db895b5f1b3b35487d1d0
branch: lavaman131/hotfix/tool-ui
repository: atomic
topic: "Sub-Agent Output Propagation Issue — Why Agent Tree Shows Only 'Done' + Pinned Tree Issue"
tags: [research, codebase, subagent, parallel-agents-tree, result-propagation, ui-rendering, sdk-integration, race-condition, async]
status: complete
last_updated: 2026-02-14
last_updated_by: GitHub Copilot CLI
last_updated_note: "Added follow-up research for pinned agent tree blocking subsequent messages"
---

# Research: Sub-Agent Output Propagation Issue

## Research Question

Why is there a problem in the sub-agents that are being spawned where there is no output underneath the agent tree when execution ends? The sub-agent outputs are not being passed to the main agent. Evidence: the `tmux-screenshots/subagent.png` screenshot shows 5 agents completed with only "Done" displayed under each agent in the tree — no actual result content is visible.

## Summary

The root cause is a **UI rendering decision** combined with **architectural gaps** in the sub-agent system. The issue manifests at three layers:

1. **UI Layer (Primary Cause)**: The `ParallelAgentsTree` component is always rendered in `compact={true}` mode. In compact mode, the `agent.result` field is **never referenced** in the rendering logic — only the hardcoded string `"Done"` from `getSubStatusText()` is displayed. The actual result text exists in memory but is not shown.

2. **Bridge Layer (Data Loss)**: The `SubagentGraphBridge` truncates all sub-agent output to 2000 characters (`MAX_SUMMARY_LENGTH`), discards all non-text message types (tool results, thinking blocks), and destroys the session after extraction — permanently losing the full conversation history.

3. **SDK Integration Layer (Registration Gap)**: Built-in sub-agents (`codebase-analyzer`, `codebase-locator`, etc.) are **not registered** with any of the three SDK-native sub-agent APIs (Claude `agents` option, OpenCode `opencode.json`, Copilot `customAgents`). This means skills that instruct the main agent to use the Task tool with a specific `subagent_type` cannot find the agents through native SDK mechanisms.

## Detailed Findings

### 1. UI Rendering — The "Done" Problem

#### The Compact Mode Gate (`src/ui/components/parallel-agents-tree.tsx`)

The `ParallelAgentsTree` component has two rendering modes: compact and full.

**Compact mode** (lines 364-453) — always active:
- Shows agent name, truncated task description (40 chars), and metrics
- For completed agents, displays sub-status from `getSubStatusText()` (line 172-189):
  ```typescript
  case "completed":
    return "Done";
  ```
- **The `agent.result` field is NEVER referenced in compact mode rendering logic**

**Full mode** (lines 455-559) — never used:
- Would render result at lines 527-536:
  ```typescript
  {isCompletedFull && agent.result && (
    <box flexDirection="row">
      <text style={{ fg: themeColors.success }}>
        {CONNECTOR.subStatus}  {truncateText(agent.result, 60)}
      </text>
    </box>
  )}
  ```
- This code path is unreachable because `compact` is always `true`

**Where compact is hardcoded** (`src/ui/chat.tsx`):
- Line 1529: `<ParallelAgentsTree agents={agents} compact={true} />`
- Line 1550: Same hardcoded `compact={true}`

#### The Transcript View Also Shows "Done" (`src/ui/utils/transcript-formatter.ts`)

Even in the full transcript view (ctrl+o toggle), lines 189-190:
```typescript
if (agent.status === "completed") {
  lines.push(line("agent-substatus",
    `${TREE.vertical} ${CONNECTOR.subStatus}  Done${metrics ? ` (${metricsParts.join(" · ")})` : ""}`));
}
```
The `agent.result` field is ignored in transcript view as well.

#### Where Results ARE Visible

The Task tool card (`src/ui/tools/registry.ts:669-717`) renders actual result text:
- Uses `parseTaskToolResult()` to extract clean text
- Shows first 15 lines with truncation
- But this is collapsed by default (ctrl+o to expand)
- It appears as a separate tool card, not in the agent tree

### 2. Result Collection Pipeline

#### Data Flow: Sub-Agent → Result → UI

```
1. Sub-agent session spawned
   └─ src/graph/subagent-bridge.ts:119 → createSession()

2. Streaming response collected
   └─ src/graph/subagent-bridge.ts:122-128
   └─ ONLY text messages captured (msg.type === "text")
   └─ Tool use messages: counted only (msg.type === "tool_use")
   └─ Other message types: IGNORED

3. Output truncated to 2000 chars
   └─ src/graph/subagent-bridge.ts:130-135
   └─ MAX_SUMMARY_LENGTH = 2000 (line 66)

4. Session destroyed
   └─ src/graph/subagent-bridge.ts:172
   └─ All conversation state permanently lost

5. SubagentResult returned
   └─ Contains: agentId, success, output (truncated), toolUses, durationMs
   └─ Does NOT contain: full messages, tool results, thinking blocks

6. SDK emits tool.complete event
   └─ src/sdk/claude-client.ts:700-780 (Claude)
   └─ src/sdk/copilot-client.ts:547-559 (Copilot)
   └─ src/sdk/opencode-client.ts:850-880 (OpenCode)

7. UI event handler processes result
   └─ src/ui/index.ts:489-559
   └─ Calls parseTaskToolResult() to extract text
   └─ Updates parallelAgents state: agent.result = resultStr

8. ParallelAgentsTree renders
   └─ compact={true} → shows "Done" → agent.result IGNORED
```

#### What IS Captured in SubagentResult (`src/graph/subagent-bridge.ts:46-59`)

```typescript
{
  agentId: string;        // Agent identifier
  success: boolean;       // Completion status
  output: string;         // Truncated summary (max 2000 chars)
  error?: string;         // Error message if failed
  toolUses: number;       // Count of tool invocations
  durationMs: number;     // Execution time
}
```

#### What IS NOT Captured

- Full message history (array of AgentMessage objects)
- Tool results/outputs (only count of tool uses)
- Thinking blocks / reasoning content
- Non-text structured data
- Session state (destroyed at line 172)
- Context/token usage metrics
- Message metadata (timestamps, roles, IDs)
- Conversation flow structure

### 3. SDK Registration Gap

#### Built-in Agents Not Registered with SDK-Native APIs

**Claude SDK** (`src/sdk/claude-client.ts:224-355`):
- `buildSdkOptions()` does NOT pass the `agents` option to the Claude SDK
- Claude SDK's native sub-agent orchestration (`AgentDefinition` via `agents` config) is bypassed
- Sub-agents run as completely independent sessions with no context sharing

**OpenCode SDK** (`src/sdk/opencode-client.ts`):
- Built-in agents are not registered via `opencode.json` or `.opencode/agents/*.md`
- No utilization of OpenCode's `mode: "subagent"` configuration
- Sub-agents don't benefit from OpenCode's agent-aware context management

**Copilot SDK** (`src/sdk/copilot-client.ts:712-719`):
- Only disk-discovered agents are loaded into `customAgents`
- `BUILTIN_AGENTS` from `agent-commands.ts` are NOT included
- Copilot SDK cannot find built-in sub-agents when invoked via Task tool

#### Impact on Skills

When a skill like `/research-codebase` runs:
```
User Types /research-codebase
    ↓
skill-commands.ts sends prompt to main session
    ↓
Main agent tries to use Task tool with subagent_type="codebase-analyzer"
    ↓
SDK looks up "codebase-analyzer" in registered agents
    ↓
❌ Agent NOT registered with SDK native APIs
```

The sub-agents currently work through `SubagentSessionManager.spawn()` which creates fully independent sessions, bypassing SDK-native mechanisms entirely.

### 4. SDK Reference: How Results SHOULD Flow

#### Claude Agent SDK (`docs/claude-agent-sdk/typescript-sdk.md`)

Sub-agent results return via `TaskOutput` (lines 1308-1338):
```typescript
interface TaskOutput {
  result: string;
  usage?: { input_tokens: number; output_tokens: number; ... };
  total_cost_usd?: number;
  duration_ms?: number;
}
```

Hierarchical tracking via `parent_tool_use_id` (lines 419-458):
- Root messages: `parent_tool_use_id: null`
- Sub-agent messages: `parent_tool_use_id: <tool_use_id of Task tool call>`
- Creates a tree structure where each message knows its parent context

Lifecycle hooks: `SubagentStart` and `SubagentStop` events (lines 584-747)

#### Copilot SDK (`github/copilot-sdk`)

Sub-agents configured at session creation via `CustomAgentConfig`:
- Result data comes through `tool.execution_complete` events
- `SubagentCompletedData` only contains `toolCallId` and `agentName` — no direct result data
- Actual results must be collected from `ToolExecutionCompleteData.result.content`
- No dynamic agent spawning — all agents must be pre-configured

Event linking:
- `parentId` chains: General parent-child event relationships
- `toolCallId`: Links subagent-specific events together
- `parentToolCallId`: Links nested tool executions

#### OpenCode SDK (`anomalyco/opencode`)

Sub-agent delegation via `TaskTool` (`packages/opencode/src/tool/task.ts`):
- Result format: XML-style `<task_result>{text}</task_result>` wrapper
- Session storage: `~/.local/share/opencode/` per project
- Parent-child relationship via `parentID` on sessions
- Tool state machine: `pending` → `running` → `completed`/`error`

### 5. Event Normalization Layer (Working Correctly)

The unified event system (`src/sdk/types.ts:233-357`) correctly maps SDK events:

| SDK | Native Event | Unified Event |
|-----|--------------|---------------|
| Claude | `SubagentStart` hook | `subagent.start` |
| Claude | `SubagentStop` hook | `subagent.complete` |
| OpenCode | `part.type="agent"` | `subagent.start` |
| OpenCode | `part.type="step-finish"` | `subagent.complete` |
| Copilot | `subagent.started` | `subagent.start` |
| Copilot | `subagent.completed` | `subagent.complete` |

UI components are SDK-agnostic and render based on normalized event data. The event normalization layer itself is not the source of the problem.

### 6. Two-Phase Result Population

The UI uses a two-phase approach to populate agent results (`src/ui/index.ts`):

**Phase 1** — `subagent.complete` event (line 648):
- Sets `status: "completed"`, clears `currentTool`
- `result` field from event contains only the reason string (e.g., "success")
- Not the actual output

**Phase 2** — `tool.complete` event for Task tool (line 523):
- Has the actual output via `data.toolResult`
- Parses with `parseTaskToolResult()` to extract clean text
- Finds the last completed agent without result, backfills `agent.result`

This means:
- `agent.result` IS populated with actual content after Phase 2
- But the UI never renders it due to compact mode

## Code References

- `src/ui/components/parallel-agents-tree.tsx:172-189` — `getSubStatusText()` returns hardcoded "Done"
- `src/ui/components/parallel-agents-tree.tsx:364-453` — Compact mode rendering (no result display)
- `src/ui/components/parallel-agents-tree.tsx:455-559` — Full mode rendering (unreachable, has result display)
- `src/ui/chat.tsx:1529` — `compact={true}` hardcoded
- `src/ui/chat.tsx:1550` — `compact={true}` hardcoded
- `src/ui/utils/transcript-formatter.ts:189-190` — Transcript also shows "Done"
- `src/graph/subagent-bridge.ts:66` — `MAX_SUMMARY_LENGTH = 2000`
- `src/graph/subagent-bridge.ts:106-178` — `spawn()` method with truncation
- `src/graph/subagent-bridge.ts:122-128` — Only text messages collected
- `src/graph/subagent-bridge.ts:172` — Session destroyed after extraction
- `src/sdk/claude-client.ts:224-355` — `buildSdkOptions()` missing `agents` option
- `src/sdk/copilot-client.ts:712-719` — Built-in agents not in `customAgents`
- `src/ui/index.ts:489-559` — Tool complete event handler with result parsing
- `src/ui/index.ts:541-546` — Agent result backfill logic
- `src/ui/tools/registry.ts:603-658` — `parseTaskToolResult()` parser
- `src/ui/tools/registry.ts:669-717` — Task tool renderer (shows actual result)
- `src/sdk/types.ts:233-357` — Unified event type definitions

## Architecture Documentation

### Current Sub-Agent Execution Architecture

```
┌─────────────────────────────────────────────────┐
│                  Parent Agent                    │
│                                                  │
│  Task Tool Invocation                            │
│  ┌─────────────────────────────────────────┐     │
│  │  SubagentGraphBridge.spawn()            │     │
│  │  ├─ createSession(independent)          │     │
│  │  ├─ session.stream(task)                │     │
│  │  ├─ collect text-only (≤2000 chars)     │     │
│  │  ├─ session.destroy()                   │     │
│  │  └─ return SubagentResult               │     │
│  └─────────────────────────────────────────┘     │
│                    │                              │
│                    ▼                              │
│  SDK emits tool.complete event                   │
│                    │                              │
│                    ▼                              │
│  UI Event Handler                                │
│  ├─ toolCompleteHandler → tool card (collapsed)  │
│  └─ parallelAgentHandler → tree ("Done")         │
│                                                  │
│  ParallelAgentsTree (compact=true)               │
│  ├─ codebase-locator      → "Done"               │
│  ├─ codebase-analyzer     → "Done"               │
│  ├─ codebase-pattern-finder → "Done"             │
│  ├─ codebase-research-locator → "Done"           │
│  └─ codebase-analyzer     → "Done"               │
│                                                  │
│  ❌ agent.result exists but is NOT rendered      │
└─────────────────────────────────────────────────┘
```

### SDK-Native Sub-Agent Architecture (Not Currently Used)

```
Claude SDK:                OpenCode SDK:              Copilot SDK:
┌──────────┐              ┌──────────┐              ┌──────────┐
│  agents:  │              │ .opencode │              │customAgents│
│  {...}    │              │ /agents/  │              │  [...]    │
│           │              │  *.md     │              │           │
│ Task tool │              │ TaskTool  │              │ Selected  │
│ result →  │              │ result →  │              │ via event │
│ tool_result│             │ <task_    │              │ toolCallId│
│ message   │              │  result>  │              │ linking   │
└──────────┘              └──────────┘              └──────────┘
```

## Historical Context (from research/)

- `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` — Documents the registration gap between built-in agents and SDK-native APIs
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` — Notes the placeholder implementation status of sub-agent UI and missing event wiring
- `research/docs/2026-02-12-tui-layout-streaming-content-ordering.md` — Documents the fixed-position rendering of ParallelAgentsTree outside interleaved segments
- `research/docs/2026-01-31-graph-execution-pattern-design.md` — Original graph execution pattern design
- `research/docs/2026-01-31-sdk-migration-and-graph-execution.md` — SDK comparison showing context isolation capabilities
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md` — Event normalization layer documentation
- `research/docs/2026-02-14-opencode-opentui-sdk-research.md` — OpenCode SDK TaskTool and result format

## Related Research

- `research/docs/2026-02-13-ralph-task-list-ui.md` — Task list UI implementation
- `research/docs/2026-02-09-token-count-thinking-timer-bugs.md` — Related UI rendering issues
- `research/docs/2026-02-01-chat-tui-parity-implementation.md` — Chat TUI feature parity

## Open Questions

1. Should `compact` mode be changed to display a truncated `agent.result` instead of just "Done"?
2. Should the `MAX_SUMMARY_LENGTH` of 2000 characters be increased, or should full message history be preserved?
3. Should built-in agents be registered with SDK-native APIs to enable proper Task tool integration?
4. Should the transcript view (ctrl+o) also display `agent.result` content?
5. Is the two-phase result population (subagent.complete → tool.complete) reliable, or could race conditions cause `agent.result` to be empty?
6. Should the `SubagentGraphBridge` capture tool results in addition to text messages?
7. Should the live → baked agent transition clear `parallelAgents` state atomically with the message update to avoid the render window where live agents override baked agents?
8. Should the 50ms setTimeout delays for queue processing be replaced with a more deterministic approach (e.g., microtask scheduling)?

---

## Follow-up Research: Agent Tree Stays Pinned After All Agents Complete (2026-02-14 06:53 UTC)

### Problem Statement

The `ParallelAgentsTree` component stays visually pinned in the chat message area after all sub-agents finish, preventing subsequent messages from appearing to stream naturally after it. The tree remains attached to the message instead of being finalized and allowing the conversation flow to continue.

### Root Cause Analysis

The issue stems from a **multi-layered timing dependency** between SDK events, React state updates, and message finalization. There are three contributing factors:

#### Factor 1: Live Agents Override Baked Agents (React Render Window)

At `src/ui/chat.tsx:1420-1422`:
```typescript
const agentsToShow = parallelAgents?.length ? parallelAgents
  : message.parallelAgents?.length ? message.parallelAgents
  : null;
```

The live `parallelAgents` prop (passed only to the last message at line 4918) takes **priority** over the baked `message.parallelAgents` field. During the finalization sequence, there is a render window between:

- **T1**: `setMessages()` updates the message with `streaming: false` and `parallelAgents: finalizedAgents` (baked)
- **T2**: `setParallelAgents([])` clears the live state

Between T1 and T2, React may render with:
- `message.streaming = false` (finalized)
- `message.parallelAgents = finalizedAgents` (baked)
- BUT `parallelAgents` prop still contains the old live array (not yet cleared)

Since live agents are preferred, the tree continues to render from the stale live state.

#### Factor 2: Deferred Completion When Agents Outlive the Stream

At `src/ui/index.ts:886-915`, when the SDK stream ends but agents are still running:

```typescript
const hasActiveAgents = state.parallelAgents.some(
  (a) => a.status === "running" || a.status === "pending"
);
if (!hasActiveAgents) {
  state.parallelAgents = [];
}
// ...
if (!hasActiveAgents) {
  state.isStreaming = false;
}
```

And at `src/ui/chat.tsx:3074-3080` (or 4513-4521):
```typescript
const hasActiveAgents = parallelAgentsRef.current.some(
  (a) => a.status === "running" || a.status === "pending"
);
if (hasActiveAgents || hasRunningToolRef.current) {
  pendingCompleteRef.current = handleComplete;
  return;  // ← DEFERS EVERYTHING including clearing agents and queue processing
}
```

This creates a chain:
1. SDK stream ends → `onComplete()` fires
2. `handleComplete` checks for active agents → finds them → **defers** by storing in `pendingCompleteRef`
3. The message stays in `streaming: true` state
4. The tree remains rendered with live agents
5. Only when ALL agents complete does the `useEffect` at line 2412 trigger
6. The effect calls the stored `pendingCompleteRef.current()` which then finalizes

**The problem**: Between the SDK stream ending (step 1) and the effect firing (step 5), the message appears "stuck" with a pinned agent tree. No new messages can stream because `isStreamingRef.current` is still true.

#### Factor 3: Last-Message Pinning

At `src/ui/chat.tsx:4918`:
```typescript
parallelAgents={index === visibleMessages.length - 1 ? parallelAgents : undefined}
```

Live `parallelAgents` are **only passed to the last message**. The tree stays pinned to this message until either:
- A new message starts (becomes the new "last message")
- `parallelAgents` state is cleared to `[]`

Since new messages are blocked while `isStreamingRef.current` is true, and `isStreamingRef` stays true while agents are active, the tree is pinned to the last message with no way to advance.

### Complete Timing Sequence

```
T1:  SDK stream ends
     └─ index.ts:886 → onComplete()
     └─ hasActiveAgents = TRUE (some agents still running)
     └─ state.parallelAgents NOT cleared
     └─ state.isStreaming remains TRUE

T2:  chat.tsx handleComplete fires
     └─ Checks parallelAgentsRef.current → has active agents
     └─ pendingCompleteRef.current = handleComplete
     └─ RETURNS EARLY ← message stays streaming

T3:  Last agent completes
     └─ index.ts:648 → subagent.complete event
     └─ Updates agent status to "completed"
     └─ Calls parallelAgentHandler → setParallelAgents(...)
     └─ DOES NOT clear agents (comment at lines 675-679)

T4:  tool.complete event fires for last Task tool
     └─ index.ts:523 → Parses result, backfills agent.result
     └─ Calls parallelAgentHandler → setParallelAgents(...)

T5:  React re-render triggers useEffect
     └─ chat.tsx:2412 → Checks hasActive → FALSE
     └─ Calls pendingCompleteRef.current() (stored from T2)

T6:  Deferred handleComplete finally runs
     └─ setParallelAgents callback:
        └─ Bakes finalizedAgents into message.parallelAgents
        └─ Returns [] to clear live state
     └─ streamingMessageIdRef.current = null
     └─ isStreamingRef.current = false
     └─ setIsStreaming(false)

T7:  Queue processing (50ms setTimeout)
     └─ Next message can finally stream

TOTAL LATENCY: T1 → T7 can span seconds to minutes
               depending on sub-agent execution time
```

### Blocking Mechanisms

The following patterns actively block new message processing while agents run:

1. **Queue dequeue deferred** (`src/ui/chat.tsx:3074-3080`): `pendingCompleteRef` stores completion, queue not drained
2. **Enter key deferred** (`src/ui/chat.tsx:4779-4788`): User input stored in `pendingInterruptMessageRef`, not sent
3. **@mention deferred** (`src/ui/chat.tsx:4730-4740`): Agent mentions stored and deferred
4. **isStreaming stays true** (`src/ui/index.ts:909-914`): Prevents new streams from starting
5. **50ms setTimeout delays** (`src/ui/chat.tsx:2557-2562, 3054-3058, 3062-3067`): Additional latency after agents complete

### Agent-Only Stream Special Case

For `@agent-name` mentions (no SDK stream), there's an additional path at `src/ui/chat.tsx:2496-2563`:

The `useEffect` handles finalization when:
- `parallelAgents.length > 0`
- `streamingMessageIdRef.current` is set
- `isStreamingRef.current` is true
- `isAgentOnlyStreamRef.current` is true
- No active agents remain

This path works independently of `pendingCompleteRef` but has the same timing characteristics — the tree stays pinned until the effect fires after the last agent completes.

### Code References (Follow-up)

- `src/ui/chat.tsx:1420-1422` — Live agents override baked agents
- `src/ui/chat.tsx:4918` — Live agents only passed to last message
- `src/ui/chat.tsx:2412-2564` — useEffect for deferred completion
- `src/ui/chat.tsx:3074-3080` — Deferred completion when agents active
- `src/ui/chat.tsx:4513-4521` — Same deferred pattern in sendMessage
- `src/ui/chat.tsx:4523-4557` — Finalization: bake agents → clear state
- `src/ui/chat.tsx:4779-4788` — Enter key deferred when agents active
- `src/ui/chat.tsx:4730-4740` — @mention deferred when agents active
- `src/ui/chat.tsx:2557-2562` — 50ms setTimeout for queue drain
- `src/ui/index.ts:886-915` — SDK onComplete keeps streaming if agents active
- `src/ui/index.ts:909-914` — isStreaming stays true while agents run
- `src/ui/index.ts:675-679` — Comment explaining why agents aren't cleared on complete
- `src/ui/components/parallel-agents-tree.tsx:593-596` — Empty array guard (returns null)
