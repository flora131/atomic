---
name: workflow-creator
description: Create multi-agent workflows for Atomic CLI using defineWorkflow().run().compile() with ctx.stage() for session orchestration across Claude, Copilot, and OpenCode SDKs. Use whenever the user wants to create, edit, or debug workflows, build agent pipelines, define multi-stage automations, set up review loops, declare workflow inputs, or mentions .atomic/workflows/, defineWorkflow, ctx.stage, ctx.inputs, or the atomic workflow picker.
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
| **1** | `workflow-inputs.md` | **Always when declaring structured inputs or documenting how a workflow is invoked** — `WorkflowInput` schema, field-type selection, picker + CLI flag semantics, builtin-protection rules, invocation cheat sheet |
| **2** | `agent-sessions.md` | When writing SDK calls — `s.session.query()` (Claude), `s.session.sendAndWait()` (Copilot), `s.client.session.prompt()` (OpenCode); includes critical pitfalls on timeouts and session lifecycle |
| **2** | `control-flow.md` | When using loops, conditionals, parallel execution, or review/fix patterns |
| **2** | `state-and-data-flow.md` | When passing data between sessions — `s.save()`, `s.transcript()`, `s.getMessages()`, file persistence, transcript compression |
| **3** | `computation-and-validation.md` | When adding deterministic computation, response parsing, validation, quality gates, or file I/O |
| **3** | `session-config.md` | When configuring model, tools, permissions, hooks, or structured output per SDK |
| **3** | `user-input.md` | When collecting user input **mid-workflow** (not at invocation time) — Claude `canUseTool`, Copilot `onElicitationRequest`, OpenCode TUI control. For invocation-time inputs, see `workflow-inputs.md`. |
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

### Session lifecycle controls information flow

| Lifecycle state | Context visible to the model | When it happens |
|---|---|---|
| **Fresh** | **Nothing** — empty conversation | Each new `ctx.stage()` call — the runtime creates a new session |
| **Continued** | Everything sent so far in this session | Additional turns within the same stage callback |
| **Closed** | Gone from the live client; persisted only through what you explicitly saved | Runtime auto-cleanup after the stage callback returns |

**Closing a session and creating a new one wipes all in-session context.**
The new session knows *only* what you put in its first prompt.

Claude is different: the runtime reuses a single persistent tmux pane, so every turn within a stage accumulates in the same conversation. But for Copilot and OpenCode, **every `ctx.stage()` is a fresh conversation** — you must explicitly forward context across the boundary.

### Avoiding context loss

Three reliable patterns (they compose — using 1+2 together is common). See `references/agent-sessions.md` for detailed examples and wrong-vs-right code patterns.

1. **Explicit prompt handoff** — capture the prior session's output via `s.transcript()` and inject it into the next session's first prompt. Simple, always works.
2. **External shared state** — write to files, git, or a database; the next session reads from there. Best when data is already structured.
3. **Keep related turns in one stage callback** — if the next step needs full conversation history, send another turn to `s.session` instead of spawning a new stage. This is the idiomatic way to preserve context.

**Context is finite.** Even within one session, context can overflow. Symptoms: lost-in-middle, repeated questions, forgotten decisions. Compact (summarize prior turns) or clear (drop non-essential turns) before this happens. Consult `context-compression` and `context-optimization` for trade-offs.

**Load-bearing references for these pitfalls:**
- `references/failure-modes.md` — **read before shipping any multi-session workflow**. Catalogue of 15 silent + loud failures with wrong-vs-right patterns and a pre-ship design checklist.
- `references/agent-sessions.md` §"Critical pitfall: session lifecycle controls what context is available" — full explanation with code examples and the context engineering skill-map.

## Design Advisory Skills

When designing workflows, consult these skills for informed architectural decisions. **The first four are not optional for multi-session workflows — they are the difference between a workflow that works and one that silently degrades.**

| Design Concern | Skill | Trigger |
|---|---|---|
| Session prompt structure | `context-fundamentals` | Every workflow — token budgeting, prompt positioning |
| Context failure prevention | `context-degradation` | Long conversations, accumulated state, multi-turn loops |
| Transcript compression | `context-compression` | Passing large transcripts between sessions |
| Multi-session architecture | `multi-agent-patterns` | Coordination topology, handoff protocols, error propagation |
| Cross-run persistence | `memory-systems` | Retaining knowledge across separate executions |
| Custom tools and capabilities | `tool-design` | Sessions exposing custom tools |
| File-based coordination | `filesystem-context` | Sessions sharing state via files |
| Remote execution | `hosted-agents` | Sandboxed or remote environments |
| Token efficiency | `context-optimization` | Compaction triggers, observation masking, cache-friendly ordering |
| Quality gates | `evaluation` | Review loops or quality checkpoints |
| LLM-as-judge review | `advanced-evaluation` | Automated review sessions judging other sessions' output |
| Task-model fit | `project-development` | Validating whether a task is viable for agent automation |
| Deliberative reasoning | `bdi-mental-states` | Explainable reasoning chains or formal cognitive models |

