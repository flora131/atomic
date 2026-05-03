import { test, expect, beforeAll } from "bun:test";
import { rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { findRepoRoot } from "../../src/lib/workspace-paths.ts";
import { TARGETS, hostTarget } from "../targets.ts";

const SKIP_PUBLISH = process.env.ATOMIC_SKIP_PUBLISH_BUILD_TEST === "1";

const WORKSPACE_ROOT = findRepoRoot(import.meta.dir);
const DIST_DIR = join(WORKSPACE_ROOT, "packages", "atomic", "dist");

const HOST_TARGET = hostTarget();
const OTHER_TARGETS = TARGETS.map((t) => t.name).filter((n) => n !== HOST_TARGET);

beforeAll(async () => {
  await rm(DIST_DIR, { recursive: true, force: true });
});

test.skipIf(SKIP_PUBLISH)(
  "no-arg build.ts builds only host target",
  async () => {
    const proc = Bun.spawn(["bun", "packages/atomic/script/build.ts"], {
      cwd: WORKSPACE_ROOT,
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);

    const entries = await readdir(DIST_DIR);

    expect(entries).toContain(HOST_TARGET);

    for (const other of OTHER_TARGETS) {
      expect(entries).not.toContain(other);
    }
  },
  60_000,
);
