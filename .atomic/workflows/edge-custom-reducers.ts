// .atomic/workflows/edge-custom-reducers.ts
//
// Edge case: Tests untested reducer types + custom function reducers.
// Covers: "replace" (explicit), "or", "min", "mergeById", and a
// custom function reducer. Verifies: all built-in reducer strategies
// compile and pass verification.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-custom-reducers",
    description:
      "Exercises all reducer types not covered by other tests: " +
      "replace, or, min, mergeById, and custom function reducer.",
    globalState: {
      label: { default: "initial", reducer: "replace" },
      hasWarning: { default: false, reducer: "or" },
      lowest: { default: 999, reducer: "min" },
      items: {
        default: () => [] as Array<{ id: string; value: number }>,
        reducer: "mergeById",
        key: "id",
      },
      log: {
        default: () => [] as string[],
        reducer: (current: string[], update: string[]) =>
          [...current, ...update].slice(-10),
      },
    },
  })
  .version("0.1.0")

  .tool({
    name: "batch-1",
    description: "First batch of data",
    execute: async () => ({
      label: "batch-1",
      hasWarning: false,
      lowest: 42,
      items: [
        { id: "a", value: 1 },
        { id: "b", value: 2 },
      ],
      log: ["batch-1-start"],
    }),
  })

  .tool({
    name: "batch-2",
    description: "Second batch — triggers or/min/mergeById",
    execute: async () => ({
      label: "batch-2",
      hasWarning: true,
      lowest: 7,
      items: [
        { id: "b", value: 99 },
        { id: "c", value: 3 },
      ],
      log: ["batch-2-done"],
    }),
  })

  .tool({
    name: "batch-3",
    description: "Third batch — tests custom reducer cap",
    execute: async () => ({
      label: "batch-3",
      hasWarning: false,
      lowest: 15,
      items: [{ id: "a", value: 100 }],
      log: ["b3-a", "b3-b", "b3-c", "b3-d", "b3-e", "b3-f", "b3-g", "b3-h", "b3-i"],
    }),
  })

  .tool({
    name: "verify-reducers",
    description: "Read accumulated state and verify",
    execute: async (ctx) => ({
      label: `final:warn=${ctx.state.hasWarning},low=${ctx.state.lowest},items=${JSON.stringify(ctx.state.items)}`,
      log: [`verified-${(ctx.state.log as string[]).length}-entries`],
    }),
  })

  .compile();
