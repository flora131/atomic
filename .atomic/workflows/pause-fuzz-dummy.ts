import { defineWorkflow } from "@bastani/workflows";

function seconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 45;
  return Math.max(5, Math.min(120, Math.floor(value)));
}

export default defineWorkflow("pause-fuzz-dummy")
  .description("Manual tmux verifier for orchestrator pause/resume UI state.")
  .input("delay", {
    type: "number",
    default: 45,
    description: "Seconds for the slow bash stage to sleep before echoing done.",
  })
  .run(async (ctx) => {
    const delay = seconds(ctx.inputs.delay);
    const slow = await ctx.stage("slow-bash", { tools: ["bash"] }).prompt(
      [
        "You are running a manual pause-state verifier.",
        "Call the bash tool exactly once with this command:",
        `sleep ${delay}; echo PAUSE_FUZZ_DONE`,
        "Wait for the command to finish, then reply exactly: PAUSE_FUZZ_DONE.",
        "Do not ask questions.",
      ].join("\n"),
    );

    const approved = await ctx.ui.confirm(
      [
        "PAUSE FUZZ CONFIRM.",
        "This prompt appears after the slow stage finishes/resumes.",
        "Use it to verify the orchestrator transitions from paused/running into awaiting input cleanly.",
      ].join("\n"),
    );

    return { slow: slow.text, approved };
  })
  .compile();
