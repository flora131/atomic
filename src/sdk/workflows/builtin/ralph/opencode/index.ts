/**
 * Ralph workflow for OpenCode — plan → orchestrate → review → debug loop.
 *
 * Each sub-agent invocation spawns its own visible session in the graph,
 * so users can see each iteration's progress in real time. The loop
 * terminates when:
 *   - {@link MAX_LOOPS} iterations have completed, OR
 *   - Two parallel reviewer passes both return zero findings.
 *
 * The reviewer stages use the OpenCode SDK's structured output
 * (`format: { type: "json_schema" }`) to guarantee the review result
 * matches the {@link ReviewResultSchema}.
 *
 * Run: atomic workflow -n ralph -a opencode "<your spec>"
 */

import { defineWorkflow } from "../../../index.ts";

import {
  buildPlannerPrompt,
  buildOrchestratorPrompt,
  buildInfraDiscoveryPrompts,
  buildReviewPrompt,
  buildDebuggerReportPrompt,
  extractMarkdownBlock,
  filterActionable,
  mergeReviewResults,
  REVIEW_RESULT_JSON_SCHEMA,
  type ReviewResult,
  type StructuredReviewResult,
} from "../helpers/prompts.ts";
import { hasActionableFindings } from "../helpers/review.ts";
import { captureBranchChangeset } from "../helpers/git.ts";

const MAX_LOOPS = 10;

/** Concatenate the text-typed parts of an OpenCode response. */
function extractResponseText(
  parts: Array<{ type: string; [key: string]: unknown }>,
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: string; text: string }).text)
    .join("\n");
}

/**
 * Extract a {@link StructuredReviewResult} from an OpenCode prompt response.
 * Prefers the SDK's structured_output field; falls back to text extraction.
 */
function extractReview(
  data: { info?: Record<string, unknown>; parts: Array<{ type: string; [key: string]: unknown }> },
): StructuredReviewResult {
  const raw = extractResponseText(data.parts);

  // The SDK places validated structured output at data.info.structured_output
  const structuredOutput = data.info?.structured_output;
  if (structuredOutput && typeof structuredOutput === "object") {
    return {
      structured: filterActionable(structuredOutput as ReviewResult),
      raw,
    };
  }

  return { structured: null, raw };
}

export default defineWorkflow<"opencode">({
  name: "ralph",
  description:
    "Plan → orchestrate → review → debug loop with bounded iteration",
})
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";
    let debuggerReport = "";

    for (let iteration = 1; iteration <= MAX_LOOPS; iteration++) {
      // ── Plan ────────────────────────────────────────────────────────────
      const planner = await ctx.stage(
        { name: `planner-${iteration}` },
        {},
        { title: `planner-${iteration}` },
        async (s) => {
          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: buildPlannerPrompt(prompt, {
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
      await ctx.stage(
        { name: `orchestrator-${iteration}` },
        {},
        { title: `orchestrator-${iteration}` },
        async (s) => {
          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: buildOrchestratorPrompt(prompt, {
                  plannerNotes: planner.result,
                }),
              },
            ],
            agent: "orchestrator",
          });
          s.save(result.data!);
        },
      );

      // ── Infrastructure Discovery (three parallel sub-agent stages) ────
      const changeset = await captureBranchChangeset();
      const discoveryPrompts = buildInfraDiscoveryPrompts();

      const [locatorResult, analyzerResult, patternResult] = await Promise.all([
        ctx.stage(
          { name: `infra-locate-${iteration}` },
          {},
          { title: `infra-locate-${iteration}` },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [{ type: "text", text: discoveryPrompts.locator }],
              agent: "codebase-locator",
            });
            s.save(result.data!);
            return extractResponseText(result.data!.parts);
          },
        ),
        ctx.stage(
          { name: `infra-analyze-${iteration}` },
          {},
          { title: `infra-analyze-${iteration}` },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [{ type: "text", text: discoveryPrompts.analyzer }],
              agent: "codebase-analyzer",
            });
            s.save(result.data!);
            return extractResponseText(result.data!.parts);
          },
        ),
        ctx.stage(
          { name: `infra-patterns-${iteration}` },
          {},
          { title: `infra-patterns-${iteration}` },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [{ type: "text", text: discoveryPrompts.patternFinder }],
              agent: "codebase-pattern-finder",
            });
            s.save(result.data!);
            return extractResponseText(result.data!.parts);
          },
        ),
      ]);

      const discoveryContext = [
        "### Infrastructure Files (codebase-locator)\n\n" + locatorResult.result,
        "### Infrastructure Analysis (codebase-analyzer)\n\n" + analyzerResult.result,
        "### Build & Test Patterns (codebase-pattern-finder)\n\n" + patternResult.result,
      ].join("\n\n---\n\n");

      // ── Review (two parallel passes) ────────────────────────────────────
      const reviewPrompt = buildReviewPrompt(prompt, {
        changeset,
        iteration,
        discoveryContext,
      });

      const reviewStage = async (name: string) =>
        ctx.stage(
          { name },
          {},
          { title: name },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [{ type: "text", text: reviewPrompt }],
              agent: "reviewer",
              format: {
                type: "json_schema" as const,
                schema: REVIEW_RESULT_JSON_SCHEMA,
              },
            });
            s.save(result.data!);
            return extractReview(
              result.data! as {
                info?: Record<string, unknown>;
                parts: Array<{ type: string; [key: string]: unknown }>;
              },
            );
          },
        );

      const [reviewA, reviewB] = await Promise.all([
        reviewStage(`reviewer-${iteration}-a`),
        reviewStage(`reviewer-${iteration}-b`),
      ]);

      const merged = mergeReviewResults(reviewA.result, reviewB.result);
      const parsed = merged.structured;
      const reviewRaw = merged.raw;

      // Both reviewers agree the code is clean → done
      if (!hasActionableFindings(parsed, reviewRaw)) break;

      // ── Debug (only if another iteration is allowed) ────────────────────
      if (iteration < MAX_LOOPS) {
        const debugger_ = await ctx.stage(
          { name: `debugger-${iteration}` },
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
                    changeset,
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
