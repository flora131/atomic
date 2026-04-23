/**
 * Ralph workflow for Copilot — plan → orchestrate → review → debug loop.
 *
 * Each sub-agent invocation spawns its own visible session in the graph,
 * so users can see each iteration's progress in real time. The loop
 * terminates when:
 *   - `max_loops` iterations have completed (defaults to {@link DEFAULT_MAX_LOOPS}), OR
 *   - Two parallel reviewer passes both return zero findings.
 *
 * The reviewer stages use a `submit_review` custom tool (defined via
 * `defineTool` with Zod schema validation) to guarantee the review result
 * matches the {@link ReviewResultSchema}. The Copilot SDK validates tool
 * call arguments against the Zod schema before the handler fires.
 *
 * Run: atomic workflow -n ralph -a copilot "<your spec>"
 */

import { defineWorkflow } from "../../../index.ts";
import { defineTool } from "@github/copilot-sdk";
import type { SessionEvent } from "@github/copilot-sdk";

import {
  buildPlannerPrompt,
  buildOrchestratorPrompt,
  buildInfraDiscoveryPrompts,
  buildReviewPrompt,
  buildDebuggerReportPrompt,
  extractMarkdownBlock,
  filterActionable,
  mergeReviewResults,
  ReviewResultSchema,
  type ReviewResult,
  type StructuredReviewResult,
} from "../helpers/prompts.ts";
import { hasActionableFindings } from "../helpers/review.ts";
import { captureBranchChangeset } from "../helpers/git.ts";
import {
  initScratchpad,
  latestPriorRFC,
  recordDebuggerReport,
  recordFilesModified,
  recordPlannerOutput,
  shouldReRunInfraDiscovery,
} from "../../_context/index.ts";

const DEFAULT_MAX_LOOPS = 10;

function deriveSessionIntent(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "(no prompt)";
  const firstPara = trimmed.split(/\n\n+/)[0] ?? trimmed;
  const oneLine = firstPara.split("\n").join(" ").replace(/\s+/g, " ");
  return oneLine.length > 200 ? oneLine.slice(0, 200) + "…" : oneLine;
}

function parseFilesFromNameStatus(nameStatus: string): string[] {
  const paths: string[] = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const p = parts[parts.length - 1];
      if (p) paths.push(p);
    }
  }
  return paths;
}

const SUBMIT_REVIEW_DESCRIPTION =
  "Submit the structured code review result. You MUST call this tool " +
  "exactly once with your complete review. Do not output the review as " +
  "plain text — use this tool.";

/**
 * Concatenate the text content of every top-level assistant message in the
 * event stream.
 *
 * Why not just `.at(-1)`? Two traps:
 *
 * 1. A single Copilot turn is one `assistant.message` event that carries BOTH
 *    prose AND a `toolRequests[]` array. When the model ends a turn with
 *    tool-calls-only (e.g. the planner's final `TaskList` verification call),
 *    `content` is an empty string — picking the final message drops the
 *    planner's actual reasoning from the earlier turns.
 * 2. `assistant.message` events have a `parentToolCallId` field populated when
 *    they originate from a sub-agent spawned by the parent. `getMessages()`
 *    returns the complete history including those, so `.at(-1)` can land on a
 *    sub-agent's final message instead of the top-level agent's. Filter them
 *    out to get only the agent's own turns.
 *
 * Joining every non-empty top-level content string preserves the full
 * commentary across all turns, which is what downstream stages (e.g. the
 * orchestrator reading the planner's handoff) actually need.
 */
