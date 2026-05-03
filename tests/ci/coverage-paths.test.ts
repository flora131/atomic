import { test, expect } from "bun:test";
import { Glob } from "bun";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");

const INFRA_WHITELIST = new Set<string>([
  "tests/**",
  "**/tmp/**",
  "**/var/folders/**",
  "**/.atomic/.tmp/**",
  "node_modules/**",
  "vendor/**",
  "generated/**",
  ".atomic/**",
  ".claude/**",
  ".github/**",
  ".opencode/**",
  ".playwright/**",
  ".vscode/**",
  ".devcontainer/**",
  "assets/**",
  "specs/**",
  "research/**",
  "devcontainer-features/**",
  "docs/**",
]);

async function readPatterns(): Promise<string[]> {
  const txt = await Bun.file(join(REPO_ROOT, "bunfig.toml")).text();
  const m = txt.match(/coveragePathIgnorePatterns\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error("coveragePathIgnorePatterns not found in bunfig.toml");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

test("every coveragePathIgnorePatterns entry resolves to a real file or is whitelisted infra", async () => {
  const patterns = await readPatterns();
  const stale: string[] = [];

  for (const p of patterns) {
    if (INFRA_WHITELIST.has(p)) continue;

    if (!p.startsWith("packages/")) {
      stale.push(`${p} (not under packages/ and not whitelisted)`);
      continue;
    }

    // Exact path (no glob wildcards)
    if (!p.includes("*")) {
      const direct = join(REPO_ROOT, p);
      if (existsSync(direct)) continue;
      stale.push(`${p} (no matching files)`);
      continue;
    }

    // Glob pattern
    const g = new Glob(p);
    let matched = false;
    for await (const _ of g.scan({ cwd: REPO_ROOT })) {
      matched = true;
      break;
    }
    if (!matched) stale.push(`${p} (no matching files)`);
  }

  if (stale.length > 0) {
    console.error("Stale coveragePathIgnorePatterns entries:");
    for (const entry of stale) console.error(`  - ${entry}`);
  }

  expect(stale).toEqual([]);
});
