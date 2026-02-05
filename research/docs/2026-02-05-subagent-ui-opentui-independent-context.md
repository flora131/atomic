---
date: 2026-02-05 18:10:51 UTC
researcher: Claude Opus 4.6
git_commit: a4e1a05ecd16be789cdfd6d41b75eaf81082f48b
branch: lavaman131/feature/tui
repository: atomic
topic: "Sub-agent UI with OpenTUI and independent context windows via coding agent SDKs"
tags: [research, codebase, sub-agents, opentui, parallel-agents-tree, claude-agent-sdk, opencode-sdk, copilot-sdk, tui, independent-context]
status: complete
last_updated: 2026-02-05
last_updated_by: Claude Opus 4.6
---

# Research: Sub-Agent UI with OpenTUI and Independent Context Windows

## Research Question

Research the current implementation of sub-agents to incorporate OpenTUI support for the sub-agent UI depicted in target_ui screenshots. Pay attention to subtle details in the UI. Also, research how to implement independent context for sub-agents powered by coding agent SDKs (Claude Agent SDK, OpenCode SDK, Copilot SDK). Each sub-agent spawned should have an independent context window.

## Summary

The atomic codebase has a functional but placeholder sub-agent system. The `ParallelAgentsTree` component (`src/ui/components/parallel-agents-tree.tsx`) renders an agent tree with tree connector lines, status icons, and tool use counters -- visually matching the target UI screenshots. However, the `spawnSubagent` implementation in `chat.tsx` is explicitly marked as a placeholder that sends tasks through the normal message flow rather than creating independent sessions. The target UI shows three states: (1) parallel agents running with yellow dot indicators and "Initializing..." status, (2) completed agents with red dot indicators and "Done" status, (3) a single agent "Explore" view during spawn. OpenTUI provides the rendering foundation (React-like JSX with `<box>`, `<text>`, flexbox layout, keyboard hooks) but lacks built-in tree or spinner components -- these must be manually constructed. For independent context, the Claude Agent SDK provides the strongest support via `AgentDefinition` with `query()` (automatic context isolation per subagent) and V2 sessions (`unstable_v2_createSession`). OpenCode uses session forking (`Session.fork()`) with parent-child relationships. The Copilot SDK does not support independent sub-agent context windows -- sub-agents share the parent session's context.

## Detailed Findings

### 1. Target UI Analysis

Three screenshots define the target sub-agent rendering:

#### Screenshot 1: `agent_tree_ui.png` -- Running State
- Header: `"● Running 3 Explore agents... (ctrl+o to expand)"`
- Yellow/accent colored dot (`●`) next to "Running"
- Agent count: "3 Explore agents..."
- Keyboard hint: "(ctrl+o to expand)" in dimmed text
- Tree structure with connector lines:
  ```
  ├─ Explore project structure · 0 tool uses
  │  Initializing...
  ├─ Explore source code structure · 0 tool uses
  │  Initializing...
  └─ [partially visible third agent]
  ```
- Each agent row shows: `{connector} {task description} · {N} tool uses`
- Sub-line shows status text with indent: `│  Initializing...` (or `└  Initializing...` for last)
- Status text ("Initializing...") is dimmed/gray
- Tree connectors: `├─` for non-last, `└─` for last branch
- Vertical continuation: `│` aligns with parent connector

#### Screenshot 2: `agent_tree_ui_stop.png` -- Completed State
- Header: `"● 4 Explore agents finished (ctrl+o to expand)"`
- Red/pink colored dot (`●`) next to the count
- Word "finished" instead of "Running"
- All 4 agents visible:
  ```
  ├─ Explore project structure · 0 tool uses
  │  Done
  ├─ Explore source code structure · 0 tool uses
  │  Done
  ├─ Explore tests and docs · 0 tool uses
  │  Done
  └─ Explore deps and build · 0 tool uses
  └  Done
  ```
