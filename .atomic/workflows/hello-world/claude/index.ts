import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
    name: "hello-world",
    description: "A simple single-session hello world workflow",
  })
  .run(async (ctx) => {
    await ctx.stage(
      { name: "hello", description: "Say hello to the world" },
      {},
      {},
      async (s) => {
        await s.session.query(s.userPrompt);
        s.save(s.sessionId);
      },
    );
  })
  .compile();
