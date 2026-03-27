# `.stage()` — Agent Sessions

Each `.stage()` creates an isolated agent session with a fresh context window. The `prompt` function builds the prompt, and `outputMapper` extracts structured data from the response.

## Required fields

Every stage requires both a `name` and an `agent` field:

- **`name`** — a unique key for this stage within the workflow. Used as the key in `ctx.stageOutputs` so downstream stages can reference this stage's output unambiguously. The builder throws at definition time if a duplicate name is detected. Must be unique across all node types (stages, tools, ask-user nodes).
- **`agent`** *(required)* — the agent definition to invoke for this stage. Set to an agent name string (e.g., `"planner"`) to load that agent's system prompt, or `null` to run with the SDK's **default session instructions** (e.g., Claude Code preset, Copilot guardrails). Multiple stages can share the same `agent` — the `name` is what keeps them distinct.

```ts
// Stage with a named agent definition
.stage({
  name: "plan",                  // Unique stage key (used in ctx.stageOutputs)
  agent: "planner",              // Agent definition to invoke
  description: "PLANNER",
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ tasks: parseTasks(response) }),
})

// Stage with null agent — uses SDK default instructions
.stage({
  name: "implement",
  agent: null,                   // No agent definition — SDK defaults
  description: "IMPLEMENTER",
  prompt: (ctx) => `Implement the following:\n${ctx.userPrompt}`,
  outputMapper: () => ({}),
})
```

## `name` vs `agent`

`name` identifies the stage, `agent` selects which sub-agent to run. The same agent definition can power multiple stages with different purposes, and each is referenced by its own `name`:

```ts
.stage({ name: "draft",   agent: "writer", prompt: (ctx) => `Write a draft for: ${ctx.userPrompt}`, ... })
.stage({ name: "revise",  agent: "writer", prompt: (ctx) => `Revise this draft:\n${ctx.stageOutputs.get("draft")?.rawResponse}`, ... })
.stage({ name: "polish",  agent: "writer", prompt: (ctx) => `Polish this text:\n${ctx.stageOutputs.get("revise")?.rawResponse}`, ... })
```

Downstream stages access prior outputs via `ctx.stageOutputs.get("<name>")` — each key is always the explicit `name` you chose, so there is never any ambiguity.

## `StageOptions` reference

| Field            | Type                                           | Required | Description                                                     |
| ---------------- | ---------------------------------------------- | -------- | --------------------------------------------------------------- |
| `name`           | `string`                                       | **yes**  | Unique stage key (used in `ctx.stageOutputs`)                   |
| `agent`          | `string \| null`                               | **yes**  | Agent definition name, or `null` for SDK defaults               |
| `description`    | `string`                                       | **yes**  | Short label for logging and UI indicators                       |
| `prompt`         | `(ctx: StageContext) => string`                 | **yes**  | Builds the prompt sent to the agent session                     |
| `outputMapper`   | `(response: string) => Record<string, JsonValue>` | **yes** | Extracts structured data from the raw response                  |
| `sessionConfig`  | `Partial<SessionConfig>`                       | no       | Per-stage session overrides (see `session-config.md`)           |
| `maxOutputBytes` | `number`                                       | no       | Max byte size for raw response forwarded to downstream stages   |
