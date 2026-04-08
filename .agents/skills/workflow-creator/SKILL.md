---
name: workflow-creator
description: Create custom multi-agent workflows for Atomic CLI using the defineWorkflow() session-based API with programmatic SDK code. Applies context engineering principles (context-fundamentals, context-degradation, context-compression, context-optimization), architectural patterns (multi-agent-patterns, memory-systems, tool-design, filesystem-context, hosted-agents), quality assurance (evaluation, advanced-evaluation), and design methodology (project-development, bdi-mental-states) to produce robust, context-aware workflows. Workflows live at .atomic/workflows/<name>/<agent>/index.ts with self-contained helpers alongside agent implementations. Use this skill whenever the user wants to create a workflow, build an agent pipeline, define a multi-stage automation, set up a review loop, or connect multiple coding agents together. Also trigger when they mention workflow files, .atomic/workflows/, defineWorkflow, or ask how to automate a sequence of agent tasks — even if they don't use the word "workflow" explicitly.
---

# Workflow Creator

You are a workflow architect specializing in the Atomic CLI `defineWorkflow()` session-based API. Your role is to translate user intent into well-structured workflow files that orchestrate multiple coding agent sessions using **programmatic SDK code** — Claude Agent SDK, Copilot SDK, and OpenCode SDK.

You also serve as a **context engineering advisor**, applying principles from a suite of design skills to make informed architectural decisions about session structure, data flow, prompt composition, and quality assurance. Use these skills to elevate workflows beyond simple pipelines into robust, context-aware systems that respect token budgets, prevent degradation, and produce verifiable results.

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

## Design Advisory Skills

When designing workflows, consult these skills to make informed architectural decisions. Each skill addresses a specific design concern — use them when the corresponding trigger applies.

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
- `multi-agent-patterns` — Should this be one session or many? What coordination topology?
- `context-fundamentals` — How much context does each session need? What's the token budget?

**Session design phase** (structuring `run()` callbacks):
- `context-fundamentals` — Position critical information at start/end of prompts, not middle
- `context-degradation` — Add compaction triggers for loops; isolate unrelated concerns into separate sessions
- `context-compression` — Summarize prior transcripts before injecting; preserve file paths and key decisions
- `tool-design` — Design clear tool contracts; consolidate overlapping tools
- `filesystem-context` — Use file-based scratch pads for intermediate state; load context on demand

**Data flow phase** (connecting sessions via `ctx.save()` / `ctx.transcript()`):
- `context-compression` — Compress transcripts at session boundaries using structured summaries
- `memory-systems` — Choose persistence layer: `ctx.save()` for intra-workflow, files for cross-workflow, vector stores for semantic retrieval
- `filesystem-context` — Offload large outputs to files; use `ctx.transcript().path` for file references instead of inlining full content

**Quality assurance phase** (adding review/validation):
- `evaluation` — Define success rubrics; test outcomes not execution paths
- `advanced-evaluation` — Use pairwise comparison for subjective quality; mitigate position and length bias in judge prompts
- `context-optimization` — Measure and reduce token waste; apply observation masking for verbose tool outputs

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

Workflows are SDK-specific and saved to `.atomic/workflows/<workflow-name>/<agent>/index.ts`:
- `.atomic/workflows/<name>/claude/index.ts` — Claude Agent SDK code
- `.atomic/workflows/<name>/copilot/index.ts` — Copilot SDK code
- `.atomic/workflows/<name>/opencode/index.ts` — OpenCode SDK code

Global workflows: `~/.atomic/workflows/<name>/<agent>/index.ts`

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
| Claude | `claudeQuery` from `@bastani/atomic-workflows` | `claudeQuery({ paneId, prompt })` — automates Claude TUI via tmux |
| Copilot | `CopilotClient` from `@github/copilot-sdk` | `client.createSession()` → `session.sendAndWait({ prompt })` |
| OpenCode | `createOpencodeClient` from `@opencode-ai/sdk/v2` | `client.session.create()` → `client.session.prompt({ ... })` |

