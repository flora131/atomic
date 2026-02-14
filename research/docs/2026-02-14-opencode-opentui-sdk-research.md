---
date: 2026-02-14 06:50:57 UTC
researcher: Claude Sonnet 4.5
topic: "OpenCode SDK and OpenTUI Research: Sub-agent Spawning and Result Collection"
tags: [research, opencode, opentui, sdk, sub-agents, task-tool, result-propagation, session-management]
status: complete
---

# OpenCode SDK and OpenTUI Research: Sub-agent Spawning and Result Collection

## Research Question

Research the OpenCode SDK (repo: anomalyco/opencode) to understand how it handles sub-agent/task spawning and result collection. The Atomic CLI project uses this SDK. Also research the OpenTUI library (repo: anomalyco/opentui) for TUI rendering of nested agent/task results.

## Summary

The OpenCode SDK provides a comprehensive sub-agent orchestration system built around the **TaskTool**, which creates independent sessions with parent-child relationships via `parentID`. Results are propagated through structured `<task_result>` XML tags containing the task_id and final text output. The SDK tracks sub-agent execution through Server-Sent Events (SSE) with message parts (AgentPart → subagent.start, StepFinishPart → subagent.complete). OpenTUI provides the rendering foundation with React/SolidJS reconcilers, flexbox layout via Yoga, and manual tree construction using Unicode characters. The Atomic CLI already has working sub-agent event mapping but creates fully independent sessions rather than using SDK-native sub-agent APIs.

## Detailed Findings

### 1. OpenCode SDK: Sub-Agent Creation and Management

#### 1.1 TaskTool Architecture

**File**: `packages/opencode/src/tool/task.ts`

The TaskTool is the primary mechanism for sub-agent delegation. It accepts parameters:

```typescript
// TaskTool parameters (zod schema)
{
  description: string,      // Brief task description
  prompt: string,           // Detailed instructions for sub-agent
  subagent_type: string,    // Which specialized agent to use
  task_id?: string,         // Optional: resume previous session
  command?: string          // Optional: command to execute
}
```

**Agent Types Available**:
- `build` - Primary full-access development agent (mode: primary)
- `plan` - Primary planning/analysis agent, disallows file edits (mode: primary)
- `general` - General-purpose research sub-agent (mode: subagent)
- `explore` - Fast read-only codebase exploration (mode: subagent)
- `compaction` - Hidden agent for context compaction
- `title` - Hidden agent for session title generation
- `summary` - Hidden agent for summarization

#### 1.2 Agent Mode System

**File**: `packages/web/src/content/docs/agents.mdx`

Agents are configured with a `mode` field:
- `mode: "primary"` - Main conversational agents users interact with directly
- `mode: "subagent"` - Specialized assistants invoked via TaskTool
- `mode: "all"` - Can be both primary and subagent

Agent definitions can be placed in:
- `opencode.json` - JSON configuration file
- `~/.config/opencode/agents/*.md` - User-global markdown files with YAML frontmatter
- `.opencode/agents/*.md` - Project-local markdown files with YAML frontmatter

#### 1.3 Permission System

**File**: `opencode.json` and `packages/web/src/content/docs/agents.mdx`

The `permission.task` configuration controls which subagents can be invoked:

```json
{
  "permission": {
    "task": [
      { "allow": ["explore", "general"] },
      { "deny": ["build"] }
    ]
  }
}
```

Rules are evaluated in order, with the last matching rule taking precedence. Denied subagents are removed from the TaskTool's description, preventing the model from attempting to invoke them.

### 2. OpenCode SDK: Result Propagation

#### 2.1 Session Creation Flow

**Lifecycle**:
1. **Tool Call Initiation**: `SessionPrompt.loop()` creates an `AssistantMessage` with agent metadata (name, modelID, providerID)
2. **Permission Check**: `PermissionNext.ask()` verifies agent has permission to invoke the subagent_type
3. **Session Creation**: `TaskTool.execute()` creates new session with:
   - `parentID` set to calling session's ID
   - Title derived from task description and sub-agent name
   - Specific permissions for the sub-agent
4. **Metadata Update**: `ToolPart.metadata` is updated with sub-agent session ID and model

**Session Storage**:
- Sessions stored per-project in `~/.local/share/opencode/`
- Each project directory gets isolated `Instance` context
- Child sessions retrievable via `Session.children(parentID)`

#### 2.2 Result Structure

**File**: `packages/opencode/src/tool/task.ts` (TaskTool.execute method)

