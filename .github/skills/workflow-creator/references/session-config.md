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
  // Override the model for this stage only
  sessionConfig: { model: "claude-sonnet-4-5-20250514" },
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
    model: "claude-opus-4-20250514",
    reasoningEffort: "high",
    maxThinkingTokens: 32000,
  },
})
```

## `SessionConfig` fields

| Field                    | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `model`                  | Model ID to use for this stage                        |
| `systemPrompt`           | Completely replaces the default system prompt (overrides agent resolution) |
| `additionalInstructions` | Extra system instructions appended to the default prompt (ignored when `systemPrompt` is set) |
| `reasoningEffort`        | Reasoning level (`"low"`, `"medium"`, `"high"`)       |
| `maxThinkingTokens`      | Extended thinking token budget                        |
| `permissionMode`         | Tool permission mode (`"auto"`, `"prompt"`, `"deny"`) |
| `agentMode`              | OpenCode agent mode                                   |
| `maxTurns`               | Maximum conversation turns for this stage             |

When a field is omitted, the user's current session config is used. When a field is explicitly set, it overrides the parent for that stage only.

## System prompt resolution order

The system prompt for a stage is determined by this priority:

1. **`sessionConfig.systemPrompt`** — if set explicitly, this replaces everything.
2. **`agent` definition body** — if `agent` is set to a named agent, the compiler reads the agent definition file's markdown body and injects it as the system prompt.
3. **SDK defaults** — if `agent` is `null`/omitted and no `systemPrompt` is set, the SDK's built-in instructions are preserved (e.g., Claude Code preset, Copilot guardrails).

Use `additionalInstructions` when you want to augment (not replace) the default prompt.