- Status text changed from "Initializing..." to "Done"
- Last agent uses `└─` connector, its sub-line uses `└` (no vertical bar)

#### Screenshot 3: `single_agent_view.png` -- Single Agent Spawning
- Shows the initial spawn of exploration agents
- Text: `"Spawn parallel researcher agents to explore the codebase."`
- Response: `"I'll spawn multiple exploration agents in parallel to understand the codebase from different angles"`
- Single agent indicator: `● Explore(Explore codebase structure)`
- Format: `● {AgentType}({task description})`

#### Key UI Details
- **Status dot colors**: Yellow/accent = running, Red/pink = completed
- **Tree indentation**: 4 spaces for connector lines, sub-status indented with `│` or `└` continuation
- **Tool use counter**: Always shown as `· N tool uses` (even when 0)
- **ctrl+o hint**: Persistent in header for expand/collapse
- **Agent naming**: Uses the agent type name (e.g., "Explore") not the full definition name
- **Sub-status text**: "Initializing..." during running, "Done" when completed

### 2. Current Sub-Agent Implementation

#### ParallelAgentsTree Component (`src/ui/components/parallel-agents-tree.tsx`)

**Data Model** (lines 20-52):
```typescript
export type AgentStatus = "pending" | "running" | "completed" | "error" | "background";

export interface ParallelAgent {
  id: string;
  name: string;           // Display name (e.g., "Explore")
  task: string;           // Brief description of work
  status: AgentStatus;
  model?: string;
  startedAt: string;      // ISO timestamp
  durationMs?: number;
  background?: boolean;
  error?: string;
  result?: string;
  toolUses?: number;
  tokens?: number;
  currentTool?: string;   // Current tool operation
}
```

**Tree Characters** (lines 101-106):
```typescript
const TREE_CHARS = {
  branch: "├─",
  lastBranch: "└─",
  vertical: "│ ",
  space: "  ",
};
```

**Status Icons** (lines 73-79):
```typescript
export const STATUS_ICONS: Record<AgentStatus, string> = {
  pending: "○",
  running: "◐",
  completed: "●",
  error: "✕",
  background: "◌",
};
```

**Agent Colors** (lines 85-96): Named agents get specific colors:
- `Explore` = blue, `Plan` = purple, `Bash` = green
- `debugger` = red, `codebase-analyzer` = orange
- Unknown types = gray (`#9ca3af`)

**Rendering** (lines 295-393):
- Renders only when `agents.length > 0`
- Agents sorted by status priority: running(0) > pending(1) > background(2) > completed(3) > error(4)
- `maxVisible` limits display (default 5), overflow shows "...and N more"
- Header shows running count with accent color or completed count with success color
- "(ctrl+o to expand)" hint appended to header
- Compact mode: `{connector} {task (40 chars)} · {metrics}` with optional `currentTool` sub-line
- Full mode: bold task with metrics, result summary (green), or error (red)

**ChatApp Integration** (`src/ui/chat.tsx:2179-2186`):
```tsx
{parallelAgents.length > 0 && (
  <ParallelAgentsTree
    agents={parallelAgents}
    compact={true}
    maxVisible={5}
  />
)}
```

#### spawnSubagent Implementation (`src/ui/chat.tsx:1477-1549`)

The current implementation is explicitly a **placeholder** (comment at line 1479):
> "This is a placeholder that sends the task through the normal message flow. In the future, this should spawn a dedicated sub-agent session."

Flow:
1. Generates unique 8-char agent ID via `crypto.randomUUID().slice(0, 8)` (line 1491)
2. Creates `ParallelAgent` with `status: "running"` (lines 1497-1504)
3. Adds to `parallelAgents` state triggering re-render (line 1507)
4. Sends task through normal message flow via `sendMessageRef.current(taskMessage)` (line 1514)
5. After 500ms timeout, marks as `"completed"` (lines 1520-1524)
6. After 3500ms total, removes from display (lines 1527-1529)

**Critical gap**: No independent session/context is created. All sub-agent work goes through the same conversation context.

