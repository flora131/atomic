# OpenCode SDK Research Document

> **Research Date:** January 31, 2026  
> **Repository:** [anomalyco/opencode](https://github.com/anomalyco/opencode)  
> **Package:** `@opencode-ai/sdk`  
> **Sources:** DeepWiki documentation and repository analysis

---

## Table of Contents

1. [SDK Architecture](#1-sdk-architecture)
2. [Session Management](#2-session-management)
3. [Message Handling](#3-message-handling)
4. [Tool Integration](#4-tool-integration)
5. [Event System](#5-event-system)
6. [Plugin Development](#6-plugin-development)
7. [Configuration](#7-configuration)
8. [TypeScript Types Reference](#8-typescript-types-reference)
9. [Code Examples](#9-code-examples)
10. [Additional Resources](#10-additional-resources)

---

## 1. SDK Architecture

### Overview

The OpenCode SDK (`@opencode-ai/sdk`) provides a type-safe client for interacting with the OpenCode server. It is generated from the server's OpenAPI specification, ensuring synchronization between runtime validation and compile-time types.

**Source:** [DeepWiki - Architecture](https://deepwiki.com/wiki/anomalyco/opencode#2)

### Core Components

```
+-------------------+     HTTP/SSE      +------------------+
|  OpencodeClient   | <---------------> |  OpenCode Server |
+-------------------+                   +------------------+
        |                                       |
        +-- global                              +-- /global/*
        +-- auth                                +-- /auth/*
        +-- project                             +-- /project/*
        +-- session                             +-- /session/*
        +-- event                               +-- /event/*
        +-- worktree                            +-- /worktree/*
```

### Client Architecture

The core client architecture revolves around the `createOpencodeClient` function, which instantiates an `OpencodeClient`. This client communicates with the OpenCode server primarily over:

- **HTTP** - Standard API requests
- **Server-Sent Events (SSE)** - Real-time updates
- **WebSockets** - PTY (pseudo-terminal) sessions

### Module Structure

The SDK is organized with versioned entry points:

| Entry Point | Purpose |
|-------------|---------|
| `@opencode-ai/sdk` | Main entry point with `createOpencode` |
| `@opencode-ai/sdk/client` | Client-only instantiation |
| `@opencode-ai/sdk/v2` | Recommended V2 API entry point |
| `@opencode-ai/sdk/v2/client` | V2 client-only instantiation |

### Generated Files

The SDK generates these files from `openapi.json`:

- `types.gen.ts` - All event types and schemas
- `sdk.gen.ts` - `OpencodeClient` and method definitions
- `client.gen.ts` - Type-safe fetch wrapper

### Creating a Client

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

// Connect to existing server
const client = createOpencodeClient({
  baseUrl: "http://127.0.0.1:4096",
  directory: "/path/to/project"  // Optional: project isolation
})

// The directory is sent as x-opencode-directory header
```

### Creating Server and Client Together

```typescript
import { createOpencode } from "@opencode-ai/sdk"

const { client, server } = await createOpencode({
  hostname: "127.0.0.1",
  port: 4096,
  timeout: 5000,
  config: {
    model: "anthropic/claude-3-5-sonnet-20241022"
  }
})

// Use the client...
const sessions = await client.session.list()

// Clean up
server.close()
```

**Configuration Options for `createOpencode`:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hostname` | `string` | `"127.0.0.1"` | Server hostname |
| `port` | `number` | `4096` | Server port |
| `signal` | `AbortSignal` | - | Cancellation signal |
| `timeout` | `number` | `5000` | Startup timeout (ms) |
| `config` | `Config` | - | Inline configuration |

---

## 2. Session Management

### Session Hierarchy

Sessions in OpenCode represent conversations with AI agents and are organized hierarchically within workspaces.

**Source:** [DeepWiki - Workspace and Session Hierarchy](https://deepwiki.com/wiki/anomalyco/opencode#6.3)

```
Workspace
    |
    +-- Root Session (parentID: undefined)
    |       |
    |       +-- Child Session (parentID: root.id)
    |       |       |
    |       |       +-- Grandchild Session
    |       |
    |       +-- Child Session (forked from message)
    |
    +-- Root Session
```

### Creating Sessions

```typescript
// Create a root session
const session = await client.session.create({
  body: {
    directory: "/path/to/project",
    title: "My Session",
    permission: {
      edit: "ask",
      bash: "allow"
    }
  }
})

// Create a child session
const childSession = await client.session.create({
  body: {
    parentID: session.id,
    title: "Subtask Session"
  }
})
```

### Session Operations

```typescript
// List all sessions
const sessions = await client.session.list({
  query: {
    directory: "/path/to/project",
    roots: true,        // Only root sessions
    start: timestamp,   // Filter by time
    search: "query",    // Search term
    limit: 50           // Max results
  }
})

// Get session details
const session = await client.session.get({
  path: { sessionID: "session-id" }
})

// Get child sessions
const children = await client.session.children({
  path: { sessionID: "parent-session-id" }
})

// Update session
await client.session.update({
  path: { sessionID: "session-id" },
  body: { title: "New Title" }
})

// Delete session
await client.session.delete({
  path: { sessionID: "session-id" }
})

// Abort running session
await client.session.abort({
  path: { sessionID: "session-id" }
})

// Share/unshare session
await client.session.share({ path: { sessionID: "session-id" } })
await client.session.unshare({ path: { sessionID: "session-id" } })
```

### Session State Management

```typescript
// Revert to a specific message
await client.session.revert({
  path: { sessionID: "session-id" },
  body: {
    messageID: "message-id",
    partID: "part-id"  // Optional: revert specific part
  }
})

// Restore reverted messages
await client.session.unrevert({
  path: { sessionID: "session-id" }
})

// Summarize session
const summary = await client.session.summarize({
  path: { sessionID: "session-id" },
  body: {
    providerID: "anthropic",
    modelID: "claude-3-5-sonnet-20241022"
  }
})
```

---

## 3. Message Handling

### Message Types

Messages in OpenCode are a union of `UserMessage` and `AssistantMessage`:

```typescript
type Message = UserMessage | AssistantMessage

interface UserMessage {
  id: string
  sessionID: string
  role: "user"
  parts: Part[]
  createdAt: string
}

interface AssistantMessage {
  id: string
  sessionID: string
  role: "assistant"
  parts: Part[]
  createdAt: string
}
```

### Message Parts

The `Part` type is a union of various content types:

| Part Type | Description |
|-----------|-------------|
| `TextPart` | Plain text content |
| `FilePart` | File attachments with MIME type |
| `ToolPart` | Tool calls with state tracking |
| `StepStartPart` | Marks beginning of a step |
| `StepFinishPart` | Marks end of a step |

```typescript
interface TextPart {
  type: "text"
  content: string
}

interface FilePart {
  type: "file"
  mimeType: string
  filename: string
  url: string
  source?: FileSource
}

interface ToolPart {
  type: "tool"
  callID: string
  tool: string
  state: ToolState
}
```

### Sending Messages

```typescript
// Send a prompt to a session
const response = await client.session.prompt({
  path: { sessionID: "session-id" },
  body: {
    model: {
      providerID: "anthropic",
      modelID: "claude-3-5-sonnet-20241022"
    },
    agent: "coder",
    system: "Custom system prompt",
    parts: [
      { type: "text", content: "Hello, help me with..." },
      { type: "file", filename: "code.ts", url: "file://..." }
    ],
    tools: ["bash", "read", "write", "edit"]
  }
})

// Send message without AI reply
await client.session.prompt({
  path: { sessionID: "session-id" },
  body: {
    parts: [{ type: "text", content: "User note" }],
    noReply: true
  }
})
```

### Retrieving Messages

```typescript
// Get all messages in a session
const messages = await client.session.messages({
  path: { sessionID: "session-id" }
})

// Get specific message
const message = await client.session.message({
  path: {
    sessionID: "session-id",
    messageID: "message-id"
  }
})
```

### Streaming Responses

OpenCode uses Server-Sent Events (SSE) for streaming. Subscribe to the event stream:

```typescript
// Subscribe to events
const events = await client.event.subscribe()

for await (const event of events.stream) {
  switch (event.type) {
    case "message.part.updated":
      // Handle incremental message updates
      console.log("Part updated:", event.properties.part)
      break
      
    case "message.updated":
      // Handle full message updates
      console.log("Message:", event.properties.message)
      break
      
    case "session.error":
      // Handle errors
      console.error("Error:", event.properties.error)
      break
  }
}
```

**SSE Endpoints:**

- `/global/event` - Global event stream
- `/session/:id/message` - Session-specific events

The server sends:
- Initial `server.connected` event on connection
- `server.heartbeat` every 30 seconds
- Real-time `message.part.updated` events during generation

---

## 4. Tool Integration

### Built-in Tools

OpenCode provides these built-in tools:

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `bash` | Execute shell commands | `command`, `workdir`, `timeout` |
| `read` | Read file contents | `filePath` |
| `write` | Create/overwrite files | `filePath` |
| `edit` | Modify files with replacements | `filePath` |
| `glob` | Find files by pattern | `pattern` |
| `grep` | Search file contents | `pattern` |
| `list` | List directory contents | `path` |
| `task` | Launch sub-agents | `subagent_type`, `description` |
| `webfetch` | Fetch URL content | `url` |
| `websearch` | Search the web | query |
| `codesearch` | Search code online | query |
| `todowrite` | Update todo list | - |
| `todoread` | Read todo list | - |
| `question` | Prompt user Y/N | - |
| `apply_patch` | Apply file patches | `files` |

**Source:** [DeepWiki - Built-in Tools](https://deepwiki.com/wiki/anomalyco/opencode#8.1)

### Tool Interface

```typescript
interface Tool {
  id: string
  description: string
  parameters: ZodSchema
  execute: (args: Args, context: ToolContext) => Promise<ToolResult>
}

interface ToolContext {
  sessionID: string
  messageID: string
  callID: string
  agent: string
  abort: AbortSignal
  metadata: (data: object) => void
  ask: (permission: Permission) => Promise<boolean>
}

interface ToolResult {
  output: string
  title?: string
  metadata?: object
  attachments?: Attachment[]
}
```

### Registering Custom Tools

Place tool files in:
- `.opencode/tools/` (project-level)
- `~/.config/opencode/tools/` (global)

```typescript
// .opencode/tools/database.ts
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Query the database",
  args: {
    query: tool.schema.string().describe("SQL query to execute"),
    database: tool.schema.string().optional()
  },
  async execute(args, context) {
    const { directory, worktree, sessionID } = context
    
    // Update metadata during execution
    context.metadata({ status: "executing" })
    
    // Execute the query...
    const result = await executeQuery(args.query)
    
    return {
      output: JSON.stringify(result, null, 2),
      title: "Query Result",
      metadata: { rowCount: result.length }
    }
  }
})
```

### Tool Execution Pipeline

```
1. AI Model generates tool call
       |
2. SessionProcessor creates ToolPart (status: pending)
       |
3. Plugin hook: tool.execute.before
       |
4. Permission check via PermissionNext.ask()
       |
5. Tool execute() function called
       |
6. Plugin hook: tool.execute.after
       |
7. ToolPart updated (status: completed/error)
       |
8. Result returned to AI
```

### Tool State Types

```typescript
type ToolState = 
  | ToolStatePending
  | ToolStateRunning
  | ToolStateCompleted
  | ToolStateError

interface ToolStatePending {
  status: "pending"
}

interface ToolStateRunning {
  status: "running"
  input: object
}

interface ToolStateCompleted {
  status: "completed"
  input: object
  output: ToolOutput
}

interface ToolStateError {
  status: "error"
  input?: object
  error: string
}
```

---

## 5. Event System

### Event Types Reference

**Source:** [DeepWiki - Event System](https://deepwiki.com/wiki/anomalyco/opencode#2)

#### Session Events

| Event | Description |
|-------|-------------|
| `session.created` | New session created |
| `session.updated` | Session information updated |
| `session.deleted` | Session deleted |
| `session.status` | Status change: `idle`, `retry`, `busy` |
| `session.compacted` | Session context compacted |
| `session.diff` | File differences in session |
| `session.error` | Error in session |

#### Message Events

| Event | Description |
|-------|-------------|
| `message.updated` | Message content updated |
| `message.removed` | Message removed |
| `message.part.updated` | Message part updated (streaming) |
| `message.part.removed` | Message part removed |

#### Permission Events

| Event | Description |
|-------|-------------|
| `permission.asked` | Permission requested |
| `permission.replied` | Permission response received |

#### Server Events

| Event | Description |
|-------|-------------|
| `server.connected` | Client connected to server |
| `server.instance.disposed` | Server instance cleaned up |

#### Other Events

| Event | Description |
|-------|-------------|
| `command.executed` | CLI command executed |
| `file.edited` | File modified |
| `file.watcher.updated` | File watcher state changed |
| `installation.updated` | Installation state changed |
| `installation.update-available` | Update available |
| `lsp.client.diagnostics` | LSP diagnostics received |
| `lsp.updated` | LSP state updated |
| `todo.updated` | Todo list changed |
| `mcp.tools.changed` | MCP tools changed |
| `mcp.browser.open.failed` | Browser auth failed |
| `vcs.branch.updated` | Git branch changed |
| `pty.created` | PTY session created |
| `pty.updated` | PTY output received |
| `pty.exited` | PTY session exited |
| `pty.deleted` | PTY session deleted |
| `worktree.ready` | Worktree initialized |
| `worktree.failed` | Worktree init failed |

### Subscribing to Events

```typescript
// Subscribe to all events
const events = await client.event.subscribe()

for await (const event of events.stream) {
  console.log(`Event: ${event.type}`, event.properties)
}

// With filtering (if supported)
const events = await client.event.subscribe({
  query: { directory: "/path/to/project" }
})
```

### Event Handler Pattern

```typescript
async function handleEvents(client: OpencodeClient) {
  const events = await client.event.subscribe()
  
  for await (const event of events.stream) {
    switch (event.type) {
      case "session.created":
        console.log("New session:", event.properties.session.id)
        break
        
      case "session.status":
        const { sessionID, status } = event.properties
        if (status === "idle") {
          console.log(`Session ${sessionID} completed`)
        }
        break
        
      case "message.part.updated":
        const { part } = event.properties
        if (part.type === "text") {
          process.stdout.write(part.content)
        }
        break
        
      case "session.error":
        console.error("Session error:", event.properties.error)
        break
    }
  }
}
```

---

## 6. Plugin Development

### Plugin Architecture

**Source:** [DeepWiki - Plugin System](https://deepwiki.com/wiki/anomalyco/opencode#2)

Plugins extend OpenCode by hooking into various events and customizing behavior. They can be loaded from:

1. **Local files:** `.opencode/plugins/` (project) or `~/.config/opencode/plugins/` (global)
2. **NPM packages:** Specified in `opencode.json` under `"plugin"` array

### Plugin Structure

```typescript
import { type Plugin, type PluginInput, tool } from "@opencode-ai/plugin"

export const MyPlugin: Plugin = async (ctx: PluginInput) => {
  const { client, project, directory, worktree, serverUrl, $ } = ctx
  
  console.log("Plugin initialized for:", directory)
  
  return {
    // Hook implementations
  }
}
```

### Plugin Input Context

| Property | Type | Description |
|----------|------|-------------|
| `client` | `OpencodeClient` | SDK client instance |
| `project` | `Project` | Current project info |
| `directory` | `string` | Working directory |
| `worktree` | `string` | Worktree path |
| `serverUrl` | `string` | Server URL |
| `$` | `Shell` | Bun shell API |

### Available Hooks

#### Event Hook

```typescript
export const EventPlugin: Plugin = async (ctx) => {
  return {
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        // Notify on session completion
        await ctx.$`osascript -e 'display notification "Done!" with title "opencode"'`
      }
    }
  }
}
```

#### Tool Execution Hooks

```typescript
export const ToolPlugin: Plugin = async (ctx) => {
  return {
    "tool.execute.before": async ({ tool, sessionID, callID }, { args }) => {
      // Validate/modify tool arguments
      if (tool === "bash" && args.command.includes("rm -rf")) {
        throw new Error("Dangerous command blocked")
      }
      return { args }  // Return modified args
    },
    
    "tool.execute.after": async ({ tool, sessionID, callID }, result) => {
      // Log or modify results
      console.log(`Tool ${tool} completed:`, result.output)
      return result
    }
  }
}
```

#### Command Hook

```typescript
export const CommandPlugin: Plugin = async (ctx) => {
  return {
    "command.execute.before": async ({ command, args }) => {
      // Modify command arguments
      console.log(`Executing command: ${command}`)
      return { args }
    }
  }
}
```

#### Chat Hooks

```typescript
export const ChatPlugin: Plugin = async (ctx) => {
  return {
    "chat.message": async ({ message }) => {
      // React to new messages
      console.log("New message:", message.id)
    },
    
    "chat.params": async (params) => {
      // Modify LLM parameters
      return {
        ...params,
        temperature: 0.7,
        topP: 0.9
      }
    },
    
    "chat.headers": async (headers) => {
      // Add custom headers
      return {
        ...headers,
        "X-Custom-Header": "value"
      }
    }
  }
}
```

#### Permission Hook

```typescript
export const PermissionPlugin: Plugin = async (ctx) => {
  return {
    "permission.ask": async ({ permission, tool, args }) => {
      // Auto-approve certain permissions
      if (tool === "read") {
        return { granted: true }
      }
      // Let default handling proceed
      return undefined
    }
  }
}
```

#### Experimental Hooks

```typescript
export const ExperimentalPlugin: Plugin = async (ctx) => {
  return {
    "experimental.session.compacting": async ({ prompt, messages }) => {
      // Customize compaction prompt
      return {
        prompt: `${prompt}\n\nKeep technical details.`,
        messages
      }
    },
    
    "experimental.chat.messages.transform": async (messages) => {
      // Transform message history
      return messages
    },
    
    "experimental.chat.system.transform": async (system) => {
      // Modify system prompt
      return system + "\n\nAdditional instructions..."
    }
  }
}
```

### Custom Tools in Plugins

```typescript
import { type Plugin, tool } from "@opencode-ai/plugin"

export const ToolsPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      mytool: tool({
        description: "A custom tool",
        args: {
          input: tool.schema.string(),
          count: tool.schema.number().optional()
        },
        async execute(args, context) {
          const result = await processInput(args.input)
          return `Processed: ${result}`
        }
      }),
      
      anothertool: tool({
        description: "Another tool",
        args: {
          data: tool.schema.object({
            name: tool.schema.string(),
            value: tool.schema.any()
          })
        },
        async execute(args, context) {
          return JSON.stringify(args.data)
        }
      })
    }
  }
}
```

### Complete Plugin Example

```typescript
// .opencode/plugins/security.ts
import { type Plugin, tool } from "@opencode-ai/plugin"

export const SecurityPlugin: Plugin = async ({ client, $, directory }) => {
  console.log(`Security plugin loaded for: ${directory}`)
  
  // Track dangerous operations
  const operationLog: Array<{ tool: string; time: Date; args: any }> = []
  
  return {
    // Block dangerous patterns
    "tool.execute.before": async ({ tool, sessionID }, { args }) => {
      // Block .env file access
      if (tool === "read" && args.filePath?.includes(".env")) {
        throw new Error("Cannot read .env files")
      }
      
      // Sanitize bash commands
      if (tool === "bash") {
        const dangerous = ["rm -rf /", ":(){ :|:& };:"]
        if (dangerous.some(d => args.command.includes(d))) {
          throw new Error("Dangerous command blocked")
        }
      }
      
      // Log operation
      operationLog.push({ tool, time: new Date(), args })
      
      return { args }
    },
    
    // Notify on completion
    event: async ({ event }) => {
      if (event.type === "session.status" && event.properties.status === "idle") {
        if (process.platform === "darwin") {
          await $`osascript -e 'display notification "Session complete" with title "OpenCode"'`
        }
      }
    },
    
    // Custom security audit tool
    tool: {
      security_audit: tool({
        description: "Show recent tool operations",
        args: {
          limit: tool.schema.number().default(10)
        },
        async execute(args) {
          const recent = operationLog.slice(-args.limit)
          return JSON.stringify(recent, null, 2)
        }
      })
    }
  }
}
```

---

## 7. Configuration

### Configuration File

Create `opencode.json` or `opencode.jsonc` in your project root:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  
  // Default model
  "model": "anthropic/claude-3-5-sonnet-20241022",
  "small_model": "anthropic/claude-3-5-haiku-20241022",
  
  // Provider configuration
  "provider": {
    "anthropic": {
      "timeout": 60000
    },
    "bedrock": {
      "region": "us-east-1",
      "profile": "default"
    }
  },
  
  // Tool permissions
  "permission": {
    "edit": "ask",
    "bash": "ask",
    "webfetch": "allow"
  },
  
  // Tool availability
  "tools": {
    "bash": true,
    "write": true,
    "task": false
  },
  
  // MCP servers
  "mcp": {
    "filesystem": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "-y", "@anthropic-ai/mcp-server-fs"]
    },
    "remote-api": {
      "type": "remote",
      "enabled": true,
      "url": "https://mcp.example.com",
      "headers": {
        "Authorization": "Bearer {env:MCP_API_KEY}"
      }
    }
  },
  
  // Plugins
  "plugin": [
    "@opencode-ai/plugin-security",
    "./plugins/custom.ts"
  ],
  
  // Instructions
  "instructions": [
    ".opencode/instructions.md",
    "docs/*.instructions.md"
  ],
  
  // TUI settings
  "tui": {
    "scroll_speed": 3,
    "diff_style": "unified"
  },
  
  // Server settings
  "server": {
    "port": 4096,
    "hostname": "127.0.0.1"
  },
  
  // Context compaction
  "compaction": {
    "auto": true,
    "prune": true
  }
}
```

### Configuration Precedence

1. Remote config (`.well-known/opencode`)
2. Global config (`~/.config/opencode/opencode.json`)
3. Custom config (`OPENCODE_CONFIG` env var)
4. Project config (`opencode.json`)
5. `.opencode` directories
6. Inline config (`OPENCODE_CONFIG_CONTENT` env var)

### Environment Variable Substitution

```jsonc
{
  "provider": {
    "custom": {
      "apiKey": "{env:CUSTOM_API_KEY}",
      "baseURL": "{env:CUSTOM_BASE_URL}"
    }
  },
  // File content substitution
  "instructions": "{file:./system-prompt.md}"
}
```

### Custom Providers

```jsonc
{
  "provider": {
    "my-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My Custom Provider",
      "baseURL": "https://api.myprovider.com/v1",
      "options": {
        "apiKey": "{env:MY_PROVIDER_KEY}",
        "headers": {
          "X-Custom": "value"
        }
      },
      "models": {
        "my-model": {
          "name": "My Model",
          "context": 128000,
          "output": 8192
        }
      }
    }
  }
}
```

### Permission Values

| Value | Behavior |
|-------|----------|
| `"allow"` | Always permit |
| `"deny"` | Always block |
| `"ask"` | Prompt user |

---

## 8. TypeScript Types Reference

### Core Types

```typescript
// Session
interface Session {
  id: string
  projectID: string
  directory: string
  title: string
  version: number
  createdAt: string
  updatedAt: string
  summary?: string
  share?: ShareInfo
  permission?: PermissionRuleset
  revert?: RevertInfo
  parentID?: string
}

// Message
type Message = UserMessage | AssistantMessage

interface UserMessage {
  id: string
  sessionID: string
  role: "user"
  parts: Part[]
  createdAt: string
}

interface AssistantMessage {
  id: string
  sessionID: string
  role: "assistant"
  parts: Part[]
  createdAt: string
}

// Parts
type Part = TextPart | FilePart | ToolPart | StepStartPart | StepFinishPart

interface TextPart {
  type: "text"
  id: string
  content: string
}

interface FilePart {
  type: "file"
  id: string
  mimeType: string
  filename: string
  url: string
}

interface ToolPart {
  type: "tool"
  id: string
  callID: string
  tool: string
  state: ToolState
}

// Tool State
type ToolState = 
  | { status: "pending" }
  | { status: "running"; input: unknown }
  | { status: "completed"; input: unknown; output: ToolOutput }
  | { status: "error"; input?: unknown; error: string }

// Events
type Event =
  | EventSessionCreated
  | EventSessionUpdated
  | EventSessionDeleted
  | EventSessionStatus
  | EventSessionError
  | EventMessageUpdated
  | EventMessageRemoved
  | EventMessagePartUpdated
  | EventMessagePartRemoved
  | EventPermissionAsked
  | EventPermissionReplied
  | EventServerConnected
  // ... and more

interface EventSessionStatus {
  type: "session.status"
  properties: {
    sessionID: string
    status: "idle" | "busy" | "retry"
  }
}

interface EventMessagePartUpdated {
  type: "message.part.updated"
  properties: {
    sessionID: string
    messageID: string
    part: Part
  }
}
```

### Client Interface

```typescript
interface OpencodeClient {
  global: GlobalAPI
  auth: AuthAPI
  project: ProjectAPI
  session: SessionAPI
  event: EventAPI
  worktree: WorktreeAPI
  config: ConfigAPI
}

interface SessionAPI {
  list(options?: ListOptions): Promise<Session[]>
  get(options: { path: { sessionID: string } }): Promise<Session>
  create(options: { body: CreateSessionBody }): Promise<Session>
  update(options: { path: { sessionID: string }; body: UpdateBody }): Promise<Session>
  delete(options: { path: { sessionID: string } }): Promise<void>
  abort(options: { path: { sessionID: string } }): Promise<void>
  messages(options: { path: { sessionID: string } }): Promise<Message[]>
  prompt(options: { path: { sessionID: string }; body: PromptBody }): Promise<PromptResponse>
  // ... more methods
}

interface EventAPI {
  subscribe(options?: SubscribeOptions): Promise<{
    stream: AsyncGenerator<Event>
  }>
}
```

### Plugin Types

```typescript
import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"

type Plugin = (input: PluginInput) => Promise<Hooks>

interface PluginInput {
  client: OpencodeClient
  project: Project
  directory: string
  worktree: string
  serverUrl: string
  $: BunShell
}

interface Hooks {
  event?: (ctx: { event: Event }) => Promise<void>
  "tool.execute.before"?: (info: ToolInfo, data: { args: unknown }) => Promise<{ args: unknown }>
  "tool.execute.after"?: (info: ToolInfo, result: ToolResult) => Promise<ToolResult>
  "command.execute.before"?: (ctx: CommandCtx) => Promise<{ args: unknown }>
  "chat.message"?: (ctx: { message: Message }) => Promise<void>
  "chat.params"?: (params: ChatParams) => Promise<ChatParams>
  "chat.headers"?: (headers: Headers) => Promise<Headers>
  "permission.ask"?: (ctx: PermissionCtx) => Promise<{ granted: boolean } | undefined>
  tool?: Record<string, ToolDefinition>
  // ... experimental hooks
}
```

---

## 9. Code Examples

### Basic Client Usage

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

async function main() {
  const client = createOpencodeClient({
    baseUrl: "http://127.0.0.1:4096"
  })
  
  // Create a session
  const session = await client.session.create({
    body: {
      title: "Code Review Session"
    }
  })
  
  // Send a prompt
  const response = await client.session.prompt({
    path: { sessionID: session.id },
    body: {
      model: {
        providerID: "anthropic",
        modelID: "claude-3-5-sonnet-20241022"
      },
      parts: [{
        type: "text",
        content: "Review the error handling in src/api/handlers.ts"
      }]
    }
  })
  
  console.log("Response:", response)
}
```

### Streaming with Event Handling

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

async function streamingExample() {
  const client = createOpencodeClient({
    baseUrl: "http://127.0.0.1:4096"
  })
  
  // Start event subscription
  const events = await client.event.subscribe()
  
  // Create session and send prompt
  const session = await client.session.create({
    body: { title: "Streaming Demo" }
  })
  
  // Start prompt (non-blocking)
  client.session.prompt({
    path: { sessionID: session.id },
    body: {
      model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
      parts: [{ type: "text", content: "Write a hello world in Python" }]
    }
  })
  
  // Process events
  for await (const event of events.stream) {
    if (event.type === "message.part.updated") {
      const { part, sessionID } = event.properties
      if (sessionID === session.id && part.type === "text") {
        process.stdout.write(part.content)
      }
    }
    
    if (event.type === "session.status") {
      if (event.properties.sessionID === session.id && 
          event.properties.status === "idle") {
        console.log("\n\nSession complete!")
        break
      }
    }
  }
}
```

### Full Integration Example (Slack Bot Pattern)

```typescript
import { createOpencode } from "@opencode-ai/sdk"

async function slackBotExample() {
  // Start server and client
  const { client, server } = await createOpencode({
    port: 4096,
    config: {
      model: "anthropic/claude-3-5-sonnet-20241022",
      permission: {
        bash: "ask",
        edit: "ask"
      }
    }
  })
  
  // Session cache by thread
  const sessions = new Map<string, string>()
  
  async function handleSlackMessage(threadId: string, userMessage: string) {
    // Get or create session
    let sessionId = sessions.get(threadId)
    
    if (!sessionId) {
      const session = await client.session.create({
        body: {
          title: `Slack Thread: ${threadId}`
        }
      })
      sessionId = session.id
      sessions.set(threadId, sessionId)
    }
    
    // Send prompt and wait for response
    const response = await client.session.prompt({
      path: { sessionID: sessionId },
      body: {
        model: {
          providerID: "anthropic",
          modelID: "claude-3-5-sonnet-20241022"
        },
        parts: [{
          type: "text",
          content: userMessage
        }]
      }
    })
    
    // Extract text response
    const textParts = response.parts
      .filter(p => p.type === "text")
      .map(p => p.content)
      .join("\n")
    
    return textParts
  }
  
  // Cleanup on shutdown
  process.on("SIGINT", () => {
    server.close()
    process.exit(0)
  })
}
```

---

## 10. Additional Resources

### Official Documentation

- [OpenCode Website](https://opencode.ai)
- [Configuration Schema](https://opencode.ai/config.json)
- [GitHub Repository](https://github.com/anomalyco/opencode)

### DeepWiki References

- [Architecture Overview](https://deepwiki.com/wiki/anomalyco/opencode#2)
- [Workspace and Session Hierarchy](https://deepwiki.com/wiki/anomalyco/opencode#6.3)
- [Built-in Tools](https://deepwiki.com/wiki/anomalyco/opencode#8.1)
- [Terminal User Interface](https://deepwiki.com/wiki/anomalyco/opencode#4.2)
- [Environment Variables and Flags](https://deepwiki.com/wiki/anomalyco/opencode#9.3)

### Key Source Files

| File | Description |
|------|-------------|
| `packages/sdk/js/src/v2/gen/types.gen.ts` | Generated TypeScript types |
| `packages/sdk/js/src/v2/gen/sdk.gen.ts` | Generated SDK client |
| `packages/opencode/src/server/routes/session.ts` | Session API implementation |
| `packages/opencode/src/tool/registry.ts` | Tool registry |
| `packages/opencode/src/plugin/index.ts` | Plugin system |

### Search Queries Used

- [Architecture Query](https://deepwiki.com/search/what-is-the-architecture-of-th_61d37658-7d2d-4ece-9e08-7284bf920134)
- [Plugin Development Query](https://deepwiki.com/search/how-do-i-create-plugins-for-op_6289222c-dc43-4b95-9484-ba81019f16bd)
- [Event System Query](https://deepwiki.com/search/what-events-are-available-in-t_0ee85e52-4873-4aba-9628-0b988ac4a1e6)
- [Session Management Query](https://deepwiki.com/search/how-do-i-manage-sessions-and-m_282d3266-9b8b-45b9-a2a3-b299509aacf2)
- [Tool Integration Query](https://deepwiki.com/search/what-is-the-tool-integration-p_3c7452b7-f518-4e59-bd38-f202e6ec6201)

---

## Gaps and Limitations

### Information Not Found

1. **Error handling patterns** - Detailed error types and recovery strategies not fully documented
2. **Rate limiting** - No documentation on API rate limits or throttling
3. **Authentication flows** - OAuth and API key management details sparse
4. **Testing utilities** - No mock client or testing helpers documented
5. **Migration guides** - V1 to V2 migration path not detailed

### Recommendations for Further Research

1. Review source code in `packages/opencode/src/` for implementation details
2. Check GitHub Issues for common problems and solutions
3. Examine example integrations in `packages/slack/` and similar
4. Test API endpoints directly to verify behavior

---

*This document was generated through DeepWiki research on January 31, 2026. Information may change as the OpenCode SDK evolves.*
