// .atomic/workflows/edge-conditional-after-loop.ts
//
// Edge case: Conditional branching based on loop-accumulated state.
// After a loop finishes, an if/elseIf/else branches on the final
// accumulated values. Tests: state persistence after loop exit,
// conditional reads of loop-produced state.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-conditional-after-loop",
    description:
      "if/else after loop end, branching on accumulated state. " +
      "Tests that loop state persists and is readable post-loop.",
    globalState: {
      count: { default: 0, reducer: "sum" },
      quality: { default: "unknown" },
      verdict: { default: "" },
    },
  })
  .version("0.1.0")

  .loop({ maxCycles: 4 })
    .tool({
      name: "accumulate",
      description: "Accumulate data per iteration",
      execute: async () => ({
        count: 1,
      }),
    })
    .break(() => (state) => (state.count as number) >= 3)
  .endLoop()

  .tool({
    name: "assess-quality",
    description: "Assess quality based on iteration count",
    execute: async (ctx) => ({
      quality: (ctx.state.count as number) >= 3 ? "sufficient" : "insufficient",
    }),
  })

  .if((ctx) => ctx.state.quality === "sufficient")
    .tool({
      name: "pass-verdict",
      description: "Quality is sufficient",
      execute: async (ctx) => ({
        verdict: `PASS: ${ctx.state.count} iterations met threshold`,
      }),
    })
  .else()
    .tool({
      name: "fail-verdict",
      description: "Quality is insufficient",
      execute: async (ctx) => ({
        verdict: `FAIL: only ${ctx.state.count} iterations`,
      }),
    })
  .endIf()

  .compile();
