---
date: 2026-02-12 19:30:00 UTC
researcher: Claude Opus 4.6
git_commit: current
branch: main
repository: atomic
topic: "Standardizing UI Across Coding Agent SDKs for Atomic TUI"
tags: [research, tui, ui-standardization, claude-agent-sdk, opencode-sdk, copilot-sdk, tools, tasks, sub-agents]
status: complete
last_updated: 2026-02-12
last_updated_by: Claude Opus 4.6
---

# Research: Standardizing UI Across Coding Agent SDKs for Atomic TUI

## Research Question

How can we standardize the UI across coding agent SDKs (OpenCode, Claude Agent, Copilot) for the Atomic TUI application? Investigate current implementations, identify differences in how they render tools/tasks/sub-agents, and document Claude's design patterns as the target model.

## Summary

The Atomic TUI application already implements a unified `CodingAgentClient` interface that abstracts the three SDKs (Claude, OpenCode, Copilot). The UI components (`ToolResult`, `ParallelAgentsTree`, `TaskListIndicator`) are **SDK-agnostic** and render based on unified event types (`tool.start`, `tool.complete`, `subagent.start`, `subagent.complete`). However, each SDK emits events differently with varying data payloads, requiring normalization in the client implementations. The Claude Code CLI's UI patterns are well-documented and serve as the reference design for collapsible outputs, animated indicators, and tree-style agent visualization.

## Detailed Findings

### 1. Current Architecture: Unified Event System

The core abstraction is in `src/sdk/types.ts`:

```typescript
export type EventType =
  | "session.start" | "session.idle" | "session.error"
  | "message.delta" | "message.complete"
  | "tool.start" | "tool.complete"
  | "skill.invoked"
  | "subagent.start" | "subagent.complete"
  | "permission.requested" | "human_input_required" | "usage";
```

Each SDK client maps its native events to these unified types:

| SDK | Tool Start Event | Tool Complete Event | Subagent Start | Subagent Complete |
|-----|------------------|---------------------|----------------|-------------------|
| Claude | `PreToolUse` hook | `PostToolUse` hook | `SubagentStart` hook | `SubagentStop` hook |
| OpenCode | `message.part.updated` (part.type="tool", status="pending/running") | `message.part.updated` (status="completed/error") | `message.part.updated` (part.type="agent") | `message.part.updated` (part.type="step-finish") |
| Copilot | `tool.execution_start` | `tool.execution_complete` | `subagent.started` | `subagent.completed` / `subagent.failed` |

### 2. UI Components: SDK-Agnostic Design

#### ToolResult Component (`src/ui/components/tool-result.tsx`)

Renders tool execution results with:
- **Status indicator**: `○` pending, `●` running (animated), `●` completed, `✕` error
- **Tool renderer registry**: Maps tool names (Read, Bash, Edit, Glob, etc.) to custom renderers
- **Collapsible content**: `maxCollapsedLines` with `ctrl+o to expand` hint
- **MCP tool support**: Parses `mcp__<server>__<tool>` naming convention

**Key normalization in `src/ui/tools/registry.ts`**:
- Handles both `file_path` (Claude) and `path`/`filePath` (OpenCode) parameter names
- Handles both `command` (Claude/Copilot) and `cmd` (OpenCode) parameter names
- Tool name case-insensitive matching (Read/read/VIEW/view)

#### ParallelAgentsTree Component (`src/ui/components/parallel-agents-tree.tsx`)

Renders sub-agents with Claude Code-style tree visualization:
- **Header**: `"● Running N Explore agents… (ctrl+o to expand)"`
- **Tree connectors**: `├─` branch, `└─` last branch, `│` vertical
- **Sub-status line**: `⎿  Initializing...` / `⎿  Done`
- **Metrics**: tool uses, tokens, duration
- **Animated blink indicator** for running agents

**Agent colors** (theme-aware, Catppuccin palette):
```typescript
Explore: blue, Plan: mauve, Bash: green,
debugger: red, codebase-analyzer: peach
```

#### TaskListIndicator Component (`src/ui/components/task-list-indicator.tsx`)

Renders TodoWrite tool state with:
- **Status icons**: `○` pending, `●` in_progress (animated), `●` completed, `✕` error
- **Blocked indicators**: `› blocked by #id`
- **Overflow handling**: `... +N more tasks`

### 3. SDK-Specific Differences

#### Claude Agent SDK (`src/sdk/claude-client.ts`)

**Event mapping** (lines 109-120):
```typescript
function mapEventTypeToHookEvent(eventType: EventType): HookEvent | null {
  const mapping: Partial<Record<EventType, HookEvent>> = {
    "session.start": "SessionStart",
    "tool.start": "PreToolUse",
    "tool.complete": "PostToolUse",
    "subagent.start": "SubagentStart",
    "subagent.complete": "SubagentStop",
  };
  return mapping[eventType] ?? null;
}
```

