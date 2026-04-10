---
name: workflow-creator
description: Create custom multi-agent workflows for Atomic CLI using the defineWorkflow().run().compile() API with ctx.stage(opts, clientOpts, sessionOpts, callback) for dynamic session spawning with auto-init/cleanup. Applies context engineering principles (context-fundamentals, context-degradation, context-compression, context-optimization), architectural patterns (multi-agent-patterns, memory-systems, tool-design, filesystem-context, hosted-agents), quality assurance (evaluation, advanced-evaluation), and design methodology (project-development, bdi-mental-states) to produce robust, context-aware workflows. Workflows live at .atomic/workflows/<name>/<agent>/index.ts. Trigger when users want to create workflows, build agent pipelines, define multi-stage automations, set up review loops, connect coding agents, or mention .atomic/workflows/, defineWorkflow, or agent task sequences.
---

# Workflow Creator

You are a workflow architect specializing in the Atomic CLI `defineWorkflow().run().compile()` API. Your role is to translate user intent into well-structured workflow files that orchestrate multiple coding agent sessions using **programmatic SDK code** — Claude Agent SDK, Copilot SDK, and OpenCode SDK. Sessions are spawned dynamically via `ctx.stage(opts, clientOpts, sessionOpts, callback)` inside the `.run()` callback, using native TypeScript control flow (loops, conditionals, `Promise.all()`) for orchestration. The runtime auto-creates the SDK client and session, injects them as `s.client` and `s.session`, runs the callback, then auto-cleans up.

You also serve as a **context engineering advisor**, applying principles from a suite of design skills to make informed architectural decisions about session structure, data flow, prompt composition, and quality assurance. Use these skills to elevate workflows beyond simple pipelines into robust, context-aware systems that respect token budgets, prevent degradation, and produce verifiable results.

## Reference Files

Load the topic-specific reference files from `references/` based on priority. **Always load Tier 1 files.** Load Tier 2-3 files when the task requires that topic.

| Tier | File | When to load |
|---|---|---|
| **1** | `getting-started.md` | **Always** — quick-start examples for all 3 SDKs, SDK exports, `SessionContext` reference |
| **1** | `failure-modes.md` | **Always for multi-session workflows** — 15 catalogued failures (silent + loud) with wrong-vs-right patterns and a pre-ship design checklist |
| **2** | `agent-sessions.md` | When writing SDK calls — `s.session.query()` (Claude), `s.session.sendAndWait()` (Copilot), `s.client.session.prompt()` (OpenCode); includes critical pitfalls on timeouts and session lifecycle |
| **2** | `control-flow.md` | When using loops, conditionals, parallel execution, or review/fix patterns |
| **2** | `state-and-data-flow.md` | When passing data between sessions — `s.save()`, `s.transcript()`, `s.getMessages()`, file persistence, transcript compression |
| **3** | `computation-and-validation.md` | When adding deterministic computation, response parsing, validation, quality gates, or file I/O |
| **3** | `session-config.md` | When configuring model, tools, permissions, hooks, or structured output per SDK |
| **3** | `user-input.md` | When collecting user input mid-workflow — Claude `canUseTool`, Copilot `onElicitationRequest`, OpenCode TUI control |
| **3** | `discovery-and-verification.md` | When setting up workflow file structure, validation, or TypeScript config |

## Information Flow Is a First-Class Design Concern

**A workflow is an information flow problem, not a sequence of prompts.**
Before you write a single `ctx.stage()` call, answer these three questions
for every session boundary in your workflow:

1. **What context does this session need to succeed?** The original user
   spec? Prior stage output? File paths? Git state? A summary?
2. **How will that context reach the session?** Built into the prompt?
   Read from a file? Retrieved via a tool? Kept inside one continued
   multi-turn stage instead of crossing a stage boundary?
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
| **Fresh** | **Nothing** — empty conversation | Each new `ctx.stage()` call — the runtime creates a new session |
| **Continued** | Everything sent so far in this session | Additional turns within the same stage callback |
| **Closed** | Gone from the live client; persisted only through what you explicitly saved | Runtime auto-cleanup after the stage callback returns |

