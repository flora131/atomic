---
name: workflow-creator
description: Create AND run Atomic CLI workflows (`defineWorkflow().run().compile()` with `ctx.stage()`) across Claude, Copilot, and OpenCode SDKs. Use for **authoring** when the user wants to build, edit, debug, or design agent pipelines — multi-stage automations, review/fix loops, parallel fan-out, headless/background stages, `.atomic/workflows/` files, `defineWorkflow`, `ctx.stage`, `ctx.inputs`, or declared `WorkflowInput` schemas. Use for **running** when the user wants to kick off, execute, monitor, or tear down an existing workflow — "run the ralph workflow", "start gen-spec", "is it done yet?", "what's the status?", "kill the session", or any mention of `atomic workflow -n`, `atomic workflow inputs`, `atomic workflow status`, the picker, or `atomic session kill`.
---

# Workflow Creator

You are a workflow architect specializing in the Atomic CLI `defineWorkflow().run().compile()` API. You translate user intent into well-structured workflow files that orchestrate multiple coding agent sessions using **programmatic SDK code** — Claude Agent SDK, Copilot SDK, and OpenCode SDK. Sessions are spawned dynamically via `ctx.stage(stageOpts, clientOpts, sessionOpts, callback)` inside the `.run()` callback, using native TypeScript control flow (loops, conditionals, `Promise.all()`) for orchestration. The runtime auto-creates the SDK client and session, injects them as `s.client` and `s.session`, runs the callback, then auto-cleans up.

You also serve as a **context engineering advisor** — use the design skills listed under "Design Advisory Skills" to make informed architectural decisions about session structure, data flow, prompt composition, and quality assurance.

Two user journeys live in this skill:

- **Authoring** a new workflow (or editing/debugging an existing one) → read on below.
- **Running** a workflow on the user's behalf ("run ralph on this spec", "is it done yet?", "kill it") → go to `references/running-workflows.md`.

## Reference Files

Load references on demand. **Only `getting-started.md` is always-load.** Everything else is conditional — pull it in when the task matches the trigger column.

| File | Load when |
|---|---|
| `getting-started.md` | **Always** — quick-start examples for all 3 SDKs, SDK exports, `SessionContext` field reference |
| `failure-modes.md` | Before shipping any multi-session workflow. 16 catalogued failures (silent + loud) with wrong-vs-right patterns and a pre-ship design checklist |
| `workflow-inputs.md` | When declaring structured inputs or documenting how a workflow is invoked — `WorkflowInput` schema, field-type selection, picker + CLI flag semantics, builtin-protection rules |
| `agent-sessions.md` | When writing SDK calls — `s.session.query()` (Claude), `s.session.send()` (Copilot), `s.client.session.prompt()` (OpenCode); includes session-lifecycle pitfalls and when to use `sendAndWait` with explicit timeouts |
| `control-flow.md` | When using loops, conditionals, parallel execution (`Promise.all`), headless fan-out, or review/fix patterns |
| `state-and-data-flow.md` | When passing data between sessions — `s.save()`, `s.transcript()`, `s.getMessages()`, file persistence, transcript compression |
| `running-workflows.md` | When the user asks you to **run** an existing workflow rather than author one |
| `computation-and-validation.md` | When adding deterministic computation, response parsing, validation, quality gates, or file I/O |
| `session-config.md` | When configuring model, tools, permissions, hooks, or structured output per SDK |
| `user-input.md` | When collecting user input **mid-workflow** (not at invocation time — use `workflow-inputs.md` for that) |
| `discovery-and-verification.md` | When setting up workflow file structure, validation, or TypeScript config |

## Information Flow Is a First-Class Design Concern

**A workflow is an information flow problem, not a sequence of prompts.**
Before writing any `ctx.stage()` call, answer for every session boundary:

- What context does this session need, how will it reach the session
  (prompt handoff, file, single multi-turn stage), and what happens if the
  context window fills up?

For Copilot and OpenCode, every `ctx.stage()` is a fresh conversation;
Claude reuses a tmux pane per stage. Read these before shipping any
multi-session workflow:

- `references/agent-sessions.md` §"Critical pitfall: session lifecycle
  controls what context is available" — lifecycle table, context-loss
  patterns, and per-SDK details.
- `references/failure-modes.md` — silent + loud failures with wrong-vs-right
  patterns and the pre-ship design checklist.
- `references/state-and-data-flow.md` — `s.save()`, `s.transcript()`, and
  file-based handoff patterns.

