/**
 * deep-research-codebase / opencode
 *
 * OpenCode replica of the Claude deep-research-codebase workflow. The Claude
 * version dispatches specialist sub-agents (codebase-locator, codebase-
 * analyzer, etc.) inside a single explorer session via `@"name (agent)"`
 * syntax — a Claude-specific feature. OpenCode sessions are bound to a
 * single agent for their lifetime, so we keep the SAME graph topology
 * (scout ∥ history → explorer-1..N → aggregator) but drive each explorer
 * through the locate → analyze → patterns → synthesize sequence inline using
 * the default agent's built-in file tools.
 *
 * Topology (identical to Claude version):
 *
 *           ┌─→ codebase-scout
 *   parent ─┤
 *           └─→ research-history
 *                     │
 *                     ▼
 *   ┌──────────────────────────────────────────────────┐
 *   │  explorer-1   explorer-2   ...   explorer-N      │   (Promise.all)
 *   └──────────────────────────────────────────────────┘
 *                     │
 *                     ▼
 *                aggregator
 *
 * OpenCode-specific concerns baked in:
 *
 *  • F5 — every `ctx.stage()` call is a FRESH session with no memory of
 *    prior stages. We forward the scout overview, history overview, and
 *    partition assignment explicitly into each explorer's first prompt.
 *
 *  • F9 — `s.save()` receives the `{ info, parts }` payload from
 *    `s.client.session.prompt()` via `result.data!`. Passing the full
 *    `result` (with its wrapping) or raw `result.data.parts` breaks
 *    downstream `transcript()` reads.
 *
 *  • F6 — every prompt explicitly requires trailing prose AFTER any tool
 *    call so the rendered transcript has content. OpenCode's `parts` array
 *    mixes text/tool/reasoning/file parts; without trailing text the
 *    transcript extractor returns an empty string.
 *
 *  • F3 — transcript extraction relies on the runtime's text-only rendering
 *    of `result.data.parts`. The helpers call `ctx.transcript(handle)` which
 *    returns `{ path, content }` where content is already text-filtered.
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
  buildExplorerPromptGeneric,
  buildHistoryPromptGeneric,
  buildScoutPrompt,
  slugifyPrompt,
} from "../helpers/prompts.ts";

export default defineWorkflow<"opencode">({
    name: "deep-research-codebase",
    description:
      "Deterministic deep codebase research: scout → LOC-driven parallel explorers → aggregator",
  })
  .run(async (ctx) => {
    // Free-form workflows receive their positional prompt under
    // `inputs.prompt`; destructure once so every stage below can close
    // over a bare `prompt` string without re-reaching into ctx.inputs.
    const prompt = ctx.inputs.prompt ?? "";
    const root = getCodebaseRoot();
    const startedAt = new Date();
    const isoDate = startedAt.toISOString().slice(0, 10);
    const slug = slugifyPrompt(prompt);

    // ── Stages 1a + 1b: codebase-scout ∥ research-history ──────────────────
    const [scout, history] = await Promise.all([
      ctx.stage(
        {
          name: "codebase-scout",
          description: "Map codebase, count LOC, partition for parallel explorers",
        },
        {},
        { title: "codebase-scout" },
        async (s) => {
          // 1. Deterministic scouting (pure TypeScript — no LLM).
          const data = scoutCodebase(root);
          if (data.units.length === 0) {
            throw new Error(
              `deep-research-codebase: scout found no source files under ${root}. ` +
                `Run from inside a code repository or check the CODE_EXTENSIONS list.`,
            );
          }

          // 2. Heuristic decides explorer count (capped by available units).
          const targetCount = calculateExplorerCount(data.totalLoc);
          const partitions = partitionUnits(data.units, targetCount);
          const actualCount = partitions.length;

          // 3. Scratch directory for explorer outputs (timestamped to avoid
          //    collisions across runs).
          const scratchDir = path.join(
            root,
            "research",
            "docs",
            `.deep-research-${startedAt.getTime()}`,
          );
          await mkdir(scratchDir, { recursive: true });

          // 4. Short LLM call: architectural orientation for downstream
          //    explorers. The prompt forbids the agent from answering the
          //    research question — its only job here is to orient.
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
      ctx.stage(
        {
          name: "research-history",
          description: "Surface prior research from research/ directory",
        },
        {},
        { title: "research-history" },
        async (s) => {
          // The generic history prompt drives a single default-agent session
          // through locate → analyze → synthesize inline, instead of Claude's
          // sub-agent dispatch.
          const result = await s.client.session.prompt({
            sessionID: s.session.id,
            parts: [
              {
                type: "text",
                text: buildHistoryPromptGeneric({
                  question: prompt,
                  root,
                }),
              },
            ],
          });
          s.save(result.data!);
        },
      ),
    ]);

    const {
      partitions,
      explorerCount,
      scratchDir,
      totalLoc,
      totalFiles,
    } = scout.result;

    // Pull both scout transcripts ONCE at the workflow level so every
    // explorer + the aggregator can embed them in their prompts (F5). Both
    // stages have completed here (we're past Promise.all), so these reads
    // are safe (F13).
    const scoutOverview = (await ctx.transcript(scout)).content;
    const historyOverview = (await ctx.transcript(history)).content;

    // ── Stage 2: parallel explorers ────────────────────────────────────────
    // Each explorer is a separate OpenCode session, running concurrently via
    // Promise.all. Because the session is fresh (F5), every piece of context
    // it needs — question, architectural orientation, historical context,
    // partition assignment, scratch path — is injected into the first prompt
    // via buildExplorerPromptGeneric.
    const explorerHandles = await Promise.all(
      partitions.map((partition, idx) => {
        const i = idx + 1;
        const scratchPath = path.join(scratchDir, `explorer-${i}.md`);
        return ctx.stage(
          {
            name: `explorer-${i}`,
            description: `Explore ${partition
              .map((u) => u.path)
              .join(", ")} (${partition.reduce((s, u) => s + u.fileCount, 0)} files)`,
          },
          {},
          { title: `explorer-${i}` },
          async (s) => {
            const result = await s.client.session.prompt({
              sessionID: s.session.id,
              parts: [
                {
                  type: "text",
                  text: buildExplorerPromptGeneric({
                    question: prompt,
                    index: i,
                    total: explorerCount,
                    partition,
                    scoutOverview,
                    historyOverview,
                    scratchPath,
                    root,
                  }),
                },
              ],
            });
            s.save(result.data!);

            // Returning structured metadata lets the aggregator stage reach
            // each explorer's scratch path without re-parsing transcripts.
            return { index: i, scratchPath, partition };
          },
        );
      }),
    );

    // ── Stage 3: aggregator ────────────────────────────────────────────────
    // Reads explorer findings via FILE PATHS (filesystem-context skill) to
    // keep the aggregator's own context lean — we deliberately do NOT inline
    // N transcripts into the prompt. Token cost stays roughly constant in N.
    const finalPath = path.join(
      root,
      "research",
      "docs",
      `${isoDate}-${slug}.md`,
    );

    await ctx.stage(
      {
        name: "aggregator",
        description: "Synthesize explorer findings + history into final research doc",
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
                explorerFiles: explorerHandles.map((h) => h.result),
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
