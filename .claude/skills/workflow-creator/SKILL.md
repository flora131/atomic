---
name: workflow-creator
description: Create custom multi-agent workflows for Atomic CLI using the defineWorkflow() chainable DSL. Use this skill whenever the user wants to create a workflow, build an agent pipeline, define a multi-stage automation, set up a review loop, or connect multiple coding agents together. Also trigger when they mention workflow files, .atomic/workflows/, defineWorkflow, or ask how to automate a sequence of agent tasks — even if they don't use the word "workflow" explicitly.
---

# Workflow Creator

Help users create custom workflows using the `defineWorkflow()` chainable DSL. Workflows orchestrate multiple coding agent stages into automated pipelines — plan/execute/review loops, conditional branching, and structured data flow between stages.

## Before You Start

Read the reference files in `references/` for the full DSL API. Start with `getting-started.md` for a quick-start example, then consult the topic-specific files as needed:

- `getting-started.md` — Quick-start example and reference file index
- `nodes/stage.md` — `.stage()` API, `name` vs `agent`, null agent behavior, `StageOptions` reference
- `nodes/tool.md` — `.tool()` API, common use cases, `ToolOptions` reference
- `nodes/ask-user-question.md` — `.askUserQuestion()` API, static/dynamic questions, multi-select, `onAnswer` mapping
- `control-flow.md` — Conditionals (`.if()` / `.endIf()`) and bounded loops (`.loop()` / `.break()`)
- `state-and-reducers.md` — `globalState`, `loopState`, reducers, data flow declarations
- `session-config.md` — Per-stage session overrides, system prompt resolution order
- `discovery-and-verification.md` — Workflow file discovery, export format, verifier CLI

## How Workflows Work

A workflow is a TypeScript file that chains `.stage()`, `.tool()`, `.askUserQuestion()`, `.if()`, `.loop()`, and other methods to define a directed graph of agent stages. The chain reads top-to-bottom as the execution order. At the end, `.compile()` validates the structure and produces a `WorkflowDefinition`.

Each `.stage()` launches a fresh agent session with its own context window. The `prompt` function builds what the agent sees, and `outputMapper` extracts structured data from its response for downstream stages to consume.

Workflows are saved to `.atomic/workflows/<name>.ts` (local) or `~/.atomic/workflows/<name>.ts` (global), and exported as the default export.

## Authoring Process

### 1. Understand the User's Goal

Ask the user what they want to automate. Key questions:

- What are the distinct steps? (Each step typically becomes a `.stage()`)
- Do any steps need to repeat? (Use `.loop()` / `.break()` / `.endLoop()`)
- Are there conditional paths? (Use `.if()` / `.elseIf()` / `.else()` / `.endIf()`)
- What data flows between steps? (Declare `reads` and `outputs`)
- Does the workflow need user input at any point? (Use `.askUserQuestion()`)
- Do any steps need a specific model or config? (Use `sessionConfig`)

### 2. Design the Stage Graph

Map the user's intent to a sequence of stages. Each stage needs:

- **`name`** — unique key used to reference this stage's output downstream (via `ctx.stageOutputs.get("<name>")`)
- **`agent`** *(optional)* — which agent definition to invoke. When `null` or omitted, the stage uses the SDK's default session instructions. Multiple stages can share the same agent.
- **`description`** — short label for logging
- **`prompt`** — function that builds the prompt from `StageContext`
- **`outputMapper`** — function that extracts structured data from the raw response

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
  // Chain stages, tools, conditionals, and loops here
  .stage({
    name: "<unique-stage-name>",
    agent: "<agent-definition>",
    description: "<STAGE LABEL>",
    outputs: ["<field-names-this-stage-produces>"],
    prompt: (ctx) => `Your prompt using ${ctx.userPrompt}`,
    outputMapper: (response) => ({ /* structured output */ }),
  })
  .compile();
```

### 4. Verify the Workflow

After writing, remind the user to run verification:

```bash
atomic workflow verify .atomic/workflows/<workflow-name>.ts
```

This checks reachability, termination, deadlock-freedom, loop bounds, and state data-flow.

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
  reads: ["tasks"],
  outputs: ["isValid"],
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
  onAnswer: (answer) => ({ planApproved: answer === "Approve" }),
  outputs: ["planApproved"],
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
      findings: { default: [], reducer: "concat" },
      score: { default: 0, reducer: "max" },
      tasks: { default: [], reducer: "mergeById", key: "id" },
    },
  })
  // ...stages...
  .compile();
```

Built-in reducers: `replace` (default), `concat`, `merge`, `mergeById`, `max`, `min`, `sum`, `or`, `and`. Custom functions also work: `reducer: (current, update) => ...`.

### Per-Stage Session Config

Override model, reasoning effort, or permissions for specific stages:

```ts
.stage({
  name: "deep-review",
  agent: "reviewer",
  description: "DEEP REVIEW",
  prompt: (ctx) => `Thoroughly review: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ reviewResult: JSON.parse(response) }),
  sessionConfig: {
    model: "claude-opus-4-20250514",
    reasoningEffort: "high",
    maxThinkingTokens: 32000,
  },
})
```

Omitted fields inherit from the parent session automatically.

## Common Mistakes to Avoid

1. **Duplicate stage names** — every `name` must be unique. The builder throws at definition time if it detects a duplicate.

2. **Forgetting `.compile()`** — the chain must end with `.compile()` to produce a valid `WorkflowDefinition`.

3. **Unbalanced control flow** — every `.if()` needs `.endIf()`, every `.loop()` needs `.endLoop()`. The compiler rejects unbalanced blocks.

4. **`.break()` outside a loop** — `.break()` can only appear inside `.loop()` / `.endLoop()`. The builder throws immediately if misplaced.

5. **Referencing a stage that hasn't run yet** — `ctx.stageOutputs.get("<name>")` only has data from stages that have already executed. The data-flow verifier catches undeclared reads.

6. **Not exporting as default** — workflow files must use `export default` so the discovery system can load them.

## Reference

For the complete API, see the reference files in `references/`. Start with `references/getting-started.md` for an index of all topic files.
