import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { synthesizeWrapper } from "../publish.ts";

test("wrapper tarball contains exactly bin/atomic, postinstall.mjs, package.json, LICENSE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atomic-wrapper-shape-"));
  try {
    await synthesizeWrapper(dir, {
      version: "9.99.99-test",
      repository: { type: "git", url: "git+https://github.com/flora131/atomic.git" },
    });
    const out = await $`npm pack --dry-run --json`.cwd(dir).quiet().text();
    const parsed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
    const files = parsed[0].files.map((f) => f.path).sort();
    expect(files).toEqual(["LICENSE", "bin/atomic", "package.json", "postinstall.mjs"]);
    for (const f of files) {
      expect(f.startsWith(".claude/")).toBe(false);
      expect(f.startsWith(".agents/")).toBe(false);
      expect(f.startsWith(".opencode/")).toBe(false);
      expect(f.startsWith(".github/")).toBe(false);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
