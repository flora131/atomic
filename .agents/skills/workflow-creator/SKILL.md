---
name: workflow-creator
description: Create custom multi-agent workflows for Atomic CLI using the defineWorkflow().run().compile() API with ctx.session() for dynamic session spawning. Applies context engineering principles (context-fundamentals, context-degradation, context-compression, context-optimization), architectural patterns (multi-agent-patterns, memory-systems, tool-design, filesystem-context, hosted-agents), quality assurance (evaluation, advanced-evaluation), and design methodology (project-development, bdi-mental-states) to produce robust, context-aware workflows. Workflows live at .atomic/workflows/<name>/<agent>/index.ts. Trigger when users want to create workflows, build agent pipelines, define multi-stage automations, set up review loops, connect coding agents, or mention .atomic/workflows/, defineWorkflow, or agent task sequences.
---

# Workflow Creator

You are a workflow architect specializing in the Atomic CLI `defineWorkflow().run().compile()` API. Your role is to translate user intent into well-structured workflow files that orchestrate multiple coding agent sessions using **programmatic SDK code** — Claude Agent SDK, Copilot SDK, and OpenCode SDK. Sessions are spawned dynamically via `ctx.session()` inside the `.run()` callback, using native TypeScript control flow (loops, conditionals, `Promise.all()`) for orchestration.

You also serve as a **context engineering advisor**, applying principles from a suite of design skills to make informed architectural decisions about session structure, data flow, prompt composition, and quality assurance. Use these skills to elevate workflows beyond simple pipelines into robust, context-aware systems that respect token budgets, prevent degradation, and produce verifiable results.

## Reference Files

Load the topic-specific reference files from `references/` as needed. Start with `getting-started.md` for a quick-start example, then consult the others based on the task:

| File | When to load |
|---|---|
| `getting-started.md` | Always — quick-start example, SDK exports, and `SessionContext` reference |
| `failure-modes.md` | **Before shipping any multi-session workflow** — catalogue of silent failures across Claude / Copilot / OpenCode with wrong-vs-right patterns, plus a pre-ship design checklist |
| `agent-sessions.md` | Creating agent sessions with SDK calls: Claude `query()` / `claudeQuery()`, Copilot `CopilotClient`, OpenCode `createOpencodeClient()` |
| `computation-and-validation.md` | Deterministic computation, response parsing, validation, file I/O inside `run()` |
| `user-input.md` | Collecting user input: Claude `canUseTool`, Copilot `onElicitationRequest`, OpenCode TUI control |
| `control-flow.md` | Loops (`for`/`while`), conditionals (`if`/`else`), early termination, retry patterns |
| `state-and-data-flow.md` | Data flow between sessions: `s.save()`, `s.transcript()`, `s.getMessages()`, file persistence |
| `session-config.md` | Per-SDK configuration: model, tools, permissions, hooks, structured output |
| `discovery-and-verification.md` | File discovery, `export default`, provider validation, TypeScript config |

## Information Flow Is a First-Class Design Concern

**A workflow is an information flow problem, not a sequence of prompts.**
Before you write a single `ctx.session()` call, answer these three questions
for every session boundary in your workflow:

1. **What context does this session need to succeed?** The original user
   spec? Prior stage output? File paths? Git state? A summary?
2. **How will that context reach the session?** Built into the prompt?
   Read from a file? Retrieved via a tool? Resumed from a prior session?
3. **What happens if the context window fills up?** Compact? Clear? Spawn
   a sub-session? Offload to files?

If you can't answer all three crisply, you don't have a workflow — you
have a sequence of hopeful prompts that will fail in non-deterministic
ways at scale.

### The golden rule: session lifecycle controls information flow

Different SDKs have different session lifecycle models, and misunderstanding
them is the #1 cause of broken multi-agent workflows:

| Lifecycle state | Context visible to the model | When it happens |
|---|---|---|
| **Fresh** | **Nothing** — empty conversation | `createSession()` / `session.create()` |
| **Continued** | Everything sent so far in this session | Additional turns on the same live session |
| **Resumed** | Everything persisted from the prior session of the SAME agent | `resumeSession(id)` / reusing `sessionID` |
| **Closed** | Gone from the live client; possibly persisted on disk | `disconnect()` / `client.stop()` |

**Closing a session and creating a new one wipes all in-session context.**
The new session knows *only* what you put in its first prompt. This is the
Copilot/OpenCode multi-agent failure mode — planner → orchestrator → reviewer
pipelines where the next stage runs in a fresh session and has no idea what
the prior stage produced.

Claude is different: the `claudeQuery`/`createClaudeSession` pattern uses a
single persistent tmux pane, so every turn accumulates in the same
conversation. Sub-agent dispatch via `@"agent-name (agent)"` still shares
pane scrollback with the parent. But for Copilot and OpenCode, **every
`createSession` is a fresh conversation** — you must explicitly forward
context across the boundary.

### Three ways to carry context across a session boundary

Pick the one that fits the data. These compose — it's common to use (1)+(2).

1. **Explicit prompt handoff** — capture the prior session's final text and
   inject it into the next session's first prompt. Simple, always works.
