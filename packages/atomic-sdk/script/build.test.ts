/**
 * Build-output structural assertions.
 *
 * Catches packaging regressions in PR CI without needing a full publish
 * cycle. The verdaccio matrix in `publish.yml` exercises the same
 * properties end-to-end across all 6 OS×arch combinations after a
 * release branch is opened — this lighter check fires on every PR so
 * regressions are surfaced before merge.
 *
 * Skip mechanic: set `ATOMIC_SKIP_SDK_BUILD_TEST=1` to bypass when
 * iterating locally (the build adds ~5–10 s to `bun test`). The publish
 * job in `publish.yml` sets this env var because the validate matrix
 * has already exercised the same properties end-to-end.
 *
 * What we verify:
 *   1. `bun run build` produces `dist/cli.js` and
 *      `dist/runtime/footer-command.js` — the bundled artifacts the
 *      SDK self-exec target needs at runtime when consumers install
 *      only `@bastani/atomic-sdk`.
 *   2. The build script's entry list is sourced from `package.json#exports`,
 *      so `./cli` and `./runtime/footer-command` exports are present in
 *      the published manifest. Drift between the manifest and the bundle
 *      is the most common way bundled artifacts disappear.
 *   3. `dist/cli.js` is invokable through Bun and dispatches its hidden
 *      Commander subcommands. Catches broken imports, missing default
 *      exports, etc., before the verdaccio matrix runs.
 */

import { test, expect, describe, beforeAll } from "bun:test";
import { existsSync, statSync } from "node:fs";
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

  test("dist/cli.js exists and is non-empty", () => {
    const cli = join(DIST, "cli.js");
    expect(existsSync(cli)).toBe(true);
    expect(statSync(cli).size).toBeGreaterThan(0);
  });

  test("dist/runtime/footer-command.js exists and is non-empty", () => {
    const f = join(DIST, "runtime", "footer-command.js");
    expect(existsSync(f)).toBe(true);
    expect(statSync(f).size).toBeGreaterThan(0);
  });

  test("package.json declares ./cli and ./runtime/footer-command exports", async () => {
    // The build pipeline iterates `pkg.exports` to choose entry points,
    // so any drop here means the corresponding bundle disappears
    // silently. Assert both manifest entries exist.
    const pkg = (await Bun.file(join(SDK_PKG_ROOT, "package.json")).json()) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports["./cli"]).toBe("./src/cli.ts");
    expect(pkg.exports["./runtime/footer-command"]).toBe(
      "./src/runtime/footer-command.tsx",
    );
  });

  test("bundled cli.js dispatches _orchestrator-entry via Commander", () => {
    // `--help` against a hidden subcommand exits 0 and prints the
    // command's argument shape. Cheapest argv path that proves the
    // bundle parses, imports resolve, and Commander has the command
    // registered, without spawning tmux or a workflow.
    const cli = join(DIST, "cli.js");
    const result = spawnSync("bun", [cli, "_orchestrator-entry", "--help"], {
      stdio: "pipe",
      encoding: "utf-8",
      cwd: SDK_PKG_ROOT,
    });
    if (result.status !== 0) {
      console.error("stdout:", result.stdout);
      console.error("stderr:", result.stderr);
    }
    expect(result.status).toBe(0);
    const out = `${result.stdout}\n${result.stderr}`;
    // Commander prints either the subcommand name or its positional
    // argument names — both are accepted as proof of dispatch.
    const dispatched =
      out.includes("_orchestrator-entry") ||
      out.includes("workflowName") ||
      out.includes("workflowSource");
    expect(dispatched).toBe(true);
  });
});
