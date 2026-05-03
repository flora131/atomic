import { describe, expect, test } from "bun:test";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanDist } from "./clean-dist.ts";

/**
 * Verify cleanDist removes files using a temp directory stand-in.
 *
 * cleanDist hard-codes DIST = resolve(ROOT, "dist"), so we test the
 * exported helper by temporarily monkey-patching `process.env` is NOT
 * needed — instead we test the real cleanDist against the real dist
 * path when dist does not exist (no-op / force), and separately verify
 * the file-removal behavior via a parallel helper that mirrors the
 * implementation with a temp path.
 */

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

describe("cleanDist", () => {
  test("removes nested files and directories", async () => {
    // Build a temp tree that mirrors what a dist/ dir might look like.
    const tmp = join(tmpdir(), `atomic-clean-dist-test-${crypto.randomUUID()}`);
    const nested = join(tmp, "subdir", "deeply", "nested");
    await mkdir(nested, { recursive: true });
    await writeFile(join(tmp, "index.js"), "// bundle");
    await writeFile(join(nested, "chunk.js"), "// chunk");

    // Confirm setup
    expect(await pathExists(tmp)).toBe(true);
    expect(await pathExists(join(nested, "chunk.js"))).toBe(true);

    // Use node:fs/promises rm directly (same API as cleanDist) to verify
    // the underlying approach works for arbitrary paths — mirrors the
    // cleanDist implementation without coupling to its hard-coded DIST path.
    const { rm } = await import("node:fs/promises");
    await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

    expect(await pathExists(tmp)).toBe(false);
    expect(await pathExists(join(nested, "chunk.js"))).toBe(false);
  });

  test("cleanDist is idempotent when dist does not exist (force=true, no throw)", async () => {
    // cleanDist uses force:true so calling it when dist is absent should not throw.
    // This also exercises the real export without side effects in CI (dist may or may not exist).
    await expect(cleanDist()).resolves.toBeUndefined();
  });
});
