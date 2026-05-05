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

Claude has **no per-session options** — the type is `Record<string, never>` and the 3rd arg must be `{}`. Interactive delivery is driven entirely by the CLI's Stop hook; idle detection is automatic (pane capture for interactive stages, SDK streaming for headless stages).

If you want to configure agent/permission/tools behavior for a **headless** Claude stage, pass those fields as the second argument to `s.session.query(prompt, options)` — they flow through as `Partial<SDKOptions>` to the Agent SDK (see the headless example below).

```ts
await ctx.stage({ name: "..." }, {}, {}, async (s) => {
  await s.session.query((s.inputs.prompt ?? ""));
  s.save(s.sessionId);
});
```

### `query()` options (reference for `s.session.query()` sdkOptions)

**This block is a reference cheatsheet for the SDK option shape — it is
not valid workflow code.** Do not import `query` from
`@anthropic-ai/claude-agent-sdk` inside a `ctx.stage()` callback (see
`failure-modes.md` §F16). In a **headless** stage, pass these options as
the second argument to `s.session.query(prompt, sdkOptions)` — the runtime
forwards them to the Agent SDK. In an **interactive** stage, the options
are silently ignored; drive behaviour via `chatFlags` in `clientOpts`
instead.

```ts
// ❌ Reference only — do not call query() like this from a workflow.
import { query } from "@anthropic-ai/claude-agent-sdk";

const result = query({
  prompt: (ctx.inputs.prompt ?? ""),
  options: {
    // Model selection
    model: "claude-opus-4-6",         // Full model ID or alias ("opus", "sonnet", "haiku")
    effort: "high",                   // "low", "medium", "high", "xhigh", "max" (max is Opus 4.6/4.7 only)
    thinking: { type: "adaptive" },   // Default for supported models; or { type: "enabled", budgetTokens: N }
    maxTurns: 50,                     // Maximum conversation turns
    maxBudgetUsd: 5.0,                // Spending cap in USD

    // Permissions
    permissionMode: "acceptEdits",    // "default", "dontAsk", "acceptEdits", "bypassPermissions", "plan", "auto" ("auto" routes through a model classifier; v0.2.x+)

    // Tools — base set of available built-in tools
    tools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],  // or { type: "preset", preset: "claude_code" } for all defaults
    allowedTools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],  // auto-allowed without prompting
    disallowedTools: ["AskUserQuestion"],  // removed from model's context

    // Skills — preload named skills into the headless session (v0.2.120+)
    skills: ["my-skill"],             // or "all" to preload every available skill

    // System prompt — string or preset with additions
    systemPrompt: "You are a senior security auditor...",
    // Or: { type: "preset", preset: "claude_code", append: "Always explain your reasoning.", excludeDynamicSections: true }
    // `excludeDynamicSections: true` (v0.2.124+) moves per-session context into the
    // first user message so the static prefix can be re-cached across runs.

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

    // Performance / observability (v0.2.111+ unless noted)
    enableFileCheckpointing: true,    // enables query.rewindFiles() — v0.2.111+
    sessionStore: myStore,            // mirror transcripts to an external SessionStore — v0.2.113+
    forwardSubagentText: true,        // forward subagent text + thinking blocks upstream — v0.2.118+
    agentProgressSummaries: true,     // periodic progress summaries for long-running stages
    fallbackModel: "claude-sonnet-4-6", // model fallback if the primary is overloaded
    taskBudget: { total: 100 },       // @alpha — overall cost / call budget for the session
  },
});
```

**New top-level helpers** (root export from `@anthropic-ai/claude-agent-sdk`):
`startup()` / `WarmQuery` (pre-warm subprocess for ~20× faster first
query — single-use; consume with `await using` for auto-disposal),
`getSessionInfo`, `renameSession`, `tagSession`, `deleteSession`,
`forkSession`, `getSubagentMessages`, `listSubagents`. Use `startup()` at the
top of `.run()` when a workflow opens many short headless stages back-to-back.

### `s.session.query()` usage

`s.session.query()` sends text to the Claude pane, verifies delivery, and waits for output stabilization. It uses
the pane ID from `s.paneId` automatically. Call it inside the stage callback:

```ts
import { extractAssistantText } from "@bastani/atomic-sdk/workflows";

await ctx.stage({ name: "..." }, {}, {}, async (s) => {
  const result = await s.session.query("Your prompt");
  // extractAssistantText(result, 0) — extract assistant text from the result
  const text = extractAssistantText(result, 0);
  s.save(s.sessionId);
});
```

