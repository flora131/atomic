# Workflow Authors: Getting Started

This guide covers the basics of creating workflows with the `defineWorkflow().run().compile()` API.

## Quick-start example

Use `defineWorkflow().run(callback).compile()` to define your workflow. Inside the `.run()` callback, use `ctx.session()` to spawn agent sessions dynamically. Each session gets its own tmux window and graph node. Use native TypeScript control flow (`for`, `if`, `Promise.all()`) for orchestration.

### Claude

```ts
// .atomic/workflows/my-workflow/claude/index.ts
import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic/workflows";

export default defineWorkflow({
    name: "my-workflow",
    description: "A two-session pipeline",
  })
  .run(async (ctx) => {
    const describe = await ctx.session(
      { name: "describe", description: "Ask Claude to describe the project" },
      async (s) => {
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({ paneId: s.paneId, prompt: ctx.userPrompt });
        s.save(s.sessionId);
      },
    );

    await ctx.session(
      { name: "summarize", description: "Summarize the previous session's output" },
      async (s) => {
        const research = await s.transcript(describe);
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({
          paneId: s.paneId,
          prompt: `Read ${research.path} and summarize it in 2-3 bullet points.`,
        });
        s.save(s.sessionId);
      },
    );
  })
  .compile();
```

### Copilot

Note the `SEND_TIMEOUT_MS` constant passed as the second argument to every
`sendAndWait` call. The Copilot SDK's default timeout is **60 seconds**, and
when it fires it throws — which aborts the current session. Always pass an
explicit, generous timeout. See the "Critical pitfall" section in
`agent-sessions.md` for the full explanation.

```ts
// .atomic/workflows/my-workflow/copilot/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";
import { CopilotClient, approveAll } from "@github/copilot-sdk";

// Explicit 30-minute timeout — required; see agent-sessions.md pitfall note.
const SEND_TIMEOUT_MS = 30 * 60 * 1000;

export default defineWorkflow({
    name: "my-workflow",
    description: "A two-session pipeline",
  })
  .run(async (ctx) => {
    const describe = await ctx.session(
      { name: "describe", description: "Ask the agent to describe the project" },
      async (s) => {
        const client = new CopilotClient({ cliUrl: s.serverUrl });
        await client.start();
        const session = await client.createSession({ onPermissionRequest: approveAll });
        await client.setForegroundSessionId(session.sessionId);
        await session.sendAndWait({ prompt: ctx.userPrompt }, SEND_TIMEOUT_MS);
        s.save(await session.getMessages());
        await session.disconnect();
        await client.stop();
      },
    );

    await ctx.session(
      { name: "summarize", description: "Summarize the previous session's output" },
      async (s) => {
        const research = await s.transcript(describe);
        const client = new CopilotClient({ cliUrl: s.serverUrl });
        await client.start();
        const session = await client.createSession({ onPermissionRequest: approveAll });
        await client.setForegroundSessionId(session.sessionId);
        await session.sendAndWait(
          {
            prompt: `Summarize the following in 2-3 bullet points:\n\n${research.content}`,
          },
          SEND_TIMEOUT_MS,
        );
        s.save(await session.getMessages());
        await session.disconnect();
        await client.stop();
      },
    );
  })
  .compile();
```

### OpenCode

```ts
// .atomic/workflows/my-workflow/opencode/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

export default defineWorkflow({
    name: "my-workflow",
    description: "A two-session pipeline",
  })
  .run(async (ctx) => {
    const describe = await ctx.session(
      { name: "describe", description: "Ask the agent to describe the project" },
      async (s) => {
        const client = createOpencodeClient({ baseUrl: s.serverUrl });
        const session = await client.session.create({ title: "describe" });
        await client.tui.selectSession({ sessionID: session.data!.id });
        const result = await client.session.prompt({
          sessionID: session.data!.id,
          parts: [{ type: "text", text: ctx.userPrompt }],
        });
        s.save(result.data!);
      },
    );

    await ctx.session(
      { name: "summarize", description: "Summarize the previous session's output" },
      async (s) => {
        const research = await s.transcript(describe);
        const client = createOpencodeClient({ baseUrl: s.serverUrl });
        const session = await client.session.create({ title: "summarize" });
        await client.tui.selectSession({ sessionID: session.data!.id });
        const result = await client.session.prompt({
          sessionID: session.data!.id,
          parts: [{ type: "text", text: `Summarize the following in 2-3 bullet points:\n\n${research.content}` }],
        });
        s.save(result.data!);
      },
    );
  })
  .compile();
```

