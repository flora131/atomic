/**
 * G2 Validation Gate — RFC §8.3
 *
 * Asserts that no .ts or .tsx source file is imported via
 * `with { type: "file" }` outside the designated runtime-scripts directory.
 *
 * Importing a .ts module path as a file asset creates a dual-identity bug:
 * the module is both compiled into the bundle AND embedded as a raw file copy,
 * causing divergent runtime behaviour.
 *
 * Allowlist:
 *   - Files inside packages/{pkg}/src/lib/runtime-scripts/ (intentional asset copies)
 *   - Test files (*.test.ts / *.test.tsx)
 */

import { test, expect } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");

/** Matches the with { type: "file" } assertion (double or single quotes). */
const FILE_ASSERT_RE = /with\s*\{\s*type\s*:\s*['"]file['"]\s*\}/;

/** Extracts the quoted import source from an import declaration line. */
const IMPORT_SOURCE_RE = /from\s+['"]([^'"]+)['"]/;

/** Returns true when a repo-relative path should be skipped. */
function isAllowlisted(repoRelPath: string): boolean {
  if (repoRelPath.includes("/lib/runtime-scripts/")) return true;
  if (repoRelPath.endsWith(".test.ts") || repoRelPath.endsWith(".test.tsx")) return true;
  return false;
}

/**
 * Returns true when the import source path is an intentional file asset.
 * Imports from runtime-scripts/ are build-generated copies, not module-compiled
 * sources — they are explicitly allowed as file assets.
 */
function isAllowlistedImportSource(importSource: string): boolean {
  return importSource.includes("runtime-scripts/");
}

type Violation = { file: string; line: number; importSource: string };

/**
 * Given lines of a file and the index of the file-asset assertion line,
 * finds the import source path.  Checks the same line first (single-line
 * imports), then walks backward up to 5 lines for multi-line imports.
 * Returns null if no import source found.
 */
function resolveImportSource(lines: string[], assertLineIdx: number): string | null {
  // Check the assertion line itself first (handles single-line imports)
  const sameLine = IMPORT_SOURCE_RE.exec(lines[assertLineIdx]);
  if (sameLine) return sameLine[1];

  // Multi-line import: walk backward to find the `from "..."` clause
  const WINDOW = 5;
  const start = Math.max(0, assertLineIdx - WINDOW);
  for (let i = assertLineIdx - 1; i >= start; i--) {
    const m = IMPORT_SOURCE_RE.exec(lines[i]);
    if (m) return m[1];
    // Stop as soon as we hit the import keyword line
    if (lines[i].trimStart().startsWith("import ")) break;
  }
  return null;
}

async function collectViolations(): Promise<Violation[]> {
  const violations: Violation[] = [];

  const globs = [
    "packages/atomic/src/**/*.ts",
    "packages/atomic/src/**/*.tsx",
    "packages/atomic-sdk/src/**/*.ts",
    "packages/atomic-sdk/src/**/*.tsx",
  ];

  for (const pattern of globs) {
    const glob = new Glob(pattern);
    for await (const relPath of glob.scan({ cwd: REPO_ROOT })) {
      if (isAllowlisted(relPath)) continue;

      const absPath = join(REPO_ROOT, relPath);
      const content = readFileSync(absPath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (!FILE_ASSERT_RE.test(lines[i])) continue;

        const importSource = resolveImportSource(lines, i);
        if (!importSource) continue;

        if (
          (importSource.endsWith(".ts") || importSource.endsWith(".tsx")) &&
          !isAllowlistedImportSource(importSource)
        ) {
          violations.push({ file: relPath, line: i + 1, importSource });
        }
      }
    }
  }

  return violations;
}

test("G2: no .ts/.tsx file imported as a file asset outside runtime-scripts", async () => {
  const violations = await collectViolations();

  if (violations.length === 0) {
    expect(violations).toEqual([]);
    return;
  }

  const descLines = violations.map(
    (v) => `  ${v.file}:${v.line}: "${v.importSource}" imported with { type: "file" }`,
  );

  const message = [
    `Found ${violations.length} .ts/.tsx file(s) imported as raw file assets.`,
    "A module-compiled .ts MUST NOT also be imported as a file asset.",
    'Move the script to packages/atomic-sdk/src/lib/runtime-scripts/ if it is',
    "intentionally embedded as a raw file, then re-import from there.",
    "",
    ...descLines,
  ].join("\n");

  expect(violations, message).toEqual([]);
});
