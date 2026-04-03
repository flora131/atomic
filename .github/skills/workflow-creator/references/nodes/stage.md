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
  outputMapper: () => ({}),
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

## Agent Definitions

When `agent` is a non-null string, it must match the `name` in a discovered agent definition file. The verifier rejects unresolved agent names.

### Creating an agent definition

Agent definitions are markdown files with YAML frontmatter + a system prompt body. **The frontmatter schema differs per SDK** — always start by copying an existing agent from the target directory, never write frontmatter from scratch.

**Steps:**

1. **Pick a name** — lowercase, hyphenated identifier (e.g., `security-auditor`). This is both the filename and the `agent` value in `.stage()`.
2. **Copy a template from each SDK directory** — choose the closest existing agent (e.g., `reviewer.md`) and copy it to `<name>.md` in all three directories:
   - `.claude/agents/<name>.md`
   - `.opencode/agents/<name>.md`
   - `.github/agents/<name>.md`
3. **Edit each copy** — update `name`, `description`, `tools`/`permission`, and rewrite the system prompt body. Keep the frontmatter structure from the template intact.
4. **Reference in your workflow** — `agent: "<name>"` in `.stage()`.
5. **Run `atomic workflow verify`** — validates agent schemas and workflow structure in one pass. Catches frontmatter errors, missing agents, and structural issues.

All three directories are needed for cross-SDK workflows. Each SDK discovers agents only from its own directory.

### SDK-specific guidance

For details on tool access, permissions, or sub-agent capabilities, query DeepWiki with the relevant repository:

| SDK | DeepWiki repo |
|-----|--------------|
| Claude Code | `anthropics/claude-code` |
| Copilot CLI | `github/copilot-sdk` |
| OpenCode | `anomalyco/opencode` |

### Example

```ts
// After creating security-auditor.md in all three agent directories:
.stage({
  name: "audit",
  agent: "security-auditor",
  description: "🔍 SECURITY AUDIT",
  prompt: (ctx) => `Audit these changes:\n${ctx.stageOutputs.get("implement")?.rawResponse}`,
  outputMapper: (response) => ({ auditResult: response }),
})
```

```bash
# Validates agent schemas + workflow graph in one command
atomic workflow verify
```

### Frontmatter `model` field

Agent definition files can declare a `model` field in their YAML frontmatter to set a default model for stages that use this agent:

```yaml
# .claude/agents/reviewer.md
---
name: reviewer
description: Code reviewer for proposed code changes.
model: opus
---
```

At compile time, the compiler reads this field and merges it into the stage's `sessionConfig.model` under the agent type key inferred from the file's provider directory (`.claude/` → `claude`, `.opencode/` → `opencode`, `.github/`/`.copilot/` → `copilot`). This means stages using this agent automatically get the right model without repeating it in the DSL.

Explicit `sessionConfig.model` values in the DSL take precedence over frontmatter:

```ts
// Agent frontmatter has model: opus
// DSL override wins → this stage uses sonnet, not opus
.stage({
  name: "review",
  agent: "reviewer",
  sessionConfig: { model: { claude: "sonnet" } },
  // ...
})
```

See `session-config.md` for the full model resolution order.

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
| `disallowedTools`| `Partial<Record<AgentType, string[]>>`         | no       | Per-provider tool exclusions for this stage (see below)         |

## `disallowedTools` — per-provider tool exclusions

Use `disallowedTools` to prevent a stage from using specific tools. Keys are agent type identifiers (`"claude"`, `"opencode"`, `"copilot"`), and values are arrays of tool names to exclude for that provider. At runtime, the conductor resolves the entry for the active agent type and passes the tool names as excluded tools on the session config.

Agent definition files already declare their own `tools` allowlists via frontmatter — there is no need for a corresponding `tools` field on `.stage()`. Use `disallowedTools` to add **extra** exclusions beyond what the agent definition already restricts.

Each provider has its own tool naming conventions, so tool names must be specified per provider:

```ts
// Block ask-user-question tools (autonomous workflow — no human input)
.stage({
  name: "plan",
  agent: "planner",
  description: "PLANNER",
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: () => ({}),
  disallowedTools: {
    claude: ["AskUserQuestion"],
    opencode: ["question"],
    copilot: ["ask_user"],
  },
})
```

Only the entry matching the active agent type is applied. If a provider key is omitted, no extra exclusions are added for that provider.

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
| `originalByteLength` | `number \| undefined`                 | Original byte size before any `maxOutputBytes` truncation        |

```ts
// Common access patterns in prompt functions:
const raw = ctx.stageOutputs.get("plan")?.rawResponse ?? "";
const parsed = ctx.stageOutputs.get("plan")?.parsedOutput;
const succeeded = ctx.stageOutputs.get("plan")?.status === "completed";
```
