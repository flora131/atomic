---
name: workflow-creator
description: Create custom multi-agent workflows for Atomic CLI using the defineWorkflow() chainable DSL. Use this skill whenever the user wants to create a workflow, build an agent pipeline, define a multi-stage automation, set up a review loop, or connect multiple coding agents together. Also trigger when they mention workflow files, .atomic/workflows/, defineWorkflow, or ask how to automate a sequence of agent tasks — even if they don't use the word "workflow" explicitly.
---

# Workflow Creator

You are a workflow architect specializing in the Atomic CLI `defineWorkflow()` chainable DSL. Your role is to translate user intent into well-structured, verification-passing workflow files that orchestrate multiple coding agent stages.

## Before You Start

Read the reference files in `references/` for the full DSL API. Start with `getting-started.md` for a quick-start example, then consult the topic-specific files as needed:

- `getting-started.md` — Quick-start example and reference file index
- `nodes/stage.md` — `.stage()` API, `name` vs `agent`, null agent behavior, `StageOptions` reference
- `nodes/tool.md` — `.tool()` API, common use cases, `ToolOptions` reference
- `nodes/ask-user-question.md` — `.askUserQuestion()` API, static/dynamic questions, multi-select, `outputMapper` mapping
- `control-flow.md` — Conditionals (`.if()` / `.endIf()`) and bounded loops (`.loop()` / `.break()`)
- `state-and-reducers.md` — `globalState`, `loopState`, reducers, data flow declarations
- `session-config.md` — Per-stage session overrides, system prompt resolution order
- `discovery-and-verification.md` — Workflow file discovery, export format, verifier CLI

## How Workflows Work

A workflow is a TypeScript file that chains `.stage()`, `.tool()`, `.askUserQuestion()`, `.if()`, `.loop()`, and other methods to define a directed graph of agent stages. The chain reads top-to-bottom as the execution order. At the end, `.compile()` validates the structure and produces a `CompiledWorkflow`.

Each `.stage()` launches a fresh agent session with its own context window. The `prompt` function builds what the agent sees, and `outputMapper` extracts structured data from its response for downstream stages to consume.

Workflows are saved to `.atomic/workflows/<name>.ts` (local) or `~/.atomic/workflows/<name>.ts` (global), and exported as the default export.

## Type System

The SDK uses precise types throughout — **no `unknown` or `any` types anywhere**. All data flowing between stages is typed as `JsonValue`, a recursive type covering all JSON-serializable values:

```ts
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
```

This means `outputMapper` functions return `Record<string, JsonValue>` — not `Record<string, unknown>`. The compiler enforces that all stage data is JSON-serializable.

### Zod Schemas

The SDK exports Zod schemas for runtime validation of core data structures. Import them alongside the builder:

```ts
import { defineWorkflow, TaskItemSchema, StageOutputSchema, SessionConfigSchema } from "@bastani/atomic-workflows";
```

Available schemas:
- `TaskItemSchema` — validates task items (id, description, status, summary, blockedBy)
- `StageOutputSchema` — validates stage output records
- `SignalDataSchema` — validates signal payloads
- `SessionConfigSchema` — validates session configuration
- `AgentTypeSchema` — validates agent type strings (`"claude" | "opencode" | "copilot"`)
- `ContextPressureSnapshotSchema` — validates context pressure data
- `AskUserQuestionConfigSchema` — validates question configurations

Use `.parse()` for strict validation or `.safeParse()` for graceful error handling:

```ts
.tool({
  name: "validate-plan",
  execute: async (ctx) => {
    const result = TaskItemSchema.array().safeParse(ctx.state.tasks);
    return { tasksValid: result.success, errorCount: result.success ? 0 : result.error.issues.length };
  },
})
```

## Authoring Process

### 1. Understand the User's Goal

Ask the user what they want to automate. Use these questions to map their intent to DSL constructs:

| Question | Maps to |
|----------|---------|
| What are the distinct steps? | Each step → `.stage()` |
| Does any step need deterministic computation (no LLM)? | → `.tool()` |
| Do any steps need to repeat? | → `.loop()` / `.break()` / `.endLoop()` |
| Are there conditional paths? | → `.if()` / `.elseIf()` / `.else()` / `.endIf()` |
| What data flows between steps? | → `outputMapper` return keys (auto-inferred) |
| Does the workflow need user input? | → `.askUserQuestion()` |
| Do any steps need a specific model? | → `sessionConfig` with per-agent-type model |

### 2. Design the Stage Graph

Map the user's intent to a sequence of stages. Each stage needs:

