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
    // Free-form workflow: the positional CLI prompt lands under
    // `inputs.prompt`. Destructure once and close over it in stages.
    const prompt = ctx.inputs.prompt ?? "";

    const describe = await ctx.stage(
      { name: "describe", description: "Ask Claude to describe the project" },
      {},
      {},
      async (s) => {
        await s.session.query(prompt);
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

```ts
// .atomic/workflows/my-workflow/copilot/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"copilot">({
    name: "my-workflow",
    description: "A two-session pipeline",
  })
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";

    const describe = await ctx.stage(
      { name: "describe", description: "Ask the agent to describe the project" },
      {},
      {},
      async (s) => {
        await s.session.send({ prompt });
        s.save(await s.session.getMessages());
      },
    );

    await ctx.stage(
      { name: "summarize", description: "Summarize the previous session's output" },
      {},
      {},
      async (s) => {
        const research = await s.transcript(describe);
        await s.session.send({
          prompt: `Summarize the following in 2-3 bullet points:\n\n${research.content}`,
        });
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
    const prompt = ctx.inputs.prompt ?? "";

    const describe = await ctx.stage(
      { name: "describe", description: "Ask the agent to describe the project" },
      {},
      { title: "describe" },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: prompt }],
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

The `@bastani/atomic/workflows` package exports the workflow authoring primitives. For native SDK types and utilities, install and import from the provider packages directly.

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
- `ClaudeSessionWrapper` — Atomic wrapper for Claude sessions (exposes `s.session.query()`)
- `ClaudeQueryDefaults` — per-stage query defaults (timeouts, poll interval) for Claude sessions
- `SessionRef` — `string | SessionHandle<unknown>` for transcript/message lookups
- `WorkflowContext` — top-level context passed to `.run()` callback
- `WorkflowOptions` — `{ name, description? }` workflow metadata
- `WorkflowDefinition` — sealed output of `.compile()`

**Validation helpers:**
- `validateClaudeWorkflow` — static validation for Claude workflow source files; warns on direct `createClaudeSession` or `claudeQuery` usage
- `validateCopilotWorkflow` — static validation for Copilot workflow source files; warns on manual `new CopilotClient` or `client.createSession()` usage
- `validateOpenCodeWorkflow` — static validation for OpenCode workflow source files; warns on manual `createOpencodeClient()` or `client.session.create()` usage

**Native SDK dependencies:**

The Atomic runtime provides `s.client` and `s.session` with types resolved from the native SDKs. If you need to name those types in your own code, or use SDK utilities and advanced APIs, import them directly from the provider packages:

| Provider | Package | Key imports |
|----------|---------|-------------|
| Copilot | `@github/copilot-sdk` | `SessionEvent`, `CopilotClient`, `CopilotSession`, `approveAll`, `defineTool` |
| Claude | `@anthropic-ai/claude-agent-sdk` | `SessionMessage`, `query` |
| OpenCode | `@opencode-ai/sdk/v2` | `SessionPromptResponse`, `OpencodeClient`, `Session` |

## `SessionContext` reference

| Field | Type | Description |
|-------|------|-------------|
| `client` | `ProviderClient<A>` | Pre-created SDK client (auto-managed by runtime) |
| `session` | `ProviderSession<A>` | Pre-created provider session (auto-managed by runtime) |
| `inputs` | `Record<string, string>` | Structured inputs for this run. Free-form workflows read `s.inputs.prompt`; structured workflows read their declared field names. See `workflow-inputs.md`. |
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
| `workflow-inputs.md` | Declaring the `inputs: WorkflowInput[]` schema, the free-form vs structured decision, CLI flag + picker invocation surfaces, builtin protection |
| `agent-sessions.md` | Creating agent sessions with SDK calls per provider |
| `computation-and-validation.md` | Deterministic computation, parsing, validation inside `run()` |
| `user-input.md` | Collecting user input **mid-workflow** (for invocation-time inputs, see `workflow-inputs.md`) |
| `control-flow.md` | Loops, conditionals, early termination in plain TypeScript |
| `state-and-data-flow.md` | Data flow between sessions, transcripts, persistence |
| `session-config.md` | Per-SDK session configuration: model, tools, permissions, hooks |
| `discovery-and-verification.md` | Workflow file discovery, validation, TypeScript config |

## Builtin reference implementations

The SDK ships two builtin workflows that demonstrate production patterns for all three SDKs:

- **`ralph`** (`src/sdk/workflows/builtin/ralph/`) — iterative plan → orchestrate → review → debug loop with consecutive clean-pass detection, shared helpers for prompts/parsing/git, and cross-SDK adaptation
- **`deep-research-codebase`** (`src/sdk/workflows/builtin/deep-research-codebase/`) — deterministic codebase scout → LOC-based heuristic explorer partitioning → parallel explorers → aggregator with file-based handoffs and context-aware prompt engineering

Both include `helpers/` directories with SDK-agnostic logic (prompt builders, parsers, heuristics) and per-agent `index.ts` files showing how the same workflow topology adapts to Claude, Copilot, and OpenCode.

## Type safety

The SDK is typed with **no `unknown` or `any`**. `SessionContext` fields are precisely typed, and native provider types may appear inside Atomic generic aliases and runtime values — if you need to name those types in your own code, import them from the provider SDK directly. Use `import type` for type-only imports. Use the `defineWorkflow<"agent">()` type parameter to narrow `s.client` and `s.session` to the correct provider types.