## Design Advisory Skills

Workflow quality depends on two disciplines: **prompt engineering** (crafting
clear, structured prompts each session receives) and **context engineering**
(ensuring the right information reaches each session without exceeding token
budgets). Use `prompt-engineer` to improve individual session prompts —
clarity, XML structure, few-shot examples, chain-of-thought — and the
context engineering skills below to design information flow between sessions.

| Design Concern | Skill | Trigger |
|---|---|---|
| Prompt clarity and structure | `prompt-engineer` | Every workflow — clear instructions, XML tags, examples, chain-of-thought |
| Session prompt structure | `context-fundamentals` | Every workflow — token budgeting, prompt positioning, progressive disclosure |
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

A workflow is a TypeScript file with a single `.run()` callback that
orchestrates agent sessions dynamically. Inside the callback, `ctx.stage()`
spawns sessions — each gets its own tmux window and graph node (unless
running in headless mode). Native TypeScript handles all control flow:
loops, conditionals, `Promise.all()`, `try`/`catch`.

```ts
import { defineWorkflow, extractAssistantText } from "@bastani/atomic/workflows";

export default defineWorkflow({
    name: "my-workflow",
    description: "...",
    inputs: [
      { name: "prompt", type: "text", required: true, description: "task to perform" },
    ],
  })
  .for<"claude">()
  .run(async (ctx) => {
    const step1 = await ctx.stage({ name: "step-1" }, {}, {}, async (s) => { /* s.client, s.session */ });
    await ctx.stage({ name: "step-2" }, {}, {}, async (s) => { /* s.client, s.session */ });
  })
  .compile();
```

The runtime manages the full session lifecycle — callback return marks
completion; throws mark errors. `.compile()` produces a branded
`WorkflowDefinition` consumed by the CLI.

### Background (headless) stages

Pass `{ headless: true }` in `stageOpts` to run a stage in-process with no
tmux window or graph node. The callback interface is identical
(`s.client`, `s.session`, `s.save()`, `s.transcript()` all work). For
mechanics, fan-out patterns, and graph topology see
`references/control-flow.md` §"Headless stages" and
`references/agent-sessions.md` per-SDK "Headless mode" sections.

### Installing the workflow SDK

Install `@bastani/atomic` plus the native SDK(s) you target
(`@anthropic-ai/claude-agent-sdk`, `@github/copilot-sdk`,
`@opencode-ai/sdk`). Workflow files live at
`.atomic/workflows/<name>/<agent>/index.ts`. Full paths, precedence, and
reserved built-in names live in `references/discovery-and-verification.md`.

### Two context levels

`WorkflowContext` (`ctx`) drives orchestration in `.run()`; `SessionContext`
(`s`) drives agent work inside each stage callback. Full field reference in
`references/getting-started.md` §"`SessionContext` reference".

### Declared inputs

Workflows receive user data exclusively through `ctx.inputs` / `s.inputs`,
declared inline as `inputs: WorkflowInput[]` on `defineWorkflow()`.
TypeScript restricts `ctx.inputs` to declared keys (undeclared access is a
compile-time error). Load `references/workflow-inputs.md` for schema shape,
field types (`string` / `text` / `enum`), validation rules, picker
semantics, and the "declare your prompt input explicitly" pattern.

### Invocation surfaces

| Surface | Command | When |
|---|---|---|
| Named, with prompt | `atomic workflow -n hello -a claude "fix the bug"` | Scripted runs; requires the workflow to declare a `prompt` input |
| Named, structured | `atomic workflow -n gen-spec -a claude --research_doc=notes.md` | Scripted structured runs |
| Interactive picker | `atomic workflow -a claude` | Discovery; shows fuzzy list + form |
| List | `atomic workflow list` | Browse everything by source |
| Inspect inputs | `atomic workflow inputs <name> -a claude` | Print a workflow's input schema as JSON — agents use this instead of reading source |
| Status (one or all) | `atomic workflow status [<session-id>]` | Query state — `in_progress`, `error`, `completed`, `needs_review` (HIL pause). JSON by default |
| Kill non-interactively | `atomic session kill <id> -y` | Tear down a workflow/chat session without the confirmation prompt — the form agents use |
| Detached (background) | `atomic workflow -n ralph -a claude -d "..."` | Scripted/CI runs where the caller shouldn't block on the TUI — the orchestrator keeps running on the atomic tmux socket; attach later with `atomic workflow session connect <name>` |

