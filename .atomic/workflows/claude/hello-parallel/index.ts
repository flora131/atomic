/**
 * Hello-parallel workflow for Claude Code — parallel session example.
 *
 * Session 1 (sequential): Ask Claude to describe the project.
 * Sessions 2+3 (parallel): Two agents summarize session 1 concurrently.
 * Session 4 (sequential): Merge both summaries into a final output.
 *
 * Run: atomic workflow -n hello-parallel -a claude "describe this project"
 */

import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic-workflows";

export default defineWorkflow({
  name: "hello-parallel",
  description: "Parallel Claude demo: describe → [summarize-a, summarize-b] → merge",
})
  .session({
    name: "describe",
    description: "Ask Claude to describe the project",
    run: async (ctx) => {
      await createClaudeSession({ paneId: ctx.paneId });
      await claudeQuery({ paneId: ctx.paneId, prompt: ctx.userPrompt });
      ctx.save(ctx.sessionId);
    },
  })
  .session([
    {
      name: "summarize-a",
      description: "Summarize the description as bullet points",
      run: async (ctx) => {
        const research = await ctx.transcript("describe");
        await createClaudeSession({ paneId: ctx.paneId });
        await claudeQuery({
          paneId: ctx.paneId,
          prompt: `Read ${research.path} and summarize it in 2-3 bullet points.`,
        });
        ctx.save(ctx.sessionId);
      },
    },
    {
      name: "summarize-b",
      description: "Summarize the description as a one-liner",
      run: async (ctx) => {
        const research = await ctx.transcript("describe");
        await createClaudeSession({ paneId: ctx.paneId });
        await claudeQuery({
          paneId: ctx.paneId,
          prompt: `Read ${research.path} and summarize it in a single sentence.`,
        });
        ctx.save(ctx.sessionId);
      },
    },
  ])
  .session({
    name: "merge",
    description: "Merge both summaries into a final output",
    run: async (ctx) => {
      const bullets = await ctx.transcript("summarize-a");
      const oneliner = await ctx.transcript("summarize-b");
      await createClaudeSession({ paneId: ctx.paneId });
      await claudeQuery({
        paneId: ctx.paneId,
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
      ctx.save(ctx.sessionId);
    },
  })
  .compile();
