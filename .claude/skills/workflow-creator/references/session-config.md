# Session Configuration

By default, each stage inherits the parent session's configuration — model, reasoning effort, thinking token budget, permission mode, and additional instructions all carry forward automatically. Use `sessionConfig` on a stage to override any of these per stage.

## Example

```ts
.stage({
  name: "plan",
  agent: "planner",
  description: "PLANNER",
  prompt: (ctx) => `Plan: ${ctx.userPrompt}`,
  outputMapper: () => ({}),
  // Override the model per agent type for this stage only
  sessionConfig: {
    model: { claude: "sonnet", copilot: "claude-sonnet-4.6" },
  },
})
.stage({
  name: "execute",
  agent: null,
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
    model: { claude: "opus" },
    reasoningEffort: { claude: "high" },
    maxThinkingTokens: 32000,
  },
})
```

## `SessionConfig` fields

`model` and `reasoningEffort` are keyed by agent type (`"claude" | "opencode" | "copilot"`) so a single workflow definition can declare per-SDK overrides. At runtime, the conductor resolves the correct entry for the active agent.

| Field                    | Type                                        | Description                                           |
| ------------------------ | ------------------------------------------- | ----------------------------------------------------- |
| `model`                  | `Partial<Record<AgentType, string>>`        | Model per agent type — accepts aliases (e.g. `{ claude: "opus" }`) or full IDs |
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

### Provider-level override behavior

`model`, `reasoningEffort`, and `maxThinkingTokens` are treated as a group because they are tightly coupled — a reasoning effort or thinking budget from one model may be incompatible with another. The inheritance rule is:

- **If the stage mentions the active agent type** in any per-agent-type field (`model` or `reasoningEffort`), the stage takes full ownership of the model config for that provider. All three fields (`model`, `reasoningEffort`, `maxThinkingTokens`) are reset to their SDK defaults unless the stage explicitly sets them. The parent session's values for these fields are **not** inherited.
- **If the stage does not mention the active agent type**, all three fields inherit from the parent session as a coherent set.

This prevents subtle bugs where, for example, a parent session running `opus` with `reasoningEffort: "high"` and `maxThinkingTokens: 32000` would leak those values into a stage that overrides the model to `haiku`.

```ts
// Parent session: opus, reasoningEffort: high, maxThinkingTokens: 32000

// ✅ Stage mentions claude → full ownership. Gets haiku with SDK defaults
// for reasoningEffort and maxThinkingTokens (parent's values do NOT leak).
.stage({
  name: "fast-check",
  sessionConfig: { model: { claude: "haiku" } },
  // ...
})

// ✅ Stage does not mention claude → inherits parent's opus + high + 32k.
.stage({
  name: "inherited",
  sessionConfig: {},
  // ...
})

// ✅ Stage mentions claude via reasoningEffort only → full ownership.
// model resets to SDK default, maxThinkingTokens resets to SDK default.
.stage({
  name: "reasoning-only",
  sessionConfig: { reasoningEffort: { claude: "low" } },
  // ...
})
```

Non-model fields (`systemPrompt`, `tools`, `permissionMode`, etc.) are unaffected by this rule — they always inherit individually from the parent when omitted.

## Model resolution order

The model for each stage is resolved in this priority order:

1. **`sessionConfig.model[agentType]`** — explicit DSL override for the active agent type.
2. **Agent frontmatter `model` field** — if the stage's `agent` definition file has a `model` field in its YAML frontmatter, it is automatically merged into `sessionConfig.model` under the correct agent type key (inferred from the agent file's directory: `.claude/` → `claude`, `.opencode/` → `opencode`, `.github/`/`.copilot/` → `copilot`). Explicit DSL values take precedence.
3. **Parent session model** — when neither the DSL nor frontmatter specifies a model, the user's current session model is inherited automatically.

### Agent frontmatter model

Agent definition files can declare a `model` field in their YAML frontmatter:

```yaml
# .claude/agents/reviewer.md
---
name: reviewer
description: Code reviewer for proposed code changes.
model: opus
---
```

At compile time, the compiler reads this field and merges it into `sessionConfig.model` as `{ claude: "opus" }` (the agent type is inferred from the file's provider directory). This means you don't need to repeat the model in the workflow DSL — the agent definition carries its own default model.

If a stage also sets `sessionConfig.model.claude`, the DSL value wins:

```ts
// Agent frontmatter has model: opus
// DSL override takes precedence → this stage uses sonnet, not opus
.stage({
  name: "review",
  agent: "reviewer",
  description: "REVIEWER",
  prompt: (ctx) => `Review: ${ctx.userPrompt}`,
  outputMapper: (response) => ({ reviewResult: response }),
  sessionConfig: {
    model: { claude: "sonnet" },  // overrides frontmatter "opus"
  },
})
```

Claude supports short aliases: `opus`, `sonnet`, `haiku`. These resolve automatically — no need to use full model IDs like `claude-opus-4-20250514`.

The `atomic workflow verify` command validates all models (from both DSL overrides and agent frontmatter) against available models for each agent type.

## System prompt resolution order

The system prompt for a stage is determined by this priority:

1. **`sessionConfig.systemPrompt`** — if set explicitly, this replaces everything.
2. **`agent` definition body** — if `agent` is set to a named agent, the compiler reads the agent definition file's markdown body and injects it as the system prompt.
3. **SDK defaults** — if `agent` is `null` and no `systemPrompt` is set, the SDK's built-in instructions are preserved (e.g., Claude Code preset, Copilot guardrails).

Use `additionalInstructions` when you want to augment (not replace) the default prompt.
