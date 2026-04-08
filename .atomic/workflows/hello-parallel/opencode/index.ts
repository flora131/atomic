/**
 * Hello-parallel workflow for OpenCode — parallel session example.
 *
 * Session 1 (sequential): Ask the agent to describe the project.
 * Sessions 2+3 (parallel): Two agents summarize session 1 concurrently.
 * Session 4 (sequential): Merge both summaries into a final output.
 *
 * Run: atomic workflow -n hello-parallel -a opencode "describe this project"
 */

import { defineWorkflow } from "@bastani/atomic-workflows";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

export default defineWorkflow({
  name: "hello-parallel",
  description: "Parallel OpenCode demo: describe → [summarize-a, summarize-b] → merge",
})
  .session({
    name: "describe",
    description: "Ask the agent to describe the project",
    run: async (ctx) => {
      const client = createOpencodeClient({ baseUrl: ctx.serverUrl });

      const session = await client.session.create({ title: "describe" });
      await client.tui.selectSession({ sessionID: session.data!.id });

      const result = await client.session.prompt({
        sessionID: session.data!.id,
        parts: [{ type: "text", text: ctx.userPrompt }],
      });

      ctx.save(result.data!);
    },
  })
  .session([
    {
      name: "summarize-a",
      description: "Summarize the description as bullet points",
      run: async (ctx) => {
        const research = await ctx.transcript("describe");
        const client = createOpencodeClient({ baseUrl: ctx.serverUrl });

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

        ctx.save(result.data!);
      },
    },
    {
      name: "summarize-b",
      description: "Summarize the description as a one-liner",
      run: async (ctx) => {
        const research = await ctx.transcript("describe");
        const client = createOpencodeClient({ baseUrl: ctx.serverUrl });

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

        ctx.save(result.data!);
      },
    },
  ])
  .session({
    name: "merge",
    description: "Merge both summaries into a final output",
    run: async (ctx) => {
      const bullets = await ctx.transcript("summarize-a");
      const oneliner = await ctx.transcript("summarize-b");
      const client = createOpencodeClient({ baseUrl: ctx.serverUrl });

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

      ctx.save(result.data!);
    },
  })
  .compile();
