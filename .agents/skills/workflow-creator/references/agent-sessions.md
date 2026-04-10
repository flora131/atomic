# Agent Sessions

Each `ctx.stage()` call inside a workflow's `.run()` callback creates an isolated agent session. The runtime auto-initializes the provider client and session before invoking your callback — the callback receives `s` (a `SessionContext`) with `s.client` (the pre-created SDK client) and `s.session` (the pre-created session) ready to use. Auto-cleanup (disconnect, stop) is handled by the runtime after the callback completes. This is the programmatic equivalent of defining agent stages — you have full access to every SDK feature through `s.client` and `s.session`.

`ctx.stage()` takes four arguments: `ctx.stage(stageOpts, clientOpts, sessionOpts, callback)`.

## Claude Agent SDK

Claude runs as a full interactive TUI in a tmux pane. The runtime auto-starts the Claude CLI (via `s.client`) and creates a session wrapper (`s.session`) before the callback runs. Pass CLI flags via `clientOpts` (2nd arg) and query defaults via `sessionOpts` (3rd arg).

### Session lifecycle

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

// ...
.run(async (ctx) => {
  await ctx.stage(
    { name: "implement", description: "Implement the feature" },
    {}, // clientOpts: chatFlags and readyTimeoutMs go here
    {}, // sessionOpts: query defaults (timeoutMs, pollIntervalMs, etc.) go here
    async (s) => {
      // s.client — ClaudeClientWrapper (Claude CLI already started by runtime)
      // s.session — ClaudeSessionWrapper (ready to accept queries)

      // Send queries — Claude maintains conversation context across calls
      const result = await s.session.query(s.userPrompt);
      // result.output contains the captured response text

      // Save transcript
      s.save(s.sessionId);
    },
  );
})
```

The runtime handles:
1. Starting the Claude CLI in the tmux pane (equivalent to the old `createClaudeSession()`)
2. Creating a `ClaudeSessionWrapper` bound to the pane
3. Auto-cleanup via `clearClaudeSession` after the callback

Client options (2nd arg to `ctx.stage()`):
- `chatFlags` — CLI flags (default: `["--allow-dangerously-skip-permissions", "--dangerously-skip-permissions"]`)
- `readyTimeoutMs` — timeout waiting for TUI readiness (default: 30s)

Session options (3rd arg to `ctx.stage()`), applied as defaults to every `s.session.query()` call:
- `timeoutMs` — timeout waiting for Claude to finish responding (default: 300s)
- `pollIntervalMs` — polling interval (default: 2000ms)
- `submitPresses` — C-m presses per submit round (default: 1)
- `maxSubmitRounds` — max submit rounds (default: 6)
- `readyTimeoutMs` — timeout waiting for pane readiness before sending (default: 30s)

### Basic usage with `s.session.query()`

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({ name: "implement" })
  .run(async (ctx) => {
    await ctx.stage(
      { name: "implement", description: "Implement the feature" },
      {},
      {},
      async (s) => {
        const result = await s.session.query(s.userPrompt);
        // result.output contains the captured response text
        s.save(s.sessionId);
      },
    );
  })
  .compile();
```

`s.session.query(prompt)` sends text to the Claude pane, verifies delivery, retries if needed, and waits for output stabilization. Returns `{ output: string }`.

### Multi-turn conversations

Claude maintains conversation context across calls within the same pane. Call `s.session.query()` multiple times in one stage for multi-turn conversations:

```ts
.run(async (ctx) => {
  await ctx.stage({ name: "implement" }, {}, {}, async (s) => {
    // Turn 1: Plan
    await s.session.query("Plan the implementation.");
    // Turn 2: Execute (Claude remembers the plan)
    await s.session.query("Now implement the plan.");
    // Turn 3: Verify
    await s.session.query("Run the tests.");
    s.save(s.sessionId);
  });
})
```

### Advanced: Claude Agent SDK `query()` API

For programmatic control beyond tmux automation, the Claude Agent SDK provides `query()`:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

