import { defineWorkflow } from "@bastani/atomic/workflows";

const SEND_TIMEOUT_MS = 30 * 60 * 1000;

export default defineWorkflow<"copilot">({
    name: "hello-world",
    description: "A simple single-session hello world workflow",
  })
  .run(async (ctx) => {
    await ctx.stage(
      { name: "hello", description: "Say hello to the world" },
      {},
      {},
      async (s) => {
        await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);
        s.save(await s.session.getMessages());
      },
    );
  })
  .compile();
