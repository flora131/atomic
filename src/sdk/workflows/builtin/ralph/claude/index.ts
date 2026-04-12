/**
 * Ralph workflow for Claude Code — plan → orchestrate → review → debug loop.
 *
 * Each sub-agent invocation spawns its own visible session in the graph,
 * so users can see each iteration's progress in real time. The loop
 * terminates when:
 *   - {@link MAX_LOOPS} iterations have completed, OR
 *   - Two consecutive reviewer passes return zero findings.
 *
 * Run: atomic workflow -n ralph -a claude "<your spec>"
 */

import { defineWorkflow } from "../../../index.ts";

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

// The orchestrator stage implements the actual code changes and can run for
// a very long time on large tasks. 24 hours prevents premature timeout.
const ORCHESTRATOR_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Wrap a prompt with a Claude Code @-mention so the named sub-agent runs it. */
function asAgentCall(agentName: string, prompt: string): string {
  return `@"${agentName} (agent)" ${prompt}`;
}

export default defineWorkflow<"claude">({
  name: "ralph",
  description:
    "Plan → orchestrate → review → debug loop with bounded iteration",
})
  .run(async (ctx) => {
    // Free-form workflows receive their positional prompt under
    // `inputs.prompt`; destructure once so every stage below can close
    // over a bare `prompt` string without re-reaching into ctx.inputs.
    const prompt = ctx.inputs.prompt ?? "";
    let consecutiveClean = 0;
    let debuggerReport = "";

    for (let iteration = 1; iteration <= MAX_LOOPS; iteration++) {
      // ── Plan ────────────────────────────────────────────────────────────
      const plannerName = `planner-${iteration}`;
      await ctx.stage(
        { name: plannerName },
        {},
        {},
        async (s) => {
          await s.session.query(
            asAgentCall(
              "planner",
              buildPlannerPrompt(prompt, {
                iteration,
                debuggerReport: debuggerReport || undefined,
              }),
            ),
          );
          s.save(s.sessionId);
        },
      );


      // ── Orchestrate ─────────────────────────────────────────────────────
      const orchName = `orchestrator-${iteration}`;
      await ctx.stage(
        { name: orchName },
        {},
        {},
        async (s) => {
          await s.session.query(
            asAgentCall(
              "orchestrator",
              buildOrchestratorPrompt(prompt),
            ),
            { timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
          );
          s.save(s.sessionId);
        },
      );


      // ── Review (first pass) ─────────────────────────────────────────────
      let gitStatus = await safeGitStatusS();
      const reviewerName = `reviewer-${iteration}`;
      const review = await ctx.stage(
        { name: reviewerName },
        {},
        {},
        async (s) => {
          const result = await s.session.query(
            asAgentCall(
              "reviewer",
              buildReviewPrompt(prompt, { gitStatus, iteration }),
            ),
          );
          s.save(s.sessionId);
          return result.output;
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
          {},
          async (s) => {
            const result = await s.session.query(
              asAgentCall(
                "reviewer",
                buildReviewPrompt(prompt, {
                  gitStatus,
                  iteration,
                  isConfirmationPass: true,
                }),
              ),
            );
            s.save(s.sessionId);
            return result.output;
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
          {},
          async (s) => {
            const result = await s.session.query(
              asAgentCall(
                "debugger",
                buildDebuggerReportPrompt(parsed, reviewRaw, {
                  iteration,
                  gitStatus,
                }),
              ),
            );
            s.save(s.sessionId);
            return result.output;
          },
        );

        debuggerReport = extractMarkdownBlock(debugger_.result);
      }
    }
  })
  .compile();