## How Workflows Work

A workflow is a TypeScript file with a single `.run()` callback that orchestrates agent sessions dynamically. Inside the callback, `ctx.stage()` spawns sessions — each gets its own tmux window and graph node. Native TypeScript handles all control flow: loops, conditionals, `Promise.all()`, `try`/`catch`.

```ts
import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({ name: "my-workflow", description: "..." })
  .run(async (ctx) => {
    const step1 = await ctx.stage({ name: "step-1" }, {}, {}, async (s) => { /* s.client, s.session */ });
    await ctx.stage({ name: "step-2" }, {}, {}, async (s) => { /* s.client, s.session */ });
  })
  .compile();
```

The runtime manages the full session lifecycle — callback return marks completion; throws mark errors. `.compile()` produces a branded `WorkflowDefinition` consumed by the CLI.

Workflows are SDK-specific. User-created workflows live in a project with `@bastani/atomic` installed as a dependency, along with the native agent SDK(s) for the provider(s) you target. Install only the SDK(s) you need:

```bash
bun add @bastani/atomic                    # Workflow SDK
bun add @anthropic-ai/claude-agent-sdk    # For Claude workflows
bun add @github/copilot-sdk               # For Copilot workflows
bun add @opencode-ai/sdk                  # For OpenCode workflows
```

Workflow files live at `.atomic/workflows/<name>/<agent>/index.ts`. Discovery sources (highest precedence first): **Local** → **Global** (`~/.atomic/`) → **Built-in** (SDK-shipped, reserved: `ralph`, `deep-research-codebase`). See `references/discovery-and-verification.md` for full discovery paths and validation.

### Two context levels

| Context | Available in | Has `client`/`session`/`save`? | Purpose |
|---------|-------------|-------------------------------|---------|
| `WorkflowContext` (`ctx`) | `.run(async (ctx) => ...)` | No | Orchestration: spawn sessions, read transcripts, read `ctx.inputs` |
| `SessionContext` (`s`) | `ctx.stage(opts, clientOpts, sessionOpts, async (s) => ...)` | Yes | Agent work: use `s.client` and `s.session` for SDK calls, save output |

Both contexts expose `inputs: Record<string, string>`, `stage()`, `transcript()`, and `getMessages()`. See `references/getting-started.md` for the full `SessionContext` field reference.

### Declared inputs: one API, three invocation surfaces

Workflows receive user data exclusively through `ctx.inputs` (and `s.inputs` inside stage callbacks). You have two choices:

**Free-form** — no schema. The positional CLI prompt lands under `ctx.inputs.prompt`. Read via `ctx.inputs.prompt ?? ""`.

**Structured** — declare `inputs: WorkflowInput[]` on `defineWorkflow`. The CLI materializes one `--<field>=<value>` flag per entry, validates required fields + enum membership before launching, and the picker renders a form. Three field types: `string` (single-line), `text` (multi-line), `enum` (fixed set).

**Load `references/workflow-inputs.md`** for the full schema shape, validation rules, free-form-vs-structured decision guide, picker semantics, and invocation cheat sheet.

### Invocation surfaces

| Surface | Command | When |
|---|---|---|
| Named, free-form | `atomic workflow -n hello -a claude "fix the bug"` | Scripted runs; prompt lands in `ctx.inputs.prompt` |
| Named, structured | `atomic workflow -n gen-spec -a claude --research_doc=notes.md` | Scripted structured runs |
| Interactive picker | `atomic workflow -a claude` | Discovery; shows fuzzy list + form |
| List | `atomic workflow -l` | Browse everything by source |

**Builtin workflows are reserved** — local/global workflows cannot shadow them. Pick distinct names.

### Structural Rules

Hard constraints enforced by the builder, loader, and runtime:

1. **`.run()` required** — the builder must have a `.run(async (ctx) => { ... })` call.
2. **`.compile()` required** — the chain must end with `.compile()`.
3. **`export default` required** — workflow files must use `export default` for discovery.
4. **Unique session names** — every `ctx.stage()` call must use a unique `name` across the workflow run.
5. **Completed-only reads** — `transcript()` and `getMessages()` only access sessions whose callback has returned and saves have flushed. Attempting to read a still-running session throws.
6. **Graph topology is auto-inferred** — the runtime derives parent-child edges from `await`/`Promise.all` patterns. Sequential `await` creates a chain; `Promise.all([...])` branches from the same parent; a stage after `Promise.all` receives all parallel stages as parents. See `references/control-flow.md` for full details.
7. **Do not manually create clients or sessions** — the runtime auto-creates `s.client` and `s.session` from `clientOpts` and `sessionOpts`. Use `s.session.query()`, `s.session.sendAndWait()`, and `s.client.session.prompt()` instead.

## Concept-to-Code Mapping

Every workflow pattern maps directly to TypeScript code:

| Workflow Concept | Programmatic Pattern |
|---|---|
| Agent session (send prompt, get response) | `ctx.stage({ name }, {}, {}, async (s) => { /* use s.client, s.session */ })` |
| Sequential execution | `await ctx.stage(...)` followed by `await ctx.stage(...)` |
| Parallel execution | `Promise.all([ctx.stage(...), ctx.stage(...)])` |
| Conditional branching | `if (...) { await ctx.stage({ name: "fix" }, {}, {}, ...) }` |
| Bounded loops with visible graph nodes | `for (let i = 1; i <= N; i++) { await ctx.stage({ name: \`step-\${i}\` }, {}, {}, ...) }` |
| Return data from session | `const h = await ctx.stage(opts, {}, {}, async (s) => { return value; }); h.result` |
| Data flow between sessions | `s.save()` to persist → `s.transcript(handle)` or `s.transcript("name")` to retrieve |
| Deterministic computation (no LLM) | Plain TypeScript inside `.run()` or inside a session callback |
| Subagent orchestration | Claude: `@"agent (agent)"` prefix in prompt; Copilot: `{ agent: "name" }` in sessionOpts; OpenCode: `agent` param in `s.client.session.prompt()` |
| Per-session configuration | Pass `clientOpts` (2nd arg) and `sessionOpts` (3rd arg) to `ctx.stage()` |

For full pattern examples with code, see `references/control-flow.md` (loops, conditionals, review/fix, graph topology), `references/state-and-data-flow.md` (data passing, file coordination, transcript compression), and `references/computation-and-validation.md` (parsing, validation, quality gates).

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
| Does the workflow need user input? | SDK-specific user input APIs (see `references/user-input.md`) |
| Do any steps need a specific model? | SDK-specific session config (see `references/session-config.md`) |

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

### 2. Choose the Target Agent

Pass a type parameter to `defineWorkflow<"agent">()` to narrow all context types and get correct `s.client`/`s.session` types:

| Agent | Type Parameter | Primary Session API |
|-------|---------------|---------------------|
| Claude | `defineWorkflow<"claude">` | `s.session.query(prompt)` — sends prompt to the Claude TUI pane |
| Copilot | `defineWorkflow<"copilot">` | `s.session.sendAndWait({ prompt }, TIMEOUT_MS)` — **explicit timeout required** (default 60s throws) |
| OpenCode | `defineWorkflow<"opencode">` | `s.client.session.prompt({ sessionID: s.session.id, parts: [...] })` |

The runtime manages client/session lifecycle automatically. For native SDK types and advanced APIs, import directly from the provider packages (`@github/copilot-sdk`, `@anthropic-ai/claude-agent-sdk`, `@opencode-ai/sdk/v2`).

For cross-agent support, create one workflow file per agent under `.atomic/workflows/<name>/<agent>/index.ts`. Use shared helper modules for SDK-agnostic logic in a sibling `helpers/` directory:

```
.atomic/workflows/<name>/
├── claude/index.ts          # Claude-specific SDK code
├── copilot/index.ts         # Copilot-specific SDK code
├── opencode/index.ts        # OpenCode-specific SDK code
└── helpers/
    ├── prompts.ts           # Prompt builders (SDK-agnostic)
    ├── parsers.ts           # Response parsers (SDK-agnostic)
    └── validation.ts        # Validation logic (SDK-agnostic)
```

### 3. Write the Workflow File

**Load `references/getting-started.md`** for complete quick-start examples for all three SDKs with correct save patterns, response extraction, and timeout handling.

Per-SDK cheat sheet:

| Concern | Claude | Copilot | OpenCode |
|---------|--------|---------|----------|
| Send prompt | `s.session.query(prompt)` | `s.session.sendAndWait({ prompt }, TIMEOUT)` | `s.client.session.prompt({ sessionID: s.session.id, parts: [{ type: "text", text: prompt }] })` |
| Save output | `s.save(s.sessionId)` | `s.save(await s.session.getMessages())` | `s.save(result.data!)` |
| Timeout | Per-query defaults via sessionOpts | **Mandatory** 2nd arg (default 60s throws!) | N/A |
| Context model | Tmux pane (accumulates across turns) | Fresh per `ctx.stage()` | Fresh per `ctx.stage()` |
| Extract text | `result.output` (string) | `getAssistantText(messages)` (see `failure-modes.md` F1) | `extractResponseText(result.data!.parts)` (see `failure-modes.md` F3) |

The SDK ships two builtin workflows as production reference implementations:
- **`ralph`** — iterative plan → orchestrate → review → debug loop (all 3 SDKs)
- **`deep-research-codebase`** — deterministic scout → parallel explorers → aggregator (all 3 SDKs)

Both live in `src/sdk/workflows/builtin/` and demonstrate real patterns including shared helpers, context-aware prompt building, deterministic heuristics, and cross-SDK adaptation.

### 4. Type-Check the Workflow

```bash
bunx tsc --noEmit --pretty false
```

### 5. Test the Workflow

```bash
# Free-form workflow
atomic workflow -n <workflow-name> -a <agent> "<your prompt>"

# Structured workflow
atomic workflow -n <workflow-name> -a <agent> --research_doc=notes.md --focus=standard

# Interactive picker (discovery)
atomic workflow -a <agent>
```
