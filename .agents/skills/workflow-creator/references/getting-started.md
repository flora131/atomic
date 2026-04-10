# Workflow Authors: Getting Started

This guide covers the basics of creating workflows with the `defineWorkflow().run().compile()` API.

## Quick-start example

Use `defineWorkflow<"agent">().run(callback).compile()` to define your workflow. Inside the `.run()` callback, use `ctx.stage()` to spawn agent sessions dynamically. Each session gets its own tmux window and graph node. Use native TypeScript control flow (`for`, `if`, `Promise.all()`) for orchestration.

The runtime manages the full session lifecycle automatically — it creates the client, creates the session, runs your callback, then cleans up. You never need to manually disconnect or stop anything.

### Claude

```ts
// .atomic/workflows/my-workflow/claude/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
    name: "my-workflow",
    description: "A two-session pipeline",
  })
  .run(async (ctx) => {
    const describe = await ctx.stage(
      { name: "describe", description: "Ask Claude to describe the project" },
      {},
      {},
      async (s) => {
        await s.session.query(s.userPrompt);
        s.save(s.sessionId);
      },
    );

    await ctx.stage(
      { name: "summarize", description: "Summarize the previous session's output" },
      {},
      {},
      async (s) => {
        const research = await s.transcript(describe);
        await s.session.query(
          `Read ${research.path} and summarize it in 2-3 bullet points.`,
        );
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

// Explicit 30-minute timeout — required; see agent-sessions.md pitfall note.
const SEND_TIMEOUT_MS = 30 * 60 * 1000;

export default defineWorkflow<"copilot">({
    name: "my-workflow",
    description: "A two-session pipeline",
  })
  .run(async (ctx) => {
    const describe = await ctx.stage(
      { name: "describe", description: "Ask the agent to describe the project" },
      {},
      {},
      async (s) => {
        await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);
        s.save(await s.session.getMessages());
      },
    );

    await ctx.stage(
      { name: "summarize", description: "Summarize the previous session's output" },
      {},
      {},
      async (s) => {
        const research = await s.transcript(describe);
        await s.session.sendAndWait(
          {
            prompt: `Summarize the following in 2-3 bullet points:\n\n${research.content}`,
          },
          SEND_TIMEOUT_MS,
        );
        s.save(await s.session.getMessages());
      },
    );
  })
  .compile();
```

### OpenCode

```ts
// .atomic/workflows/my-workflow/opencode/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"opencode">({
    name: "my-workflow",
    description: "A two-session pipeline",
  })
  .run(async (ctx) => {
    const describe = await ctx.stage(
      { name: "describe", description: "Ask the agent to describe the project" },
      {},
      { title: "describe" },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: s.userPrompt }],
        });
        s.save(result.data!);
      },
    );

    await ctx.stage(
      { name: "summarize", description: "Summarize the previous session's output" },
      {},
      { title: "summarize" },
      async (s) => {
        const research = await s.transcript(describe);
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
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
  ctx.stage({ name: "task-a" }, {}, {}, async (s) => { /* ... */ }),
  ctx.stage({ name: "task-b" }, {}, {}, async (s) => { /* ... */ }),
]);

// Loop with dynamic sessions
for (let i = 1; i <= maxIterations; i++) {
  const result = await ctx.stage({ name: `step-${i}` }, {}, {}, async (s) => {
    // ... do work ...
    return someValue; // available as result.result
  });
  if (result.result === "done") break;
}

// Conditional sessions
if (needsReview) {
  await ctx.stage({ name: "review" }, {}, {}, async (s) => { /* ... */ });
}
```

## SDK exports

The SDK (`@bastani/atomic/workflows`) exports everything you need for workflow authoring:

**Builder:**
- `defineWorkflow` — entry point, accepts an optional type parameter (`"claude"`, `"copilot"`, `"opencode"`) for type narrowing; returns a chainable `WorkflowBuilder`
- `WorkflowBuilder` — the builder class (rarely needed directly)

