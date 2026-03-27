# `.tool()` — Deterministic Functions

`.tool()` executes an arbitrary async function directly — no agent session, no prompt. Use it for validation, I/O, data transforms, and notifications.

## Usage

`.tool()` takes a single `ToolOptions` object. The `name` field is the unique node identifier (like `.stage()`):

```ts
.tool({
  name: "validate-schema",
  execute: async (ctx) => {
    const valid = ctx.state.tasks.every((t) => t.id && t.description);
    return { schemaValid: valid };
  },
})
```

The `execute` function receives an `ExecutionContext<BaseState>` with the current workflow state and returns a record of state updates that are merged into the workflow state.

## Common use cases

- **Validation** — check parsed output before proceeding (use Zod schemas for runtime validation)
- **Data transforms** — reshape or filter data between agent stages
- **File I/O** — read/write files as part of the pipeline
- **API calls** — fetch external data or trigger webhooks
- **Notifications** — emit events or log progress

## Validation with Zod schemas

The SDK exports Zod schemas that pair naturally with `.tool()` for runtime validation. This is especially useful for validating data produced by LLM stages before passing it downstream:

```ts
import { defineWorkflow, TaskItemSchema } from "@bastani/atomic-workflows";

// ...
.tool({
  name: "validate-tasks",
  description: "Validate planner output matches TaskItem schema",
  execute: async (ctx) => {
    const result = TaskItemSchema.array().safeParse(ctx.state.tasks);
    if (!result.success) {
      return {
        tasksValid: false,
        validationErrors: result.error.issues.map(i => i.message),
      };
    }
    return { tasksValid: true, validationErrors: [] };
  },
})
```

Available schemas: `TaskItemSchema`, `StageOutputSchema`, `SessionConfigSchema`, `AgentTypeSchema`, `AskUserQuestionConfigSchema`, `JsonValueSchema`.

## `ExecutionContext` reference

The `execute` function receives an `ExecutionContext` with access to the full workflow state:

| Field          | Type                          | Description                                                |
| -------------- | ----------------------------- | ---------------------------------------------------------- |
| `state`        | `TState`                      | Current workflow state (typed from `globalState`)          |
| `config`       | `GraphConfig`                 | Graph execution configuration                              |
| `errors`       | `ExecutionError[]`            | Errors from prior node executions                          |
| `abortSignal`  | `AbortSignal \| undefined`   | Signal to detect workflow cancellation                     |
| `emit`         | `((type: string, data?) => void) \| undefined` | Emit events to the workflow event bus |
| `getNodeOutput`| `((nodeId: string) => Record<string, JsonValue>) \| undefined` | Get a specific node's output |
| `model`        | `string \| undefined`        | Current model identifier                                   |

## `ToolOptions` reference

| Field          | Type                                                                    | Required | Description                                                |
| -------------- | ----------------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| `name`         | `string`                                                                | yes      | Unique node identifier (also used in logging)              |
| `execute`      | `(ctx: ExecutionContext<BaseState>) => Promise<Record<string, JsonValue>>` | yes      | The function to run                                        |
| `outputMapper` | `(result: Record<string, JsonValue>) => Record<string, JsonValue>`          | no       | Transforms the execute result before merging into state    |
| `description`  | `string`                                                                | no       | Description of what the tool does                          |
