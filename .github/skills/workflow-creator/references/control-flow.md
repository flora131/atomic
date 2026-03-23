# Control Flow

## Conditional branching

Use `.if()` / `.elseIf()` / `.else()` / `.endIf()` for conditional execution. Conditions receive a `StageContext` and return a boolean:

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

### Rules

- Every `.if()` must have a matching `.endIf()`. The compiler rejects unbalanced blocks.
- Every branch (if, elseIf, else) must contain at least one `.stage()` or `.tool()`.
- `.elseIf()` and `.else()` are optional — a bare `.if()` / `.endIf()` is valid.
- Conditionals can be nested inside other conditionals or loops.

## Bounded loops

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

### `.break()`

The `.break()` method accepts an optional factory function that creates a fresh predicate per execution. The loop exits when the predicate returns `true`. Omit the argument for an unconditional break (useful inside `.if()` blocks).

```ts
// Conditional break — exits loop when predicate returns true
.break(() => (state) => state.reviewResult?.allPassing === true)

// Unconditional break — always exits (use inside .if() to make it conditional)
.if((ctx) => ctx.stageOutputs.get("review")?.parsedOutput?.allPassing)
  .break()
.endIf()
```

### `LoopOptions` reference

| Field       | Type                             | Required | Default | Description                                  |
| ----------- | -------------------------------- | -------- | ------- | -------------------------------------------- |
| `maxCycles` | `number`                         | no       | `100`   | Hard upper bound on iterations               |
| `loopState` | `Record<string, StateFieldOptions>` | no    |         | State fields scoped to this loop (see `state-and-reducers.md`) |

### Rules

- Every `.loop()` must have a matching `.endLoop()`. The compiler rejects unbalanced blocks.
- `.break()` can only appear inside a `.loop()` / `.endLoop()` block. The builder throws immediately if misplaced.
- Loops can be nested. Each loop has its own independent iteration counter.
- `.break()` inside a nested loop exits the innermost enclosing loop only.
- `maxCycles` and `.break()` are independent termination mechanisms — either can end the loop.
