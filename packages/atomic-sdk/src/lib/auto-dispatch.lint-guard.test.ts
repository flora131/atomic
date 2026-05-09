import { test, expect } from "bun:test";
import path from "node:path";

const SOURCE_PATH = path.join(import.meta.dir, "auto-dispatch.ts");

test("ensureRuntimePluginSupport call is gated by sentinel check", async () => {
  const source = await Bun.file(SOURCE_PATH).text();

  const callOccurrences = source.split("ensureRuntimePluginSupport(").length - 1;
  expect(callOccurrences).toBe(1);

  const callIndex = source.indexOf("ensureRuntimePluginSupport(");
  expect(callIndex).toBeGreaterThanOrEqual(0);

  const sentinelIndex = source.indexOf("__opentuiCoreRuntimePluginSupportInstalled__");
  expect(sentinelIndex).toBeGreaterThanOrEqual(0);
  expect(sentinelIndex).toBeLessThan(callIndex);

  const guardIndex = source.indexOf("if (!alreadyInstalled)");
  expect(guardIndex).toBeGreaterThanOrEqual(0);
  expect(guardIndex).toBeLessThan(callIndex);
});

test("skip-path debug log is present exactly once", async () => {
  const source = await Bun.file(SOURCE_PATH).text();
  const occurrences = source.split(
    "[atomic-sdk:runtime-plugin] skipped install (already present)",
  ).length - 1;
  expect(occurrences).toBe(1);
});

test("no .test.ts file invokes Bun.build() against a fixture entry that imports @bastani/atomic-sdk/workflows", async () => {
  const workspaceRoot = path.resolve(import.meta.dir, "../../../..");
  const glob = new Bun.Glob("packages/atomic-sdk/src/**/*.test.ts");
  const violations: string[] = [];

  // Strip /* … */ block comments and // line comments so doc-comments that
  // discuss Bun.build() do not trigger false positives. Also strips string
  // literals to avoid catching the substring inside e.g. error messages —
  // a real `Bun.build(` call is a syntactic identifier, not a string.
  const stripCommentsAndStrings = (src: string): string =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  for await (const rel of glob.scan({ cwd: workspaceRoot })) {
    const testFile = path.join(workspaceRoot, rel);

    // Defensive: skip any .test.ts that somehow lives inside __fixtures__/
    if (testFile.includes("/__fixtures__/")) continue;

    const rawSource = await Bun.file(testFile).text();
    const codeOnly = stripCommentsAndStrings(rawSource);

    // Skip files that never call Bun.build( in actual code (not in comments
    // or string literals).
    if (!codeOnly.includes("Bun.build(")) continue;

    // Extract fixture paths referenced anywhere in the raw source (string
    // literals are fair game here — fixture paths only appear as strings).
    const fixtureRegex = /__fixtures__\/([\w.\-/]+\.ts)/g;
    let match: RegExpExecArray | null;
    while ((match = fixtureRegex.exec(rawSource)) !== null) {
      const captured = match[1];
      if (!captured) continue;
      const fixturePath = path.resolve(path.dirname(testFile), "__fixtures__", captured);

      let fixtureSource: string;
      try {
        fixtureSource = await Bun.file(fixturePath).text();
      } catch {
        // Fixture doesn't exist yet — skip silently
        continue;
      }

      if (
        fixtureSource.includes('from "@bastani/atomic-sdk/workflows"') ||
        fixtureSource.includes('import "@bastani/atomic-sdk/workflows"')
      ) {
        violations.push(`${testFile} → ${fixturePath}`);
      }
    }
  }

  expect(violations).toEqual([]);
});
