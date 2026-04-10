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
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

export default defineWorkflow({
  name: "hello-parallel",
  description: "Parallel OpenCode demo: describe → [summarize-a, summarize-b] → merge",
})
  .run(async (ctx) => {
    const describe = await ctx.session(
      { name: "describe", description: "Ask the agent to describe the project" },
      async (s) => {
        const client = createOpencodeClient({ baseUrl: s.serverUrl });

        const session = await client.session.create({ title: "describe" });
        await client.tui.selectSession({ sessionID: session.data!.id });

        const result = await client.session.prompt({
          sessionID: session.data!.id,
          parts: [{ type: "text", text: s.userPrompt }],
        });

        s.save(result.data!);
      },
    );

    const [summarizeA, summarizeB] = await Promise.all([
      ctx.session(
        { name: "summarize-a", description: "Summarize the description as bullet points" },
        async (s) => {
          const research = await s.transcript(describe);
          const client = createOpencodeClient({ baseUrl: s.serverUrl });

          const session = await client.session.create({ title: "summarize-a" });
          await client.tui.selectSession({ sessionID: session.data!.id });

          const result = await client.session.prompt({
            sessionID: session.data!.id,
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
      ctx.session(
        { name: "summarize-b", description: "Summarize the description as a one-liner" },
        async (s) => {
          const research = await s.transcript(describe);
          const client = createOpencodeClient({ baseUrl: s.serverUrl });

          const session = await client.session.create({ title: "summarize-b" });
          await client.tui.selectSession({ sessionID: session.data!.id });

          const result = await client.session.prompt({
            sessionID: session.data!.id,
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

    await ctx.session(
      { name: "merge", description: "Merge both summaries into a final output" },
      async (s) => {
        const bullets = await s.transcript(summarizeA);
        const oneliner = await s.transcript(summarizeB);
        const client = createOpencodeClient({ baseUrl: s.serverUrl });

        const session = await client.session.create({ title: "merge" });
        await client.tui.selectSession({ sessionID: session.data!.id });

        const result = await client.session.prompt({
          sessionID: session.data!.id,
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
