import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
    name: "parallel-hello-world",
    description: "Parallel hello world: greet → [formal, casual] → merge",
  })
  .run(async (ctx) => {
    const greet = await ctx.stage(
      { name: "greet", description: "Generate a greeting topic" },
      {},
      {},
      async (s) => {
        await s.session.query(s.userPrompt);
        s.save(s.sessionId);
      },
    );

    const [formal, casual] = await Promise.all([
      ctx.stage(
        { name: "formal", description: "Write a formal greeting" },
        {},
        {},
        async (s) => {
          const prior = await s.transcript(greet);
          await s.session.query(
            `Read ${prior.path} and rewrite it as a formal greeting.`,
          );
          s.save(s.sessionId);
        },
      ),
      ctx.stage(
        { name: "casual", description: "Write a casual greeting" },
        {},
        {},
        async (s) => {
          const prior = await s.transcript(greet);
          await s.session.query(
            `Read ${prior.path} and rewrite it as a casual greeting.`,
          );
          s.save(s.sessionId);
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
        await s.session.query(
          `Combine these two greetings into a single message:\n\n## Formal\n${formalText.content}\n\n## Casual\n${casualText.content}`,
        );
        s.save(s.sessionId);
      },
    );
  })
  .compile();
