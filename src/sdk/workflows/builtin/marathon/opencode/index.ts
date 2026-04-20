/**
 * Marathon workflow for OpenCode — continuous implementation loop with
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
 * Every OpenCode stage is a fresh session (F5) — the anchor files on disk
 * ARE the shared state, and each reviewer starts with no conversational
 * memory of prior iterations.
 *
 * Run: atomic workflow -n marathon -a opencode "<your spec>"
 */

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
 * Concatenate the text-typed parts of an OpenCode response. Avoids F3
 * (non-text parts turning into \`[object Object]\` or \`undefined\`).
 */
function extractResponseText(
  parts: Array<{ type: string; [key: string]: unknown }>,
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: string; text: string }).text)
    .join("\n");
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
  .for<"opencode">()
  .run(async (ctx) => {
    const spec = ctx.inputs.prompt ?? "";

    // ── Bootstrap ──────────────────────────────────────────────────────
    await ctx.stage(
      { name: "bootstrap" },
      {},
      { title: "bootstrap" },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [{ type: "text", text: buildBootstrapPrompt(spec) }],
        });
        s.save(result.data!);
      },
    );

    let reviewFeedback = "";

    // ── Implement → (checkpoint convergence) loop ──────────────────────
    for (let i = 1; i <= MAX_ITERATIONS; i++) {
      const impl = await ctx.stage(
        { name: `implement-${i}` },
        {},
        { title: `implement-${i}` },
        async (s) => {
          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: buildImplementPrompt(spec, {
                  iteration: i,
                  reviewFeedback: reviewFeedback || undefined,
                }),
              },
            ],
          });
          s.save(result.data!);
          return parseImplementStatus(extractResponseText(result.data!.parts));
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
          const fixName = `fix-${i}-r${round}`;
          await ctx.stage(
            { name: fixName },
            {},
            { title: fixName },
            async (s) => {
              const result = await s.client.session.prompt({
                sessionID: s.session.id,
                parts: [
                  {
                    type: "text",
                    text: buildImplementPrompt(spec, {
                      iteration: i,
                      reviewFeedback: lastFeedback,
                    }),
                  },
                ],
              });
              s.save(result.data!);
            },
          );
        }

        const reviewName = `review-${i}-r${round}`;
        const review = await ctx.stage(
          { name: reviewName },
          {},
          { title: reviewName },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [
                {
                  type: "text",
                  text: buildReviewPrompt(spec, { iteration: i }),
                },
              ],
            });
            s.save(result.data!);
            return parseReviewVerdict(extractResponseText(result.data!.parts));
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