For **headless stages**, SDK options (such as `permissionMode`, `agent`,
`allowDangerouslySkipPermissions`) can be passed directly as the second
argument to `s.session.query()`:

```ts
await ctx.stage({ name: "..." }, {}, {}, async (s) => {
  const result = await s.session.query("Your prompt", {
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    agent: "worker",
  });
  const text = extractAssistantText(result, 0);
  s.save(s.sessionId);
});
```

### Claude hooks

Hooks intercept tool usage, session events, and context management. The `hooks` option is `Partial<Record<HookEvent, HookCallbackMatcher[]>>` — each event maps to an array of matchers with callback arrays:

```ts
const result = query({
  prompt: (ctx.inputs.prompt ?? ""),
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

**Hook events** — the full `HookEvent` union the Agent SDK accepts:
`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`,
`Notification`, `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`,
`SessionEnd`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`,
`PreCompact`, `PostCompact`, `PermissionRequest`, `PermissionDenied`,
`Setup`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`, `Elicitation`,
`ElicitationResult`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`,
`InstructionsLoaded`, `CwdChanged`, `FileChanged`. The Atomic runtime
already wires several of these (`Stop`, `SessionStart`, `PreToolUse`,
`PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`,
`TeammateIdle`) inside `WORKFLOW_HOOK_SETTINGS` to drive idle detection,
HIL pulse, and transcript markers — your custom hook callbacks compose on
top of those, they don't replace them.

**Tool rename note (v0.2.x+):** Claude renamed the subagent dispatch tool
from `Task` to `Agent`. `tool_use` blocks emitted by the assistant now use
`name: "Agent"`, but `system:init`'s tools list and
`permission_denials[].tool_name` still report `"Task"` for backwards
compatibility. Match on either name when scanning transcripts. The
`PostToolUse` hook return shape now uses `updatedToolOutput` (replaces the
deprecated `updatedMCPToolOutput`).

## Copilot SDK

### Session options (`sessionOpts` — 3rd arg to `ctx.stage()`)

All `client.createSession()` options are passed as `sessionOpts`. The runtime
forwards them to `client.createSession()`. `onPermissionRequest` defaults to
`approveAll` when not specified — this default is auto-applied by the runtime,
but you must pass it explicitly if you ever call `client.resumeSession()`
yourself (the field is `required` on `SessionConfig` at the type level).

```ts
import { approveAll, defineTool } from "@github/copilot-sdk";
import { z } from "zod";

await ctx.stage({ name: "plan" }, {}, {
  // Model selection
  model: "claude-sonnet-4.6",
  reasoningEffort: "high",            // "low" | "medium" | "high" | "xhigh" — no "max" for Copilot

  // System prompt
  systemMessage: "You are a security auditor...",

  // Custom tools — Zod is the preferred shape for `parameters` (the SDK
  // converts to JSON Schema internally). A literal JSON Schema object also
  // works, but Zod composes better with TypeScript and is what every live
  // example in /examples uses.
  tools: [
    defineTool({
      name: "check-coverage",
      description: "Check test coverage",
      parameters: z.object({ path: z.string().describe("Path to inspect") }),
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

  // Streaming events (v0.3.0+) — toggle assistant.message_delta and
  // assistant.reasoning_delta token-by-token events. Off by default.
  streaming: true,

  // Tool allowlist / blocklist (v0.3.0+) — restrict the available tool surface
  // without rewriting the system prompt.
  availableTools: ["read-file", "write-file", "shell"],
  excludedTools: ["delete-file"],

  // Subscribe to events synchronously, before `session.create` resolves —
  // ensures early events aren't dropped when the `session` object hasn't
  // been returned yet.
  onEvent: (event) => { /* see SessionEventHandler */ },

  // Slash-command registration (v0.3.0+) — add custom commands to the
  // Copilot CLI prompt that this session honours.
  commands: [
    { name: "review", description: "Run a code review", argHint: "<path>" },
  ],

  // Skill discovery (v0.3.0+)
  enableConfigDiscovery: true,        // auto-load .mcp.json + skill directories
  skillDirectories: [".agents/skills"],
  disabledSkills: ["legacy-skill"],

  // Programmatic agent binding (v0.3.0+)
  customAgents: [{ name: "reviewer", systemMessage: "...", tools: [] }],
  defaultAgent: { name: "reviewer" },
  agent: "reviewer",                  // bind this session to a specific agent

  // Multitenancy / BYOK
  gitHubToken: process.env.GITHUB_TOKEN,
  provider: { kind: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY },

  // Hooks
  hooks: {
    onPreToolUse: (event) => { /* before tool */ },
    onPostToolUse: (event) => { /* after tool */ },
    onSessionStart: (event) => { /* session started */ },
    onSessionEnd: (event) => { /* session ended */ },
    onErrorOccurred: (event) => { /* error handling */ },
  },

  // Auto-manage context via compaction. **`infiniteSessions` is on by
  // default in v0.3.0+** — pass `false` to opt out, or pass a config object
  // to tune thresholds. The boolean form is sugar for the default config.
  infiniteSessions: {
    enabled: true,
    backgroundCompactionThreshold: 0.8, // start compacting at 80% window usage
    bufferExhaustionThreshold: 0.95,    // block at 95% until compaction completes
  },
}, async (s) => {
  await s.session.send({ prompt: (s.inputs.prompt ?? "") });
  s.save(await s.session.getMessages());
});
```

