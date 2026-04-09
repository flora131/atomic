# Session Configuration

Each SDK has its own configuration options for controlling model selection, tools, permissions, hooks, and structured output. Configure these within each session callback.

## Claude Agent SDK

### `createClaudeSession()` options

Start the Claude TUI in a tmux pane. Must be called before any `claudeQuery()` on the same pane:

```ts
import { createClaudeSession } from "@bastani/atomic/workflows";

// Default flags (skip all permissions)
await createClaudeSession({ paneId: s.paneId });

// Custom CLI flags
await createClaudeSession({
  paneId: s.paneId,
  chatFlags: ["--model", "opus", "--dangerously-skip-permissions"],
  readyTimeoutMs: 60_000,  // Wait up to 60s for TUI (default: 30s)
});
```

### `query()` options

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: ctx.userPrompt,
  options: {
    // Model selection
    model: "claude-opus-4-6",         // Full model ID or alias ("opus", "sonnet", "haiku")
    effort: "high",                   // "low", "medium", "high", "max" (max is Opus 4.6 only)
    thinking: { type: "adaptive" },   // Default for supported models; or { type: "enabled", budgetTokens: N }
    maxTurns: 50,                     // Maximum conversation turns
    maxBudgetUsd: 5.0,                // Spending cap in USD

    // Permissions
    permissionMode: "acceptEdits",    // "default", "dontAsk", "acceptEdits", "bypassPermissions", "plan"

    // Tools — base set of available built-in tools
    tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],  // or { type: "preset", preset: "claude_code" } for all defaults
    allowedTools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],  // auto-allowed without prompting
    disallowedTools: ["AskUserQuestion"],  // removed from model's context

    // System prompt — string or preset with additions
    systemPrompt: "You are a senior security auditor...",
    // Or: { type: "preset", preset: "claude_code", append: "Always explain your reasoning." }

    // Structured output
    outputFormat: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          tasks: { type: "array", items: { type: "string" } },
        },
      },
    },

    // Subagents — Record<string, AgentDefinition> keyed by name
    agents: {
      worker: { description: "Implement tasks", prompt: "You are a task implementer...", tools: ["Read", "Write", "Edit", "Bash"] },
    },
    agent: "worker",                  // Main thread agent name (optional)

    // MCP servers
    mcpServers: {
      "my-server": { command: "node", args: ["server.js"] },
    },

    // Session continuity
    resume: previousSessionId,         // Resume a prior session
    forkSession: true,                 // When true with resume, forks to new session
    persistSession: true,              // Persist session to disk (default: true)

    // Sandbox — isolated command execution
    sandbox: { enabled: true, autoAllowBashIfSandboxed: true },

    // Beta features
    betas: ["context-1m-2025-08-07"], // 1M context window (Sonnet 4/4.5 only)
  },
});
```

### `claudeQuery()` options

The `claudeQuery()` helper sends text to a tmux pane. Requires `createClaudeSession()` to have been called first on the same pane:

```ts
import { createClaudeSession, claudeQuery } from "@bastani/atomic/workflows";

await createClaudeSession({ paneId: s.paneId });
const result = await claudeQuery({
  paneId: s.paneId,       // tmux pane ID (from SessionContext)
  prompt: "Your prompt",  // Text to send
});
// result.output — captured response text
```

### Claude hooks

Hooks intercept tool usage, session events, and context management. The `hooks` option is `Partial<Record<HookEvent, HookCallbackMatcher[]>>` — each event maps to an array of matchers with callback arrays:

```ts
const result = query({
  prompt: ctx.userPrompt,
  options: {
    hooks: {
      PreToolUse: [{
        matcher: (input) => input.tool_name === "Bash",  // Optional — filter which events trigger this hook
        hooks: [async (input, toolUseID, { signal }) => {
          // input.tool_name, input.tool_input available
          if (input.tool_input?.command?.includes("rm -rf")) {
            return { decision: "deny", reason: "Dangerous command" };
          }
          return { decision: "allow" };
          // Return values: { decision: "allow" | "deny" | "ask" | "defer" }
        }],
      }],
      PostToolUse: [{
        hooks: [async (input) => {
          // React after a tool completes
          console.log(`Tool ${input.tool_name} completed`);
        }],
      }],
      Stop: [{
        hooks: [async (input) => {
          // Called when the agent wants to stop
        }],
      }],
      PreCompact: [{
        hooks: [async (input) => {
          // Before context compaction — inject durable context
          return { additionalContext: "Remember: always run tests after edits." };
        }],
      }],
    },
  },
});
```

**Hook events** (most commonly used): `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionStart`, `SessionEnd`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Notification`, `PermissionRequest`, `PermissionDenied`, `Elicitation`, `ElicitationResult`, `ConfigChange`, `FileChanged`, `CwdChanged`.

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
  baseUrl: s.serverUrl,   // From SessionContext
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