The TaskTool returns results in a structured format:

```typescript
const output = [
  `task_id: ${session.id} (for resuming to continue this task if needed)`,
  "",
  "<task_result>",
  text,  // Final text from sub-agent's last message
  "</task_result>",
].join("\n")
```

**Key Components**:
- `task_id`: Session ID for resuming the sub-agent later
- `<task_result>` tags: XML-style markers for easy parsing
- `text`: Extracted from the last text part of the sub-agent's response

#### 2.3 Tool Result Formatting

**File**: Referenced in DeepWiki response about result propagation

Tool results are handled as `ToolPart` messages within the session:

```typescript
// ToolPart state transitions
{
  type: "tool",
  status: "pending" | "running" | "completed" | "error",
  output?: string | { text: string, attachments: Attachment[] },
  metadata?: { sessionId: string, model: string }
}
```

The `toModelMessages()` function converts internal message representations into model-compatible format:
- Completed tool: `output` field populated with text and optional attachments
- Error tool: `output` contains error message
- Media attachments: If model doesn't support media in tool results, converted to separate user message

#### 2.4 Message Part Types

**File**: `packages/opencode/src/tool/task.ts` and SSE event handling

OpenCode uses typed message parts for different content:

| Part Type | Purpose | Fields |
|-----------|---------|--------|
| `text` | Plain text content | `content: string` |
| `tool-invocation` | Tool call | `tool: string, state: unknown` |
| `agent` | Sub-agent start marker | `id: string, name: string, sessionID: string, messageID: string` |
| `step-finish` | Sub-agent completion | `id: string, reason: "completed" \| "error"` |

### 3. OpenCode SDK: Event System and Tracking

#### 3.1 Server-Sent Events (SSE)

**File**: `src/sdk/opencode-client.ts:505-520` (Atomic implementation)

OpenCode uses SSE for real-time updates. The client maps SDK events to unified event types:

```typescript
// AgentPart detection
if (part?.type === "agent") {
  this.emitEvent("subagent.start", partSessionId, {
    subagentId: (part?.id as string) ?? "",
    subagentType: (part?.name as string) ?? "",
  });
}

// StepFinishPart detection
if (part?.type === "step-finish") {
  this.emitEvent("subagent.complete", partSessionId, {
    subagentId: (part?.id as string) ?? "",
    success: reason !== "error",
  });
}
```

#### 3.2 Session Status States

**File**: Referenced in DeepWiki response

| Status | Description |
|--------|-------------|
| `idle` | Session not processing |
| `busy` | Session currently executing |
| `retry` | Retrying with attempt count and error |

Status events: `session.status` with `properties.status.type`

#### 3.3 Tool State Machine

**File**: Referenced in DeepWiki response

| State | Description |
|-------|-------------|
| `pending` | Tool call received, not executing |
| `running` | Tool actively executing |
| `completed` | Tool finished successfully |
| `error` | Tool execution failed |

### 4. Atomic CLI Integration

#### 4.1 Current Sub-agent Architecture

**File**: `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md`

The Atomic CLI has a **disconnect** between built-in agents and SDK-native sub-agent APIs:

```
User Types Command (/codebase-analyzer)
           |
           v
    agent-commands.ts
    createAgentCommand()
           |
           v
    CommandContext.spawnSubagent()
           |
           v
    SubagentSessionManager.spawn()
           |
           v
    SDK Client.createSession({ systemPrompt, model, tools })
           |
           v
    Independent SDK Session (NOT native sub-agent)
```

**Issue**: Built-in agents (codebase-analyzer, codebase-locator, etc.) are NOT registered with OpenCode's native agent system. They create fully independent sessions instead of using TaskTool-based sub-agents.

#### 4.2 Event Mapping Implementation

**File**: `src/sdk/__tests__/subagent-event-mapping.test.ts:150-294`

The OpenCode client correctly maps events:

```typescript
// Test: AgentPart emits subagent.start
callHandleSdkEvent(client, {
  type: "message.part.updated",
  properties: {
    sessionID: "oc-session-1",
    part: {
      type: "agent",
      id: "agent-123",
      name: "explore",
      sessionID: "oc-session-1",
      messageID: "msg-1",
    },
  },
});
// Result: subagent.start event with subagentId="agent-123", subagentType="explore"

// Test: StepFinishPart emits subagent.complete
callHandleSdkEvent(client, {
  type: "message.part.updated",
  properties: {
    sessionID: "oc-session-2",
    part: {
      type: "step-finish",
      id: "agent-456",
      reason: "completed",
    },
  },
});
// Result: subagent.complete event with success=true
```

