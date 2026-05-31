---
date: 2026-01-31 08:21:18 UTC
researcher: Claude (codebase-research-agent)
git_commit: a85aaeb7b77d9c81be583231f5bfbcbba90df662
branch: lavaman131/feature/tui
repository: atomic
topic: "SDK Migration and Graph Execution Pattern Design for Atomic TUI"
tags: [research, sdk-migration, opentui, opencode-sdk, claude-agent-sdk, copilot-sdk, graph-execution, typescript, atomic]
status: complete
last_updated: 2026-01-31
last_updated_by: Claude (codebase-research-agent)
---

# SDK Migration and Graph Execution Pattern Research

## Research Question

Research the current state of the codebase and patterns used for the .opencode, .claude, and .github coding agents. Use multiple online researcher sub-agents to research how to replace the current implementations with the opencode-sdk, claude agent-sdk, and github copilot sdk. This will require creating a beautiful chat interface using the opentui library. Design a graph execution pattern in TypeScript for executing the atomic workflow with patterns like .then(), .if(), .else().

## Executive Summary

This research document synthesizes findings from 8 parallel sub-agents to provide a comprehensive analysis of:

1. **Current Implementation State** - The `.opencode/`, `.claude/`, and `.github/` directories implement coding agent integrations with distinct patterns for plugins, hooks, agents, and commands
2. **SDK Migration Paths** - Three SDKs provide modern APIs for building coding agents: OpenCode SDK, Claude Agent SDK v2, and GitHub Copilot SDK
3. **Terminal UI Framework** - OpenTUI provides flexbox-based terminal interfaces with React/SolidJS integrations, ideal for chat interfaces
4. **Graph Execution Pattern** - A TypeScript fluent API design with `.then()`, `.if()`, `.else()`, `.loop()`, and `.parallel()` for orchestrating the Atomic workflow

---

## Table of Contents

