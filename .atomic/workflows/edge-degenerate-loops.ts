// .atomic/workflows/edge-degenerate-loops.ts
//
// Edge case: Degenerate loop configurations.
// 1. maxCycles=1 loop (single iteration, no repeat).
// 2. Unconditional break inside an if (break with no condition arg).
// 3. Multiple break nodes in one loop body (first match wins).
// Tests: minimal loop execution, unconditional break routing, multiple
// break decision nodes coexisting.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-degenerate-loops",
    description:
      "Three loop patterns: maxCycles=1, unconditional break in if, " +
      "and multiple breaks. Tests degenerate loop configurations.",
    globalState: {
      phase1: { default: "" },
      phase2: { default: "" },
      phase3Log: { default: () => [] as string[], reducer: "concat" },
      phase3Count: { default: 0, reducer: "sum" },
      earlyExit: { default: false },
      lateExit: { default: false },
    },
  })
  .version("0.1.0")

  // --- Phase 1: maxCycles=1 loop (single iteration) ---
  .loop({ maxCycles: 1 })
    .tool({
      name: "single-iteration",
      description: "Runs exactly once",
      execute: async () => ({ phase1: "executed-once" }),
    })
  .endLoop()

  // --- Phase 2: Unconditional break inside an if ---
  .loop({ maxCycles: 10 })
    .tool({
      name: "pre-break-work",
      description: "Work before conditional break check",
      execute: async () => ({ phase2: "did-work" }),
    })
    .break(() => (state) => state.phase2 === "did-work")
    .tool({
      name: "should-not-run",
      description: "Should be skipped by conditional break above",
      execute: async () => ({ phase2: "this-should-not-appear" }),
    })
  .endLoop()

  // --- Phase 3: Multiple break nodes in one loop ---
  .loop({ maxCycles: 10 })
    .tool({
      name: "tick-counter",
      description: "Increment counter",
      execute: async (ctx) => ({
        phase3Count: 1,
        phase3Log: [`tick-${(ctx.state.phase3Count as number) + 1}`],
      }),
    })

    // First break: early exit at count >= 2
    .break(() => (state) => {
      const hit = (state.phase3Count as number) >= 2;
      return hit;
    })

    .tool({
      name: "mid-work",
      description: "Work between breaks",
      execute: async () => ({ phase3Log: ["mid-work"] }),
    })

    // Second break: late exit at count >= 5 (should never trigger if first break works)
    .break(() => (state) => {
      return (state.phase3Count as number) >= 5;
    })

    .tool({
      name: "post-break-work",
      description: "Work after second break check",
      execute: async () => ({ phase3Log: ["post-break"] }),
    })
  .endLoop()

  .tool({
    name: "aggregate",
    description: "Final aggregation",
    execute: async (ctx) => ({
      earlyExit: (ctx.state.phase3Count as number) < 5,
      lateExit: (ctx.state.phase3Count as number) >= 5,
    }),
  })

  .compile();
