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

## `StageContext` reference

The `StageContext` object is passed to `prompt` functions and `.if()` / `.elseIf()` condition callbacks. It provides read-only access to the workflow's current state:

| Field              | Type                                          | Description                                                          |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------- |
| `userPrompt`       | `string`                                      | The original prompt the user passed when invoking the workflow        |
| `stageOutputs`     | `ReadonlyMap<string, StageOutput>`            | Outputs from previously executed stages, keyed by stage `name`       |
| `state`            | `TState` (your inferred state type)           | Current accumulated workflow state including all `outputMapper` results |
| `tasks`            | `readonly TaskItem[]`                         | Current task list (populated after planner stages)                   |
| `abortSignal`      | `AbortSignal`                                 | Signal to detect workflow cancellation                               |
| `contextPressure`  | `AccumulatedContextPressure \| undefined`     | Context window usage metrics across all stages (when configured)     |

```ts
prompt: (ctx) => {
  // Access the user's original prompt
  const task = ctx.userPrompt;

  // Access raw response from a prior stage
  const analysis = ctx.stageOutputs.get("analyze")?.rawResponse ?? "";

  // Access parsed/structured output from a prior stage
  const tasks = ctx.stageOutputs.get("plan")?.parsedOutput;

  // Access typed state (auto-inferred from globalState)
  const score = ctx.state.score;

  // Access current task list
  const pendingTasks = ctx.tasks.filter(t => t.status === "pending");

  return `Implement based on: ${analysis}`;
},
```

## `StageOutput` reference

Each entry in `ctx.stageOutputs` is a `StageOutput` object with these fields:

| Field              | Type                                    | Description                                                     |
| ------------------ | --------------------------------------- | --------------------------------------------------------------- |
| `stageId`          | `string`                                | The `name` of the stage that produced this output                |
| `rawResponse`      | `string`                                | The full raw text response from the agent session                |
| `parsedOutput`     | `Record<string, JsonValue> \| undefined`| Structured data returned by `outputMapper` (undefined if parsing failed) |
| `status`           | `"completed" \| "interrupted" \| "error"` | How the stage ended                                           |
| `error`            | `string \| undefined`                   | Error message if the stage failed                                |
| `contextUsage`     | `ContextPressureSnapshot \| undefined`  | Context window usage at completion                               |
| `continuations`    | `readonly ContinuationRecord[] \| undefined` | Records of any continuations triggered by context pressure  |
| `originalByteLength` | `number \| undefined`                 | Original byte size before any `maxOutputBytes` truncation        |

```ts
// Common access patterns in prompt functions:
const raw = ctx.stageOutputs.get("plan")?.rawResponse ?? "";
const parsed = ctx.stageOutputs.get("plan")?.parsedOutput;
const succeeded = ctx.stageOutputs.get("plan")?.status === "completed";
```
