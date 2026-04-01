// .atomic/workflows/test-loop-with-break.ts
//
// Test: Bounded loop with a conditional break.
// Verifies: loop iteration, break condition evaluation, state accumulation
// via reducers across iterations, and post-loop stage execution.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-loop-with-break",
    description:
      "Draft → [review → break if passing → revise] (max 3x) → publish. " +
      "Tests bounded loops, break conditions, and state accumulation.",
    globalState: {
      draft: { default: "" },
      reviewNotes: { default: () => [] as string[], reducer: "concat" },
      iterationCount: { default: 0, reducer: "sum" },
      allPassing: { default: false },
      published: { default: "" },
    },
  })
  .version("0.1.0")

  .stage({
    name: "draft",
    agent: null,
    description: "✏️ Write initial draft",
    prompt: (ctx) =>
      `Write a short initial draft for: "${ctx.userPrompt}"\nKeep it to 2-3 sentences.`,
    outputMapper: (response) => ({
      draft: response,
      iterationCount: 0,
      reviewNotes: [] as string[],
    }),
  })

  .loop({ maxCycles: 3 })

    .stage({
      name: "review",
      agent: null,
      description: "🔍 Review the draft",
      prompt: (ctx) => {
        const draft =
          ctx.stageOutputs.get("draft")?.rawResponse ??
          ctx.stageOutputs.get("revise")?.rawResponse ??
          "No draft available";
        const iteration = ctx.state.iterationCount ?? 0;
        return `Review this draft (iteration ${iteration + 1}):\n"${draft}"\n` +
          `Respond with ONLY "PASS" if the draft is good, or "NEEDS_WORK: <feedback>" if it needs changes.`;
      },
      outputMapper: (response) => {
        const trimmed = response.trim();
        const passing = trimmed.toUpperCase().startsWith("PASS");
        return {
          reviewNotes: [trimmed],
          allPassing: passing,
          iterationCount: 1,
        };
      },
    })

    .break(() => (state) => {
      return state.allPassing === true;
    })

    .stage({
      name: "revise",
      agent: null,
      description: "🔧 Revise the draft",
      prompt: (ctx) => {
        const draft =
          ctx.stageOutputs.get("draft")?.rawResponse ??
          ctx.stageOutputs.get("revise")?.rawResponse ??
          "";
        const latestNotes = ctx.state.reviewNotes;
        const lastNote = Array.isArray(latestNotes) ? latestNotes[latestNotes.length - 1] : "";
        return `Revise this draft based on the feedback.\nDraft: "${draft}"\nFeedback: ${lastNote}`;
      },
      outputMapper: (response) => ({ draft: response }),
    })

  .endLoop()

  .stage({
    name: "publish",
    agent: null,
    description: "🚀 Publish the final version",
    prompt: (ctx) => {
      const finalDraft =
        ctx.stageOutputs.get("revise")?.rawResponse ??
        ctx.stageOutputs.get("draft")?.rawResponse ??
        "";
      const totalIterations = ctx.state.iterationCount ?? 0;
      return `Format this as a final published piece. It went through ${totalIterations} review rounds.\n"${finalDraft}"`;
    },
    outputMapper: (response) => ({ published: response }),
  })

  .compile();
