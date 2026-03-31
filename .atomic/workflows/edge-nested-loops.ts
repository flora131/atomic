// .atomic/workflows/edge-nested-loops.ts
//
// Edge case: Nested loops with breaks at both levels.
// Outer loop runs max 3x, inner loop max 4x. Each has its own break.
// Tests: loopStack nesting, independent iteration counters, break
// from inner vs. outer loop, state accumulation across nested iterations.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-nested-loops",
    description:
      "Outer loop (3x) with inner loop (4x). Breaks at both levels. " +
      "Tests nested loop state isolation and break routing.",
    globalState: {
      outerLog: { default: () => [] as string[], reducer: "concat" },
      innerLog: { default: () => [] as string[], reducer: "concat" },
      outerCount: { default: 0, reducer: "sum" },
      innerCount: { default: 0, reducer: "sum" },
      outerDone: { default: false },
      innerDone: { default: false },
    },
  })
  .version("0.1.0")

  .tool({
    name: "seed",
    description: "Seed initial state",
    execute: async () => ({
      outerLog: ["start"],
      outerCount: 0,
      innerCount: 0,
    }),
  })

  .loop({ maxCycles: 3 })

    .tool({
      name: "outer-tick",
      description: "Tick outer loop",
      execute: async (ctx) => {
        const n = (ctx.state.outerCount as number) + 1;
        return {
          outerLog: [`outer-${n}`],
          outerCount: 1,
        };
      },
    })

    .loop({ maxCycles: 4 })

      .tool({
        name: "inner-tick",
        description: "Tick inner loop",
        execute: async (ctx) => {
          const n = (ctx.state.innerCount as number) + 1;
          return {
            innerLog: [`inner-${n}`],
            innerCount: 1,
          };
        },
      })

      .break(() => (state) => (state.innerCount as number) >= 2)

      .tool({
        name: "inner-work",
        description: "Work inside inner loop after break check",
        execute: async (ctx) => ({
          innerLog: [`inner-work-${ctx.state.innerCount}`],
        }),
      })

    .endLoop()

    .tool({
      name: "between-loops",
      description: "Runs between inner and outer loop iterations",
      execute: async (ctx) => ({
        outerLog: [`between-${ctx.state.outerCount}`],
        innerDone: (ctx.state.innerCount as number) >= 2,
      }),
    })

    .break(() => (state) => (state.outerCount as number) >= 2)

    .tool({
      name: "outer-work",
      description: "Work inside outer loop after break check",
      execute: async () => ({
        outerLog: ["outer-work"],
      }),
    })

  .endLoop()

  .tool({
    name: "final",
    description: "Final aggregation",
    execute: async (ctx) => ({
      outerDone: true,
      outerLog: [`final-outer=${ctx.state.outerCount},inner=${ctx.state.innerCount}`],
    }),
  })

  .compile();
