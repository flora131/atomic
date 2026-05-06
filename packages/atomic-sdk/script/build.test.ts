/**
 * Build-output structural assertions.
 *
 * Catches packaging regressions in PR CI without needing a full publish
 * cycle. The verdaccio matrix in `publish.yml` exercises the same
 * properties end-to-end across all OS×arch combinations after a release
 * branch is opened — this lighter check fires on every PR so regressions
 * are surfaced before merge.
 *
 * Skip mechanic: set `ATOMIC_SKIP_SDK_BUILD_TEST=1` to bypass when
 * iterating locally (the build adds ~5–10 s to `bun test`). The publish
 * job in `publish.yml` sets this env var because the validate matrix
 * has already exercised the same properties end-to-end.
 *
 * What we verify:
 *   1. `bun run build` completes without error and produces `dist/`.
 *   2. The `./cli` export IS present in the published manifest — the SDK's
 *      prebundled dispatcher is the only default resolver path
 *      (`resolveDispatcher` calls `import.meta.resolve("@bastani/atomic-sdk/cli")`).
 */

import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const SDK_PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(SDK_PKG_ROOT, "dist");
const SKIP = process.env.ATOMIC_SKIP_SDK_BUILD_TEST === "1";

describe.skipIf(SKIP)("SDK build output", () => {
  beforeAll(() => {
    const result = spawnSync("bun", ["run", "build"], {
      cwd: SDK_PKG_ROOT,
      stdio: "pipe",
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      throw new Error(
        `bun run build failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
  }, 120_000);

  test("dist/ directory exists after build", () => {
    expect(existsSync(DIST)).toBe(true);
  });

  test("package.json declares ./cli export (prebundled dispatcher)", async () => {
    const pkg = (await Bun.file(join(SDK_PKG_ROOT, "package.json")).json()) as {
      exports: Record<string, string>;
    };
    expect(typeof pkg.exports["./cli"]).toBe("string");
  });

  test("dist contains compiled cli.js for the dispatcher", () => {
    expect(existsSync(join(DIST, "cli.js"))).toBe(true);
  });
});
