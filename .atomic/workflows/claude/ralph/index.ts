/**
 * Ralph workflow for Claude Code — three-session plan → orchestrate → review/fix loop.
 *
 * Claude runs as a full interactive TUI in a tmux pane.
 * We automate it via tmux send-keys using the claudeQuery() helper.
 * Each session sends prompts to the same pane; Claude maintains conversation
 * context automatically across all calls within a session.
 *
 * Run: atomic workflow -n ralph -a claude "<your feature prompt>"
 */

import { defineWorkflow, claudeQuery } from "@bastani/atomic-workflows";

import {
  buildSpecToTasksPrompt,
  buildOrchestratorPrompt,
  buildReviewPrompt,
  buildFixSpecFromReview,
  buildFixSpecFromRawReview,
  parseReviewResult,
} from "../../ralph/helpers/prompts.ts";
import { hasActionableFindings } from "../../ralph/helpers/review.ts";

const MAX_REVIEW_CYCLES = 10;
const CONSECUTIVE_CLEAN_THRESHOLD = 2;

export default defineWorkflow({
  name: "ralph",
  description:
    "Full Ralph workflow: decompose spec into tasks → orchestrate workers → review & fix until clean",
})
  // ─────────────────────────────────────────────────────────────────────────────
  // Session 1 — Planner
  // Break the user's prompt / spec into a structured task list.
  // ─────────────────────────────────────────────────────────────────────────────
  .session({
    name: "planner",
    description: "Decompose the user prompt into a structured task list",
    run: async (ctx) => {
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: buildSpecToTasksPrompt(ctx.userPrompt),
      });

      ctx.save(ctx.sessionId);
    },
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Session 2 — Orchestrator
  // Spin up worker sub-agents and drive them through the task list.
  // ─────────────────────────────────────────────────────────────────────────────
  .session({
    name: "orchestrator",
    description: "Orchestrate worker sub-agents to implement each task",
    run: async (ctx) => {
      await claudeQuery({
        paneId: ctx.paneId,
        prompt: buildOrchestratorPrompt(),
      });

      ctx.save(ctx.sessionId);
    },
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Session 3 — Review & Fix loop
  // Repeatedly review the implementation and apply fixes until the output is
  // clean for two consecutive cycles (or the cycle cap is reached).
  // ─────────────────────────────────────────────────────────────────────────────
  .session({
    name: "review-fix",
    description:
      "Review the implementation and iteratively fix findings until clean",
    run: async (ctx) => {
      let consecutiveClean = 0;
      let priorDebuggerOutput = "";

      for (let cycle = 0; cycle < MAX_REVIEW_CYCLES; cycle++) {
        // ── Step A: ask Claude to review the current state ──────────────────
        const reviewResult = await claudeQuery({
          paneId: ctx.paneId,
          prompt: buildReviewPrompt(ctx.userPrompt, priorDebuggerOutput),
        });

        const reviewRaw = reviewResult.output;

        // ── Step B: parse the structured review ─────────────────────────────
        const review = parseReviewResult(reviewRaw);

        // ── Step C: decide whether to keep going ────────────────────────────
        if (!hasActionableFindings(review, reviewRaw)) {
          consecutiveClean += 1;
          if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) {
            // Two clean passes in a row — we're done.
            break;
          }
          // Only one clean pass so far; keep iterating.
          continue;
        }

        // Findings found — reset the clean counter.
        consecutiveClean = 0;

        // ── Step D: build a targeted fix prompt ─────────────────────────────
        let fixPrompt: string;

        if (review !== null) {
          fixPrompt = buildFixSpecFromReview(review, ctx.userPrompt);
        } else {
          fixPrompt = buildFixSpecFromRawReview(reviewRaw, ctx.userPrompt);
        }

        if (!fixPrompt.trim()) {
          // Nothing actionable to send — treat as a clean cycle to avoid
          // spinning endlessly on an unparseable response.
          fixPrompt =
            "Please address any remaining issues found in the previous review and ensure all tests pass.";
        }

        // ── Step E: apply the fix ────────────────────────────────────────────
        const fixResult = await claudeQuery({
          paneId: ctx.paneId,
          prompt: fixPrompt,
        });

        priorDebuggerOutput = fixResult.output;
      }

      ctx.save(ctx.sessionId);
    },
  })

  .compile();
