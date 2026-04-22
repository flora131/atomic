/**
 * Ralph workflow for Claude Code — plan → orchestrate → review → debug loop.
 *
 * Each sub-agent invocation spawns its own visible session in the graph,
 * so users can see each iteration's progress in real time. The loop
 * terminates when:
 *   - `max_loops` iterations have completed (defaults to {@link DEFAULT_MAX_LOOPS}), OR
 *   - Two parallel reviewer passes both return zero findings.
 *
 * The reviewer stages run the `reviewer` sub-agent in a visible TUI via the
 * `--agent reviewer` chatFlag, then parse the JSON review out of the
 * assistant text with {@link parseReviewResult}. The prompt enumerates the
 * {@link ReviewResultSchema} fields so the model emits matching JSON. We
 * deliberately avoid invoking the Claude Agent SDK's `query()` from inside a
 * non-headless stage — that would spawn a TUI pane that goes unused while
 * the SDK runs in-process (see workflow-creator skill, failure-modes F17).
 *
 * Run: atomic workflow -n ralph -a claude "<your spec>"
 */

import { defineWorkflow, extractAssistantText } from "../../../index.ts";

import {
  buildPlannerPrompt,
  buildOrchestratorPrompt,
  buildInfraDiscoveryPrompts,
  buildReviewPrompt,
  buildDebuggerReportPrompt,
  extractMarkdownBlock,
  parseReviewResult,
  mergeReviewResults,
  type StructuredReviewResult,
} from "../helpers/prompts.ts";
import { hasActionableFindings } from "../helpers/review.ts";
import { captureBranchChangeset } from "../helpers/git.ts";

const DEFAULT_MAX_LOOPS = 10;

// The orchestrator stage implements the actual code changes and can run for
// a very long time on large tasks. Completion is detected via session file
// watching for idle and result events from Claude's own SDK — no manual
// timeout is needed.

/**
 * Extract a {@link StructuredReviewResult} from the reviewer TUI's assistant
 * text. {@link parseReviewResult} tolerates surrounding prose and fenced
 * code blocks; the prompt instructs the model to emit JSON matching
 * {@link ReviewResultSchema}.
 */
function extractReview(rawText: string): StructuredReviewResult {
  return { structured: parseReviewResult(rawText), raw: rawText };
}

export default defineWorkflow({
  name: "ralph",
  description:
    "Plan → orchestrate → review → debug loop with bounded iteration",
  inputs: [
    {
      name: "prompt",
      type: "text",
      required: true,
      description: "task prompt",
    },
    {
      name: "max_loops",
      type: "integer",
      description: "maximum number of plan/orchestrate/review iterations",
      default: DEFAULT_MAX_LOOPS,
    },
  ],
})
  .for<"claude">()
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";
    const maxLoops = ctx.inputs.max_loops ?? DEFAULT_MAX_LOOPS;
    let debuggerReport = "";

    for (let iteration = 1; iteration <= maxLoops; iteration++) {
      // ── Plan ────────────────────────────────────────────────────────────
      await ctx.stage(
        { name: `planner-${iteration}` },
        {
          chatFlags: [
            "--agent",
            "planner",
            "--allow-dangerously-skip-permissions",
            "--dangerously-skip-permissions",
          ],
        },
        {},
        async (s) => {
          await s.session.query(
            buildPlannerPrompt(prompt, {
              iteration,
              debuggerReport: debuggerReport || undefined,
            }),
          );
          s.save(s.sessionId);
        },
      );

      // ── Orchestrate ─────────────────────────────────────────────────────
      await ctx.stage(
        { name: `orchestrator-${iteration}` },
        {
          chatFlags: [
            "--agent",
            "orchestrator",
            "--allow-dangerously-skip-permissions",
            "--dangerously-skip-permissions",
          ],
        },
        {},
        async (s) => {
          await s.session.query(buildOrchestratorPrompt(prompt));
          s.save(s.sessionId);
        },
      );

      // ── Infrastructure Discovery (three parallel sub-agent stages) ────
      const changeset = await captureBranchChangeset();
      const discoveryPrompts = buildInfraDiscoveryPrompts();

      const [locatorResult, analyzerResult, patternResult] = await Promise.all([
        ctx.stage(
          { name: `infra-locate-${iteration}`, headless: true },
          {},
          {},
          async (s) => {
            const result = await s.session.query(discoveryPrompts.locator, {
              agent: "codebase-locator",
              permissionMode: "bypassPermissions",
              allowDangerouslySkipPermissions: true,
            });
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        ),
        ctx.stage(
          { name: `infra-analyze-${iteration}`, headless: true },
          {},
          {},
          async (s) => {
            const result = await s.session.query(discoveryPrompts.analyzer, {
              agent: "codebase-analyzer",
              permissionMode: "bypassPermissions",
              allowDangerouslySkipPermissions: true,
            });
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        ),
        ctx.stage(
          { name: `infra-patterns-${iteration}`, headless: true },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              discoveryPrompts.patternFinder,
              {
                agent: "codebase-pattern-finder",
                permissionMode: "bypassPermissions",
                allowDangerouslySkipPermissions: true,
              },
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        ),
      ]);

      const discoveryContext = [
        "### Infrastructure Files (codebase-locator)\n\n" +
          locatorResult.result,
        "### Infrastructure Analysis (codebase-analyzer)\n\n" +
          analyzerResult.result,
        "### Build & Test Patterns (codebase-pattern-finder)\n\n" +
          patternResult.result,
      ].join("\n\n---\n\n");

      // ── Review (two parallel passes) ────────────────────────────────────
      const reviewPrompt = buildReviewPrompt(prompt, {
        changeset,
        iteration,
        discoveryContext,
      });

      const reviewerChatFlags = [
        "--agent",
        "reviewer",
        "--allow-dangerously-skip-permissions",
        "--dangerously-skip-permissions",
      ];

      const [reviewA, reviewB] = await Promise.all([
        ctx.stage(
          { name: `reviewer-${iteration}-a` },
          { chatFlags: reviewerChatFlags },
          {},
          async (s) => {
            const result = await s.session.query(reviewPrompt);
            s.save(s.sessionId);
            return extractReview(extractAssistantText(result, 0));
          },
        ),
        ctx.stage(
          { name: `reviewer-${iteration}-b` },
          { chatFlags: reviewerChatFlags },
          {},
          async (s) => {
            const result = await s.session.query(reviewPrompt);
            s.save(s.sessionId);
            return extractReview(extractAssistantText(result, 0));
          },
        ),
      ]);

      const merged = mergeReviewResults(reviewA.result, reviewB.result);
      const parsed = merged.structured;
      const reviewRaw = merged.raw;

      // Both reviewers agree the code is clean → done
      if (!hasActionableFindings(parsed, reviewRaw)) break;

      // ── Debug (only if another iteration is allowed) ────────────────────
      if (iteration < maxLoops) {
        const debugger_ = await ctx.stage(
          { name: `debugger-${iteration}` },
          {
            chatFlags: [
              "--agent",
              "debugger",
              "--allow-dangerously-skip-permissions",
              "--dangerously-skip-permissions",
            ],
          },
          {},
          async (s) => {
            const result = await s.session.query(
              buildDebuggerReportPrompt(parsed, reviewRaw, {
                iteration,
                changeset,
              }),
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        );

        debuggerReport = extractMarkdownBlock(debugger_.result);
      }
    }
  })
  .compile();
