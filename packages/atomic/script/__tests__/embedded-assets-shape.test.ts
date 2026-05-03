import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("bundleEmbeddedAssets produces flat archives (no leaf prefix)", async () => {
  const work = await mkdtemp(join(tmpdir(), "atomic-tar-"));
  try {
    const leaf = join(work, ".claude");
    await mkdir(join(leaf, "agents"), { recursive: true });
    await writeFile(join(leaf, "agents", "x.md"), "hi");

    const archive = join(work, ".claude.tar");
    const r = spawnSync("tar", ["-cf", archive, "-C", leaf, "."]);
    expect(r.status).toBe(0);

    const extract = join(work, "ext");
    await mkdir(extract, { recursive: true });
    spawnSync("tar", ["-xf", archive, "-C", extract]);

    const top = await readdir(extract);
    expect(top).toContain("agents");
    expect(top).not.toContain(".claude"); // leaf prefix MUST NOT appear
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
