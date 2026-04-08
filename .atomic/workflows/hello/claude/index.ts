/**
 * Hello workflow for Claude Code — two-session example.
 *
 * Claude runs as a full interactive TUI in a tmux pane.
 * We automate it via tmux send-keys using the claudeQuery() helper.
 * Transcript is extracted via the Claude Agent SDK's getSessionMessages().
 *
 * Run: atomic workflow -n hello -a claude "describe this project"
 */

import { defineWorkflow, createClaudeSession, claudeQuery } from "@bastani/atomic-workflows";

export default defineWorkflow({
  name: "hello",
  description: "Two-session Claude demo: describe → summarize",
})
  .session({
    name: "describe",
    description: "Ask Claude to describe the project",
    run: async (ctx) => {
      await createClaudeSession({ paneId: ctx.paneId });
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: ctx.userPrompt,
      });
      // Save transcript via Claude Agent SDK (reads from ~/.claude session files)
      ctx.save(ctx.sessionId);
    },
  })
  .session({
    name: "summarize",
    description: "Summarize the previous session's output",
    run: async (ctx) => {
      await createClaudeSession({ paneId: ctx.paneId });
      const research = await ctx.transcript("describe");

      await claudeQuery({
        paneId: ctx.paneId,
        prompt: `Read ${research.path} and summarize it in 2-3 bullet points.`,
      });
      ctx.save(ctx.sessionId);
    },
  })
  .compile();
