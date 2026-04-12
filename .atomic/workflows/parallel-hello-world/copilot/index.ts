import { defineWorkflow } from "@bastani/atomic/workflows";

const SEND_TIMEOUT_MS = 30 * 60 * 1000;

export default defineWorkflow<"copilot">({
    name: "parallel-hello-world",
    description: "Parallel hello world: greet → [formal, casual] → merge",
  })
  .run(async (ctx) => {
    const greet = await ctx.stage(
      { name: "greet", description: "Generate a greeting topic" },
      {},
      {},
      async (s) => {
        await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);
        s.save(await s.session.getMessages());
      },
    );

    const [formal, casual] = await Promise.all([
      ctx.stage(
        { name: "formal", description: "Write a formal greeting" },
        {},
        {},
        async (s) => {
          const prior = await s.transcript(greet);
          await s.session.sendAndWait(
            {
              prompt: `Rewrite the following as a formal greeting:\n\n${prior.content}`,
            },
            SEND_TIMEOUT_MS,
          );
          s.save(await s.session.getMessages());
        },
      ),
      ctx.stage(
        { name: "casual", description: "Write a casual greeting" },
        {},
        {},
        async (s) => {
          const prior = await s.transcript(greet);
          await s.session.sendAndWait(
            {
              prompt: `Rewrite the following as a casual greeting:\n\n${prior.content}`,
            },
            SEND_TIMEOUT_MS,
          );
          s.save(await s.session.getMessages());
        },
      ),
    ]);

    await ctx.stage(
      { name: "merge", description: "Combine both greetings" },
      {},
      {},
      async (s) => {
        const formalText = await s.transcript(formal);
        const casualText = await s.transcript(casual);
        await s.session.sendAndWait(
          {
            prompt: `Combine these two greetings into a single message:\n\n## Formal\n${formalText.content}\n\n## Casual\n${casualText.content}`,
          },
          SEND_TIMEOUT_MS,
        );
        s.save(await s.session.getMessages());
      },
    );
  })
  .compile();
