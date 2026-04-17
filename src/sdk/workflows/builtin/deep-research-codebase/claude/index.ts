/**
 * deep-research-codebase / claude
 *
 * A deterministically-orchestrated, distributed codebase researcher built on
 * the Claude Agent SDK's native sub-agent dispatch. Specialist sub-agents
 * (codebase-locator / codebase-pattern-finder / codebase-analyzer /
 * codebase-online-researcher / codebase-research-locator /
 * codebase-research-analyzer) are spawned as separate headless `ctx.stage()`
 * calls — each binds the SDK's `agent` option to the desired specialist
 * instead of relying on a coordinator agent that dispatches them via the
 * `@"name (agent)"` prompt syntax.
 *
 * Why SDK primitives instead of in-prompt orchestration:
 *
 *   • Each specialist runs in an ISOLATED conversation. The locator's giant
 *     file index doesn't pollute the analyzer's context window, and the
 *     online-researcher doesn't see the analyzer's reasoning at all. This is
 *     `multi-agent-patterns` swarm-style isolation, not orchestrator-style.
 *
 *   • There is no orchestrator turn whose context grows linearly with the
 *     number of specialists. Token cost per partition is bounded by the four
 *     specialists' independent prompts — adding more partitions scales
 *     cleanly because every fan-out is a fresh session.
 *
 *   • Failure of one specialist does not abort the partition mid-thought —
 *     the runtime fails the stage, but its siblings' outputs are still on
 *     disk and the aggregator can continue with whatever completed.
 *
 *   • The synthesis step that combines specialist outputs is plain TypeScript
 *     (`renderExplorerMarkdown` in helpers/scratch.ts) — no extra LLM call
 *     just to concatenate four markdown sections.
 *
 * Topology:
 *
 *           ┌─→ codebase-scout (visible)
 *   parent ─┤
 *           └─→ history-locator → history-analyzer (headless)
 *                                       │
 *                                       ▼
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  Per-partition (Promise.all over partitions, all stages headless):    │
 *   │                                                                       │
 *   │     locator-i      ∥   pattern-finder-i        (Layer 1, parallel)    │
 *   │            │                                                          │
 *   │            ▼                                                          │
 *   │     analyzer-i     ∥   online-researcher-i     (Layer 2, parallel)    │
 *   │            │                                                          │
 *   │            ▼                                                          │
 *   │     deterministic write to scratch file (TS helper, no LLM)           │
 *   └──────────────────────────────────────────────────────────────────────┘
 *                                       │
 *                                       ▼
 *                                  aggregator (visible)
 *
 * Specialist stages run headless (in-process via the Agent SDK's `query()`),
 * so they are transparent to the workflow graph. The visible nodes are just:
 *   parent → [codebase-scout] → aggregator
 */

import { defineWorkflow, extractAssistantText } from "../../../index.ts";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  getCodebaseRoot,
  partitionUnits,
  scoutCodebase,
} from "../helpers/scout.ts";
import {
  calculateExplorerCount,
  explainHeuristic,
} from "../helpers/heuristic.ts";
import {
  buildAggregatorPrompt,
  buildAnalyzerPrompt,
  buildHistoryAnalyzerPrompt,
  buildHistoryLocatorPrompt,
  buildLocatorPrompt,
  buildOnlineResearcherPrompt,
  buildPatternFinderPrompt,
  buildScoutPrompt,
  slugifyPrompt,
} from "../helpers/prompts.ts";
import { writeExplorerScratchFile } from "../helpers/scratch.ts";

/**
 * Shared SDK options for every sub-agent dispatch. `permissionMode` +
 * `allowDangerouslySkipPermissions` are required so the headless sub-agents
 * can use Read/Grep/Glob/Bash without prompting (we are running unattended).
 */
const SUBAGENT_OPTS = {
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
} as const;

