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

`T` defaults to `JsonValue` when not specified — meaning all state field values must be JSON-serializable (strings, numbers, booleans, null, arrays, or plain objects). When you provide a `default` value, TypeScript infers the concrete type automatically:

```ts
globalState: {
  count: { default: 0 },              // T inferred as number
  items: { default: () => [] as string[] },  // T inferred as string[]
  approved: { default: false },        // T inferred as boolean
}
```

Custom reducer functions get correctly typed parameters matching the inferred `T`:

```ts
globalState: {
  log: {
    default: () => [] as string[],
    reducer: (current: string[], update: string[]) => [...current, ...update].slice(-50),
    // ↑ TypeScript knows current and update are string[], not JsonValue
  },
}
```

## Type inference with `InferState`

When you declare `globalState`, the SDK uses the `InferState` utility type to derive a concrete state type from your field defaults. This means `ctx.state` in prompt functions and `.if()` conditions is fully typed — not `BaseState` with loose `JsonValue` fields, but a precise intersection type:

```ts
const workflow = defineWorkflow({
  name: "typed-example",
  description: "Type inference demo",
  globalState: {
    count: { default: 0, reducer: "sum" },
    items: { default: () => [] as string[], reducer: "concat" },
    approved: { default: false },
  },
});

// In .stage() prompt:
// ctx.state.count   → number
// ctx.state.items   → string[]
// ctx.state.approved → boolean
// ctx.state.outputs  → Record<string, Record<string, JsonValue>> (from BaseState)
```

This type inference is what makes the builder generic — `WorkflowBuilder<TState>` carries the inferred state type through all chained methods, so `.if()` conditions, `.stage()` prompts, and `.tool()` execute functions all see the same typed `ctx.state`.

**Tip:** Use `as const` on string literal defaults if you want narrow string types, and `as Type[]` casts on factory defaults to get precise array element types.

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
