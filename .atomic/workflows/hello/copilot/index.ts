/**
 * Hello workflow for Copilot — two-session example.
 *
 * Session 1: Ask the agent to describe the project.
 * Session 2: Read session 1's transcript and summarize it.
 *
 * Run: atomic workflow -n hello -a copilot "describe this project"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";

/**
 * `CopilotSession.sendAndWait` defaults to a 60s timeout and THROWS on
 * expiry, which crashes the workflow mid-stage. Override with a generous
 * 30-minute budget so legitimate long-running agent work completes.
 */
const SEND_TIMEOUT_MS = 30 * 60 * 1000;

export default defineWorkflow<"copilot">({
  name: "hello",
  description: "Two-session Copilot demo: describe → summarize",
})
  .run(async (ctx) => {
    const describe = await ctx.stage(
      { name: "describe", description: "Ask the agent to describe the project" },
      {},
      {},
      async (s) => {
        await s.session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);

        s.save(await s.session.getMessages());
      },
    );

    await ctx.stage(
      { name: "summarize", description: "Summarize the previous session's output" },
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
    );
  })
  .compile();
