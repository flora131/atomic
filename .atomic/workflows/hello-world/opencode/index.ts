import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"opencode">({
    name: "hello-world",
    description: "A simple single-session hello world workflow",
  })
  .run(async (ctx) => {
    await ctx.stage(
      { name: "hello", description: "Say hello to the world" },
      {},
      { title: "hello" },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: s.userPrompt }],
        });
        s.save(result.data!);
      },
    );
  })
  .compile();
