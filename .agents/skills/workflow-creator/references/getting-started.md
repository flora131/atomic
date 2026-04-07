# Workflow Authors: Getting Started

This guide covers the basics of creating workflows with the `defineWorkflow()` session-based API.

## Quick-start example

Use the chainable builder to declare your workflow's metadata and sessions. Each session's `run()` callback contains raw SDK code for your target agent.

### Claude

```ts
// .atomic/workflows/claude/my-workflow/index.ts
import { defineWorkflow, claudeQuery } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "my-workflow",
    description: "A two-session pipeline",
  })
  .session({
    name: "describe",
    description: "Ask Claude to describe the project",
    run: async (ctx) => {
      await claudeQuery({ paneId: ctx.paneId, prompt: ctx.userPrompt });
      ctx.save(ctx.sessionId);
    },
  })
  .session({
    name: "summarize",
    description: "Summarize the previous session's output",
    run: async (ctx) => {
      const research = await ctx.transcript("describe");
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: `Read ${research.path} and summarize it in 2-3 bullet points.`,
      });
      ctx.save(ctx.sessionId);
    },
  })
  .compile();
```

### Copilot

```ts
// .atomic/workflows/copilot/my-workflow/index.ts
import { defineWorkflow } from "@bastani/atomic-workflows";
import { CopilotClient, approveAll } from "@github/copilot-sdk";

export default defineWorkflow({
    name: "my-workflow",
    description: "A two-session pipeline",
  })
  .session({
    name: "describe",
    description: "Ask the agent to describe the project",
    run: async (ctx) => {
      const client = new CopilotClient({ cliUrl: ctx.serverUrl });
      await client.start();
      const session = await client.createSession({ onPermissionRequest: approveAll });
      await client.setForegroundSessionId(session.sessionId);
      await session.sendAndWait({ prompt: ctx.userPrompt });
      ctx.save(await session.getMessages());
      await session.disconnect();
      await client.stop();
    },
  })
  .session({
    name: "summarize",
    description: "Summarize the previous session's output",
    run: async (ctx) => {
      const research = await ctx.transcript("describe");
      const client = new CopilotClient({ cliUrl: ctx.serverUrl });
      await client.start();
      const session = await client.createSession({ onPermissionRequest: approveAll });
      await client.setForegroundSessionId(session.sessionId);
      await session.sendAndWait({
        prompt: `Summarize the following in 2-3 bullet points:\n\n${research.content}`,
      });
      ctx.save(await session.getMessages());
      await session.disconnect();
      await client.stop();
    },
  })
  .compile();
```

### OpenCode

```ts
// .atomic/workflows/opencode/my-workflow/index.ts
import { defineWorkflow } from "@bastani/atomic-workflows";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

export default defineWorkflow({
    name: "my-workflow",
    description: "A two-session pipeline",
  })
  .session({
    name: "describe",
    description: "Ask the agent to describe the project",
    run: async (ctx) => {
      const client = createOpencodeClient({ baseUrl: ctx.serverUrl });
      const session = await client.session.create({ title: "describe" });
      await client.tui.selectSession({ sessionID: session.data!.id });
      const result = await client.session.prompt({
        sessionID: session.data!.id,
        parts: [{ type: "text", text: ctx.userPrompt }],
      });
      ctx.save(result.data!);
    },
  })
  .session({
    name: "summarize",
    description: "Summarize the previous session's output",
    run: async (ctx) => {
      const research = await ctx.transcript("describe");
      const client = createOpencodeClient({ baseUrl: ctx.serverUrl });
      const session = await client.session.create({ title: "summarize" });
      await client.tui.selectSession({ sessionID: session.data!.id });
      const result = await client.session.prompt({
        sessionID: session.data!.id,
        parts: [{ type: "text", text: `Summarize the following in 2-3 bullet points:\n\n${research.content}` }],
      });
      ctx.save(result.data!);
    },
  })
  .compile();
```

Reading top-to-bottom: `describe → summarize`. Each session runs raw SDK code.

## SDK exports

The SDK (`@bastani/atomic-workflows`) exports everything you need for workflow authoring:

**Builder:**
- `defineWorkflow` — entry point, returns a chainable `WorkflowBuilder`
- `WorkflowBuilder` — the builder class (rarely needed directly)

**Types** (import with `import type`):
- `AgentType` — `"copilot" | "opencode" | "claude"`
- `Transcript` — `{ path: string, content: string }` from `ctx.transcript()`
- `SavedMessage` — union of provider-specific message types
- `SaveTranscript` — overloaded save function type
- `SessionContext` — the context object passed to `run()`
- `SessionOptions` — `{ name, description?, run }` session definition
- `WorkflowOptions` — `{ name, description? }` workflow metadata
- `WorkflowDefinition` — sealed output of `.compile()`

**Re-exported native SDK types** (for type annotations):
- `CopilotSessionEvent` — from `@github/copilot-sdk`
- `OpenCodePromptResponse` — from `@opencode-ai/sdk/v2`
- `ClaudeSessionMessage` — from `@anthropic-ai/claude-agent-sdk`

**Provider helpers:**
- `claudeQuery` — automates Claude TUI via tmux send-keys
- `validateCopilotWorkflow` — regex-based Copilot usage checks
- `validateOpenCodeWorkflow` — regex-based OpenCode usage checks

**Runtime utilities:**
- tmux helpers: `createSession`, `createWindow`, `createPane`, `sendKeysAndSubmit`, `capturePane`, etc.
- Discovery: `discoverWorkflows`, `findWorkflow`, `loadWorkflowDefinition`
- Executor: `executeWorkflow`

## `SessionContext` reference

| Field | Type | Description |
|-------|------|-------------|
| `serverUrl` | `string` | Agent's server URL (Copilot / OpenCode) |
| `userPrompt` | `string` | Original user prompt from CLI invocation |
| `agent` | `AgentType` | Which agent is running |
| `transcript(name)` | `(name: string) => Promise<Transcript>` | Get prior session's transcript as `{ path, content }` |
| `getMessages(name)` | `(name: string) => Promise<SavedMessage[]>` | Get prior session's raw native messages |
| `save` | `SaveTranscript` | Save this session's output for downstream sessions |
| `sessionDir` | `string` | Path to session storage directory |
| `paneId` | `string` | tmux pane ID |
| `sessionId` | `string` | Session UUID |

## Reference files

| File | Topic |
|---|---|
| `agent-sessions.md` | Creating agent sessions with SDK calls per provider |
| `computation-and-validation.md` | Deterministic computation, parsing, validation inside `run()` |
| `user-input.md` | Collecting user input with per-SDK APIs |
| `control-flow.md` | Loops, conditionals, early termination in plain TypeScript |
| `state-and-data-flow.md` | Data flow between sessions, transcripts, persistence |
| `session-config.md` | Per-SDK session configuration: model, tools, permissions, hooks |
| `discovery-and-verification.md` | Workflow file discovery, validation, TypeScript config |

## Type safety

The SDK is typed with **no `unknown` or `any`**. `SessionContext` fields are precisely typed, and native SDK types are re-exported for convenience. Use `import type` for type-only imports.
