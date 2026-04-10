/**
 * Hello-parallel workflow for Copilot — parallel session example.
 *
 * Session 1 (sequential): Ask the agent to describe the project.
 * Sessions 2+3 (parallel): Two agents summarize session 1 concurrently.
 * Session 4 (sequential): Merge both summaries into a final output.
 *
 * Run: atomic workflow -n hello-parallel -a copilot "describe this project"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";

/**
 * `CopilotSession.sendAndWait` defaults to a 60s timeout and THROWS on
 * expiry, which crashes the workflow mid-stage. Override with a generous
 * 30-minute budget so legitimate long-running agent work completes.
 */
const SEND_TIMEOUT_MS = 30 * 60 * 1000;

export default defineWorkflow<"copilot">({
  name: "hello-parallel",
  description: "Parallel Copilot demo: describe → [summarize-a, summarize-b] → merge",
})
  .run(async (ctx) => {
    // Sequential: describe
    const describe = await ctx.stage(
      { name: "describe", description: "Ask the agent to describe the project" },
      {},
      {},
      async (s) => {
        await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);

        s.save(await s.session.getMessages());
      },
    );

    // Parallel: summarize-a + summarize-b
    const [summarizeA, summarizeB] = await Promise.all([
      ctx.stage(
        { name: "summarize-a", description: "Summarize the description as bullet points" },
        {},
        {},
        async (s) => {
          const research = await s.transcript(describe);

          await s.session.sendAndWait(
            {
              prompt: `Summarize the following in 2-3 bullet points:\n\n${research.content}`,
            },
            SEND_TIMEOUT_MS,
          );

          s.save(await s.session.getMessages());
        },
      ),
      ctx.stage(
        { name: "summarize-b", description: "Summarize the description as a one-liner" },
        {},
        {},
        async (s) => {
          const research = await s.transcript(describe);

          await s.session.sendAndWait(
            {
              prompt: `Summarize the following in a single sentence:\n\n${research.content}`,
            },
            SEND_TIMEOUT_MS,
          );

          s.save(await s.session.getMessages());
        },
      ),
    ]);

    // Sequential: merge
    await ctx.stage(
      { name: "merge", description: "Merge both summaries into a final output" },
      {},
      {},
      async (s) => {
        const bullets = await s.transcript(summarizeA);
        const oneliner = await s.transcript(summarizeB);

        await s.session.sendAndWait(
          {
            prompt: [
              "Combine the following two summaries into one concise paragraph:",
              "",
              "## Bullet points",
              bullets.content,
              "",
              "## One-liner",
              oneliner.content,
            ].join("\n"),
          },
          SEND_TIMEOUT_MS,
        );

        s.save(await s.session.getMessages());
      },
    );
  })
  .compile();