#### 4.3 SubagentGraphBridge

**File**: `src/ui/__tests__/spawn-subagent-integration.test.ts`

The Atomic CLI uses `SubagentGraphBridge` to create independent sessions:

```typescript
// Bridge creates sessions via factory
const sessionConfig: SessionConfig = {
  systemPrompt: options.systemPrompt,
  model: options.model,
  tools: options.tools,
};
session = await this.createSession(sessionConfig);

// Stream response and track tool uses
for await (const msg of session.stream(options.task)) { 
  // Accumulate text, count tool uses
}

// Cleanup in finally block
await session.destroy();
```

**Benefits of Independent Sessions**:
- Isolation: Each sub-agent has completely separate context
- Cleanup: Explicit session destruction prevents leaks
- Flexibility: Can use any model/tools without SDK constraints

**Drawbacks**:
- No context inheritance from parent
- No SDK-optimized sub-agent orchestration
- Events mapped manually, not from native lifecycle

### 5. OpenTUI: Rendering Architecture

#### 5.1 Component Catalog

**Source**: DeepWiki - anomalyco/opentui

OpenTUI provides a React-like TUI framework with three layers:

1. **Application Layer**: React (`@opentui/react`) or SolidJS (`@opentui/solid`)
2. **TypeScript Core**: `@opentui/core` with `CliRenderer` and `Renderable` classes
3. **Native Layer**: Zig rendering for performance with double buffering

**Available Components**:

| JSX Tag | Class | Use for Nested Agents |
|---------|-------|----------------------|
| `<box>` | `BoxRenderable` | Container with flexbox layout, borders, padding |
| `<text>` | `TextRenderable` | Styled text with colors and attributes (BOLD, DIM) |
| `<scrollbox>` | `ScrollBoxRenderable` | Scrollable container for long lists |
| `<select>` | `SelectRenderable` | List selection (not needed) |
| `<markdown>` | `MarkdownRenderable` | Rich markdown content |
| `<input>` | `InputRenderable` | Text input (not needed) |

#### 5.2 Tree Construction (Manual)

**File**: `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md`

OpenTUI **does not have** a built-in tree component. Tree connectors must be manually constructed:

```typescript
// Tree characters (from Atomic implementation)
const TREE_CHARS = {
  branch: "├─",
  lastBranch: "└─",
  vertical: "│ ",
  space: "  ",
};

// Render tree structure
<box flexDirection="column">
  <text>{connector} {agentName} · {toolUses} tool uses</text>
  <text fg={RGBA.fromHex("#9ca3af")}>{statusLine} {status}</text>
</box>
```

**Visual Output**:
```
├─ Explore project structure · 0 tool uses
│  Initializing...
├─ Explore source code structure · 0 tool uses
│  Initializing...
└─ Explore deps and build · 0 tool uses
└  Done
```

#### 5.3 Flexbox Layout with Yoga

**Source**: DeepWiki response

OpenTUI uses the **Yoga** layout engine for flexbox positioning:

```tsx
<box flexDirection="column" gap={1} padding={2}>
  <box border title="Section 1" flexDirection="row" alignItems="center">
    <text>● Running</text>
    <text fg={RGBA.fromHex("#6b7280")}> · 3 agents</text>
  </box>
  <box flexDirection="column" paddingLeft={2}>
    {agents.map(agent => <AgentRow agent={agent} />)}
  </box>
</box>
```

**Props Available**:
- Layout: `flexDirection`, `alignItems`, `justifyContent`, `gap`, `padding`, `margin`
- Visual: `border`, `borderColor`, `focusedBorderColor`, `bg`, `fg`
- Size: `width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`

#### 5.4 Dynamic Updates and Rendering

**Source**: DeepWiki response

OpenTUI supports state-driven re-rendering:

1. **Double Buffering**: Cell-level diffing in Zig minimizes terminal writes
2. **Throttled Frames**: State/prop changes trigger `requestRender()` with throttling
3. **React Reconciler**: `commitUpdate` calls `instance.requestRender()` automatically

**Example**: Spinner/progress indicator (not built-in)

```tsx
function AgentSpinner() {
  const [frame, setFrame] = useState(0);
  const frames = ["◐", "◓", "◑", "◒"];
  
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % frames.length);
    }, 100);
    return () => clearInterval(timer);
  }, []);
  
  return <text>{frames[frame]}</text>;
}
```

