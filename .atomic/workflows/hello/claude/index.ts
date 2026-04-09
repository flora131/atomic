/**
 * Hello workflow for Claude Code — two-session example.
 *
 * Claude runs as a full interactive TUI in a tmux pane.
 * We automate it via tmux send-keys using the claudeQuery() helper.
 * Transcript is extracted via the Claude Agent SDK's getSessionMessages().
 *
 * Run: atomic workflow -n hello -a claude "describe this project"
 */

import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic/workflows";

export default defineWorkflow({
  name: "hello",
  description: "Two-session Claude demo: describe → summarize",
})
  .run(async (ctx) => {
    const describe = await ctx.session(
      { name: "describe", description: "Ask Claude to describe the project" },
      async (s) => {
        await createClaudeSession({ paneId: s.paneId });
        await claudeQuery({ paneId: s.paneId, prompt: s.userPrompt });
        s.save(s.sessionId);
      },
    );

    await ctx.session(
      { name: "summarize", description: "Summarize the previous session's output" },
      async (s) => {
        await createClaudeSession({ paneId: s.paneId });
        const research = await s.transcript(describe);

        await claudeQuery({
          paneId: s.paneId,
          prompt: `Read ${research.path} and summarize it in 2-3 bullet points.`,
        });
        s.save(s.sessionId);
      },
    );
  })
  .compile();
