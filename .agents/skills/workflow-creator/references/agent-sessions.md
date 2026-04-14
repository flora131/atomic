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
    {}, // sessionOpts: query defaults (pollIntervalMs, readyTimeoutMs, etc.) go here
    async (s) => {
      // s.client — Claude CLI wrapper (already started by runtime)
      // s.session — session wrapper (ready to accept queries via s.session.query())

      // Send queries — Claude maintains conversation context across calls
      // Returns SessionMessage[] (native SDK type from @anthropic-ai/claude-agent-sdk)
      const result = await s.session.query((s.inputs.prompt ?? ""));

      // Save transcript
      s.save(s.sessionId);
    },
  );
})
```

The runtime handles:
1. Starting the Claude CLI in the tmux pane
2. Creating a session wrapper bound to the pane (exposes `s.session.query()`)
3. Auto-cleanup after the callback returns

Client options (2nd arg to `ctx.stage()`):
- `chatFlags` — CLI flags (default: `["--allow-dangerously-skip-permissions", "--dangerously-skip-permissions"]`)
- `readyTimeoutMs` — timeout waiting for TUI readiness (default: 30s)

Session options (3rd arg to `ctx.stage()`), applied as defaults to every `s.session.query()` call:
- `pollIntervalMs` — polling interval (default: 2000ms)
- `submitPresses` — C-m presses per submit round (default: 1)
- `maxSubmitRounds` — max submit rounds (default: 6)
- `readyTimeoutMs` — timeout waiting for pane readiness before sending (default: 30s)

No manual timeout is needed — idle detection watches for the pane prompt to return, and the session transcript is used to extract the response text.

### Basic usage with `s.session.query()`

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow({
    name: "implement",
    inputs: [{ name: "prompt", type: "text", required: true, description: "task prompt" }],
  })
  .for<"claude">()
  .run(async (ctx) => {
    await ctx.stage(
      { name: "implement", description: "Implement the feature" },
      {},
      {},
      async (s) => {
        const messages = await s.session.query((s.inputs.prompt ?? ""));
        // messages is SessionMessage[] — native SDK type
        // Use extractAssistantText(messages, 0) to get the text response
        s.save(s.sessionId);
      },
    );
  })
  .compile();
```

`s.session.query(prompt)` sends text to the Claude pane, verifies delivery, retries if needed, and waits for output stabilization. Returns `SessionMessage[]` (the native transcript messages from this turn, imported from `@anthropic-ai/claude-agent-sdk`). Use `extractAssistantText(messages, 0)` to extract the plain text response.

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
      prompt: (s.inputs.prompt ?? ""),
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

### Sub-agent delegation

For stages that call a single sub-agent, use `--agent` (interactive) or the SDK `agent` option (headless) to route all prompts through that agent. The agent must be defined in `.claude/agents/` or `.agents/skills/`.

**Interactive stages** — pass `--agent` via `chatFlags` in client opts (2nd arg):

```ts
.run(async (ctx) => {
  await ctx.stage(
    { name: "plan" },
    { chatFlags: ["--agent", "planner", "--allow-dangerously-skip-permissions", "--dangerously-skip-permissions"] },
    {},
    async (s) => {
      await s.session.query(`Create a plan for: ${(s.inputs.prompt ?? "")}`);
      s.save(s.sessionId);
    },
  );
})
```

**Headless stages** — pass `agent` via SDK options in the `query()` call:

```ts
.run(async (ctx) => {
  const handle = await ctx.stage(
    { name: "locate", headless: true },
    {}, {},
    async (s) => {
      const result = await s.session.query(
        "Find all API endpoint files",
        { agent: "codebase-locator", permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true },
      );
      s.save(s.sessionId);
      return extractAssistantText(result, 0);
    },
  );
})
```

> **Note:** The `@"agent-name (agent)"` prompt prefix is for multi-agent conversations in a single stage where you switch between agents mid-session. For single-agent stages, prefer `--agent` (interactive) or the `agent` SDK option (headless) as shown above.

### Headless mode (background stages)

Claude headless stages use the Agent SDK's `query()` API directly in-process instead of automating a tmux pane. Set `headless: true` in the stage options. SDK options like `agent`, `permissionMode`, and `allowDangerouslySkipPermissions` can be passed directly in the `query()` call:

```ts
import { defineWorkflow, extractAssistantText } from "@bastani/atomic/workflows";

// ...
await ctx.stage(
  { name: "background-analysis", headless: true },
  {}, {},
  async (s) => {
    const result = await s.session.query(
      "Analyze the codebase.",
      { agent: "codebase-analyzer", permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true },
    );
    s.save(s.sessionId);
    return extractAssistantText(result, 0);
  },
);
```

The callback interface is identical to interactive stages — `s.session.query()` returns `SessionMessage[]` in both cases. Internally, the runtime uses `HeadlessClaudeSessionWrapper` which calls `query()` from `@anthropic-ai/claude-agent-sdk` directly. No tmux pane is created, and the stage is invisible in the workflow graph.

