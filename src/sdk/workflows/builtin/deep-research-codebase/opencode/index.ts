/**
 * deep-research-codebase / opencode
 *
 * OpenCode replica of the Claude deep-research-codebase workflow. Specialist
 * sub-agents are dispatched as separate headless `ctx.stage()` calls — each
 * call passes `agent: "<name>"` to `s.client.session.prompt()` directly,
 * which is OpenCode's SDK-native way to route a turn to a sub-agent.
 *
 * OpenCode-specific concerns baked in (see references/failure-modes.md):
 *
 *   • F5 — every `ctx.stage()` is a FRESH session. Each specialist receives
 *     everything it needs (research question, scope, scout overview, and —
 *     for layer-2 specialists — verbatim locator output) in its first prompt.
 *
 *   • F3 — `result.data!.parts` is a heterogenous array (text/tool/reasoning/
 *     file parts). Use `extractResponseText()` to filter to text parts only;
 *     concatenating raw `parts` produces `[object Object]` strings.
 *
 *   • F6 — every prompt explicitly requires trailing prose so transcripts and
 *     `extractResponseText()` reads are never empty.
 *
 *   • F9 — `s.save()` receives the unwrapped `{ info, parts }` payload from
 *     `result.data!`; passing the full `result` or raw `result.data!.parts`
 *     breaks downstream `transcript()` reads.
 *
 * See claude/index.ts for the full design rationale and topology diagram.
 */

import { defineWorkflow } from "../../../index.ts";
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
import { compactScratchFilesForAggregator, writeExplorerScratchFile } from "../helpers/scratch.ts";
import {
  deriveHistoryBrief,
  PROSE_GUARD_RETRY_PROMPT,
  queryWithProseGuard,
} from "../../_context/index.ts";