#### SDK Event System (`src/sdk/types.ts:237-340`)

Events defined but **not wired to UI**:
```typescript
export interface SubagentStartEventData extends BaseEventData {
  subagentId: string;
  subagentType?: string;
  task?: string;
}
export interface SubagentCompleteEventData extends BaseEventData {
  subagentId: string;
  result?: unknown;
  success: boolean;
}
```

- Claude Client maps `"subagent.start"` → `"SubagentStart"` hook, `"subagent.complete"` → `"SubagentStop"` hook (`src/sdk/claude-client.ts:111-112`)
- Copilot Client maps `"subagent.started"` → `"subagent.start"`, `"subagent.completed"` → `"subagent.complete"` (`src/sdk/copilot-client.ts:130-132, 479-495`)
- **UI integration gap**: `startChatUI` (`src/ui/index.ts`) subscribes to tool events but NOT to `"subagent.start"` or `"subagent.complete"` events

#### Graph Engine Agents (`src/graph/nodes.ts`)

- `agentNode()` factory (lines 163-263): Creates a session via `client.createSession()`, streams response, then calls `session.destroy()` in finally block -- these are independent sessions
- `parallelNode()` factory (lines 981-1020): Returns `goto: branches` for multiple nodes, but `GraphExecutor` processes them sequentially (queue-based, not truly parallel)
- `DEFAULT_GRAPH_CONFIG` sets `maxConcurrency: 1` (`src/graph/types.ts:640`)

#### Agent Discovery (`src/ui/commands/agent-commands.ts`)

- 7 builtin agents defined in `BUILTIN_AGENTS` (lines 240-988)
- Disk discovery from `.claude/agents`, `.opencode/agents`, `.github/agents`, `.atomic/agents` (project-local) and `~/.claude/agents`, `~/.opencode/agents`, `~/.copilot/agents`, `~/.atomic/agents` (user-global)
- Priority: project(4) > atomic(3) > user(2) > builtin(1)
- Each agent becomes a slash command in `globalRegistry`

### 3. OpenTUI Framework