**Types** (import with `import type`):
- `AgentType` — `"copilot" | "opencode" | "claude"`
- `Transcript` — `{ path: string, content: string }` from `ctx.transcript()`
- `SavedMessage` — union of provider-specific message types
- `SaveTranscript` — overloaded save function type
- `SessionContext` — the context object passed to `ctx.stage()` callbacks
- `SessionHandle<T>` — returned by `ctx.stage()`, carries `{ name, id, result }`
- `SessionRunOptions` — `{ name, description? }` for `ctx.stage()` first argument
- `StageClientOptions<A>` — provider-specific client init options for `ctx.stage()` second argument
- `StageSessionOptions<A>` — provider-specific session create options for `ctx.stage()` third argument
- `ProviderClient<A>` — the `s.client` type, resolved by agent type
- `ProviderSession<A>` — the `s.session` type, resolved by agent type
- `ClaudeClientWrapper` — synthetic client wrapper for Claude stages
- `ClaudeSessionWrapper` — synthetic session wrapper for Claude stages (exposes `s.session.query()`)
- `ClaudeQueryDefaults` — per-stage query defaults (timeouts, poll interval) for Claude sessions
- `SessionRef` — `string | SessionHandle<unknown>` for transcript/message lookups
- `WorkflowContext` — top-level context passed to `.run()` callback
- `WorkflowOptions` — `{ name, description? }` workflow metadata
- `WorkflowDefinition` — sealed output of `.compile()`

**Re-exported native SDK types** (for type annotations):
- `CopilotSessionEvent` — from `@github/copilot-sdk`
- `OpenCodePromptResponse` — from `@opencode-ai/sdk/v2`
- `ClaudeSessionMessage` — from `@anthropic-ai/claude-agent-sdk`

**Provider helpers:**
- `validateClaudeWorkflow` — static validation for Claude workflow source files; warns on direct `createClaudeSession` or `claudeQuery` usage
- `validateCopilotWorkflow` — static validation for Copilot workflow source files; warns on manual `new CopilotClient` or `client.createSession()` usage
- `validateOpenCodeWorkflow` — static validation for OpenCode workflow source files; warns on manual `createOpencodeClient()` or `client.session.create()` usage
- `createClaudeSession`, `claudeQuery`, `clearClaudeSession` — low-level tmux helpers; still exported for advanced use but not needed in typical workflows (use `s.session.query()` instead)

**Runtime utilities:**
- tmux helpers: `createSession`, `createWindow`, `createPane`, `sendKeysAndSubmit`, `capturePane`, etc.
- Discovery: `discoverWorkflows`, `findWorkflow`
- Loader: `WorkflowLoader.loadWorkflow`, `WorkflowLoader.resolve`, `WorkflowLoader.validate`, `WorkflowLoader.load`
- Executor: `executeWorkflow`

## `SessionContext` reference

| Field | Type | Description |
|-------|------|-------------|
| `client` | `ProviderClient<A>` | Pre-created SDK client (auto-managed by runtime) |
| `session` | `ProviderSession<A>` | Pre-created provider session (auto-managed by runtime) |
| `userPrompt` | `string` | Original user prompt from CLI invocation |
| `agent` | `AgentType` | Which agent is running |
| `transcript(ref)` | `(ref: SessionRef) => Promise<Transcript>` | Get prior session's transcript as `{ path, content }` |
| `getMessages(ref)` | `(ref: SessionRef) => Promise<SavedMessage[]>` | Get prior session's raw native messages |
| `save` | `SaveTranscript` | Save this session's output for downstream sessions |
| `sessionDir` | `string` | Path to session storage directory |
| `paneId` | `string` | tmux pane ID |
| `sessionId` | `string` | Session UUID |
| `stage(opts, clientOpts, sessionOpts, fn)` | `<T>(...) => Promise<SessionHandle<T>>` | Spawn a nested sub-session (child of this session in the graph) |

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

The SDK is typed with **no `unknown` or `any`**. `SessionContext` fields are precisely typed, and native SDK types are re-exported for convenience. Use `import type` for type-only imports. Use the `defineWorkflow<"agent">()` type parameter to narrow `s.client` and `s.session` to the correct provider types.
