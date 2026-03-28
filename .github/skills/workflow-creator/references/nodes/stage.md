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

## Agent Definitions

When a stage sets `agent` to a non-null string, that string must match the `name` field in a discovered agent definition file. The verifier treats a missing match as an error — the workflow will not pass verification.

### File format

Agent definitions are markdown files (`<agent-name>.md`) with YAML frontmatter followed by the system prompt body.

**Frontmatter fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `name` | **yes** | Agent name — must exactly match the `agent` value in `.stage()` |
| `description` | **yes** | One-line summary of what this agent does |
| `tools` | no | Array of tool names the agent can use (e.g., `["search", "read", "execute"]`) |

Everything after the frontmatter block becomes the agent's **system prompt** at runtime.

### Where to place agent files

Each SDK discovers agent definitions from its own directories:

| SDK | Local path | Global path |
|-----|-----------|-------------|
| Claude Code | `.claude/agents/<name>.md` | `~/.claude/agents/<name>.md` |
| Copilot CLI | `.github/agents/<name>.md` | `~/.copilot/agents/<name>.md` |
| OpenCode | `.opencode/agents/<name>.md` | `~/.opencode/agents/<name>.md` |

**Cross-SDK workflows:** Place the agent file in **all three** local agent directories so the workflow passes verification regardless of which CLI runs it.

### How to create an agent definition

1. **Choose a name** — a descriptive, lowercase identifier (e.g., `reviewer`, `planner`, `security-auditor`). This becomes both the filename and the `agent` value in `.stage()`.
2. **Write the system prompt** — define the agent's role, constraints, and expected output format in the markdown body after the frontmatter.
3. **Set frontmatter** — add `name`, `description`, and optionally `tools`.
4. **Save to agent directories** — place `<name>.md` in the appropriate directory (see table above).
5. **Reference in stage** — use `agent: "<name>"` in your `.stage()` call.
6. **Verify** — run `atomic workflow verify` to confirm the agent is discovered and the workflow passes.

### SDK-specific sub-agent guidance

Each SDK has its own conventions for sub-agent capabilities, tool access, and permissions. Use the DeepWiki MCP `ask_question` tool with these repositories to look up SDK-specific details:

| SDK | Repository | Example questions to ask |
|-----|-----------|--------------------------|
| Claude Code | `anthropics/claude-code` | "How do custom agents work?", "What tools can agents access?", "How are agent permissions configured?" |
| Copilot CLI | `github/copilot-sdk` | "How do custom agents work?", "What tools can agents access?", "How are agent permissions configured?" |
| OpenCode | `anomalyco/opencode` | "How do custom agents work?", "What tools can agents access?", "How are agent permissions configured?" |

### Example — end to end

**Step 1.** Create the agent definition file (e.g., `.claude/agents/reviewer.md`):

```markdown
---
name: reviewer
description: Reviews code changes for correctness, style, and security issues.
tools: ["search", "read", "execute"]
---

You are a code reviewer. Analyze the provided code changes and report:
1. Correctness issues (bugs, logic errors)
2. Style violations (naming, formatting)
3. Security concerns (injection, secrets, OWASP top 10)

Be concise. Use bullet points. Flag severity as HIGH / MEDIUM / LOW.
```

**Step 2.** Reference it in a workflow stage:

```ts
.stage({
  name: "review",
  agent: "reviewer",  // matches `name` in reviewer.md frontmatter
  description: "🔍 CODE REVIEW",
  prompt: (ctx) => `Review these changes:\n${ctx.stageOutputs.get("implement")?.rawResponse}`,
  outputMapper: (response) => ({ reviewFeedback: response }),
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
