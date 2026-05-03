/**
 * Deterministic impeccable scan — runs the `impeccable detect --json` CLI
 * against a design directory and returns structured findings.
 *
 * No LLM call; the refinement loop surfaces these findings to the
 * apply-changes stage so the agent can fix banned anti-patterns
 * alongside user feedback.
 */

import { IMPECCABLE_SCAN_CMD } from "./constants.ts";

/** Shape of a single finding emitted by `impeccable detect --json`. */
export interface ScanFinding {
  readonly antipattern: string;
  readonly name: string;
  readonly description: string;
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
}

/**
 * Result of running the scanner. Discriminated on `available` so callers
 * can distinguish "ran successfully, no findings" from "scanner missing".
 */
export type ScanResult =
  | { readonly available: true; readonly findings: readonly ScanFinding[] }
  | { readonly available: false; readonly reason: string };

/**
 * Run `impeccable detect --json` against `designDir`. The CLI exits 0
 * whether or not findings exist, so we parse the JSON array and return
 * its length. If the CLI is missing or its output is not parseable,
 * return `{ available: false, reason }` so the caller can gracefully
 * proceed without scan input.
 */
export async function runImpeccableScan(
  designDir: string,
): Promise<ScanResult> {
  const [cmd, ...args] = IMPECCABLE_SCAN_CMD;
  const proc = Bun.spawn([cmd, ...args, designDir], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return {
      available: false,
      reason: `exit ${exitCode}: ${stderr.trim() || stdout.trim() || "no output"}`,
    };
  }

  const jsonStart = stdout.indexOf("[");
  const jsonEnd = stdout.lastIndexOf("]");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    return {
      available: false,
      reason: `could not locate JSON array in scanner output`,
    };
  }

  try {
    const parsed: unknown = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(parsed)) {
      return { available: false, reason: "scanner output was not a JSON array" };
    }
    return { available: true, findings: parsed as ScanFinding[] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, reason: `JSON parse failed: ${message}` };
  }
}

/**
 * Returns true iff the scanner ran successfully AND reported at least
 * one finding. Narrows the union so callers can access `findings`.
 */
export function hasBlockingFindings(
  scan: ScanResult,
): scan is { available: true; findings: readonly ScanFinding[] } {
  return scan.available && scan.findings.length > 0;
}

/**
 * Render findings as a human-readable block for inclusion in agent
 * prompts. Groups by anti-pattern id, lists each file:line with snippet.
 */
export function renderScanFindings(
  findings: readonly ScanFinding[],
): string {
  if (findings.length === 0) return "";

  const grouped = new Map<string, ScanFinding[]>();
  for (const f of findings) {
    const bucket = grouped.get(f.antipattern) ?? [];
    bucket.push(f);
    grouped.set(f.antipattern, bucket);
  }

  const sections: string[] = [];
  for (const [antipattern, items] of grouped) {
    const header = `### ${items[0]!.name} (${antipattern}) — ${items.length} occurrence(s)`;
    const description = items[0]!.description;
    const locations = items
      .map((f) => `  - ${f.file}:${f.line} — \`${f.snippet}\``)
      .join("\n");
    sections.push(`${header}\n${description}\n${locations}`);
  }

  return sections.join("\n\n");
}
