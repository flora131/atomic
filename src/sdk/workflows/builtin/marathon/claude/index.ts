/**
 * Marathon workflow for Claude Code — continuous implementation loop with
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
 * Each Claude stage gets its own tmux pane, so fresh-context isolation is
 * native — every stage starts with no memory of prior iterations except
 * what is on disk in the anchor files.
 *
 * Run: atomic workflow -n marathon -a claude "<your spec>"
 */

import { defineWorkflow, extractAssistantText } from "../../../index.ts";

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

const AUTONOMY_FLAGS = [
  "--allow-dangerously-skip-permissions",
  "--dangerously-skip-permissions",
];

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
  .for<"claude">()
  .run(async (ctx) => {
    const spec = ctx.inputs.prompt ?? "";

    // ── Bootstrap ──────────────────────────────────────────────────────
    await ctx.stage(
      { name: "bootstrap" },
      { chatFlags: AUTONOMY_FLAGS },
      {},
      async (s) => {
        await s.session.query(buildBootstrapPrompt(spec));
        s.save(s.sessionId);
      },
    );

    let reviewFeedback = "";

    // ── Implement → (checkpoint convergence) loop ──────────────────────
    for (let i = 1; i <= MAX_ITERATIONS; i++) {
      const impl = await ctx.stage(
        { name: `implement-${i}` },
        { chatFlags: AUTONOMY_FLAGS },
        {},
        async (s) => {
          const result = await s.session.query(
            buildImplementPrompt(spec, {
              iteration: i,
              reviewFeedback: reviewFeedback || undefined,
            }),
          );
          s.save(s.sessionId);
          return parseImplementStatus(extractAssistantText(result, 0));
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
            { chatFlags: AUTONOMY_FLAGS },
            {},
            async (s) => {
              await s.session.query(
                buildImplementPrompt(spec, {
                  iteration: i,
                  reviewFeedback: lastFeedback,
                }),
              );
              s.save(s.sessionId);
            },
          );
        }

        const review = await ctx.stage(
          { name: `review-${i}-r${round}` },
          { chatFlags: AUTONOMY_FLAGS },
          {},
          async (s) => {
            const result = await s.session.query(
              buildReviewPrompt(spec, { iteration: i }),
            );
            s.save(s.sessionId);
            return parseReviewVerdict(extractAssistantText(result, 0));
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
