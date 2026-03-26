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

## Data flow declarations

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

The verifier checks that every `reads` field has a preceding `outputs` declaration on all execution paths.

> **Auto-inference:** When `reads` or `outputs` are omitted, the compiler can automatically infer them — it uses Proxy-based state tracking to detect which fields your `prompt`, `execute`, or `question` functions access, and inspects `outputMapper`/`onAnswer` return keys. Explicit declarations are still recommended for clarity and to catch data-flow errors early via the verifier.
