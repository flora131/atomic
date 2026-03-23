# `.stage()` — Agent Sessions

Each `.stage()` creates an isolated agent session with a fresh context window. The `prompt` function builds the prompt, and `outputMapper` extracts structured data from the response.

## Identity fields

Every stage requires a `name` identity field and an optional `agent` field:

- **`name`** — a unique key for this stage within the workflow. Used as the key in `ctx.stageOutputs` so downstream stages can reference this stage's output unambiguously. The builder throws at definition time if a duplicate name is detected.
- **`agent`** *(optional, default: `null`)* — the agent definition to invoke for this stage (selects the sub-agent instruction set loaded at runtime). When `null` or omitted, the stage runs with the SDK's **default session instructions** (e.g., Claude Code preset, Copilot guardrails) instead of overwriting them with an agent definition's system prompt. Multiple stages can share the same `agent` — the `name` is what keeps them distinct.

```ts
.stage({
  name: "plan",                  // Unique stage key (used in ctx.stageOutputs)
  agent: "planner",              // Agent definition to invoke (null = use SDK defaults)
  description: "PLANNER",
  reads: ["previousData"],       // State fields this stage depends on
  outputs: ["tasks"],            // State fields this stage produces
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ tasks: parseTasks(response) }),
  sessionConfig: { model: "claude-sonnet-4-5-20250514" },  // Optional overrides
})
```

## `name` vs `agent`

`name` identifies the stage, `agent` selects which sub-agent to run. This means the same agent definition can power multiple stages with different purposes, and each is referenced by its own `name`:

```ts
.stage({ name: "draft",   agent: "writer", prompt: (ctx) => `Write a draft for: ${ctx.userPrompt}`, ... })
.stage({ name: "revise",  agent: "writer", prompt: (ctx) => `Revise this draft:\n${ctx.stageOutputs.get("draft")?.rawResponse}`, ... })
.stage({ name: "polish",  agent: "writer", prompt: (ctx) => `Polish this text:\n${ctx.stageOutputs.get("revise")?.rawResponse}`, ... })
```

When `agent` is omitted, the stage uses the SDK's built-in instructions as-is — useful when you want the raw coding agent behavior without a custom system prompt:

```ts
// No agent definition — uses the SDK's default session instructions
.stage({
  name: "implement",
  description: "IMPLEMENTER",
  prompt: (ctx) => `Implement the following:\n${ctx.userPrompt}`,
  outputMapper: () => ({}),
})
```

Downstream stages access prior outputs via `ctx.stageOutputs.get("<name>")` — each key is always the explicit `name` you chose, so there is never any ambiguity.

## `StageOptions` reference

| Field            | Type                                           | Required | Description                                                     |
| ---------------- | ---------------------------------------------- | -------- | --------------------------------------------------------------- |
| `name`           | `string`                                       | yes      | Unique stage key (used in `ctx.stageOutputs`)                   |
| `agent`          | `string \| null`                               | no       | Agent definition name (`null` = SDK defaults)                   |
| `description`    | `string`                                       | yes      | Short label for logging and UI indicators                       |
| `prompt`         | `(ctx: StageContext) => string`                 | yes      | Builds the prompt sent to the agent session                     |
| `outputMapper`   | `(response: string) => Record<string, unknown>` | yes     | Extracts structured data from the raw response                  |
| `sessionConfig`  | `Partial<SessionConfig>`                       | no       | Per-stage session overrides (see `session-config.md`)           |
| `maxOutputBytes` | `number`                                       | no       | Max byte size for raw response forwarded to downstream stages   |
| `reads`          | `string[]`                                     | no       | State fields this stage depends on                              |
| `outputs`        | `string[]`                                     | no       | State fields this stage produces                                |
