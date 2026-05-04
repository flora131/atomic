import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bundleEmbeddedAssets, findOverlongTarEntry, MAX_TARRED_PATH_CHARS } from "../build-assets.ts";

test("bundleEmbeddedAssets produces flat archives (no leaf prefix)", async () => {
  // Stand up a fake repo root with each leaf dir bundleEmbeddedAssets walks,
  // populated with a single file so the archive has something to extract.
  const root = await mkdtemp(join(tmpdir(), "atomic-bundler-"));
  try {
    for (const leaf of [".claude", ".opencode", ".github"]) {
      await mkdir(join(root, leaf, "agents"), { recursive: true });
      await writeFile(join(root, leaf, "agents", "x.md"), "hi");
    }
    await mkdir(join(root, ".agents", "skills"), { recursive: true });
    await writeFile(join(root, ".agents", "skills", "x.md"), "hi");

    await bundleEmbeddedAssets(root);

    // Each archive's entries must NOT include the leaf-dir prefix —
    // extraction targets a versioned cache dir per kind, so a `.claude/`
    // prefix would yield `<cache>/claude/.claude/agents/x.md`.
    for (const archive of [
      join(root, ".claude.tar"),
      join(root, ".opencode.tar"),
      join(root, ".github.tar"),
      join(root, ".agents", "skills.tar"),
    ]) {
      const list = spawnSync("tar", ["-tf", archive], { encoding: "utf8" });
      expect(list.status).toBe(0);
      const entries = (list.stdout as string).split("\n").filter(Boolean);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.startsWith(".claude/")).toBe(false);
        expect(entry.startsWith(".opencode/")).toBe(false);
        expect(entry.startsWith(".github/")).toBe(false);
        expect(entry.startsWith("skills/")).toBe(false);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("findOverlongTarEntry surfaces the worst offender past MAX_TARRED_PATH_CHARS", () => {
  const ok = ["a/b.md", "c/d/e.md"];
  expect(findOverlongTarEntry(ok)).toBeNull();

  const bad = "x/" + "a".repeat(MAX_TARRED_PATH_CHARS);
  expect(findOverlongTarEntry([...ok, bad])).toBe(bad);
});
