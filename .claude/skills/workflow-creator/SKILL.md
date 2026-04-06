---
name: workflow-creator
description: Create custom multi-agent workflows for Atomic CLI using the defineWorkflow() session-based API with programmatic SDK code. Use this skill whenever the user wants to create a workflow, build an agent pipeline, define a multi-stage automation, set up a review loop, or connect multiple coding agents together. Also trigger when they mention workflow files, .atomic/workflows/, defineWorkflow, or ask how to automate a sequence of agent tasks — even if they don't use the word "workflow" explicitly.
---

# Workflow Creator

You are a workflow architect specializing in the Atomic CLI `defineWorkflow()` session-based API. Your role is to translate user intent into well-structured workflow files that orchestrate multiple coding agent sessions using **programmatic SDK code** — Claude Agent SDK, Copilot SDK, and OpenCode SDK.

## Reference Files

Load the topic-specific reference files from `references/` as needed. Start with `getting-started.md` for a quick-start example, then consult the others based on the task:

| File | When to load |
|---|---|
| `getting-started.md` | Always — quick-start example, SDK exports, and `SessionContext` reference |
| `agent-sessions.md` | Creating agent sessions with SDK calls: Claude `query()` / `claudeQuery()`, Copilot `CopilotClient`, OpenCode `createOpencodeClient()` |
| `computation-and-validation.md` | Deterministic computation, response parsing, validation, file I/O inside `run()` |
| `user-input.md` | Collecting user input: Claude `canUseTool`, Copilot `onElicitationRequest`, OpenCode TUI control |
| `control-flow.md` | Loops (`for`/`while`), conditionals (`if`/`else`), early termination, retry patterns |
| `state-and-data-flow.md` | Data flow between sessions: `ctx.save()`, `ctx.transcript()`, `ctx.getMessages()`, file persistence |
| `session-config.md` | Per-SDK configuration: model, tools, permissions, hooks, structured output |
| `discovery-and-verification.md` | File discovery, `export default`, provider validation, TypeScript config |

## How Workflows Work

A workflow is a TypeScript file that chains `.session()` calls to define a sequence of agent sessions. Each session's `run(ctx)` callback contains **raw provider SDK code** — you program directly against the Claude Agent SDK, Copilot SDK, or OpenCode SDK. This gives you full access to every SDK feature: multi-turn conversations, subagents, structured output, custom tools, hooks, permissions, and more.

```ts
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({ name: "my-workflow", description: "..." })
  .session({ name: "step-1", run: async (ctx) => { /* SDK code here */ } })
  .session({ name: "step-2", run: async (ctx) => { /* SDK code here */ } })
  .compile();
```

The chain reads top-to-bottom as the execution order. At the end, `.compile()` produces a branded `WorkflowDefinition` that the CLI runtime executes sequentially. Each session runs in its own tmux pane with the chosen agent.

Workflows are SDK-specific and saved to `.atomic/workflows/<agent>/<workflow-name>/index.ts`:
- `.atomic/workflows/claude/<name>/index.ts` — Claude Agent SDK code
- `.atomic/workflows/copilot/<name>/index.ts` — Copilot SDK code
- `.atomic/workflows/opencode/<name>/index.ts` — OpenCode SDK code

Global workflows: `~/.atomic/workflows/<agent>/<name>/index.ts`

## Concept-to-Code Mapping

Every workflow pattern — agent sessions, deterministic tools, user input, control flow, state management, and session configuration — maps directly to programmatic SDK code inside `run()`:

