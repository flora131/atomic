/**
 * Shared masking + guard utilities used by Ralph and deep-research-codebase.
 *
 * Keep every function here **pure** (no I/O except the explicit session
 * wrappers) so they can be unit-tested with `bun test` without spinning
 * up SDK clients.
 */

import {
  CHANGESET_MASK_THRESHOLD,
  DIFF_STAT_TOP_N,
  HISTORY_BRIEF_MAX_WORDS,
  MAX_DEBUGGER_REPORT_CHARS,
  UNCOMMITTED_STAGED_TOP_N,
} from "./budget.ts";

// ============================================================================
// CHANGESET MASKING
// ============================================================================

export interface BranchChangeset {
  baseBranch: string;
  diffStat: string;
  uncommitted: string;
  nameStatus: string;
  errors: string[];
}

/**
 * Compact a large branch changeset while preserving correctness-critical
 * signal. The key invariant is that **untracked files** (`??` entries in
 * `git status -s`) only ever appear in the `uncommitted` field, because
 * `git diff --stat` doesn't surface them. Wholesale dropping `uncommitted`
 * on later iterations would hide brand-new untracked source/test files
 * from the reviewer — a silent correctness regression.
 */
export function maskChangeset(cs: BranchChangeset): BranchChangeset {
  const total =
    cs.diffStat.length + cs.uncommitted.length + cs.nameStatus.length;
  if (total <= CHANGESET_MASK_THRESHOLD) return cs;

  return {
    ...cs,
    diffStat: compactDiffStat(cs.diffStat),
    uncommitted: compactUncommitted(cs.uncommitted),
    // nameStatus is authoritative + cheap — leave verbatim.
  };
}

export function compactDiffStat(diffStat: string): string {
  if (!diffStat.trim()) return diffStat;
  const lines = diffStat.split("\n");
  const fileLines: { raw: string; churn: number }[] = [];
  const summaryLines: string[] = [];

  for (const line of lines) {
    if (/\d+\s+files?\s+changed/.test(line)) {
      summaryLines.push(line);
      continue;
    }
    const match = line.match(/\|\s*(\d+)/);
    if (!match || !match[1]) continue;
    fileLines.push({ raw: line, churn: parseInt(match[1], 10) });
  }

  if (fileLines.length <= DIFF_STAT_TOP_N) return diffStat;

  fileLines.sort((a, b) => b.churn - a.churn);
  const kept = fileLines.slice(0, DIFF_STAT_TOP_N);
  const elided = fileLines.length - kept.length;

  const parts = [
    ...kept.map((f) => f.raw),
    ` … ${elided} additional files elided by masker …`,
    ...summaryLines,
  ];
  return parts.join("\n");
}

export function compactUncommitted(uncommitted: string): string {
  if (!uncommitted.trim()) return uncommitted;
  const lines = uncommitted.split("\n").filter((l) => l.length > 0);
  const untracked: string[] = [];
  const others: string[] = [];

  for (const line of lines) {
    if (line.startsWith("?? ")) untracked.push(line);
    else others.push(line);
  }

  if (others.length <= UNCOMMITTED_STAGED_TOP_N) return uncommitted;

  const keptOthers = others.slice(0, UNCOMMITTED_STAGED_TOP_N);
  const elidedOthers = others.length - keptOthers.length;
  const summary = ` … ${elidedOthers} additional staged/modified entries elided (all untracked entries retained) …`;

  return [...untracked, ...keptOthers, summary].join("\n");
}

// ============================================================================
// INFRA-DISCOVERY INVALIDATION
// ============================================================================

const INFRA_PATH_PATTERNS: RegExp[] = [
  // Manifests
  /(^|\/)package\.json$/,
  /(^|\/)pyproject\.toml$/,
  /(^|\/)Cargo\.toml$/,
  /(^|\/)go\.mod$/,
  /(^|\/)Gemfile$/,
  /(^|\/)composer\.json$/,
  // Lockfiles
  /(^|\/)bun\.lockb?$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)go\.sum$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)uv\.lock$/,
  /(^|\/)poetry\.lock$/,
  // Build configs
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)vite\.config\.[cm]?[jt]sx?$/,
  /(^|\/)esbuild\.(config|mjs|js)[^/]*$/,
  /(^|\/)webpack\.config\.[cm]?[jt]sx?$/,
  /(^|\/)rollup\.config\.[cm]?[jt]sx?$/,
  /(^|\/)Makefile$/,
  // Test configs
  /(^|\/)(vitest|jest|playwright)\.config\.[cm]?[jt]sx?$/,
  /(^|\/)\.mocharc\.[^/]+$/,
  /(^|\/)pytest\.ini$/,
  /(^|\/)tox\.ini$/,
  // Lint/format configs
  /(^|\/)\.eslintrc(\.[^/]+)?$/,
  /(^|\/)eslint\.config\.[cm]?[jt]sx?$/,
  /(^|\/)biome\.json$/,
  /(^|\/)\.prettierrc(\.[^/]+)?$/,
  /(^|\/)oxlint\.json$/,
  /(^|\/)\.editorconfig$/,
  // CI
  /^\.github\/workflows\//,
  /^\.gitlab-ci\.yml$/,
  /^Jenkinsfile$/,
  /^\.circleci\//,
  /^\.buildkite\//,
  // Agent instructions
  /(^|\/)CLAUDE\.md$/,
  /(^|\/)AGENTS\.md$/,
  /^\.claude\//,
  /^\.opencode\//,
  /^\.github\/copilot-instructions\.md$/,
  /^\.github\/agents\//,
  /^\.agents\//,
];