**Hook event data normalization** (lines 829-887):
- `HookInput.tool_name` → `eventData.toolName`
- `HookInput.tool_input` → `eventData.toolInput`
- `HookInput.tool_response` → `eventData.toolResult`
- `HookInput.agent_id` → `eventData.subagentId`
- `HookInput.agent_type` → `eventData.subagentType`

**Independent context support**: Yes, via `AgentDefinition` with `query()` API

#### OpenCode SDK (`src/sdk/opencode-client.ts`)

**Event mapping** (lines 403-518):
```typescript
private handleSdkEvent(event: Record<string, unknown>): void {
  switch (eventType) {
    case "message.part.updated": {
      const part = properties?.part;
      if (part?.type === "tool") {
        const toolState = part?.state;
        if (toolState?.status === "pending" || toolState?.status === "running") {
          this.emitEvent("tool.start", ...);
        } else if (toolState?.status === "completed" || toolState?.status === "error") {
          this.emitEvent("tool.complete", ...);
        }
      } else if (part?.type === "agent") {
        this.emitEvent("subagent.start", ...);
      } else if (part?.type === "step-finish") {
        this.emitEvent("subagent.complete", ...);
      }
    }
  }
}
```

**Independent context support**: Yes, via `Session.fork()` with `parentID`

#### Copilot SDK (`src/sdk/copilot-client.ts`)

**Event mapping** (lines 131-148):
```typescript
function mapSdkEventToEventType(sdkEventType: SdkSessionEventType): EventType | null {
  const mapping: Partial<Record<SdkSessionEventType, EventType>> = {
    "tool.execution_start": "tool.start",
    "tool.execution_complete": "tool.complete",
    "subagent.started": "subagent.start",
    "subagent.completed": "subagent.complete",
  };
  return mapping[sdkEventType] ?? null;
}
```

**Tool call ID tracking** (lines 527-545):
- Uses `toolCallIdToName` map to track tool names across start/complete events
- Copilot sends `toolCallId` in both events but only sends `toolName` in start

**Independent context support**: No — sub-agents share parent session's context

### 4. Claude Code UI Design Patterns (Target Model)

**Source**: `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md`

#### Tool Call Display

**Collapsed (default)**:
```
● Read 1 file (ctrl+o to expand)
```

**Expanded (Ctrl+O)**:
```
● Read(package.json)
  ⎿  Read 5 lines

● Here are the first 5 lines of package.json:        01:58 AM  claude-opus-4-5-20251101
```

#### Sub-Agent Display

**Running state**:
```
● Running 3 Explore agents… (ctrl+o to expand)
├─ Explore project structure · 0 tool uses
│  ⎿  Initializing...
├─ Explore source code structure · 0 tool uses
│  ⎿  Initializing...
└─ Explore tests and docs · 0 tool uses
   ┎  Initializing...
```

**Completed state**:
```
● 4 Explore agents finished (ctrl+o to expand)
├─ Explore project structure · 0 tool uses
│  ⎿  Done
...
```

#### Key Design Elements

| Element | Claude Code Pattern | Atomic Implementation |
|---------|---------------------|----------------------|
| Status dot (running) | Yellow/accent `●` (animated) | `AnimatedBlinkIndicator` |
| Status dot (completed) | Green `●` | `colors.success` |
| Status dot (error) | Red `✕` | `colors.error` |
| Tree connectors | `├─`, `└─`, `│` | `TREE_CHARS` constant |
| Sub-status connector | `⎿` | Hardcoded in components |
| Expand hint | `(ctrl+o to expand)` | Implemented |
| Timestamp display | Right-aligned `HH:MM AM` | `TimestampDisplay` component |
| Tool use counter | `· N tool uses` | Implemented in `AgentRow` |

### 5. Event Wiring in UI Layer

**Source**: `src/ui/index.ts` (lines 555-620)

```typescript
// Subscribe to subagent.start events to update ParallelAgentsTree
const unsubSubagentStart = client.on("subagent.start", (event) => {
  const { subagentId, subagentType, task } = event.data;
  
  // Create new ParallelAgent with 'running' status
  setParallelAgents((prev) => [
    ...prev,
    {
      id: subagentId,
      name: subagentType ?? "agent",
      task: task ?? "",
      status: "running",
      startedAt: event.timestamp,
    },
  ]);
});

// Subscribe to subagent.complete events
const unsubSubagentComplete = client.on("subagent.complete", (event) => {
  const { subagentId, result, success } = event.data;
  
  setParallelAgents((prev) =>
    prev.map((agent) =>
      agent.id === subagentId
        ? { ...agent, status: success ? "completed" : "error", result: String(result) }
        : agent
    )
  );
});
```

### 6. Gaps and Inconsistencies

#### Event Data Normalization

| Field | Claude | OpenCode | Copilot | UI Expects |
|-------|--------|----------|---------|------------|
| `toolName` | `tool_name` | `part.tool` | `toolName` | ✅ Normalized |
| `toolInput` | `tool_input` | `state.input` | `arguments` | ✅ Normalized |
| `toolResult` | `tool_response` | `state.output` | `result.content` | ✅ Normalized |
| `subagentId` | `agent_id` | `part.id` | `toolCallId` | ✅ Normalized |
| `subagentType` | `agent_type` | `part.name` | `agentName` | ✅ Normalized |

