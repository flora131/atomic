// .atomic/workflows/edge-empty-output-mapper.ts
//
// Edge case: Stages that return empty objects from outputMapper,
// tools that return empty objects from execute, and a mix of
// no-op nodes with real data-producing nodes. Tests: empty
// output merging, state unaffected by no-op nodes, tool returning
// empty object.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-empty-output-mapper",
    description:
      "Mix of no-op and data-producing nodes. " +
      "Tests that empty outputMapper/execute results are harmless.",
    globalState: {
      data: { default: "" },
      processed: { default: false },
    },
  })
  .version("0.1.0")

  // No-op stage — returns {}
  .stage({
    name: "warmup",
    agent: null,
    description: "🔥 Warmup (no-op output)",
    prompt: (ctx) => `Acknowledge this request: "${ctx.userPrompt}"`,
    outputMapper: () => ({}),
  })

  // No-op tool — returns {}
  .tool({
    name: "noop-tool",
    description: "No-op tool returning empty object",
    execute: async () => ({}),
  })

  // Real data producer
  .tool({
    name: "produce-data",
    description: "Produce actual data",
    execute: async () => ({
      data: "real-value",
      processed: true,
    }),
  })

  // Another no-op stage
  .stage({
    name: "noop-stage",
    agent: null,
    description: "📭 Another no-op stage",
    prompt: (ctx) => `Data is: ${ctx.state.data}. Just acknowledge.`,
    outputMapper: () => ({}),
  })

  // Final tool reads state
  .tool({
    name: "verify-state",
    description: "Verify state survived no-ops",
    execute: async (ctx) => ({
      data: `verified:${ctx.state.data},processed=${ctx.state.processed}`,
    }),
  })

  .compile();
