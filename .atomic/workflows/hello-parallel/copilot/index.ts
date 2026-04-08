/**
 * Hello-parallel workflow for Copilot — parallel session example.
 *
 * Session 1 (sequential): Ask the agent to describe the project.
 * Sessions 2+3 (parallel): Two agents summarize session 1 concurrently.
 * Session 4 (sequential): Merge both summaries into a final output.
 *
 * Run: atomic workflow -n hello-parallel -a copilot "describe this project"
 */

import { defineWorkflow } from "@bastani/atomic-workflows";
import { CopilotClient, approveAll } from "@github/copilot-sdk";

export default defineWorkflow({
  name: "hello-parallel",
  description: "Parallel Copilot demo: describe → [summarize-a, summarize-b] → merge",
})
  .session({
    name: "describe",
    description: "Ask the agent to describe the project",
    run: async (ctx) => {
      const client = new CopilotClient({ cliUrl: ctx.serverUrl });
      await client.start();

      const session = await client.createSession({ onPermissionRequest: approveAll });
      await client.setForegroundSessionId(session.sessionId);
      await session.sendAndWait({ prompt: ctx.userPrompt });

      ctx.save(await session.getMessages());
      await session.disconnect();
      await client.stop();
    },
  })
  .session([
    {
      name: "summarize-a",
      description: "Summarize the description as bullet points",
      run: async (ctx) => {
        const research = await ctx.transcript("describe");

        const client = new CopilotClient({ cliUrl: ctx.serverUrl });
        await client.start();

        const session = await client.createSession({ onPermissionRequest: approveAll });
        await client.setForegroundSessionId(session.sessionId);
        await session.sendAndWait({
          prompt: `Summarize the following in 2-3 bullet points:\n\n${research.content}`,
        });

        ctx.save(await session.getMessages());
        await session.disconnect();
        await client.stop();
      },
    },
    {
      name: "summarize-b",
      description: "Summarize the description as a one-liner",
      run: async (ctx) => {
        const research = await ctx.transcript("describe");

        const client = new CopilotClient({ cliUrl: ctx.serverUrl });
        await client.start();

        const session = await client.createSession({ onPermissionRequest: approveAll });
        await client.setForegroundSessionId(session.sessionId);
        await session.sendAndWait({
          prompt: `Summarize the following in a single sentence:\n\n${research.content}`,
        });

        ctx.save(await session.getMessages());
        await session.disconnect();
        await client.stop();
      },
    },
  ])
  .session({
    name: "merge",
    description: "Merge both summaries into a final output",
    run: async (ctx) => {
      const bullets = await ctx.transcript("summarize-a");
      const oneliner = await ctx.transcript("summarize-b");

      const client = new CopilotClient({ cliUrl: ctx.serverUrl });
      await client.start();

      const session = await client.createSession({ onPermissionRequest: approveAll });
      await client.setForegroundSessionId(session.sessionId);
      await session.sendAndWait({
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

      ctx.save(await session.getMessages());
      await session.disconnect();
      await client.stop();
    },
  })
  .compile();