Any of the named shapes above (positional or structured) accepts
`-d` / `--detach` to run without attaching. Use it when you're automating
from a script and want the CLI to return as soon as the session is spawned.

### Declaring SDK compatibility (`minSDKVersion`)

Opt-in version gate for workflows that depend on a specific SDK release.
**Default is unset — do not add it to new workflows unless you have a
concrete reason.**

```ts
defineWorkflow({
  name: "uses-new-api",
  minSDKVersion: "0.6.0", // refuse to load on older CLI
})
```

When set to a version newer than the installed CLI, the workflow refuses to
load and surfaces a visible row in `atomic workflow list` and the picker
(rather than silently vanishing). Set it only when the workflow calls a
newly-added SDK surface (new `stage()` option, new helper export, new
provider method); omit it for workflows on stable APIs. Full semver
semantics and the visible-diagnostic contract live in
`references/discovery-and-verification.md`.

## Structural Rules (hard constraints)

Enforced by the builder, loader, and runtime:

1. **`.run()` required** — the builder must have a `.run(async (ctx) => { ... })` call.
2. **`.compile()` required** — the chain must end with `.compile()`.
3. **`export default` required** — workflow files must use `export default` for discovery.
4. **Unique session names** — every `ctx.stage()` call must use a unique `name` across the workflow run.
5. **Completed-only reads** — `transcript()` and `getMessages()` only access sessions whose callback has returned and saves have flushed. Attempting to read a still-running session throws.
6. **Graph topology is auto-inferred** — the runtime derives parent-child edges from `await`/`Promise.all` patterns. Sequential `await` creates a chain; `Promise.all([...])` branches from the same parent; a stage after `Promise.all` receives all parallel stages as parents. Headless stages are **transparent** to the graph — they don't consume or update the execution frontier. See `references/control-flow.md` for full details.
7. **Do not manually create clients or sessions** — the runtime auto-creates `s.client` and `s.session` from `clientOpts` and `sessionOpts`. Use `s.session.query()`, `s.session.send()`, and `s.client.session.prompt()` instead.
8. **Headless stages share the same callback interface** — `s.client`, `s.session`, `s.save()`, `s.transcript()`, and return values all work identically in headless mode. The only differences are: no tmux window, no graph node, and a virtual `paneId`.

## Concept-to-Code Mapping

Every workflow pattern maps directly to TypeScript code:

| Workflow Concept | Programmatic Pattern |
|---|---|
| Agent session (send prompt, get response) | `ctx.stage({ name }, {}, {}, async (s) => { /* use s.client, s.session */ })` |
| Background (headless) session | `ctx.stage({ name, headless: true }, {}, {}, async (s) => { /* same API */ })` — invisible in graph, tracked by background counter |
| Sequential execution | `await ctx.stage(...)` followed by `await ctx.stage(...)` |
| Parallel execution | `Promise.all([ctx.stage(...), ctx.stage(...)])` |
| Parallel background tasks | `Promise.all([ctx.stage({ name: "a", headless: true }, ...), ctx.stage({ name: "b", headless: true }, ...)])` |
| Conditional branching | `if (...) { await ctx.stage({ name: "fix" }, {}, {}, ...) }` |
| Bounded loops with visible graph nodes | `for (let i = 1; i <= N; i++) { await ctx.stage({ name: \`step-\${i}\` }, {}, {}, ...) }` |
| Return data from session | `const h = await ctx.stage(opts, {}, {}, async (s) => { return value; }); h.result` |
| Data flow between sessions | `s.save()` to persist → `s.transcript(handle)` or `s.transcript("name")` to retrieve |
| Deterministic computation (no LLM) | Plain TypeScript inside `.run()` or inside a session callback |
| Subagent orchestration | Claude: `--agent` via `chatFlags` (interactive) or `agent` SDK option (headless); Copilot: `{ agent: "name" }` in sessionOpts; OpenCode: `agent` param in `s.client.session.prompt()` |
| Per-session configuration | Pass `clientOpts` (2nd arg) and `sessionOpts` (3rd arg) to `ctx.stage()` |

For full pattern examples with code, see `references/control-flow.md`
(loops, conditionals, review/fix, graph topology, headless fan-out),
`references/state-and-data-flow.md` (data passing, file coordination,
transcript compression), and `references/computation-and-validation.md`
(parsing, validation, quality gates).

## Authoring Process

### 1. Understand the User's Goal

Map the user's intent to sessions and patterns:

