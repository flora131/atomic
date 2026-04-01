// .atomic/workflows/edge-session-config.ts
//
// Edge case: Per-stage sessionConfig overrides.
// Tests: model overrides per agent type, reasoningEffort, maxThinkingTokens,
// disallowedTools per provider, additionalInstructions, permissionMode,
// and maxTurns. Verifies model validation pass in the verifier.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-session-config",
    description:
      "Stages with various sessionConfig overrides. " +
      "Tests model validation and config propagation.",
    globalState: {
      plan: { default: "" },
      review: { default: "" },
      result: { default: "" },
    },
  })
  .version("0.1.0")

  .stage({
    name: "plan-with-model",
    agent: null,
    description: "📋 Plan with model override",
    prompt: (ctx) => `Plan this task: ${ctx.userPrompt}`,
    outputMapper: (response) => ({ plan: response }),
    sessionConfig: {
      model: {
        claude: "claude-sonnet-4-20250514",
        copilot: "claude-sonnet-4",
      },
      maxTurns: 5,
      permissionMode: "auto",
    },
  })

  .stage({
    name: "review-with-reasoning",
    agent: null,
    description: "🔍 Review with reasoning effort",
    prompt: (ctx) =>
      `Review this plan:\n${ctx.stageOutputs.get("plan-with-model")?.rawResponse ?? ""}`,
    outputMapper: (response) => ({ review: response }),
    sessionConfig: {
      reasoningEffort: { claude: "high" },
      maxThinkingTokens: 16000,
      additionalInstructions: "Be extra thorough in your review.",
    },
  })

  .stage({
    name: "implement-with-restrictions",
    agent: null,
    description: "⚡ Implement with tool restrictions",
    prompt: (ctx) =>
      `Implement based on review:\n${ctx.stageOutputs.get("review-with-reasoning")?.rawResponse ?? ""}`,
    outputMapper: (response) => ({ result: response }),
    disallowedTools: {
      claude: ["WebFetch", "WebSearch"],
      copilot: ["web_fetch"],
    },
  })

  .compile();
