import { defineWorkflow } from "@bastani/workflows";

export default defineWorkflow("enter-ownership-dummy")
  .description("Manual tmux verifier for workflow HiL Enter ownership with simultaneous prompt nodes.")
  .run(async (ctx) => {
    const [alpha, beta] = await Promise.all([
      ctx.ui.select(
        [
          "ENTER OWNERSHIP PROMPT ALPHA.",
          "Only an Enter pressed while visibly attached to this ALPHA node should submit this prompt.",
        ].join("\n"),
        ["alpha-one", "alpha-two"],
      ),
      ctx.ui.select(
        [
          "ENTER OWNERSHIP PROMPT BETA.",
          "Only an Enter pressed while visibly attached to this BETA node should submit this prompt.",
        ].join("\n"),
        ["beta-one", "beta-two"],
      ),
    ]);

    const final = await ctx.ui.confirm(
      [
        "ENTER OWNERSHIP FINAL CONFIRM.",
        `Alpha: ${alpha}`,
        `Beta: ${beta}`,
        "This final prompt verifies graph transition after resolving prior prompts.",
      ].join("\n"),
    );

    return { alpha, beta, final };
  })
  .compile();