.run(async (ctx) => {
  await ctx.stage({ name: "implement" }, {}, {}, async (s) => {
    const result = query({
      prompt: s.userPrompt,
      options: {
        model: "claude-opus-4-6",
        effort: "high",
        maxTurns: 50,
        maxBudgetUsd: 5.0,
        permissionMode: "acceptEdits",
        allowedTools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
        disallowedTools: ["AskUserQuestion"],
        systemPrompt: "You are a senior engineer...",
        outputFormat: {
          type: "json_schema",
          schema: { type: "object", properties: { tasks: { type: "array", items: { type: "string" } } } },
        },
        agents: {
          reviewer: { description: "Review code changes", prompt: "You are a code reviewer..." },
        },
      },
    });
    for await (const message of result) {
      // Process streaming messages
    }
  });
})
```

Key `query()` options:
- `model` — model ID (`"claude-opus-4-6"`, `"claude-sonnet-4-6"`) or alias (`"opus"`, `"sonnet"`, `"haiku"`)
- `effort` — reasoning effort (`"low"`, `"medium"`, `"high"`, `"max"` — `"max"` is Opus 4.6 only)
- `thinking` — thinking/reasoning config: `{ type: "adaptive" }` (default for supported models), `{ type: "enabled", budgetTokens: N }`, or `{ type: "disabled" }`
- `maxTurns` — maximum conversation turns
- `maxBudgetUsd` — spending cap in USD
- `permissionMode` — `"default"`, `"dontAsk"`, `"acceptEdits"`, `"bypassPermissions"`, `"plan"`
- `allowedTools` / `disallowedTools` — tool access control
- `tools` — base set of available built-in tools: `string[]` for specific tools, `[]` to disable all, or `{ type: "preset", preset: "claude_code" }` for defaults
- `systemPrompt` — custom system prompt (`string`) or preset with additions (`{ type: "preset", preset: "claude_code", append: "..." }`)
- `outputFormat` — structured output: `{ type: "json_schema", schema: { ... } }`
- `agents` — `Record<string, AgentDefinition>` — named subagents for orchestration
- `agent` — main thread agent name (must be defined in `agents` or settings)
- `resume` — session ID to resume a prior session
- `forkSession` — `boolean` — when `true` with `resume`, forks to a new session instead of continuing
- `mcpServers` — MCP server configurations
- `hooks` — `Partial<Record<HookEvent, HookCallbackMatcher[]>>` — event-driven callbacks (see `session-config.md`)
- `sandbox` — sandboxed command execution settings
- `betas` — enable beta features (e.g. `["context-1m-2025-08-07"]` for 1M context on Sonnet)

### Subagents

Claude supports parallel subagents via the `agents` option (a `Record<string, AgentDefinition>` keyed by agent name):

```ts
const agents = {
  worker: {
    description: "Implement a single task",
    prompt: "You are a task implementer...",
    tools: ["Read", "Write", "Edit", "Bash"],
  },
  reviewer: {
    description: "Review code changes",
    prompt: "You are a code reviewer...",
    tools: ["Read", "Grep", "Glob"],
  },
};

const result = query({
  prompt: "Implement and review the feature",
  options: { agents },
});
```

### Session continuity

Resume or fork prior sessions:

```ts
// Resume a session (continues the same conversation)
const result = query({ prompt: "Continue...", options: { resume: sessionId } });

// Fork a session (creates a new branch from the session's history)
const result = query({ prompt: "Try a different approach", options: { resume: sessionId, forkSession: true } });
```

### Sub-agent delegation via `s.session.query()`

Invoke named sub-agents by prefixing the prompt with `@"agent-name (agent)"`. The agent must be defined in `.claude/agents/`:

```ts
.run(async (ctx) => {
  await ctx.stage({ name: "plan-and-implement" }, {}, {}, async (s) => {
    // Delegate to the "planner" agent
    await s.session.query(`@"planner (agent)" Create a plan for: ${s.userPrompt}`);

    // Delegate to the "orchestrator" agent
    await s.session.query(`@"orchestrator (agent)" Execute the plan above.`);

    s.save(s.sessionId);
  });
})
```

## Copilot SDK

Copilot uses a client-server architecture. The runtime auto-creates a `CopilotClient` (as `s.client`) and a `CopilotSession` (as `s.session`) before invoking your callback. Auto-cleanup (`session.disconnect()` and `client.stop()`) is handled by the runtime after the callback completes.

### Basic usage

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

// Always pass an explicit timeout to sendAndWait — see the pitfall note below.
const SEND_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export default defineWorkflow<"copilot">({ name: "implement" })
  .run(async (ctx) => {
    await ctx.stage(
      { name: "implement" },
      {}, // clientOpts: CopilotClientOptions (excluding cliUrl, which is auto-injected)
      {}, // sessionOpts: CopilotSessionConfig (model, agent, tools, hooks, etc.)
      async (s) => {
        // s.client — CopilotClient (already started by runtime)
        // s.session — CopilotSession (already created, foreground session set)

        await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);

        s.save(await s.session.getMessages());
      },
    );
  })
  .compile();
```

