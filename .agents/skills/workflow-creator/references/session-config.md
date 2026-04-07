# Session Configuration

Each SDK has its own configuration options for controlling model selection, tools, permissions, hooks, and structured output. Configure these within each session's `run()` callback.

## Claude Agent SDK

### `query()` options

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: ctx.userPrompt,
  options: {
    // Model selection
    model: "opus",                    // "opus", "sonnet", "haiku" or full model ID
    effort: "high",                   // "low", "medium", "high"
    maxTurns: 50,                     // Maximum conversation turns
    maxBudgetUsd: 5.0,                // Spending cap in USD

    // Permissions
    permissionMode: "acceptEdits",    // "default", "dontAsk", "acceptEdits", "bypassPermissions", "auto"

    // Tools
    allowedTools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
    disallowedTools: ["AskUserQuestion"],

    // System prompt
    systemPrompt: "You are a senior security auditor...",

    // Structured output
    outputFormat: {
      type: "json",
      schema: {
        type: "object",
        properties: {
          tasks: { type: "array", items: { type: "string" } },
        },
      },
    },

    // Subagents
    agents: [
      { name: "worker", description: "Implement tasks", allowedTools: ["Read", "Write", "Edit", "Bash"] },
    ],

    // MCP servers
    mcpServers: {
      "my-server": { command: "node", args: ["server.js"] },
    },

    // Session continuity
    resume: previousSessionId,         // Resume a prior session
    forkSession: previousSessionId,    // Fork from a prior session
    persistSession: true,              // Persist session to disk
  },
});
```

### `claudeQuery()` options

The `claudeQuery()` helper is simpler — it sends text to a tmux pane:

```ts
import { claudeQuery } from "@bastani/atomic-workflows";

const result = await claudeQuery({
  paneId: ctx.paneId,     // tmux pane ID (from SessionContext)
  prompt: "Your prompt",  // Text to send
});
// result.output — captured response text
```

### Claude hooks

Hooks intercept tool usage, session events, and context management:

```ts
const result = query({
  prompt: ctx.userPrompt,
  options: {
    hooks: {
      PreToolUse: async (event) => {
        // Inspect or modify before a tool runs
        if (event.tool === "Bash" && event.input.command.includes("rm")) {
          return { decision: "block", reason: "Dangerous command" };
        }
        return { decision: "approve" };
      },
      PostToolUse: async (event) => {
        // React after a tool completes
        console.log(`Tool ${event.tool} completed`);
      },
      Stop: async (event) => {
        // Called when the agent wants to stop
      },
      PreCompact: async (event) => {
        // Before context compaction — inject durable context
        return { additionalContext: "Remember: always run tests after edits." };
      },
    },
  },
});
```

## Copilot SDK

### `createSession()` options

```ts
import { CopilotClient, approveAll, defineTool } from "@github/copilot-sdk";

const session = await client.createSession({
  // Model selection
  model: "claude-sonnet-4.6",
  reasoningEffort: "high",

  // System prompt
  systemMessage: "You are a security auditor...",

  // Custom tools
  tools: [
    defineTool({
      name: "check-coverage",
      description: "Check test coverage",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      execute: async (params) => ({ content: "Coverage: 85%" }),
    }),
  ],

  // Permissions (required)
  onPermissionRequest: approveAll,    // Or custom handler

  // User input
  onUserInputRequest: async (request) => {
    return "User's response";
  },
  onElicitationRequest: async (request) => {
    return { action: "submit", values: { choice: "option-a" } };
  },

  // Hooks
  hooks: {
    onPreToolUse: (event) => { /* before tool */ },
    onPostToolUse: (event) => { /* after tool */ },
    onSessionStart: (event) => { /* session started */ },
    onSessionEnd: (event) => { /* session ended */ },
    onErrorOccurred: (event) => { /* error handling */ },
  },

  // Advanced
  infiniteSessions: true,             // Auto-manage context via compaction
  provider: {                          // Custom provider config
    name: "my-provider",
    baseUrl: "https://api.example.com",
    apiKey: "...",
  },
});
```

### Copilot permission modes

```ts
// Approve everything (autonomous)
const session = await client.createSession({
  onPermissionRequest: approveAll,
});

// Custom permission handler
const session = await client.createSession({
  onPermissionRequest: async (request) => {
    // request.kind: "shell" | "write" | "read" | "mcp" | "custom-tool" | "url" | "memory" | "hook"
    switch (request.kind) {
      case "shell":
        // Inspect command before approving
        return request.command?.includes("rm")
          ? { kind: "denied-permanently", reason: "Dangerous" }
          : { kind: "approved" };
      case "write":
        // Allow all file writes
        return { kind: "approved" };
      default:
        return { kind: "approved" };
    }
  },
});
```

## OpenCode SDK

### Client creation

```ts
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk/v2";

// Option 1: Start server + client (standalone)
const opencode = await createOpencode({
  hostname: "localhost",
  port: 3000,
  config: {
    // Inline config overrides opencode.json
  },
});

// Option 2: Client-only (connect to existing server — typical for workflows)
const client = createOpencodeClient({
  baseUrl: ctx.serverUrl,   // From SessionContext
});
```

### Session prompting

```ts
// Basic prompt
const result = await client.session.prompt({
  sessionID: session.data!.id,
  parts: [{ type: "text", text: "Your prompt" }],
});

// Structured output
const result = await client.session.prompt({
  sessionID: session.data!.id,
  parts: [{ type: "text", text: "List endpoints as JSON" }],
  format: {
    type: "json_schema",
    schema: { type: "object", properties: { endpoints: { type: "array" } } },
    retryCount: 3,
  },
});

// No-reply context injection
await client.session.prompt({
  sessionID: session.data!.id,
  parts: [{ type: "text", text: "Background context..." }],
  noReply: true,
});
```

### OpenCode session management

```ts
// Create session
const session = await client.session.create({ title: "my-session" });

// Select session in TUI
await client.tui.selectSession({ sessionID: session.data!.id });

// Fork session
await client.session.fork({ sessionID: session.data!.id, messageID: "..." });

// Abort
await client.session.abort({ sessionID: session.data!.id });

// Session messages
const messages = await client.session.messages({ sessionID: session.data!.id });
```

### OpenCode event streaming

```ts
const unsubscribe = await client.event.subscribe((event) => {
  switch (event.type) {
    case "session.updated":
      console.log("Session updated");
      break;
    case "message.created":
      console.log("New message");
      break;
  }
});
```

### OpenCode permissions

```ts
// Handle permission requests
await client.session.permission({
  sessionID: session.data!.id,
  permissionID: "...",
  approved: true,
});
```
