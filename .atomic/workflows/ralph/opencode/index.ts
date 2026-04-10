/**
 * Ralph workflow for OpenCode — plan → orchestrate → review → debug loop.
 *
 * Each sub-agent invocation spawns its own visible session in the graph,
 * so users can see each iteration's progress in real time. The loop
 * terminates when:
 *   - {@link MAX_LOOPS} iterations have completed, OR
 *   - Two consecutive reviewer passes return zero findings.
 *
 * Run: atomic workflow -n ralph -a opencode "<your spec>"
 */

import { defineWorkflow } from "@bastani/atomic/workflows";

import {
  buildPlannerPrompt,
  buildOrchestratorPrompt,
  buildReviewPrompt,
  buildDebuggerReportPrompt,
  parseReviewResult,
  extractMarkdownBlock,
} from "../helpers/prompts.ts";
import { hasActionableFindings } from "../helpers/review.ts";
import { safeGitStatusS } from "../helpers/git.ts";

const MAX_LOOPS = 10;
const CONSECUTIVE_CLEAN_THRESHOLD = 2;

/** Concatenate the text-typed parts of an OpenCode response. */
function extractResponseText(
  parts: Array<{ type: string; [key: string]: unknown }>,
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: string; text: string }).text)
    .join("\n");
}

export default defineWorkflow<"opencode">({
  name: "ralph",
  description:
    "Plan → orchestrate → review → debug loop with bounded iteration",
})
  .run(async (ctx) => {
    let consecutiveClean = 0;
    let debuggerReport = "";

    for (let iteration = 1; iteration <= MAX_LOOPS; iteration++) {
      // ── Plan ────────────────────────────────────────────────────────────
      const plannerName = `planner-${iteration}`;
      const planner = await ctx.stage(
        { name: plannerName },
        {},
        { title: `planner-${iteration}` },
        async (s) => {
          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: buildPlannerPrompt(s.userPrompt, {
                  iteration,
                  debuggerReport: debuggerReport || undefined,
                }),
              },
            ],
            agent: "planner",
          });
          s.save(result.data!);
          return extractResponseText(result.data!.parts);
        },
      );


      // ── Orchestrate ─────────────────────────────────────────────────────
      const orchName = `orchestrator-${iteration}`;
      await ctx.stage(
        { name: orchName },
        {},
        { title: `orchestrator-${iteration}` },
        async (s) => {
          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: buildOrchestratorPrompt(s.userPrompt, {
                  plannerNotes: planner.result,
                }),
              },
            ],
            agent: "orchestrator",
          });
          s.save(result.data!);
        },
      );


      // ── Review (first pass) ─────────────────────────────────────────────
      let gitStatus = await safeGitStatusS();
      const reviewerName = `reviewer-${iteration}`;
      const review = await ctx.stage(
        { name: reviewerName },
        {},
        { title: `reviewer-${iteration}` },
        async (s) => {
          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: buildReviewPrompt(s.userPrompt, {
                  gitStatus,
                  iteration,
                }),
              },
            ],
            agent: "reviewer",
          });
          s.save(result.data!);
          return extractResponseText(result.data!.parts);
        },
      );


      let reviewRaw = review.result;
      let parsed = parseReviewResult(reviewRaw);

      if (!hasActionableFindings(parsed, reviewRaw)) {
        consecutiveClean += 1;
        if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) break;

        // Confirmation pass — re-run reviewer only
        gitStatus = await safeGitStatusS();
        const confirmName = `reviewer-${iteration}-confirm`;
        const confirm = await ctx.stage(
          { name: confirmName },
          {},
          { title: `reviewer-${iteration}-confirm` },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [
                {
                  type: "text",
                  text: buildReviewPrompt(s.userPrompt, {
                    gitStatus,
                    iteration,
                    isConfirmationPass: true,
                  }),
                },
              ],
              agent: "reviewer",
            });
            s.save(result.data!);
            return extractResponseText(result.data!.parts);
          },
        );


        reviewRaw = confirm.result;
        parsed = parseReviewResult(reviewRaw);

        if (!hasActionableFindings(parsed, reviewRaw)) {
          consecutiveClean += 1;
          if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) break;
        } else {
          consecutiveClean = 0;
        }
      } else {
        consecutiveClean = 0;
      }

      // ── Debug (only if findings remain AND another iteration is allowed) ─
      if (hasActionableFindings(parsed, reviewRaw) && iteration < MAX_LOOPS) {
        const debuggerName = `debugger-${iteration}`;
        const debugger_ = await ctx.stage(
          { name: debuggerName },
          {},
          { title: `debugger-${iteration}` },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [
                {
                  type: "text",
                  text: buildDebuggerReportPrompt(parsed, reviewRaw, {
                    iteration,
                    gitStatus,
                  }),
                },
              ],
              agent: "debugger",
            });
            s.save(result.data!);
            return extractResponseText(result.data!.parts);
          },
        );

        debuggerReport = extractMarkdownBlock(debugger_.result);
      }
    }
  })
  .compile();
