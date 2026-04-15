/**
 * HIL test workflow for GitHub Copilot CLI.
 *
 * Exercises the human-in-the-loop detection and UI surfacing by running
 * four stages that each ask the user a question:
 *
 *   setup (sequential)
 *     → worker-a + worker-b (parallel, both ask questions)
 *       → summarizer (sequential, asks a final question)
 *
 * All file writes go to /tmp/hil-test/ — no repository changes.
 *
 * Run: atomic workflow -n hil-test -a copilot
 */

import { defineWorkflow } from "../../../index.ts";
import type { SessionEvent } from "@github/copilot-sdk";

import {
  buildSetupPrompt,
  buildWorkerAPrompt,
  buildWorkerBPrompt,
  buildSummarizerPrompt,
} from "../helpers/prompts.ts";

/** Concatenate top-level assistant message content from the event stream. */
function getAssistantText(messages: SessionEvent[]): string {
  return messages
    .filter(
      (m): m is Extract<SessionEvent, { type: "assistant.message" }> =>
        m.type === "assistant.message" && !m.data.parentToolCallId,
    )
    .map((m) => m.data.content)
    .filter((c) => c.length > 0)
    .join("\n\n");
}

export default defineWorkflow({
  name: "hil-test",
  description: "HIL detection test — parallel + sequential stages with user questions",
  inputs: [],
})
  .for<"copilot">()
  .run(async (ctx) => {
    // ── Setup (sequential) ──────────────────────────────────────────────
    await ctx.stage(
      { name: "setup" },
      {},
      {},
      async (s) => {
        await s.session.send({ prompt: buildSetupPrompt() });
        const messages = await s.session.getMessages();
        s.save(messages);
        return getAssistantText(messages);
      },
    );

    // ── Workers A + B (parallel — both will ask user questions) ─────────
    const [workerA, workerB] = await Promise.all([
      ctx.stage(
        { name: "worker-a" },
        {},
        {},
        async (s) => {
          await s.session.send({ prompt: buildWorkerAPrompt() });
          const messages = await s.session.getMessages();
          s.save(messages);
          return getAssistantText(messages);
        },
      ),
      ctx.stage(
        { name: "worker-b" },
        {},
        {},
        async (s) => {
          await s.session.send({ prompt: buildWorkerBPrompt() });
          const messages = await s.session.getMessages();
          s.save(messages);
          return getAssistantText(messages);
        },
      ),
    ]);

    // ── Summarizer (sequential — asks a final question) ─────────────────
    await ctx.stage(
      { name: "summarizer" },
      {},
      {},
      async (s) => {
        await s.session.send({ prompt: buildSummarizerPrompt() });
        const messages = await s.session.getMessages();
        s.save(messages);
        return getAssistantText(messages);
      },
    );
  })
  .compile();