Reading top-to-bottom: `describe → summarize`. Each session spawns a graph node and tmux window.

## Native TypeScript control flow

Sessions are spawned dynamically, so you can use loops, conditionals, and `Promise.all()`:

```ts
// Parallel sessions
const [a, b] = await Promise.all([
  ctx.session({ name: "task-a" }, async (s) => { /* ... */ }),
  ctx.session({ name: "task-b" }, async (s) => { /* ... */ }),
]);

// Loop with dynamic sessions
for (let i = 1; i <= maxIterations; i++) {
  const result = await ctx.session({ name: `step-${i}` }, async (s) => {
    // ... do work ...
    return someValue; // available as result.result
  });
  if (result.result === "done") break;
}

// Conditional sessions
if (needsReview) {
  await ctx.session({ name: "review" }, async (s) => { /* ... */ });
}
```

## SDK exports

The SDK (`@bastani/atomic/workflows`) exports everything you need for workflow authoring:

**Builder:**
- `defineWorkflow` — entry point, returns a chainable `WorkflowBuilder`
- `WorkflowBuilder` — the builder class (rarely needed directly)

**Types** (import with `import type`):
- `AgentType` — `"copilot" | "opencode" | "claude"`
- `Transcript` — `{ path: string, content: string }` from `ctx.transcript()`
- `SavedMessage` — union of provider-specific message types
- `SaveTranscript` — overloaded save function type
- `SessionContext` — the context object passed to `ctx.session()` callbacks
- `SessionHandle<T>` — returned by `ctx.session()`, carries `{ name, id, result }`
- `SessionRunOptions` — `{ name, description?, dependsOn? }` for `ctx.session()` first argument
- `SessionRef` — `string | SessionHandle<unknown>` for transcript/message lookups
- `WorkflowContext` — top-level context passed to `.run()` callback
- `WorkflowOptions` — `{ name, description? }` workflow metadata
- `WorkflowDefinition` — sealed output of `.compile()`

**Re-exported native SDK types** (for type annotations):
- `CopilotSessionEvent` — from `@github/copilot-sdk`
- `OpenCodePromptResponse` — from `@opencode-ai/sdk/v2`
- `ClaudeSessionMessage` — from `@anthropic-ai/claude-agent-sdk`

**Provider helpers:**
- `createClaudeSession` — start Claude TUI in a tmux pane; must be called before `claudeQuery()`
- `claudeQuery` — send a prompt to Claude TUI via tmux send-keys
- `clearClaudeSession` — remove a pane from the initialized set (cleanup)
- `validateClaudeWorkflow` — static validation for Claude workflow source files
- `validateCopilotWorkflow` — regex-based Copilot usage checks
- `validateOpenCodeWorkflow` — regex-based OpenCode usage checks

**Runtime utilities:**
- tmux helpers: `createSession`, `createWindow`, `createPane`, `sendKeysAndSubmit`, `capturePane`, etc.
- Discovery: `discoverWorkflows`, `findWorkflow`
- Loader: `WorkflowLoader.loadWorkflow`, `WorkflowLoader.resolve`, `WorkflowLoader.validate`, `WorkflowLoader.load`
- Executor: `executeWorkflow`

## `SessionContext` reference

| Field | Type | Description |
|-------|------|-------------|
| `serverUrl` | `string` | Agent's server URL (Copilot / OpenCode) |
| `userPrompt` | `string` | Original user prompt from CLI invocation |
| `agent` | `AgentType` | Which agent is running |
| `transcript(ref)` | `(ref: SessionRef) => Promise<Transcript>` | Get prior session's transcript as `{ path, content }` |
| `getMessages(ref)` | `(ref: SessionRef) => Promise<SavedMessage[]>` | Get prior session's raw native messages |
| `save` | `SaveTranscript` | Save this session's output for downstream sessions |
| `sessionDir` | `string` | Path to session storage directory |
| `paneId` | `string` | tmux pane ID |
| `sessionId` | `string` | Session UUID |
| `session(opts, fn)` | `<T>(...) => Promise<SessionHandle<T>>` | Spawn a nested sub-session (child of this session in the graph) |

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
