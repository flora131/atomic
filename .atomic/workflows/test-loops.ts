/**
 * Test Workflow: Bounded Loops
 *
 * Exercises: .loop(), .endLoop(), .break() with condition, .break() unconditional,
 *            loopState, nested loops, loop + conditional interaction
 * Validates: LoopOptions shape, break predicate factory, loop depth tracking
 */
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-loops",
    description: "Tests loop/break/endLoop patterns including nesting and loopState",
    globalState: {
      reviewResult: { default: null as null | { allPassing: boolean } },
      refinementCount: { default: 0, reducer: "sum" },
      polishIteration: { default: 0, reducer: "sum" },
    },
  })
  .version("1.0.0")
  .stage({
    name: "initial-impl",
    description: "⚡ INITIAL IMPLEMENTATION",
    prompt: (ctx) => `Implement:\n${ctx.userPrompt}`,
    outputMapper: () => ({}),
  })
  // Simple loop with conditional break
  .loop({ maxCycles: 5 })
    .stage({
      name: "review",
      agent: "reviewer",
      description: "🔍 REVIEW",
      outputs: ["reviewResult"],
      prompt: (ctx) => `Review the implementation for:\n${ctx.userPrompt}`,
      outputMapper: (response) => {
        try {
          return { reviewResult: JSON.parse(response) };
        } catch {
          return { reviewResult: { allPassing: false } };
        }
      },
    })
    // Conditional break — exits when review passes
    .break(() => (state) => {
      const result = state.reviewResult;
      return result?.allPassing === true;
    })
    .stage({
      name: "fix",
      agent: "fixer",
      description: "🔧 FIX",
      outputs: ["refinementCount"],
      prompt: (ctx) => {
        const review = ctx.stageOutputs.get("review")?.rawResponse ?? "";
        return `Fix issues found in review:\n${review}`;
      },
      outputMapper: () => ({ refinementCount: 1 }),
    })
  .endLoop()
  // Loop with loopState and unconditional break inside conditional
  .loop({
    maxCycles: 3,
    loopState: {
      polishIteration: { default: 0, reducer: "sum" },
      improvements: { default: () => [] as string[], reducer: "concat" },
    },
  })
    .stage({
      name: "polish",
      description: "✨ POLISH",
      outputs: ["polishIteration", "improvements"],
      prompt: (ctx) => `Polish iteration ${ctx.state.polishIteration}:\n${ctx.userPrompt}`,
      outputMapper: (response) => ({
        polishIteration: 1,
        improvements: [response.substring(0, 100)],
      }),
    })
    // Conditional break using a predicate factory — exits when iteration threshold met
    .break(() => (state) => {
      const iteration = state.polishIteration;
      return iteration >= 2;
    })
  .endLoop()
  .compile();
