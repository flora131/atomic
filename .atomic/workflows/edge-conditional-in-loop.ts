// .atomic/workflows/edge-conditional-in-loop.ts
//
// Edge case: if/elseIf/else branching inside a loop body, with an
// unconditional break from one branch. Tests: branch skipping inside
// a loop, break from inside a conditional, state changes from different
// branches accumulating across iterations.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-conditional-in-loop",
    description:
      "Loop with conditional branching inside. One branch triggers " +
      "a break. Tests branching + break interaction inside loops.",
    globalState: {
      counter: { default: 0, reducer: "sum" },
      path: { default: () => [] as string[], reducer: "concat" },
      status: { default: "running" },
    },
  })
  .version("0.1.0")

  .tool({
    name: "init",
    description: "Initialize state fields",
    execute: async () => ({
      counter: 0,
      path: [] as string[],
      status: "running",
    }),
  })

  .loop({ maxCycles: 6 })

    .tool({
      name: "increment",
      description: "Increment counter",
      execute: async (ctx) => ({
        counter: 1,
        path: [`iter-${(ctx.state.counter as number) + 1}`],
      }),
    })

    .if((ctx) => (ctx.state.counter as number) % 3 === 0)
      // Every 3rd iteration: special processing
      .tool({
        name: "special-process",
        description: "Special processing every 3rd iter",
        execute: async () => ({
          path: ["special"],
          status: "special-triggered",
        }),
      })
    .elseIf((ctx) => (ctx.state.counter as number) >= 4)
      // At count >= 4: break out
      .tool({
        name: "exit-marker",
        description: "Mark exit",
        execute: async () => ({
          path: ["exit-triggered"],
          status: "exiting",
        }),
      })
      .break()
    .else()
      // Normal iteration
      .tool({
        name: "normal-work",
        description: "Normal iteration work",
        execute: async () => ({
          path: ["normal"],
        }),
      })
    .endIf()

  .endLoop()

  .tool({
    name: "finalize",
    description: "Final summary",
    execute: async (ctx) => ({
      path: [`done-at-${ctx.state.counter}`],
      status: "completed",
    }),
  })

  .compile();
