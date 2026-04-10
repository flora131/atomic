/**
 * Hello workflow for Copilot — two-session example.
 *
 * Session 1: Ask the agent to describe the project.
 * Session 2: Read session 1's transcript and summarize it.
 *
 * Run: atomic workflow -n hello -a copilot "describe this project"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";
import { CopilotClient, approveAll } from "@github/copilot-sdk";

/**
 * `CopilotSession.sendAndWait` defaults to a 60s timeout and THROWS on
 * expiry, which crashes the workflow mid-stage. Override with a generous
 * 30-minute budget so legitimate long-running agent work completes.
 */
const SEND_TIMEOUT_MS = 30 * 60 * 1000;

export default defineWorkflow({
  name: "hello",
  description: "Two-session Copilot demo: describe → summarize",
})
  .run(async (ctx) => {
    const describe = await ctx.session(
      { name: "describe", description: "Ask the agent to describe the project" },
      async (s) => {
        const client = new CopilotClient({ cliUrl: s.serverUrl });
        await client.start();

        const session = await client.createSession({ onPermissionRequest: approveAll });
        await client.setForegroundSessionId(session.sessionId);

        await session.sendAndWait({ prompt: s.userPrompt }, SEND_TIMEOUT_MS);

        s.save(await session.getMessages());

        await session.disconnect();
        await client.stop();
      },
    );

    await ctx.session(
      { name: "summarize", description: "Summarize the previous session's output" },
      async (s) => {
        const research = await s.transcript(describe);

        const client = new CopilotClient({ cliUrl: s.serverUrl });
        await client.start();

        const session = await client.createSession({ onPermissionRequest: approveAll });
        await client.setForegroundSessionId(session.sessionId);

        await session.sendAndWait(
          {
            prompt: `Summarize the following in 2-3 bullet points:\n\n${research.content}`,
          },
          SEND_TIMEOUT_MS,
        );

        s.save(await session.getMessages());

        await session.disconnect();
        await client.stop();
      },
    );
  })
  .compile();
