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

import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { PartitionUnit } from "./scout.ts";

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
