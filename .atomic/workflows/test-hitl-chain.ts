// .atomic/workflows/test-hitl-chain.ts
//
// Test: askUserQuestion → stage consuming the answer → conditional on
// the answer → tool node. Verifies human-in-the-loop data flow including
// the stageOutputs fix for deterministic nodes.

import { defineWorkflow, USER_DECLINED_ANSWER } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-hitl-chain",
    description:
      "Ask the user a question, feed their answer to an agent stage, " +
      "branch on the answer, then run a tool. Tests askUserQuestion → " +
      "stage → if/else → tool data flow.",
    globalState: {
      userChoice: { default: "" },
      interpretation: { default: "" },
      wasDeclined: { default: false },
      timestamp: { default: "" },
    },
  })
  .version("0.1.0")

  .askUserQuestion({
    name: "pick-language",
    description: "Ask user to pick a programming language",
    question: {
      question: "Which programming language do you want to learn?",
      header: "Language Selection",
      options: [
        { label: "TypeScript", description: "Strongly typed JavaScript" },
        { label: "Rust", description: "Systems programming" },
        { label: "Go", description: "Concurrent and simple" },
      ],
    },
    outputMapper: (answer: string | string[]) => ({
      userChoice: String(answer),
      wasDeclined: answer === USER_DECLINED_ANSWER,
    }),
  })

  .if((ctx) => ctx.state.__userDeclined === true)
    .stage({
      name: "handle-decline",
      agent: null,
      description: "👋 Handle user decline",
      prompt: () =>
        `The user declined to answer. Write a short, friendly farewell message encouraging them to come back later.`,
      outputMapper: (response) => ({ interpretation: response }),
    })
  .else()
    .stage({
      name: "interpret-choice",
      agent: null,
      description: "🤔 Interpret the choice",
      prompt: (ctx) => {
        const choice =
          (ctx.stageOutputs.get("pick-language")?.parsedOutput as Record<string, unknown>)?.userChoice ?? "unknown";
        return `The user chose "${choice}" as the programming language they want to learn.\n` +
          `Write 1-2 sentences about why that's a great choice and what they should start with.`;
      },
      outputMapper: (response) => ({ interpretation: response }),
    })
  .endIf()

  .tool({
    name: "stamp-timestamp",
    description: "⏱ Record completion timestamp",
    execute: async () => ({
      timestamp: new Date().toISOString(),
    }),
  })

  .compile();