### Critical pitfall: `sendAndWait` has a 60-second default timeout

`session.sendAndWait(options, timeout?)` accepts an optional second `timeout`
parameter that **defaults to 60000 ms**. When the timeout elapses it **throws**
`Timeout after 60000ms waiting for session.idle` — it does NOT abort the
in-flight agent, and it does NOT silently return. The throw propagates out of
the session callback, so:

1. The current stage fails.
2. Every subsequent session step never executes (e.g. a `planner → orchestrator → reviewer` pipeline stops dead after the planner).
3. The agent may still be churning in the background.

This is deadly for real work — planner, reviewer, and orchestrator sub-agents
routinely need more than 60 seconds of wall-clock time. Source:
`@github/copilot-sdk/dist/session.js` — the `sendAndWait` implementation races
the idle promise against `setTimeout(..., timeout ?? 6e4)`.

**Always pass an explicit, generous timeout** when calling `sendAndWait` inside
a workflow. Define it as a named constant so it's obvious and tunable:

```ts
// Buggy — silently inherits the 60s default and crashes long stages
await session.sendAndWait({ prompt });

// Correct — explicit 30-minute budget
const SEND_TIMEOUT_MS = 30 * 60 * 1000;
await session.sendAndWait({ prompt }, SEND_TIMEOUT_MS);
```

Pick a timeout that fits the expected work:

| Session type | Suggested timeout |
|---|---|
| Short, bounded prompts (summaries, classification) | 5-10 minutes |
| Sub-agents doing file-wide analysis (planner, reviewer) | 30 minutes |
| Long implementation or multi-file refactors | 60 minutes |

The timeout controls how long the SDK waits for `session.idle`; it does not
cap the agent itself. Err on the generous side — a truly hung session will
still surface as a clear error message rather than silently breaking
downstream stages.

### Critical pitfall: session lifecycle controls what context is available

A workflow is not just a sequence of agent calls — it is an **information
flow problem**. The single most common failure mode in Copilot workflows is
assuming context carries across session boundaries when it doesn't.
Designing a workflow without thinking about information flow produces
sub-agents that hallucinate, repeat work, or drop requirements silently.

**Treat this section as load-bearing**, not decorative. If you skip it, your
workflow will ship broken in subtle, non-deterministic ways.

#### The three session lifecycle states

Every Copilot session is always in exactly one of these states, and the
state determines what context the model sees on its next turn:

| State | How you get there | Context available | Action needed |
|---|---|---|---|
| **Fresh** | `client.createSession(...)` | **None** — empty conversation | You MUST inject everything the agent needs in the first prompt |
| **Continued** | Same session, additional `sendAndWait` calls | All prior turns in this session | Nothing — but watch total token usage |
| **Resumed** | `client.resumeSession(sessionId)` | All persisted turns from the prior session of the SAME agent | Nothing — full history is reattached |
| **Closed** | `session.disconnect()` or `client.stop()` | **Gone** from the live client; persisted on disk if the host enables it | Either resume by ID (same agent) or start fresh and re-inject context |

The failure mode: you close a session, create a new one, and assume the new
one "remembers" the previous conversation. It doesn't. `client` is just the
transport — each session is a fully independent conversation.

```ts
// Buggy — the orchestrator session is fresh and knows NOTHING about
// what the planner just produced, because createSession() started a
// brand-new conversation.
await runAgent("planner", buildPlannerPrompt(ctx.userPrompt));
await runAgent("orchestrator", buildOrchestratorPrompt());
// ↑ orchestrator only sees buildOrchestratorPrompt() — no planner output,
//   no original user spec, no context.
```

#### Three valid ways to carry context across a session boundary

