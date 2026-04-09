/**
 * Hello workflow for OpenCode — two-session example.
 *
 * Session 1: Ask the agent to describe the project.
 * Session 2: Read session 1's transcript and summarize it.
 *
 * Run: atomic workflow -n hello -a opencode "describe this project"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

export default defineWorkflow({
  name: "hello",
  description: "Two-session OpenCode demo: describe → summarize",
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

    await ctx.session(
      { name: "summarize", description: "Summarize the previous session's output" },
      async (s) => {
        const research = await s.transcript(describe);
        const client = createOpencodeClient({ baseUrl: s.serverUrl });

        const session = await client.session.create({ title: "summarize" });
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
    );
  })
  .compile();
