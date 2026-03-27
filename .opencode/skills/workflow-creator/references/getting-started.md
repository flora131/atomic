# Workflow Authors: Getting Started

This guide is for authors creating custom workflows using the `defineWorkflow()` chainable DSL.

## Quick-start example

Use the chainable builder to declare your workflow's metadata, stages, and execution flow in a single file. The chain of method calls **is** the graph — reading top-to-bottom shows the execution order.

```ts
// .atomic/workflows/my-workflow.ts
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "my-workflow",
    description: "A three-stage pipeline",
  })
  .version("1.0.0")
  .stage({
    name: "plan",
    agent: "planner",
    description: "PLANNER",
    prompt: (ctx) => `Decompose this into tasks:\n${ctx.userPrompt}`,
    outputMapper: (response) => ({ tasks: JSON.parse(response) }),
  })
  .stage({
    name: "execute",
    agent: null,
    description: "EXECUTOR",
    prompt: (ctx) => `Execute these tasks:\n${JSON.stringify(ctx.stageOutputs.get("plan")?.parsedOutput)}`,
    outputMapper: () => ({}),
  })
  .stage({
    name: "review",
    agent: "reviewer",
    description: "REVIEWER",
    prompt: (ctx) => `Review the implementation against: ${ctx.userPrompt}`,
    outputMapper: (response) => ({ reviewResult: JSON.parse(response) }),
  })
  .compile();
```

Reading top-to-bottom: `plan → execute → review`. No separate flow config needed.

Note that the `execute` stage sets `agent: null` — it runs with the SDK's default session instructions instead of a custom agent definition. Both `name` and `agent` are required on every stage. See `nodes/stage.md` for details.

## Reference files

| File | Topic |
|---|---|
| `nodes/stage.md` | `.stage()` API, `name` vs `agent`, null agent behavior, `StageOptions` reference |
| `nodes/tool.md` | `.tool()` API, common use cases, `ToolOptions` reference |
| `nodes/ask-user-question.md` | `.askUserQuestion()` API, static/dynamic questions, multi-select, `outputMapper` mapping |
| `control-flow.md` | `.if()` / `.elseIf()` / `.else()` / `.endIf()` conditionals, `.loop()` / `.break()` / `.endLoop()` bounded loops |
| `state-and-reducers.md` | `globalState`, `loopState`, `StateFieldOptions`, built-in reducers, data flow declarations |
| `session-config.md` | Per-stage `sessionConfig` overrides, system prompt resolution order |
| `discovery-and-verification.md` | Workflow file discovery paths, `export default`, verifier checks and CLI |

## Type safety

The SDK is fully typed with **zero `unknown` or `any`** annotations. All data flowing between stages uses the `JsonValue` type — a recursive type covering all JSON-serializable values. `outputMapper` functions return `Record<string, JsonValue>`, and the compiler validates data flow statically.

The SDK also exports **Zod schemas** for runtime validation of core data structures (e.g., `TaskItemSchema`, `StageOutputSchema`, `SessionConfigSchema`). Import them alongside the builder for `.parse()` or `.safeParse()` validation in `.tool()` nodes.
