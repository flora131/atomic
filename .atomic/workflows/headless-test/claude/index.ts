import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
  name: "headless-test",
  description:
    "Test headless background stages: visible → [3 headless] → visible merge",
})
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "TypeScript";

    // ── Visible stage: seed ──
    const seed = await ctx.stage(
      { name: "seed", description: "Generate a topic overview" },
      {},
      {},
      async (s) => {
        const result = await s.session.query(
          `In one short paragraph, describe what "${prompt}" is.`,
        );
        s.save(s.sessionId);
        return String(result.output ?? "");
      },
    );

    // ── Three parallel headless background stages ──
    const [prosHandle, consHandle, usesHandle] = await Promise.all([
      ctx.stage(
        { name: "pros", headless: true },
        {},
        {},
        async (s) => {
          const result = await s.session.query(
            `Given this topic overview, list 3 pros:\n\n${seed.result}`,
          );
          s.save(s.sessionId);
          return String(result.output ?? "");
        },
      ),
      ctx.stage(
        { name: "cons", headless: true },
        {},
        {},
        async (s) => {
          const result = await s.session.query(
            `Given this topic overview, list 3 cons:\n\n${seed.result}`,
          );
          s.save(s.sessionId);
          return String(result.output ?? "");
        },
      ),
      ctx.stage(
        { name: "uses", headless: true },
        {},
        {},
        async (s) => {
          const result = await s.session.query(
            `Given this topic overview, list 3 use cases:\n\n${seed.result}`,
          );
          s.save(s.sessionId);
          return String(result.output ?? "");
        },
      ),
    ]);

    // ── Visible stage: merge results from background stages ──
    await ctx.stage(
      { name: "merge", description: "Combine background results" },
      {},
      {},
      async (s) => {
        await s.session.query(
          [
            "Combine these three analyses into a concise summary:\n",
            `## Pros\n${prosHandle.result}`,
            `## Cons\n${consHandle.result}`,
            `## Use Cases\n${usesHandle.result}`,
          ].join("\n\n"),
        );
        s.save(s.sessionId);
      },
    );
  })
  .compile();
