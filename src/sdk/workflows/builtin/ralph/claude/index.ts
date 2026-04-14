/**
 * Ralph workflow for Claude Code — plan → orchestrate → review → debug loop.
 *
 * Each sub-agent invocation spawns its own visible session in the graph,
 * so users can see each iteration's progress in real time. The loop
 * terminates when:
 *   - {@link MAX_LOOPS} iterations have completed, OR
 *   - Two parallel reviewer passes both return zero findings.
 *
 * The reviewer stages use the Claude Agent SDK's structured output
 * (`outputFormat`) to guarantee the review result matches the
 * {@link ReviewResultSchema} — no manual JSON parsing required.
 *
 * Run: atomic workflow -n ralph -a claude "<your spec>"
 */

import { defineWorkflow } from "../../../index.ts";
import { query as claudeSdkQuery } from "@anthropic-ai/claude-agent-sdk";

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

// The orchestrator stage implements the actual code changes and can run for
// a very long time on large tasks. 24 hours prevents premature timeout.
const ORCHESTRATOR_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Wrap a prompt with a Claude Code @-mention so the named sub-agent runs it. */
function asAgentCall(agentName: string, prompt: string): string {
  return `@"${agentName} (agent)" ${prompt}`;
}

/**
 * Run the Claude Agent SDK's `query()` with structured output and collect
 * the result. Returns a {@link StructuredReviewResult} with the SDK-validated
 * structured output (when available) and the raw text fallback.
 */
async function queryWithStructuredOutput(
  prompt: string,
): Promise<StructuredReviewResult> {
  let structured: ReviewResult | null = null;
  let raw = "";

  for await (const msg of claudeSdkQuery({
    prompt,
    options: {
      outputFormat: {
        type: "json_schema",
        schema: REVIEW_RESULT_JSON_SCHEMA,
      },
    },
  })) {
    if (msg.type === "result") {
      raw = String((msg as Record<string, unknown>).output ?? "");
      if (
        msg.subtype === "success" &&
        (msg as Record<string, unknown>).structured_output
      ) {
        structured = (msg as Record<string, unknown>).structured_output as ReviewResult;
      }
    }
  }

  return {
    structured: structured ? filterActionable(structured) : null,
    raw,
  };
}

export default defineWorkflow<"claude">({
  name: "ralph",
  description:
    "Plan → orchestrate → review → debug loop with bounded iteration",
})
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";
    let debuggerReport = "";

    for (let iteration = 1; iteration <= MAX_LOOPS; iteration++) {
      // ── Plan ────────────────────────────────────────────────────────────
      await ctx.stage(
        { name: `planner-${iteration}` },
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
      await ctx.stage(
        { name: `orchestrator-${iteration}` },
        {},
        {},
        async (s) => {
          await s.session.query(
            asAgentCall("orchestrator", buildOrchestratorPrompt(prompt)),
            { timeoutMs: ORCHESTRATOR_TIMEOUT_MS },
          );
          s.save(s.sessionId);
        },
      );

      // ── Infrastructure Discovery (three parallel sub-agent stages) ────
      const changeset = await captureBranchChangeset();
      const discoveryPrompts = buildInfraDiscoveryPrompts();

      const [locatorResult, analyzerResult, patternResult] = await Promise.all([
        ctx.stage(
          { name: `infra-locate-${iteration}` },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              asAgentCall("codebase-locator", discoveryPrompts.locator),
            );
            s.save(s.sessionId);
            return String(result.output ?? "");
          },
        ),
        ctx.stage(
          { name: `infra-analyze-${iteration}` },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              asAgentCall("codebase-analyzer", discoveryPrompts.analyzer),
            );
            s.save(s.sessionId);
            return String(result.output ?? "");
          },
        ),
        ctx.stage(
          { name: `infra-patterns-${iteration}` },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              asAgentCall("codebase-pattern-finder", discoveryPrompts.patternFinder),
            );
            s.save(s.sessionId);
            return String(result.output ?? "");
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

      const [reviewA, reviewB] = await Promise.all([
        ctx.stage(
          { name: `reviewer-${iteration}-a` },
          {},
          {},
          async (s) => {
            const result = await queryWithStructuredOutput(reviewPrompt);
            s.save(s.sessionId);
            return result;
          },
        ),
        ctx.stage(
          { name: `reviewer-${iteration}-b` },
          {},
          {},
          async (s) => {
            const result = await queryWithStructuredOutput(reviewPrompt);
            s.save(s.sessionId);
            return result;
          },
        ),
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
          {},
          async (s) => {
            const result = await s.session.query(
              asAgentCall(
                "debugger",
                buildDebuggerReportPrompt(parsed, reviewRaw, {
                  iteration,
                  changeset,
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
