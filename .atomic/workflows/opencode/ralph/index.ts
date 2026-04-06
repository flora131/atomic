/**
 * Ralph workflow for OpenCode — three-session planning + execution + review loop.
 *
 * Session 1 (planner):      Decompose the user prompt into a task list.
 * Session 2 (orchestrator): Execute the task list via sub-agent management.
 * Session 3 (review-fix):   Iteratively review and fix until clean (≥2 consecutive clean cycles).
 *
 * Run: atomic workflow -n ralph -a opencode "<your feature spec>"
 */

import { defineWorkflow } from "@bastani/atomic-workflows";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import {
  buildSpecToTasksPrompt,
  buildOrchestratorPrompt,
  buildReviewPrompt,
  buildFixSpecFromReview,
  buildFixSpecFromRawReview,
  parseReviewResult,
} from "../../ralph/helpers/prompts.ts";
import { hasActionableFindings } from "../../ralph/helpers/review.ts";

/** Extract concatenated text from an OpenCode response parts array. */
function extractResponseText(
  parts: Array<{ type: string; [key: string]: unknown }>,
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: string; text: string }).text)
    .join("\n");
}

export default defineWorkflow({
  name: "ralph",
  description:
    "Full Ralph workflow: task decomposition → orchestration → iterative review/fix",
})
  // ─────────────────────────────────────────────────────────────────────────
  // Session 1: Planner — break the spec into an actionable task list
  // ─────────────────────────────────────────────────────────────────────────
  .session({
    name: "planner",
    description: "Decompose the user prompt into an ordered task list",
    run: async (ctx) => {
      const client = createOpencodeClient({ baseUrl: ctx.serverUrl });

      const session = await client.session.create({ title: "planner" });
      await client.tui.selectSession({ sessionID: session.data!.id });

      const result = await client.session.prompt({
        sessionID: session.data!.id,
        parts: [{ type: "text", text: buildSpecToTasksPrompt(ctx.userPrompt) }],
      });

      ctx.save(result.data!);
    },
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Session 2: Orchestrator — drive sub-agents to complete the task list
  // ─────────────────────────────────────────────────────────────────────────
  .session({
    name: "orchestrator",
    description: "Coordinate sub-agents to implement the planned tasks",
    run: async (ctx) => {
      const client = createOpencodeClient({ baseUrl: ctx.serverUrl });

      const session = await client.session.create({ title: "orchestrator" });
      await client.tui.selectSession({ sessionID: session.data!.id });

      const result = await client.session.prompt({
        sessionID: session.data!.id,
        parts: [{ type: "text", text: buildOrchestratorPrompt() }],
      });

      ctx.save(result.data!);
    },
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Session 3: Review-Fix loop — review output, fix issues, repeat until clean
  // ─────────────────────────────────────────────────────────────────────────
  .session({
    name: "review-fix",
    description:
      "Iteratively review and fix until ≥2 consecutive clean review cycles",
    run: async (ctx) => {
      const client = createOpencodeClient({ baseUrl: ctx.serverUrl });

      const session = await client.session.create({ title: "review-fix" });
      await client.tui.selectSession({ sessionID: session.data!.id });

      const MAX_CYCLES = 10;
      let consecutiveClean = 0;
      let priorDebuggerOutput = "";
      let result: Awaited<ReturnType<typeof client.session.prompt>>;

      for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
        // ── Step A: Review ─────────────────────────────────────────────────
        result = await client.session.prompt({
          sessionID: session.data!.id,
          parts: [
            {
              type: "text",
              text: buildReviewPrompt(ctx.userPrompt, priorDebuggerOutput),
            },
          ],
        });

        const reviewRaw = extractResponseText(result.data!.parts);
        const review = parseReviewResult(reviewRaw);

        // ── Step B: Check if we can stop ───────────────────────────────────
        if (!hasActionableFindings(review, reviewRaw)) {
          consecutiveClean++;
          if (consecutiveClean >= 2) {
            break;
          }
          // Still clean but haven't hit the threshold — continue to confirm
          continue;
        }

        // There were findings — reset the clean streak
        consecutiveClean = 0;

        // ── Step C: Build a fix prompt ────────────────────────────────────
        let fixPrompt: string;
        if (review !== null) {
          fixPrompt = buildFixSpecFromReview(review, ctx.userPrompt);
        } else if (reviewRaw.trim().length > 0) {
          fixPrompt = buildFixSpecFromRawReview(reviewRaw, ctx.userPrompt);
        } else {
          fixPrompt =
            "Please review the implementation once more and address any remaining issues.";
        }

        // ── Step D: Apply the fix ─────────────────────────────────────────
        result = await client.session.prompt({
          sessionID: session.data!.id,
          parts: [{ type: "text", text: fixPrompt }],
        });

        priorDebuggerOutput = extractResponseText(result.data!.parts);
      }

      ctx.save(result!.data!);
    },
  })

  .compile();