export function isInfraPath(path: string): boolean {
  return INFRA_PATH_PATTERNS.some((re) => re.test(path));
}

function parseNameStatus(nameStatus: string): string[] {
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

function parseStatusS(statusS: string): string[] {
  const paths: string[] = [];
  for (const line of statusS.split("\n")) {
    if (line.length < 4) continue;
    const rest = line.slice(3);
    const renameMatch = rest.match(/^(.+)\s->\s(.+)$/);
    if (renameMatch && renameMatch[2]) {
      paths.push(renameMatch[2].trim());
    } else {
      paths.push(rest.trim());
    }
  }
  return paths;
}

export function infraInvalidationPaths(cs: BranchChangeset): string[] {
  const touched = new Set<string>([
    ...parseNameStatus(cs.nameStatus),
    ...parseStatusS(cs.uncommitted),
  ]);
  const hits: string[] = [];
  for (const p of touched) {
    if (isInfraPath(p)) hits.push(p);
  }
  return hits;
}

export function shouldReRunInfraDiscovery(cs: BranchChangeset): boolean {
  return infraInvalidationPaths(cs).length > 0;
}

// ============================================================================
// MARKDOWN-REPORT TRUNCATION
// ============================================================================

export function truncateMarkdownReport(
  content: string,
  maxChars: number = MAX_DEBUGGER_REPORT_CHARS,
): string {
  if (content.length <= maxChars) return content;
  const headLen = Math.floor(maxChars * 0.6);
  const tailLen = maxChars - headLen - 128;
  const elided = content.length - headLen - tailLen;
  const head = content.slice(0, headLen);
  const tail = content.slice(-tailLen);
  return (
    head +
    `\n\n[… truncated ${elided} chars by truncateMarkdownReport — original was ${content.length} chars …]\n\n` +
    tail
  );
}

// ============================================================================
// HISTORY BRIEF (deep-research)
// ============================================================================

export function deriveHistoryBrief(
  historyOverview: string,
  maxWords: number = HISTORY_BRIEF_MAX_WORDS,
): string {
  const trimmed = historyOverview.trim();
  if (!trimmed) return "";

  const synthMatch = trimmed.match(/###\s+Synthesis\s*\n([\s\S]*?)(?=\n###\s|$)/);
  const src = synthMatch?.[1]?.trim() || trimmed;

  const words = src.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return src;
  return words.slice(0, maxWords).join(" ") + " …";
}

// ============================================================================
// COMPACT REMINDER
// ============================================================================

export function compactReminder(opts: {
  intent: string;
  iteration?: number;
  extra?: string;
}): string {
  const parts: string[] = [];
  if (opts.iteration !== undefined) parts.push(`iteration ${opts.iteration}`);
  parts.push(opts.intent.trim().replace(/\s+/g, " ").slice(0, 200));
  if (opts.extra) parts.push(opts.extra);
  return parts.join(" | ");
}

// ============================================================================
// PROSE GUARD (specialist transcript retry)
// ============================================================================

export interface ProseGuardOpts<T> {
  query: () => Promise<T>;
  getText: (result: T) => string;
  retry: () => Promise<T>;
}

export async function queryWithProseGuard<T>(
  opts: ProseGuardOpts<T>,
): Promise<{ text: string; attempts: 1 | 2 }> {
  const first = await opts.query();
  const firstText = opts.getText(first);
  if (firstText.trim().length > 0) return { text: firstText, attempts: 1 };
  const second = await opts.retry();
  return { text: opts.getText(second), attempts: 2 };
}

export const PROSE_GUARD_RETRY_PROMPT =
  "Emit the required prose summary now — do not end on a tool call. " +
  "A short markdown report following the earlier output format is sufficient.";
