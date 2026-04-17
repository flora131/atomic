/**
 * deep-research-codebase / copilot
 *
 * Copilot replica of the Claude deep-research-codebase workflow. Specialist
 * sub-agents are dispatched as separate headless `ctx.stage()` calls — each
 * binds the SDK's session to a single named agent via `sessionOpts: { agent }`,
 * which is the SDK-native way to spawn a sub-agent on Copilot.
 *
 * Copilot-specific concerns baked in (see references/failure-modes.md):
 *
 *   • F5 — every `ctx.stage()` is a FRESH session. Each specialist receives
 *     everything it needs (research question, scope, scout overview, and —
 *     for layer-2 specialists — verbatim locator output) in its first prompt.
 *
 *   • F1 — Copilot's last assistant turn is often empty when the agent ends
 *     on a tool call. We use `getAssistantText()` (canonical concatenation
 *     of every top-level non-empty assistant turn, ignoring sub-agent
 *     `parentToolCallId` traffic) instead of `.at(-1).data.content`.
 *
 *   • F6 — every prompt explicitly requires trailing prose AFTER any tool
 *     call so `getAssistantText()` and downstream `transcript()` reads are
 *     never empty.
 *
 *   • F9 — `s.save()` receives `SessionEvent[]` from `s.session.getMessages()`.
 *
 * See claude/index.ts for the full design rationale and topology diagram.
 */

import { defineWorkflow } from "../../../index.ts";
import type { SessionEvent } from "@github/copilot-sdk";
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
 * Concatenate every top-level assistant turn's non-empty content. The final
 * `assistant.message` of a Copilot turn is often empty when the agent ends
 * on a tool call (F1), and sub-agent traffic is signalled by `parentToolCallId`.
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
  .for<"copilot">()
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

          await s.session.send({
            prompt: buildScoutPrompt({
              question: prompt,
              tree: data.tree,
              totalLoc: data.totalLoc,
              totalFiles: data.totalFiles,
              explorerCount: actualCount,
              partitionPreview: partitions,
            }),
          });
          // F9: Copilot takes SessionEvent[], not a session ID.
          s.save(await s.session.getMessages());

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
          { agent: "codebase-research-locator" },
          async (s) => {
            await s.session.send({
              prompt: buildHistoryLocatorPrompt({ question: prompt, root }),
            });
            const messages = await s.session.getMessages();
            s.save(messages);
            return getAssistantText(messages);
          },
        );

        const historyAnalyzer = await ctx.stage(
          {
            name: "history-analyzer",
            headless: true,
            description: "Synthesize prior research (codebase-research-analyzer)",
          },
          {},
          { agent: "codebase-research-analyzer" },
          async (s) => {
            await s.session.send({
              prompt: buildHistoryAnalyzerPrompt({
                question: prompt,
                locatorOutput: historyLocator.result,
                root,
              }),
            });
            const messages = await s.session.getMessages();
            s.save(messages);
            return getAssistantText(messages);
          },
        );

        return historyAnalyzer.result;
      })(),
    ]);

    const { partitions, explorerCount, scratchDir, totalLoc, totalFiles } =
      scout.result;

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
            { agent: "codebase-locator" },
            async (s) => {
              await s.session.send({
                prompt: buildLocatorPrompt({
                  question: prompt,
                  partition,
                  root,
                  scoutOverview,
                  index: i,
                  total: explorerCount,
                }),
              });
              const messages = await s.session.getMessages();
              s.save(messages);
              return getAssistantText(messages);
            },
          ),
          ctx.stage(
            {
              name: `pattern-finder-${i}`,
              headless: true,
              description: `codebase-pattern-finder over partition ${i}`,
            },
            {},
            { agent: "codebase-pattern-finder" },
            async (s) => {
              await s.session.send({
                prompt: buildPatternFinderPrompt({
                  question: prompt,
                  partition,
                  root,
                  scoutOverview,
                  index: i,
                  total: explorerCount,
                }),
              });
              const messages = await s.session.getMessages();
              s.save(messages);
              return getAssistantText(messages);
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
            { agent: "codebase-analyzer" },
            async (s) => {
              await s.session.send({
                prompt: buildAnalyzerPrompt({
                  question: prompt,
                  partition,
                  locatorOutput,
                  root,
                  scoutOverview,
                  index: i,
                  total: explorerCount,
                }),
              });
              const messages = await s.session.getMessages();
              s.save(messages);
              return getAssistantText(messages);
            },
          ),
          ctx.stage(
            {
              name: `online-researcher-${i}`,
              headless: true,
              description: `codebase-online-researcher over partition ${i}`,
            },
            {},
            { agent: "codebase-online-researcher" },
            async (s) => {
              await s.session.send({
                prompt: buildOnlineResearcherPrompt({
                  question: prompt,
                  partition,
                  locatorOutput,
                  root,
                  index: i,
                  total: explorerCount,
                }),
              });
              const messages = await s.session.getMessages();
              s.save(messages);
              return getAssistantText(messages);
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

    await ctx.stage(
      {
        name: "aggregator",
        description:
          "Synthesize partition findings + history into final research doc",
      },
      {},
      {},
      async (s) => {
        await s.session.send({
          prompt: buildAggregatorPrompt({
            question: prompt,
            totalLoc,
            totalFiles,
            explorerCount,
            explorerFiles: explorerHandles,
            finalPath,
            scoutOverview,
            historyOverview,
          }),
        });
        s.save(await s.session.getMessages());
      },
    );
  })
  .compile();
