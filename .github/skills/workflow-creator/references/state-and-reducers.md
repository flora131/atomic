# State and Reducers

Declare custom state fields with optional reducers using `globalState` in `defineWorkflow()` for workflow-wide state, or `loopState` in `.loop()` for loop-scoped state.

## `globalState` — Workflow-wide state

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

## `loopState` — Loop-scoped state

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

## `StateFieldOptions` reference

| Field     | Type                                        | Required | Description                                    |
| --------- | ------------------------------------------- | -------- | ---------------------------------------------- |
| `default` | `T \| (() => T)`                            | yes      | Initial value (use a factory for mutable defaults like arrays) |
| `reducer` | `string \| ((current: T, update: T) => T)`  | no       | Merge strategy (default: `"replace"`)          |
| `key`     | `string`                                    | no       | Key field for `"mergeById"` reducer            |

## Built-in reducers

| Reducer      | Behavior                                           |
| ------------ | -------------------------------------------------- |
| `"replace"`  | New value replaces old (default)                   |
| `"concat"`   | Arrays concatenated; strings appended              |
| `"merge"`    | Objects shallow-merged (`Object.assign`)           |
| `"mergeById"`| Arrays of objects merged by `key` field            |
| `"max"`      | Keeps the larger numeric value                     |
| `"min"`      | Keeps the smaller numeric value                    |
| `"sum"`      | Adds old and new numeric values                    |
| `"or"`       | Logical OR of booleans                             |
| `"and"`      | Logical AND of booleans                            |

Custom functions also work: `reducer: (current, update) => ...`.

## Data flow (auto-inferred)

The compiler automatically infers which state fields each node **reads** and which it **produces** — you do not declare these manually. It works by inspecting your functions:

- **Reads** — For stages, the compiler uses Proxy-based state tracking to detect which `state.*` fields your `prompt` function accesses. For tools, it uses TypeScript AST analysis to statically determine which `ctx.state.*` fields your `execute` function reads (without running it, to avoid side effects). For ask-user nodes, it inspects the `question` function.
- **Outputs** — The compiler inspects the return keys of your `outputMapper` (or `execute` for tools) to determine which state fields each node produces.

```ts
.stage({
  name: "plan",
  agent: "planner",
  description: "PLANNER",
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ tasks: parseTasks(response) }),
  // ↑ compiler infers: outputs ["tasks"]
})
.stage({
  name: "execute",
  agent: "executor",
  description: "EXECUTOR",
  prompt: (ctx) => `Execute: ${JSON.stringify(ctx.stageOutputs.get("plan")?.parsedOutput)}`,
  outputMapper: (response) => ({ progress: parseProgress(response) }),
  // ↑ compiler infers: outputs ["progress"]
})
```

The verifier uses these inferred declarations to check that every field a node reads has a preceding write on all execution paths. If the verifier reports a state data-flow error, check that upstream stages actually return the field in their `outputMapper`.