#### 5.5 Keyboard Support

**Source**: DeepWiki response

The `useKeyboard` hook provides full keyboard control:

```tsx
import { useKeyboard } from "@opentui/react";

function CollapsibleAgentTree() {
  const [expanded, setExpanded] = useState(false);
  
  useKeyboard((event) => {
    if (event.ctrl && event.name === "o") {
      setExpanded(!expanded);
    }
  });
  
  return (
    <box>
      <text>● Running agents... (ctrl+o to expand)</text>
      {expanded && <AgentDetails />}
    </box>
  );
}
```

**KeyEvent Fields**:
- `name`: Key name (e.g., "o", "enter", "up", "down")
- `ctrl`, `meta`, `shift`: Modifier booleans
- `sequence`: Raw escape sequence
- `eventType`: "keypress" | "keydown" | "keyup"

#### 5.6 OpenCode TUI Implementation

**Source**: DeepWiki response

OpenCode's TUI is built with **SolidJS** on top of `@opentui/solid`:

- Migrated from Go+Bubbletea to OpenTUI (Zig+SolidJS)
- TUI runs in the same process as OpenCode's HTTP server
- Uses `@opentui/solid` reconciler for reactive updates

**File**: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

The `Task` component renders TaskTool execution status:
- Displays sub-agent session ID from `ToolPart.metadata`
- Shows progress and completion state
- Enables navigation to sub-agent session

### 6. Atomic CLI: Current Implementation vs SDK-Native

#### 6.1 Built-in Agents Definition

**File**: `src/ui/commands/agent-commands.ts:237-1156`

Seven built-in agents are defined:

| Agent Name | Tools | Model | Purpose |
|-----------|-------|-------|---------|
| `codebase-analyzer` | Glob, Grep, NotebookRead, Read, LS, Bash | opus | Analyzes implementation details |
| `codebase-locator` | Glob, Grep, NotebookRead, Read, LS, Bash | opus | Locates files/directories |
| `codebase-pattern-finder` | Glob, Grep, NotebookRead, Read, LS, Bash | opus | Finds similar implementations |
| `codebase-online-researcher` | Glob, Grep, Read, WebFetch, WebSearch, MCP | opus | Web research with DeepWiki |
| `codebase-research-analyzer` | Read, Grep, Glob, LS, Bash | opus | Extracts insights from research/ |
| `codebase-research-locator` | Read, Grep, Glob, LS, Bash | opus | Discovers research/ documents |
| `debugger` | All tools including DeepWiki MCP | opus | Debugs errors and test failures |

#### 6.2 Skills and Sub-agent Invocation Issue

**File**: `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md:444-503`

Skills like `/research-codebase` use `context.sendSilentMessage()` to instruct the main agent to use the TaskTool:

```markdown
**For codebase research:**
- Use the **codebase-locator** agent to find WHERE files and components live
- Use the **codebase-analyzer** agent to understand HOW specific code works
```

**The Problem**: When the main agent tries to use the TaskTool with `subagent_type="codebase-analyzer"`, the OpenCode SDK cannot find it because:
- Built-in agents are NOT in `opencode.json`
- No `.opencode/agents/codebase-analyzer.md` file exists
- Agents are only registered in Atomic's `BUILTIN_AGENTS` array

**Execution Paths**:

```
SKILL EXECUTION PATH (BROKEN)
/research-codebase
    │
    v
skill-commands.ts
context.sendSilentMessage(skillPrompt)
    │
    v
Main Session receives prompt with TaskTool instructions
    │
    v
TaskTool invoked with subagent_type="codebase-analyzer"
    │
    v
OpenCode SDK looks up subagent_type in registered agents
    │
    X <-- ISSUE: Built-in agents NOT registered with SDK

AGENT COMMAND EXECUTION PATH (WORKS)
/codebase-analyzer
    │
    v
agent-commands.ts
context.spawnSubagent({ name, systemPrompt, model, tools })
    │
    v
SubagentSessionManager.spawn()
    │
    v
SDK Client.createSession({ systemPrompt, model, tools })
    │
    v
Independent session created (WORKS but not SDK-native)
```

#### 6.3 ParallelAgentsTree Component

**File**: `src/ui/components/parallel-agents-tree.tsx`

The Atomic CLI already has a working tree renderer that matches target UI:

