# Agent Sessions

Each `.session()` in a workflow creates an isolated agent session. The `run(ctx)` callback contains raw SDK code for your target agent. This is the programmatic equivalent of defining agent stages — you have full access to every SDK feature.

## Claude Agent SDK

Claude runs as a full interactive TUI in a tmux pane. The `claudeQuery()` helper automates it via tmux send-keys.

### Basic usage with `claudeQuery()`

```ts
import { defineWorkflow, claudeQuery } from "@bastani/atomic-workflows";

// ...
.session({
  name: "implement",
  description: "Implement the feature",
  run: async (ctx) => {
    const result = await claudeQuery({
      paneId: ctx.paneId,
      prompt: ctx.userPrompt,
    });
    // result.output contains the captured response text
    ctx.save(ctx.sessionId);
  },
})
```

`claudeQuery()` sends text to the Claude pane, verifies delivery, retries if needed, and waits for output stabilization. Returns `{ output: string }`.

### Multi-turn conversations

Claude maintains conversation context across calls within the same pane. Send multiple prompts in one session for multi-turn conversations:

```ts
run: async (ctx) => {
  // Turn 1: Plan
  await claudeQuery({ paneId: ctx.paneId, prompt: "Plan the implementation." });
  // Turn 2: Execute (Claude remembers the plan)
  await claudeQuery({ paneId: ctx.paneId, prompt: "Now implement the plan." });
  // Turn 3: Verify
  await claudeQuery({ paneId: ctx.paneId, prompt: "Run the tests." });
  ctx.save(ctx.sessionId);
},
```

### Advanced: Claude Agent SDK `query()` API

For programmatic control beyond tmux automation, the Claude Agent SDK provides `query()`:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

run: async (ctx) => {
  const result = query({
    prompt: ctx.userPrompt,
    options: {
      model: "opus",
      effort: "high",
      maxTurns: 50,
      maxBudgetUsd: 5.0,
      permissionMode: "acceptEdits",
      allowedTools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
      disallowedTools: ["AskUserQuestion"],
      systemPrompt: "You are a senior engineer...",
      outputFormat: { type: "json", schema: { ... } },
      agents: [{ name: "reviewer", ... }],  // Subagents
    },
  });
  for await (const message of result) {
    // Process streaming messages
  }
},
```

Key `query()` options:
- `model` — model alias or ID (`"opus"`, `"sonnet"`, `"haiku"`)
- `effort` — reasoning effort (`"low"`, `"medium"`, `"high"`)
- `maxTurns` — maximum conversation turns
- `maxBudgetUsd` — spending cap in USD
- `permissionMode` — `"default"`, `"dontAsk"`, `"acceptEdits"`, `"bypassPermissions"`, `"auto"`
- `allowedTools` / `disallowedTools` — tool access control
- `systemPrompt` — custom system prompt
- `outputFormat` — structured output (JSON Schema)
- `agents` — `AgentDefinition[]` for subagent orchestration
- `resume` / `forkSession` — session continuity
- `mcpServers` — MCP server configurations

### Subagents

Claude supports parallel subagents via the `agents` option:

```ts
const agents = [
  {
    name: "worker",
    description: "Implement a single task",
    allowedTools: ["Read", "Write", "Edit", "Bash"],
  },
  {
    name: "reviewer",
    description: "Review code changes",
    allowedTools: ["Read", "Grep", "Glob"],
  },
];

const result = query({
  prompt: "Implement and review the feature",
  options: { agents },
});
```

### Session continuity

Resume or fork prior sessions:

```ts
// Resume a session
const result = query({ prompt: "Continue...", options: { resume: sessionId } });

// Fork a session (creates a new branch from the session's history)
const result = query({ prompt: "Try a different approach", options: { forkSession: sessionId } });
```

## Copilot SDK

Copilot uses a client-server architecture. `CopilotClient` manages the CLI server, and `CopilotSession` handles individual conversations.

### Basic usage

```ts
import { CopilotClient, approveAll } from "@github/copilot-sdk";