Pick the one that fits the data you need to hand off. These are not
mutually exclusive — ralph uses (1) + (2) together as belt-and-braces.

**1. Explicit prompt handoff** — capture the prior session's last assistant
message and inject it (or a summary) into the next session's first prompt.
Simplest and most common fix:

```ts
async function runAgent(agent: string, prompt: string): Promise<string> {
  const session = await client.createSession({ agent, onPermissionRequest: approveAll });
  await session.sendAndWait({ prompt }, SEND_TIMEOUT_MS);
  const messages = await session.getMessages();
  await session.disconnect();
  return getAssistantText(messages); // concatenate every top-level turn — see failure-modes.md §F1
}

// Correct — forward the planner's output into the orchestrator prompt
const plannerNotes = await runAgent("planner", buildPlannerPrompt(ctx.userPrompt));
await runAgent(
  "orchestrator",
  buildOrchestratorPrompt(ctx.userPrompt, { plannerNotes }),
);
```

**2. External shared state** — write results to a medium both sessions can
read: the task list (`TaskCreate` / `TaskList`), files on disk, a git
working tree, or a database. The planner writes; the orchestrator reads.
Ralph uses `TaskCreate`/`TaskList` as its primary coordination medium.

**3. Resume the same session** — if the next step uses the **same agent**,
`client.resumeSession(sessionId)` reattaches and continues the same
conversation with full history intact. Resume is **not** a way to swap
agents: each session is bound to one agent at creation time, so this only
helps for multi-turn work within the same role.

```ts
// Same agent, multi-turn — resume keeps full history
const resumed = await client.resumeSession(savedSessionId);
await resumed.sendAndWait({ prompt: "Follow up on that." }, SEND_TIMEOUT_MS);
```

#### When context grows too large: compaction and clearing

Even within a single continued session, context can grow past the window.
Symptoms include lost-in-middle failures, repeated questions, and the model
"forgetting" earlier decisions. When that happens, you have two levers:

- **Compaction** — summarize the prior transcript into a shorter form and
  feed it forward (either into a new session, or by starting a follow-up
  session seeded with the summary). Most SDKs expose this as a built-in
  command (Claude Code's `/compact` slash command, or programmatic helpers
  in the OpenCode SDK). If the SDK you're using doesn't, roll your own with
  a summarization call and start a fresh session with the summary in the
  first prompt.
- **Clearing** — drop old turns entirely when they're no longer load-bearing
  (e.g. one-shot tool outputs whose results were already captured to files).
  Claude's `/clear`, per-SDK `clearHistory`-style APIs, or simply starting a
  new session with only the essentials in prompt 1 all work.

Neither is free: compaction loses detail, clearing loses provenance. The
`context-compression` and `context-optimization` skills below cover the
trade-offs in depth.

#### Context engineering skills — consult these BEFORE writing code

Information flow is a design problem, not an implementation detail. Before
committing to a session layout, pull in the relevant skills:

| When you're deciding... | Consult |
|---|---|
| What context each session actually needs (anatomy + token budget) | `context-fundamentals` |
| How many sessions and how they hand off (orchestrator vs peers vs swarm) | `multi-agent-patterns` |
| How to compress large planner/reviewer output before re-injecting | `context-compression` |
| How to detect and prevent lost-in-middle, poisoning, and distraction | `context-degradation` |
| How to use files as coordination medium across sessions | `filesystem-context` |
| How to persist knowledge across whole workflow runs | `memory-systems` |
| Which turns to drop, which to cache, when to compact | `context-optimization` |

These aren't optional reading — they're the difference between a workflow
that works on day one and a workflow that silently degrades as inputs grow.
If you're about to write a multi-session workflow and you haven't consulted
at least `context-fundamentals` and `multi-agent-patterns`, **stop and read
them first.**

### Multi-turn conversations

Send multiple prompts to the same session. Remember: every `sendAndWait` call
needs its own explicit timeout.

```ts
const SEND_TIMEOUT_MS = 30 * 60 * 1000;

.run(async (ctx) => {
  await ctx.stage({ name: "implement" }, {}, {}, async (s) => {
    // Turn 1
    await s.session.sendAndWait({ prompt: "Plan the implementation." }, SEND_TIMEOUT_MS);
    // Turn 2
    await s.session.sendAndWait({ prompt: "Now implement the plan." }, SEND_TIMEOUT_MS);
    // Turn 3
    await s.session.sendAndWait({ prompt: "Run the tests." }, SEND_TIMEOUT_MS);

    s.save(await s.session.getMessages());
  });
})
```

