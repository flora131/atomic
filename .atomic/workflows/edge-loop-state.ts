// .atomic/workflows/edge-loop-state.ts
//
// Edge case: Loop-scoped state (loopState) separate from globalState.
// The loop defines its own iteration counter and scratch fields that
// don't pollute global state. Tests: loopState initialization per
// iteration group, merge precedence of loopState over globalState.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-loop-state",
    description:
      "Uses loopState for iteration-scoped fields alongside globalState. " +
      "Tests loopState initialization and merge behavior.",
    globalState: {
      globalLog: { default: () => [] as string[], reducer: "concat" },
      globalTotal: { default: 0, reducer: "sum" },
      result: { default: "" },
      // Declared here for type visibility; loopState below sets the
      // reducer semantics that apply within the loop body.
      loopIteration: { default: 0, reducer: "sum" },
      loopScratch: { default: "" },
    },
  })
  .version("0.1.0")

  .tool({
    name: "setup",
    description: "Initial setup",
    execute: async () => ({
      globalLog: ["setup-complete"],
      globalTotal: 0,
      loopIteration: 0,
      loopScratch: "",
    }),
  })

  .loop({
    maxCycles: 3,
    loopState: {
      loopIteration: { default: 0, reducer: "sum" },
      loopScratch: { default: "" },
    },
  })

    .tool({
      name: "loop-work",
      description: "Do work in loop with loop-scoped state",
      execute: async (ctx) => {
        const iteration = (ctx.state.loopIteration as number) + 1;
        return {
          loopIteration: 1,
          loopScratch: `scratch-${iteration}`,
          globalLog: [`loop-iter-${iteration}`],
          globalTotal: 10,
        };
      },
    })

    .stage({
      name: "reflect-on-loop",
      agent: null,
      description: "🔄 Reflect on loop iteration",
      prompt: (ctx) => {
        const iteration = ctx.state.loopIteration;
        const scratch = ctx.state.loopScratch;
        const total = ctx.state.globalTotal;
        return `Loop iteration ${iteration}, scratch="${scratch}", running total=${total}. ` +
          `Write a brief one-sentence status update.`;
      },
      outputMapper: () => ({}),
    })

  .endLoop()

  .tool({
    name: "final-summary",
    description: "Summarize all loop work",
    execute: async (ctx) => ({
      result: `Completed. Log: ${JSON.stringify(ctx.state.globalLog)}, Total: ${ctx.state.globalTotal}`,
    }),
  })

  .compile();