| Workflow Concept | Programmatic Pattern |
|---|---|
| Agent session (send prompt, get response) | `.session({ run })` + SDK calls: Claude `claudeQuery()` / `query()`, Copilot `session.sendAndWait()`, OpenCode `client.session.prompt()` |
| Deterministic computation (no LLM) | Plain TypeScript inside `run()`: validation, file I/O, transforms, API calls |
| User input mid-workflow | Claude: `canUseTool` callback; Copilot: `onUserInputRequest` / `onElicitationRequest`; OpenCode: TUI control |
| Conditional branching | Plain `if`/`else` in TypeScript inside `run()` |
| Bounded loops | Plain `for`/`while` loops with `break` inside `run()` |
| Data flow between sessions | `ctx.save()` to persist → `ctx.transcript()` or `ctx.getMessages()` to retrieve |
| Per-session configuration | SDK-specific: Claude `query({ options })`, Copilot `createSession({ ... })`, OpenCode `createOpencode({ config })` |
| Response data extraction | Parse SDK responses directly: Claude result messages, Copilot `SessionEvent[]`, OpenCode response parts |
| Subagent orchestration | Claude: `agents` option with `AgentDefinition[]`; Copilot: delegate via prompting; OpenCode: fork sessions |
| Runtime validation | Plain TypeScript or import Zod directly in `run()` |

## Authoring Process

### 1. Understand the User's Goal

Map the user's intent to sessions and programmatic patterns:

| Question | Maps to |
|----------|---------|
| What are the distinct steps? | Each step → `.session()` |
| Does any step need deterministic computation (no LLM)? | Plain TypeScript inside `run()` |
| Do any steps need to repeat? | `for`/`while` loop inside `run()` |
| Are there conditional paths? | `if`/`else` inside `run()` |
| What data flows between steps? | `ctx.save()` → `ctx.transcript()` / `ctx.getMessages()` |
| Does the workflow need user input? | SDK-specific user input APIs (see `user-input.md`) |
| Do any steps need a specific model? | SDK-specific session config (see `session-config.md`) |
| Does a step need structured output? | Claude: `outputFormat`; Copilot: parse response; OpenCode: `format` option |

### 2. Choose the Target Agent

Workflows are per-SDK. Decide which agent SDK to target:

| Agent | SDK Import | Primary API |
|-------|-----------|-------------|
| Claude | `claudeQuery` from `@bastani/atomic-workflows` | `claudeQuery({ paneId, prompt })` — automates Claude TUI via tmux |
| Copilot | `CopilotClient` from `@github/copilot-sdk` | `client.createSession()` → `session.sendAndWait({ prompt })` |
| OpenCode | `createOpencodeClient` from `@opencode-ai/sdk/v2` | `client.session.create()` → `client.session.prompt({ ... })` |

If you need cross-agent support, create one workflow file per agent under `.atomic/workflows/<agent>/<name>/index.ts`. Use shared helper modules for SDK-agnostic logic (prompts, parsing, validation).

### 3. Design the Session Sequence

Each `.session()` call defines one step:

| Field | Purpose |
|-------|---------|
| **`name`** | Unique identifier. Used as the key in `ctx.transcript("<name>")` for downstream access. |
| **`description`** | Short label for logging and the orchestrator UI. |
| **`run`** | Async callback receiving `SessionContext`. Write SDK code here. |

### 4. Write the Workflow File

**Claude example:**

```ts
// .atomic/workflows/claude/my-workflow/index.ts
import { defineWorkflow, claudeQuery } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "my-workflow",
    description: "Two-step pipeline",
  })
  .session({
    name: "analyze",
    description: "Analyze the codebase",
    run: async (ctx) => {
      await claudeQuery({ paneId: ctx.paneId, prompt: ctx.userPrompt });
      ctx.save(ctx.sessionId);
    },
  })
  .session({
    name: "implement",
    description: "Implement based on analysis",
    run: async (ctx) => {
      const analysis = await ctx.transcript("analyze");
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: `Based on this analysis:\n${analysis.content}\n\nImplement the changes.`,
      });
      ctx.save(ctx.sessionId);
    },
  })
  .compile();
```

**Copilot example:**