```typescript
// Status icons
export const STATUS_ICONS: Record<AgentStatus, string> = {
  pending: "○",
  running: "◐",
  completed: "●",
  error: "✕",
  background: "◌",
};

// Tree characters
const TREE_CHARS = {
  branch: "├─",
  lastBranch: "└─",
  vertical: "│ ",
  space: "  ",
};

// Rendering logic
const connector = isLast ? TREE_CHARS.lastBranch : TREE_CHARS.branch;
const statusLine = isLast ? TREE_CHARS.space : TREE_CHARS.vertical;

// Output:
// ├─ Explore project structure · 0 tool uses
// │  Initializing...
```

**Status**: ✅ Already matches target UI from screenshots

### 7. Comparison Matrix

| Feature | OpenCode SDK (Native) | Atomic CLI (Current) |
|---------|----------------------|---------------------|
| Sub-agent API | TaskTool with subagent_type | spawnSubagent() creates independent session |
| Agent Registration | opencode.json or .opencode/agents/*.md | BUILTIN_AGENTS array in TypeScript |
| Session Relationship | Parent-child via parentID | Independent sessions |
| Result Format | `<task_result>{text}</task_result>` | Raw text from session.stream() |
| Event Tracking | SSE with AgentPart/StepFinishPart | Mapped from SSE to unified events |
| Context Inheritance | None (isolated sessions) | None (fully independent) |
| Resumption | task_id for resuming previous session | Not implemented |
| Permission Control | opencode.json permission.task rules | Tool list restriction via SessionConfig |

### 8. SDK Client API Usage (from Atomic Implementation)

**File**: `.opencode/plugin/ralph.ts:273-408` (from implementation analysis)

OpenCode SDK client methods available:

```typescript
// Retrieve session messages
const response = await client.session.messages({
  path: { id: event.properties.sessionID },
})

// Log messages
await client.app.log({
  body: {
    service: "ralph-plugin",
    level: "info",
    message: "Ralph loop completed",
  },
})

// Summarize/compact session
await client.session.summarize({
  path: { id: event.properties.sessionID },
})

// Send prompt to session
await client.session.prompt({
  path: { id: event.properties.sessionID },
  body: {
    parts: [{ type: "text", text: continuationPrompt }],
  },
})
```

## Code References

### OpenCode SDK (External)

| File | Description |
|------|-------------|
| `packages/opencode/src/tool/task.ts` | TaskTool definition and execute() method |
| `packages/opencode/src/tool/task.txt` | TaskTool usage notes and examples |
| `packages/opencode/src/session/prompt.ts` | SessionPrompt.loop() and insertReminders() |
| `packages/opencode/src/agent/agent.ts` | Built-in agent definitions |
| `packages/web/src/content/docs/agents.mdx` | Agent configuration documentation |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | TUI Task component |
| `packages/opencode/src/cli/cmd/run.ts` | CLI task function |

### Atomic CLI (Local)

| File | Lines | Description |
|------|-------|-------------|
| `src/sdk/opencode-client.ts` | 505-520 | SSE event mapping (AgentPart, StepFinishPart) |
| `src/sdk/opencode-client.ts` | 826-833 | Session prompt with agent mode |
| `src/sdk/__tests__/subagent-event-mapping.test.ts` | 150-294 | OpenCode client event mapping tests |
| `src/ui/__tests__/spawn-subagent-integration.test.ts` | 76-210 | SubagentGraphBridge integration tests |
| `src/ui/commands/agent-commands.ts` | 237-1156 | BUILTIN_AGENTS definitions |
| `src/ui/components/parallel-agents-tree.tsx` | 101-106 | Tree connector characters |
| `src/ui/components/parallel-agents-tree.tsx` | 73-79 | Status icons |
| `src/graph/subagent-bridge.ts` | 27-61 | SubagentGraphBridge class |
| `src/graph/subagent-registry.ts` | 28-50 | SubagentTypeRegistry class |

### Research Documents (Local)

| File | Description |
|------|-------------|
| `research/docs/2026-01-31-opencode-implementation-analysis.md` | OpenCode agent integration implementation analysis |
| `research/docs/2026-02-12-sub-agent-sdk-integration-analysis.md` | Sub-agent SDK integration analysis with skill-to-sub-agent requirements |
| `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` | Sub-agent UI with OpenTUI and independent context windows |

## Architecture Diagrams

### TaskTool Lifecycle (OpenCode SDK Native)

```
1. Tool Call Initiation
   SessionPrompt.loop() creates AssistantMessage
   └─> Creates ToolPart with status="running"

2. Permission Check
   PermissionNext.ask() verifies subagent_type allowed
   └─> Triggers tool.execute.before hook

3. Session Creation
   TaskTool.execute() creates new session
   ├─> If task_id provided: retrieve existing session
   └─> Otherwise: create with parentID = calling session

4. Metadata Update
   ToolPart.metadata updated with:
   ├─> sessionId (sub-agent session)
   └─> model (sub-agent model)

5. Sub-agent Execution
   SessionPrompt.prompt() in new session
   └─> Agentic execution loop

6. Result Extraction
   Extract text from last message part
   └─> Format with task_id and <task_result> tags

7. Status Update
   ToolPart status = "completed" or "error"
   └─> Triggers tool.execute.after hook

8. Event Emission (SSE)
   ├─> AgentPart emitted on start
   └─> StepFinishPart emitted on completion
```

### Atomic CLI Independent Session Flow

```
1. Command Execution
   User types /codebase-analyzer <args>
   └─> agent-commands.ts: createAgentCommand()

2. Spawn Request
   context.spawnSubagent({ name, systemPrompt, model, tools })
   └─> Creates ParallelAgent UI state

3. Session Creation
   SubagentSessionManager.spawn()
   ├─> Creates SessionConfig
   └─> Calls createSession() factory

4. Independent Session
   SDK Client.createSession({ systemPrompt, model, tools })
   └─> No parentID relationship

5. Streaming
   for await (const msg of session.stream(task)) {
     ├─> Accumulate text
     └─> Count tool uses
   }

6. Cleanup
   session.destroy() in finally block
   └─> No task_id or resumption support

7. Event Emission
   SDK events manually mapped:
   ├─> subagent.start (not from TaskTool)
   └─> subagent.complete (not from TaskTool)
```

## Open Questions and Recommendations

### Open Questions

1. **Should Atomic register built-in agents with OpenCode's native agent system?**
   - Pros: Skills can use TaskTool naturally, resumption support, SDK-optimized orchestration
   - Cons: Requires generating `.opencode/agents/*.md` files or adding to opencode.json

2. **Is the independent session approach intentional for isolation?**
   - Current approach provides complete isolation but loses SDK benefits
   - No context inheritance, manual event mapping, no resumption

3. **How should skills invoke sub-agents?**
   - Current: `sendSilentMessage()` relying on TaskTool (broken for built-in agents)
   - Alternative 1: Register built-ins with SDK-native APIs
   - Alternative 2: Change skills to directly call `spawnSubagent()`

4. **Should OpenTUI be adopted for Atomic CLI?**
   - Requires Bun runtime (Atomic currently uses Node.js)
   - OpenTUI explicitly states it's not production-ready
   - Current React implementation works fine

### Recommendations

**Immediate Actions**:

1. **Register Built-in Agents with OpenCode SDK**:
   ```typescript
   // Generate .opencode/agents/codebase-analyzer.md
   ---
   description: Analyzes codebase implementation details.
   mode: subagent
   model: anthropic/claude-opus-4-5
   tools:
     write: false
     read: true
     grep: true
     glob: true
   ---
   
   You are a code analyzer. Focus on understanding implementation details...
   ```

2. **Update Skills to Use TaskTool Correctly**:
   - Ensure skill prompts reference registered subagent_type values
   - Or change skills to use `spawnSubagent()` directly

3. **Add Task ID Support for Resumption**:
   ```typescript
   // In SubagentGraphBridge.spawn()
   if (options.taskId) {
     // Resume existing session instead of creating new
   }
   ```

**Long-term Considerations**:

1. **Context Inheritance**: Consider if sub-agents need access to parent context
2. **Permission Granularity**: Use OpenCode's permission.task for fine-grained control
3. **OpenTUI Migration**: Evaluate if Bun runtime transition is worth benefits
4. **Result Caching**: Store sub-agent results for reuse across sessions

## Related Research

- `docs/claude-agent-sdk/typescript-sdk.md` - Claude SDK AgentDefinition type (comparison)
- `research/docs/2026-01-31-claude-agent-sdk-research.md` - Claude Agent SDK v2 research
- `research/docs/2026-01-31-github-copilot-sdk-research.md` - Copilot SDK research
- `research/docs/2026-01-31-sdk-migration-and-graph-execution.md` - Comprehensive SDK comparison

## External Links

- [DeepWiki - anomalyco/opencode](https://deepwiki.com/anomalyco/opencode)
- [DeepWiki - anomalyco/opentui](https://deepwiki.com/anomalyco/opentui)
- [OpenCode Configuration Schema](https://opencode.ai/config.json)

