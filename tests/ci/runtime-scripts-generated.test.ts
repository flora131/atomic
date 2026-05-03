import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../../packages/atomic/src/lib/workspace-paths.ts";

const root = findRepoRoot(import.meta.dir);
const bundles = [
  "packages/atomic-sdk/src/lib/runtime-scripts/cc-debounce.script.js",
  "packages/atomic-sdk/src/lib/runtime-scripts/orchestrator-entry.script.js",
];

test("runtime script bundles are emitted", () => {
  for (const rel of bundles) {
    expect(existsSync(join(root, rel))).toBe(true);
  }
});

test("runtime script bundles are self-contained (no relative imports)", () => {
  // Self-contained = no `from "./..."` or `from "../..."` survives the bundle.
  // node:* and bun:* externals are allowed.
  const relImport = /from\s+['"]\.\.?\//;
  for (const rel of bundles) {
    const src = readFileSync(join(root, rel), "utf8");
    expect(src).not.toMatch(relImport);
  }
});

test("standard entrypoints reference emitRuntimeScriptBundles", () => {
  const callers = [
    "packages/atomic/script/build.ts",
    "packages/atomic-sdk/script/build.ts",
    "tests/setup/ensure-embedded-tarballs.ts",
  ];
  for (const rel of callers) {
    const src = readFileSync(join(root, rel), "utf8");
    expect(src).toContain("emitRuntimeScriptBundles");
  }
});
