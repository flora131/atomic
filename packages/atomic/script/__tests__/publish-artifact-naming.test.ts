import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "../../src/lib/workspace-paths.ts";

test("upload-artifact name matches publish.ts target dir name", async () => {
  const root = findRepoRoot(import.meta.dir);
  const yml = await readFile(join(root, ".github/workflows/publish.yml"), "utf8");
  const publishTs = await readFile(join(root, "packages/atomic/script/publish.ts"), "utf8");

  // build job uses name: <matrix.target.name> (no prefix)
  expect(yml).toMatch(/name:\s*\$\{\{\s*matrix\.target\.name\s*\}\}\s*$/m);
  expect(yml).not.toMatch(/name:\s*bin-\$\{\{/);

  // publish.ts cd's into dist/<target.name>
  expect(publishTs).toMatch(/dist["'`,\s]*[,\s]*t\.name/);
});
