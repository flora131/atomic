/**
 * deep-research-codebase / claude
 *
 * A deterministically-orchestrated, distributed version of the
 * `research-codebase` skill. The research-codebase skill spawns
 * codebase-locator / codebase-analyzer / codebase-pattern-finder /
 * codebase-research-locator / codebase-research-analyzer /
 * codebase-online-researcher sub-agents on the fly via LLM judgment;
 * this workflow spawns the same agents on a deterministic schedule
 * driven by the codebase's lines of code.
 *
 * Topology:
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
 * Stage 1a — codebase-scout
 *   Pure-TypeScript: lists files (git ls-files), counts LOC (batched wc -l),
 *   renders a depth-bounded ASCII tree, and bin-packs directories into N
 *   partitions where N is determined by the LOC heuristic. Then makes one
 *   short LLM call to produce an architectural orientation that primes the
 *   downstream explorers. Returns structured data via `handle.result` and
 *   the agent's prose via `ctx.transcript(handle)`.
 *
 * Stage 1b — research-history (parallel sibling of scout)
 *   Dispatches the codebase-research-locator and codebase-research-analyzer
 *   sub-agents over the project's existing research/ directory to surface
 *   prior decisions, completed investigations, and unresolved questions.
 *   Output is consumed via session transcript (≤400 words) and feeds into
 *   the aggregator as supplementary context.
 *
 * Stage 2 — explorer-1..N (parallel; depends on scout + history)
 *   Each explorer is a coordinator that dispatches specialized sub-agents
 *   over its assigned partition (single LOC-balanced slice of the codebase):
 *     - codebase-locator       → finds relevant files in the partition
 *     - codebase-analyzer      → documents how the most relevant files work
 *     - codebase-pattern-finder → finds existing pattern examples
 *     - codebase-online-researcher → (conditional) external library docs
 *   The explorer never reads files directly — it orchestrates specialists
 *   and writes a synthesized findings document to a known scratch path.
 *
 * Stage 3 — aggregator
 *   Reads each explorer's scratch file by path (file-based handoff to keep
 *   the aggregator's own context lean — we deliberately do NOT inline N
 *   transcripts into the prompt). Folds in the research-history overview
 *   as supplementary context. Synthesizes a single research document at
 *   research/docs/YYYY-MM-DD-<slug>.md.
 *
 * Context-engineering decisions are documented at each stage below.
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
  buildExplorerPrompt,
  buildHistoryPrompt,
  buildScoutPrompt,
  slugifyPrompt,
} from "../helpers/prompts.ts";

// ── Idle detection ─────────────────────────────────────────────────────────
// Completion is detected by watching the session JSONL file for idle and result
// events from Claude's own SDK — no manual timeout is needed. The loop runs
// until Claude reports idle or a result (success, error_max_turns, etc.).

export default defineWorkflow({
    name: "deep-research-codebase",
    description:
      "Deterministic deep codebase research: scout → LOC-driven parallel explorers → aggregator",
    inputs: [
      { name: "prompt", type: "text", required: true, description: "research question" },
    ],
  })
  .for<"claude">()
  .run(async (ctx) => {
    // Destructure once so every stage below can close over a bare
    // `prompt` string without re-reaching into ctx.inputs.
    const prompt = ctx.inputs.prompt ?? "";
    const root = getCodebaseRoot();
    const startedAt = new Date();
    const isoDate = startedAt.toISOString().slice(0, 10);
    const slug = slugifyPrompt(prompt);

    // ── Stages 1a + 1b: codebase-scout ∥ research-history ──────────────────
    // Run the codebase scout (deterministic compute + brief LLM orientation)
    // in parallel with the research-history scout (sub-agent dispatch over
    // the project's prior research docs). Both must complete before any
    // explorer starts, since:
    //   - explorers depend on `scout.result.partitions`
    //   - aggregator depends on the history transcript
    // Promise.all gives us the cleanest auto-inferred graph topology:
    // parent → [scout, history] → [explorer-1..N] → aggregator.
    const [scout, history] = await Promise.all([
      ctx.stage(
        {
          name: "codebase-scout",
          description: "Map codebase, count LOC, partition for parallel explorers",
        },
        {},
        {},
        async (s) => {
          // 1. Deterministic scouting.
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
          //    explorers. The prompt explicitly forbids the agent from
          //    answering the research question — its only job here is to
          //    orient.
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
      ctx.stage(
        {
          name: "research-history",
          description: "Surface prior research via research-locator + research-analyzer",
        },
        {},
        {},
        async (s) => {
          // Dispatches codebase-research-locator → codebase-research-analyzer
          // over the project's research/ directory and outputs a ≤400-word
          // synthesis as prose (no file write — consumed via transcript).
          await s.session.query(
            buildHistoryPrompt({ question: prompt, root }),
          );
          s.save(s.sessionId);
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
    // explorer + the aggregator can embed them in their prompts. Both
    // stages have already completed by this point (we're past Promise.all),
    // so these reads are safe (F13).
    const scoutOverview = (await ctx.transcript(scout)).content;
    const historyOverview = (await ctx.transcript(history)).content;

    // ── Stage 2: parallel explorers ────────────────────────────────────────
    // Each explorer is a separate tmux pane / Claude session, running
    // concurrently via Promise.all. Each one receives:
    //   - the original research question (top + bottom of prompt)
    //   - the scout's architectural overview
    //   - its OWN partition (never the full file list)
    //   - the absolute path to its scratch file
    //
    // Information flow choices:
    //   • We deliberately do not pass other explorers' work — they run in
    //     parallel and forward-only data flow is enforced by the runtime
    //     (F13). Cross-cutting happens in the aggregator.
    //   • We pass the partition via closure capture, not by parsing
    //     scout transcripts — strongly typed and lossless.
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
          {},
          async (s) => {
            await s.session.query(
              buildExplorerPrompt({
                question: prompt,
                index: i,
                total: explorerCount,
                partition,
                scoutOverview,
                scratchPath,
                root,
              }),
            );
            s.save(s.sessionId);

            // Returning structured metadata lets the aggregator stage reach
            // each explorer's scratch path without re-parsing transcripts.
            return { index: i, scratchPath, partition };
          },
        );
      }),
    );

    // ── Stage 3: aggregator ────────────────────────────────────────────────
    // Synthesizes explorer findings into the final research document at
    // research/docs/YYYY-MM-DD-<slug>.md.
    //
    // Information flow choice:
    //   • The aggregator reads explorer findings via FILE PATHS, not by
    //     embedding all N transcripts in its prompt. This keeps its
    //     context lean (filesystem-context skill) and lets the agent
    //     selectively re-read source files when explorers contradict
    //     each other.
    //   • The aggregator only sees the scout overview (short) plus a
    //     manifest of explorer scratch paths — token cost stays roughly
    //     constant in N rather than growing linearly.
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
      {},
      async (s) => {
        await s.session.query(
          buildAggregatorPrompt({
            question: prompt,
            totalLoc,
            totalFiles,
            explorerCount,
            explorerFiles: explorerHandles.map((h) => h.result),
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