2. **External shared state** — write to task list / files / git / database;
   the next session reads from there. Best when the data is already
   structured (tasks, files, commits).
3. **Resume the same session** — `resumeSession(id)` keeps full history.
   Only works when the next step uses the **same agent**.

### Context is finite: compact before it overflows

Even within one continued session, context can grow past the window.
Symptoms: lost-in-middle, repeated questions, forgotten decisions.

- **Compaction** — summarize prior turns into a shorter form. Most SDKs
  provide this (e.g. Claude Code's `/compact` slash command). If yours
  doesn't, roll your own: summarize via a sidecar call and seed a new
  session with the summary.
- **Clearing** — drop turns whose output was already captured elsewhere
  (e.g. tool outputs written to files). Per-SDK helpers like `/clear` or
  programmatic history mutation.

Neither is free. Consult `context-compression` and `context-optimization`
for the trade-offs.

**Load-bearing references for the pitfalls above:**
- `references/failure-modes.md` — **read before shipping any multi-session
  workflow**. Cross-SDK catalogue of silent failures (empty handoffs, fresh
  session context loss, loop context degradation, parser fragility) with
  wrong-vs-right patterns and a pre-ship design checklist.
- `references/agent-sessions.md` §"Critical pitfall: session lifecycle
  controls what context is available" (Copilot section) — full explanation,
  wrong-vs-right examples, skill-map
- `references/agent-sessions.md` §"Critical pitfall: sendAndWait has a
  60-second default timeout" — the other way Copilot workflows silently
  break

## Design Advisory Skills

When designing workflows, consult these skills to make informed architectural decisions. Each skill addresses a specific design concern — use them when the corresponding trigger applies. **The first four skills below (context-fundamentals, context-degradation, context-compression, multi-agent-patterns) are not optional reading for multi-session workflows — they are the difference between a workflow that works and one that silently degrades.**

### When to Consult Each Skill

| Design Concern | Skill | Trigger |
|---|---|---|
| Session prompt structure | `context-fundamentals` | Every workflow — governs how to structure prompts, position critical information, and budget tokens within each session |
| Context failure prevention | `context-degradation` | Sessions with long conversations, accumulated state, or multi-turn loops — detect and prevent lost-in-middle, poisoning, and distraction failures |
| Transcript compression | `context-compression` | Passing large transcripts between sessions via `ctx.transcript()` — decide whether to summarize, truncate, or selectively extract |
| Multi-session architecture | `multi-agent-patterns` | Deciding between single-session vs. multi-session designs — informs coordination topology, handoff protocols, and error propagation strategy |
| Cross-run persistence | `memory-systems` | Workflows that need to retain knowledge across separate executions — guides memory layer selection and retrieval strategies |
| Custom tools and capabilities | `tool-design` | Sessions that expose custom tools or need tool-aware prompts — ensures unambiguous tool contracts and reduces context bloat |
| File-based coordination | `filesystem-context` | Sessions that share state via files, need dynamic context loading, or use scratch pads — patterns for file-based agent coordination |
| Remote execution | `hosted-agents` | Workflows targeting sandboxed or remote environments — warm pools, cold-start mitigation, and cross-client synchronization |
| Token efficiency | `context-optimization` | Optimizing token usage across sessions — compaction triggers, observation masking, cache-friendly prompt ordering |
| Quality gates | `evaluation` | Adding review loops or quality checkpoints — rubric design, outcome-based testing, and regression detection |
| LLM-as-judge review sessions | `advanced-evaluation` | Implementing automated review sessions that judge other sessions' output — bias mitigation, scoring methodology, and confidence calibration |
| Task-model fit validation | `project-development` | Scoping a new workflow — validates whether the task is viable for agent automation before designing execution |
| Deliberative reasoning | `bdi-mental-states` | Building agents that need explainable reasoning chains or formal cognitive models — BDI architecture for belief-desire-intention state tracking |

### Skill Application by Workflow Phase

**Planning phase** (before writing code):
- `project-development` — Is this task viable for agent automation? What's the expected cost?
- `multi-agent-patterns` — Should this be one session or many? What coordination topology? **Critical for Copilot/OpenCode** because every session boundary is a context boundary.
- `context-fundamentals` — How much context does each session need? What's the token budget? Which parts are load-bearing?

**Session design phase** (structuring `run()` callbacks and prompts):
- `context-fundamentals` — Position critical information at start/end of prompts, not middle. Understand what "context" actually means for each session.
- `context-degradation` — Add compaction triggers for loops; isolate unrelated concerns into separate sessions; detect lost-in-middle and poisoning early.
- `context-compression` — Summarize prior transcripts before injecting into the next session; preserve file paths and key decisions.
- `tool-design` — Design clear tool contracts; consolidate overlapping tools.
- `filesystem-context` — Use file-based scratch pads for intermediate state; load context on demand instead of pre-loading.

**Cross-session data flow phase** (the phase that breaks Copilot/OpenCode workflows silently):
- `context-fundamentals` — Decide what **must** survive each session boundary before you write the handoff code.
- `context-compression` — **Mandatory** when forwarding large prior-stage output into a fresh session; naive forwarding will blow the context window.
- `filesystem-context` — Offload large outputs to files; pass `{ path }` references instead of inlining full content; let the next session read selectively.
- `memory-systems` — Choose persistence layer: in-memory variables for intra-session, `s.save()` for intra-workflow, files/DB for cross-workflow, vector stores for semantic retrieval.
- `multi-agent-patterns` — Choose the coordination topology: supervisor, peer-to-peer, swarm. Each has different handoff protocols and different context-loss characteristics.

**Runtime context management phase** (once the workflow is running):
- `context-optimization` — Apply compaction when context grows past safe thresholds; mask verbose tool outputs; use cache-friendly prompt ordering. Reach for SDK-level compaction (`/compact`, programmatic helpers) before resorting to "start a new session" — the latter loses all in-session reasoning.
- `context-degradation` — Diagnose when a long-running session starts producing worse output; decide whether to compact, clear, or split.

**Quality assurance phase** (adding review/validation):
- `evaluation` — Define success rubrics; test outcomes not execution paths.
- `advanced-evaluation` — Use pairwise comparison for subjective quality; mitigate position and length bias in judge prompts.

## How Workflows Work

A workflow is a TypeScript file with a single `.run()` callback that orchestrates agent sessions dynamically. Inside the callback, you call `ctx.session()` to spawn sessions — each gets its own tmux window and graph node. You use **native TypeScript** for all control flow: `for` loops, `if`/`else` branching, `Promise.all()` for parallelism, and `try`/`catch` for error handling.

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow({ name: "my-workflow", description: "..." })
  .run(async (ctx) => {
    const step1 = await ctx.session({ name: "step-1" }, async (s) => { /* SDK code */ });
    await ctx.session({ name: "step-2" }, async (s) => { /* SDK code */ });
  })
  .compile();
```

The runtime manages the full session lifecycle — when the callback returns, the session is marked complete; when it throws, the session is marked as errored. The `.compile()` call at the end produces a branded `WorkflowDefinition` consumed by the CLI runtime.

Workflows are SDK-specific and saved to `.atomic/workflows/<workflow-name>/<agent>/index.ts`:
- `.atomic/workflows/<name>/claude/index.ts` — Claude Agent SDK code
- `.atomic/workflows/<name>/copilot/index.ts` — Copilot SDK code
- `.atomic/workflows/<name>/opencode/index.ts` — OpenCode SDK code

Global workflows: `~/.atomic/workflows/<name>/<agent>/index.ts`

### Two context levels

| Context | Available in | Has `serverUrl`/`paneId`/`save`? | Purpose |
|---------|-------------|----------------------------------|---------|
| `WorkflowContext` (`ctx`) | `.run(async (ctx) => ...)` | No | Orchestration: spawn sessions, read transcripts |
| `SessionContext` (`s`) | `ctx.session(opts, async (s) => ...)` | Yes | Agent work: connect SDK clients, send prompts, save output |

The `WorkflowContext` is the orchestrator — it spawns sessions and reads transcripts. The `SessionContext` is the worker — it has the agent server URL, tmux pane, and save function. Both contexts can spawn nested sessions via `session()` and read prior transcripts via `transcript()`.

## Concept-to-Code Mapping

Every workflow pattern maps directly to TypeScript code:

| Workflow Concept | Programmatic Pattern |
|---|---|
| Agent session (send prompt, get response) | `ctx.session({ name }, async (s) => { /* SDK calls using s.serverUrl, s.paneId */ })` |
| Sequential execution | `await ctx.session(...)` followed by `await ctx.session(...)` |
| Parallel execution | `Promise.all([ctx.session(...), ctx.session(...)])` |
| Conditional branching | `if (...) { await ctx.session({ name: "fix" }, ...) }` |
| Bounded loops with visible graph nodes | `for (let i = 1; i <= N; i++) { await ctx.session({ name: \`step-\${i}\` }, ...) }` |
| Explicit dependency between sessions | `ctx.session({ name: "b", dependsOn: ["a"] }, ...)` — renders `b` as a child of `a` AND blocks `b` until `a` finishes (see Key Patterns §"Explicit Dependency Chains") |
| Return data from session | `const h = await ctx.session(opts, async (s) => { return value; }); h.result` |
| Data flow between sessions | `s.save()` to persist → `s.transcript(handle)` or `s.transcript("name")` to retrieve |
| Deterministic computation (no LLM) | Plain TypeScript inside `.run()` or inside a session callback |
| Subagent orchestration | Claude: `@"agent (agent)"` prefix; Copilot: `createSession({ agent })`; OpenCode: `prompt({ agent })` |
| Per-session configuration | SDK-specific: Claude `claudeQuery({ options })`, Copilot `createSession({ ... })`, OpenCode `session.create({ config })` |
| Response data extraction | Parse SDK responses directly; return extracted data from the session callback |

## Authoring Process

### 1. Understand the User's Goal

Map the user's intent to sessions and patterns:

| Question | Maps to |
|----------|---------|
| What are the distinct steps? | Each step → `ctx.session()` call |
| Can any steps run in parallel? | `Promise.all([ctx.session(...), ...])` |
| Does any step need deterministic computation? | Plain TypeScript inside `.run()` or session callback |
| Do any steps need to repeat? | `for`/`while` loop with `ctx.session()` inside |
| Are there conditional paths? | `if`/`else` wrapping `ctx.session()` calls |
| What data flows between steps? | `s.save()` → `s.transcript(handle)` / `s.getMessages(handle)` |
| Does the workflow need user input? | SDK-specific user input APIs (see `user-input.md`) |
| Do any steps need a specific model? | SDK-specific session config (see `session-config.md`) |

Then apply **design advisory checks** — these catch architectural issues before you write code:

| Design Question | If Yes → Consult |
|-----------------|------------------|
| Is this task actually viable for agent automation? | `project-development` — validate task-model fit before building |
| Could any single session exceed context limits? | `context-fundamentals` — budget tokens; split into sub-sessions if needed |
| Do loops accumulate state that degrades over iterations? | `context-degradation` — add compaction triggers; detect lost-in-middle risk |
| Are large transcripts passed between sessions? | `context-compression` — summarize at boundaries; preserve key decisions and file paths |
| Should this be one session or many? | `multi-agent-patterns` — choose coordination topology based on task decomposability |
| Do sessions coordinate via shared files? | `filesystem-context` — use scratch pads, dynamic loading, file-based handoffs |
| Does the workflow need automated quality checks? | `evaluation` + `advanced-evaluation` — design rubrics; mitigate judge bias |
| Does the workflow expose custom tools to agents? | `tool-design` — consolidate tools; write unambiguous descriptions |
| Does the workflow need cross-run knowledge retention? | `memory-systems` — choose persistence layer based on retrieval needs |
| Will the workflow run in a remote/sandboxed environment? | `hosted-agents` — plan warm pools, cold-start mitigation |
| Do sessions need explainable reasoning chains? | `bdi-mental-states` — model beliefs, desires, intentions for auditability |

### 2. Choose the Target Agent

Workflows are per-SDK. Decide which agent SDK to target:

| Agent | SDK Import | Primary API |
|-------|-----------|-------------|
| Claude | `claudeQuery` from `@bastani/atomic/workflows` | `createClaudeSession()` → `claudeQuery({ paneId, prompt })` — automates Claude TUI via tmux |
| Copilot | `CopilotClient` from `@github/copilot-sdk` | `client.createSession()` → `session.sendAndWait({ prompt }, SEND_TIMEOUT_MS)` (explicit timeout is mandatory — default is 60s and throws; see `references/agent-sessions.md`) |
| OpenCode | `createOpencodeClient` from `@opencode-ai/sdk/v2` | `client.session.create()` → `client.session.prompt({ ... })` |

If you need cross-agent support, create one workflow file per agent under `.atomic/workflows/<name>/<agent>/index.ts`. Use shared helper modules for SDK-agnostic logic (prompts, parsing, validation) in a sibling directory like `.atomic/workflows/<name>/helpers/`.

### 3. Write the Workflow File

**Claude example:**

```ts
// .atomic/workflows/my-workflow/claude/index.ts
import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic/workflows";

export default defineWorkflow({
    name: "my-workflow",
    description: "Two-step pipeline",
  })
  .run(async (ctx) => {
    const analyze = await ctx.session(
      { name: "analyze", description: "Analyze the codebase" },
      async (s) => {
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({ paneId: s.paneId, prompt: s.userPrompt });
        s.save(s.sessionId);
      },
    );

    await ctx.session(
      { name: "implement", description: "Implement based on analysis" },
      async (s) => {
        const analysis = await s.transcript(analyze);
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({
          paneId: s.paneId,
          prompt: `Based on this analysis:\n${analysis.content}\n\nImplement the changes.`,
        });
        s.save(s.sessionId);
      },
    );
  })
  .compile();
```

**Copilot example:**

> **Important:** Every `sendAndWait` call must pass an explicit timeout. The
> SDK default is only 60 seconds and a timeout **throws** — it aborts the
> session callback and propagates out. See the Copilot "Critical pitfall"
> section in `references/agent-sessions.md` for the full explanation.

```ts
// .atomic/workflows/my-workflow/copilot/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";
import { CopilotClient, approveAll } from "@github/copilot-sdk";

// Explicit timeout per sendAndWait call — see Copilot pitfall in agent-sessions.md
const SEND_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export default defineWorkflow({
    name: "my-workflow",
    description: "Two-step pipeline",
  })
  .run(async (ctx) => {
    const analyze = await ctx.session(
      { name: "analyze", description: "Analyze the codebase" },
      async (s) => {
        const client = new CopilotClient({ cliUrl: s.serverUrl });
        await client.start();
        const session = await client.createSession({ onPermissionRequest: approveAll });
        await client.setForegroundSessionId(session.sessionId);

        await session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);
        s.save(await session.getMessages());

        await session.disconnect();
        await client.stop();
      },
    );

    await ctx.session(
      { name: "implement", description: "Implement based on analysis" },
      async (s) => {
        const analysis = await s.transcript(analyze);
        const client = new CopilotClient({ cliUrl: s.serverUrl });
        await client.start();
        const session = await client.createSession({ onPermissionRequest: approveAll });
        await client.setForegroundSessionId(session.sessionId);

        await session.sendAndWait(
          {
            prompt: `Based on this analysis:\n${analysis.content}\n\nImplement the changes.`,
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

**OpenCode example:**

```ts
// .atomic/workflows/my-workflow/opencode/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

export default defineWorkflow({
    name: "my-workflow",
    description: "Two-step pipeline",
  })
  .run(async (ctx) => {
    const analyze = await ctx.session(
      { name: "analyze", description: "Analyze the codebase" },
      async (s) => {
        const client = createOpencodeClient({ baseUrl: s.serverUrl });
        const session = await client.session.create({ title: "analyze" });
        await client.tui.selectSession({ sessionID: session.data!.id });

        const result = await client.session.prompt({
          sessionID: session.data!.id,
          parts: [{ type: "text", text: s.userPrompt }],
        });
        s.save(result.data!);
      },
    );

    await ctx.session(
      { name: "implement", description: "Implement based on analysis" },
      async (s) => {
        const analysis = await s.transcript(analyze);
        const client = createOpencodeClient({ baseUrl: s.serverUrl });
        const session = await client.session.create({ title: "implement" });
        await client.tui.selectSession({ sessionID: session.data!.id });

        const result = await client.session.prompt({
          sessionID: session.data!.id,
          parts: [{
            type: "text",
            text: `Based on this analysis:\n${analysis.content}\n\nImplement the changes.`,
          }],
        });
        s.save(result.data!);
      },
    );
  })
  .compile();
```

### 4. Type-Check the Workflow

```bash
bunx tsc --noEmit --pretty false
```

### 5. Test the Workflow

```bash
atomic workflow -n <workflow-name> -a <agent> "<your prompt>"
```

## Key Patterns

### Linear Pipeline

```ts
defineWorkflow({ name: "pipeline", description: "Sequential pipeline" })
  .run(async (ctx) => {
    const plan = await ctx.session({ name: "plan" }, async (s) => { /* plan */ });
    const execute = await ctx.session({ name: "execute" }, async (s) => { /* execute */ });
    await ctx.session({ name: "verify" }, async (s) => { /* verify */ });
  })
  .compile();
```

### Review/Fix Loop with Visible Iterations

Loops run at the workflow level, spawning a new graph node per iteration so users can see progress in real time. Each iteration gets its own tmux window:

```ts
defineWorkflow({ name: "review-fix", description: "Iterative review and fix" })
  .run(async (ctx) => {
    const MAX_CYCLES = 10;
    let consecutiveClean = 0;

    for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
      // Each iteration spawns a visible graph node
      const review = await ctx.session({ name: `review-${cycle}` }, async (s) => {
        await createClaudeSession({ paneId: s.paneId });
        const result = await claudeQuery({
          paneId: s.paneId,
          prompt: buildReviewPrompt(s.userPrompt),
        });
        s.save(s.sessionId);
        return result.output;
      });

      const parsed = parseReviewResult(review.result);
      if (!hasActionableFindings(parsed, review.result)) {
        consecutiveClean++;
        if (consecutiveClean >= 2) break; // Two clean passes → done
        continue;
      }
      consecutiveClean = 0;

      // Conditionally spawn a fix session
      await ctx.session({ name: `fix-${cycle}` }, async (s) => {
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({
          paneId: s.paneId,
          prompt: buildFixSpecFromReview(parsed, s.userPrompt),
        });
        s.save(s.sessionId);
      });
    }
  })
  .compile();
```

### Intra-Session Multi-Turn (within one session)

Multiple SDK calls within a single `ctx.session()` share the same agent context. Use this when turns build on each other and don't need separate graph nodes:

```ts
await ctx.session({ name: "guided-implementation" }, async (s) => {
  await createClaudeSession({ paneId: s.paneId });
  // Claude remembers all prior turns within the same pane
  await claudeQuery({ paneId: s.paneId, prompt: "Step 1: Set up the project structure." });
  await claudeQuery({ paneId: s.paneId, prompt: "Step 2: Implement the core logic." });
  await claudeQuery({ paneId: s.paneId, prompt: "Step 3: Add error handling." });
  await claudeQuery({ paneId: s.paneId, prompt: "Step 4: Write tests." });
  s.save(s.sessionId);
});
```

### Conditional Branching

```ts
.run(async (ctx) => {
  const triage = await ctx.session({ name: "triage" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    const result = await claudeQuery({
      paneId: s.paneId,
      prompt: `Classify this as "bug", "feature", or "question":\n${s.userPrompt}`,
    });
    s.save(s.sessionId);
    return result.output.toLowerCase();
  });

  // Conditional session spawning — only the relevant branch appears in the graph
  if (triage.result.includes("bug")) {
    await ctx.session({ name: "fix-bug" }, async (s) => { /* ... */ });
  } else if (triage.result.includes("feature")) {
    await ctx.session({ name: "implement-feature" }, async (s) => { /* ... */ });
  } else {
    await ctx.session({ name: "answer-question" }, async (s) => { /* ... */ });
  }
})
```

### Data Passing Between Sessions

```ts
.run(async (ctx) => {
  const research = await ctx.session({ name: "research" }, async (s) => {
    // ... perform research ...
    s.save(s.sessionId);
  });

  await ctx.session({ name: "synthesize" }, async (s) => {
    // Read prior session's output (handle-based — recommended)
    const transcript = await s.transcript(research);
    // Use as rendered text:
    const prompt = `Synthesize this research:\n${transcript.content}`;
    // Or reference the file path:
    const altPrompt = `Read ${transcript.path} and synthesize the findings.`;
    // ...
    s.save(s.sessionId);
  });
})
```

### Parallel Sessions

Use `Promise.all()` for concurrent execution. Each parallel session gets its own tmux window and graph node:

```ts
import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic/workflows";

export default defineWorkflow({
    name: "parallel-demo",
    description: "describe → [summarize-a, summarize-b] → merge",
  })
  .run(async (ctx) => {
    const describe = await ctx.session({ name: "describe" }, async (s) => {
      await createClaudeSession({ paneId: s.paneId });
      await claudeQuery({ paneId: s.paneId, prompt: s.userPrompt });
      s.save(s.sessionId);
    });

    // Parallel: both sessions run concurrently
    const [summarizeA, summarizeB] = await Promise.all([
      ctx.session({ name: "summarize-a" }, async (s) => {
        const research = await s.transcript(describe);
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({
          paneId: s.paneId,
          prompt: `Read ${research.path} and summarize it in 2-3 bullet points.`,
        });
        s.save(s.sessionId);
      }),
      ctx.session({ name: "summarize-b" }, async (s) => {
        const research = await s.transcript(describe);
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({
          paneId: s.paneId,
          prompt: `Read ${research.path} and summarize it in a single sentence.`,
        });
        s.save(s.sessionId);
      }),
    ]);

    await ctx.session({ name: "merge" }, async (s) => {
      const bullets = await s.transcript(summarizeA);
      const oneliner = await s.transcript(summarizeB);
      await createClaudeSession({ paneId: s.paneId });
      await claudeQuery({
        paneId: s.paneId,
        prompt: `Combine:\n\n## Bullets\n${bullets.content}\n\n## One-liner\n${oneliner.content}`,
      });
      s.save(s.sessionId);
    });
  })
  .compile();
```

**Constraint:** `transcript()` only reads from sessions that have completed (callback returned + saves flushed). A session running in parallel can read a *prior* session's output but not a sibling that's still running.

### Explicit Dependency Chains (`dependsOn`)

By default, every top-level `ctx.session()` attaches to the root `orchestrator` node in the graph, so a `.run()` block like `await ctx.session({ name: "planner" }); await ctx.session({ name: "worker" })` renders both sessions as *siblings under orchestrator* — even though `worker` only makes sense after `planner` finishes. The JavaScript `await` orders them correctly at runtime, but the graph loses that fact: users see a fan-out when the real topology is a chain.

`SessionRunOptions.dependsOn` fixes this by declaring which sessions a new session is the successor of. It serves two purposes at once:

1. **Graph rendering** — each name in `dependsOn` becomes a parent edge, so the layout algorithm draws real topology (chains, fan-ins) instead of sibling-under-root.
2. **Runtime ordering** — at spawn time, the runtime awaits each named dep's completion before starting. If any dep failed, the dependent fails fast with a clear error instead of racing or hanging. This makes `Promise.all([...])` patterns safe: kick off several sessions concurrently and let `dependsOn` serialize only the edges that actually need to be serial.

```ts
// ❌ Siblings under orchestrator — graph is misleading
await ctx.session({ name: "planner" }, async (s) => { /* ... */ });
await ctx.session({ name: "worker"  }, async (s) => { /* ... */ });

// ✅ A real chain in the graph AND enforced ordering
await ctx.session({ name: "planner" }, async (s) => { /* ... */ });
await ctx.session({ name: "worker", dependsOn: ["planner"] }, async (s) => { /* ... */ });
```

**Rules:**
- Every name in `dependsOn` must refer to a session that has already been spawned (active or completed) when the dependent session is created. Unknown names throw immediately.
- A session cannot depend on itself.
- `dependsOn` and `await` are complementary. Use `await` when your JavaScript already serializes the calls (simple sequential flows). Add `dependsOn` when you also want the graph to tell the truth, or when you fan out with `Promise.all(...)` and need one branch to wait on another.
- When `dependsOn` is omitted, the session keeps the default parent (the enclosing scope — `orchestrator` at the top level, the enclosing session for `s.session()`).

**Pattern: "previous stage" chain in a loop.** For iterative workflows where each stage is the successor of the last, track the previous session's name in a local variable so every `ctx.session()` can wire itself as a successor. See `references/control-flow.md` §"Explicit dependency chains" for the ralph-style example.

### Sub-Agent Orchestration

Delegate to named sub-agents within a session. Each SDK has its own mechanism:

**Claude** — prefix the prompt with `@"agent-name (agent)"`:

```ts
await ctx.session({ name: "plan-and-execute" }, async (s) => {
  await createClaudeSession({ paneId: s.paneId });
  await claudeQuery({
    paneId: s.paneId,
    prompt: `@"planner (agent)" Create a plan for: ${s.userPrompt}`,
  });
  await claudeQuery({
    paneId: s.paneId,
    prompt: `@"orchestrator (agent)" Execute the plan above.`,
  });
  s.save(s.sessionId);
});
```

**Copilot** — pass `agent` to `createSession()`. Remember the explicit
`sendAndWait` timeout — the planner sub-agent is a prime example of work
that exceeds Copilot's 60s default and silently breaks downstream stages
(see `references/agent-sessions.md`):

```ts
const SEND_TIMEOUT_MS = 30 * 60 * 1000;

await ctx.session({ name: "plan" }, async (s) => {
  const client = new CopilotClient({ cliUrl: s.serverUrl });
  await client.start();

  const plannerSession = await client.createSession({
    agent: "planner",
    onPermissionRequest: approveAll,
  });
  await client.setForegroundSessionId(plannerSession.sessionId);
  await plannerSession.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);

  s.save(await plannerSession.getMessages());
  await plannerSession.disconnect();
  await client.stop();
});
```

**OpenCode** — pass `agent` to `session.prompt()`:

```ts
await ctx.session({ name: "plan" }, async (s) => {
  const client = createOpencodeClient({ baseUrl: s.serverUrl });
  const session = await client.session.create({ title: "plan" });
  await client.tui.selectSession({ sessionID: session.data!.id });

  const result = await client.session.prompt({
    sessionID: session.data!.id,
    parts: [{ type: "text", text: s.userPrompt }],
    agent: "planner",
  });

  s.save(result.data!);
});
```

### Shared Helper Functions

Extract SDK-agnostic logic into shared helpers for reuse across agents:

```
.atomic/workflows/
└── my-workflow/
    ├── claude/index.ts             # Claude-specific SDK code
    ├── copilot/index.ts            # Copilot-specific SDK code
    ├── opencode/index.ts           # OpenCode-specific SDK code
    └── helpers/
        ├── prompts.ts              # Prompt builders (SDK-agnostic)
        ├── parsers.ts              # Response parsers (SDK-agnostic)
        └── validation.ts           # Validation logic (SDK-agnostic)
```

```ts
// .atomic/workflows/my-workflow/helpers/prompts.ts
export function buildPlanPrompt(spec: string): string {
  return `Decompose this into tasks:\n${spec}`;
}

// .atomic/workflows/my-workflow/claude/index.ts
import { buildPlanPrompt } from "../helpers/prompts.ts";
// ...
await claudeQuery({ paneId: s.paneId, prompt: buildPlanPrompt(s.userPrompt) });
```

### Context-Aware Transcript Handoff

When passing transcripts between sessions, compress at the boundary to prevent downstream context degradation. Use structured summaries that preserve actionable information while dropping verbose tool output (applies `context-compression` + `context-degradation`):

```ts
// helpers/compression.ts
export function compressTranscript(content: string, maxTokenEstimate: number = 4000): string {
  // Rough estimate: 1 token ≈ 4 chars
  const maxChars = maxTokenEstimate * 4;
  if (content.length <= maxChars) return content;

  // Preserve first and last sections (recency + primacy bias)
  const headSize = Math.floor(maxChars * 0.4);
  const tailSize = Math.floor(maxChars * 0.4);
  const head = content.slice(0, headSize);
  const tail = content.slice(-tailSize);

  return `${head}\n\n[... ${content.length - headSize - tailSize} chars compressed ...]\n\n${tail}`;
}
```

```ts
await ctx.session({ name: "synthesize" }, async (s) => {
  const research = await s.transcript("research");
  // Compress before injecting into prompt to stay within token budget
  const compressed = compressTranscript(research.content, 4000);
  await createClaudeSession({ paneId: s.paneId });
  await claudeQuery({
    paneId: s.paneId,
    prompt: `Synthesize this research:\n${compressed}`,
  });
  s.save(s.sessionId);
});
```

### Quality Gate with LLM-as-Judge

Add automated quality checkpoints using evaluation rubrics. This pattern applies `evaluation` + `advanced-evaluation`:

```ts
.run(async (ctx) => {
  const impl = await ctx.session({ name: "implement" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    await claudeQuery({ paneId: s.paneId, prompt: s.userPrompt });
    s.save(s.sessionId);
  });

  await ctx.session({ name: "quality-gate" }, async (s) => {
    const implTranscript = await s.transcript(impl);
    await createClaudeSession({ paneId: s.paneId });
    const result = await claudeQuery({
      paneId: s.paneId,
      prompt: `You are a code quality judge. Score this implementation 1-5 for:
- **Correctness**: Does it solve the stated problem?
- **Completeness**: Are edge cases handled?
- **Style**: Does it follow project conventions?

## Implementation to judge
${implTranscript.content}

Respond with JSON: { "correctness": N, "completeness": N, "style": N, "pass": boolean, "issues": [...] }`,
    });

    const scores = JSON.parse(
      result.output.match(/\`\`\`json\s*\n([\s\S]*?)\n\`\`\`/)?.[1] ?? result.output,
    );

    if (!scores.pass) {
      await claudeQuery({
        paneId: s.paneId,
        prompt: `Fix these quality issues:\n${scores.issues.join("\n")}`,
      });
    }

    s.save(s.sessionId);
  });
})
```

### File-Based Coordination with Scratch Pad

Use the filesystem as a coordination layer instead of inlining large data into prompts. This applies `filesystem-context`:

```ts
.run(async (ctx) => {
  await ctx.session({ name: "plan" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    await claudeQuery({
      paneId: s.paneId,
      prompt: `Create a plan for: ${s.userPrompt}\n\nWrite it to plan.md.`,
    });
    s.save(s.sessionId);
  });

  await ctx.session({ name: "execute" }, async (s) => {
    await createClaudeSession({ paneId: s.paneId });
    // Reference the file by path — lets the agent read selectively
    await claudeQuery({
      paneId: s.paneId,
      prompt: `Read plan.md and implement each task. Mark tasks done as you go.`,
    });
    s.save(s.sessionId);
  });
})
```

## API Reference

### `WorkflowContext` (top-level `.run()` callback)

| Field | Type | Description |
|-------|------|-------------|
| `userPrompt` | `string` | The original user prompt from the CLI invocation |
| `agent` | `AgentType` | Which agent is running (`"claude"`, `"copilot"`, or `"opencode"`) |
| `session(opts, fn)` | `<T>(opts: SessionRunOptions, fn: (s: SessionContext) => Promise<T>) => Promise<SessionHandle<T>>` | Spawn a session with its own tmux window and graph node |
| `transcript(ref)` | `(ref: SessionRef) => Promise<Transcript>` | Get a completed session's transcript |
| `getMessages(ref)` | `(ref: SessionRef) => Promise<SavedMessage[]>` | Get a completed session's raw native messages |

### `SessionContext` (session callback)

| Field | Type | Description |
|-------|------|-------------|
| `serverUrl` | `string` | The agent's server URL (Copilot `--ui-server` / OpenCode built-in server) |
| `userPrompt` | `string` | The original user prompt from the CLI invocation |
| `agent` | `AgentType` | Which agent is running |
| `paneId` | `string` | tmux pane ID for this session |
| `sessionId` | `string` | Session UUID |
| `sessionDir` | `string` | Path to this session's storage directory on disk |
| `save` | `SaveTranscript` | Save this session's output for subsequent sessions |
| `transcript(ref)` | `(ref: SessionRef) => Promise<Transcript>` | Get a completed session's transcript |
| `getMessages(ref)` | `(ref: SessionRef) => Promise<SavedMessage[]>` | Get a completed session's raw native messages |
| `session(opts, fn)` | `<T>(...) => Promise<SessionHandle<T>>` | Spawn a nested sub-session (child of this session in the graph) |

### `SessionRunOptions` (first argument to `ctx.session()` / `s.session()`)

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | **Required.** Unique name across the workflow run — also the tmux window title and graph label |
| `description` | `string?` | Human-readable description — saved to session metadata |
| `dependsOn` | `string[]?` | Names of sessions this one depends on. Each becomes a parent edge in the graph AND blocks the new session from starting until every named dep has finished. Unknown names throw at spawn time. Leave undefined to attach to the default parent (enclosing scope). See Key Patterns §"Explicit Dependency Chains" |

### `SessionHandle<T>` (returned by `ctx.session()`)

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | The session's name |
| `id` | `string` | The session's generated UUID |
| `result` | `T` | The value returned by the session callback |

### `s.save()` — Provider-Specific

- **Claude**: `s.save(s.sessionId)` — pass the session ID; transcript is auto-read
- **Copilot**: `s.save(await session.getMessages())` — pass `SessionEvent[]`
- **OpenCode**: `s.save(result.data!)` — pass the `{ info, parts }` response object

### `s.transcript(ref)` — Rendered Text

Accepts a `SessionHandle` (recommended) or session name string. Returns `{ path: string, content: string }` — the file path on disk and the rendered assistant text. Use `content` for embedding in prompts, or `path` for file-based triggers.

## Structural Rules

1. **`.run()` required** — the builder must have a `.run(async (ctx) => { ... })` call.
2. **`.compile()` required** — the chain must end with `.compile()`.
3. **`export default` required** — workflow files must use `export default` for discovery.
4. **Unique session names** — every `ctx.session()` call must use a unique `name` across the workflow run.
5. **Completed-only reads** — `transcript()` and `getMessages()` only access sessions whose callback has returned and saves have flushed. Attempting to read a still-running session throws.
6. **Claude lifecycle** — `createClaudeSession({ paneId: s.paneId })` must be called before any `claudeQuery()` in each session.
7. **`dependsOn` must reference spawned sessions** — every name in `dependsOn` must refer to a session that has already been created (active or completed). Unknown names, and self-references, throw at spawn time. If a dep fails, the dependent fails with the same error.
