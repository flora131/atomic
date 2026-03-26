/**
 * Test Workflow: State and Reducers
 *
 * Exercises: globalState with all 9 built-in reducers + custom reducer function,
 *            loopState, mergeById with key field, factory defaults
 * Validates: StateFieldOptions shape, reducer behavior, state inference
 */
import { defineWorkflow } from "@bastani/atomic-workflows";

export default defineWorkflow({
    name: "test-state-reducers",
    description: "Tests all built-in reducers and custom reducer functions",
    globalState: {
      // replace (default) — new value replaces old
      currentPhase: { default: "init", reducer: "replace" },
      // concat — arrays concatenated
      findings: { default: () => [] as string[], reducer: "concat" },
      // merge — objects shallow-merged
      metadata: { default: () => ({} as Record<string, string>), reducer: "merge" },
      // mergeById — arrays of objects merged by key field
      tasks: {
        default: () => [] as Array<{ id: string; description: string; status: string }>,
        reducer: "mergeById",
        key: "id",
      },
      // max — keeps the larger numeric value
      highScore: { default: 0, reducer: "max" },
      // min — keeps the smaller numeric value
      lowestLatency: { default: Infinity, reducer: "min" },
      // sum — adds old and new numeric values
      totalTokens: { default: 0, reducer: "sum" },
      // or — logical OR of booleans
      hasErrors: { default: false, reducer: "or" },
      // and — logical AND of booleans
      allPassing: { default: true, reducer: "and" },
      // Custom reducer function
      log: {
        default: () => [] as string[],
        reducer: (current: string[], update: string[]) => [...current, ...update].slice(-50),
      },
    },
  })
  .version("1.0.0")
  .stage({
    name: "gather",
    description: "📊 GATHER",
    outputs: [
      "currentPhase", "findings", "metadata", "tasks",
      "highScore", "lowestLatency", "totalTokens",
      "hasErrors", "allPassing", "log",
    ],
    prompt: (ctx) => `Gather data for:\n${ctx.userPrompt}`,
    outputMapper: (response) => ({
      currentPhase: "gathering",
      findings: ["initial finding"],
      metadata: { source: "gather-stage" },
      tasks: [{ id: "t1", description: "First task", status: "pending" }],
      highScore: 85,
      lowestLatency: 120,
      totalTokens: 500,
      hasErrors: false,
      allPassing: true,
      log: [`[gather] processed: ${response.substring(0, 50)}`],
    }),
  })
  .loop({
    maxCycles: 3,
    loopState: {
      iterationFindings: { default: () => [] as string[], reducer: "concat" },
    },
  })
    .stage({
      name: "analyze",
      description: "🔬 ANALYZE",
      outputs: [
        "findings", "metadata", "tasks",
        "highScore", "totalTokens", "hasErrors", "allPassing",
        "log", "iterationFindings",
      ],
      prompt: (ctx) => {
        const tasks = ctx.state.tasks;
        return `Analyze tasks: ${JSON.stringify(tasks)}`;
      },
      outputMapper: (response) => ({
        findings: [`analysis: ${response.substring(0, 30)}`],
        metadata: { lastAnalyzed: new Date().toISOString() },
        tasks: [{ id: "t1", description: "First task", status: "in-progress" }],
        highScore: 92,
        totalTokens: 300,
        hasErrors: false,
        allPassing: true,
        log: ["[analyze] completed"],
        iterationFindings: ["found something"],
      }),
    })
  .endLoop()
  .tool({
    name: "finalize",
    description: "Compute final summary from accumulated state",
    outputs: ["currentPhase"],
    execute: async (ctx) => {
      const findings = ctx.state.findings;
      console.log(`Findings: ${findings.length}, Tokens: ${ctx.state.totalTokens}`);
      return { currentPhase: "complete" };
    },
  })
  .compile();
