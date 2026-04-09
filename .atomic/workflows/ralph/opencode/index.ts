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
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

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
  .run(async (ctx) => {
    let consecutiveClean = 0;
    let debuggerReport = "";
    // Track the most recent session so the next stage can declare it as a
    // dependency — this chains planner → orchestrator → reviewer → [confirm]
    // → [debugger] → next planner in the graph instead of showing every
    // stage as an independent sibling under the root.
    let prevStage: string | undefined;
    const depsOn = (): string[] | undefined =>
      prevStage ? [prevStage] : undefined;

    for (let iteration = 1; iteration <= MAX_LOOPS; iteration++) {
      // ── Plan ────────────────────────────────────────────────────────────
      const plannerName = `planner-${iteration}`;
      const planner = await ctx.session(
        { name: plannerName, dependsOn: depsOn() },
        async (s) => {
          const client = createOpencodeClient({ baseUrl: s.serverUrl });
          const session = await client.session.create({
            title: `planner-${iteration}`,
          });
          await client.tui.selectSession({ sessionID: session.data!.id });
          const result = await client.session.prompt({
            sessionID: session.data!.id,
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
      prevStage = plannerName;

      // ── Orchestrate ─────────────────────────────────────────────────────
      const orchName = `orchestrator-${iteration}`;
      await ctx.session(
        { name: orchName, dependsOn: depsOn() },
        async (s) => {
          const client = createOpencodeClient({ baseUrl: s.serverUrl });
          const session = await client.session.create({
            title: `orchestrator-${iteration}`,
          });
          await client.tui.selectSession({ sessionID: session.data!.id });
          const result = await client.session.prompt({
            sessionID: session.data!.id,
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
      prevStage = orchName;

      // ── Review (first pass) ─────────────────────────────────────────────
      let gitStatus = await safeGitStatusS();
      const reviewerName = `reviewer-${iteration}`;
      const review = await ctx.session(
        { name: reviewerName, dependsOn: depsOn() },
        async (s) => {
          const client = createOpencodeClient({ baseUrl: s.serverUrl });
          const session = await client.session.create({
            title: `reviewer-${iteration}`,
          });
          await client.tui.selectSession({ sessionID: session.data!.id });
          const result = await client.session.prompt({
            sessionID: session.data!.id,
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
      prevStage = reviewerName;

      let reviewRaw = review.result;
      let parsed = parseReviewResult(reviewRaw);

      if (!hasActionableFindings(parsed, reviewRaw)) {
        consecutiveClean += 1;
        if (consecutiveClean >= CONSECUTIVE_CLEAN_THRESHOLD) break;

        // Confirmation pass — re-run reviewer only
        gitStatus = await safeGitStatusS();
        const confirmName = `reviewer-${iteration}-confirm`;
        const confirm = await ctx.session(
          { name: confirmName, dependsOn: depsOn() },
          async (s) => {
            const client = createOpencodeClient({ baseUrl: s.serverUrl });
            const session = await client.session.create({
              title: `reviewer-${iteration}-confirm`,
            });
            await client.tui.selectSession({ sessionID: session.data!.id });
            const result = await client.session.prompt({
              sessionID: session.data!.id,
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
        prevStage = confirmName;

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
        const debugger_ = await ctx.session(
          { name: debuggerName, dependsOn: depsOn() },
          async (s) => {
            const client = createOpencodeClient({ baseUrl: s.serverUrl });
            const session = await client.session.create({
              title: `debugger-${iteration}`,
            });
            await client.tui.selectSession({ sessionID: session.data!.id });
            const result = await client.session.prompt({
              sessionID: session.data!.id,
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
        prevStage = debuggerName;
        debuggerReport = extractMarkdownBlock(debugger_.result);
      }
    }
  })
  .compile();
