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

When you declare `globalState`, the SDK infers concrete types automatically via `InferState` — so `ctx.state.count` is `number` (not `JsonValue`) when you write `count: { default: 0 }`. This gives full IDE autocomplete and type checking in prompt functions and `.if()` conditions.

## SDK Exports

The SDK (`@bastani/atomic-workflows`) exports everything you need for workflow authoring:

**Builder:**
- `defineWorkflow` — entry point, returns a chainable `WorkflowBuilder`
- `WorkflowBuilder` — the builder class (rarely needed directly)

**Zod schemas** (for runtime validation in `.tool()` nodes):
- `TaskItemSchema` — validates task items (`{ id, description, status, summary, blockedBy? }`)
- `StageOutputSchema` — validates stage outputs
- `SessionConfigSchema` — validates session config objects
- `AgentTypeSchema` — validates agent type strings (`"claude" | "opencode" | "copilot"`)
- `AskUserQuestionConfigSchema` — validates question config objects
- `JsonValueSchema` — recursive schema matching `JsonValue`

```ts
import { defineWorkflow, TaskItemSchema } from "@bastani/atomic-workflows";

// Use in .tool() nodes for runtime validation:
.tool({
  name: "validate-tasks",
  execute: async (ctx) => {
    const result = TaskItemSchema.array().safeParse(ctx.state.tasks);
    return { tasksValid: result.success };
  },
})
```

**Types** (import with `import type`):
- `BaseState`, `InferState`, `StageContext`, `ExecutionContext` — context types for callbacks
- `StageOptions`, `ToolOptions`, `AskUserQuestionOptions`, `LoopOptions` — node config types
- `StateFieldOptions`, `BuiltinReducer` — state declaration types
- `SessionConfig`, `AgentType` — session config types
- `StageOutput`, `TaskItem`, `JsonValue` — data types
- `CompiledWorkflow`, `WorkflowOptions` — workflow-level types

**Constants:**
- `BUILTIN_REDUCERS` — tuple of all 9 built-in reducer names (`["replace", "concat", "merge", ...]`)
