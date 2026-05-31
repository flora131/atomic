import { defineWorkflow } from "@bastani/workflows";

function seconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 60;
  return Math.max(10, Math.min(120, Math.floor(value)));
}

function slowTask(name: string, delay: number): string {
  return [
    `You are ${name} in a manual pause-state verifier.`,
    "Call the bash tool exactly once with this command:",
    `sleep ${delay}; echo ${name.toUpperCase()}_DONE`,
    `Wait for the command to finish, then reply exactly: ${name.toUpperCase()}_DONE.`,
    "Do not ask questions.",
  ].join("\n");
}

export default defineWorkflow("pause-parallel-fuzz-dummy")
  .description("Manual tmux verifier for orchestrator pause UI with multiple active stages.")
  .input("delay", {
    type: "number",
    default: 60,
    description: "Seconds for each slow bash stage to sleep before echoing done.",
  })
  .run(async (ctx) => {
    const delay = seconds(ctx.inputs.delay);
    const results = await ctx.parallel([
      { name: "left-slow", task: slowTask("left", delay), tools: ["bash"] },
      { name: "right-slow", task: slowTask("right", delay), tools: ["bash"] },
    ], { concurrency: 2, failFast: false });
    return {
      results: results.map((result) => result.text),
    };
  })
  .compile();