### Session configuration

Pass session config options as the 3rd arg to `ctx.stage()` (`sessionOpts`). These are forwarded to `client.createSession()`:

```ts
await ctx.stage(
  { name: "audit" },
  {}, // clientOpts
  {
    model: "claude-sonnet-4.6",
    reasoningEffort: "high",
    systemMessage: "You are a security auditor...",
    onUserInputRequest: (request) => { /* handle user input */ },
    hooks: {
      onPreToolUse: (event) => { /* before tool execution */ },
      onPostToolUse: (event) => { /* after tool execution */ },
    },
  }, // sessionOpts
  async (s) => {
    await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);
    s.save(await s.session.getMessages());
  },
);
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

// Pass tools via sessionOpts (3rd arg to ctx.stage())
await ctx.stage(
  { name: "implement" },
  {},
  { tools: [myTool] },
  async (s) => {
    await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);
    s.save(await s.session.getMessages());
  },
);
```

### Extracting response text

Do **not** just grab `.at(-1).data.content` — a Copilot turn's final
`assistant.message` often has empty `content` (tool-calls-only) and
sub-agent messages can pollute the stream via `parentToolCallId`. Concatenate
every top-level turn's non-empty content instead. See
`references/failure-modes.md` §"Copilot: `getLastAssistantText` returns
empty string" for the full explanation and wrong-vs-right examples.

```ts
import type { SessionEvent } from "@github/copilot-sdk";

/** Concatenate every top-level assistant turn's non-empty content. */
function getAssistantText(messages: SessionEvent[]): string {
  return messages
    .filter(
      (m): m is Extract<SessionEvent, { type: "assistant.message" }> =>
        m.type === "assistant.message" && !m.data.parentToolCallId,
    )
    .map((m) => m.data.content)
    .filter((c) => c.length > 0)
    .join("\n\n");
}
```

### Streaming events

```ts
// s.session is the CopilotSession — subscribe to events directly
s.session.on("assistant.message_delta", (event) => {
  process.stdout.write(event.data.content);
});

s.session.on("assistant.reasoning_delta", (event) => {
  // Access reasoning output
});
```

### Sub-agent delegation

Pass the `agent` parameter in `sessionOpts` (3rd arg to `ctx.stage()`) to bind the session to a named sub-agent:

```ts
const SEND_TIMEOUT_MS = 30 * 60 * 1000; // planner can take a while

.run(async (ctx) => {
  await ctx.stage(
    { name: "plan" },
    {},
    { agent: "planner" }, // sessionOpts — binds the session to the "planner" agent
    async (s) => {
      await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);
      s.save(await s.session.getMessages());
    },
  );
})
```

## OpenCode SDK

OpenCode uses a client-server model. The runtime auto-creates an `OpencodeClient` (as `s.client`) and an OpenCode session (as `s.session`) before invoking your callback. Use `s.client.session.prompt({ sessionID: s.session.id, ... })` to send prompts.

### Basic usage

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"opencode">({ name: "implement" })
  .run(async (ctx) => {
    await ctx.stage(
      { name: "implement" },
      {}, // clientOpts: directory, experimental_workspaceID
      { title: "implement" }, // sessionOpts: title, parentID, workspaceID
      async (s) => {
        // s.client — OpencodeClient (already connected)
        // s.session — OpenCode Session (already created, TUI selected)

        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: s.userPrompt }],
        });

        s.save(result.data!);
      },
    );
  })
  .compile();
