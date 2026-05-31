---
date: 2026-02-12 06:37:49 UTC
researcher: Claude (opencode)
git_commit: acb591bfa8a868d4f2b58eda630402991aabeefe
branch: lavaman131/hotfix/opentui-distribution
repository: atomic
topic: "SDK UI Standardization: Modeling Atomic TUI after Claude Code Design"
tags: [research, codebase, ui, sdk, tools, tasks, sub-agents, claude, opencode, copilot]
status: complete
last_updated: 2026-02-12
last_updated_by: Claude (opencode)
---

# Research: SDK UI Standardization

## Research Question

How to standardize the UI across coding agent SDKs (OpenCode, Claude Agent, Copilot) for the atomic TUI application to use the same design for tools, tasks, and sub-agents, modeling after the Claude version's design patterns.

## Summary

The Atomic TUI already has a well-architected event normalization layer that abstracts all three SDKs (Claude, OpenCode, Copilot) behind a unified `CodingAgentClient` interface. UI components (`ToolResult`, `ParallelAgentsTree`, `TaskListIndicator`) are already SDK-agnostic and render based on normalized event data. However, gaps exist in matching the exact Claude Code UI patterns, particularly around permission mode display, spinner customization, and consistent timestamp usage.

The architecture is fundamentally sound—the standardization work needed is primarily in filling feature gaps rather than restructuring the event/UI layer.

---

## Detailed Findings

### 1. UI Component Architecture

#### Tools Rendering

| Component | Location | Purpose |
|-----------|----------|---------|
| `ToolResult` | `src/ui/components/tool-result.tsx` | Main tool output rendering with status indicators |
| Tool Registry | `src/ui/tools/registry.ts` | Per-tool custom renderers (Read, Edit, Bash, Write, etc.) |
| Transcript Formatter | `src/ui/utils/transcript-formatter.ts:234-279` | Expanded transcript view formatting |

**Status Icons** (standardized across all SDKs):
```
pending:     ○  (muted)
running:     ●  (accent, animated blink)
completed:   ●  (green)
error:       ✕  (red)
interrupted: ●  (warning)
```

**Tool Registry Pattern:**
```typescript
interface ToolRenderer {
  icon: string;              // "≡" Read, "$" Bash, "△" Edit, "►" Write
  getTitle(props): string;   // Short header text
  render(props): {           // Full render output
    title: string;
    content: string[];
    language?: string;       // Syntax highlighting
    expandable?: boolean;
  };
}
```

#### Tasks Rendering

| Component | Location | Purpose |
|-----------|----------|---------|
| `TaskListIndicator` | `src/ui/components/task-list-indicator.tsx` | Todo/task list with status icons |
| TodoWrite Renderer | `src/ui/tools/registry.ts:648-671` | Task list formatting |

**Task Item Structure:**
```typescript
interface TaskItem {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "error";
  blockedBy?: string[];  // Shows "› blocked by #id1, #id2"
}
```

#### Sub-Agents Rendering

| Component | Location | Purpose |
|-----------|----------|---------|
| `ParallelAgentsTree` | `src/ui/components/parallel-agents-tree.tsx` | Tree view of parallel agents |
| `SingleAgentView` | `src/ui/components/parallel-agents-tree.tsx:236-330` | Inline single agent display |
| `AgentRow` | `src/ui/components/parallel-agents-tree.tsx:361-568` | Tree row with branch connectors |

**Tree Drawing Characters:**
```typescript
const TREE_CHARS = {
  branch: "├─",
  lastBranch: "└─",
  vertical: "│ ",
  space: "  ",
};
```

**Agent Status Types:**
```typescript
type AgentStatus = "pending" | "running" | "completed" | "error" | "background" | "interrupted";
```

**Agent Color Mapping** (Catppuccin theme):
```typescript
Explore:   blue
Plan:      mauve
Bash:      green
debugger:  red
codebase-analyzer: peach
```

---

### 2. Event Normalization Layer

#### Unified Event Types (`src/sdk/types.ts:253-266`)

```typescript
export type EventType =
  | "session.start" | "session.idle" | "session.error"
  | "message.delta" | "message.complete"
  | "tool.start" | "tool.complete"
  | "skill.invoked"
  | "subagent.start" | "subagent.complete"
  | "permission.requested" | "human_input_required" | "usage";
```

#### SDK-to-Event Mapping

| SDK | Native Event | Unified Event |
|-----|--------------|---------------|
| **Claude** | `PreToolUse` hook | `tool.start` |
| **Claude** | `PostToolUse` hook | `tool.complete` |
| **Claude** | `SubagentStart` hook | `subagent.start` |
| **Claude** | `SubagentStop` hook | `subagent.complete` |
| **OpenCode** | `message.part.updated` (tool pending) | `tool.start` |
| **OpenCode** | `message.part.updated` (tool completed) | `tool.complete` |
| **OpenCode** | `part.type="agent"` | `subagent.start` |
| **OpenCode** | `part.type="step-finish"` | `subagent.complete` |
| **Copilot** | `tool.execution_start` | `tool.start` |
| **Copilot** | `tool.execution_complete` | `tool.complete` |
| **Copilot** | `subagent.started` | `subagent.start` |
| **Copilot** | `subagent.completed` | `subagent.complete` |

