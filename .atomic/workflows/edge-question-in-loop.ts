// .atomic/workflows/edge-question-in-loop.ts
//
// Edge case: askUserQuestion + tool inside a loop body.
// The loop asks the user a question each iteration, processes the answer
// with a tool, and breaks when the user says "done".
// Tests: HITL node re-execution across loop iterations, tool + askUser
// interleaving, loop break driven by user input.

import { defineWorkflow, USER_DECLINED_ANSWER } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-question-in-loop",
    description:
      "Loop containing askUserQuestion + tool. Asks user for items " +
      "repeatedly until they say 'done' or max 5 iterations.",
    globalState: {
      items: { default: () => [] as string[], reducer: "concat" },
      itemCount: { default: 0, reducer: "sum" },
      lastAnswer: { default: "" },
      finished: { default: false },
    },
  })
  .version("0.1.0")

  .tool({
    name: "init",
    description: "Initialize collection",
    execute: async () => ({
      items: ["--- Collection Started ---"],
      itemCount: 0,
      lastAnswer: "",
      finished: false,
    }),
  })

  .loop({ maxCycles: 5 })

    .askUserQuestion({
      name: "add-item",
      description: "Ask user for an item",
      question: (state) => ({
        question: `You have ${state.itemCount} item(s). Add another or type "done" to finish:`,
        header: "Item Collection",
      }),
      outputMapper: (answer: string | string[]) => {
        const ans = answer === USER_DECLINED_ANSWER ? "done" : String(answer);
        return {
          lastAnswer: ans,
          finished: ans.toLowerCase().trim() === "done",
        };
      },
    })

    .break(() => (state) => state.finished === true)

    .tool({
      name: "process-item",
      description: "Process the added item",
      execute: async (ctx) => {
        const answer = ctx.state.lastAnswer;
        return {
          items: [String(answer).toUpperCase()],
          itemCount: 1,
        };
      },
    })

  .endLoop()

  .stage({
    name: "summarize-collection",
    agent: null,
    description: "📋 Summarize collected items",
    prompt: (ctx) => {
      const items = ctx.state.items;
      const count = ctx.state.itemCount;
      return `Summarize this collection of ${count} items: ${JSON.stringify(items)}`;
    },
    outputMapper: () => ({}),
  })

  .compile();