run: async (ctx) => {
  const client = new CopilotClient({ cliUrl: ctx.serverUrl });
  await client.start();

  const session = await client.createSession({
    onPermissionRequest: approveAll,
  });
  await client.setForegroundSessionId(session.sessionId);

  await session.sendAndWait({ prompt: ctx.userPrompt });

  ctx.save(await session.getMessages());

  await session.disconnect();
  await client.stop();
},
```

### Multi-turn conversations

Send multiple prompts to the same session:

```ts
run: async (ctx) => {
  const client = new CopilotClient({ cliUrl: ctx.serverUrl });
  await client.start();
  const session = await client.createSession({ onPermissionRequest: approveAll });
  await client.setForegroundSessionId(session.sessionId);

  // Turn 1
  await session.sendAndWait({ prompt: "Plan the implementation." });
  // Turn 2
  await session.sendAndWait({ prompt: "Now implement the plan." });
  // Turn 3
  await session.sendAndWait({ prompt: "Run the tests." });

  ctx.save(await session.getMessages());
  await session.disconnect();
  await client.stop();
},
```

### Session configuration

```ts
const session = await client.createSession({
  model: "claude-sonnet-4.6",
  reasoningEffort: "high",
  systemMessage: "You are a security auditor...",
  tools: [defineTool({ ... })],
  onPermissionRequest: approveAll,
  onUserInputRequest: (request) => { /* handle user input */ },
  hooks: {
    onPreToolUse: (event) => { /* before tool execution */ },
    onPostToolUse: (event) => { /* after tool execution */ },
  },
});
```

### Custom tools

```ts
import { defineTool } from "@github/copilot-sdk";

const myTool = defineTool({
  name: "check-coverage",
  description: "Check test coverage",
  parameters: { type: "object", properties: { path: { type: "string" } } },
  execute: async (params) => {
    // Run coverage check
    return { content: "Coverage: 85%" };
  },
});

const session = await client.createSession({
  tools: [myTool],
  onPermissionRequest: approveAll,
});
```

### Extracting response text

```ts
import type { SessionEvent } from "@github/copilot-sdk";

function getLastAssistantText(messages: SessionEvent[]): string {
  const assistantMessages = messages.filter(
    (m): m is Extract<SessionEvent, { type: "assistant.message" }> =>
      m.type === "assistant.message",
  );
  return assistantMessages.at(-1)?.data.content ?? "";
}
```

### Streaming events

```ts
session.on("assistant.message_delta", (event) => {
  process.stdout.write(event.data.content);
});

session.on("assistant.reasoning_delta", (event) => {
  // Access reasoning output
});
```

## OpenCode SDK

OpenCode uses a client-server model. `createOpencodeClient()` connects to a running server.

### Basic usage

```ts
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

run: async (ctx) => {
  const client = createOpencodeClient({ baseUrl: ctx.serverUrl });

  const session = await client.session.create({ title: "implement" });
  await client.tui.selectSession({ sessionID: session.data!.id });

  const result = await client.session.prompt({
    sessionID: session.data!.id,
    parts: [{ type: "text", text: ctx.userPrompt }],
  });

  ctx.save(result.data!);
},
```

### Multi-turn conversations

Send multiple prompts to the same session:

```ts
run: async (ctx) => {
  const client = createOpencodeClient({ baseUrl: ctx.serverUrl });
  const session = await client.session.create({ title: "multi-turn" });
  await client.tui.selectSession({ sessionID: session.data!.id });

  // Turn 1
  await client.session.prompt({
    sessionID: session.data!.id,
    parts: [{ type: "text", text: "Plan the implementation." }],
  });
  // Turn 2
  await client.session.prompt({
    sessionID: session.data!.id,
    parts: [{ type: "text", text: "Now implement the plan." }],
  });
  // Turn 3
  const result = await client.session.prompt({
    sessionID: session.data!.id,
    parts: [{ type: "text", text: "Run the tests." }],
  });

  ctx.save(result.data!);
},
```

### Structured output

```ts
const result = await client.session.prompt({
  sessionID: session.data!.id,
  parts: [{ type: "text", text: "List all API endpoints as JSON" }],
  format: {
    type: "json_schema",
    schema: {
      type: "object",
      properties: {
        endpoints: {
          type: "array",
          items: { type: "object", properties: { path: { type: "string" }, method: { type: "string" } } },
        },
      },
    },
    retryCount: 3,
  },
});
```

### Context injection (no-reply)

Inject context into a session without triggering a response:

```ts
await client.session.prompt({
  sessionID: session.data!.id,
  parts: [{ type: "text", text: "Here is the background context..." }],
  noReply: true,
});
// Now send the actual prompt
const result = await client.session.prompt({
  sessionID: session.data!.id,
  parts: [{ type: "text", text: "Based on the context, implement..." }],
});
```

### Extracting response text

```ts
function extractResponseText(
  parts: Array<{ type: string; [key: string]: unknown }>,
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: string; text: string }).text)
    .join("\n");
}

// Usage:
const text = extractResponseText(result.data!.parts);
```

### Event streaming

```ts
const unsubscribe = await client.event.subscribe((event) => {
  if (event.type === "session.updated") {
    console.log("Session updated:", event.data);
  }
});
```