export default defineWorkflow({
  name: "deep-research-codebase",
  description:
    "Deterministic deep codebase research: scout → per-partition specialist sub-agents → aggregator",
  inputs: [
    {
      name: "prompt",
      type: "text",
      required: true,
      description: "research question",
    },
  ],
})
  .for<"claude">()
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";
    const root = getCodebaseRoot();
    const startedAt = new Date();
    const isoDate = startedAt.toISOString().slice(0, 10);
    const slug = slugifyPrompt(prompt);

    // ── Stage 1a: codebase-scout (visible) ‖ Stage 1b: research-history pipeline (headless) ──
    //
    // Both pipelines are independent of each other and must complete before
    // any explorer fan-out — explorers depend on `scout.result.partitions`
    // and the aggregator embeds the history overview as supplementary
    // context. We wrap the history sub-pipeline (locator → analyzer) in an
    // IIFE so Promise.all sees it as a single awaitable.
    const [scout, historyOverview] = await Promise.all([
      ctx.stage(
        {
          name: "codebase-scout",
          description:
            "Map codebase, count LOC, partition for parallel specialists",
        },
        {},
        {},
        async (s) => {
          const data = scoutCodebase(root);
          if (data.units.length === 0) {
            throw new Error(
              `deep-research-codebase: scout found no source files under ${root}. ` +
                `Run from inside a code repository or check the CODE_EXTENSIONS list.`,
            );
          }

          const targetCount = calculateExplorerCount(data.totalLoc);
          const partitions = partitionUnits(data.units, targetCount);
          const actualCount = partitions.length;

          const scratchDir = path.join(
            root,
            "research",
            "docs",
            `.deep-research-${startedAt.getTime()}`,
          );
          await mkdir(scratchDir, { recursive: true });

          await s.session.query(
            buildScoutPrompt({
              question: prompt,
              tree: data.tree,
              totalLoc: data.totalLoc,
              totalFiles: data.totalFiles,
              explorerCount: actualCount,
              partitionPreview: partitions,
            }),
          );
          s.save(s.sessionId);

          return {
            root,
            totalLoc: data.totalLoc,
            totalFiles: data.totalFiles,
            tree: data.tree,
            partitions,
            explorerCount: actualCount,
            scratchDir,
            heuristicNote: explainHeuristic(data.totalLoc, actualCount),
          };
        },
      ),
      // Research-history pipeline: locator → analyzer, both headless. The
      // analyzer needs the locator's verbatim output, so this is sequential
      // INSIDE the IIFE while remaining parallel TO the codebase scout.
      (async (): Promise<string> => {
        const historyLocator = await ctx.stage(
          {
            name: "history-locator",
            headless: true,
            description: "Locate prior research docs (codebase-research-locator)",
          },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              buildHistoryLocatorPrompt({ question: prompt, root }),
              { agent: "codebase-research-locator", ...SUBAGENT_OPTS },
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        );

        const historyAnalyzer = await ctx.stage(
          {
            name: "history-analyzer",
            headless: true,
            description: "Synthesize prior research (codebase-research-analyzer)",
          },
          {},
          {},
          async (s) => {
            const result = await s.session.query(
              buildHistoryAnalyzerPrompt({
                question: prompt,
                locatorOutput: historyLocator.result,
                root,
              }),
              { agent: "codebase-research-analyzer", ...SUBAGENT_OPTS },
            );
            s.save(s.sessionId);
            return extractAssistantText(result, 0);
          },
        );

        return historyAnalyzer.result;
      })(),
    ]);

    const { partitions, explorerCount, scratchDir, totalLoc, totalFiles } =
      scout.result;

    // Pull the scout transcript ONCE so every per-partition specialist can
    // embed the architectural orientation in its prompt. The scout has
    // completed by the time we get here (we're past Promise.all), so this
    // read is safe (failure-modes F13).
    const scoutOverview = (await ctx.transcript(scout)).content;

    // ── Stage 2: per-partition specialist fan-out ─────────────────────────
    //
    // Per partition i:
    //   Layer 1 (parallel):  locator-i     ∥  pattern-finder-i
    //   Layer 2 (parallel):  analyzer-i    ∥  online-researcher-i   ← depend on locator-i
    //   Synthesis (deterministic TS):      renderExplorerMarkdown → scratch file
    //
    // All N partitions run as parallel branches of the outer Promise.all.
    // Sub-agent stages are headless: invisible in the graph and bounded only
    // by SDK concurrency. Information flow is forward-only and all context
    // each specialist needs (research question, scope, scout overview, and —
    // for layer 2 — locator output) is injected into the first prompt.
    const explorerHandles = await Promise.all(
      partitions.map(async (partition, idx) => {
        const i = idx + 1;
        const scratchPath = path.join(scratchDir, `explorer-${i}.md`);

        // Layer 1: locator + pattern-finder run independently.
        const [locator, patternFinder] = await Promise.all([
          ctx.stage(
            {
              name: `locator-${i}`,
              headless: true,
              description: `codebase-locator over partition ${i}`,
            },
            {},
            {},
            async (s) => {
              const result = await s.session.query(
                buildLocatorPrompt({
                  question: prompt,
                  partition,
                  root,
                  scoutOverview,
                  index: i,
                  total: explorerCount,
                }),
                { agent: "codebase-locator", ...SUBAGENT_OPTS },
              );
              s.save(s.sessionId);
              return extractAssistantText(result, 0);
            },
          ),
          ctx.stage(
            {
              name: `pattern-finder-${i}`,
              headless: true,
              description: `codebase-pattern-finder over partition ${i}`,
            },
            {},
            {},
            async (s) => {
              const result = await s.session.query(
                buildPatternFinderPrompt({
                  question: prompt,
                  partition,
                  root,
                  scoutOverview,
                  index: i,
                  total: explorerCount,
                }),
                { agent: "codebase-pattern-finder", ...SUBAGENT_OPTS },
              );
              s.save(s.sessionId);
              return extractAssistantText(result, 0);
            },
          ),
        ]);

        const locatorOutput = locator.result;
        const patternsOutput = patternFinder.result;

        // Layer 2: analyzer + online-researcher both consume locator output.
        const [analyzer, onlineResearcher] = await Promise.all([
          ctx.stage(
            {
              name: `analyzer-${i}`,
              headless: true,
              description: `codebase-analyzer over partition ${i}`,
            },
            {},
            {},
            async (s) => {
              const result = await s.session.query(
                buildAnalyzerPrompt({
                  question: prompt,
                  partition,
                  locatorOutput,
                  root,
                  scoutOverview,
                  index: i,
                  total: explorerCount,
                }),
                { agent: "codebase-analyzer", ...SUBAGENT_OPTS },
              );
              s.save(s.sessionId);
              return extractAssistantText(result, 0);
            },
          ),
          ctx.stage(
            {
              name: `online-researcher-${i}`,
              headless: true,
              description: `codebase-online-researcher over partition ${i}`,
            },
            {},
            {},
            async (s) => {
              const result = await s.session.query(
                buildOnlineResearcherPrompt({
                  question: prompt,
                  partition,
                  locatorOutput,
                  root,
                  index: i,
                  total: explorerCount,
                }),
                { agent: "codebase-online-researcher", ...SUBAGENT_OPTS },
              );
              s.save(s.sessionId);
              return extractAssistantText(result, 0);
            },
          ),
        ]);

        // Deterministic synthesis — no fifth LLM call just to concatenate.
        await writeExplorerScratchFile(scratchPath, {
          index: i,
          total: explorerCount,
          partition,
          locatorOutput,
          patternsOutput,
          analyzerOutput: analyzer.result,
          onlineOutput: onlineResearcher.result,
        });

        return { index: i, scratchPath, partition };
      }),
    );

    // ── Stage 3: aggregator (visible) ─────────────────────────────────────
    //
    // Reads each partition's deterministic scratch file by PATH so the
    // aggregator's own context stays bounded by N filenames + the short
    // scout/history overviews — not by N inlined transcripts (filesystem-
    // context skill).
    const finalPath = path.join(
      root,
      "research",
      "docs",
      `${isoDate}-${slug}.md`,
    );

    await ctx.stage(
      {
        name: "aggregator",
        description:
          "Synthesize partition findings + history into final research doc",
      },
      {},
      {},
      async (s) => {
        await s.session.query(
          buildAggregatorPrompt({
            question: prompt,
            totalLoc,
            totalFiles,
            explorerCount,
            explorerFiles: explorerHandles,
            finalPath,
            scoutOverview,
            historyOverview,
          }),
        );
        s.save(s.sessionId);
      },
    );
  })
  .compile();