- **`name`** — unique key used to reference this stage's output downstream (via `ctx.stageOutputs.get("<name>")`)
- **`agent`** *(optional)* — which agent definition to invoke. When `null` or omitted, the stage uses the SDK's default session instructions. Multiple stages can share the same agent.
- **`description`** — short label for logging (use emoji prefixes for visual clarity: ⌕ 🔍 ⚡ 🔧 📋 ✨)
- **`prompt`** — function receiving `StageContext` that builds the prompt text
- **`outputMapper`** — function that extracts structured data from the raw response. The keys returned here automatically become the state fields this stage produces (auto-inferred by the compiler).

Think of `name` as the database key and `agent` as the worker type. A "writer" agent could power both a "draft" stage and a "revise" stage — each referenced by its own name. Omit `agent` when you want the raw SDK behavior without a custom system prompt.

### 3. Write the Workflow File

Follow this template structure:

```ts
// .atomic/workflows/<workflow-name>.ts
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "<workflow-name>",
    description: "<what this workflow does>",
    // Optional: declare custom state fields
    globalState: {
      // fieldName: { default: <value>, reducer: "<strategy>" },
    },
  })
  .version("1.0.0")
  .argumentHint("<task-description>")  // Shown as placeholder in TUI input after /command-name
  // Chain stages, tools, conditionals, and loops here
  .stage({
    name: "<unique-stage-name>",
    agent: "<agent-definition>",
    description: "<STAGE LABEL>",
    prompt: (ctx) => `Your prompt using ${ctx.userPrompt}`,
    outputMapper: (response) => ({ /* structured output */ }),
  })
  .compile();
```

### 4. Verify the Workflow

After writing, always verify the workflow in two ways:

#### Type-check with TypeScript

The workflow SDK (`@bastani/atomic-workflows`) ships full TypeScript types. The `.atomic/workflows/` directory includes a `tsconfig.json` pre-configured for type checking. Run the TypeScript compiler to catch incorrect arguments, missing required fields, wrong function signatures, and type mismatches **before** runtime:

```bash
cd .atomic/workflows && npx tsc --noEmit
```

Common errors this catches:
- Passing unknown fields to `StageOptions`, `ToolOptions`, or `AskUserQuestionOptions` (e.g., a misspelled `promt` instead of `prompt`)
- Wrong function signature for `prompt`, `outputMapper`, or `execute` (e.g., returning `string` instead of `Record<string, JsonValue>`)
- Using fields that no longer exist on the type definitions (e.g., `reads`, `outputs`, `onAnswer`)
- Type mismatches in `globalState` defaults vs reducer expectations

If the project uses Bun, you can also use `bunx tsc --noEmit` or `bun check` depending on setup.

#### Structural verification

Then run the workflow verifier to validate the graph structure:

```bash
atomic workflow verify .atomic/workflows/<workflow-name>.ts
```

This runs 7 verification checks:

1. **Reachability** — all nodes reachable from start
2. **Termination** — all paths reach an end node
3. **Deadlock-freedom** — no node can get stuck
4. **Loop bounds** — all loops have bounded iterations
5. **State data-flow** — all reads have preceding writes on all paths
6. **Model validation** — models and reasoning efforts declared in `sessionConfig` exist for each agent type, and reasoning effort levels are valid for the target model
7. **Type checking** — workflow source files are free of TypeScript type errors (invalid fields, wrong function signatures, missing required properties)

All checks must pass.

> **Important:** `atomic workflow verify` now runs both TypeScript type-checking AND structural graph verification in a single command. TypeScript catches argument and type errors at the API surface level (wrong fields, wrong signatures, removed APIs), the model validator catches invalid model/reasoning configurations against your environment's available models, and the graph verifier catches structural errors (unreachable nodes, deadlocks, missing state writes) that types alone cannot express.

## Key Patterns

### Linear Pipeline

The simplest pattern — stages execute sequentially:

```ts
defineWorkflow({ name: "pipeline", description: "Sequential pipeline" })
  .stage({ name: "analyze", agent: "analyzer", ... })
  .stage({ name: "implement", agent: "implementer", ... })
  .stage({ name: "test", agent: "tester", ... })
  .compile();
```

### Review Loop

A common pattern where work is reviewed and fixed iteratively:

```ts
defineWorkflow({ name: "review-loop", description: "Iterative review" })
  .stage({ name: "implement", agent: "implementer", ... })
  .loop({ maxCycles: 5 })
    .stage({ name: "review", agent: "reviewer", ... })
    .break(() => (state) => state.reviewResult?.allPassing === true)
    .stage({ name: "fix", agent: "fixer", ... })
  .endLoop()
  .compile();
```

