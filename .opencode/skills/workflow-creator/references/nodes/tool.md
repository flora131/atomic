# `.tool()` — Deterministic Functions

`.tool()` executes an arbitrary async function directly — no agent session, no prompt. Use it for validation, I/O, data transforms, and notifications.

## Usage

`.tool()` takes a single `ToolOptions` object. The `name` field is the unique node identifier (like `.stage()`):

```ts
.tool({
  name: "validate-schema",
  reads: ["tasks"],
  outputs: ["schemaValid"],
  execute: async (ctx) => {
    const valid = ctx.state.tasks.every((t) => t.id && t.description);
    return { schemaValid: valid };
  },
})
```

The `execute` function receives an `ExecutionContext<BaseState>` with the current workflow state and returns a record of state updates that are merged into the workflow state.

## Common use cases

- **Validation** — check parsed output before proceeding
- **Data transforms** — reshape or filter data between agent stages
- **File I/O** — read/write files as part of the pipeline
- **API calls** — fetch external data or trigger webhooks
- **Notifications** — emit events or log progress

## `ToolOptions` reference

| Field         | Type                                                                    | Required | Description                                    |
| ------------- | ----------------------------------------------------------------------- | -------- | ---------------------------------------------- |
| `name`        | `string`                                                                | yes      | Unique node identifier (also used in logging)  |
| `execute`     | `(ctx: ExecutionContext<BaseState>) => Promise<Record<string, unknown>>` | yes      | The function to run                            |
| `description` | `string`                                                                | no       | Description of what the tool does              |
| `reads`       | `string[]`                                                              | no       | State fields this tool depends on              |
| `outputs`     | `string[]`                                                              | no       | State fields this tool produces                |
