/**
 * Hello-parallel workflow for Claude Code — parallel session example.
 *
 * Session 1 (sequential): Ask Claude to describe the project.
 * Sessions 2+3 (parallel): Two agents summarize session 1 concurrently.
 * Session 4 (sequential): Merge both summaries into a final output.
 *
 * Run: atomic workflow -n hello-parallel -a claude "describe this project"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"claude">({
  name: "hello-parallel",
  description: "Parallel Claude demo: describe → [summarize-a, summarize-b] → merge",
})
  .run(async (ctx) => {
    const describe = await ctx.stage(
      { name: "describe", description: "Ask Claude to describe the project" },
      {},
      {},
      async (s) => {
        await s.session.query(s.userPrompt);
        s.save(s.sessionId);
      },
    );

    const [summarizeA, summarizeB] = await Promise.all([
      ctx.stage(
        { name: "summarize-a", description: "Summarize the description as bullet points" },
        {},
        {},
        async (s) => {
          const research = await s.transcript(describe);
          await s.session.query(`Read ${research.path} and summarize it in 2-3 bullet points.`);
          s.save(s.sessionId);
        },
      ),
      ctx.stage(
        { name: "summarize-b", description: "Summarize the description as a one-liner" },
        {},
        {},
        async (s) => {
          const research = await s.transcript(describe);
          await s.session.query(`Read ${research.path} and summarize it in a single sentence.`);
          s.save(s.sessionId);
        },
      ),
    ]);

    await ctx.stage(
      { name: "merge", description: "Merge both summaries into a final output" },
      {},
      {},
      async (s) => {
        const bullets = await s.transcript(summarizeA);
        const oneliner = await s.transcript(summarizeB);
        await s.session.query(
          [
            "Combine the following two summaries into one concise paragraph:",
            "",
            "## Bullet points",
            bullets.content,
            "",
            "## One-liner",
            oneliner.content,
          ].join("\n"),
        );
        s.save(s.sessionId);
      },
    );
  })
  .compile();
