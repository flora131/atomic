// .atomic/workflows/edge-bare-if.ts
//
// Edge case: `.if()` / `.endIf()` without `.else()` or `.elseIf()`.
// When the condition is false, the workflow skips the entire block
// and continues to the next node. Tests: bare conditional skip path,
// downstream nodes still execute.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-bare-if",
    description:
      "Bare if/endIf with no else branch. " +
      "Tests that the skip path reaches downstream nodes.",
    globalState: {
      flag: { default: false },
      beforeIf: { default: "" },
      insideIf: { default: "" },
      afterIf: { default: "" },
    },
  })
  .version("0.1.0")

  .tool({
    name: "setup",
    description: "Set initial state",
    execute: async () => ({
      flag: false,
      beforeIf: "executed",
    }),
  })

  // Bare if — no else branch
  .if((ctx) => ctx.state.flag === true)
    .tool({
      name: "conditional-work",
      description: "Only runs when flag is true",
      execute: async () => ({ insideIf: "ran" }),
    })
  .endIf()

  .tool({
    name: "after-conditional",
    description: "Always runs regardless of condition",
    execute: async (ctx) => ({
      afterIf: `before=${ctx.state.beforeIf},inside=${ctx.state.insideIf}`,
    }),
  })

  .compile();