**Disposal:** prefer `s.session.disconnect()` over the deprecated
`s.session.destroy()` if you ever tear a session down manually. The Atomic
runtime calls the right method automatically — this matters only when you
bypass `ctx.stage()` for some reason.

### Copilot permission modes

```ts
// Approve everything (autonomous) — this is the default
await ctx.stage({ name: "plan" }, {}, { onPermissionRequest: approveAll }, async (s) => {
  await s.session.send({ prompt: (s.inputs.prompt ?? "") });
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
  await s.session.send({ prompt: (s.inputs.prompt ?? "") });
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
parentID, workspaceID, or — most importantly — a `permission` ruleset for
the session:

```ts
await ctx.stage({ name: "..." }, {}, {
  title: "Feature implementation",
  parentID: "parent-session-id",
  workspaceID: "workspace-id",
  // Recommended default — autonomous stages should approve every tool call.
  // Mirrors Copilot's `approveAll` and Claude's `bypassPermissions`. Omit
  // (or narrow) only when a stage must gate specific tools behind HIL.
  permission: [{ permission: "*", pattern: "*", action: "allow" }],
}, async (s) => {
  // s.session is the created OpencodeSession, s.session.id is the session ID
});
```

### OpenCode session permission ruleset (recommended default)

Every opencode stage in the builtin and example workflows passes
`permission: [{ permission: "*", pattern: "*", action: "allow" }]`
explicitly. **Do the same for new opencode workflows.** This is OpenCode's
equivalent of:

| Agent    | Autonomous-default knob                                         |
| -------- | --------------------------------------------------------------- |
| Claude   | `chatFlags: ["--dangerously-skip-permissions"]` (interactive) / `permissionMode: "bypassPermissions"` (headless `s.session.query()` options) |
| Copilot  | `onPermissionRequest: approveAll` (defaults on automatically)   |
| OpenCode | `permission: [{ permission: "*", pattern: "*", action: "allow" }]` (default in the runtime; **set explicitly so workflow authors can see and override per stage**) |

Why explicit:

- The runtime applies the same allow-all ruleset as a fallback, but
  **workflow authors should see the permission decision in the workflow
  source** — not learn it by reading the executor.
- A workflow author who needs a stricter ruleset (e.g. deny `bash` on a
  production machine, ask before `edit` on a sensitive directory) can
  override the field per stage. The runtime only applies the default when
  `permission` is `undefined` in the session opts.
- Mirroring the explicit pattern keeps the three SDK variants visually
  symmetric — every stage in every agent shows its permission posture in
  the same place (3rd arg to `ctx.stage()`).

To narrow per stage, pass any other ruleset shape:

```ts
// Deny shell commands in this stage; ask for everything else.
await ctx.stage({ name: "review" }, {}, {
  title: "review",
  permission: [
    { permission: "bash", pattern: "*", action: "deny" },
    { permission: "*", pattern: "*", action: "ask" },
  ],
}, async (s) => { /* ... */ });
```

The full type lives in `@opencode-ai/sdk/v2` as `PermissionRuleset`
(`Array<{ permission: string; pattern?: string; action: "allow" | "deny" | "ask" }>`).

### Session prompting

Use `s.client` and `s.session.id` inside the callback. Recent OpenCode SDK
versions added several per-call overrides on `session.prompt()` that don't
appear in older docs:

```ts
await ctx.stage({ name: "implement" }, {}, {}, async (s) => {
  // Basic prompt
  const result = await s.client.session.prompt({
    sessionID: s.session.id,
    parts: [{ type: "text", text: (s.inputs.prompt ?? "") }],

    // Per-call model override — structured form `{ providerID, modelID }`.
    // The string form is also accepted but the structured form is canonical.
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },

    // Per-call system override and per-call tool toggle (v1.14+).
    system: "Respond as a senior backend engineer.",
    tools: { "read-file": true, "shell": false },

    // Optional: variant, messageID, workspace per call.
    variant: "long-context",
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
  // The structured payload lands on `AssistantMessage.structured` — NOT
  // `structured_output`. Read it as
  // `(structured.data!.info as { structured?: unknown }).structured`. The
  // local docs/opencode/sdk.md call this `structured_output`; that is wrong
  // for current SDK versions.

  // No-reply context injection
  await s.client.session.prompt({
    sessionID: s.session.id,
    parts: [{ type: "text", text: "Background context..." }],
    noReply: true,
  });

  // Fire-and-forget variant (does not wait for completion).
  await s.client.session.promptAsync({
    sessionID: s.session.id,
    parts: [{ type: "text", text: "Kick off background indexing." }],
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

## Structured output across providers

The three providers all support JSON-schema constrained output, but the
mechanics and access patterns differ. The pattern below mirrors the live
`examples/structured-output-demo/` workflows verbatim — copy from there
when adding structured output to a new workflow.

### Always strip `$schema` before passing a Zod schema

Both Claude and OpenCode reject schemas that contain a `$schema` URL field
(it is not part of OpenAPI 3.0, and the upstream validators silently drop
the entire `structured_output`/`structured` payload when they see it).
Use `z.toJSONSchema(schema, { target: "openapi-3.0" })` to convert Zod to
JSON Schema *and* strip `$schema` in one step:

```ts
import { z } from "zod";

const LanguageFactsSchema = z.object({
  language: z.string(),
  paradigms: z.array(z.string()),
});

// Right — produces an OpenAPI-3.0 compatible JSON Schema with no $schema.
const schema = z.toJSONSchema(LanguageFactsSchema, { target: "openapi-3.0" });
```

The `examples/structured-output-demo/helpers/schema.ts` file has the
canonical helper.

### Claude — `outputFormat` + `s.session.lastStructuredOutput`

```ts
await ctx.stage({ name: "extract", headless: true }, {}, {}, async (s) => {
  await s.session.query("Extract language facts from the input text.", {
    outputFormat: { type: "json_schema", schema },
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
  });

  // `lastStructuredOutput` is an Atomic-SDK convenience getter on the
  // headless Claude session wrapper (defined at
  // packages/atomic-sdk/src/providers/claude.ts). It is `undefined` on
  // interactive (visible) Claude stages because the Agent SDK only emits
  // `structured_output` in headless `query()` results.
  const result = s.session.lastStructuredOutput as
    | { language: string; paradigms: string[] }
    | undefined;
  if (result) s.save(s.sessionId);
});
```

### OpenCode — `format` field, read `info.structured`

```ts
const handle = await ctx.stage({ name: "extract" }, {}, {}, async (s) => {
  const result = await s.client.session.prompt({
    sessionID: s.session.id,
    parts: [{ type: "text", text: "Extract language facts." }],
    format: { type: "json_schema", schema, retryCount: 3 },
  });
  // Field name is `structured`, NOT `structured_output`.
  return (result.data!.info as { structured?: unknown }).structured;
});
```

### Copilot — `defineTool` + Zod, no separate format field

Copilot expresses structured output as a tool the model is forced to call.
Pass the Zod schema *directly* as `parameters` — the SDK converts it
internally:

```ts
import { defineTool } from "@github/copilot-sdk";

const reviewTool = defineTool({
  name: "submit-review",
  description: "Submit the structured review verdict.",
  parameters: LanguageFactsSchema,            // Zod, not JSON Schema
  execute: async (params) => ({ content: JSON.stringify(params) }),
});

await ctx.stage({ name: "extract" }, {}, { tools: [reviewTool] }, async (s) => {
  await s.session.send({ prompt: "Extract language facts and call submit-review." });
  s.save(await s.session.getMessages());
});
```