#### Field Normalization

| Field | Claude | OpenCode | Copilot | Normalized |
|-------|--------|----------|---------|------------|
| Tool name | `tool_name` | `part.tool` | `toolName` | `toolName` |
| Tool input | `tool_input` | `state.input` | `arguments` | `toolInput` |
| Tool result | `tool_response` | `state.output` | `result.content` | `toolResult` |
| Subagent ID | `agent_id` | `part.id` | `toolCallId` | `subagentId` |
| Subagent type | `agent_type` | `part.name` | `agentName` | `subagentType` |

---

### 3. Claude SDK UI Patterns (Target Model)

**Claude Code Reference Implementation** (`src/sdk/claude-client.ts`):

#### Collapsible Tool Outputs
```
● Read 1 file (ctrl+o to expand)
```
- Content hidden by default behind `maxCollapsedLines` (default: 5)
- "▾ N more lines" indicator when collapsed
- Diff syntax highlighting for `language: "diff"`

#### Animated Indicators
- **Blink:** `●`/`·` alternation at 500ms for running states
- **Loading:** Braille spinner `⣾⣽⣻⢿⡿⣟⣯⣷` at 120ms/frame
- **Random verbs:** "Thinking", "Analyzing", "Processing"

#### Sub-Agent Tree Display
```
● Running 2 agents…
├─ ● Find API endpoints · 3 tool uses · 2.1k tokens
│  ⎿  Bash: grep -r "router"...
└─ ● Investigate error · 1 tool uses
   ⎿  Initializing...
```

#### Color System (Catppuccin-based)
```typescript
const darkTheme = {
  accent: "#94e2d5",    // Teal - active/running
  success: "#a6e3a1",   // Green - completed
  error: "#f38ba8",     // Red - errors
  warning: "#f9e2af",   // Yellow - interrupted
  muted: "#6c7086",     // Overlay 0 - pending/dim
  foreground: "#cdd6f4", // Text - default
};
```

---

### 4. SDK-Specific Implementations

#### Claude SDK Client (`src/sdk/claude-client.ts`)

**Architecture:** Hook-based event system
- `mapEventTypeToHookEvent()` at lines 109-120
- Native hooks: `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`
- Direct `query()` API, no server process required

**Event Flow:**
```
SDK Hook (PreToolUse)
    ↓
HookCallback → emitEvent()
    ↓
UI: handleToolStart/handleToolComplete
    ↓
React re-render: ToolResult
```

#### OpenCode SDK Client (`src/sdk/opencode-client.ts`)

**Architecture:** SSE (Server-Sent Events) based
- `handleSdkEvent()` at lines 403-518
- Events come through `message.part.updated` with different `part.type` values
- Requires running server process

**Key Differences:**
1. No native hook system—all events via SSE stream
2. Sub-agent tool events must be manually attributed to running subagents (`src/ui/index.ts:426-452`)
3. Dual-path streaming may duplicate content (tracked via `yieldedTextFromResponse`)
4. `question.asked` events → mapped to `permission.requested` with respond callback

#### Copilot SDK Client (`src/sdk/copilot-client.ts`)

**Architecture:** Event-driven with `toolCallId` tracking
- `mapSdkEventToEventType()` at lines 131-148
- `toolCallIdToName` map for correlating tool completion events
- Custom agents via `.github/agents/*.md` or `.github/agents/*.yaml`

**Key Differences:**
1. `toolCallId` required for tool lifecycle correlation (Claude provides names directly)
2. `subagent.failed` maps to `session.error` instead of `subagent.complete` with `success: false`
3. No independent context for sub-agents (shared context unlike Claude/OpenCode)
4. Extended thinking via `assistant.reasoning_delta` (streaming only)

---

### 5. Gaps vs Claude Code UI

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Event type unification | ✅ Complete | `src/sdk/types.ts:253-266` | All SDKs emit unified events |
| Event data normalization | ✅ Complete | SDK clients | Field names normalized |
| Tool rendering | ✅ Complete | `src/ui/tools/registry.ts` | Registry handles SDK params |
| Sub-agent rendering | ✅ Complete | `parallel-agents-tree.tsx` | SDK-agnostic component |
| Collapsible tool outputs | ✅ Complete | `tool-result.tsx` | ctrl+o to expand |
| Animated status indicators | ✅ Complete | `animated-blink-indicator.tsx` | 500ms blink |
| Permission mode footer | ❌ Missing | N/A | Not implemented |
| Spinner verb customization | ❌ Missing | N/A | Fixed loading indicator |
| Timestamp display | ⚠️ Partial | `transcript-view.tsx` | Component exists, inconsistent usage |
| Verbose mode toggle | ⚠️ Partial | `tool-result.tsx` | ctrl+o for tools only |