#### UI Component Gaps

1. **Timestamp alignment**: Claude Code right-aligns timestamps with model name; Atomic's `TimestampDisplay` exists but not consistently used
2. **Verbose mode toggle**: Claude Code has ctrl+o for transcript expansion; Atomic has partial implementation
3. **Spinner verbs**: Claude Code uses customizable verbs ("Marinating...", "Jitterbugging..."); Atomic uses fixed loading indicator
4. **Permission mode footer**: Claude Code shows permission mode with shift+tab hint; Atomic doesn't show this

## Architecture Documentation

### Event Flow Architecture

```
SDK Native Events
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  SDK Client (claude-client.ts / opencode-client.ts /         │
│              copilot-client.ts)                              │
│                                                              │
│  • Maps native events to unified EventType                   │
│  • Normalizes event data fields                              │
│  • Emits via client.on(eventType, handler)                   │
└─────────────────────────────────────────────────────────────┘
       │
       │ Unified events: tool.start, tool.complete,
       │                subagent.start, subagent.complete
       ▼
┌─────────────────────────────────────────────────────────────┐
│  UI Layer (src/ui/index.ts)                                  │
│                                                              │
│  • Subscribes to unified events                              │
│  • Updates React state (parallelAgents, toolExecutions)      │
│  • Passes state to components via props                      │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  UI Components                                               │
│                                                              │
│  • ParallelAgentsTree: renders sub-agents with tree layout   │
│  • ToolResult: renders tool execution with collapsible       │
│  • TaskListIndicator: renders todo items with status         │
└─────────────────────────────────────────────────────────────┘
```

### Current Standardization Status

| Aspect | Status | Notes |
|--------|--------|-------|
| Event type unification | ✅ Complete | All SDKs emit unified events |
| Event data normalization | ✅ Complete | Field names normalized in clients |
| Tool rendering | ✅ Complete | Registry handles SDK-specific param names |
| Sub-agent rendering | ✅ Complete | ParallelAgentsTree is SDK-agnostic |
| Task/todo rendering | ✅ Complete | TaskListIndicator is SDK-agnostic |
| Timestamp display | ⚠️ Partial | Component exists, not consistently used |
| Verbose mode toggle | ⚠️ Partial | ctrl+o implemented for tools, not global |
| Permission mode footer | ❌ Missing | Not implemented |
| Spinner verb customization | ❌ Missing | Fixed loading indicator |

## Code References

### SDK Clients
- `src/sdk/claude-client.ts:109-120` — Event type to hook event mapping
- `src/sdk/claude-client.ts:829-887` — Hook input normalization
- `src/sdk/opencode-client.ts:403-518` — SSE event handling and mapping
- `src/sdk/copilot-client.ts:131-148` — SDK event to unified event mapping
- `src/sdk/copilot-client.ts:527-545` — Tool call ID tracking

### UI Components
- `src/ui/components/tool-result.tsx:232-320` — ToolResult component
- `src/ui/components/parallel-agents-tree.tsx:594-712` — ParallelAgentsTree component
- `src/ui/components/task-list-indicator.tsx:73-119` — TaskListIndicator component
- `src/ui/tools/registry.ts:674-697` — Tool renderer registry

### Event Wiring
- `src/ui/index.ts:555-620` — Subagent event subscriptions
- `src/sdk/types.ts:253-266` — Unified EventType definition
- `src/sdk/types.ts:321-376` — Event data interfaces

### Research References
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` — Claude Code UI patterns
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` — Sub-agent UI research

## Recommendations

### Immediate Enhancements

1. **Consistent timestamp display**: Add `TimestampDisplay` to all tool results and sub-agent completions with right-aligned formatting

2. **Global verbose mode**: Implement ctrl+o as a global toggle that expands/collapses all tool outputs and shows detailed transcript

3. **Spinner verb customization**: Add configurable spinner verbs to match Claude Code's personality

4. **Permission mode footer**: Add footer showing current permission mode with toggle hint

### Future Standardization

1. **Unified streaming display**: All three SDKs should emit `message.delta` events with consistent `contentType` ("text" vs "thinking")

2. **Token usage events**: Standardize `usage` event emission for real-time token counting in UI

3. **Error event enrichment**: Include `code` and `recoverable` fields in error events for better UI handling

## Open Questions

1. **Should verbose mode persist across sessions?** Claude Code doesn't persist; users re-toggle each session.

2. **How should Copilot's lack of independent sub-agent context be surfaced in UI?** Current implementation works but may show confusing results for parallel sub-agents.

3. **Should tool renderer registry be extensible by users?** Currently hardcoded; could allow custom renderers via configuration.

4. **What's the right level of detail for collapsed tool output?** Currently shows line count; could show summary or first line.
