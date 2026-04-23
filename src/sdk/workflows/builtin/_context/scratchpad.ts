/**
 * Ralph per-run scratchpad.
 *
 * Persistent markdown artifact at `.atomic/ralph/<session-id>/state.md`.
 * Survives every iteration of the plan → orchestrate → review → debug loop
 * so the next-iteration planner can see the full prior-design history,
 * cumulative files modified, rejected approaches, and open questions —
 * rather than re-deriving them from just the latest debugger report.
 *
 * **Single-writer discipline:** all appenders run inside the outer
 * `.run()` callback AFTER each stage resolves. Never append from inside
 * a headless fan-out — that re-introduces race conditions.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ScratchpadHandle = {
  filePath: string;
  dir: string;
  sessionId: string;
};

export async function initScratchpad(opts: {
  sessionId: string;
  projectRoot: string;
  originalSpec: string;
}): Promise<ScratchpadHandle> {
  const dir = path.join(opts.projectRoot, ".atomic", "ralph", opts.sessionId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "state.md");

  try {
    await readFile(filePath, "utf8");
  } catch {
    const seed = [
      `# Ralph Run State (session \`${opts.sessionId}\`)`,
      ``,
      `_Persistent scratchpad shared across all iterations. Written only by_`,
      `_the outer \`.run()\` callback — single-writer discipline._`,
      ``,
      `## Session Intent`,
      opts.originalSpec.trim(),
      ``,
      `## Prior Spec Path`,
      `_(set if the planner short-circuited to a file path)_`,
      ``,
      `## Prior RFCs`,
      `_(append-only, newest last; each wrapped in a \`\`\`markdown block)_`,
      ``,
      `## Files Modified`,
      `_(cumulative, deduped by repo-relative path)_`,
      ``,
      `## Decisions Made`,
      ``,
      `## Rejected Approaches`,
      ``,
      `## Open Questions`,
      ``,
      `## Debugger Reports`,
      `_(one per iteration that produced findings)_`,
      ``,
    ].join("\n");
    await writeFile(filePath, seed, "utf8");
  }

  return { filePath, dir, sessionId: opts.sessionId };
}

export async function readScratchpad(h: ScratchpadHandle): Promise<string> {
  return readFile(h.filePath, "utf8");
}

/**
 * Heuristic: matches the `Spec Path Short-Circuit` contract defined in
 * `ralph/helpers/prompts.ts`. Returns trimmed path or null.
 */
export function detectSpecPath(plannerOutput: string): string | null {
  const trimmed = plannerOutput.trim();
  if (!trimmed) return null;
  if (/\n/.test(trimmed)) return null;
  const looksLikePath =
    /^(\/|\.\/|~\/)/.test(trimmed) ||
    /\.(md|txt|rst|adoc|org)$/i.test(trimmed);
  return looksLikePath ? trimmed : null;
}

export async function recordPlannerOutput(
  h: ScratchpadHandle,
  iteration: number,
  plannerOutput: string,
): Promise<void> {
  const pathLike = detectSpecPath(plannerOutput);
  const current = await readScratchpad(h);

  if (pathLike) {
    const updated = replaceSection(
      current,
      "Prior Spec Path",
      `\`${pathLike}\` _(from iteration ${iteration})_`,
    );
    await writeFile(h.filePath, updated, "utf8");
    return;
  }

  const block = [
    `### Iteration ${iteration}`,
    "```markdown",
    plannerOutput.trim(),
    "```",
  ].join("\n");
  const updated = appendToSection(current, "Prior RFCs", block);
  await writeFile(h.filePath, updated, "utf8");
}

export async function recordDebuggerReport(
  h: ScratchpadHandle,
  iteration: number,
  report: string,
): Promise<void> {
  const current = await readScratchpad(h);
  const block = [
    `### Iteration ${iteration}`,
    "```markdown",
    report.trim(),
    "```",
  ].join("\n");
  const updated = appendToSection(current, "Debugger Reports", block);
  await writeFile(h.filePath, updated, "utf8");
}

export async function recordFilesModified(
  h: ScratchpadHandle,
  iteration: number,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const current = await readScratchpad(h);
  const existing = extractSection(current, "Files Modified")
    .split("\n")
    .map((l) => l.match(/^- `([^`]+)`/)?.[1])
    .filter((p): p is string => !!p);
  const set = new Set(existing);
  const added: string[] = [];
  for (const p of paths) {
    if (!set.has(p)) {
      set.add(p);
      added.push(p);
    }
  }
  if (added.length === 0) return;
  const newBody = [...set]
    .map((p) => `- \`${p}\``)
    .concat([`  _(iteration ${iteration} added ${added.length})_`])
    .join("\n");
  const updated = replaceSection(current, "Files Modified", newBody);
  await writeFile(h.filePath, updated, "utf8");
}

export async function latestPriorRFC(
  h: ScratchpadHandle,
): Promise<string | null> {
  const current = await readScratchpad(h);
  const body = extractSection(current, "Prior RFCs");
  const blocks = [...body.matchAll(/```markdown\s*\n([\s\S]*?)\n```/g)];
  const last = blocks[blocks.length - 1]?.[1]?.trim();
  return last && last.length > 0 ? last : null;
}

export async function priorSpecPath(
  h: ScratchpadHandle,
): Promise<string | null> {
  const current = await readScratchpad(h);
  const body = extractSection(current, "Prior Spec Path");
  const match = body.match(/`([^`]+)`/);
  return match?.[1] ?? null;
}

// ============================================================================
// SECTION UTILITIES
// ============================================================================

export function extractSection(content: string, name: string): string {
  const re = new RegExp(
    `(^|\\n)##\\s+${escapeRe(name)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
  );
  const match = content.match(re);
  return match?.[2]?.trim() ?? "";
}

export function replaceSection(
  content: string,
  name: string,
  newBody: string,
): string {
  const re = new RegExp(
    `((^|\\n)##\\s+${escapeRe(name)}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`,
  );
  if (re.test(content)) {
    return content.replace(re, `$1${newBody}\n`);
  }
  const suffix = content.endsWith("\n") ? "" : "\n";
  return `${content}${suffix}\n## ${name}\n${newBody}\n`;
}

export function appendToSection(
  content: string,
  name: string,
  block: string,
): string {
  const existing = extractSection(content, name);
  const body = existing ? `${existing}\n\n${block}` : block;
  return replaceSection(content, name, body);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
