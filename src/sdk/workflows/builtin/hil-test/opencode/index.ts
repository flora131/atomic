/**
 * HIL test workflow for OpenCode.
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
 * Run: atomic workflow -n hil-test -a opencode
 */

import { defineWorkflow } from "../../../index.ts";

import {
  buildSetupPrompt,
  buildWorkerAPrompt,
  buildWorkerBPrompt,
  buildSummarizerPrompt,
} from "../helpers/prompts.ts";

/** Concatenate the text-typed parts of an OpenCode response. */
function extractResponseText(
  parts: Array<{ type: string; [key: string]: unknown }>,
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: string; text: string }).text)
    .join("\n");
}

export default defineWorkflow({
  name: "hil-test",
  description: "HIL detection test — parallel + sequential stages with user questions",
  inputs: [],
})
  .for<"opencode">()
  .run(async (ctx) => {
    // ── Setup (sequential) ──────────────────────────────────────────────
    await ctx.stage(
      { name: "setup" },
      {},
      { title: "setup" },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: buildSetupPrompt() }],
        });
        s.save(result.data!);
        return extractResponseText(result.data!.parts);
      },
    );

    // ── Workers A + B (parallel — both will ask user questions) ─────────
    const [workerA, workerB] = await Promise.all([
      ctx.stage(
        { name: "worker-a" },
        {},
        { title: "worker-a" },
        async (s) => {
          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [{ type: "text", text: buildWorkerAPrompt() }],
          });
          s.save(result.data!);
          return extractResponseText(result.data!.parts);
        },
      ),
      ctx.stage(
        { name: "worker-b" },
        {},
        { title: "worker-b" },
        async (s) => {
          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [{ type: "text", text: buildWorkerBPrompt() }],
          });
          s.save(result.data!);
          return extractResponseText(result.data!.parts);
        },
      ),
    ]);

    // ── Summarizer (sequential — asks a final question) ─────────────────
    await ctx.stage(
      { name: "summarizer" },
      {},
      { title: "summarizer" },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: buildSummarizerPrompt() }],
        });
        s.save(result.data!);
        return extractResponseText(result.data!.parts);
      },
    );
  })
  .compile();