**Design principle:** Never create custom message types. All provider return types are native SDK types — `SessionMessage[]` for Claude, `SessionEvent[]` for Copilot, `SessionPromptResponse` for OpenCode. Use `extractAssistantText()` to extract plain text from Claude's `SessionMessage[]`.

## Copilot SDK

Copilot uses a client-server architecture. The runtime auto-creates a `CopilotClient` (as `s.client`) and a `CopilotSession` (as `s.session`) before invoking your callback. Auto-cleanup (`session.disconnect()` and `client.stop()`) is handled by the runtime after the callback completes.

### Basic usage

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow({
    name: "implement",
    inputs: [{ name: "prompt", type: "text", required: true, description: "task prompt" }],
  })
  .for<"copilot">()
  .run(async (ctx) => {
    await ctx.stage(
      { name: "implement" },
      {}, // clientOpts: CopilotClientOptions (excluding cliUrl, which is auto-injected)
      {}, // sessionOpts: CopilotSessionConfig (model, agent, tools, hooks, etc.)
      async (s) => {
        // s.client — CopilotClient (already started by runtime)
        // s.session — CopilotSession (already created, foreground session set)

        await s.session.send({ prompt: (s.inputs.prompt ?? "") });

        s.save(await s.session.getMessages());
      },
    );
  })
  .compile();
```

### `send` vs `sendAndWait`: choosing the right method

**Default to `send`** for all Copilot workflow stages. `send` dispatches the
prompt and returns the `messageId` immediately — no timeout to guess, no
constants to tune, no risk of aborting a long-running agent mid-work.

```ts
// Default pattern — clean, no timeout guessing
await s.session.send({ prompt });
```

**Use `sendAndWait` only when the user explicitly requests timeout-based
waiting.** `sendAndWait` blocks until the session emits `session.idle` or the
timeout fires. If you must use it, ask the user for a reasonable timeout. If
they aren't sure, default to **5 minutes** (300 000 ms).

```ts
// Only when the user explicitly wants timeout-gated waiting
const SEND_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default; ask the user
await s.session.sendAndWait({ prompt }, SEND_TIMEOUT_MS);
```

**Why not `sendAndWait` by default?** The 60-second default timeout is almost
never correct for real agent work — planners, reviewers, and orchestrators
routinely exceed it. Guessing large timeouts (30-60 min) adds messy constants
and still risks aborting work prematurely. `send` avoids the problem entirely.

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
| **Continued** | Same session, additional `send` calls | All prior turns in this session | Nothing — but watch total token usage |
| **Resumed** | `client.resumeSession(sessionId)` | All persisted turns from the prior session of the SAME agent | Nothing — full history is reattached |
| **Closed** | `session.disconnect()` or `client.stop()` | **Gone** from the live client; persisted on disk if the host enables it | Either resume by ID (same agent) or start fresh and re-inject context |

The failure mode: you close a session, create a new one, and assume the new
one "remembers" the previous conversation. It doesn't. `client` is just the
transport — each session is a fully independent conversation.

For normal workflow authoring, the key rule is simpler than the full lifecycle
table: **every new `ctx.stage()` call is fresh**. If you need full history,
prefer another turn inside the same stage callback. Resume/fork APIs are
provider-specific escape hatches, not the default stage-to-stage handoff path.

```ts
// Buggy — the orchestrator session is fresh and knows NOTHING about
// what the planner just produced, because createSession() started a
// brand-new conversation.
await runAgent("planner", buildPlannerPrompt((ctx.inputs.prompt ?? "")));
await runAgent("orchestrator", buildOrchestratorPrompt());
// ↑ orchestrator only sees buildOrchestratorPrompt() — no planner output,
//   no original user spec, no context.
```

#### Three reliable ways to avoid losing context

Pick the one that fits the data you need to hand off. These are not
mutually exclusive — ralph uses (1) + (2) together as belt-and-braces.

**1. Explicit prompt handoff** — capture the prior session's last assistant
message and inject it (or a summary) into the next session's first prompt.
Simplest and most common fix:

```ts
async function runAgent(agent: string, prompt: string): Promise<string> {
  const session = await client.createSession({ agent, onPermissionRequest: approveAll });
  await session.send({ prompt });
  const messages = await session.getMessages();
  await session.disconnect();
  return getAssistantText(messages); // concatenate every top-level turn — see failure-modes.md §F1
}

