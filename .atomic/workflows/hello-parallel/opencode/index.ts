/**
 * Hello-parallel workflow for OpenCode — parallel session example.
 *
 * Session 1 (sequential): Ask the agent to describe the project.
 * Sessions 2+3 (parallel): Two agents summarize session 1 concurrently.
 * Session 4 (sequential): Merge both summaries into a final output.
 *
 * Run: atomic workflow -n hello-parallel -a opencode "describe this project"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"opencode">({
  name: "hello-parallel",
  description: "Parallel OpenCode demo: describe → [summarize-a, summarize-b] → merge",
})
  .run(async (ctx) => {
    const describe = await ctx.stage(
      { name: "describe", description: "Ask the agent to describe the project" },
      {},
      { title: "describe" },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: s.userPrompt }],
        });

        s.save(result.data!);
      },
    );

    const [summarizeA, summarizeB] = await Promise.all([
      ctx.stage(
        { name: "summarize-a", description: "Summarize the description as bullet points" },
        {},
        { title: "summarize-a" },
        async (s) => {
          const research = await s.transcript(describe);

          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: `Summarize the following in 2-3 bullet points:\n\n${research.content}`,
              },
            ],
          });

          s.save(result.data!);
        },
      ),
      ctx.stage(
        { name: "summarize-b", description: "Summarize the description as a one-liner" },
        {},
        { title: "summarize-b" },
        async (s) => {
          const research = await s.transcript(describe);

          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: `Summarize the following in a single sentence:\n\n${research.content}`,
              },
            ],
          });

          s.save(result.data!);
        },
      ),
    ]);

    await ctx.stage(
      { name: "merge", description: "Merge both summaries into a final output" },
      {},
      { title: "merge" },
      async (s) => {
        const bullets = await s.transcript(summarizeA);
        const oneliner = await s.transcript(summarizeB);

        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [
            {
              type: "text",
              text: [
                "Combine the following two summaries into one concise paragraph:",
                "",
                "## Bullet points",
                bullets.content,
                "",
                "## One-liner",
                oneliner.content,
              ].join("\n"),
            },
          ],
        });

        s.save(result.data!);
      },
    );
  })
  .compile();