| Question | Maps to |
|----------|---------|
| What are the distinct steps? | Each step → `ctx.stage()` call |
| Can any steps run in parallel? | `Promise.all([ctx.stage(...), ...])` |
| Should any parallel steps run in the background? | `ctx.stage({ name, headless: true }, ...)` — invisible in graph, ideal for data-gathering |
| Does any step need deterministic computation? | Plain TypeScript inside `.run()` or session callback |
| Do any steps need to repeat? | `for`/`while` loop with `ctx.stage()` inside |
| Are there conditional paths? | `if`/`else` wrapping `ctx.stage()` calls |
| What data flows between steps? | `s.save()` → `s.transcript(handle)` / `s.getMessages(handle)` |
| Does the workflow need user input? | SDK-specific user input APIs (see `references/user-input.md`) |
| Do any steps need a specific model? | SDK-specific session config (see `references/session-config.md`) |

Then walk the **Design Advisory Skills** table above (§"Design Advisory
Skills") — for each row whose trigger applies to your workflow, pull that
skill in *before* writing code. Catching architectural and prompt-quality
issues at design time is far cheaper than catching them in the first failed
end-to-end run.

### 2. Choose the Target Agent

Use `.for<"agent">()` on the builder to narrow all context types and get
correct `s.client`/`s.session` types. Call `.for()` **before** `.run()`:

| Agent | Builder Chain | Primary Session API |
|-------|---------------|---------------------|
| Claude | `defineWorkflow({...}).for<"claude">()` | `s.session.query(prompt)` — sends prompt to the Claude TUI pane |
| Copilot | `defineWorkflow({...}).for<"copilot">()` | `s.session.send({ prompt })` — the runtime wraps `send` to block until `session.idle` with no timeout (see `failure-modes.md` §F10); do not use `sendAndWait` in Atomic workflows |
| OpenCode | `defineWorkflow({...}).for<"opencode">()` | `s.client.session.prompt({ sessionID: s.session.id, parts: [...] })` |

The runtime manages client/session lifecycle automatically. For native SDK
types and advanced APIs, import directly from the provider packages
(`@github/copilot-sdk`, `@anthropic-ai/claude-agent-sdk`, `@opencode-ai/sdk/v2`).

For cross-agent support, create one workflow file per agent under
`.atomic/workflows/<name>/<agent>/index.ts`. Use shared helper modules for
SDK-agnostic logic in a sibling `helpers/` directory:

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

Write the workflow file using the SDK-specific patterns. See
`references/getting-started.md` for full quick-start examples for all 3
SDKs (send/save/extract patterns, idle handling), and
`references/agent-sessions.md` for per-SDK API details and lifecycle
caveats.

The SDK ships two builtin workflows in `src/sdk/workflows/builtin/` as
production reference implementations across all 3 SDKs:
- **`ralph`** — iterative plan → orchestrate → review → debug loop.
- **`deep-research-codebase`** — deterministic scout → parallel explorers →
  aggregator.

They demonstrate shared helpers, context-aware prompt building, deterministic
heuristics, and cross-SDK adaptation.

### 4. Type-Check the Workflow

```bash
bun typecheck
```

### 5. Test the Workflow

```bash
# Workflow with a declared prompt input
atomic workflow -n <workflow-name> -a <agent> "<your prompt>"

# Structured workflow
atomic workflow -n <workflow-name> -a <agent> --research_doc=notes.md --focus=standard

# Interactive picker (discovery)
atomic workflow -a <agent>

# Detached — run in the background without attaching. Useful when testing
# from scripts or CI, or when the workflow will run long enough that you
# want your terminal back. Reattach later with:
#   atomic workflow session connect <printed-session-name>
atomic workflow -n <workflow-name> -a <agent> -d "<your prompt>"
```

## Running an Existing Workflow

If the user asks you to **run** (or "kick off" / "start" / "execute") a
workflow — not author one — the workflow already exists on disk and you
just need to invoke it correctly. That's a different playbook from
authoring.

**Read `references/running-workflows.md`.** It covers:

- Why you don't usually need `-a` or `-d` (env-driven auto-detach).
- Why you must run `atomic workflow list` first.
- How to handle missing workflows (offer to author, not fabricate).
- Using `atomic workflow inputs <name> -a <agent>` to discover the schema
  and drive AskUserQuestion.
- The six-step invocation recipe.
- Monitoring with `atomic workflow status` — and why `needs_review` must be
  surfaced immediately.
- Tearing down with `atomic session kill -y` (the `-y` is mandatory).
- Worked examples for "workflow exists" and "workflow doesn't exist".
