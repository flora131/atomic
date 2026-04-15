/**
 * HIL test workflow for Claude Code.
 *
 * Exercises the human-in-the-loop detection and UI surfacing by running
 * four stages that each ask the user a question via AskUserQuestion:
 *
 *   setup (sequential)
 *     → worker-a + worker-b (parallel, both ask questions)
 *       → summarizer (sequential, asks a final question)
 *
 * All file writes go to /tmp/hil-test/ — no repository changes.
 *
 * Run: atomic workflow -n hil-test -a claude
 */

import { defineWorkflow, extractAssistantText } from "../../../index.ts";

import {
  buildSetupPrompt,
  buildWorkerAPrompt,
  buildWorkerBPrompt,
  buildSummarizerPrompt,
} from "../helpers/prompts.ts";

export default defineWorkflow({
  name: "hil-test",
  description: "HIL detection test — parallel + sequential stages with user questions",
  inputs: [],
})
  .for<"claude">()
  .run(async (ctx) => {
    // ── Setup (sequential) ──────────────────────────────────────────────
    await ctx.stage(
      { name: "setup" },
      {},
      {},
      async (s) => {
        const result = await s.session.query(buildSetupPrompt());
        s.save(s.sessionId);
        return extractAssistantText(result, 0);
      },
    );

    // ── Workers A + B (parallel — both will ask user questions) ─────────
    const [workerA, workerB] = await Promise.all([
      ctx.stage(
        { name: "worker-a" },
        {},
        {},
        async (s) => {
          const result = await s.session.query(buildWorkerAPrompt());
          s.save(s.sessionId);
          return extractAssistantText(result, 0);
        },
      ),
      ctx.stage(
        { name: "worker-b" },
        {},
        {},
        async (s) => {
          const result = await s.session.query(buildWorkerBPrompt());
          s.save(s.sessionId);
          return extractAssistantText(result, 0);
        },
      ),
    ]);

    // ── Summarizer (sequential — asks a final question) ─────────────────
    await ctx.stage(
      { name: "summarizer" },
      {},
      {},
      async (s) => {
        const result = await s.session.query(buildSummarizerPrompt());
        s.save(s.sessionId);
        return extractAssistantText(result, 0);
      },
    );
  })
  .compile();
