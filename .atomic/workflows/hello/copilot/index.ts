/**
 * Hello workflow for Copilot — two-session example.
 *
 * Session 1: Ask the agent to describe the project.
 * Session 2: Read session 1's transcript and summarize it.
 *
 * Run: atomic workflow -n hello -a copilot "describe this project"
 */

import { defineWorkflow } from "@bastani/atomic-workflows";
import { CopilotClient, approveAll } from "@github/copilot-sdk";

export default defineWorkflow({
  name: "hello",
  description: "Two-session Copilot demo: describe → summarize",
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

      // Save Copilot messages for the next session
      ctx.save(await session.getMessages() );

      await session.disconnect();
      await client.stop();
    },
  })
  .session({
    name: "summarize",
    description: "Summarize the previous session's output",
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
  })
  .compile();
