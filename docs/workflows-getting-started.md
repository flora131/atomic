# Workflow Authors: Getting Started

This guide is for authors creating custom workflows using the `defineWorkflow()` chainable DSL.

## 1) Define a workflow with `defineWorkflow()`

Use the chainable builder to declare your workflow's metadata, stages, and execution flow in a single file. The chain of method calls **is** the graph — reading top-to-bottom shows the execution order.

```ts
// .atomic/workflows/my-workflow.ts
import { defineWorkflow } from "@atomic/workflows";

export default defineWorkflow({
    name: "my-workflow",
    description: "A three-stage pipeline",
  })
  .version("1.0.0")
  .stage({
    name: "plan",
    agent: "planner",
    description: "PLANNER",
    outputs: ["tasks"],
    prompt: (ctx) => `Decompose this into tasks:\n${ctx.userPrompt}`,
    outputMapper: (response) => ({ tasks: JSON.parse(response) }),
  })
  .stage({
    name: "execute",
    agent: "executor",
    description: "EXECUTOR",
    reads: ["tasks"],
    prompt: (ctx) => `Execute these tasks:\n${JSON.stringify(ctx.stageOutputs.get("plan")?.parsedOutput)}`,
    outputMapper: () => ({}),
  })
  .stage({
    name: "review",
    agent: "reviewer",
    description: "REVIEWER",
    reads: ["tasks"],
    outputs: ["reviewResult"],
    prompt: (ctx) => `Review the implementation against: ${ctx.userPrompt}`,
    outputMapper: (response) => ({ reviewResult: JSON.parse(response) }),
  })
  .compile();
```

Reading top-to-bottom: `plan → execute → review`. No separate flow config needed.

## 2) Stage vs Tool nodes

### `.stage()` — Agent sessions (LLM reasoning)

Each `.stage()` creates an isolated agent session with a fresh context window. The `prompt` function builds the prompt, and `outputMapper` extracts structured data from the response.

Every stage requires two identity fields:

- **`name`** — a unique key for this stage within the workflow. Used as the key in `ctx.stageOutputs` so downstream stages can reference this stage's output unambiguously. The builder throws at definition time if a duplicate name is detected.
- **`agent`** — the agent definition to invoke for this stage (selects the sub-agent instruction set loaded at runtime). Multiple stages can share the same `agent` — the `name` is what keeps them distinct.

```ts
.stage({
  name: "plan",                  // Unique stage key (used in ctx.stageOutputs)
  agent: "planner",              // Agent definition to invoke
  description: "PLANNER",
  reads: ["previousData"],       // State fields this stage depends on
  outputs: ["tasks"],            // State fields this stage produces
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ tasks: parseTasks(response) }),
  sessionConfig: { model: "claude-sonnet-4-5-20250514" },  // Optional overrides
})
```

#### `name` vs `agent`

`name` identifies the stage, `agent` selects which sub-agent to run. This means the same agent definition can power multiple stages with different purposes, and each is referenced by its own `name`:

```ts
.stage({ name: "draft",   agent: "writer", prompt: (ctx) => `Write a draft for: ${ctx.userPrompt}`, ... })
.stage({ name: "revise",  agent: "writer", prompt: (ctx) => `Revise this draft:\n${ctx.stageOutputs.get("draft")?.rawResponse}`, ... })
.stage({ name: "polish",  agent: "writer", prompt: (ctx) => `Polish this text:\n${ctx.stageOutputs.get("revise")?.rawResponse}`, ... })
```

Downstream stages access prior outputs via `ctx.stageOutputs.get("<name>")` — each key is always the explicit `name` you chose, so there is never any ambiguity.

### `.tool()` — Deterministic functions (no LLM)

`.tool()` executes an arbitrary async function directly — no agent session, no prompt. Use it for validation, I/O, data transforms, and notifications.

```ts
.tool("validate-schema", {
  name: "Schema Validator",
  reads: ["tasks"],
  outputs: ["schemaValid"],
  execute: async (ctx) => {
    const valid = ctx.state.tasks.every((t) => t.id && t.description);
    return { schemaValid: valid };
  },
})
```

## 3) Conditional branching

Use `.if()` / `.elseIf()` / `.else()` / `.endIf()` for conditional execution:

```ts
defineWorkflow({ name: "conditional-pipeline", description: "Branch based on analysis" })
  .stage({ name: "analyze", agent: "analyzer", ... })
  .if((ctx) => ctx.stageOutputs.get("analyze")?.parsedOutput?.needsFix)
    .stage({ name: "fix", agent: "fixer", ... })
  .elseIf((ctx) => ctx.stageOutputs.get("analyze")?.parsedOutput?.needsReview)
    .stage({ name: "review", agent: "reviewer", ... })
  .else()
    .stage({ name: "report", agent: "reporter", ... })
  .endIf()
  .stage({ name: "finalize", agent: "finalizer", ... })
  .compile();
```

Reading top-to-bottom: `analyze → (if needsFix: fix | elif needsReview: review | else: report) → finalize`.

## 4) Bounded loops

Use `.loop()` / `.endLoop()` for iterative workflows with a maximum iteration bound. Use `.break()` inside the loop body for conditional early termination:

```ts
defineWorkflow({ name: "iterative-review", description: "Review loop" })
  .stage({ name: "execute", agent: "executor", ... })
  .loop({ maxCycles: 5 })
    .stage({ name: "review", agent: "reviewer", ... })
    .break(() => {
      // Factory: returns a fresh predicate per execution
      return (state) => state.reviewResult?.allPassing === true;
    })
    .stage({ name: "fix", agent: "fixer", ... })
  .endLoop()
  .stage({ name: "deploy", agent: "deployer", ... })
  .compile();
```

Reading top-to-bottom: `execute → [review → break? → fix] (repeat up to 5x) → deploy`.

The `.break()` method accepts an optional factory function that creates a fresh predicate per execution. The loop exits when the predicate returns `true`. Omit the argument for an unconditional break (useful inside `.if()` blocks).

## 5) Custom state with reducers

Declare custom state fields with optional reducers using `globalState` in `defineWorkflow()` for workflow-wide state, or `loopState` in `.loop()` for loop-scoped state:

### `globalState` — Workflow-wide state

```ts
defineWorkflow({
    name: "stateful",
    description: "Workflow with custom state",
    globalState: {
      tasks: { default: [], reducer: "mergeById", key: "id" },
      reviewResult: { default: null },
      fixesApplied: { default: false },
      debugReports: { default: [], reducer: "concat" },
      score: { default: 0, reducer: "max" },
    },
  })
  .stage({ name: "plan", agent: "planner", ... })
  .compile();
```

### `loopState` — Loop-scoped state

```ts
defineWorkflow({ name: "iterative", description: "Loop with scoped state" })
  .stage({ name: "execute", agent: "executor", ... })
  .loop({
    maxCycles: 5,
    loopState: {
      iterationCount: { default: 0, reducer: "sum" },
      findings: { default: [], reducer: "concat" },
    },
  })
    .stage({ name: "review", agent: "reviewer", ... })
    .break(() => (state) => state.iterationCount >= 3)
    .stage({ name: "fix", agent: "fixer", ... })
  .endLoop()
  .compile();
```

Both `globalState` and `loopState` fields are merged into a single state schema at compile time. If both define the same field, `loopState` takes precedence.

Built-in reducers: `replace` (default), `concat`, `merge`, `mergeById`, `max`, `min`, `sum`, `or`, `and`. You can also pass a custom function: `reducer: (current, update) => ...`.

## 6) Session configuration

By default, each stage inherits the parent session's configuration — model, reasoning effort, thinking token budget, permission mode, and additional instructions all carry forward automatically. Use `sessionConfig` on a stage to override any of these per stage:

```ts
.stage({
  name: "plan",
  agent: "planner",
  description: "PLANNER",
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ tasks: parseTasks(response) }),
  // Override the model for this stage only
  sessionConfig: { model: "claude-sonnet-4-5-20250514" },
})
.stage({
  name: "execute",
  agent: "executor",
  description: "EXECUTOR",
  prompt: (ctx) => `Execute: ${JSON.stringify(ctx.stageOutputs.get("plan")?.parsedOutput)}`,
  outputMapper: () => ({}),
  // Uses the parent session's model (inherited automatically)
})
.stage({
  name: "review",
  agent: "reviewer",
  description: "REVIEWER",
  prompt: (ctx) => `Review: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ reviewResult: JSON.parse(response) }),
  // Use a reasoning model with custom effort for review
  sessionConfig: {
    model: "claude-opus-4-20250514",
    reasoningEffort: "high",
    maxThinkingTokens: 32000,
  },
})
```

Available `sessionConfig` fields:

| Field                    | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `model`                  | Model ID to use for this stage                        |
| `reasoningEffort`        | Reasoning level (`"low"`, `"medium"`, `"high"`)       |
| `maxThinkingTokens`      | Extended thinking token budget                        |
| `additionalInstructions` | Extra system instructions appended to the prompt      |
| `permissionMode`         | Tool permission mode (`"auto"`, `"prompt"`, `"deny"`) |
| `agentMode`              | OpenCode agent mode                                   |
| `maxTurns`               | Maximum conversation turns for this stage             |

When a field is omitted, the user's current session config is used. When a field is explicitly set, it overrides the parent for that stage only.

## 7) Data flow declarations

Each node declares which state fields it **reads** and which it **outputs**:

- `reads` — State fields this node depends on
- `outputs` — State fields this node produces

These declarations are contracts used for verification:

```ts
.stage({
  name: "plan",
  agent: "planner",
  description: "PLANNER",
  outputs: ["tasks"],                    // Produces tasks
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ tasks: parseTasks(response) }),
})
.stage({
  name: "execute",
  agent: "executor",
  description: "EXECUTOR",
  reads: ["tasks"],                      // Reads tasks from plan stage
  outputs: ["progress"],                 // Produces progress
  prompt: (ctx) => `Execute: ${JSON.stringify(ctx.stageOutputs.get("plan")?.parsedOutput)}`,
  outputMapper: (response) => ({ progress: parseProgress(response) }),
})
```

## 8) Discovery and registration

Custom workflow files are discovered from:

- `.atomic/workflows/*.ts` (local, highest priority)
- `~/.atomic/workflows/*.ts` (global)

Export your compiled workflow as the default export:

```ts
// .atomic/workflows/my-workflow.ts
import { defineWorkflow } from "@atomic/workflows";

export default defineWorkflow({ name: "my-workflow", description: "My custom workflow" })
  .stage({ name: "step1", agent: "step1", description: "Step 1", ... })
  .stage({ name: "step2", agent: "step2", description: "Step 2", ... })
  .compile();
```

The `.compile()` result is a `WorkflowDefinition` that can be used directly — no unwrapping needed.

## 9) Verification

All workflows are verified at load time for structural correctness:

1. **Reachability** — all nodes reachable from start
2. **Termination** — all paths reach an end node
3. **Deadlock-freedom** — no node can get stuck
4. **Loop bounds** — all loops have bounded iterations
5. **State data-flow** — all reads have preceding writes on all paths

### Running the verifier

Verify all discoverable workflows (built-in + custom):

```bash
atomic workflow verify
```

Verify a specific workflow file:

```bash
atomic workflow verify .atomic/workflows/my-workflow.ts
```

Example output:

```
Verifying workflows...

Workflow "my-workflow" passed all verification checks

  PASS  Reachability
  PASS  Termination
  PASS  Deadlock-Freedom
  PASS  Loop Bounds
  PASS  State Data-Flow

All workflows passed verification.
```

When verification fails, the report identifies the offending node/edge:

```
Workflow "broken-workflow" failed verification

  FAIL  Reachability: Node(s) "orphan" unreachable from start node "planner"
  PASS  Termination
  FAIL  Deadlock-Freedom: Node(s) "brancher" may deadlock
  PASS  Loop Bounds
  PASS  State Data-Flow
```

Workflows that fail verification at startup are rejected with a warning:

```
● Warning: Failed to load workflow: broken-workflow
```

The verifier exits with code 1 on any failure, making it suitable for CI pipelines.

## 10) Migration from legacy API

| Legacy API                          | New DSL                              |
| ----------------------------------- | ------------------------------------ |
| `WorkflowDefinition` object literal | `defineWorkflow().stage().compile()` |
| `createGraph()` / `graphConfig`     | Auto-generated by `.compile()`       |
| `conductorStages` array             | Auto-generated from `.stage()` calls |
| `StageDefinition.shouldRun`         | `.if()` / `.endIf()` in the chain    |
| `createState()` factory             | `globalState` / `loopState` options   |
| `WorkflowSDK.init()`                | Removed — use `defineWorkflow()`     |
| Manual `NodeDefinition` + `Edge`    | Auto-generated by compiler           |