**Source**: [DeepWiki - anomalyco/opentui](https://deepwiki.com/anomalyco/opentui)

OpenTUI is a TypeScript TUI framework with three layers: application (React/SolidJS/vanilla), TypeScript core (`@opentui/core` with `CliRenderer` and `Renderable`), and a native Zig rendering layer for performance. It requires the **Bun** runtime.

#### Available Components

| Component | JSX Tag | Relevant to Target UI |
|-----------|---------|----------------------|
| `BoxRenderable` | `<box>` | Layout container with flexbox, borders, padding |
| `TextRenderable` | `<text>` | Styled text with `fg`, `attributes` (BOLD, DIM) |
| `ScrollBoxRenderable` | `<scrollbox>` | Scrollable container |
| `SelectRenderable` | `<select>` | List selection |
| `MarkdownRenderable` | `<markdown>` | Markdown rendering |
| `InputRenderable` | `<input>` | Single-line text input |

#### What OpenTUI Does NOT Have (Relevant Gaps)
- **No tree component** -- Tree connector lines (`├─`, `└─`, `│`) must be manually constructed via `<text>` elements
- **No spinner/progress indicator** -- Must be built manually with timer-based state updates
- **No accordion/collapsible** -- Must use conditional rendering (`{show && <box>...</box>}`)

#### Dynamic Updates
- Double buffering with cell-level diffing in Zig
- State/prop changes trigger `requestRender()` → throttled frame update
- Yoga layout engine for flexbox positioning
- React reconciler calls `instance.requestRender()` on `commitUpdate`

#### Keyboard Support
- `useKeyboard(callback, options?)` hook with full modifier support (`ctrl`, `meta`, `shift`)
- `KeyEvent` object: `name`, `ctrl`, `meta`, `shift`, `sequence`, `eventType`
- Supports ctrl+o for expand/collapse as shown in target UI

#### Colors
- `RGBA.fromHex("#RRGGBB")`, `RGBA.fromInts(r, g, b, a)`, CSS color names
- Props: `fg`, `bg`, `borderColor`, `focusedBorderColor`, `textColor`
- `TextAttributes`: `BOLD`, `UNDERLINE`, `DIM` (combinable via bitwise OR)

#### Packages
- `@opentui/core` -- imperative API
- `@opentui/react` -- React reconciler (JSX with `<box>`, `<text>`)
- `@opentui/solid` -- SolidJS reconciler
- Platform-specific native binaries for macOS, Linux, Windows (x64 and ARM64)

#### Relationship to OpenCode
OpenTUI is a separate library (`github.com/anomalyco/opentui`). OpenCode's TUI is built with SolidJS on top of `@opentui/solid`. OpenCode migrated from Go+Bubbletea to OpenTUI (Zig+SolidJS). The TUI runs in the same process as OpenCode's HTTP server.

### 4. Independent Context Per Sub-Agent: Claude Agent SDK

**Source**: [Claude Agent SDK Docs](https://platform.claude.com/docs/en/agent-sdk/subagents), local docs at `docs/claude-agent-sdk/typescript-sdk.md` and `docs/claude-agent-sdk/typescript-v2-sdk.md`

#### Approach A: `agents` option with `query()` (V1) -- Automatic Context Isolation

Define subagents programmatically via `options.agents`:

```typescript
type AgentDefinition = {
  description: string;    // When to use this agent
  tools?: string[];       // Allowed tools (inherits all if omitted)
  prompt: string;         // System prompt
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}
```

**Context isolation guarantees**:
- Each subagent operates with its own isolated context window
- Only the final result string is returned to the parent
- Subagent transcripts persist independently (stored in separate files)
- Main conversation compaction does not affect subagent transcripts
- No recursive subagents (don't include `Task` in subagent's tools)

**Invocation**: Via `Task` tool. Must include `Task` in `allowedTools`. Claude decides automatically when to delegate based on `description` field.

**Detection**: Messages from subagents include `parent_tool_use_id`. Check for `tool_use` blocks where `name === "Task"`.

**Resuming**: Capture `session_id` and `agentId` (from Task tool result), pass `resume: sessionId` in subsequent query.

#### Approach B: V2 Sessions -- Explicit Session Objects

```typescript
// Create independent sessions
const session1 = unstable_v2_createSession({ model: 'claude-sonnet-4-5-20250929' });
const session2 = unstable_v2_createSession({ model: 'claude-sonnet-4-5-20250929' });

// Each session has isolated context
await session1.send('Task A');
await session2.send('Task B');

// Stream responses independently
for await (const msg of session1.stream()) { /* ... */ }
for await (const msg of session2.stream()) { /* ... */ }

// Resume later
const resumed = unstable_v2_resumeSession(sessionId, { model: '...' });
```

**V2 limitations**: Preview API (unstable), no session forking yet, some advanced streaming patterns unavailable.

#### Hook Events for Lifecycle Tracking

| Hook Event | Input Fields | SDK Support |
|------------|-------------|-------------|
| `SubagentStart` | `agent_id`, `agent_type` | TypeScript only |
| `SubagentStop` | `stop_hook_active` | TypeScript + Python |

`SubagentStart` supports matchers to target specific agent types. `SubagentStop` fires for all agent types (matchers ignored).

**Lifecycle flow**: `SubagentStart` → subagent executes (tool calls with `parent_tool_use_id`) → `SubagentStop`

### 5. Independent Context Per Sub-Agent: OpenCode SDK

**Source**: [DeepWiki - anomalyco/opencode](https://deepwiki.com/anomalyco/opencode)

#### Session Architecture
- Sessions created via `/session` API endpoint with title and `cwd`
- `parentID` establishes parent-child relationships
- Each project directory gets isolated `Instance` context
- Sessions stored per-project in `~/.local/share/opencode/`

#### Independent Context via Session Forking
- `Session.fork()` clones a session up to a specific message, creating a child session
- Child sessions have `parentID` set, retrievable via `Session.children(parentID)`
- Users navigate parent-child sessions via `<Leader>+Right` keybind

#### Task Tool Sub-Agent Pattern
- `subagent_type` parameter selects which agent to invoke
- Multiple agents launchable concurrently in a single message
- Each invocation is stateless unless you provide a `session_id`
- `createToolContext` creates a new session specifically for debugging tool runs

#### Agent System
| Agent | Mode | Description |
|-------|------|-------------|
| `build` | primary | Default full-access development agent |
| `plan` | primary | Planning/analysis, disallows file edits |
| `general` | subagent | General-purpose research agent |
| `explore` | subagent | Fast read-only codebase exploration |
| `compaction` | hidden | Context compaction |
| `title` | hidden | Session title generation |
| `summary` | hidden | Summarization |

#### Tool-Level State Machine
| State | Description |
|-------|-------------|
| `pending` | Tool call received, not executing |
| `running` | Tool actively executing |
| `completed` | Tool finished successfully |
| `error` | Tool execution failed |

#### Session Status
| Status | Description |
|--------|-------------|
| `idle` | Not processing |
| `busy` | Currently executing |
| `retry` | Retrying with attempt count and error |

### 6. Independent Context Per Sub-Agent: Copilot SDK

**Source**: [DeepWiki - github/copilot-sdk](https://deepwiki.com/github/copilot-sdk)

#### Session Isolation
- Each `CopilotSession` has unique `SessionID` for event routing
- Separate event handlers, tool handlers, permission handlers per session
- Per-session mutexes for thread-safe concurrent access (Go SDK)
- Independent configuration: custom tools, system message, tool filtering

#### Sub-Agent Limitations
- **No independent sub-agent context windows**: Sub-agents share the parent session's context
- SDK cannot programmatically spawn sub-agents -- only observes lifecycle via events
- Custom agents (`CustomAgentConfig`) are configuration-time personas, not runtime spawned
- All orchestration is delegated to the Copilot CLI server

#### Sub-Agent Events (Read-Only)
| Event | Fields |
|-------|--------|
| `SubagentStartedEvent` | `toolCallId`, `agentName`, `agentDisplayName`, `agentDescription` |
| `SubagentCompletedEvent` | `toolCallId`, `agentName` |
| `SubagentFailedEvent` | `toolCallId`, `agentName`, `error` |

#### Infinite Sessions (Context Compaction)
- Background compaction at 80% context usage (continues processing)
- Buffer exhaustion at 95% (blocks until compaction completes)
- Per-session workspace at `~/.copilot/session-state/{sessionId}/`

#### Event System
37 event types auto-generated from `@github/copilot/session-events.schema.json`:
- Session lifecycle: `session.start`, `session.resume`, `session.idle`, `session.error`
- Tool events: `tool.execution_start`, `tool.execution_complete`, `tool.execution_progress`
- Agent events: `subagent.started`, `subagent.completed`, `subagent.failed`, `subagent.selected`

## Code References

### Current Implementation
- `src/ui/components/parallel-agents-tree.tsx:20-52` -- `ParallelAgent` interface and `AgentStatus` type
- `src/ui/components/parallel-agents-tree.tsx:73-79` -- Status icons definition
- `src/ui/components/parallel-agents-tree.tsx:85-96` -- Agent color mapping
- `src/ui/components/parallel-agents-tree.tsx:101-106` -- Tree connector characters
- `src/ui/components/parallel-agents-tree.tsx:193-273` -- `AgentRow` component (compact and full modes)
- `src/ui/components/parallel-agents-tree.tsx:295-393` -- `ParallelAgentsTree` main component
- `src/ui/chat.tsx:1477-1549` -- `spawnSubagent` placeholder implementation
- `src/ui/chat.tsx:2179-2186` -- ParallelAgentsTree rendering in ChatApp
- `src/ui/chat.tsx:924` -- `parallelAgents` state declaration
- `src/ui/chat.tsx:1261-1266` -- Handler registration for parallel agents
- `src/ui/commands/agent-commands.ts:240-988` -- 7 builtin agent definitions
- `src/ui/commands/agent-commands.ts:1321-1408` -- Agent discovery from disk
- `src/ui/commands/agent-commands.ts:1450-1562` -- Agent command creation and registration
- `src/sdk/types.ts:237-340` -- SubagentStart/SubagentComplete event data types
- `src/sdk/claude-client.ts:111-112` -- Claude subagent event mapping
- `src/sdk/copilot-client.ts:130-132,479-495` -- Copilot subagent event mapping
- `src/ui/index.ts:274-378` -- Event subscriptions (missing subagent events)
- `src/graph/nodes.ts:163-263` -- `agentNode()` factory with session creation
- `src/graph/nodes.ts:981-1020` -- `parallelNode()` factory
- `src/graph/compiled.ts:454-457` -- Parallel node queue processing
- `src/graph/types.ts:640-644` -- `DEFAULT_GRAPH_CONFIG` (`maxConcurrency: 1`)

### External SDK Documentation
- `docs/claude-agent-sdk/typescript-sdk.md` -- Full V1 TypeScript SDK API reference
- `docs/claude-agent-sdk/typescript-v2-sdk.md` -- V2 session-based preview API
- `docs/copilot-cli/usage.md` -- Copilot CLI usage with custom agents
- `docs/copilot-cli/hooks.md` -- Copilot hooks configuration
- `docs/copilot-cli/skills.md` -- Copilot skills system

## Architecture Documentation

### Current Agent Architecture

```
User Input → Slash Command Registry → Agent Command Execute
                                           ↓
                                   context.sendMessage(prompt)
                                           ↓
                                   [Same conversation context]
                                           ↓
                                   spawnSubagent() placeholder
                                           ↓
                                   ParallelAgent added to state
                                           ↓
                                   ParallelAgentsTree re-renders
                                           ↓
                                   500ms timeout → mark "completed"
                                           ↓
                                   3500ms timeout → remove from display
```

### Graph Engine Agent Architecture (Separate Path)

```
GraphExecutor.stream() → Node Queue → agentNode.execute()
                                           ↓
                                   CodingAgentClient.createSession()
                                           ↓
                                   [Independent session with own context]
                                           ↓
                                   session.stream(message) → AgentMessage[]
                                           ↓
                                   session.getContextUsage()
                                           ↓
                                   session.destroy() (always in finally)
```

### SDK Independent Context Comparison

| Feature | Claude Agent SDK | OpenCode SDK | Copilot SDK |
|---------|-----------------|--------------|-------------|
| Independent context per subagent | Yes (automatic via `AgentDefinition`) | Yes (via `Session.fork()`) | No (shared context) |
| Programmatic subagent spawning | Yes (`agents` option + `Task` tool) | Yes (`Task` tool + `session.create`) | No (CLI-controlled) |
| Session resume | Yes (`resume` option / V2 `resumeSession`) | Yes (`Session.fork()` with `parentID`) | Yes (`session.resume`) |
| Subagent lifecycle events | `SubagentStart`, `SubagentStop` | `subagent.start`, `subagent.complete` | `subagent.started`, `subagent.completed`, `subagent.failed` |
| Context compaction | Auto on threshold | Auto via `SessionPrompt.loop()` | Auto at 80%/95% thresholds |
| Parallel subagent execution | Yes (multiple `Task` calls) | Yes (multiple Task calls) | No (sequential via CLI) |
| Transcript persistence | Separate files per subagent | Separate session storage | Shared session workspace |

### OpenTUI Component Mapping for Target UI

| Target UI Element | OpenTUI Implementation |
|-------------------|----------------------|
| Tree connector lines (`├─`, `└─`, `│`) | Manual `<text>` elements with Unicode characters |
| Status dots (`●`) | `<text>` with colored `fg` prop |
| "Running N agents..." header | `<text>` with BOLD attribute |
| "(ctrl+o to expand)" hint | `<text>` with DIM attribute |
| Tool use counter | `<text>` with dimmed color |
| "Initializing..." / "Done" sub-status | `<text>` with DIM attribute, indented |
| Agent row layout | `<box flexDirection="row">` with child `<text>` |
| Vertical agent list | `<box flexDirection="column">` |
| Expandable/collapsible | Conditional rendering + `useKeyboard` for ctrl+o |
| Color-coded agent types | `RGBA.fromHex()` with agent color mapping |

## Historical Context (from research/)

### Directly Related Research
- `research/docs/2026-01-31-opentui-library-research.md` -- Previous OpenTUI research covering component system
- `research/docs/2026-01-31-claude-agent-sdk-research.md` -- Claude Agent SDK v2 research with session patterns
- `research/docs/2026-01-31-opencode-sdk-research.md` -- OpenCode SDK research with agent orchestration
- `research/docs/2026-01-31-github-copilot-sdk-research.md` -- Copilot SDK research with agent detection
- `research/docs/2026-01-31-graph-execution-pattern-design.md` -- Graph execution for agent DAG workflows
- `research/docs/2026-02-01-chat-tui-parity-implementation.md` -- TUI parity across Claude/OpenCode/Copilot
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` -- Claude Code UI patterns for Atomic TUI
- `research/docs/2026-02-04-agent-subcommand-parity-audit.md` -- Agent subcommand standardization

### Related Specs
- `specs/sdk-migration-and-graph-execution.md` -- SDK migration with graph execution patterns
- `specs/chat-tui-parity-implementation.md` -- Chat TUI parity TDD
- `specs/claude-code-ui-patterns-enhancement.md` -- UI patterns enhancement TDD
- `specs/pluggable-workflows-sdk.md` -- Pluggable workflows with agent definitions

## Related Research

- `research/docs/2026-01-31-sdk-migration-and-graph-execution.md` -- Comprehensive SDK comparison covering all three SDKs
- `research/docs/2026-01-31-atomic-current-workflow-architecture.md` -- Current workflow, SDK, command, and configuration architecture
- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` -- Pluggable workflows SDK design for atomic/workflows

## Open Questions

1. **OpenTUI Bun requirement**: The atomic codebase currently uses Node.js (TypeScript 5.9.3). OpenTUI requires Bun. How will the runtime transition be handled? Will the TUI module be isolated to run under Bun while the rest stays on Node?

2. **Parallel execution gap**: `GraphExecutor` processes parallel branches sequentially (`maxConcurrency: 1`). True parallel sub-agent execution would require either increasing `maxConcurrency` or spawning actual concurrent sessions outside the graph engine.

3. **Event wiring**: The `SubagentStart`/`SubagentComplete` events are defined in `src/sdk/types.ts` but not wired to the UI in `startChatUI` (`src/ui/index.ts`). The `registerParallelAgentHandler` prop is defined but never passed from `startChatUI` to `ChatApp`.

4. **V2 SDK stability**: The Claude Agent SDK V2 session API is marked as unstable preview. Session forking is only available in V1. The implementation should be prepared for API changes or use V1 as fallback.

5. **Copilot SDK limitation**: The Copilot SDK does not support independent sub-agent context. If the system needs to support Copilot as a backend, an alternative approach (e.g., creating multiple independent Copilot sessions at the application level rather than relying on the SDK's sub-agent mechanism) would be required.

6. **OpenTUI production readiness**: OpenTUI explicitly states it is not production-ready. Risk assessment is needed before adopting it as the primary TUI framework.

7. **Agent result collection**: The placeholder `spawnSubagent` uses a 500ms fixed timeout to mark completion. Real implementation needs to stream agent results and detect actual completion via SDK events.
