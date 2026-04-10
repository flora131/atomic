/**
 * Hello workflow for OpenCode — two-session example.
 *
 * Session 1: Ask the agent to describe the project.
 * Session 2: Read session 1's transcript and summarize it.
 *
 * Run: atomic workflow -n hello -a opencode "describe this project"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";

export default defineWorkflow<"opencode">({
  name: "hello",
  description: "Two-session OpenCode demo: describe → summarize",
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

    await ctx.stage(
      { name: "summarize", description: "Summarize the previous session's output" },
      {},
      { title: "summarize" },
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
    );
  })
  .compile();
