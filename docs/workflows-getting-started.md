# Workflow Authors: Getting Started

This guide is for authors creating custom workflows using the `defineWorkflow()` chainable DSL.

## 1) Define a workflow with `defineWorkflow()`

Use the chainable builder to declare your workflow's metadata, stages, and execution flow in a single file. The chain of method calls **is** the graph — reading top-to-bottom shows the execution order.

```ts
// .atomic/workflows/my-workflow.ts
import { defineWorkflow } from "@atomic/workflows";

export default defineWorkflow("my-workflow", "A three-stage pipeline")
  .version("1.0.0")
  .stage("planner", {
    name: "Planner",
    description: "PLANNER",
    outputs: ["tasks"],
    prompt: (ctx) => `Decompose this into tasks:\n${ctx.userPrompt}`,
    outputMapper: (response) => ({ tasks: JSON.parse(response) }),
  })
  .stage("executor", {
    name: "Executor",
    description: "EXECUTOR",
    reads: ["tasks"],
    prompt: (ctx) => `Execute these tasks:\n${JSON.stringify(ctx.stageOutputs.get("planner")?.parsedOutput)}`,
    outputMapper: () => ({}),
  })
  .stage("reviewer", {
    name: "Reviewer",
    description: "REVIEWER",
    reads: ["tasks"],
    outputs: ["reviewResult"],
    prompt: (ctx) => `Review the implementation against: ${ctx.userPrompt}`,
    outputMapper: (response) => ({ reviewResult: JSON.parse(response) }),
  })
  .compile();
```

Reading top-to-bottom: `planner → executor → reviewer`. No separate flow config needed.

## 2) Stage vs Tool nodes

### `.stage()` — Agent sessions (LLM reasoning)

Each `.stage()` creates an isolated agent session with a fresh context window. The `prompt` function builds the prompt, and `outputMapper` extracts structured data from the response.

```ts
.stage("planner", {
  name: "Planner",
  description: "PLANNER",
  reads: ["previousData"],     // State fields this stage depends on
  outputs: ["tasks"],          // State fields this stage produces
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ tasks: parseTasks(response) }),
  sessionConfig: { model: "claude-sonnet-4-5-20250514" },  // Optional overrides
})
```

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
defineWorkflow("conditional-pipeline", "Branch based on analysis")
  .stage("analyzer", { ... })
  .if((ctx) => ctx.stageOutputs.get("analyzer")?.parsedOutput?.needsFix)
    .stage("fixer", { ... })
  .elseIf((ctx) => ctx.stageOutputs.get("analyzer")?.parsedOutput?.needsReview)
    .stage("reviewer", { ... })
  .else()
    .stage("reporter", { ... })
  .endIf()
  .stage("finalizer", { ... })
  .compile();
```

Reading top-to-bottom: `analyzer → (if needsFix: fixer | elif needsReview: reviewer | else: reporter) → finalizer`.

## 4) Bounded loops

Use `.loop()` / `.endLoop()` for iterative workflows with a maximum iteration bound:

```ts
defineWorkflow("iterative-review", "Review loop")
  .stage("executor", { ... })
  .loop({ until: (ctx) => ctx.stageOutputs.get("reviewer")?.parsedOutput?.allPassing, maxIterations: 5 })
    .stage("reviewer", { ... })
    .stage("fixer", { ... })
  .endLoop()
  .stage("deployer", { ... })
  .compile();
```

Reading top-to-bottom: `executor → [reviewer → fixer] (repeat up to 5x until allPassing) → deployer`.

## 5) Custom state with reducers

Use `.state()` to declare custom state fields with optional reducers for merging updates:

```ts
defineWorkflow("stateful", "Workflow with custom state")
  .state({
    tasks: { default: [], reducer: "mergeById", key: "id" },
    reviewResult: { default: null },
    fixesApplied: { default: false },
    debugReports: { default: [], reducer: "concat" },
    score: { default: 0, reducer: "max" },
  })
  .stage("planner", { ... })
  .compile();
```

Built-in reducers: `replace` (default), `concat`, `merge`, `mergeById`, `max`, `min`, `sum`, `or`, `and`. You can also pass a custom function: `reducer: (current, update) => ...`.

## 6) Data flow declarations

Each node declares which state fields it **reads** and which it **outputs**:

- `reads` — State fields this node depends on
- `outputs` — State fields this node produces

These declarations are contracts used for Z3 verification:

```ts
.stage("planner", {
  outputs: ["tasks"],                    // Produces tasks
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ tasks: parseTasks(response) }),
})
.stage("executor", {
  reads: ["tasks"],                      // Reads tasks from planner
  outputs: ["progress"],                 // Produces progress
  prompt: (ctx) => `Execute: ${JSON.stringify(ctx.stageOutputs.get("planner")?.parsedOutput)}`,
  outputMapper: (response) => ({ progress: parseProgress(response) }),
})
```

## 7) Discovery and registration

Custom workflow files are discovered from:

- `.atomic/workflows/*.ts` (local, highest priority)
- `~/.atomic/workflows/*.ts` (global)

Export your compiled workflow as the default export:

```ts
// .atomic/workflows/my-workflow.ts
import { defineWorkflow } from "@atomic/workflows";

export default defineWorkflow("my-workflow", "My custom workflow")
  .stage("step1", { ... })
  .stage("step2", { ... })
  .compile();
```

The `.compile()` result is a `WorkflowDefinition` that can be used directly — no unwrapping needed.

## 8) Z3 verification

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

## 9) Migration from legacy API

| Legacy API                          | New DSL                              |
| ----------------------------------- | ------------------------------------ |
| `WorkflowDefinition` object literal | `defineWorkflow().stage().compile()` |
| `createGraph()` / `graphConfig`     | Auto-generated by `.compile()`       |
| `conductorStages` array             | Auto-generated from `.stage()` calls |
| `StageDefinition.shouldRun`         | `.if()` / `.endIf()` in the chain    |
| `createState()` factory             | `.state()` schema with reducers      |
| `WorkflowSDK.init()`                | Removed — use `defineWorkflow()`     |
| Manual `NodeDefinition` + `Edge`    | Auto-generated by compiler           |