// Correct — forward the planner's output into the orchestrator prompt
const plannerNotes = await runAgent("planner", buildPlannerPrompt((ctx.inputs.prompt ?? "")));
await runAgent(
  "orchestrator",
  buildOrchestratorPrompt((ctx.inputs.prompt ?? ""), { plannerNotes }),
);
```

**2. External shared state** — write results to a medium both sessions can
read: the task list (`TaskCreate` / `TaskList`), files on disk, a git
working tree, or a database. The planner writes; the orchestrator reads.
Ralph uses `TaskCreate`/`TaskList` as its primary coordination medium.

**3. Keep the follow-up in the same stage callback** — if the next step needs
the full live conversation, don't cross a stage boundary. Send another turn to
the same session instead. This is the standard workflow-API way to preserve
history across related steps.

```ts
// Same stage, multi-turn — full history stays attached
await s.session.send({ prompt: "Plan the implementation." });
await s.session.send({ prompt: "Follow up on the plan above." });
```

If you deliberately drop down to provider-specific resume/fork APIs, keep them
within the same agent role. They are advanced escape hatches, not the normal
way stages communicate.

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

Send multiple prompts to the same session:

```ts
.run(async (ctx) => {
  await ctx.stage({ name: "implement" }, {}, {}, async (s) => {
    // Turn 1
    await s.session.send({ prompt: "Plan the implementation." });
    // Turn 2
    await s.session.send({ prompt: "Now implement the plan." });
    // Turn 3
    await s.session.send({ prompt: "Run the tests." });

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
    await s.session.send({ prompt: (s.inputs.prompt ?? "") });
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
    await s.session.send({ prompt: (s.inputs.prompt ?? "") });
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

/** Concatenate every top-level assistant turn's non-empty content.
 *  Canonical definition — also referenced in failure-modes.md §F1
 *  and computation-and-validation.md. */
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
.run(async (ctx) => {
  await ctx.stage(
    { name: "plan" },
    {},
    { agent: "planner" }, // sessionOpts — binds the session to the "planner" agent
    async (s) => {
      await s.session.send({ prompt: (s.inputs.prompt ?? "") });
      s.save(await s.session.getMessages());
    },
  );
})
```

### Headless mode (background stages)

Copilot headless stages let the SDK spawn its own CLI subprocess internally — no tmux pane is needed. Set `headless: true`:

```ts
await ctx.stage(
  { name: "background-task", headless: true },
  {}, {},
  async (s) => {
    // s.session.send() works identically
    await s.session.send({ prompt: "Analyze the codebase." });
    s.save(await s.session.getMessages());
  },
);
```

The SDK creates a `CopilotClient` without a `cliUrl` — it spawns its own CLI process internally rather than connecting to a tmux-hosted server. The callback interface is identical.

## OpenCode SDK

OpenCode uses a client-server model. The runtime auto-creates an `OpencodeClient` (as `s.client`) and an OpenCode session (as `s.session`) before invoking your callback. Use `s.client.session.prompt({ sessionID: s.session.id, ... })` to send prompts.

### Basic usage

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow({
    name: "implement",
    inputs: [{ name: "prompt", type: "text", required: true, description: "task prompt" }],
  })
  .for<"opencode">()
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
          parts: [{ type: "text", text: (s.inputs.prompt ?? "") }],
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
| Send a turn | `s.session.send({ prompt })` | `s.client.session.prompt({ sessionID: s.session.id, parts })` |
| Close / disconnect | Auto-handled by runtime | session lifecycle managed via server; no explicit disconnect in typical flow |
| Continue prior conversation | `s.client.resumeSession(sessionId)` (provider API; advanced) | Reuse the same `sessionID` with `s.client.session.prompt()` inside the same logical conversation. `ctx.stage()` itself still creates a fresh session every time |
| Extract final text | `getAssistantText(messages)` (see `failure-modes.md` §F1) | `extractResponseText(result.data!.parts)` |

**Multi-agent handoff example (applies the same pattern as Copilot):**

```ts
// Buggy — orchestrator session is fresh; it has no idea what the planner
// produced because we created a brand-new session for it.
await runAgent("planner-1", "planner", buildPlannerPrompt((ctx.inputs.prompt ?? "")));
await runAgent("orchestrator-1", "orchestrator", buildOrchestratorPrompt());

// Correct — capture planner output and forward it into orchestrator prompt
const plannerNotes = await runAgent(
  "planner-1",
  "planner",
  buildPlannerPrompt((ctx.inputs.prompt ?? "")),
);
await runAgent(
  "orchestrator-1",
  "orchestrator",
  buildOrchestratorPrompt((ctx.inputs.prompt ?? ""), { plannerNotes }),
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
/** Filter for text parts only — non-text parts produce [object Object].
 *  Canonical definition — also referenced in failure-modes.md §F3
 *  and computation-and-validation.md. */
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
  parts: [{ type: "text", text: (s.inputs.prompt ?? "") }],
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
        parts: [{ type: "text", text: (s.inputs.prompt ?? "") }],
        agent: "planner",
      });

      s.save(result.data!);
    },
  );
})
```

### Headless mode (background stages)

OpenCode headless stages use `createOpencode()` from the SDK to start both server and client in-process. Set `headless: true`:

```ts
await ctx.stage(
  { name: "background-task", headless: true },
  {}, { title: "background-task" },
  async (s) => {
    // s.client.session.prompt() works identically
    const result = await s.client.session.prompt({
      sessionID: s.session.id,
      parts: [{ type: "text", text: "Analyze the codebase." }],
    });
    s.save(result.data!);
  },
);
```

Internally, the runtime uses `createOpencode({ port: 0 })` to start both the OpenCode server and client in-process. A cleanup callback closes the server when the stage completes. The callback interface is identical.
