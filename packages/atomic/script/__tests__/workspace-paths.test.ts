import { test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRepoRoot } from "../../src/lib/workspace-paths.ts";

// Build/test scripts call findRepoRoot at entry; import.meta.dir is fine here.
const WORKSPACE_ROOT = findRepoRoot(import.meta.dir);
const CLI_PKG_ROOT = join(WORKSPACE_ROOT, "packages", "atomic");
const SDK_PKG_ROOT = join(WORKSPACE_ROOT, "packages", "atomic-sdk");

test("workspace root resolves to repo containing bun.lock", () => {
  expect(existsSync(join(WORKSPACE_ROOT, "bun.lock"))).toBe(true);
});

test("CLI_PKG_ROOT contains src/cli.ts", () => {
  expect(existsSync(join(CLI_PKG_ROOT, "src", "cli.ts"))).toBe(true);
});

test("SDK_PKG_ROOT contains package.json", () => {
  expect(existsSync(join(SDK_PKG_ROOT, "package.json"))).toBe(true);
});
