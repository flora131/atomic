/**
 * Ralph workflow for OpenCode — plan → orchestrate → review → debug loop.
 *
 * One OpenCode client backs every iteration; each loop step creates a fresh
 * sub-session bound to the appropriate sub-agent (planner, orchestrator,
 * reviewer, debugger). The loop terminates when:
 *   - {@link MAX_LOOPS} iterations have completed, OR
 *   - Two consecutive reviewer passes return zero findings.
 *
 * A loop is one cycle of plan → orchestrate → review. When a review returns
 * zero findings on the FIRST pass we re-run only the reviewer (still inside
 * the same loop iteration) to confirm; if that confirmation pass is also
 * clean we stop. The debugger only runs when findings remain, and its
 * markdown report is fed back into the next iteration's planner.
 *
 * Run: atomic workflow -n ralph -a opencode "<your spec>"
 */

import { defineWorkflow } from "@bastani/atomic-workflows";
import {
  createOpencodeClient,
  type SessionPromptResponse,
} from "@opencode-ai/sdk/v2";

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
      const client = createOpencodeClient({ baseUrl: ctx.serverUrl });

      let lastResultData: SessionPromptResponse | null = null;

      /** Run a sub-agent in a fresh session and return its concatenated text. */
      async function runAgent(
        title: string,
        agent: string,
        text: string,
      ): Promise<string> {
        const session = await client.session.create({ title });
        await client.tui.selectSession({ sessionID: session.data!.id });
        const result = await client.session.prompt({
          sessionID: session.data!.id,
          parts: [{ type: "text", text }],
          agent,
        });
        lastResultData = result.data ?? null;
        return extractResponseText(result.data!.parts);
      }

      let consecutiveClean = 0;
      let debuggerReport = "";

      for (let iteration = 1; iteration <= MAX_LOOPS; iteration++) {
        // ── Plan ────────────────────────────────────────────────────────────
        await runAgent(
          `planner-${iteration}`,
          "planner",
          buildPlannerPrompt(ctx.userPrompt, {
            iteration,
            debuggerReport: debuggerReport || undefined,
          }),
        );

        // ── Orchestrate ─────────────────────────────────────────────────────
        await runAgent(
          `orchestrator-${iteration}`,
          "orchestrator",
          buildOrchestratorPrompt(),
        );

        // ── Review (first pass) ─────────────────────────────────────────────
        let gitStatus = await safeGitStatusS();
        let reviewRaw = await runAgent(
          `reviewer-${iteration}-1`,
          "reviewer",
          buildReviewPrompt(ctx.userPrompt, { gitStatus, iteration }),
        );
        let parsed = parseReviewResult(reviewRaw);

        if (!hasActionableFindings(parsed, reviewRaw)) {
          consecutiveClean += 1;
          if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) {
            break;
          }

          // Confirmation pass — re-run reviewer only, NOT plan/orchestrate.
          gitStatus = await safeGitStatusS();
          reviewRaw = await runAgent(
            `reviewer-${iteration}-2`,
            "reviewer",
            buildReviewPrompt(ctx.userPrompt, {
              gitStatus,
              iteration,
              isConfirmationPass: true,
            }),
          );
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
          const debuggerRaw = await runAgent(
            `debugger-${iteration}`,
            "debugger",
            buildDebuggerReportPrompt(parsed, reviewRaw, {
              iteration,
              gitStatus,
            }),
          );
          debuggerReport = extractMarkdownBlock(debuggerRaw);
        }
      }

      if (lastResultData !== null) {
        ctx.save(lastResultData);
      }
    },
  })
  .compile();