```ts
// .atomic/workflows/copilot/my-workflow/index.ts
import { defineWorkflow } from "@bastani/atomic-workflows";
import { CopilotClient, approveAll } from "@github/copilot-sdk";

export default defineWorkflow({
    name: "my-workflow",
    description: "Two-step pipeline",
  })
  .session({
    name: "analyze",
    description: "Analyze the codebase",
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
    name: "implement",
    description: "Implement based on analysis",
    run: async (ctx) => {
      const analysis = await ctx.transcript("analyze");
      const client = new CopilotClient({ cliUrl: ctx.serverUrl });
      await client.start();
      const session = await client.createSession({ onPermissionRequest: approveAll });
      await client.setForegroundSessionId(session.sessionId);

      await session.sendAndWait({
        prompt: `Based on this analysis:\n${analysis.content}\n\nImplement the changes.`,
      });
      ctx.save(await session.getMessages());

      await session.disconnect();
      await client.stop();
    },
  })
  .compile();
```

**OpenCode example:**

```ts
// .atomic/workflows/opencode/my-workflow/index.ts
import { defineWorkflow } from "@bastani/atomic-workflows";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

export default defineWorkflow({
    name: "my-workflow",
    description: "Two-step pipeline",
  })
  .session({
    name: "analyze",
    description: "Analyze the codebase",
    run: async (ctx) => {
      const client = createOpencodeClient({ baseUrl: ctx.serverUrl });
      const session = await client.session.create({ title: "analyze" });
      await client.tui.selectSession({ sessionID: session.data!.id });

      const result = await client.session.prompt({
        sessionID: session.data!.id,
        parts: [{ type: "text", text: ctx.userPrompt }],
      });
      ctx.save(result.data!);
    },
  })
  .session({
    name: "implement",
    description: "Implement based on analysis",
    run: async (ctx) => {
      const analysis = await ctx.transcript("analyze");
      const client = createOpencodeClient({ baseUrl: ctx.serverUrl });
      const session = await client.session.create({ title: "implement" });
      await client.tui.selectSession({ sessionID: session.data!.id });

      const result = await client.session.prompt({
        sessionID: session.data!.id,
        parts: [{
          type: "text",
          text: `Based on this analysis:\n${analysis.content}\n\nImplement the changes.`,
        }],
      });
      ctx.save(result.data!);
    },
  })
  .compile();
```

### 5. Type-Check the Workflow

```bash
bunx tsc --noEmit --pretty false
```

### 6. Test the Workflow

```bash
atomic workflow -n <workflow-name> -a <agent> "<your prompt>"
```

## Key Patterns

### Linear Pipeline

```ts
defineWorkflow({ name: "pipeline", description: "Sequential pipeline" })
  .session({ name: "plan", run: async (ctx) => { /* plan */ } })
  .session({ name: "execute", run: async (ctx) => { /* execute */ } })
  .session({ name: "verify", run: async (ctx) => { /* verify */ } })
  .compile();
```

### Review/Fix Loop (inside a single session)

Loops are plain TypeScript inside `run()`. The Ralph workflow demonstrates a review/fix loop:

```ts
.session({
  name: "review-fix",
  description: "Iterative review and fix",
  run: async (ctx) => {
    const MAX_CYCLES = 10;
    let consecutiveClean = 0;

    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      // Step 1: Ask the agent to review
      const reviewResult = await claudeQuery({
        paneId: ctx.paneId,
        prompt: buildReviewPrompt(ctx.userPrompt),
      });

      // Step 2: Parse and check findings (deterministic computation)
      const review = parseReviewResult(reviewResult.output);
      if (!hasActionableFindings(review, reviewResult.output)) {
        consecutiveClean++;
        if (consecutiveClean >= 2) break; // Two clean passes → done
        continue;
      }
      consecutiveClean = 0;

      // Step 3: Apply fixes
      const fixPrompt = buildFixSpecFromReview(review, ctx.userPrompt);
      await claudeQuery({ paneId: ctx.paneId, prompt: fixPrompt });
    }

    ctx.save(ctx.sessionId);
  },
})
```

### Conditional Branching (inside `run()`)

```ts
.session({
  name: "triage-and-act",
  description: "Triage, then branch based on result",
  run: async (ctx) => {
    // Step 1: Triage
    const triageResult = await claudeQuery({
      paneId: ctx.paneId,
      prompt: `Classify this request as "bug", "feature", or "question":\n${ctx.userPrompt}`,
    });

    // Step 2: Branch based on classification
    if (triageResult.output.includes("bug")) {
      await claudeQuery({ paneId: ctx.paneId, prompt: "Fix the bug described above." });
    } else if (triageResult.output.includes("feature")) {
      await claudeQuery({ paneId: ctx.paneId, prompt: "Implement the feature described above." });
    } else {
      await claudeQuery({ paneId: ctx.paneId, prompt: "Research and answer the question above." });
    }

    ctx.save(ctx.sessionId);
  },
})
```

