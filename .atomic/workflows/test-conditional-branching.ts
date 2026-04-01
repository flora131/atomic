// .atomic/workflows/test-conditional-branching.ts
//
// Test: Conditional branching with if/elseIf/else.
// Verifies: stage output drives branching, each branch executes the
// correct path, and a shared finalize stage runs after all branches.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-conditional-branching",
    description:
      "Triage → branch (bug-fix / feature / research) → finalize. " +
      "Tests if/elseIf/else routing based on parsed stage output.",
    globalState: {
      category: { default: "" },
      branchResult: { default: "" },
      finalReport: { default: "" },
    },
  })
  .version("0.1.0")

  .stage({
    name: "triage",
    agent: null,
    description: "🔍 Triage the request",
    prompt: (ctx) =>
      `You are a project triage bot. Classify the following request into exactly one category: "bug", "feature", or "research".\n` +
      `Request: "${ctx.userPrompt}"\n` +
      `Respond with ONLY the category word, nothing else.`,
    outputMapper: (response) => ({
      category: response.trim().toLowerCase(),
    }),
  })

  .if((ctx) => {
    const cat = (ctx.stageOutputs.get("triage")?.parsedOutput as Record<string, unknown>)?.category;
    return cat === "bug";
  })
    .stage({
      name: "fix-bug",
      agent: null,
      description: "🔧 Fix the bug",
      prompt: (ctx) =>
        `The request was classified as a bug. Describe a fix plan for:\n"${ctx.userPrompt}"`,
      outputMapper: (response) => ({ branchResult: response }),
    })
  .elseIf((ctx) => {
    const cat = (ctx.stageOutputs.get("triage")?.parsedOutput as Record<string, unknown>)?.category;
    return cat === "feature";
  })
    .stage({
      name: "build-feature",
      agent: null,
      description: "✨ Build the feature",
      prompt: (ctx) =>
        `The request was classified as a feature. Outline an implementation plan for:\n"${ctx.userPrompt}"`,
      outputMapper: (response) => ({ branchResult: response }),
    })
  .else()
    .stage({
      name: "research",
      agent: null,
      description: "📚 Research the topic",
      prompt: (ctx) =>
        `The request was classified as research. Provide a research summary for:\n"${ctx.userPrompt}"`,
      outputMapper: (response) => ({ branchResult: response }),
    })
  .endIf()

  .stage({
    name: "finalize",
    agent: null,
    description: "📋 Finalize report",
    prompt: (ctx) => {
      const category =
        (ctx.stageOutputs.get("triage")?.parsedOutput as Record<string, unknown>)?.category ?? "unknown";
      // Find whichever branch ran
      const branchOutput =
        ctx.stageOutputs.get("fix-bug")?.rawResponse ??
        ctx.stageOutputs.get("build-feature")?.rawResponse ??
        ctx.stageOutputs.get("research")?.rawResponse ??
        "No branch executed";
      return `Write a short final report.\nCategory: ${category}\nBranch output:\n${branchOutput}`;
    },
    outputMapper: (response) => ({ finalReport: response }),
  })

  .compile();