**Closing a session and creating a new one wipes all in-session context.**
The new session knows *only* what you put in its first prompt. This is the
Copilot/OpenCode multi-agent failure mode — planner → orchestrator → reviewer
pipelines where the next stage runs in a fresh session and has no idea what
the prior stage produced.

Claude is different: the runtime reuses a single persistent tmux pane, so every turn within a stage accumulates in the same conversation. Sub-agent dispatch via `@"agent-name (agent)"` still shares pane scrollback with the parent. But for Copilot and OpenCode, **every `ctx.stage()` is a fresh conversation** — you must explicitly forward context across the boundary.

Provider SDKs may expose resume/fork primitives for advanced same-role work,
but those are **not** the standard `ctx.stage()` handoff model. When authoring
normal workflows, assume every new stage is fresh unless you deliberately keep
the work inside one stage callback.

### Three reliable ways to avoid losing context

Pick the one that fits the data. These compose — it's common to use (1)+(2).

1. **Explicit prompt handoff** — capture the prior session's final text and
    inject it into the next session's first prompt. Simple, always works.
2. **External shared state** — write to task list / files / git / database;
    the next session reads from there. Best when the data is already
    structured (tasks, files, commits).
3. **Keep related turns in one stage callback** — if the next step needs the
    full conversation history, do not split it into another `ctx.stage()`.
    Send another turn to the same `s.session` instead. This is the idiomatic
    way to preserve context inside the workflow API.

Provider-level resume/fork can still be useful as an escape hatch for
same-role work, but treat it as advanced SDK-specific behavior rather than the
default way stages communicate.

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

## How Workflows Work

A workflow is a TypeScript file with a single `.run()` callback that orchestrates agent sessions dynamically. Inside the callback, you call `ctx.stage()` to spawn sessions — each gets its own tmux window and graph node. You use **native TypeScript** for all control flow: `for` loops, `if`/`else` branching, `Promise.all()` for parallelism, and `try`/`catch` for error handling.

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({ name: "my-workflow", description: "..." })
  .run(async (ctx) => {
    const step1 = await ctx.stage({ name: "step-1" }, {}, {}, async (s) => { /* s.client, s.session */ });
    await ctx.stage({ name: "step-2" }, {}, {}, async (s) => { /* s.client, s.session */ });
  })
  .compile();
