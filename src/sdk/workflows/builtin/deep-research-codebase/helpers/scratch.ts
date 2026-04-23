/**
 * Deterministic synthesis of per-partition explorer scratch files.
 *
 * Each partition is investigated by four specialist sub-agents dispatched
 * directly via the provider SDK's `agent` parameter:
 *
 *   - codebase-locator           → file index for the partition
 *   - codebase-pattern-finder    → reusable code patterns in the partition
 *   - codebase-analyzer          → how the most relevant impl files work
 *   - codebase-online-researcher → external library docs (when central)
 *
 * Rather than spawn a fifth "synthesizer" LLM stage just to concatenate four
 * markdown sections, we do that synthesis in plain TypeScript here. This keeps
 * the per-partition cost at exactly four LLM calls and avoids burning tokens
 * on a step whose output is fully determined by its inputs.
 *
 * The file we write is the canonical handoff to the aggregator — it MUST keep
 * the heading shape that buildAggregatorPrompt() promises ("Scope / Files in
 * Scope / How It Works / Patterns / External References / Out-of-Partition
 * References"), or the aggregator will look for sections that don't exist.
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PartitionUnit } from "./scout.ts";
import {
  compactScratchFile,
  SCRATCH_COMPACT_THRESHOLD,
} from "../../_context/index.ts";

export type ExplorerSections = {
  index: number;
  total: number;
  partition: PartitionUnit[];
  /** Full assistant text from the codebase-locator sub-agent. */
  locatorOutput: string;
  /** Full assistant text from the codebase-pattern-finder sub-agent. */
  patternsOutput: string;
  /** Full assistant text from the codebase-analyzer sub-agent. */
  analyzerOutput: string;
  /** Full assistant text from the codebase-online-researcher sub-agent. */
  onlineOutput: string;
};

/** Heuristic: detect the "no external research applicable" sentinel. */
function isOnlineSkip(output: string): boolean {
  return /\(\s*no external research applicable\s*\)/i.test(output);
}

/** Render the markdown body deterministically. */
export function renderExplorerMarkdown(sections: ExplorerSections): string {
  const scope = sections.partition
    .map(
      (u) =>
        `\`${u.path}/\` (${u.fileCount} files, ${u.loc.toLocaleString()} LOC)`,
    )
    .join(", ");

  const lines: string[] = [
    `# Partition ${sections.index} of ${sections.total} — Findings`,
    ``,
    `## Scope`,
    scope,
    ``,
    `## Files in Scope`,
    `<!-- Source: codebase-locator sub-agent -->`,
    sections.locatorOutput.trim() || "_(no files located)_",
    ``,
    `## How It Works`,
    `<!-- Source: codebase-analyzer sub-agent -->`,
    sections.analyzerOutput.trim() || "_(no analysis produced)_",
    ``,
    `## Patterns`,
    `<!-- Source: codebase-pattern-finder sub-agent -->`,
    sections.patternsOutput.trim() || "_(no patterns surfaced)_",
    ``,
  ];

  // Only include the External References section when the online researcher
  // actually returned external findings — its skip sentinel would otherwise
  // pollute the aggregator's view of "evidence collected".
  if (
    sections.onlineOutput.trim().length > 0 &&
    !isOnlineSkip(sections.onlineOutput)
  ) {
    lines.push(
      `## External References`,
      `<!-- Source: codebase-online-researcher sub-agent -->`,
      sections.onlineOutput.trim(),
      ``,
    );
  }

  // Out-of-partition references live in the analyzer output already, but we
  // surface a brief pointer for the aggregator's cross-stitching pass.
  lines.push(
    `## Out-of-Partition References`,
    `Look for the **Out-of-Partition References** subsection inside the`,
    `"How It Works" section above — that is where the analyzer flagged files`,
    `outside this partition that other partitions should examine.`,
    ``,
  );

  return lines.join("\n");
}

/**
 * Write a partition's deterministic scratch file. Returns the absolute path so
 * the caller can record it in the explorer manifest the aggregator reads.
 */
export async function writeExplorerScratchFile(
  scratchPath: string,
  sections: ExplorerSections,
): Promise<string> {
  const abs = path.resolve(scratchPath);
  const md = renderExplorerMarkdown(sections);
  await writeFile(abs, md, "utf8");
  return abs;
}

/**
 * D3: aggregator pre-flight compaction. If the **sum** of scratch file
 * sizes exceeds `SCRATCH_COMPACT_THRESHOLD`, each file is rewritten using
 * `compactScratchFile` so the aggregator can read them without overflowing
 * its effective context window. Heading schema is preserved verbatim, so
 * the aggregator's reading contract still holds.
 *
 * Returns the list of paths actually compacted (empty when the run was
 * under threshold), so callers can log it.
 */
export async function compactScratchFilesForAggregator(
  paths: string[],
  threshold: number = SCRATCH_COMPACT_THRESHOLD,
): Promise<string[]> {
  const sizes = await Promise.all(
    paths.map(async (p) => {
      try {
        return (await stat(p)).size;
      } catch {
        return 0;
      }
    }),
  );
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= threshold) return [];

  // Per-file budget: divide threshold across N files, leaving a 10% headroom
  // for headings + delimiters the aggregator emits between sections.
  const perFileBudget = Math.floor((threshold * 0.9) / Math.max(1, paths.length));

  const compacted: string[] = [];
  await Promise.all(
    paths.map(async (p, i) => {
      if ((sizes[i] ?? 0) <= perFileBudget) return;
      const content = await readFile(p, "utf8");
      const next = compactScratchFile(content, perFileBudget);
      await writeFile(p, next, "utf8");
      compacted.push(p);
    }),
  );
  return compacted;
}
