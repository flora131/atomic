// .atomic/workflows/test-linear-pipeline.ts
//
// Test: Linear 3-stage pipeline with a tool node in the middle.
// Verifies: stage → tool → stage data flow and outputMapper chaining.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-linear-pipeline",
    description:
      "Linear pipeline: analyze → validate (tool) → summarize. " +
      "Tests that agent outputs flow through tool nodes to downstream stages.",
    globalState: {
      analysis: { default: "" },
      wordCount: { default: 0 },
      isValid: { default: false },
      summary: { default: "" },
    },
  })
  .version("0.1.0")

  .stage({
    name: "analyze",
    agent: null,
    description: "⌕ Analyze the request",
    prompt: (ctx) =>
      `You are a technical analyst. Analyze the following request and list key points:\n"${ctx.userPrompt}"\nRespond with a concise analysis.`,
    outputMapper: (response) => ({ analysis: response }),
  })

  .tool({
    name: "validate-analysis",
    description: "✅ Validate analysis output",
    execute: async (ctx) => {
      const analysis = ctx.state.analysis ?? "";
      const text = String(analysis);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      return {
        wordCount,
        isValid: wordCount > 0,
      };
    },
  })

  .stage({
    name: "summarize",
    agent: null,
    description: "📋 Summarize findings",
    prompt: (ctx) => {
      const analysis =
        ctx.stageOutputs.get("analyze")?.rawResponse ?? "";
      const validation =
        (ctx.stageOutputs.get("validate-analysis")?.parsedOutput as Record<string, unknown>) ?? {};
      return `Summarize this analysis in one sentence.
Analysis: ${analysis}
Word count: ${validation.wordCount ?? "unknown"}
Valid: ${validation.isValid ?? "unknown"}`;
    },
    outputMapper: (response) => ({ summary: response }),
  })

  .compile();