function getAssistantText(messages: SessionEvent[]): string {
  return messages
    .filter(
      (m): m is Extract<SessionEvent, { type: "assistant.message" }> =>
        m.type === "assistant.message" && !m.data.parentToolCallId,
    )
    .map((m) => m.data.content)
    .filter((c) => c.length > 0)
    .join("\n\n");
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
  .for<"copilot">()
  .run(async (ctx) => {
    const userPromptText = ctx.inputs.prompt ?? "";
    const maxLoops = ctx.inputs.max_loops ?? DEFAULT_MAX_LOOPS;
    const runId = crypto.randomUUID();
    const sessionIntent = deriveSessionIntent(userPromptText);
    const scratchpad = await initScratchpad({
      sessionId: runId,
      projectRoot: process.cwd(),
      originalSpec: userPromptText,
    });

    let debuggerReport = "";
    let priorRfc: string | null = null;
    let discoveryContext: string | null = null;

    for (let iteration = 1; iteration <= maxLoops; iteration++) {
      // ── Plan ──────────────────────────────────────────────────────────
      const planner = await ctx.stage(
        { name: `planner-${iteration}` },
        {},
        { agent: "planner" },
        async (s) => {
          await s.session.send({
            prompt: buildPlannerPrompt(userPromptText, {
              iteration,
              debuggerReport: debuggerReport || undefined,
              priorRfc: priorRfc ?? undefined,
              sessionIntent,
            }),
          });
          const messages = await s.session.getMessages();
          s.save(messages);
          return getAssistantText(messages);
        },
      );

      await recordPlannerOutput(scratchpad, iteration, planner.result);
      priorRfc = await latestPriorRFC(scratchpad);

      // ── Orchestrate ───────────────────────────────────────────────────
      await ctx.stage(
        { name: `orchestrator-${iteration}` },
        {},
        { agent: "orchestrator" },
        async (s) => {
          await s.session.send({
            prompt: buildOrchestratorPrompt(userPromptText, {
              plannerNotes: planner.result,
            }),
          });
          s.save(await s.session.getMessages());
        },
      );

      // ── Capture changeset ─────────────────────────────────────────────
      const changeset = await captureBranchChangeset();
      await recordFilesModified(
        scratchpad,
        iteration,
        parseFilesFromNameStatus(changeset.nameStatus),
      );

      // ── Infrastructure Discovery (hoisted; re-runs on infra edits) ──
      const needsRediscovery =
        discoveryContext === null || shouldReRunInfraDiscovery(changeset);
      if (needsRediscovery) {
        const discoveryPrompts = buildInfraDiscoveryPrompts();
        const [locatorResult, analyzerResult, patternResult] =
          await Promise.all([
            ctx.stage(
              { name: `infra-locate-${iteration}`, headless: true },
              {},
              { agent: "codebase-locator" },
              async (s) => {
                await s.session.send({ prompt: discoveryPrompts.locator });
                const messages = await s.session.getMessages();
                s.save(messages);
                return getAssistantText(messages);
              },
            ),
            ctx.stage(
              { name: `infra-analyze-${iteration}`, headless: true },
              {},
              { agent: "codebase-analyzer" },
              async (s) => {
                await s.session.send({ prompt: discoveryPrompts.analyzer });
                const messages = await s.session.getMessages();
                s.save(messages);
                return getAssistantText(messages);
              },
            ),
            ctx.stage(
              { name: `infra-patterns-${iteration}`, headless: true },
              {},
              { agent: "codebase-pattern-finder" },
              async (s) => {
                await s.session.send({ prompt: discoveryPrompts.patternFinder });
                const messages = await s.session.getMessages();
                s.save(messages);
                return getAssistantText(messages);
              },
            ),
          ]);

        discoveryContext = [
          "### Infrastructure Files (codebase-locator)\n\n" +
            locatorResult.result,
          "### Infrastructure Analysis (codebase-analyzer)\n\n" +
            analyzerResult.result,
          "### Build & Test Patterns (codebase-pattern-finder)\n\n" +
            patternResult.result,
        ].join("\n\n---\n\n");
      }

      // ── Review (two parallel passes) ──────────────────────────────────
      const reviewPrompt = buildReviewPrompt(userPromptText, {
        changeset,
        iteration,
        useSubmitTool: true,
        discoveryContext: discoveryContext ?? undefined,
        sessionIntent,
      });

      // Each parallel reviewer gets its own tool + capture ref so they
      // don't race on a shared mutable.
      let captureA: ReviewResult | null = null;
      let captureB: ReviewResult | null = null;

      const toolA = defineTool("submit_review", {
        description: SUBMIT_REVIEW_DESCRIPTION,
        parameters: ReviewResultSchema,
        skipPermission: true,
        handler: async (data: ReviewResult) => {
          captureA = filterActionable(data);
          return "Review submitted successfully.";
        },
      });

      const toolB = defineTool("submit_review", {
        description: SUBMIT_REVIEW_DESCRIPTION,
        parameters: ReviewResultSchema,
        skipPermission: true,
        handler: async (data: ReviewResult) => {
          captureB = filterActionable(data);
          return "Review submitted successfully.";
        },
      });

      const [reviewA, reviewB] = await Promise.all([
        ctx.stage(
          { name: `reviewer-${iteration}-a` },
          {},
          { agent: "reviewer", tools: [toolA] },
          async (s) => {
            await s.session.send({ prompt: reviewPrompt });
            const messages = await s.session.getMessages();
            s.save(messages);
            return {
              structured: captureA,
              raw: getAssistantText(messages),
            } as StructuredReviewResult;
          },
        ),
        ctx.stage(
          { name: `reviewer-${iteration}-b` },
          {},
          { agent: "reviewer", tools: [toolB] },
          async (s) => {
            await s.session.send({ prompt: reviewPrompt });
            const messages = await s.session.getMessages();
            s.save(messages);
            return {
              structured: captureB,
              raw: getAssistantText(messages),
            } as StructuredReviewResult;
          },
        ),
      ]);

      const merged = mergeReviewResults(reviewA.result, reviewB.result);
      const parsed = merged.structured;
      const reviewRaw = merged.raw;

      // Both reviewers agree the code is clean → done
      if (!hasActionableFindings(parsed, reviewRaw)) break;

      // ── Debug (only if another iteration is allowed) ──────────────────
      if (iteration < maxLoops) {
        const debugger_ = await ctx.stage(
          { name: `debugger-${iteration}` },
          {},
          { agent: "debugger" },
          async (s) => {
            await s.session.send({
              prompt: buildDebuggerReportPrompt(parsed, reviewRaw, {
                iteration,
                changeset,
              }),
            });
            const messages = await s.session.getMessages();
            s.save(messages);
            return getAssistantText(messages);
          },
        );

        debuggerReport = extractMarkdownBlock(debugger_.result);
        await recordDebuggerReport(scratchpad, iteration, debuggerReport);
      }
    }
  })
  .compile();