---

## Code References

### Core Components
- `src/ui/components/tool-result.tsx` - Tool output rendering
- `src/ui/components/parallel-agents-tree.tsx` - Sub-agent tree view
- `src/ui/components/task-list-indicator.tsx` - TODO/task display
- `src/ui/components/animated-blink-indicator.tsx` - Blink animation

### SDK Clients
- `src/sdk/types.ts:253-266` - Unified EventType definition
- `src/sdk/types.ts:321-376` - Event data interfaces
- `src/sdk/types.ts:530-589` - CodingAgentClient interface
- `src/sdk/base-client.ts:32-104` - EventEmitter class
- `src/sdk/claude-client.ts:109-120` - Claude hook mapping
- `src/sdk/claude-client.ts:829-887` - Claude event normalization
- `src/sdk/opencode-client.ts:403-518` - OpenCode SSE handling
- `src/sdk/copilot-client.ts:131-148` - Copilot event mapping

### UI Wiring
- `src/ui/index.ts:381-500` - Tool event subscriptions
- `src/ui/index.ts:555-620` - Sub-agent event subscriptions
- `src/ui/index.ts:510-553` - HITL permission handling

### Tool Registry
- `src/ui/tools/registry.ts:674-697` - Tool renderer registry
- `src/ui/tools/registry.ts:597-646` - Task tool renderer

### Theme & Styling
- `src/ui/theme.tsx` - Catppuccin color definitions

---

## Architecture Documentation

### Event Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SDK Native Events                         │
│  Claude: Hooks | OpenCode: SSE | Copilot: Session Events    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              SDK Clients (claude/opencode/copilot)           │
│  • handleSdkEvent() / native hooks                           │
│  • Map native → EventType                                    │
│  • Normalize field names                                     │
│  • emitEvent(type, sessionId, normalizedData)                │
└─────────────────────────────────────────────────────────────┘
                              │
        Unified: tool.start, tool.complete,
                 subagent.start, subagent.complete
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              UI Layer (src/ui/index.ts)                      │
│  • client.on("tool.start", ...) → ToolResult                 │
│  • client.on("subagent.start", ...) → ParallelAgentsTree     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              SDK-Agnostic Components                         │
│  ToolResult | ParallelAgentsTree | TaskListIndicator         │
└─────────────────────────────────────────────────────────────┘
```

### Standardization Approach

The architecture already implements a clean separation:

1. **Normalization Layer** (`src/sdk/*-client.ts`): Each SDK client maps native events to unified `EventType` values and normalizes field names
2. **Type Definitions** (`src/sdk/types.ts`): `EventDataMap` provides type-safe access to event data
3. **UI Components** (`src/ui/components/*.tsx`): Components consume unified events, no SDK-specific logic
4. **Tool Registry** (`src/ui/tools/registry.ts`): Handles parameter naming differences across SDKs

---

## Historical Context (from research/)

### Existing Research Documents

| Document | Key Insights |
|----------|--------------|
| `research/docs/2026-02-12-sdk-ui-standardization-research.md` | Initial standardization findings |
| `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` | Claude Code target UI patterns |
| `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` | Sub-agent context isolation differences |
| `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md` | Skill discovery and status |
| `research/docs/2026-01-31-opentui-library-research.md` | Framework capabilities |
| `research/progress.txt` | Historical bug fixes |

### Key Historical Decisions

1. **No-Permission Mode Intentional**: Atomic runs all agents in auto-approve mode by design
2. **Tool Output Normalization**: Fixed extraction for `output.text`, `output.value`, `output.data`, `output.result` (progress.txt Task #5)
3. **Sub-Agent Ref Sync Bug**: Fixed `parallelAgentsRef` sync with state changes (progress.txt Tasks #2-3)
4. **`SubagentGraphBridge`**: Was never initialized, required fix for proper event flow

---

## Related Research

- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` - Target UI patterns
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` - Sub-agent visualization
- `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md` - Skill loading UI

---

## Open Questions

1. **Permission Mode Footer**: Should this be implemented given Atomic's auto-approve default? Would require UI toggle.
2. **Spinner Verb Customization**: Is the fixed loading indicator acceptable, or should random verbs be restored?
3. **Timestamp Consistency**: Where should timestamps appear (all tool outputs, only in verbose mode, etc.)?
4. **Copilot `subagent.failed` Mapping**: Should this be changed from `session.error` to `subagent.complete` with `success: false`?
5. **Verbose Mode Scope**: Should ctrl+o expand apply to sub-agent status displays, not just tool outputs?
