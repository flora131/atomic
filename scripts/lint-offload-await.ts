#!/usr/bin/env bun
/// <reference types="bun" />
/**
 * Enforce await/catch/void discipline on offload-related async calls.
 *
 * Rule A  — registerSession must be awaited / .catch-chained / void-prefixed (executor.ts)
 * Rule A2 — requestResume must be awaited / .catch-chained / void-prefixed (executor.ts + components)
 * Rule B  — tmuxRun(["switch-client", …) must be preceded by getStatus/requestResume
 *            OR carry a `// offload-exempt: <reason>` annotation on the same or previous line.
 *
 * RFC: specs/2026-05-08-workflow-pane-offload-and-resume.md §5.5 / §8.3
 */

import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dir, "..");
export const EXECUTOR = join(
  REPO_ROOT,
  "packages",
  "atomic-sdk",
  "src",
  "runtime",
  "executor.ts",
);
export const COMPONENTS_GLOB = "packages/atomic-sdk/src/components/**/*.{ts,tsx}";

export interface Violation {
  file: string;
  line: number;
  text: string;
  rule: string;
}

/**
 * Rule A / A2 — a line containing `pattern` must be:
 *   • trimmed line starts with `await `
 *   • trimmed line starts with `void `
 *   • trimmed line starts with `//` (comment)
 *   • `.catch(` appears within the next 5 lines (inclusive)
 */
export function checkAwaitOrCatch(
  file: string,
  lines: string[],
  pattern: string,
  rule: string,
): Violation[] {
  const out: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed.includes(pattern)) continue;
    if (trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("await ")) continue;
    if (trimmed.startsWith("void ")) continue;
    const hasCatch = lines.slice(i, i + 6).some((l) => l.includes(".catch("));
    if (hasCatch) continue;
    out.push({ file, line: i + 1, text: trimmed, rule });
  }
  return out;
}

/**
 * Rule B — tmuxRun(["switch-client", …) must be either:
 *   • annotated with `// offload-exempt:` on the same line or the line above, OR
 *   • preceded (within 20 lines) by offloadManager.getStatus( or offloadManager.requestResume(
 */
export function checkSwitchClientGate(file: string, lines: string[]): Violation[] {
  const PATTERN = 'tmuxRun(["switch-client"';
  const out: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.includes(PATTERN)) continue;
    const sameLineExempt = raw.includes("// offload-exempt:");
    const prevLineExempt = i > 0 && (lines[i - 1] ?? "").includes("// offload-exempt:");
    if (sameLineExempt || prevLineExempt) continue;
    const window = lines.slice(Math.max(0, i - 20), i);
    if (
      window.some(
        (l) =>
          l.includes("offloadManager.getStatus(") ||
          l.includes("offloadManager.requestResume("),
      )
    )
      continue;
    out.push({ file, line: i + 1, text: raw.trim(), rule: "switch-client-gate" });
  }
  return out;
}

// ── Main (only runs when script is executed directly, not when imported) ───────

if (import.meta.main) {
  const violations: Violation[] = [];

  // Rule A — registerSession in executor.ts
  {
    let text = "";
    try {
      text = await Bun.file(EXECUTOR).text();
    } catch (err) {
      console.error(`lint-offload-await: cannot read ${EXECUTOR}: ${err}`);
      process.exit(2);
    }
    const lines = text.split("\n");
    violations.push(
      ...checkAwaitOrCatch(EXECUTOR, lines, "offloadManager.registerSession(", "registerSession-await"),
    );
  }

  // Rule A2 — requestResume across executor.ts + components
  {
    const componentFiles = Array.from(
      new Bun.Glob(COMPONENTS_GLOB).scanSync(REPO_ROOT),
    ).map((p) => join(REPO_ROOT, p));
    const targets = [EXECUTOR, ...componentFiles];
    for (const file of targets) {
      let text: string;
      try {
        text = await Bun.file(file).text();
      } catch {
        continue;
      }
      const lines = text.split("\n");
      violations.push(
        ...checkAwaitOrCatch(file, lines, "offloadManager.requestResume(", "requestResume-await"),
      );
    }
  }

  // Rule B — switch-client gate in components
  {
    for (const rel of new Bun.Glob(COMPONENTS_GLOB).scanSync(REPO_ROOT)) {
      const file = join(REPO_ROOT, rel);
      let text: string;
      try {
        text = await Bun.file(file).text();
      } catch {
        continue;
      }
      const lines = text.split("\n");
      violations.push(...checkSwitchClientGate(file, lines));
    }
  }

  if (violations.length > 0) {
    console.error("\nlint-offload-await: FAIL");
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file}:${v.line}  →  ${v.text}`);
    }
    console.error("\n  Fix per RFC §5.5 / §8.3:");
    console.error(
      "    • registerSession / requestResume must be awaited, .catch-chained, or `void`-prefixed.",
    );
    console.error(
      '    • tmuxRun(["switch-client", …]) must be preceded by an offloadManager.getStatus(...) / requestResume(...) check, or carry a `// offload-exempt: <reason>` comment.\n',
    );
    process.exit(1);
  }

  console.log("lint-offload-await: OK");
  process.exit(0);
}