/** Filter for text parts only — non-text parts produce [object Object]. */
function extractResponseText(
  parts: Array<{ type: string; [key: string]: unknown }>,
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: string; text: string }).text)
    .join("\n");
}

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
  .for<"opencode">()
  .run(async (ctx) => {
    const prompt = ctx.inputs.prompt ?? "";
    const root = getCodebaseRoot();
    const startedAt = new Date();
    const isoDate = startedAt.toISOString().slice(0, 10);
    const slug = slugifyPrompt(prompt);

    // ── Stage 1a: codebase-scout ‖ Stage 1b: research-history pipeline ────
    const [scout, historyOverview] = await Promise.all([
      ctx.stage(
        {
          name: "codebase-scout",
          description:
            "Map codebase, count LOC, partition for parallel specialists",
        },
        {},
        { title: "codebase-scout" },
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

          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: buildScoutPrompt({
                  question: prompt,
                  tree: data.tree,
                  totalLoc: data.totalLoc,
                  totalFiles: data.totalFiles,
                  explorerCount: actualCount,
                  partitionPreview: partitions,
                }),
              },
            ],
          });
          // F9: OpenCode takes the unwrapped { info, parts } object.
          s.save(result.data!);

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
      // research-history pipeline: sequential locator → analyzer, both headless.
      (async (): Promise<string> => {
        const historyLocator = await ctx.stage(
          {
            name: "history-locator",
            headless: true,
            description: "Locate prior research docs (codebase-research-locator)",
          },
          {},
          { title: "history-locator" },
          async (s) => {
            let lastResult: Awaited<ReturnType<typeof s.client.session.prompt>>;
            const { text } = await queryWithProseGuard({
              query: async () => {
                lastResult = await s.client.session.prompt({
                  sessionID: s.session.id,
                  parts: [
                    {
                      type: "text",
                      text: buildHistoryLocatorPrompt({
                        question: prompt,
                      }),
                    },
                  ],
                  agent: "codebase-research-locator",
                });
                return lastResult;
              },
              getText: (r) => extractResponseText(r.data!.parts),
              retry: async () => {
                lastResult = await s.client.session.prompt({
                  sessionID: s.session.id,
                  parts: [{ type: "text", text: PROSE_GUARD_RETRY_PROMPT }],
                  agent: "codebase-research-locator",
                });
                return lastResult;
              },
            });
            s.save(lastResult!.data!);
            return text;
          },
        );

        const historyAnalyzer = await ctx.stage(
          {
            name: "history-analyzer",
            headless: true,
            description: "Synthesize prior research (codebase-research-analyzer)",
          },
          {},
          { title: "history-analyzer" },
          async (s) => {
            let lastResult: Awaited<ReturnType<typeof s.client.session.prompt>>;
            const { text } = await queryWithProseGuard({
              query: async () => {
                lastResult = await s.client.session.prompt({
                  sessionID: s.session.id,
                  parts: [
                    {
                      type: "text",
                      text: buildHistoryAnalyzerPrompt({
                        question: prompt,
                        locatorOutput: historyLocator.result,
                      }),
                    },
                  ],
                  agent: "codebase-research-analyzer",
                });
                return lastResult;
              },
              getText: (r) => extractResponseText(r.data!.parts),
              retry: async () => {
                lastResult = await s.client.session.prompt({
                  sessionID: s.session.id,
                  parts: [{ type: "text", text: PROSE_GUARD_RETRY_PROMPT }],
                  agent: "codebase-research-analyzer",
                });
                return lastResult;
              },
            });
            s.save(lastResult!.data!);
            return text;
          },
        );

        return historyAnalyzer.result;
      })(),
    ]);

    const { partitions, explorerCount, scratchDir, totalLoc, totalFiles } =
      scout.result;

    // D2: derive a short brief from the history-analyzer output to inject as
    // <PRIOR_RESEARCH_HINT> into per-partition locator + analyzer prompts.
    const priorResearchBrief = deriveHistoryBrief(historyOverview);

    const scoutOverview = (await ctx.transcript(scout)).content;

    // ── Stage 2: per-partition specialist fan-out ─────────────────────────
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
            { title: `locator-${i}` },
            async (s) => {
              let lastResult: Awaited<ReturnType<typeof s.client.session.prompt>>;
              const { text } = await queryWithProseGuard({
                query: async () => {
                  lastResult = await s.client.session.prompt({
                    sessionID: s.session.id,
                    parts: [
                      {
                        type: "text",
                        text: buildLocatorPrompt({
                          question: prompt,
                          partition,
                          scoutOverview,
                          index: i,
                          total: explorerCount,
                          priorResearchBrief,
                        }),
                      },
                    ],
                    agent: "codebase-locator",
                  });
                  return lastResult;
                },
                getText: (r) => extractResponseText(r.data!.parts),
                retry: async () => {
                  lastResult = await s.client.session.prompt({
                    sessionID: s.session.id,
                    parts: [{ type: "text", text: PROSE_GUARD_RETRY_PROMPT }],
                    agent: "codebase-locator",
                  });
                  return lastResult;
                },
              });
              s.save(lastResult!.data!);
              return text;
            },
          ),
          ctx.stage(
            {
              name: `pattern-finder-${i}`,
              headless: true,
              description: `codebase-pattern-finder over partition ${i}`,
            },
            {},
            { title: `pattern-finder-${i}` },
            async (s) => {
              let lastResult: Awaited<ReturnType<typeof s.client.session.prompt>>;
              const { text } = await queryWithProseGuard({
                query: async () => {
                  lastResult = await s.client.session.prompt({
                    sessionID: s.session.id,
                    parts: [
                      {
                        type: "text",
                        text: buildPatternFinderPrompt({
                          question: prompt,
                          partition,
                          scoutOverview,
                          index: i,
                          total: explorerCount,
                        }),
                      },
                    ],
                    agent: "codebase-pattern-finder",
                  });
                  return lastResult;
                },
                getText: (r) => extractResponseText(r.data!.parts),
                retry: async () => {
                  lastResult = await s.client.session.prompt({
                    sessionID: s.session.id,
                    parts: [{ type: "text", text: PROSE_GUARD_RETRY_PROMPT }],
                    agent: "codebase-pattern-finder",
                  });
                  return lastResult;
                },
              });
              s.save(lastResult!.data!);
              return text;
            },
          ),
        ]);

        const locatorOutput = locator.result;
        const patternsOutput = patternFinder.result;

        // Layer 2: analyzer + online-researcher consume locator output.
        const [analyzer, onlineResearcher] = await Promise.all([
          ctx.stage(
            {
              name: `analyzer-${i}`,
              headless: true,
              description: `codebase-analyzer over partition ${i}`,
            },
            {},
            { title: `analyzer-${i}` },
            async (s) => {
              let lastResult: Awaited<ReturnType<typeof s.client.session.prompt>>;
              const { text } = await queryWithProseGuard({
                query: async () => {
                  lastResult = await s.client.session.prompt({
                    sessionID: s.session.id,
                    parts: [
                      {
                        type: "text",
                        text: buildAnalyzerPrompt({
                          question: prompt,
                          partition,
                          locatorOutput,
                          scoutOverview,
                          index: i,
                          total: explorerCount,
                          priorResearchBrief,
                        }),
                      },
                    ],
                    agent: "codebase-analyzer",
                  });
                  return lastResult;
                },
                getText: (r) => extractResponseText(r.data!.parts),
                retry: async () => {
                  lastResult = await s.client.session.prompt({
                    sessionID: s.session.id,
                    parts: [{ type: "text", text: PROSE_GUARD_RETRY_PROMPT }],
                    agent: "codebase-analyzer",
                  });
                  return lastResult;
                },
              });
              s.save(lastResult!.data!);
              return text;
            },
          ),
          ctx.stage(
            {
              name: `online-researcher-${i}`,
              headless: true,
              description: `codebase-online-researcher over partition ${i}`,
            },
            {},
            { title: `online-researcher-${i}` },
            async (s) => {
              let lastResult: Awaited<ReturnType<typeof s.client.session.prompt>>;
              const { text } = await queryWithProseGuard({
                query: async () => {
                  lastResult = await s.client.session.prompt({
                    sessionID: s.session.id,
                    parts: [
                      {
                        type: "text",
                        text: buildOnlineResearcherPrompt({
                          question: prompt,
                          partition,
                          locatorOutput,
                          index: i,
                          total: explorerCount,
                        }),
                      },
                    ],
                    agent: "codebase-online-researcher",
                  });
                  return lastResult;
                },
                getText: (r) => extractResponseText(r.data!.parts),
                retry: async () => {
                  lastResult = await s.client.session.prompt({
                    sessionID: s.session.id,
                    parts: [{ type: "text", text: PROSE_GUARD_RETRY_PROMPT }],
                    agent: "codebase-online-researcher",
                  });
                  return lastResult;
                },
              });
              s.save(lastResult!.data!);
              return text;
            },
          ),
        ]);

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

    // ── Stage 3: aggregator ───────────────────────────────────────────────
    const finalPath = path.join(
      root,
      "research",
      "docs",
      `${isoDate}-${slug}.md`,
    );

    // D3: pre-flight scratch compaction (see Claude index for rationale).
    await compactScratchFilesForAggregator(
      explorerHandles.map((e) => e.scratchPath),
    );

    await ctx.stage(
      {
        name: "aggregator",
        description:
          "Synthesize partition findings + history into final research doc",
      },
      {},
      { title: "aggregator" },
      async (s) => {
        const result = await s.client.session.prompt({
          sessionID: s.session.id,
          parts: [
            {
              type: "text",
              text: buildAggregatorPrompt({
                question: prompt,
                totalLoc,
                totalFiles,
                explorerCount,
                explorerFiles: explorerHandles,
                finalPath,
                scoutOverview,
                historyOverview,
              }),
            },
          ],
        });
        s.save(result.data!);
      },
    );
  })
  .compile();
