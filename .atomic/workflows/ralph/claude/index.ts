/**
 * Ralph workflow for Claude Code — plan → orchestrate → review → debug loop.
 *
 * One Claude TUI runs in a tmux pane for the duration of the workflow. Each
 * loop iteration invokes sub-agents via @-mention syntax (planner,
 * orchestrator, reviewer, and — when findings remain — debugger). The loop
 * terminates when:
 *   - {@link MAX_LOOPS} iterations have completed, OR
 *   - Two consecutive reviewer passes return zero findings.
 *
 * A loop is one cycle of plan → orchestrate → review. When a review returns
 * zero findings on the FIRST pass we re-run only the reviewer (still inside
 * the same loop iteration) to confirm; if that confirmation pass is also
 * clean we stop. The debugger only runs when findings remain after the
 * reviewer pass(es), and its markdown report is fed back to the planner on
 * the next iteration.
 *
 * Run: atomic workflow -n ralph -a claude "<your spec>"
 */

import {
  defineWorkflow,
  createClaudeSession,
  claudeQuery,
} from "@bastani/atomic-workflows";

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

/** Wrap a prompt with a Claude Code @-mention so the named sub-agent runs it. */
function asAgentCall(agentName: string, prompt: string): string {
  return `@"${agentName} (agent)" ${prompt}`;
}

export default defineWorkflow({
  name: "ralph",
  description:
    "Plan → orchestrate → review → debug loop with bounded iteration",
})
  .session({
    name: "ralph-loop",
    description:
      "Drive plan/orchestrate/review/debug iterations until clean or capped",
    run: async (ctx) => {
      await createClaudeSession({ paneId: ctx.paneId });

      let consecutiveClean = 0;
      let debuggerReport = "";

      for (let iteration = 1; iteration <= MAX_LOOPS; iteration++) {
        // ── Plan ────────────────────────────────────────────────────────────
        await claudeQuery({
          paneId: ctx.paneId,
          prompt: asAgentCall(
            "planner",
            buildPlannerPrompt(ctx.userPrompt, {
              iteration,
              debuggerReport: debuggerReport || undefined,
            }),
          ),
        });

        // ── Orchestrate ─────────────────────────────────────────────────────
        await claudeQuery({
          paneId: ctx.paneId,
          prompt: asAgentCall("orchestrator", buildOrchestratorPrompt()),
        });

        // ── Review (first pass) ─────────────────────────────────────────────
        let gitStatus = await safeGitStatusS();
        let reviewQuery = await claudeQuery({
          paneId: ctx.paneId,
          prompt: asAgentCall(
            "reviewer",
            buildReviewPrompt(ctx.userPrompt, { gitStatus, iteration }),
          ),
        });
        let reviewRaw = reviewQuery.output;
        let parsed = parseReviewResult(reviewRaw);

        if (!hasActionableFindings(parsed, reviewRaw)) {
          consecutiveClean += 1;
          if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) {
            break;
          }

          // Confirmation pass — re-run reviewer only, NOT plan/orchestrate.
          gitStatus = await safeGitStatusS();
          reviewQuery = await claudeQuery({
            paneId: ctx.paneId,
            prompt: asAgentCall(
              "reviewer",
              buildReviewPrompt(ctx.userPrompt, {
                gitStatus,
                iteration,
                isConfirmationPass: true,
              }),
            ),
          });
          reviewRaw = reviewQuery.output;
          parsed = parseReviewResult(reviewRaw);

          if (!hasActionableFindings(parsed, reviewRaw)) {
            consecutiveClean += 1;
            if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) {
              break;
            }
          } else {
            consecutiveClean = 0;
            // fall through to debugger
          }
        } else {
          consecutiveClean = 0;
        }

        // ── Debug (only if findings remain AND another iteration is allowed) ─
        if (
          hasActionableFindings(parsed, reviewRaw) &&
          iteration < MAX_LOOPS
        ) {
          const debuggerQuery = await claudeQuery({
            paneId: ctx.paneId,
            prompt: asAgentCall(
              "debugger",
              buildDebuggerReportPrompt(parsed, reviewRaw, {
                iteration,
                gitStatus,
              }),
            ),
          });
          debuggerReport = extractMarkdownBlock(debuggerQuery.output);
        }
      }

      ctx.save(ctx.sessionId);
    },
  })
  .compile();
