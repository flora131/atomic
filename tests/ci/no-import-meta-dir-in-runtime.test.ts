/**
 * G1 Validation Gate — RFC §8.3
 *
 * Asserts that runtime CLI source files do not perform path arithmetic against
 * `import.meta.dir` or call `findRepoRoot`. These patterns return incorrect
 * paths inside a `bun build --compile` binary.
 *
 * What's banned:
 *  - `join(import.meta.dir, …)`, `resolve(import.meta.dir, …)`
 *  - `import.meta.dir + …`, `${import.meta.dir}`
 *  - any reference to `findRepoRoot` (build-script-only helper)
 *
 * What's allowed (runtime-detection only):
 *  - bare `import.meta.dir` reads passed to detection helpers, e.g.
 *    `isInstalledPackage(import.meta.dir)`
 *  - default parameter values, e.g. `runtimeDir = import.meta.dir`
 *
 * Allowlisted files (permitted to do path arithmetic / define helpers):
 *  - packages/atomic/script/**, packages/atomic-sdk/script/**
 *  - packages/atomic/src/lib/workspace-paths.ts (canonical findRepoRoot site)
 *  - packages/atomic-sdk/src/lib/workspace-paths.ts (dev-only helpers)
 *  - any *.test.ts / *.test.tsx
 */

import { test, expect } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");

/** Path-arithmetic patterns forbidden in runtime CLI source. */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  { regex: /\bjoin\s*\(\s*import\.meta\.dir\b/,    label: "join(import.meta.dir, …)" },
  { regex: /\bresolve\s*\(\s*import\.meta\.dir\b/, label: "resolve(import.meta.dir, …)" },
  { regex: /\bimport\.meta\.dir\s*\+/,             label: "import.meta.dir + …" },
  { regex: /\$\{import\.meta\.dir\}/,              label: "${import.meta.dir}" },
  { regex: /\bfindRepoRoot\b/,                     label: "findRepoRoot" },
];

const ALLOWLISTED_FILES: ReadonlyArray<string> = [
  "packages/atomic/src/lib/workspace-paths.ts",
  "packages/atomic-sdk/src/lib/workspace-paths.ts",
];

/** Returns true when a repo-relative path should be skipped. */
function isAllowlisted(repoRelPath: string): boolean {
  if (repoRelPath.includes("packages/atomic/script/")) return true;
  if (repoRelPath.includes("packages/atomic-sdk/script/")) return true;
  if (ALLOWLISTED_FILES.some((p) => repoRelPath.endsWith(p))) return true;
  if (repoRelPath.endsWith(".test.ts") || repoRelPath.endsWith(".test.tsx")) return true;
  return false;
}

type Violation = { file: string; line: number; matched: string };

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
        const line = lines[i];
        if (line === undefined) continue;
        const trimmed = line.trimStart();
        // Skip comment lines — we care about live code, not documentation.
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
        for (const { regex, label } of FORBIDDEN_PATTERNS) {
          if (regex.test(line)) {
            violations.push({ file: relPath, line: i + 1, matched: label });
          }
        }
      }
    }
  }

  return violations;
}

test("G1: no import.meta.dir path arithmetic or findRepoRoot in runtime CLI source", async () => {
  const violations = await collectViolations();

  if (violations.length === 0) {
    expect(violations).toEqual([]);
    return;
  }

  const lines = violations.map(
    (v) => `  ${v.file}:${v.line}: "${v.matched}"`,
  );

  const message = [
    `Found ${violations.length} forbidden pattern(s) in runtime source.`,
    "These patterns break path resolution inside `bun build --compile` binaries.",
    "Move path logic to packages/atomic/src/lib/workspace-paths.ts or use",
    "`with { type: 'file' }` asset imports instead.",
    "",
    ...lines,
  ].join("\n");

  expect(violations, message).toEqual([]);
});
