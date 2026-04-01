// .atomic/workflows/edge-loop-no-break.ts
//
// Edge case: Loop with no `.break()` — runs to maxCycles exhaustion.
// Tests: loop termination via maxCycles alone, state accumulation
// across all iterations, post-loop execution continues normally.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-loop-no-break",
    description:
      "Loop with no break — exhausts maxCycles. " +
      "Tests that loops terminate correctly without any break node.",
    globalState: {
      iterations: { default: 0, reducer: "sum" },
      trace: { default: () => [] as string[], reducer: "concat" },
      result: { default: "" },
    },
  })
  .version("0.1.0")

  .loop({ maxCycles: 3 })
    .tool({
      name: "tick",
      description: "Increment iteration counter",
      execute: async (ctx) => ({
        iterations: 1,
        trace: [`iter-${(ctx.state.iterations as number) + 1}`],
      }),
    })
  .endLoop()

  .tool({
    name: "summarize",
    description: "Post-loop summary",
    execute: async (ctx) => ({
      result: `Ran ${ctx.state.iterations} iterations: ${JSON.stringify(ctx.state.trace)}`,
    }),
  })

  .compile();
