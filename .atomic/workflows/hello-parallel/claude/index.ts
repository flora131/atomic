/**
 * Hello-parallel workflow for Claude Code — parallel session example.
 *
 * Session 1 (sequential): Ask Claude to describe the project.
 * Sessions 2+3 (parallel): Two agents summarize session 1 concurrently.
 * Session 4 (sequential): Merge both summaries into a final output.
 *
 * Run: atomic workflow -n hello-parallel -a claude "describe this project"
 */

import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic/workflows";

export default defineWorkflow({
  name: "hello-parallel",
  description: "Parallel Claude demo: describe → [summarize-a, summarize-b] → merge",
})
  .run(async (ctx) => {
    const describe = await ctx.session(
      { name: "describe", description: "Ask Claude to describe the project" },
      async (s) => {
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({ paneId: s.paneId, prompt: s.userPrompt });
        s.save(s.sessionId);
      },
    );

    const [summarizeA, summarizeB] = await Promise.all([
      ctx.session(
        { name: "summarize-a", description: "Summarize the description as bullet points" },
        async (s) => {
          const research = await s.transcript(describe);
          await createClaudeSession({ paneId: s.paneId });
          await claudeQuery({
            paneId: s.paneId,
            prompt: `Read ${research.path} and summarize it in 2-3 bullet points.`,
          });
          s.save(s.sessionId);
        },
      ),
      ctx.session(
        { name: "summarize-b", description: "Summarize the description as a one-liner" },
        async (s) => {
          const research = await s.transcript(describe);
          await createClaudeSession({ paneId: s.paneId });
          await claudeQuery({
            paneId: s.paneId,
            prompt: `Read ${research.path} and summarize it in a single sentence.`,
          });
          s.save(s.sessionId);
        },
      ),
    ]);

    await ctx.session(
      { name: "merge", description: "Merge both summaries into a final output" },
      async (s) => {
        const bullets = await s.transcript(summarizeA);
        const oneliner = await s.transcript(summarizeB);
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({
          paneId: s.paneId,
          prompt: [
            "Combine the following two summaries into one concise paragraph:",
            "",
            "## Bullet points",
            bullets.content,
            "",
            "## One-liner",
            oneliner.content,
          ].join("\n"),
        });
        s.save(s.sessionId);
      },
    );
  })
  .compile();