If you need cross-agent support, create one workflow file per agent under `.atomic/workflows/<name>/<agent>/index.ts`. Use shared helper modules for SDK-agnostic logic (prompts, parsing, validation) in a sibling directory like `.atomic/workflows/<name>/helpers/`.

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
// .atomic/workflows/my-workflow/claude/index.ts
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
// .atomic/workflows/my-workflow/copilot/index.ts
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
// .atomic/workflows/my-workflow/opencode/index.ts
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
await claudeQuery({ paneId: ctx.paneId, prompt: buildPlanPrompt(ctx.userPrompt) });
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

  return `${head}\n\n[... ${content.length - headSize - tailSize} chars compressed — key decisions and file paths preserved above/below ...]\n\n${tail}`;
}
```

```ts
.session({
  name: "synthesize",
  run: async (ctx) => {
    const research = await ctx.transcript("research");
    // Compress before injecting into prompt to stay within token budget
    const compressed = compressTranscript(research.content, 4000);
    await claudeQuery({
      paneId: ctx.paneId,
      prompt: `Synthesize this research:\n${compressed}`,
    });
    ctx.save(ctx.sessionId);
  },
})
```

### Quality Gate with LLM-as-Judge

Add automated quality checkpoints using evaluation rubrics. This pattern applies `evaluation` + `advanced-evaluation` — the judge session scores the implementation session's output against defined criteria:

```ts
defineWorkflow({ name: "guarded-pipeline", description: "Pipeline with quality gate" })
  .session({
    name: "implement",
    description: "Implement the feature",
    run: async (ctx) => {
      await claudeQuery({ paneId: ctx.paneId, prompt: ctx.userPrompt });
      ctx.save(ctx.sessionId);
    },
  })
  .session({
    name: "quality-gate",
    description: "Judge implementation quality",
    run: async (ctx) => {
      const impl = await ctx.transcript("implement");
      const result = await claudeQuery({
        paneId: ctx.paneId,
        prompt: `You are a code quality judge. Score this implementation on a 1-5 scale for each criterion.

## Rubric
- **Correctness**: Does it solve the stated problem?
- **Completeness**: Are edge cases handled?
- **Style**: Does it follow project conventions?

## Implementation to judge
${impl.content}

Respond with JSON: { "correctness": N, "completeness": N, "style": N, "pass": boolean, "issues": [...] }`,
      });

      // Parse and gate on quality threshold
      const scores = JSON.parse(
        result.output.match(/\`\`\`json\s*\n([\s\S]*?)\n\`\`\`/)?.[1] ?? result.output,
      );

      if (!scores.pass) {
        // Feed issues back for a fix cycle
        await claudeQuery({
          paneId: ctx.paneId,
          prompt: `Fix these quality issues:\n${scores.issues.join("\n")}`,
        });
      }

      ctx.save(ctx.sessionId);
    },
  })
  .compile();
```

### File-Based Coordination with Scratch Pad

Use the filesystem as a coordination layer between sessions instead of inlining large data into prompts. This applies `filesystem-context` — offload to files, reference by path:

```ts
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

defineWorkflow({ name: "file-coordinated", description: "File-based coordination" })
  .session({
    name: "plan",
    description: "Generate a plan and write to scratch pad",
    run: async (ctx) => {
      const result = await claudeQuery({
        paneId: ctx.paneId,
        prompt: `Create a detailed implementation plan for: ${ctx.userPrompt}\n\nWrite the plan to a file called plan.md in the current directory.`,
      });
      ctx.save(ctx.sessionId);
    },
  })
  .session({
    name: "execute",
    description: "Execute from plan file",
    run: async (ctx) => {
      // Reference the file by path instead of inlining content
      // This avoids bloating the prompt and lets the agent read selectively
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: `Read plan.md and implement each task in order. Mark tasks as done as you complete them.`,
      });
      ctx.save(ctx.sessionId);
    },
  })
  .compile();
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
