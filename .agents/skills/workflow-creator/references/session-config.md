# Session Configuration

Each SDK has its own configuration options for controlling model selection, tools, permissions, hooks, and structured output. Pass these via `clientOpts` (2nd arg to `ctx.stage()`) and `sessionOpts` (3rd arg to `ctx.stage()`). The runtime uses them to create the client and session automatically — no manual client or session creation needed.

## Claude Agent SDK

### Client options (`clientOpts` — 2nd arg to `ctx.stage()`)

These control how the Claude TUI pane is started:

```ts
await ctx.stage({ name: "..." }, {
  chatFlags: ["--model", "opus", "--dangerously-skip-permissions"],
  readyTimeoutMs: 60_000,  // Wait up to 60s for TUI (default: 30s)
}, {}, async (s) => {
  // s.client and s.session are ready
});
```

### Session options (`sessionOpts` — 3rd arg to `ctx.stage()`)

These are `ClaudeQueryDefaults` and set defaults for every `s.session.query()`
call inside the callback (`timeoutMs`, `pollIntervalMs`, etc.):

```ts
await ctx.stage({ name: "..." }, {}, {
  timeoutMs: 5 * 60 * 1000,     // 5 minutes per query (default)
  pollIntervalMs: 1_000,         // Poll interval for output
}, async (s) => {
  await s.session.query(ctx.userPrompt);
  s.save(s.sessionId);
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

### `s.session.query()` usage

`s.session.query()` sends text to the Claude pane, verifies delivery, and waits for output stabilization. It uses
the pane ID from `s.paneId` automatically. Call it inside the stage callback:

```ts
await ctx.stage({ name: "..." }, {}, {}, async (s) => {
  const result = await s.session.query("Your prompt");
  // result.output — captured response text
  s.save(s.sessionId);
});
```

The query defaults (timeout, poll interval) can be configured via `sessionOpts`
as shown above.

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

### Session options (`sessionOpts` — 3rd arg to `ctx.stage()`)

All `client.createSession()` options are passed as `sessionOpts`. The runtime
forwards them to `client.createSession()`. `onPermissionRequest` defaults to
`approveAll` when not specified.

```ts
import { approveAll, defineTool } from "@github/copilot-sdk";

await ctx.stage({ name: "plan" }, {}, {
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

  // Permissions (defaults to approveAll if omitted)
  onPermissionRequest: approveAll,

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
}, async (s) => {
  await s.session.sendAndWait({ prompt: ctx.userPrompt }, SEND_TIMEOUT_MS);
  s.save(await s.session.getMessages());
});
```

### Copilot permission modes

```ts
// Approve everything (autonomous) — this is the default
await ctx.stage({ name: "plan" }, {}, { onPermissionRequest: approveAll }, async (s) => {
  await s.session.sendAndWait({ prompt: ctx.userPrompt }, SEND_TIMEOUT_MS);
  s.save(await s.session.getMessages());
});

// Custom permission handler
await ctx.stage({ name: "plan" }, {}, {
  onPermissionRequest: async (request) => {
    // request.kind: "shell" | "write" | "read" | "mcp" | "custom-tool" | "url" | "memory" | "hook"
    switch (request.kind) {
      case "shell":
        return request.command?.includes("rm")
          ? { kind: "denied-permanently", reason: "Dangerous" }
          : { kind: "approved" };
      case "write":
        return { kind: "approved" };
      default:
        return { kind: "approved" };
    }
  },
}, async (s) => {
  await s.session.sendAndWait({ prompt: ctx.userPrompt }, SEND_TIMEOUT_MS);
  s.save(await s.session.getMessages());
});
```

## OpenCode SDK

### Client options (`clientOpts` — 2nd arg to `ctx.stage()`)

The `baseUrl` is auto-injected by the runtime. Pass any additional client
options (such as `directory`) via `clientOpts`:

```ts
await ctx.stage({ name: "..." }, {
  directory: "/path/to/project",   // Override working directory
}, {}, async (s) => {
  // s.client is the OpencodeClient, already connected
});
```

### Session options (`sessionOpts` — 3rd arg to `ctx.stage()`)

These are forwarded to `client.session.create()`. Use them to set a title,
parentID, or workspaceID for the session:

```ts
await ctx.stage({ name: "..." }, {}, {
  title: "Feature implementation",
  parentID: "parent-session-id",
  workspaceID: "workspace-id",
}, async (s) => {
  // s.session is the created OpencodeSession, s.session.id is the session ID
});
```

### Session prompting

Use `s.client` and `s.session.id` inside the callback:

```ts
await ctx.stage({ name: "implement" }, {}, {}, async (s) => {
  // Basic prompt
  const result = await s.client.session.prompt({
    sessionID: s.session.id,
    parts: [{ type: "text", text: ctx.userPrompt }],
  });

  // Structured output
  const structured = await s.client.session.prompt({
    sessionID: s.session.id,
    parts: [{ type: "text", text: "List endpoints as JSON" }],
    format: {
      type: "json_schema",
      schema: { type: "object", properties: { endpoints: { type: "array" } } },
      retryCount: 3,
    },
  });

  // No-reply context injection
  await s.client.session.prompt({
    sessionID: s.session.id,
    parts: [{ type: "text", text: "Background context..." }],
    noReply: true,
  });

  s.save(result.data!);
});
```

### OpenCode session management

```ts
await ctx.stage({ name: "..." }, {}, {}, async (s) => {
  // Select session in TUI (auto-called by runtime, but can be called again)
  await s.client.tui.selectSession({ sessionID: s.session.id });

  // Fork session
  await s.client.session.fork({ sessionID: s.session.id, messageID: "..." });

  // Abort
  await s.client.session.abort({ sessionID: s.session.id });

  // Session messages
  const messages = await s.client.session.messages({ sessionID: s.session.id });
});
```

### OpenCode event streaming

```ts
await ctx.stage({ name: "..." }, {}, {}, async (s) => {
  const unsubscribe = await s.client.event.subscribe((event) => {
    switch (event.type) {
      case "session.updated":
        console.log("Session updated");
        break;
      case "message.created":
        console.log("New message");
        break;
    }
  });
});
```

### OpenCode permissions

```ts
await ctx.stage({ name: "..." }, {}, {}, async (s) => {
  // Handle permission requests
  await s.client.session.permission({
    sessionID: s.session.id,
    permissionID: "...",
    approved: true,
  });
});
```
