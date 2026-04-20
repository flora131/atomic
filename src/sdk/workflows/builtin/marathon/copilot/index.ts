/**
 * Marathon workflow for Copilot — continuous implementation loop with
 * fresh-context convergence review every {@link REVIEW_INTERVAL} iterations.
 *
 * Structure (Simon Last's "13-day coding agent" recipe, Ralph-style
 * convergence):
 *
 *   - Bootstrap stage: seeds \`spec.md\`, \`todo.md\`, \`tests/\` once.
 *   - Implement stage runs every iteration up to {@link MAX_ITERATIONS}.
 *   - At each checkpoint (every {@link REVIEW_INTERVAL} iterations or
 *     whenever the implementer self-reports COMPLETE), a fresh-context
 *     reviewer runs. If it returns STATUS: GAPS_FOUND, a fix → review
 *     loop runs until the reviewer returns STATUS: ALIGNED or
 *     {@link MAX_CONVERGENCE_ROUNDS} rounds are exhausted. Unresolved
 *     gaps are carried into the next regular iteration's feedback.
 *   - Terminate when the implementer reports COMPLETE AND the reviewer
 *     returns STATUS: ALIGNED in the same checkpoint.
 *
 * Every Copilot stage is a fresh session (F5) — the anchor files on disk
 * ARE the shared state, and each reviewer starts with no conversational
 * memory of prior iterations.
 *
 * Run: atomic workflow -n marathon -a copilot "<your spec>"
 */

import type { SessionEvent } from "@github/copilot-sdk";

import { defineWorkflow } from "../../../index.ts";

import {
  buildBootstrapPrompt,
  buildImplementPrompt,
  buildReviewPrompt,
  parseImplementStatus,
  parseReviewVerdict,
} from "../helpers/prompts.ts";

/** Upper bound on implement iterations — the whole point is long runs. */
const MAX_ITERATIONS = 100;

/** Cadence for the fresh-context adversarial reviewer. */
const REVIEW_INTERVAL = 20;

/** Maximum fix → review rounds per checkpoint before giving up and resuming the main cadence. */
const MAX_CONVERGENCE_ROUNDS = 5;

/**
 * Concatenate every top-level assistant turn's non-empty content.
 *
 * Avoids Copilot failure modes F1 (empty trailing assistant.message after a
 * tool-call turn) and F2 (subagent messages polluting the stream via
 * `parentToolCallId`).
 */
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
  name: "marathon",
  description:
    "Continuous implementation loop anchored by spec.md, todo.md, tests/ — with fresh-context adversarial review every 20 iterations",
  inputs: [
    {
      name: "prompt",
      type: "text",
      required: true,
      description: "initial specification / goal for the long-running task",
    },
  ],
})
  .for<"copilot">()
  .run(async (ctx) => {
    const spec = ctx.inputs.prompt ?? "";

    // ── Bootstrap ──────────────────────────────────────────────────────
    await ctx.stage(
      { name: "bootstrap" },
      {},
      {},
      async (s) => {
        await s.session.send({ prompt: buildBootstrapPrompt(spec) });
        s.save(await s.session.getMessages());
      },
    );

    let reviewFeedback = "";

    // ── Implement → (checkpoint convergence) loop ──────────────────────
    for (let i = 1; i <= MAX_ITERATIONS; i++) {
      const impl = await ctx.stage(
        { name: `implement-${i}` },
        {},
        {},
        async (s) => {
          await s.session.send({
            prompt: buildImplementPrompt(spec, {
              iteration: i,
              reviewFeedback: reviewFeedback || undefined,
            }),
          });
          const messages = await s.session.getMessages();
          s.save(messages);
          return parseImplementStatus(getAssistantText(messages));
        },
      );

      // Clear feedback — it has been delivered to this iteration.
      reviewFeedback = "";

      const implComplete = impl.result.status === "COMPLETE";
      const atCheckpoint = i % REVIEW_INTERVAL === 0 || implComplete;
      if (!atCheckpoint) continue;

      // Convergence: review, then fix→review until aligned or rounds exhausted.
      let aligned = false;
      let lastFeedback = "";

      for (let round = 0; round < MAX_CONVERGENCE_ROUNDS; round++) {
        if (round > 0) {
          await ctx.stage(
            { name: `fix-${i}-r${round}` },
            {},
            {},
            async (s) => {
              await s.session.send({
                prompt: buildImplementPrompt(spec, {
                  iteration: i,
                  reviewFeedback: lastFeedback,
                }),
              });
              const messages = await s.session.getMessages();
              s.save(messages);
            },
          );
        }

        const review = await ctx.stage(
          { name: `review-${i}-r${round}` },
          {},
          {},
          async (s) => {
            await s.session.send({
              prompt: buildReviewPrompt(spec, { iteration: i }),
            });
            const messages = await s.session.getMessages();
            s.save(messages);
            return parseReviewVerdict(getAssistantText(messages));
          },
        );

        if (review.result.aligned) {
          aligned = true;
          break;
        }
        lastFeedback = review.result.raw;
      }

      // If convergence gave up without alignment, carry the last gaps
      // forward into the next regular implement iteration.
      if (!aligned) reviewFeedback = lastFeedback;

      // Terminate only when the implementer said COMPLETE AND the
      // reviewer agrees.
      if (aligned && implComplete) break;
    }
  })
  .compile();
