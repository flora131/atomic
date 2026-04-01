// .atomic/workflows/edge-pure-deterministic.ts
//
// Edge case: Zero agent stages — entire workflow is tools + askUserQuestion.
// Tests: workflow execution with no sessions created, pure deterministic
// data flow, tool → askUser → tool chaining, stageOutputs for non-agent nodes.

import { defineWorkflow, USER_DECLINED_ANSWER } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "edge-pure-deterministic",
    description:
      "Entire pipeline is tools and askUserQuestion — zero agent stages. " +
      "Tests that workflows can run without any LLM sessions.",
    globalState: {
      input: { default: "" },
      validated: { default: false },
      userConfirmed: { default: false },
      transformed: { default: "" },
      checksum: { default: "" },
      result: { default: "" },
    },
  })
  .version("0.1.0")

  .tool({
    name: "init",
    description: "Initialize all state fields",
    execute: async () => ({
      input: "",
      validated: false,
      userConfirmed: false,
      transformed: "",
      checksum: "",
      result: "",
    }),
  })

  .tool({
    name: "parse-input",
    description: "Parse and normalize input",
    execute: async (ctx) => {
      const raw = ctx.state.input || "default-data";
      return {
        input: String(raw).trim().toLowerCase(),
        validated: String(raw).length > 0,
      };
    },
  })

  .askUserQuestion({
    name: "confirm-input",
    description: "Confirm the parsed input",
    question: (state) => ({
      question: `Parsed input: "${state.input}". Proceed?`,
      header: "Input Confirmation",
      options: [
        { label: "Yes", description: "Continue processing" },
        { label: "No", description: "Abort" },
      ],
    }),
    outputMapper: (answer: string | string[]) => ({
      userConfirmed: answer !== USER_DECLINED_ANSWER && String(answer) === "Yes",
    }),
  })

  .if((ctx) => ctx.state.userConfirmed === true)
    .tool({
      name: "transform",
      description: "Transform the data",
      execute: async (ctx) => {
        const input = String(ctx.state.input);
        return {
          transformed: input.split("").reverse().join(""),
        };
      },
    })

    .tool({
      name: "compute-checksum",
      description: "Compute checksum of transformed data",
      execute: async (ctx) => {
        const data = String(ctx.state.transformed);
        // Simple hash: sum of char codes mod 9999
        const hash = Array.from(data).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 9999;
        return { checksum: `CHK-${hash}` };
      },
    })

    .tool({
      name: "format-result",
      description: "Format final result",
      execute: async (ctx) => ({
        result: `✅ Processed: ${ctx.state.transformed} [${ctx.state.checksum}]`,
      }),
    })
  .else()
    .tool({
      name: "abort-result",
      description: "Format abort result",
      execute: async () => ({
        result: "❌ Aborted by user",
      }),
    })
  .endIf()

  .compile();
