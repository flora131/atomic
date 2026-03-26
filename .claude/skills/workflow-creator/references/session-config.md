# Session Configuration

By default, each stage inherits the parent session's configuration — model, reasoning effort, thinking token budget, permission mode, and additional instructions all carry forward automatically. Use `sessionConfig` on a stage to override any of these per stage.

## Example

```ts
.stage({
  name: "plan",
  agent: "planner",
  description: "PLANNER",
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ tasks: parseTasks(response) }),
  // Override the model per agent type for this stage only
  sessionConfig: {
    model: { claude: "claude-sonnet-4-5-20250514", copilot: "claude-sonnet-4" },
  },
})
.stage({
  name: "execute",
  description: "EXECUTOR",
  prompt: (ctx) => `Execute: ${JSON.stringify(ctx.stageOutputs.get("plan")?.parsedOutput)}`,
  outputMapper: () => ({}),
  // Uses the parent session's model (inherited automatically)
})
.stage({
  name: "review",
  agent: "reviewer",
  description: "REVIEWER",
  prompt: (ctx) => `Review: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ reviewResult: JSON.parse(response) }),
  // Use a reasoning model with custom effort for review
  sessionConfig: {
    model: { claude: "claude-opus-4-20250514" },
    reasoningEffort: { claude: "high" },
    maxThinkingTokens: 32000,
  },
})
```

## `SessionConfig` fields

`model` and `reasoningEffort` are keyed by agent type (`"claude" | "opencode" | "copilot"`) so a single workflow definition can declare per-SDK overrides. At runtime, the conductor resolves the correct entry for the active agent.

| Field                    | Type                                        | Description                                           |
| ------------------------ | ------------------------------------------- | ----------------------------------------------------- |
| `model`                  | `Partial<Record<AgentType, string>>`        | Model ID per agent type (e.g. `{ claude: "claude-opus-4-20250514" }`) |
| `sessionId`              | `string`                                    | Custom session identifier                             |
| `systemPrompt`           | `string`                                    | Completely replaces the default system prompt (overrides agent resolution) |
| `additionalInstructions` | `string`                                    | Extra system instructions appended to the default prompt (ignored when `systemPrompt` is set) |
| `tools`                  | `string[]`                                  | Tool names to enable for this stage                   |
| `permissionMode`         | `"auto" \| "prompt" \| "deny" \| "bypass"` | Tool permission mode                                  |
| `maxBudgetUsd`           | `number`                                    | Maximum spend in USD for this stage                   |
| `maxTurns`               | `number`                                    | Maximum conversation turns for this stage             |
| `reasoningEffort`        | `Partial<Record<AgentType, string>>`        | Reasoning level per agent type (e.g. `{ claude: "high" }`) |
| `maxThinkingTokens`      | `number`                                    | Extended thinking token budget                        |

Where `AgentType = "claude" | "opencode" | "copilot"`.

When a field is omitted, the user's current session config is used. When a field is explicitly set, it overrides the parent for that stage only.

## System prompt resolution order

The system prompt for a stage is determined by this priority:

1. **`sessionConfig.systemPrompt`** — if set explicitly, this replaces everything.
2. **`agent` definition body** — if `agent` is set to a named agent, the compiler reads the agent definition file's markdown body and injects it as the system prompt.
3. **SDK defaults** — if `agent` is `null`/omitted and no `systemPrompt` is set, the SDK's built-in instructions are preserved (e.g., Claude Code preset, Copilot guardrails).

Use `additionalInstructions` when you want to augment (not replace) the default prompt.
