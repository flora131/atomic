# SDK Streaming APIs, Event Models, and OpenTUI Rendering Reference

**Date**: 2026-03-15
**Purpose**: Comprehensive reference for the streaming APIs, event types, session lifecycles, tool/function calling interfaces, and error handling patterns of all four SDKs used in the Atomic TUI application, plus the OpenTUI rendering model.

---

## Table of Contents

1. [Claude Agent SDK (`@anthropic-ai/claude-agent-sdk` v0.2.76)](#1-claude-agent-sdk)
2. [OpenCode SDK (`@opencode-ai/sdk` v1.2.26)](#2-opencode-sdk)
3. [Copilot SDK (`@github/copilot-sdk` v0.1.32)](#3-copilot-sdk)
4. [OpenTUI (`@opentui/core` v0.1.87 + `@opentui/react` v0.1.87)](#4-opentui)
5. [Cross-SDK Comparison Matrix](#5-cross-sdk-comparison-matrix)

---

## 1. Claude Agent SDK

**Package**: `@anthropic-ai/claude-agent-sdk` v0.2.76
**Local docs**: `/home/alilavaee/Documents/projects/code-cleanup/docs/claude-agent-sdk.md`
**Type declarations**: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
**Anthropic official docs**: https://docs.anthropic.com/en/docs/agent-sdk

### 1.1 Session Creation API

The Claude Agent SDK uses a **single-function entry point** via `query()`, which returns a `Query` object (an `AsyncGenerator<SDKMessage, void>` with extra methods). There is no separate "client" or "session" object; the query IS the session.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// Single-prompt mode
const q = query({
  prompt: "Hello",
  options: {
    cwd: process.cwd(),
    model: "claude-sonnet-4-5",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: { type: "preset", preset: "claude_code" },
    systemPrompt: { type: "preset", preset: "claude_code" },
    includePartialMessages: true,   // enables streaming deltas
  }
});

// Streaming input mode (multi-turn)
const q = query({
  prompt: asyncIterableOfSDKUserMessages,
  options: { /* ... */ }
});
```

**Session management functions**:
- `listSessions(options?)` - List sessions with metadata, filtered by `dir`, `limit`, `offset`
- `getSessionMessages(sessionId, options?)` - Read user/assistant messages from a transcript
- `getSessionInfo(sessionId, options?)` - Read metadata for a single session
- `forkSession(sessionId, options?)` - Fork into a new session with fresh UUIDs

**Resume**: Use `options.resume = "<sessionId>"` or `options.continue = true` for the most recent.

**Key Options** (from `Options` type):
| Option                   | Type                                                          | Description                                                        |
| ------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `abortController`        | `AbortController`                                             | Cancellation                                                       |
| `resume`                 | `string`                                                      | Resume a specific session by ID                                    |
| `continue`               | `boolean`                                                     | Continue most recent conversation                                  |
| `forkSession`            | `boolean`                                                     | Fork resumed session into new ID                                   |
| `sessionId`              | `string`                                                      | Override auto-generated session UUID                               |
| `persistSession`         | `boolean`                                                     | Default `true`; set `false` for ephemeral                          |
| `model`                  | `string`                                                      | Claude model identifier                                            |
| `effort`                 | `'low'\|'medium'\|'high'\|'max'`                              | Thinking depth                                                     |
| `thinking`               | `ThinkingConfig`                                              | Adaptive / enabled / disabled                                      |
| `maxTurns`               | `number`                                                      | Max agentic turns                                                  |
| `maxBudgetUsd`           | `number`                                                      | Spending cap                                                       |
| `includePartialMessages` | `boolean`                                                     | Enable streaming deltas                                            |
| `permissionMode`         | `PermissionMode`                                              | `'default'\|'acceptEdits'\|'bypassPermissions'\|'plan'\|'dontAsk'` |
| `canUseTool`             | `CanUseTool`                                                  | Custom permission callback                                         |
| `tools`                  | `string[]\|{type:'preset',preset:'claude_code'}`              | Tool selection                                                     |
| `allowedTools`           | `string[]`                                                    | Auto-approve list                                                  |
| `disallowedTools`        | `string[]`                                                    | Block list (overrides everything)                                  |
| `agents`                 | `Record<string, AgentDefinition>`                             | Subagent definitions                                               |
| `mcpServers`             | `Record<string, McpServerConfig>`                             | MCP servers                                                        |
| `hooks`                  | `Partial<Record<HookEvent, HookCallbackMatcher[]>>`           | Event hooks                                                        |
| `settingSources`         | `SettingSource[]`                                             | `['user','project','local']`                                       |
| `systemPrompt`           | `string\|{type:'preset',preset:'claude_code',append?:string}` | System prompt                                                      |
| `outputFormat`           | `{type:'json_schema',schema:JSONSchema}`                      | Structured outputs                                                 |
| `betas`                  | `SdkBeta[]`                                                   | Beta features e.g. `['context-1m-2025-08-07']`                     |

### 1.2 Streaming / Event API

The `Query` object is an **AsyncGenerator**. Messages are consumed via `for await`:

```typescript
for await (const message of q) {
  switch (message.type) {
    case "system":     // SDKSystemMessage (init) or SDKCompactBoundaryMessage
    case "user":       // SDKUserMessage / SDKUserMessageReplay
    case "assistant":  // SDKAssistantMessage (complete assistant turn)
    case "stream_event": // SDKPartialAssistantMessage (streaming deltas)
    case "result":     // SDKResultMessage (success or error)
    // ... status, hook, tool progress, task, rate limit, etc.
  }
}
```

#### Complete `SDKMessage` Union (18 types)

| Type                         | `message.type`        | `message.subtype`         | Description                                                                                                    |
| ---------------------------- | --------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SDKSystemMessage`           | `"system"`            | `"init"`                  | Session initialization: tools, model, MCP servers, permissions                                                 |
| `SDKCompactBoundaryMessage`  | `"system"`            | `"compact_boundary"`      | Conversation compaction boundary                                                                               |
| `SDKUserMessage`             | `"user"`              | -                         | User input message                                                                                             |
| `SDKUserMessageReplay`       | `"user"`              | - (`isReplay: true`)      | Replayed user message on resume                                                                                |
| `SDKAssistantMessage`        | `"assistant"`         | -                         | Complete assistant response (contains `BetaMessage` from Anthropic SDK with `content`, `stop_reason`, `usage`) |
| `SDKPartialAssistantMessage` | `"stream_event"`      | -                         | Streaming delta (contains `BetaRawMessageStreamEvent`). Only when `includePartialMessages: true`               |
| `SDKResultMessage`           | `"result"`            | `"success"` / `"error_*"` | Final result with duration, cost, usage, turn count                                                            |
| `SDKStatusMessage`           | `"status"`            | varies                    | Status updates (e.g., thinking, working)                                                                       |
| `SDKHookStartedMessage`      | `"hook_started"`      | -                         | Hook execution started                                                                                         |
| `SDKHookProgressMessage`     | `"hook_progress"`     | -                         | Hook progress update                                                                                           |
| `SDKHookResponseMessage`     | `"hook_response"`     | -                         | Hook execution completed                                                                                       |
| `SDKToolProgressMessage`     | `"tool_progress"`     | -                         | Tool execution progress                                                                                        |
| `SDKToolUseSummaryMessage`   | `"tool_use_summary"`  | -                         | Tool use summary                                                                                               |
| `SDKAuthStatusMessage`       | `"auth_status"`       | -                         | Authentication status                                                                                          |
| `SDKTaskStartedMessage`      | `"task_started"`      | -                         | Background task started                                                                                        |
| `SDKTaskProgressMessage`     | `"task_progress"`     | -                         | Background task progress                                                                                       |
| `SDKTaskNotificationMessage` | `"task_notification"` | -                         | Background task notification                                                                                   |
| `SDKFilesPersistedEvent`     | `"files_persisted"`   | -                         | File checkpointing event                                                                                       |
| `SDKRateLimitEvent`          | `"rate_limit"`        | -                         | Rate limit encountered                                                                                         |
| `SDKPromptSuggestionMessage` | `"prompt_suggestion"` | -                         | Suggested next prompt                                                                                          |

#### SDKResultMessage Subtypes

| Subtype                                 | Meaning                                                               |
| --------------------------------------- | --------------------------------------------------------------------- |
| `"success"`                             | Normal completion with `result` text and optional `structured_output` |
| `"error_max_turns"`                     | Hit `maxTurns` limit                                                  |
| `"error_during_execution"`              | Runtime error                                                         |
| `"error_max_budget_usd"`                | Budget exceeded                                                       |
| `"error_max_structured_output_retries"` | Structured output validation failed                                   |

#### SDKAssistantMessageError Values
`'authentication_failed' | 'billing_error' | 'rate_limit' | 'invalid_request' | 'server_error' | 'unknown'`

### 1.3 Query Object Methods

| Method                                  | Description                                                             |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `interrupt()`                           | Interrupt query (streaming input mode only)                             |
| `rewindFiles(userMessageId, {dryRun?})` | Restore files to a checkpoint. Requires `enableFileCheckpointing: true` |
| `setPermissionMode(mode)`               | Change permissions at runtime                                           |
| `setModel(model?)`                      | Switch model                                                            |
| `initializationResult()`                | Get init data (commands, models, account, agents)                       |
| `supportedCommands()`                   | List slash commands                                                     |
| `supportedModels()`                     | List available models                                                   |
| `supportedAgents()`                     | List available subagents                                                |
| `mcpServerStatus()`                     | Get MCP server connection statuses                                      |
| `accountInfo()`                         | Get account info                                                        |
| `reconnectMcpServer(name)`              | Reconnect an MCP server                                                 |
| `toggleMcpServer(name, enabled)`        | Enable/disable an MCP server                                            |
| `setMcpServers(servers)`                | Replace MCP server set dynamically                                      |
| `streamInput(stream)`                   | Stream additional input for multi-turn                                  |
| `stopTask(taskId)`                      | Stop a background task                                                  |
| `close()`                               | Close query and terminate the process                                   |

### 1.4 Tool / Function Calling Interface

Tools in Claude Agent SDK are primarily built-in (Bash, Read, Edit, Write, Glob, Grep, etc.) or MCP-based:

```typescript
import { tool, createSdkMcpServer, query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const myTool = tool(
  "get_weather",
  "Get weather for a location",
  { location: z.string() },
  async (args) => ({
    content: [{ type: "text", text: `Weather in ${args.location}: sunny` }]
  }),
  { annotations: { readOnly: true } }
);

const server = createSdkMcpServer({
  name: "my-tools",
  tools: [myTool]
});

const q = query({
  prompt: "What's the weather?",
  options: {
    mcpServers: { "my-tools": server },
    allowedTools: ["my-tools__get_weather"]
  }
});
```

**Permission control** is via `canUseTool` callback returning `{ behavior: 'allow' | 'deny', ... }`.

### 1.5 Hook Events (22 event types)

```typescript
type HookEvent =
  | "PreToolUse" | "PostToolUse" | "PostToolUseFailure"
  | "Notification" | "UserPromptSubmit"
  | "SessionStart" | "SessionEnd" | "Stop"
  | "SubagentStart" | "SubagentStop"
  | "PreCompact" | "PostCompact"
  | "PermissionRequest" | "Setup"
  | "TeammateIdle" | "TaskCompleted"
  | "Elicitation" | "ElicitationResult"
  | "ConfigChange"
  | "WorktreeCreate" | "WorktreeRemove"
  | "InstructionsLoaded";
```

### 1.6 Error Handling Patterns

- `SDKAssistantMessage.error` field for API-level errors
- `SDKResultMessage` with error subtypes for execution-level errors
- `AbortController` for cancellation
- `SDKRateLimitEvent` for rate limiting
- Hook `PostToolUseFailure` for tool execution failures

### 1.7 Known Limitations / Quirks

- V2 interface exists but is documented as "preview" / "unstable and has many bugs" (per CLAUDE.md)
- V1 is preferred
- The SDK spawns a **separate Claude Code process** (not in-process inference)
- `includePartialMessages` must be explicitly enabled for streaming deltas
- File checkpointing must be explicitly enabled
- `settingSources` defaults to `[]` (no filesystem settings loaded by default)

---

## 2. OpenCode SDK

**Package**: `@opencode-ai/sdk` v1.2.26
**Type declarations**: `node_modules/@opencode-ai/sdk/dist/` (auto-generated from OpenAPI spec)
**DeepWiki repo**: `anomalyco/opencode`

### 2.1 Session Creation API

OpenCode uses a **client-server architecture** with an HTTP API. The SDK is auto-generated from an OpenAPI specification and communicates via HTTP + Server-Sent Events (SSE).

```typescript
import { createOpencode } from "@opencode-ai/sdk";

// Start server and get client
const { client, server } = await createOpencode({
  hostname: "localhost",
  port: 0,  // random port
});

// Or just the client (connecting to existing server)
import { createOpencodeClient } from "@opencode-ai/sdk/client";
const client = createOpencodeClient({ baseUrl: "http://localhost:PORT" });

// Create a session
const session = await client.session.create({
  body: { model: "anthropic/claude-sonnet-4-5" }
});

// Send a prompt
await client.session.prompt({
  path: { id: session.data.id },
  body: { content: "Hello" }
});

// Async prompt (fire and forget)
await client.session.promptAsync({
  path: { id: session.data.id },
  body: { content: "Do something" }
});
```

**Server creation**:
```typescript
import { createOpencodeServer, createOpencodeTui } from "@opencode-ai/sdk/server";

const server = await createOpencodeServer({
  hostname: "localhost",
  port: 0,
  signal: abortController.signal,
  timeout: 30000,
});

// Or with TUI
const tui = createOpencodeTui({
  project: "/path/to/project",
  model: "anthropic/claude-sonnet-4-5",
  session: "session-id",
  agent: "default",
});
```

**Session operations on `OpencodeClient`**:
| Method                             | Description                     |
| ---------------------------------- | ------------------------------- |
| `client.session.create(opts)`      | Create a new session            |
| `client.session.list(opts)`        | List all sessions               |
| `client.session.get(opts)`         | Get a session by ID             |
| `client.session.update(opts)`      | Update session properties       |
| `client.session.delete(opts)`      | Delete session                  |
| `client.session.status(opts)`      | Get session status              |
| `client.session.prompt(opts)`      | Send prompt and wait            |
| `client.session.promptAsync(opts)` | Send prompt, return immediately |
| `client.session.messages(opts)`    | List messages for a session     |
| `client.session.message(opts)`     | Get a single message            |
| `client.session.abort(opts)`       | Abort a running session         |
| `client.session.fork(opts)`        | Fork at a specific message      |
| `client.session.revert(opts)`      | Revert a message                |
| `client.session.unrevert(opts)`    | Restore reverted messages       |
| `client.session.diff(opts)`        | Get file diff for session       |
| `client.session.summarize(opts)`   | Summarize a session             |
| `client.session.share(opts)`       | Share a session                 |
| `client.session.unshare(opts)`     | Unshare                         |
| `client.session.command(opts)`     | Send a slash command            |
| `client.session.shell(opts)`       | Run a shell command             |
| `client.session.todo(opts)`        | Get session todo list           |
| `client.session.children(opts)`    | Get child sessions              |
| `client.session.init(opts)`        | Create AGENTS.md                |

### 2.2 Streaming / Event API (SSE-based)

OpenCode uses Server-Sent Events for real-time updates. There are two event subscription endpoints:

```typescript
// Global events (all directories)
const result = await client.global.event();

// Per-directory events
const result = await client.event.subscribe({
  query: { directory: "/path/to/project" }
});
```

#### Complete `Event` Union Type (30+ event types)

**Session Events**:
| Type                | Description                                        |
| ------------------- | -------------------------------------------------- |
| `session.created`   | New session created (contains `Session` info)      |
| `session.updated`   | Session metadata updated                           |
| `session.deleted`   | Session deleted                                    |
| `session.status`    | Session status changed (`idle` / `busy` / `retry`) |
| `session.idle`      | Session became idle                                |
| `session.compacted` | Session history compacted                          |
| `session.diff`      | File diffs changed                                 |
| `session.error`     | Session error (contains error union type)          |

**Message Events**:
| Type                   | Description                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `message.updated`      | Message created/updated (contains full `Message`: `UserMessage` or `AssistantMessage`) |
| `message.removed`      | Message removed                                                                        |
| `message.part.updated` | Message part created/updated (with optional `delta` for streaming)                     |
| `message.part.removed` | Message part removed                                                                   |

**Part Types** (for `message.part.updated`):
| Part Type     | Description                                                                  |
| ------------- | ---------------------------------------------------------------------------- |
| `text`        | Text content with optional `delta` for streaming                             |
| `reasoning`   | Reasoning/thinking content                                                   |
| `file`        | File attachment                                                              |
| `tool`        | Tool call with state machine (`pending` -> `running` -> `completed`/`error`) |
| `step-start`  | LLM step started (with optional snapshot)                                    |
| `step-finish` | LLM step finished (with cost, tokens)                                        |
| `snapshot`    | Git snapshot                                                                 |
| `patch`       | File patch                                                                   |
| `agent`       | Subagent invocation                                                          |
| `subtask`     | Subtask delegation                                                           |
| `retry`       | API retry attempt                                                            |
| `compaction`  | Compaction boundary                                                          |

**Tool State Machine**:
```
ToolStatePending -> ToolStateRunning -> ToolStateCompleted | ToolStateError
```
Each state contains `input`, and completed adds `output`, `title`, `metadata`, `time.start/end`.

**Permission Events**:
| Type                 | Description            |
| -------------------- | ---------------------- |
| `permission.updated` | New permission request |
| `permission.replied` | Permission resolved    |

**System Events**:
| Type                            | Description                                  |
| ------------------------------- | -------------------------------------------- |
| `server.instance.disposed`      | Server instance shut down                    |
| `server.connected`              | Server connected                             |
| `installation.updated`          | OpenCode version updated                     |
| `installation.update-available` | Update available                             |
| `file.edited`                   | File edited outside session                  |
| `file.watcher.updated`          | File watcher event (`add`/`change`/`unlink`) |
| `vcs.branch.updated`            | Git branch changed                           |
| `lsp.client.diagnostics`        | LSP diagnostics                              |
| `lsp.updated`                   | LSP server updated                           |
| `todo.updated`                  | Todo list changed                            |
| `command.executed`              | Slash command executed                       |

**TUI Events** (for UI integration):
| Type                  | Description             |
| --------------------- | ----------------------- |
| `tui.prompt.append`   | Append text to prompt   |
| `tui.command.execute` | Execute a TUI command   |
| `tui.toast.show`      | Show toast notification |

**PTY Events**:
| Type          | Description         |
| ------------- | ------------------- |
| `pty.created` | PTY session created |
| `pty.updated` | PTY session updated |
| `pty.exited`  | PTY process exited  |
| `pty.deleted` | PTY session deleted |

#### GlobalEvent Wrapper
All events are wrapped: `{ directory: string; payload: Event }`

#### Message Types

**UserMessage**:
```typescript
{
  id: string;
  sessionID: string;
  role: "user";
  time: { created: number };
  agent: string;
  model: { providerID: string; modelID: string };
  summary?: { title?: string; body?: string; diffs: FileDiff[] };
  system?: string;
  tools?: { [key: string]: boolean };
}
```

**AssistantMessage**:
```typescript
{
  id: string;
  sessionID: string;
  role: "assistant";
  time: { created: number; completed?: number };
  parentID: string;
  modelID: string;
  providerID: string;
  mode: string;
  path: { cwd: string; root: string };
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  error?: ProviderAuthError | UnknownError | MessageOutputLengthError | MessageAbortedError | ApiError;
  finish?: string;
  summary?: boolean;
}
```

#### Session Status
```typescript
type SessionStatus =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy" };
```

### 2.3 Tool Interface

Tools are managed by the OpenCode server. The SDK client can:
```typescript
// List tool IDs
await client.tool.ids();

// List tools with JSON schema for a provider/model
await client.tool.list({ query: { providerID: "anthropic", modelID: "claude-sonnet-4-5" } });
```

Tool calls appear as `ToolPart` in `message.part.updated` events with the state machine described above.

### 2.4 Error Types

```typescript
type ProviderAuthError = { name: "ProviderAuthError"; data: { providerID: string; message: string } };
type UnknownError = { name: "UnknownError"; data: { message: string } };
type MessageOutputLengthError = { name: "MessageOutputLengthError"; data: {} };
type MessageAbortedError = { name: "MessageAbortedError"; data: { message: string } };
type ApiError = { name: "APIError"; data: {
  message: string; statusCode?: number; isRetryable: boolean;
  responseHeaders?: Record<string,string>; responseBody?: string;
}};
```

### 2.5 Other Client Domains

| Domain             | Methods                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.project`   | `list()`, `current()`                                                                                                                                                                                       |
| `client.config`    | `get()`, `update()`, `providers()`                                                                                                                                                                          |
| `client.provider`  | `list()`, `auth()`, `oauth.authorize()`, `oauth.callback()`                                                                                                                                                 |
| `client.mcp`       | `status()`, `add()`, `connect()`, `disconnect()`, `auth.*`                                                                                                                                                  |
| `client.find`      | `text()`, `files()`, `symbols()`                                                                                                                                                                            |
| `client.file`      | `list()`, `read()`, `status()`                                                                                                                                                                              |
| `client.vcs`       | `get()`                                                                                                                                                                                                     |
| `client.pty`       | `list()`, `create()`, `get()`, `update()`, `remove()`, `connect()`                                                                                                                                          |
| `client.tui`       | `appendPrompt()`, `submitPrompt()`, `clearPrompt()`, `openHelp()`, `openSessions()`, `openThemes()`, `openModels()`, `executeCommand()`, `showToast()`, `publish()`, `control.next()`, `control.response()` |
| `client.app`       | `log()`, `agents()`                                                                                                                                                                                         |
| `client.lsp`       | `status()`                                                                                                                                                                                                  |
| `client.formatter` | `status()`                                                                                                                                                                                                  |

### 2.6 Known Limitations / Quirks

- The SDK is auto-generated from OpenAPI; type names follow `gen/types.gen.d.ts` patterns
- SSE reconnection must be handled by the consumer
- Permission responses use `client.postSessionIdPermissionsPermissionId()`
- No built-in WebSocket support; streaming is SSE only
- The v2 API exists (`@opencode-ai/sdk/v2`) but is not documented

---

## 3. Copilot SDK

**Package**: `@github/copilot-sdk` v0.1.32
**Type declarations**: `node_modules/@github/copilot-sdk/dist/`
**Local docs**: `/home/alilavaee/Documents/projects/code-cleanup/docs/copilot-cli/usage.md`

### 3.1 Session Creation API

Copilot SDK uses a **two-object model**: `CopilotClient` manages the connection, `CopilotSession` manages individual conversations. Communication is via JSON-RPC (stdio or TCP).

```typescript
import { CopilotClient, approveAll } from "@github/copilot-sdk";

// Create client (spawns CLI server process)
const client = new CopilotClient({
  useStdio: true,     // default: true (vs TCP)
  autoStart: true,    // default: true
  autoRestart: true,  // default: true
  logLevel: "error",
  cwd: process.cwd(),
  githubToken: "ghp_...",  // optional, explicit auth
});

// Start explicitly (if autoStart: false)
await client.start();

// Create a session
const session = await client.createSession({
  model: "claude-sonnet-4.5",
  onPermissionRequest: approveAll,  // required callback
  tools: [myTool],
  systemMessage: { mode: "append", content: "Custom instructions" },
  streaming: true,
  workingDirectory: process.cwd(),
  mcpServers: { "my-server": { command: "node", args: ["server.js"], tools: ["*"] } },
  customAgents: [{ name: "reviewer", description: "Code reviewer", prompt: "..." }],
  hooks: {
    onPreToolUse: async (input) => ({ permissionDecision: "allow" }),
    onPostToolUse: async (input) => {},
    onSessionStart: async (input) => {},
    onSessionEnd: async (input) => {},
    onErrorOccurred: async (input) => ({ errorHandling: "retry", retryCount: 3 }),
  },
  infiniteSessions: { enabled: true, backgroundCompactionThreshold: 0.80, bufferExhaustionThreshold: 0.95 },
  reasoningEffort: "high",
  onUserInputRequest: async (req) => ({ answer: "yes", wasFreeform: true }),
});

// Resume a session
const resumed = await client.resumeSession("session-id", {
  onPermissionRequest: approveAll,
  disableResume: false,
});
```

**Client options** (`CopilotClientOptions`):
| Option            | Type                               | Default         | Description                                          |
| ----------------- | ---------------------------------- | --------------- | ---------------------------------------------------- |
| `cliPath`         | `string`                           | bundled         | Path to CLI executable                               |
| `cliArgs`         | `string[]`                         | `[]`            | Extra CLI args                                       |
| `cwd`             | `string`                           | `process.cwd()` | Working directory                                    |
| `port`            | `number`                           | `0` (random)    | TCP port                                             |
| `useStdio`        | `boolean`                          | `true`          | Stdio vs TCP transport                               |
| `isChildProcess`  | `boolean`                          | `false`         | Running as child of CLI server                       |
| `cliUrl`          | `string`                           | -               | Connect to existing server                           |
| `logLevel`        | `string`                           | -               | `"none"\|"error"\|"warning"\|"info"\|"debug"\|"all"` |
| `autoStart`       | `boolean`                          | `true`          | Auto-start on first use                              |
| `autoRestart`     | `boolean`                          | `true`          | Auto-restart on crash                                |
| `env`             | `Record<string,string\|undefined>` | `process.env`   | Environment variables                                |
| `githubToken`     | `string`                           | -               | Explicit GitHub token                                |
| `useLoggedInUser` | `boolean`                          | `true`          | Use stored OAuth tokens                              |

**Client methods**:
| Method                       | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `start()`                    | Start CLI server / establish connection              |
| `stop()`                     | Graceful shutdown; returns errors array              |
| `forceStop()`                | SIGKILL shutdown                                     |
| `createSession(config)`      | Create new conversation                              |
| `resumeSession(id, config)`  | Resume existing conversation                         |
| `deleteSession(id)`          | Permanently delete session data                      |
| `listSessions(filter?)`      | List sessions (filter by cwd, gitRoot, repo, branch) |
| `getLastSessionId()`         | Get most recently updated session ID                 |
| `getForegroundSessionId()`   | Get TUI foreground session (TUI+server mode)         |
| `setForegroundSessionId(id)` | Switch TUI to display a session                      |
| `getState()`                 | Get connection state                                 |
| `ping(msg?)`                 | Health check                                         |
| `getStatus()`                | Version and protocol info                            |
| `getAuthStatus()`            | Auth status                                          |
| `listModels()`               | List models (cached)                                 |
| `on(type, handler)`          | Subscribe to lifecycle events                        |

### 3.2 Streaming / Event API

Copilot uses a **strongly-typed event system** with 40+ event types auto-generated from a JSON schema. Events are emitted via the `CopilotSession.on()` method.

```typescript
// Listen to specific event type
const unsub = session.on("assistant.message", (event) => {
  console.log(event.data.content);
});

// Listen to all events
const unsub = session.on((event) => {
  switch (event.type) {
    case "assistant.message": ...
    case "session.idle": ...
    case "tool.execution_complete": ...
  }
});

// Send and wait for idle
const response = await session.sendAndWait({ prompt: "Hello" }, 60000);
```

#### Complete `SessionEvent` Types

Every event has the envelope:
```typescript
{
  id: string;          // UUID v4
  timestamp: string;   // ISO 8601
  parentId: string | null;  // linked chain
  ephemeral?: boolean; // not persisted to disk
  type: string;
  data: { ... };
}
```

**Session Lifecycle Events**:
| Type                             | Ephemeral | Description                                                                                                                           |
| -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `session.start`                  | no        | Session created (includes `sessionId`, `copilotVersion`, `selectedModel`, `context`)                                                  |
| `session.resume`                 | no        | Session resumed (includes `resumeTime`, `eventCount`, `context`)                                                                      |
| `session.error`                  | no        | Error occurred (`errorType`, `message`, `statusCode`, `stack`)                                                                        |
| `session.idle`                   | yes       | Agent is idle (includes optional `backgroundTasks`)                                                                                   |
| `session.title_changed`          | yes       | Session title updated                                                                                                                 |
| `session.info`                   | varies    | Info messages (`infoType`: `notification`, `timing`, `context_window`, `mcp`, `snapshot`, `configuration`, `authentication`, `model`) |
| `session.warning`                | varies    | Warnings (`warningType`: `subscription`, `policy`, `mcp`)                                                                             |
| `session.model_change`           | no        | Model switched (`previousModel`, `newModel`)                                                                                          |
| `session.mode_changed`           | no        | Mode changed (e.g., `interactive` -> `plan` -> `autopilot`)                                                                           |
| `session.plan_changed`           | no        | Plan file operation (`create`, `update`, `delete`)                                                                                    |
| `session.workspace_file_changed` | no        | Workspace file changed (`path`, `operation`)                                                                                          |
| `session.handoff`                | no        | Session handed off (remote/local, repo context)                                                                                       |
| `session.truncation`             | no        | Context truncated (token counts before/after)                                                                                         |
| `session.snapshot_rewind`        | yes       | Rewound to snapshot (`upToEventId`, `eventsRemoved`)                                                                                  |
| `session.shutdown`               | no        | Session ended (`shutdownType`, `totalPremiumRequests`, `totalApiDurationMs`, `codeChanges`, `modelMetrics`)                           |
| `session.context_changed`        | no        | Working directory / git context changed                                                                                               |
| `session.usage_info`             | yes       | Token usage info (`tokenLimit`, `currentTokens`, `messagesLength`)                                                                    |
| `session.compaction_start`       | no        | Compaction began                                                                                                                      |
| `session.compaction_complete`    | no        | Compaction completed (with token/message counts, summary, checkpoint info)                                                            |
| `session.task_complete`          | no        | Task completed (optional `summary`)                                                                                                   |

**User Events**:
| Type                        | Description                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `user.message`              | User sent a message (includes `content`, `transformedContent`, `attachments`, `source`, `agentMode`, `interactionId`) |
| `pending_messages.modified` | Pending message queue changed (empty payload)                                                                         |

**Assistant Events**:
| Type                        | Ephemeral | Description                                                                                                                                                    |
| --------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assistant.turn_start`      | no        | Turn began (`turnId`, `interactionId`)                                                                                                                         |
| `assistant.intent`          | yes       | Agent describes current intent                                                                                                                                 |
| `assistant.reasoning`       | no        | Complete reasoning/thinking text                                                                                                                               |
| `assistant.reasoning_delta` | yes       | Streaming reasoning chunk                                                                                                                                      |
| `assistant.streaming_delta` | yes       | Streaming bytes counter (`totalResponseSizeBytes`)                                                                                                             |
| `assistant.message`         | no        | Complete assistant message (`messageId`, `content`, `toolRequests`, `reasoningOpaque`, `reasoningText`, `encryptedContent`, `phase`, `outputTokens`)           |
| `assistant.message_delta`   | yes       | Streaming message content chunk (`messageId`, `deltaContent`)                                                                                                  |
| `assistant.turn_end`        | no        | Turn completed (`turnId`)                                                                                                                                      |
| `assistant.usage`           | yes       | Token usage per API call (`model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `cost`, `duration`, `quotaSnapshots`, `copilotUsage`) |

**Tool Events**:
| Type                            | Ephemeral | Description                                                                     |
| ------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `tool.user_requested`           | no        | User explicitly requested a tool                                                |
| `tool.execution_start`          | no        | Tool execution started (`toolCallId`, `toolName`, `arguments`, `mcpServerName`) |
| `tool.execution_partial_result` | yes       | Streaming tool output (`partialOutput`)                                         |
| `tool.execution_progress`       | yes       | Tool progress message                                                           |
| `tool.execution_complete`       | no        | Tool finished (`success`, `result`, `error`, `toolTelemetry`)                   |

**Skill Events**:
| Type            | Description                                      |
| --------------- | ------------------------------------------------ |
| `skill.invoked` | Skill loaded (name, path, content, allowedTools) |

**Client-Level Lifecycle Events** (on `CopilotClient`):
| Type                 | Description                      |
| -------------------- | -------------------------------- |
| `session.created`    | Session was created              |
| `session.deleted`    | Session was deleted              |
| `session.updated`    | Session metadata updated         |
| `session.foreground` | Session became foreground (TUI)  |
| `session.background` | Session went to background (TUI) |

### 3.3 Tool / Function Calling Interface

```typescript
import { defineTool } from "@github/copilot-sdk";
import { z } from "zod";

const weatherTool = defineTool("get_weather", {
  description: "Get weather for a location",
  parameters: z.object({ location: z.string() }),
  handler: async (args) => `Sunny in ${args.location}`,
  overridesBuiltInTool: false,
});

const session = await client.createSession({
  tools: [weatherTool],
  onPermissionRequest: approveAll,
});
```

**Tool result types**:
```typescript
type ToolResult = string | ToolResultObject;
type ToolResultObject = {
  textResultForLlm: string;
  binaryResultsForLlm?: ToolBinaryResult[];
  resultType: "success" | "failure" | "rejected" | "denied";
  error?: string;
  sessionLog?: string;
  toolTelemetry?: Record<string, unknown>;
};
```

### 3.4 Permission System

```typescript
// Permission request types
interface PermissionRequest {
  kind: "shell" | "write" | "mcp" | "read" | "url" | "custom-tool";
  toolCallId?: string;
  [key: string]: unknown;
}

// Built-in approveAll handler
import { approveAll } from "@github/copilot-sdk";

// Custom handler
const myHandler: PermissionHandler = async (request, { sessionId }) => {
  if (request.kind === "read") return { allowed: true };
  return { denied: true, reason: "Not allowed" };
};
```

### 3.5 Hook System

Copilot SDK hooks are registered in `SessionConfig.hooks`:

```typescript
interface SessionHooks {
  onPreToolUse?: PreToolUseHandler;     // Can approve/deny/modify args
  onPostToolUse?: PostToolUseHandler;   // Can modify results
  onUserPromptSubmitted?: UserPromptSubmittedHandler;  // Can modify prompt
  onSessionStart?: SessionStartHandler;  // Init/resume/new
  onSessionEnd?: SessionEndHandler;      // complete/error/abort/timeout/user_exit
  onErrorOccurred?: ErrorOccurredHandler; // retry/skip/abort
}
```

### 3.6 Error Handling

- `session.error` event with typed `errorType`: `authentication`, `authorization`, `quota`, `rate_limit`, `query`
- `ErrorOccurredHookInput` with `errorContext`: `model_call`, `tool_execution`, `system`, `user_input`
- `tool.execution_complete` with `success: false` and `error` payload
- Client-level connection state: `"disconnected" | "connecting" | "connected" | "error"`
- Session abort via `session.abort()`

### 3.7 Session Methods

| Method                              | Description                                  |
| ----------------------------------- | -------------------------------------------- |
| `send(options)`                     | Send a message (non-blocking)                |
| `sendAndWait(options, timeout?)`    | Send and wait for idle (default 60s timeout) |
| `on(type, handler)` / `on(handler)` | Subscribe to events                          |
| `getMessages()`                     | Get complete history                         |
| `disconnect()`                      | Release in-memory resources (data preserved) |
| `abort()`                           | Cancel in-flight request                     |
| `setModel(model)`                   | Switch model                                 |
| `registerTools(tools)`              | Register tool handlers                       |

### 3.8 Known Limitations / Quirks

- `onPermissionRequest` is **required** in `SessionConfig`
- `sendAndWait` default timeout is 60 seconds (does NOT abort agent work, just the wait)
- Infinite sessions with automatic compaction at configurable thresholds
- `destroy()` is deprecated in favor of `disconnect()`
- Supports `await using session = ...` for automatic cleanup
- `cliUrl` and `useStdio`/`cliPath` are mutually exclusive
- Protocol version negotiation happens at connection time

---

## 4. OpenTUI

**Packages**: `@opentui/core` v0.1.87, `@opentui/react` v0.1.87
**DeepWiki repo**: `anomalyco/opentui`

### 4.1 Architecture Overview

OpenTUI is a **terminal rendering framework** that provides:
1. A low-level **Renderable tree** (imperative, C-like) in `@opentui/core`
2. A **React reconciler** in `@opentui/react` that maps React components to Renderables
3. A native renderer backed by Zig (via `bun:ffi`) for high-performance terminal output
4. Yoga layout engine for flexbox-based terminal layouts

### 4.2 React Rendering Model

`@opentui/react` uses React's `jsx-runtime` and provides a custom reconciler. Components render to terminal-native elements:

**Intrinsic Elements** (JSX):
| Element                                 | Props Type        | Description                         |
| --------------------------------------- | ----------------- | ----------------------------------- |
| `<box>`                                 | `BoxProps`        | Flex container (like `<div>`)       |
| `<text>`                                | `TextProps`       | Text display                        |
| `<span>`                                | `SpanProps`       | Inline text with styling            |
| `<code>`                                | `CodeProps`       | Code block with syntax highlighting |
| `<diff>`                                | `DiffProps`       | Unified diff display                |
| `<markdown>`                            | `MarkdownProps`   | Markdown rendering                  |
| `<input>`                               | `InputProps`      | Text input                          |
| `<textarea>`                            | `TextareaProps`   | Multi-line text input               |
| `<select>`                              | `SelectProps`     | Selection widget                    |
| `<scrollbox>`                           | `ScrollBoxProps`  | Scrollable container                |
| `<ascii-font>`                          | `AsciiFontProps`  | ASCII art text                      |
| `<tab-select>`                          | `TabSelectProps`  | Tab selector                        |
| `<line-number>`                         | `LineNumberProps` | Line number gutter                  |
| `<b>`, `<i>`, `<u>`, `<strong>`, `<em>` | `SpanProps`       | Text modifiers                      |
| `<br>`                                  | `LineBreakProps`  | Line break                          |
| `<a>`                                   | `LinkProps`       | Hyperlink                           |

**React API** (from `@opentui/react`):
```typescript
import {
  createRoot,           // Create root renderer
  createPortal,         // Render into different parent
  extend,               // Register custom renderables
  flushSync,            // Synchronous render
  useKeyboard,          // Keyboard event hook
  useRenderer,          // Get renderer reference
  useOnResize,          // Terminal resize callback
  useTerminalDimensions, // Get { width, height }
  useTimeline,          // Animation timeline
  useAppContext,        // Get { renderer, keyHandler }
  AppContext,           // React context provider
  createElement,        // React.createElement wrapper
} from "@opentui/react";
```

### 4.3 Renderer (`CliRenderer`)

The `CliRenderer` manages the terminal output and input:

```typescript
import { createCliRenderer } from "@opentui/core";

const renderer = await createCliRenderer({
  stdin: process.stdin,
  stdout: process.stdout,
  targetFps: 60,
  maxFps: 120,
  useMouse: true,
  useAlternateScreen: true,
  exitOnCtrlC: true,
  useKittyKeyboard: { disambiguate: true, alternateKeys: true },
  backgroundColor: { r: 0, g: 0, b: 0, a: 255 },
});
```

**Renderer Lifecycle**:
```
createCliRenderer() -> setupTerminal() -> start()/auto() -> [render loop] -> pause()/suspend() -> resume() -> stop() -> destroy()
```

**State machine** (`RendererControlState`):
```
IDLE -> AUTO_STARTED / EXPLICIT_STARTED
EXPLICIT_STARTED -> EXPLICIT_PAUSED -> EXPLICIT_STARTED (resume)
EXPLICIT_STARTED -> EXPLICIT_SUSPENDED -> EXPLICIT_STARTED (resume)
EXPLICIT_STARTED -> EXPLICIT_STOPPED
```

**Key Renderer Methods**:
| Method                             | Description                                 |
| ---------------------------------- | ------------------------------------------- |
| `requestRender()`                  | Request next frame redraw                   |
| `requestLive()` / `dropLive()`     | Enable/disable continuous rendering         |
| `start()` / `auto()`               | Start render loop                           |
| `pause()` / `resume()`             | Pause/resume rendering                      |
| `suspend()`                        | Suspend (preserves state for shell handoff) |
| `stop()` / `destroy()`             | Stop rendering / clean up                   |
| `idle()`                           | Wait until renderer is idle                 |
| `setCursorPosition(x, y, visible)` | Position cursor                             |
| `setCursorStyle(opts)`             | Cursor appearance                           |
| `setBackgroundColor(color)`        | Terminal background                         |
| `setTerminalTitle(title)`          | Terminal title                              |
| `addPostProcessFn(fn)`             | Post-render processing                      |
| `setFrameCallback(fn)`             | Per-frame callback                          |
| `hitTest(x, y)`                    | Mouse hit testing                           |
| `getPalette(opts)`                 | Detect terminal color palette               |

### 4.4 Renderable Base Class

All visual elements extend `Renderable`, which uses **Yoga layout** for flexbox:

**Layout Properties** (from `LayoutOptions`):
```typescript
interface LayoutOptions {
  flexGrow?: number;
  flexShrink?: number;
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  flexWrap?: "wrap" | "no-wrap" | "wrap-reverse";
  alignItems?: "auto" | "flex-start" | "center" | "flex-end" | "stretch" | "baseline";
  justifyContent?: "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly";
  position?: "relative" | "absolute" | "static";
  overflow?: "visible" | "hidden" | "scroll";
  width?: number | "auto" | `${number}%`;
  height?: number | "auto" | `${number}%`;
  padding?: number | `${number}%`;
  margin?: number | "auto" | `${number}%`;
  // ... all standard flexbox properties
}
```

**Renderable Lifecycle**:
```
constructor -> add() to parent -> [render loop: markDirty -> draw] -> remove() -> destroy()
```

### 4.5 Handling Streaming Content Updates

OpenTUI handles incremental UI updates through React's standard reconciliation:

1. **State-driven**: Components use React `useState`/`useReducer` to hold streaming content
2. **Batched updates**: `requestRender()` coalesces multiple state changes into a single frame
3. **`requestLive()`**: When streaming, call `requestLive()` to enable continuous rendering (vs render-on-demand)
4. **`flushSync()`**: Force synchronous render when immediate update is needed
5. **`<scrollbox>`**: Automatically handles growing content with scroll position management
6. **`<markdown>`**: Can re-render as markdown content streams in

**Pattern for streaming content**:
```tsx
function StreamingMessage({ content }: { content: string }) {
  return (
    <scrollbox flexGrow={1}>
      <markdown>{content}</markdown>
    </scrollbox>
  );
}
```

The renderer runs at configurable FPS (default 60) and only redraws dirty renderables. The native Zig backend handles efficient terminal diff output.

### 4.6 React Hooks

| Hook                                 | Description                                      |
| ------------------------------------ | ------------------------------------------------ |
| `useKeyboard(handler, { release? })` | Listen for keypress (and optionally keyrelease)  |
| `useRenderer()`                      | Get `CliRenderer` instance                       |
| `useOnResize(callback)`              | React to terminal resize                         |
| `useTerminalDimensions()`            | Get `{ width, height }` (auto-updates on resize) |
| `useTimeline(options?)`              | Create animation timeline                        |
| `useAppContext()`                    | Get `{ renderer, keyHandler }`                   |

### 4.7 Known Limitations / Quirks

- Uses Zig native code via `bun:ffi` (requires Bun runtime)
- Yoga layout (Facebook's flexbox engine) for all layout calculations
- Mouse support is optional and configurable
- Kitty keyboard protocol support for enhanced key handling
- The `extend()` function is required to register custom renderables before use
- `createRoot()` initializes the React reconciler bridge to the native renderer
- `live` mode must be managed carefully to avoid unnecessary CPU usage
- `OptimizedBuffer` is used for double-buffered rendering (swap `nextRenderBuffer` / `currentRenderBuffer`)

---

## 5. Cross-SDK Comparison Matrix

| Feature                | Claude Agent SDK                                                   | OpenCode SDK                                   | Copilot SDK                                 |
| ---------------------- | ------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------- |
| **Transport**          | Spawned subprocess (stdin/stdout)                                  | HTTP + SSE                                     | JSON-RPC (stdio or TCP)                     |
| **Entry point**        | `query()` function                                                 | `createOpencode()` or `createOpencodeClient()` | `new CopilotClient()` + `createSession()`   |
| **Session model**      | `Query` (AsyncGenerator)                                           | HTTP endpoints on `OpencodeClient.session`     | `CopilotSession` class                      |
| **Streaming**          | `for await (msg of query)`                                         | SSE via `client.event.subscribe()`             | `session.on(type, handler)` callbacks       |
| **Partial messages**   | `SDKPartialAssistantMessage` (opt-in via `includePartialMessages`) | `message.part.updated` with `delta` field      | `assistant.message_delta` (ephemeral event) |
| **Multi-turn**         | `streamInput()` on Query                                           | `session.prompt()` repeatedly                  | `session.send()` repeatedly                 |
| **Session resume**     | `options.resume = sessionId`                                       | `session.get(id)` + `session.prompt()`         | `client.resumeSession(id, config)`          |
| **Tool definition**    | MCP tools via `tool()` + `createSdkMcpServer()`                    | Server-managed (config-driven)                 | `defineTool()` with Zod schema              |
| **Permission model**   | `canUseTool` callback                                              | `permission.updated` events + HTTP response    | `onPermissionRequest` callback (required)   |
| **Hook system**        | 22 hook events via `HookCallbackMatcher`                           | Server-side hooks via config                   | 6 SDK hooks (`onPreToolUse`, etc.)          |
| **Error types**        | `SDKAssistantMessageError` + `SDKResultMessage` error subtypes     | Error union on `AssistantMessage`              | `session.error` event + `ErrorOccurredHook` |
| **Abort**              | `AbortController` or `query.interrupt()`                           | `client.session.abort()`                       | `session.abort()`                           |
| **Model switching**    | `query.setModel()`                                                 | `session.update()`                             | `session.setModel()`                        |
| **File checkpointing** | `enableFileCheckpointing` + `rewindFiles()`                        | `session.revert()` / `session.unrevert()`      | Workspace snapshots (infinite sessions)     |
| **Context compaction** | `SDKCompactBoundaryMessage`                                        | `session.compacted` event                      | `session.compaction_start/complete` events  |
| **Background tasks**   | `SDKTaskStartedMessage` + `stopTask()`                             | Subtask parts                                  | `session.idle` with `backgroundTasks`       |
| **Subagents**          | `AgentDefinition` in `agents` option                               | Agent parts + `app.agents()`                   | `CustomAgentConfig` in session config       |
| **Message count**      | 18 `SDKMessage` types                                              | 30+ `Event` types                              | 40+ `SessionEvent` types                    |

---

## Source Files Referenced

- `/home/alilavaee/Documents/projects/code-cleanup/docs/claude-agent-sdk.md` - Full Claude Agent SDK reference
- `/home/alilavaee/Documents/projects/code-cleanup/docs/copilot-cli/usage.md` - Copilot CLI usage guide
- `/home/alilavaee/Documents/projects/code-cleanup/docs/copilot-cli/hooks.md` - Copilot hooks reference
- `/home/alilavaee/Documents/projects/code-cleanup/docs/copilot-cli/skills.md` - Copilot skills reference
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` - Claude SDK type declarations
- `node_modules/@github/copilot-sdk/dist/index.d.ts` - Copilot SDK exports
- `node_modules/@github/copilot-sdk/dist/types.d.ts` - Copilot SDK type definitions
- `node_modules/@github/copilot-sdk/dist/session.d.ts` - CopilotSession class
- `node_modules/@github/copilot-sdk/dist/client.d.ts` - CopilotClient class
- `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts` - All 40+ session event types
- `node_modules/@opencode-ai/sdk/dist/index.d.ts` - OpenCode SDK entry point
- `node_modules/@opencode-ai/sdk/dist/client.d.ts` - OpenCode client exports
- `node_modules/@opencode-ai/sdk/dist/server.d.ts` - OpenCode server/TUI creation
- `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts` - OpenCode generated types (events, messages, parts)
- `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts` - OpenCode client class with all methods
- `node_modules/@opentui/core/index.d.ts` - OpenTUI core exports
- `node_modules/@opentui/core/types.d.ts` - OpenTUI types (RenderContext, ViewportBounds, etc.)
- `node_modules/@opentui/core/Renderable.d.ts` - Base Renderable class
- `node_modules/@opentui/core/renderer.d.ts` - CliRenderer class
- `node_modules/@opentui/react/index.js` - React reconciler hooks and exports
- `node_modules/@opentui/react/jsx-namespace.d.ts` - JSX intrinsic elements