### Data Passing Between Sessions

```ts
defineWorkflow({ name: "data-flow", description: "Pass data between sessions" })
  .session({
    name: "research",
    run: async (ctx) => {
      // ... perform research ...
      ctx.save(ctx.sessionId); // Save transcript
    },
  })
  .session({
    name: "synthesize",
    run: async (ctx) => {
      // Read prior session's output
      const research = await ctx.transcript("research");
      // Use as rendered text:
      const prompt = `Synthesize this research:\n${research.content}`;
      // Or reference the file path:
      const altPrompt = `Read ${research.path} and synthesize the findings.`;
      // ... use the data ...
      ctx.save(ctx.sessionId);
    },
  })
  .compile();
```

### Shared Helper Functions

Extract SDK-agnostic logic into shared helpers for reuse across agents:

```
.atomic/workflows/
├── claude/my-workflow/index.ts     # Claude-specific SDK code
├── copilot/my-workflow/index.ts    # Copilot-specific SDK code
├── opencode/my-workflow/index.ts   # OpenCode-specific SDK code
└── my-workflow/helpers/
    ├── prompts.ts                  # Prompt builders (SDK-agnostic)
    ├── parsers.ts                  # Response parsers (SDK-agnostic)
    └── validation.ts              # Validation logic (SDK-agnostic)
```

```ts
// .atomic/workflows/my-workflow/helpers/prompts.ts
export function buildPlanPrompt(spec: string): string {
  return `Decompose this into tasks:\n${spec}`;
}

// .atomic/workflows/claude/my-workflow/index.ts
import { buildPlanPrompt } from "../../my-workflow/helpers/prompts.ts";
// ...
await claudeQuery({ paneId: ctx.paneId, prompt: buildPlanPrompt(ctx.userPrompt) });
```

## `SessionContext` Reference

The `SessionContext` object is passed to each session's `run()` callback:

| Field | Type | Description |
|-------|------|-------------|
| `serverUrl` | `string` | The agent's server URL (Copilot `--ui-server` / OpenCode built-in server) |
| `userPrompt` | `string` | The original user prompt from the CLI invocation |
| `agent` | `AgentType` | Which agent is running (`"claude"`, `"copilot"`, or `"opencode"`) |
| `transcript(name)` | `(name: string) => Promise<Transcript>` | Get a prior session's transcript as `{ path, content }` |
| `getMessages(name)` | `(name: string) => Promise<SavedMessage[]>` | Get a prior session's raw native messages |
| `save` | `SaveTranscript` | Save this session's output for subsequent sessions |
| `sessionDir` | `string` | Path to this session's storage directory on disk |
| `paneId` | `string` | tmux pane ID for this session |
| `sessionId` | `string` | Session UUID |

### `ctx.save()` — Provider-Specific

- **Claude**: `ctx.save(ctx.sessionId)` — pass the session ID; transcript is auto-read
- **Copilot**: `ctx.save(await session.getMessages())` — pass `SessionEvent[]`
- **OpenCode**: `ctx.save(result.data!)` — pass the `{ info, parts }` response object

### `ctx.transcript(name)` — Rendered Text

Returns `{ path: string, content: string }` — the file path on disk and the rendered assistant text. Use `content` for embedding in prompts, or `path` for file-based triggers.

## Structural Rules

1. **Unique session names** — every `name` must be unique across all `.session()` calls.
2. **`.compile()` required** — the chain must end with `.compile()`.
3. **At least one session** — `compile()` throws if no sessions are defined.
4. **`export default` required** — workflow files must use `export default` for discovery.
5. **Forward-only data flow** — `ctx.transcript("<name>")` only has data from already-completed sessions.