```

The runtime manages the full session lifecycle — when the callback returns, the session is marked complete; when it throws, the session is marked as errored. The `.compile()` call at the end produces a branded `WorkflowDefinition` consumed by the CLI runtime.

Workflows are SDK-specific. User-created workflows live in a project with `@bastani/atomic` installed as a dependency, along with the native agent SDK(s) for the provider(s) you target:

```bash
bun init                                   # Create a new project
bun add @bastani/atomic                    # Install the workflow SDK
bun add @github/copilot-sdk               # For Copilot workflows
bun add @anthropic-ai/claude-agent-sdk    # For Claude workflows
bun add @opencode-ai/sdk                  # For OpenCode workflows
```

Install only the agent SDK(s) you need. The Atomic SDK manages session lifecycle (`s.client` and `s.session`), while the native SDKs provide types, utilities, and advanced APIs that you import directly (e.g., `approveAll` from `@github/copilot-sdk`, `query` from `@anthropic-ai/claude-agent-sdk`).

Then create workflow files at `.atomic/workflows/<name>/<agent>/index.ts`:
- `.atomic/workflows/<name>/claude/index.ts` — Claude Agent SDK code
- `.atomic/workflows/<name>/copilot/index.ts` — Copilot SDK code
- `.atomic/workflows/<name>/opencode/index.ts` — OpenCode SDK code

Discovery sources (highest precedence first):
- **Local**: `.atomic/workflows/<name>/<agent>/index.ts` — project-scoped
- **Global**: `~/.atomic/workflows/<name>/<agent>/index.ts` — user-global
- **Built-in**: SDK modules shipped with `@bastani/atomic` (e.g., the `ralph` workflow)

### Two context levels

| Context | Available in | Has `client`/`session`/`paneId`/`save`? | Purpose |
|---------|-------------|----------------------------------|---------|
| `WorkflowContext` (`ctx`) | `.run(async (ctx) => ...)` | No | Orchestration: spawn sessions, read transcripts |
| `SessionContext` (`s`) | `ctx.stage(opts, clientOpts, sessionOpts, async (s) => ...)` | Yes | Agent work: use `s.client` and `s.session` for SDK calls, save output |

The `WorkflowContext` is the orchestrator — it spawns sessions and reads transcripts. The `SessionContext` is the worker — it has the pre-initialized client and session, tmux pane, and save function. Both contexts can spawn nested sessions via `stage()` and read prior transcripts via `transcript()`.

### Structural Rules

These are hard constraints enforced by the builder, loader, and runtime. Violating any of them will prevent the workflow from compiling, loading, or executing correctly:

1. **`.run()` required** — the builder must have a `.run(async (ctx) => { ... })` call.
2. **`.compile()` required** — the chain must end with `.compile()`.
3. **`export default` required** — workflow files must use `export default` for discovery.
4. **Unique session names** — every `ctx.stage()` call must use a unique `name` across the workflow run.
5. **Completed-only reads** — `transcript()` and `getMessages()` only access sessions whose callback has returned and saves have flushed. Attempting to read a still-running session throws.
6. **Graph topology is auto-inferred** — the runtime derives parent-child edges from `await`/`Promise.all` patterns. Sequential `await` creates a chain; `Promise.all([...])` branches from the same parent; a stage awaited after `Promise.all` resolves receives all parallel stages as parents. No explicit dependency declarations are needed or supported.
7. **Do not manually create clients or sessions** — the runtime auto-creates `s.client` and `s.session` from `clientOpts` and `sessionOpts`. Do not call `new CopilotClient(...)`, `createOpencodeClient(...)`, `createClaudeSession(...)`, or `claudeQuery({ paneId, ... })` directly. Use `s.session.query()`, `s.session.sendAndWait()`, and `s.client.session.prompt()` instead.

## Concept-to-Code Mapping

Every workflow pattern maps directly to TypeScript code:

| Workflow Concept | Programmatic Pattern |
|---|---|
| Agent session (send prompt, get response) | `ctx.stage({ name }, {}, {}, async (s) => { /* use s.client, s.session */ })` |
| Sequential execution | `await ctx.stage(...)` followed by `await ctx.stage(...)` |
| Parallel execution | `Promise.all([ctx.stage(...), ctx.stage(...)])` |
| Conditional branching | `if (...) { await ctx.stage({ name: "fix" }, {}, {}, ...) }` |
| Bounded loops with visible graph nodes | `for (let i = 1; i <= N; i++) { await ctx.stage({ name: \`step-\${i}\` }, {}, {}, ...) }` |
| Sequential dependency (auto-inferred) | `await ctx.stage({ name: "a" }, ...); await ctx.stage({ name: "b" }, ...)` — the runtime infers `a → b` from the `await` ordering |
| Return data from session | `const h = await ctx.stage(opts, {}, {}, async (s) => { return value; }); h.result` |
| Data flow between sessions | `s.save()` to persist → `s.transcript(handle)` or `s.transcript("name")` to retrieve |
| Deterministic computation (no LLM) | Plain TypeScript inside `.run()` or inside a session callback |
| Subagent orchestration | Claude: `@"agent (agent)"` prefix in prompt; Copilot: pass `{ agent: "planner" }` as sessionOpts; OpenCode: pass `agent` in `s.client.session.prompt()` |
| Per-session configuration | Pass `clientOpts` (2nd arg) and `sessionOpts` (3rd arg) to `ctx.stage()` — auto-forwarded to client/session creation |
| Response data extraction | Parse SDK responses directly; return extracted data from the session callback |

## Authoring Process

### 1. Understand the User's Goal

Map the user's intent to sessions and patterns:

| Question | Maps to |
|----------|---------|
| What are the distinct steps? | Each step → `ctx.stage()` call |
| Can any steps run in parallel? | `Promise.all([ctx.stage(...), ...])` |
| Does any step need deterministic computation? | Plain TypeScript inside `.run()` or session callback |
| Do any steps need to repeat? | `for`/`while` loop with `ctx.stage()` inside |
| Are there conditional paths? | `if`/`else` wrapping `ctx.stage()` calls |
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

Workflows are per-SDK. Pass a type parameter to `defineWorkflow<"agent">()` to narrow all context types and get correct `s.client` / `s.session` types:

| Agent | `defineWorkflow` type | Primary API (inside callback) |
|-------|----------------------|-------------------------------|
| Claude | `defineWorkflow<"claude">` | `s.session.query(prompt)` — sends prompt to the Claude TUI pane, auto-manages session lifecycle |
| Copilot | `defineWorkflow<"copilot">` | `s.session.sendAndWait({ prompt }, SEND_TIMEOUT_MS)` — explicit timeout is mandatory (default 60s throws; see `references/agent-sessions.md`) |
| OpenCode | `defineWorkflow<"opencode">` | `s.client.session.prompt({ sessionID: s.session.id, parts: [...] })` |

The runtime manages client/session lifecycle (creating and closing `s.client` and `s.session`) automatically — do not manually create or destroy clients or sessions. For SDK-specific types, utilities, and advanced APIs beyond what `s.client` and `s.session` provide, import directly from the native SDK packages (e.g., `@github/copilot-sdk`, `@anthropic-ai/claude-agent-sdk`, `@opencode-ai/sdk/v2`).

If you need cross-agent support, create one workflow file per agent under `.atomic/workflows/<name>/<agent>/index.ts`. Use shared helper modules for SDK-agnostic logic (prompts, parsing, validation) in a sibling directory like `.atomic/workflows/<name>/helpers/`.

### 3. Write the Workflow File

**Claude example:**

```ts
// .atomic/workflows/my-workflow/claude/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
    name: "my-workflow",
    description: "Two-step pipeline",
  })
  .run(async (ctx) => {
    const analyze = await ctx.stage(
      { name: "analyze", description: "Analyze the codebase" },
      {},
      {},
      async (s) => {
        // s.session is a ClaudeSessionWrapper — auto-created by the runtime
        const result = await s.session.query(s.userPrompt);
        s.save(s.sessionId);
        return result.output;
      },
    );

    await ctx.stage(
      { name: "implement", description: "Implement based on analysis" },
      {},
      {},
      async (s) => {
        const analysis = await s.transcript(analyze);
        await s.session.query(
          `Based on this analysis:\n${analysis.content}\n\nImplement the changes.`,
        );
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
> `onPermissionRequest: approveAll` is the default when not specified in sessionOpts.

```ts
// .atomic/workflows/my-workflow/copilot/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";

// Explicit timeout per sendAndWait call — see Copilot pitfall in agent-sessions.md
const SEND_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export default defineWorkflow<"copilot">({
    name: "my-workflow",
    description: "Two-step pipeline",
  })
  .run(async (ctx) => {
    const analyze = await ctx.stage(
      { name: "analyze", description: "Analyze the codebase" },
      {},
      {},
      async (s) => {
        // s.session is a CopilotSession — auto-created by the runtime
        await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);
        s.save(await s.session.getMessages());
      },
    );

    await ctx.stage(
      { name: "implement", description: "Implement based on analysis" },
      {},
      {},
      async (s) => {
        const analysis = await s.transcript(analyze);
        await s.session.sendAndWait(
          {
            prompt: `Based on this analysis:\n${analysis.content}\n\nImplement the changes.`,
          },
          SEND_TIMEOUT_MS,
        );
        s.save(await s.session.getMessages());
      },
    );
  })
  .compile();
```

**OpenCode example:**

```ts
// .atomic/workflows/my-workflow/opencode/index.ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"opencode">({
    name: "my-workflow",
    description: "Two-step pipeline",
  })
  .run(async (ctx) => {
    const analyze = await ctx.stage(
      { name: "analyze", description: "Analyze the codebase" },
      {},
      { title: "analyze" },
      async (s) => {
        // s.client is OpencodeClient; s.session is the Session data object
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: s.userPrompt }],
        });
        s.save(result.data!);
      },
    );

    await ctx.stage(
      { name: "implement", description: "Implement based on analysis" },
      {},
      { title: "implement" },
      async (s) => {
        const analysis = await s.transcript(analyze);
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
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
defineWorkflow<"claude">({ name: "pipeline", description: "Sequential pipeline" })
  .run(async (ctx) => {
    const plan = await ctx.stage({ name: "plan" }, {}, {}, async (s) => { /* s.session.query(...) */ });
    const execute = await ctx.stage({ name: "execute" }, {}, {}, async (s) => { /* s.session.query(...) */ });
    await ctx.stage({ name: "verify" }, {}, {}, async (s) => { /* s.session.query(...) */ });
  })
  .compile();
```

### Review/Fix Loop with Visible Iterations

Loops run at the workflow level, spawning a new graph node per iteration so users can see progress in real time. Each iteration gets its own tmux window:

```ts
defineWorkflow<"claude">({ name: "review-fix", description: "Iterative review and fix" })
  .run(async (ctx) => {
    const MAX_CYCLES = 10;
    let consecutiveClean = 0;

    for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
      // Each iteration spawns a visible graph node
      const review = await ctx.stage({ name: `review-${cycle}` }, {}, {}, async (s) => {
        // s.session is auto-created by the runtime
        const result = await s.session.query(buildReviewPrompt(s.userPrompt));
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
      await ctx.stage({ name: `fix-${cycle}` }, {}, {}, async (s) => {
        await s.session.query(buildFixSpecFromReview(parsed, s.userPrompt));
        s.save(s.sessionId);
      });
    }
  })
  .compile();
```

### Intra-Session Multi-Turn (within one session)

Multiple SDK calls within a single `ctx.stage()` share the same agent context. Use this when turns build on each other and don't need separate graph nodes:

```ts
await ctx.stage({ name: "guided-implementation" }, {}, {}, async (s) => {
  // s.session is auto-created; Claude remembers all prior turns within the same pane
  await s.session.query("Step 1: Set up the project structure.");
  await s.session.query("Step 2: Implement the core logic.");
  await s.session.query("Step 3: Add error handling.");
  await s.session.query("Step 4: Write tests.");
  s.save(s.sessionId);
});
```

### Conditional Branching

```ts
.run(async (ctx) => {
  const triage = await ctx.stage({ name: "triage" }, {}, {}, async (s) => {
    const result = await s.session.query(
      `Classify this as "bug", "feature", or "question":\n${s.userPrompt}`,
    );
    s.save(s.sessionId);
    return result.output.toLowerCase();
  });

  // Conditional session spawning — only the relevant branch appears in the graph
  if (triage.result.includes("bug")) {
    await ctx.stage({ name: "fix-bug" }, {}, {}, async (s) => { /* ... */ });
  } else if (triage.result.includes("feature")) {
    await ctx.stage({ name: "implement-feature" }, {}, {}, async (s) => { /* ... */ });
  } else {
    await ctx.stage({ name: "answer-question" }, {}, {}, async (s) => { /* ... */ });
  }
})
```

### Data Passing Between Sessions

```ts
.run(async (ctx) => {
  const research = await ctx.stage({ name: "research" }, {}, {}, async (s) => {
    // ... perform research using s.session ...
    s.save(s.sessionId);
  });

  await ctx.stage({ name: "synthesize" }, {}, {}, async (s) => {
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
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
    name: "parallel-demo",
    description: "describe → [summarize-a, summarize-b] → merge",
  })
  .run(async (ctx) => {
    const describe = await ctx.stage({ name: "describe" }, {}, {}, async (s) => {
      await s.session.query(s.userPrompt);
      s.save(s.sessionId);
    });

    // Parallel: both sessions run concurrently
    const [summarizeA, summarizeB] = await Promise.all([
      ctx.stage({ name: "summarize-a" }, {}, {}, async (s) => {
        const research = await s.transcript(describe);
        await s.session.query(
          `Read ${research.path} and summarize it in 2-3 bullet points.`,
        );
        s.save(s.sessionId);
      }),
      ctx.stage({ name: "summarize-b" }, {}, {}, async (s) => {
        const research = await s.transcript(describe);
        await s.session.query(
          `Read ${research.path} and summarize it in a single sentence.`,
        );
        s.save(s.sessionId);
      }),
    ]);

    await ctx.stage({ name: "merge" }, {}, {}, async (s) => {
      const bullets = await s.transcript(summarizeA);
      const oneliner = await s.transcript(summarizeB);
      await s.session.query(
        `Combine:\n\n## Bullets\n${bullets.content}\n\n## One-liner\n${oneliner.content}`,
      );
      s.save(s.sessionId);
    });
  })
  .compile();
```

**Constraint:** `transcript()` only reads from sessions that have completed (callback returned + saves flushed). A session running in parallel can read a *prior* session's output but not a sibling that's still running.

### Graph Topology: Auto-Inferred from `await`/`Promise.all` Patterns

The runtime automatically infers the workflow graph topology from the JavaScript control flow — no explicit dependency declarations are needed.

**Sequential (`await`):** Each awaited `ctx.stage()` call creates a parent-child edge from the previous stage. Two sequential awaits produce a real chain in the graph:

```ts
// ✅ Graph infers: orchestrator → planner → worker
await ctx.stage({ name: "planner" }, {}, {}, async (s) => { /* ... */ });
await ctx.stage({ name: "worker" }, {}, {}, async (s) => { /* ... */ });
```

**Parallel (`Promise.all`):** Sessions passed to `Promise.all([...])` branch from the same parent and run concurrently — the runtime gives each a sibling edge from the enclosing scope:

```ts
// ✅ Graph infers: orchestrator → [summarize-a, summarize-b] (parallel siblings)
const [a, b] = await Promise.all([
  ctx.stage({ name: "summarize-a" }, {}, {}, async (s) => { /* ... */ }),
  ctx.stage({ name: "summarize-b" }, {}, {}, async (s) => { /* ... */ }),
]);
```

**Fan-in:** A stage awaited after a `Promise.all` resolves automatically receives all parallel stages as parents — the graph draws a merge node:

```ts
// ✅ Graph infers: [summarize-a, summarize-b] → merge
const [a, b] = await Promise.all([
  ctx.stage({ name: "summarize-a" }, {}, {}, async (s) => { /* ... */ }),
  ctx.stage({ name: "summarize-b" }, {}, {}, async (s) => { /* ... */ }),
]);
await ctx.stage({ name: "merge" }, {}, {}, async (s) => { /* ... */ });
```

**Nested sub-sessions:** `s.stage()` inside a callback automatically becomes a child of the enclosing session — no declaration needed.

These three primitives compose to express any DAG topology through ordinary TypeScript, keeping workflow code readable and the graph accurate without any extra metadata.

### Sub-Agent Orchestration

Delegate to named sub-agents within a session. Each SDK has its own mechanism:

**Claude** — prefix the prompt with `@"agent-name (agent)"`:

```ts
await ctx.stage({ name: "plan-and-execute" }, {}, {}, async (s) => {
  // s.session is auto-created; query() passes the prompt directly to the Claude TUI
  await s.session.query(`@"planner (agent)" Create a plan for: ${s.userPrompt}`);
  await s.session.query(`@"orchestrator (agent)" Execute the plan above.`);
  s.save(s.sessionId);
});
```

**Copilot** — pass `{ agent: "planner" }` as the sessionOpts (3rd arg). The runtime creates the session with `agent: "planner"` automatically. Remember the explicit `sendAndWait` timeout — the planner sub-agent is a prime example of work that exceeds Copilot's 60s default and silently breaks downstream stages (see `references/agent-sessions.md`):

```ts
const SEND_TIMEOUT_MS = 30 * 60 * 1000;

await ctx.stage({ name: "plan" }, {}, { agent: "planner" }, async (s) => {
  // s.session is a CopilotSession created with agent: "planner"
  await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);
  s.save(await s.session.getMessages());
});
```

**OpenCode** — pass `agent` to `s.client.session.prompt()`:

```ts
await ctx.stage({ name: "plan" }, {}, { title: "plan" }, async (s) => {
  // s.client is OpencodeClient; s.session is the Session data object
  const result = await s.client.session.prompt({
    sessionID: s.session.id,
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
await ctx.stage({ name: "plan" }, {}, {}, async (s) => {
  await s.session.query(buildPlanPrompt(s.userPrompt));
  s.save(s.sessionId);
});
```

### Context-Aware Transcript Handoff

When passing large transcripts between sessions, compress at the boundary to prevent context degradation. See `state-and-data-flow.md` §"Context-Aware Transcript Handoff" for the compression helper pattern and usage example. Applies `context-compression` + `context-degradation`.

### Quality Gate with LLM-as-Judge

Add automated quality checkpoints using evaluation rubrics. See `computation-and-validation.md` §"Quality Gate with LLM-as-Judge" for the full pattern with scoring, JSON parsing, and conditional fix loops. Applies `evaluation` + `advanced-evaluation`.

### File-Based Coordination with Scratch Pad

Use the filesystem as a coordination layer instead of inlining large data into prompts. See `state-and-data-flow.md` §"File-Based Coordination" for the pattern. Applies `filesystem-context`.

## API Reference

### `WorkflowContext` (top-level `.run()` callback)

| Field | Type | Description |
|-------|------|-------------|
| `userPrompt` | `string` | The original user prompt from the CLI invocation |
| `agent` | `AgentType` | Which agent is running (`"claude"`, `"copilot"`, or `"opencode"`) |
| `stage(opts, clientOpts, sessionOpts, fn)` | `<T>(opts: SessionRunOptions, clientOpts: StageClientOptions<A>, sessionOpts: StageSessionOptions<A>, fn: (s: SessionContext<A>) => Promise<T>) => Promise<SessionHandle<T>>` | Spawn a session — runtime auto-creates client+session, runs callback, auto-cleans up |
| `transcript(ref)` | `(ref: SessionRef) => Promise<Transcript>` | Get a completed session's transcript |
| `getMessages(ref)` | `(ref: SessionRef) => Promise<SavedMessage[]>` | Get a completed session's raw native messages |

### `SessionContext` (session callback)

| Field | Type | Description |
|-------|------|-------------|
| `client` | `ProviderClient<A>` | Pre-created SDK client — managed by the runtime; type resolves to the native SDK client for your agent |
| `session` | `ProviderSession<A>` | Pre-created session — managed by the runtime; type resolves to the native SDK session for your agent |
| `userPrompt` | `string` | The original user prompt from the CLI invocation |
| `agent` | `AgentType` | Which agent is running |
| `paneId` | `string` | tmux pane ID for this session |
| `sessionId` | `string` | Session UUID |
| `sessionDir` | `string` | Path to this session's storage directory on disk |
| `save` | `SaveTranscript` | Save this session's output for subsequent sessions |
| `transcript(ref)` | `(ref: SessionRef) => Promise<Transcript>` | Get a completed session's transcript |
| `getMessages(ref)` | `(ref: SessionRef) => Promise<SavedMessage[]>` | Get a completed session's raw native messages |
| `stage(opts, clientOpts, sessionOpts, fn)` | `<T>(...) => Promise<SessionHandle<T>>` | Spawn a nested sub-session (child of this session in the graph) |

### `SessionRunOptions` (first argument to `ctx.stage()` / `s.stage()`)

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | **Required.** Unique name across the workflow run — also the tmux window title and graph label |
| `description` | `string?` | Human-readable description — saved to session metadata |

### `SessionHandle<T>` (returned by `ctx.stage()`)

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | The session's name |
| `id` | `string` | The session's generated UUID |
| `result` | `T` | The value returned by the session callback |

### `s.save()` — Provider-Specific

- **Claude**: `s.save(s.sessionId)` — pass the session ID; transcript is auto-read
- **Copilot**: `s.save(await s.session.getMessages())` — pass `SessionEvent[]` from the pre-created session
- **OpenCode**: `s.save(result.data!)` — pass the `{ info, parts }` response object from `s.client.session.prompt()`

### `s.transcript(ref)` — Rendered Text

Accepts a `SessionHandle` (recommended) or session name string. Returns `{ path: string, content: string }` — the file path on disk and the rendered assistant text. Use `content` for embedding in prompts, or `path` for file-based triggers.