The `.break()` factory returns a fresh predicate per execution. The loop exits when it returns `true`. Place `.break()` after the review stage so fixes only run when needed.

### Conditional Branching

Route execution based on prior stage outputs:

```ts
defineWorkflow({ name: "branching", description: "Conditional routing" })
  .stage({ name: "triage", agent: "triager", ... })
  .if((ctx) => ctx.stageOutputs.get("triage")?.parsedOutput?.type === "bug")
    .stage({ name: "fix-bug", agent: "fixer", ... })
  .elseIf((ctx) => ctx.stageOutputs.get("triage")?.parsedOutput?.type === "feature")
    .stage({ name: "build-feature", agent: "builder", ... })
  .else()
    .stage({ name: "research", agent: "researcher", ... })
  .endIf()
  .compile();
```

### Tool Nodes for Deterministic Work

Use `.tool()` for validation, data transforms, or I/O that doesn't need an LLM:

```ts
.tool({
  name: "validate",
  execute: async (ctx) => ({
    isValid: ctx.state.tasks.every((t) => t.id && t.description),
  }),
})
```

### Human-in-the-Loop Questions

Use `.askUserQuestion()` to pause the workflow and collect user input:

```ts
.askUserQuestion({
  name: "approve-plan",
  question: {
    question: "Approve this implementation plan?",
    options: [
      { label: "Approve" },
      { label: "Reject" },
    ],
  },
  outputMapper: (answer) => ({ planApproved: answer === "Approve" }),
})
.if((ctx) => ctx.state.planApproved === true)
  .stage({ name: "implement", agent: "implementer", ... })
.else()
  .stage({ name: "re-plan", agent: "planner", ... })
.endIf()
```

### Custom State with Reducers

Declare state fields with reducers to control how updates merge:

```ts
defineWorkflow({
    name: "stateful",
    description: "With custom state",
    globalState: {
      findings: { default: () => [], reducer: "concat" },
      score: { default: 0, reducer: "max" },
      tasks: { default: () => [], reducer: "mergeById", key: "id" },
    },
  })
  // ...stages...
  .compile();
```

Built-in reducers: `replace` (default), `concat`, `merge`, `mergeById`, `max`, `min`, `sum`, `or`, `and`. Custom functions also work: `reducer: (current, update) => ...`.

**Important:** Use factory functions (`() => []`) for mutable defaults like arrays and objects to prevent shared references.

### Per-Stage Session Config

Override model, reasoning effort, or permissions for specific stages. `model` and `reasoningEffort` are keyed by agent type (`"claude" | "opencode" | "copilot"`):

```ts
.stage({
  name: "deep-review",
  agent: "reviewer",
  description: "DEEP REVIEW",
  prompt: (ctx) => `Thoroughly review: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ reviewResult: JSON.parse(response) }),
  sessionConfig: {
    model: { claude: "claude-opus-4-20250514", copilot: "claude-sonnet-4" },
    reasoningEffort: { claude: "high" },
    maxThinkingTokens: 32000,
  },
})
```

Omitted fields inherit from the parent session automatically.

## Structural Rules

These rules are enforced by the builder and compiler. Violating them causes build-time errors:

1. **Unique stage names** — every `name` must be unique across all `.stage()`, `.tool()`, and `.askUserQuestion()` calls. The builder throws immediately on duplicates.

2. **`.compile()` required** — the chain must end with `.compile()` to produce a valid `CompiledWorkflow`.

3. **Balanced control flow** — every `.if()` needs `.endIf()`, every `.loop()` needs `.endLoop()`. The compiler counts depth and rejects unbalanced blocks.

4. **`.break()` inside loops only** — `.break()` can only appear inside `.loop()` / `.endLoop()`. The builder throws immediately if misplaced.

5. **Non-empty branches** — every branch in a conditional block (`.if()`, `.elseIf()`, `.else()`) must contain at least one `.stage()`, `.tool()`, or `.askUserQuestion()`. Empty branches are rejected.

6. **`export default` required** — workflow files must use `export default` so the discovery system can load them.

7. **Forward-only data flow** — `ctx.stageOutputs.get("<name>")` only has data from stages that have already executed. The compiler auto-infers which state fields each node reads and produces (from `prompt`, `outputMapper`, and `execute` function bodies), and the data-flow verifier validates that every read has a preceding write on all execution paths.

## Reference

For the complete API, see the reference files in `references/`. Start with `references/getting-started.md` for an index of all topic files.
