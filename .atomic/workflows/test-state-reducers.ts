// .atomic/workflows/test-state-reducers.ts
//
// Test: Multiple state reducers (concat, sum, max, merge, and).
// Verifies: state accumulation across stages, reducer correctness,
// and downstream stages reading accumulated state.

import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-state-reducers",
    description:
      "Three analysis stages that each contribute to shared state with " +
      "different reducers: concat (findings), sum (score), max (confidence), " +
      "merge (metadata), and (allChecked). Final stage reads accumulated state.",
    globalState: {
      findings: { default: () => [] as string[], reducer: "concat" },
      score: { default: 0, reducer: "sum" },
      confidence: { default: 0, reducer: "max" },
      metadata: { default: () => ({} as Record<string, string>), reducer: "merge" },
      allChecked: { default: true, reducer: "and" },
      finalSummary: { default: "" },
    },
  })
  .version("0.1.0")

  .stage({
    name: "analyze-security",
    agent: null,
    description: "🔒 Security analysis",
    prompt: (ctx) =>
      `Perform a brief security analysis of: "${ctx.userPrompt}"\n` +
      `Respond with a single key finding.`,
    outputMapper: (response) => ({
      findings: [response.trim()],
      score: 30,
      confidence: 85,
      metadata: { securityAnalyst: "done" },
      allChecked: true,
    }),
  })

  .stage({
    name: "analyze-performance",
    agent: null,
    description: "⚡ Performance analysis",
    prompt: (ctx) =>
      `Perform a brief performance analysis of: "${ctx.userPrompt}"\n` +
      `Respond with a single key finding.`,
    outputMapper: (response) => ({
      findings: [response.trim()],
      score: 45,
      confidence: 92,
      metadata: { performanceAnalyst: "done" },
      allChecked: true,
    }),
  })

  .stage({
    name: "analyze-maintainability",
    agent: null,
    description: "🔧 Maintainability analysis",
    prompt: (ctx) =>
      `Perform a brief maintainability analysis of: "${ctx.userPrompt}"\n` +
      `Respond with a single key finding.`,
    outputMapper: (response) => ({
      findings: [response.trim()],
      score: 25,
      confidence: 78,
      metadata: { maintainabilityAnalyst: "done" },
      allChecked: true,
    }),
  })

  .tool({
    name: "compute-aggregate",
    description: "📊 Compute aggregate metrics",
    execute: async (ctx) => {
      const findings = ctx.state.findings ?? [];
      const score = ctx.state.score ?? 0;
      const confidence = ctx.state.confidence ?? 0;
      return {
        findings: [`Total: ${findings.length} findings, score=${score}, confidence=${confidence}`],
      };
    },
  })

  .stage({
    name: "final-report",
    agent: null,
    description: "📋 Generate final report",
    prompt: (ctx) => {
      const findings = ctx.state.findings;
      const score = ctx.state.score;
      const confidence = ctx.state.confidence;
      const allChecked = ctx.state.allChecked;
      return `Generate a one-paragraph summary report:\n` +
        `Findings: ${JSON.stringify(findings)}\n` +
        `Total score: ${score}\n` +
        `Max confidence: ${confidence}\n` +
        `All checks passed: ${allChecked}`;
    },
    outputMapper: (response) => ({ finalSummary: response }),
  })

  .compile();
