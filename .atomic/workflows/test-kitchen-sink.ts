// .atomic/workflows/test-kitchen-sink.ts
//
// Test: Every node type and control-flow construct in one workflow.
// Verifies: stage + tool + askUserQuestion + if/else + loop + break
// all interacting correctly with shared state and stageOutputs.

import { defineWorkflow, USER_DECLINED_ANSWER } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-kitchen-sink",
    description:
      "Combines every DSL feature: stage, tool, askUserQuestion, " +
      "if/elseIf/else, loop with break, and state reducers. " +
      "Exercises the full execution engine.",
    globalState: {
      plan: { default: "" },
      approach: { default: "" },
      userApproved: { default: false },
      attempts: { default: () => [] as string[], reducer: "concat" },
      iterationCount: { default: 0, reducer: "sum" },
      quality: { default: 0, reducer: "max" },
      result: { default: "" },
    },
  })
  .version("0.1.0")
  .argumentHint("<task-description>")

  .tool({
    name: "init",
    description: "Initialize state fields",
    execute: async () => ({
      attempts: [] as string[],
      quality: 0,
    }),
  })

  // Stage 1: Plan
  .stage({
    name: "plan",
    agent: null,
    description: "📋 Create a plan",
    prompt: (ctx) =>
      `Create a brief 2-3 point plan for: "${ctx.userPrompt}"\n` +
      `Format as a numbered list.`,
    outputMapper: (response) => ({ plan: response }),
  })

  // Tool: Validate plan
  .tool({
    name: "validate-plan",
    description: "✅ Validate plan structure",
    execute: async (ctx) => {
      const plan = String(ctx.state.plan ?? "");
      const hasNumbers = /\d/.test(plan);
      const lineCount = plan.split("\n").filter(Boolean).length;
      return {
        approach: hasNumbers && lineCount >= 2 ? "structured" : "freeform",
      };
    },
  })

  // Ask user: Approve the plan
  .askUserQuestion({
    name: "approve-plan",
    description: "Ask user to approve the plan",
    question: (state) => ({
      question: state.plan
        ? `Here's the plan:\n${state.plan}\n\nApprove?`
        : "No plan was generated. Continue anyway?",
      header: "Plan Review",
      options: [
        { label: "Approve", description: "Proceed with implementation" },
        { label: "Reject", description: "Go back and re-plan" },
      ],
    }),
    outputMapper: (answer: string | string[]) => ({
      userApproved: answer !== USER_DECLINED_ANSWER && String(answer) === "Approve",
    }),
  })

  // Conditional on approval
  .if((ctx) => ctx.state.__userDeclined === true)
    .tool({
      name: "log-cancelled",
      description: "📝 Log cancellation",
      execute: async () => ({ result: "Workflow cancelled by user" }),
    })
  .elseIf((ctx) => ctx.state.userApproved !== true)
    .stage({
      name: "re-plan",
      agent: null,
      description: "🔄 Re-plan with feedback",
      prompt: (ctx) =>
        `The user rejected the plan. Create an alternative approach for: "${ctx.userPrompt}"`,
      outputMapper: (response) => ({ plan: response, result: response }),
    })
  .else()
    // Loop: Iterative implementation with review
    .loop({ maxCycles: 3 })
      .stage({
        name: "implement",
        agent: null,
        description: "⚡ Implement iteration",
        prompt: (ctx) => {
          const plan = ctx.stageOutputs.get("plan")?.rawResponse ?? "";
          const prevAttempts = ctx.state.attempts;
          const attemptCount = Array.isArray(prevAttempts) ? prevAttempts.length : 0;
          return `Implement the plan (attempt ${attemptCount + 1}):\n${plan}\n` +
            `Write a brief implementation summary.`;
        },
        outputMapper: (response) => ({
          attempts: [response.trim()],
          iterationCount: 1,
        }),
      })

      .tool({
        name: "score-implementation",
        description: "📊 Score the implementation",
        execute: async (ctx) => {
          const attempts = ctx.state.attempts;
          const count = Array.isArray(attempts) ? attempts.length : 0;
          // Score increases with each iteration
          const score = Math.min(100, 60 + count * 15);
          return { quality: score };
        },
      })

      .break(() => (state) => {
        return (state.quality as number) >= 90;
      })

      .stage({
        name: "refine",
        agent: null,
        description: "🔧 Refine implementation",
        prompt: (ctx) => {
          const quality = ctx.state.quality;
          const lastAttempt = ctx.state.attempts;
          const latest = Array.isArray(lastAttempt) ? lastAttempt[lastAttempt.length - 1] : "";
          return `Quality score: ${quality}/100. Refine this implementation:\n"${latest}"`;
        },
        outputMapper: (response) => ({
          attempts: [response.trim()],
          iterationCount: 1,
        }),
      })
    .endLoop()

    // Final summary after loop
    .stage({
      name: "summarize-result",
      agent: null,
      description: "📋 Summarize final result",
      prompt: (ctx) => {
        const attempts = ctx.state.attempts;
        const totalAttempts = Array.isArray(attempts) ? attempts.length : 0;
        const quality = ctx.state.quality;
        return `Write a final summary. Total attempts: ${totalAttempts}, final quality: ${quality}/100.`;
      },
      outputMapper: (response) => ({ result: response }),
    })
  .endIf()

  .compile();