1. [Current Implementation Analysis](#current-implementation-analysis)
2. [SDK Migration Research](#sdk-migration-research)
3. [OpenTUI Chat Interface](#opentui-chat-interface)
4. [Graph Execution Pattern Design](#graph-execution-pattern-design)
5. [Integration Recommendations](#integration-recommendations)
6. [Related Research Documents](#related-research-documents)

---

## Current Implementation Analysis

### Architecture Overview

The Atomic codebase implements three parallel coding agent integrations:

| Directory | Agent | Plugin System | Hook Events | State File |
|-----------|-------|---------------|-------------|------------|
| `.opencode/` | OpenCode | TypeScript plugins via `@opencode-ai/plugin` | `session.status`, `command.execute.before`, `chat.message` | `.opencode/ralph-loop.local.md` |
| `.claude/` | Claude Code | Marketplace plugins | `SessionEnd` | N/A (marketplace) |
| `.github/` | GitHub Copilot | Hook scripts | `sessionStart`, `userPromptSubmitted`, `sessionEnd` | `.github/ralph-loop.local.md` |

### OpenCode Implementation (`.opencode/`)

**Configuration:** `.opencode/opencode.json:1-98`

Key components:
- **Plugin System:** Uses `@opencode-ai/plugin` v1.1.47 with async factory pattern
- **Ralph Plugin:** `plugin/ralph.ts:253-412` - Handles iterative development loops via `session.status` events
- **Telemetry Plugin:** `plugin/telemetry.ts:350-415` - Tracks 10 Atomic slash commands
- **Agent Definitions:** 8 agents in YAML frontmatter format with `mode`, `model`, `tools` fields
- **Commands:** 7 commands in `.opencode/command/` plus 3 inline Ralph commands

**SDK Client Usage Pattern:**
```typescript
// From .opencode/plugin/ralph.ts:273-409
await client.session.messages({ path: { id: sessionID } })
await client.session.summarize({ path: { id: sessionID } })
await client.session.prompt({ path: { id: sessionID }, body: { parts: [...] } })
await client.app.log({ body: { service, level, message } })
```

### Claude Code Implementation (`.claude/`)

**Configuration:** `.claude/settings.json:1-35`

Key components:
- **Settings:** Environment variables, permissions, marketplace plugins
- **Hooks:** `SessionEnd` hook runs `telemetry-stop.ts` via Bun
- **Agent Definitions:** 7 agents with `name`, `description`, `tools`, `model` fields
- **Commands:** 7 commands with `allowed-tools`, `argument-hint` patterns
- **Skills:** 2 skills with progressive disclosure via `references/` subdirectories

**Plugin Integration:**
```json
// From .claude/settings.json:18-20
"enabledPlugins": {
  "ralph@atomic-plugins": true
}
```

### GitHub Copilot Implementation (`.github/`)

**Configuration:** `.github/hooks/hooks.json:1-40`

Key components:
- **Three Hook Events:** `sessionStart`, `userPromptSubmitted`, `sessionEnd`
- **Scripts:** TypeScript scripts for Ralph loop management in `.github/scripts/`
- **Self-Restarting:** Uses `nohup copilot` to spawn new sessions
- **Agent Definitions:** 7 agents matching Claude/OpenCode patterns

**Hook Flow:**
```
sessionStart -> start-ralph-session.ts (detect/log)
userPromptSubmitted -> telemetry-session.ts (accumulate commands)
sessionEnd -> telemetry-stop.ts + ralph-stop.ts (finalize/restart)
```

---

## SDK Migration Research

### OpenCode SDK (`anomalyco/opencode`)

**Package:** `@opencode-ai/sdk` (V2 recommended via `@opencode-ai/sdk/v2`)

**Architecture:**
- Client-server model using HTTP/SSE/WebSocket
- Generated from OpenAPI spec for type safety
- Session-based conversation management

**Key Features:**

| Feature | API |
|---------|-----|
| Session CRUD | `client.session.create/get/list/update/delete` |
| Messaging | `client.session.prompt({ body: { parts: [...] } })` |
| Events | `client.event.subscribe()` returns async generator |
| Tool Registration | Place in `.opencode/tools/` or use plugin `tool` export |
| Checkpointing | `client.session.summarize()`, `session.revert()` |

**Plugin Hook Types:**
- `event` - React to session lifecycle
- `tool.execute.before/after` - Intercept tool execution
- `command.execute.before` - Intercept slash commands
- `chat.message/params/headers` - Modify LLM interactions
- `permission.ask` - Handle permission requests

**Migration Path:**
1. Keep existing plugin structure in `.opencode/plugin/`
2. Update to V2 client: `createOpencodeClient` from `@opencode-ai/sdk/v2/client`
3. Use event subscription for streaming: `for await (const event of events.stream)`

**Source:** `research/docs/2026-01-31-opencode-sdk-research.md`

### Claude Agent SDK v2 (`@anthropic-ai/claude-agent-sdk`)

**Package:** `@anthropic-ai/claude-agent-sdk` (renamed from `@anthropic-ai/claude-code`)

**V2 Preview API:**
```typescript
import { unstable_v2_createSession } from '@anthropic-ai/claude-agent-sdk'

await using session = unstable_v2_createSession({ model: 'claude-sonnet-4-5-20250929' })
await session.send('Hello!')
for await (const msg of session.stream()) {
  // Handle messages
}
```

**V1 API (still supported):**
```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

for await (const message of query({
  prompt: "Find the bug",
  options: { allowedTools: ["Read", "Edit", "Bash"] }
})) {
  console.log(message)
}
```

**Key Types:**

| Type | Description |
|------|-------------|
| `Options` | 30+ properties for model, tools, permissions, hooks |
| `SDKMessage` | Union of Assistant, User, Result, System messages |
| `HookCallback` | `(input, toolUseID, { signal }) => Promise<HookJSONOutput>` |
| `AgentDefinition` | `{ description, tools, prompt, model }` |
| `McpServerConfig` | Stdio, SSE, HTTP, or SDK server configs |

**Hook Events:**
- `PreToolUse`, `PostToolUse` - Tool interception
- `SessionStart`, `SessionEnd` - Lifecycle
- `SubagentStart`, `SubagentStop` - Subagent coordination
- `PermissionRequest` - Permission handling

**Migration Path:**
1. Replace marketplace plugin with SDK-based implementation
2. Use V2 `createSession()`/`send()`/`stream()` pattern
3. Define hooks via options: `options.hooks = { PreToolUse: [...] }`
4. Configure MCP servers: `options.mcpServers = { ... }`

**Source:** `research/docs/2026-01-31-claude-agent-sdk-research.md`

### GitHub Copilot SDK (`github/copilot-sdk`)

**Package:** `@github/copilot-sdk` (Node.js), `github-copilot-sdk` (Python)

**Status:** Technical Preview (not production-ready)

**Architecture:**
- Thin client pattern wrapping Copilot CLI
- JSON-RPC 2.0 bidirectional protocol
- Multi-language: Node.js, Python, Go, .NET

**Key Features:**

```typescript
import { CopilotClient, defineTool } from "@github/copilot-sdk"

const client = new CopilotClient({ useStdio: true })
await client.start()

const session = await client.createSession({
  model: "gpt-5",
  tools: [
    defineTool({
      name: "lookup_issue",
      description: "Fetch issue details",
      parameters: z.object({ id: z.string() }),
      handler: async (params) => await fetchIssue(params.id)
    })
  ]
})

session.on((event) => {
  if (event.type === "assistant.message") {
    console.log(event.data.content)
  }
})

await session.send({ prompt: "Hello!" })
```

**31 Event Types:**
- Session: `session.start`, `session.idle`, `session.error`
- Assistant: `assistant.turn_start/end`, `assistant.message`, `assistant.message_delta`
- Tools: `tool.execution_start/complete`
- Subagents: `subagent.selected/started/completed/failed`

**Skills System:**
- Markdown-based `SKILL.md` files with YAML frontmatter
- Lazy-loaded into context when invoked
- Configured via `skillDirectories` option

**Migration Path:**
1. Replace hook scripts with SDK client
2. Define tools via `defineTool()` helper
3. Handle events via `session.on()` subscription
4. Use skills system for declarative behavior

**Source:** `research/docs/2026-01-31-github-copilot-sdk-research.md`

---

## OpenTUI Chat Interface

### Library Overview

**Package:** `@opentui/core`, `@opentui/react`, `@opentui/solid`

**Architecture:**
- TypeScript + Zig dual-layer for performance
- Flexbox via Yoga layout engine
- React/SolidJS reconcilers for declarative UI

**Status:** NOT production ready (in development)

### Key Components for Chat Interface

| Component | Usage |
|-----------|-------|
| `<box>` | Container with borders, padding, flexbox |
| `<scrollbox>` | Scrollable container with `stickyScroll` |
| `<text>` | Styled text content |
| `<input>` | Single-line text input |
| `<code>` | Syntax-highlighted code blocks |
| `<markdown>` | Markdown rendering with `streaming: true` |

### Chat Interface Pattern

```typescript
import { createCliRenderer, BoxRenderable, ScrollBoxRenderable, InputRenderable } from "@opentui/core"

async function buildChatApp() {
  const renderer = await createCliRenderer()

  // Main container
  const main = new BoxRenderable(renderer, {
    flexDirection: "column",
    flexGrow: 1,
  })

  // Chat history with sticky scroll
  const chatHistory = new ScrollBoxRenderable(renderer, {
    rootOptions: { border: true, title: "Messages", flexGrow: 1 },
    scrollY: true,
    stickyScroll: true,
    stickyStart: "bottom",
    viewportCulling: true,  // Performance for long histories
  })

  // Input area
  const input = new InputRenderable(renderer, {
    placeholder: "Enter message...",
    onSubmit: (value) => handleMessage(value),
  })

  main.add(chatHistory)
  main.add(input)
  renderer.root.add(main)
  
  input.focus()
  renderer.start()
}
```

### Streaming Response Support

```typescript
import { CodeRenderable, MarkdownRenderable } from "@opentui/core"

// For streaming AI responses
const streamingContent = new MarkdownRenderable(renderer, {
  content: "",
  streaming: true,  // Enable incremental parsing
  flexGrow: 1,
})

// Update as chunks arrive
for await (const chunk of responseStream) {
  streamingContent.content += chunk
}
```

### React Integration

```typescript
import { render, useKeyboard, useTerminalDimensions } from "@opentui/react"

function ChatApp() {
  const { width } = useTerminalDimensions()
  
  useKeyboard((event) => {
    if (event.name === 'escape') handleExit()
  })

  return (
    <box flexDirection="column" flexGrow={1}>
      <scrollbox stickyScroll stickyStart="bottom" flexGrow={1}>
        {messages.map(msg => <text>{msg}</text>)}
      </scrollbox>
      <input placeholder="Message..." onSubmit={sendMessage} />
    </box>
  )
}
```

**Known Limitations:**
- Multi-width character handling issues
- Crash when destroying renderer without unmounting React
- `InputRenderable` change event only on Enter

**Source:** `research/docs/2026-01-31-opentui-library-research.md`

---

## Graph Execution Pattern Design

### Design Goals

Create a TypeScript fluent API for orchestrating the Atomic workflow:

```
Research -> Plan (Spec) -> Implement (Ralph) -> (Debug) -> PR
```

With chainable syntax:
- `.then()` - Sequential execution
- `.if()/.else()/.endif()` - Conditional routing
- `.parallel()` - Concurrent execution
- `.loop()` - Iterative execution (Ralph pattern)
- `.wait()` - Human-in-the-loop checkpoints
- `.catch()` - Error handling

### Research Findings

| Library | Pattern | Key Insight |
|---------|---------|-------------|
| **LangGraph.js** | Pregel-based StateGraph | Annotation system with reducers, `Command` objects for control flow |
| **XState** | State machines | `setup()` for type safety, guards for conditions, parallel states |
| **RxJS** | Observable pipe | Heavy overloading for type inference, `catchError` recovery |
| **Effect-TS** | Typed effects | `pipe()` with `flatMap()`, fiber system for parallelism |
| **n8n** | Stack-based workflow | `DirectedGraph` class, `IRunExecutionData` for serializable state |

### Core Type Definitions

```typescript
// Base state interface
interface BaseState {
  executionId: string
  lastUpdated: Date
  outputs: Record<string, unknown>
}

// Execution context
interface ExecutionContext<TState> {
  state: TState
  config: GraphConfig
  errors: ExecutionError[]
  abortSignal?: AbortSignal
  contextWindowUsage?: number
}

// Node result
interface NodeResult<TState> {
  stateUpdate?: Partial<TState>
  goto?: NodeId | NodeId[]
  signals?: Signal[]
}

// Node types
type NodeType = "agent" | "tool" | "decision" | "wait" | "subgraph" | "parallel"
```

### Fluent API Design

```typescript
// Graph builder with chaining
const workflow = graph<AtomicWorkflowState>()
  .start("research")
  .then(researchCodebase)
  .then(createSpec)
  .then(reviewSpec)
  .if(ctx => ctx.state.specApproved === true)
    .then(createFeatureList)
    .loop(implementFeature, {
      until: ctx => ctx.state.allFeaturesPassing === true,
      maxIterations: 100
    })
    .then(createPR)
  .else()
    .then(notifyUser)
    .wait("Waiting for spec revision")
  .endif()
  .end("create_pr", "notify")
  .compile({
    checkpointer: new ResearchDirSaver()
  })

// Execute
const result = await workflow.invoke(initialState, config)

// Stream execution
for await (const state of workflow.stream(initialState, config)) {
  console.log(`Iteration: ${state.iteration}`)
}
```

### Node Factory Functions

```typescript
// Agent node for sub-agent delegation
const researchCodebase = agentNode<AtomicWorkflowState>("research", {
  agentType: "claude",
  systemPrompt: "Research the codebase...",
  tools: ["read", "glob", "grep"],
  outputMapper: (output) => ({ researchDoc: output.response })
})

// Tool node for direct execution
const createFeatures = toolNode<AtomicWorkflowState>("features", {
  toolName: "write_json",
  args: (ctx) => ({ path: "research/feature-list.json" }),
  outputMapper: (result) => ({ featureList: result.features })
})

// Wait node for human-in-the-loop
const reviewSpec = waitNode<AtomicWorkflowState>("review", {
  prompt: "Please review the spec. Approve to continue.",
  inputMapper: (input) => ({ specApproved: input.approved })
})

// Decision node for routing
const routeOnApproval = decisionNode<AtomicWorkflowState>("route", {
  condition: (ctx) => ctx.state.specApproved ? "implement" : "notify"
})

// Parallel node for concurrent execution
const parallelResearch = parallelNode<AtomicWorkflowState>("parallel", {
  branches: [researchCode, researchDocs, researchTests],
  mergeStrategy: "all",
  merge: (results) => ({ findings: results.flatMap(r => r.findings) })
})
```

### State Persistence

```typescript
// Memory checkpointer
const memorySaver = new MemorySaver<AtomicWorkflowState>()

// File checkpointer (research/ directory integration)
const fileSaver = new FileSaver<AtomicWorkflowState>("research/checkpoints")

// Research directory saver with progress logging
const researchSaver = new ResearchDirSaver<AtomicWorkflowState>()

// Use in compilation
const graph = workflow.compile({ checkpointer: researchSaver })
```

### Error Handling

```typescript
// Retry wrapper
const resilientNode = withRetry(implementFeature, {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2
})

// Catch handler
workflow
  .then(implementFeature)
  .catch((error, ctx) => ({
    stateUpdate: { debugReports: [{ error: error.message }] }
  }))

// Recovery node with strategies
const recover = recoveryNode("recover", [
  { condition: (e) => e.type === "timeout", handler: retryNode },
  { condition: (e) => e.type === "runtime", handler: debugNode }
])
```

**Source:** `research/docs/2026-01-31-graph-execution-pattern-design.md`

---

## Integration Recommendations

### Unified SDK Abstraction

Create a common interface to support all three coding agents:

```typescript
interface CodingAgentClient {
  // Session management
  createSession(config: SessionConfig): Promise<Session>
  resumeSession(id: string): Promise<Session>
  
  // Messaging
  send(message: string): Promise<void>
  stream(): AsyncGenerator<AgentMessage>
  
  // Events
  on(event: string, handler: EventHandler): Unsubscribe
  
  // Tools
  registerTool(tool: ToolDefinition): void
  
  // Lifecycle
  start(): Promise<void>
  stop(): Promise<void>
}

// Implementations
class OpenCodeClient implements CodingAgentClient { ... }
class ClaudeAgentClient implements CodingAgentClient { ... }
class CopilotClient implements CodingAgentClient { ... }
```

### Chat UI Integration

```typescript
import { createCliRenderer } from "@opentui/core"
import { graph, type AtomicWorkflowState } from "./graph"

async function main() {
  const renderer = await createCliRenderer()
  const workflow = buildAtomicWorkflow()
  
  // Create chat UI
  const chat = new ChatInterface(renderer, {
    onMessage: async (message) => {
      // Execute workflow step
      const result = await workflow.invoke({ outputs: { question: message } }, config)
      return formatResult(result)
    },
    onStream: async function*(message) {
      // Stream execution
      for await (const state of workflow.stream({ outputs: { question: message } }, config)) {
        yield formatState(state)
      }
    }
  })
  
  renderer.root.add(chat)
  renderer.start()
}
```

### Ralph Loop Integration

The graph execution pattern directly supports the Ralph Wiggum technique:

```typescript
const ralphGraph = graph<RalphState>()
  .start("init")
  .then(loadFeatureList)
  .loop(implementFeature, {
    until: (ctx) => {
      // Exit conditions from .opencode/plugin/ralph.ts
      if (ctx.state.maxIterations > 0 && ctx.state.iteration >= ctx.state.maxIterations) return true
      if (ctx.state.completionPromise && checkPromise(ctx)) return true
      if (ctx.state.features.every(f => f.passes)) return true
      return false
    }
  })
  .then(writeSummary)
  .compile({ checkpointer: new ResearchDirSaver() })
```

---

## Code References

### Current Implementation Files

| Path | Description |
|------|-------------|
| `.opencode/plugin/ralph.ts:253-412` | Ralph plugin with session.status event handling |
| `.opencode/plugin/telemetry.ts:350-415` | Telemetry plugin with command tracking |
| `.opencode/opencode.json:1-98` | OpenCode configuration with providers, MCP, permissions |
| `.claude/settings.json:1-35` | Claude Code settings with marketplace plugins |
| `.claude/hooks/telemetry-stop.ts:1-336` | SessionEnd hook for telemetry |
| `.github/hooks/hooks.json:1-40` | GitHub Copilot hook configuration |
| `.github/scripts/ralph-loop.ts:1-375` | Ralph loop setup script |

### Pattern Files

| Path | Description |
|------|-------------|
| `.opencode/agents/*.md` | Agent definitions with YAML frontmatter |
| `.opencode/command/*.md` | Command definitions with $ARGUMENTS |
| `.claude/commands/*.md` | Claude commands with allowed-tools |
| `.github/skills/*/SKILL.md` | GitHub Copilot skills |

---

## Related Research Documents

| Document | Topic |
|----------|-------|
| `research/docs/2026-01-31-opencode-implementation-analysis.md` | Detailed .opencode analysis |
| `research/docs/2026-01-31-claude-implementation-analysis.md` | Detailed .claude analysis |
| `research/docs/2026-01-31-github-implementation-analysis.md` | Detailed .github analysis |
| `research/docs/2026-01-31-opentui-library-research.md` | OpenTUI library capabilities |
| `research/docs/2026-01-31-opencode-sdk-research.md` | OpenCode SDK API reference |
| `research/docs/2026-01-31-claude-agent-sdk-research.md` | Claude Agent SDK v2 reference |
| `research/docs/2026-01-31-github-copilot-sdk-research.md` | GitHub Copilot SDK reference |
| `research/docs/2026-01-31-graph-execution-pattern-design.md` | Full graph execution design |

---

## Open Questions

1. **OpenTUI Production Readiness** - When will OpenTUI be stable for production use?
2. **SDK Version Alignment** - How to handle SDK version mismatches across agents?
3. **State Serialization** - Best format for cross-session state persistence?
4. **Context Window Management** - Optimal strategy for compaction timing?
5. **Multi-Agent Coordination** - How to orchestrate parallel agent executions?

---

*Research conducted: 2026-01-31*
*Sub-agents spawned: 8 (3 codebase-analyzer, 5 codebase-online-researcher)*
*Total research documents: 9 (8 individual + 1 synthesis)*