```

### Critical pitfall: session lifecycle controls what context is available

OpenCode sessions have **exactly the same isolation semantics as Copilot
sessions**. Every call to `client.session.create(...)` returns a fresh,
empty conversation. Creating a new session for the next sub-agent wipes
everything the prior session knew — conversation history, tool-call
results, intermediate reasoning — unless you forward it explicitly.

The full explanation, the three lifecycle states (Fresh / Continued /
Resumed / Closed), the three valid ways to carry context across a session
boundary, compaction & clearing guidance, and the context engineering
skill-map live in the **Copilot** section above under
["Critical pitfall: session lifecycle controls what context is
available"](#critical-pitfall-session-lifecycle-controls-what-context-is-available).
Every principle there applies to OpenCode without modification — just
substitute the OpenCode API equivalents:

| Concept | Copilot API | OpenCode API |
|---|---|---|
| Fresh session (auto-created) | `s.session` (runtime creates via `createSession`) | `s.session` (runtime creates via `session.create`) |
| Send a turn | `s.session.sendAndWait({ prompt }, timeout)` | `s.client.session.prompt({ sessionID: s.session.id, parts })` |
| Close / disconnect | Auto-handled by runtime | session lifecycle managed via server; no explicit disconnect in typical flow |
| Resume prior session | `s.client.resumeSession(sessionId)` | Reuse the same `sessionID` with `s.client.session.prompt()` — the server retains history |
| Extract final text | `getAssistantText(messages)` (see `failure-modes.md` §F1) | `extractResponseText(result.data!.parts)` |

**Multi-agent handoff example (applies the same pattern as Copilot):**

```ts
// Buggy — orchestrator session is fresh; it has no idea what the planner
// produced because we created a brand-new session for it.
await runAgent("planner-1", "planner", buildPlannerPrompt(ctx.userPrompt));
await runAgent("orchestrator-1", "orchestrator", buildOrchestratorPrompt());

// Correct — capture planner output and forward it into orchestrator prompt
const plannerNotes = await runAgent(
  "planner-1",
  "planner",
  buildPlannerPrompt(ctx.userPrompt),
);
await runAgent(
  "orchestrator-1",
  "orchestrator",
  buildOrchestratorPrompt(ctx.userPrompt, { plannerNotes }),
);
```

When planner output is large enough to strain the orchestrator's context
window, compress before forwarding — consult `context-compression`. When a
single long-running OpenCode session starts showing lost-in-middle
symptoms, consult `context-optimization` for compaction/masking strategies
before reaching for "just start a new session", which loses all history.

**Read the Copilot section for the full write-up.** The pitfall applies
identically here; the only thing that changes is the method names.

### Multi-turn conversations

Send multiple prompts to the same session using `s.client.session.prompt()` with `s.session.id`:

```ts
.run(async (ctx) => {
  await ctx.stage({ name: "multi-turn" }, {}, { title: "multi-turn" }, async (s) => {
    // Turn 1
    await s.client.session.prompt({
      sessionID: s.session.id,
      parts: [{ type: "text", text: "Plan the implementation." }],
    });
    // Turn 2
    await s.client.session.prompt({
      sessionID: s.session.id,
      parts: [{ type: "text", text: "Now implement the plan." }],
    });
    // Turn 3
    const result = await s.client.session.prompt({
      sessionID: s.session.id,
      parts: [{ type: "text", text: "Run the tests." }],
    });

    s.save(result.data!);
  });
})
```

### Structured output

```ts
// Inside a ctx.stage callback:
const result = await s.client.session.prompt({
  sessionID: s.session.id,
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
// Inside a ctx.stage callback:
await s.client.session.prompt({
  sessionID: s.session.id,
  parts: [{ type: "text", text: "Here is the background context..." }],
  noReply: true,
});
// Now send the actual prompt
const result = await s.client.session.prompt({
  sessionID: s.session.id,
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

// Usage inside a ctx.stage callback:
const result = await s.client.session.prompt({
  sessionID: s.session.id,
  parts: [{ type: "text", text: s.userPrompt }],
});
const text = extractResponseText(result.data!.parts);
```

### Event streaming

```ts
// Inside a ctx.stage callback:
const unsubscribe = await s.client.event.subscribe((event) => {
  if (event.type === "session.updated") {
    console.log("Session updated:", event.data);
  }
});
```

### Sub-agent delegation

Pass the `agent` parameter to `s.client.session.prompt()` to route a prompt to a named sub-agent:

```ts
.run(async (ctx) => {
  await ctx.stage(
    { name: "plan" },
    {},
    { title: "plan" },
    async (s) => {
      // Route the prompt to the "planner" agent
      const result = await s.client.session.prompt({
        sessionID: s.session.id,
        parts: [{ type: "text", text: s.userPrompt }],
        agent: "planner",
      });

      s.save(result.data!);
    },
  );
})
```
