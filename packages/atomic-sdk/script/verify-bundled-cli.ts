#!/usr/bin/env bun
/**
 * Cross-platform regression guard for SDK-only consumers — apps that
 * install `@bastani/atomic-sdk` without the user-facing `@bastani/atomic`
 * CLI package alongside.
 *
 * The bug this defends against: `runWorkflow()` used to spawn a self-exec
 * targeting `node_modules/@bastani/atomic/src/cli.ts` — a file that only
 * existed if the user-facing CLI package was *also* installed alongside
 * `@bastani/atomic-sdk`. SDK-only consumers got a broken self-exec at
 * runtime even though their `package.json` looked fine.
 *
 * The script simulates the SDK-only install flow against a registry
 * (verdaccio in CI; npm by default) and asserts every property the fix
 * promises:
 *
 *   1. `bun add @bastani/atomic-sdk` succeeds without `@bastani/atomic`.
 *   2. The published tarball contains `dist/cli.js` (the bundled
 *      orchestrator dispatcher) and `dist/runtime/footer-command.js`.
 *   3. The published `package.json` declares `./cli` and
 *      `./runtime/footer-command` as exports, so the build pipeline
 *      hasn't quietly dropped them.
 *   4. The bundled `cli.js` is invokable end-to-end through Bun and
 *      Commander dispatches its hidden subcommands (we exercise
 *      `_orchestrator-entry --help` instead of `--help` because Commander's
 *      hidden-command help is the cheapest argv path that proves
 *      dispatch works without spawning anything).
 *
 * The resolver itself (`resolveSdkCliPath`) is pinned by the unit tests
 * in `src/lib/self-exec.test.ts`. Together they bracket the regression:
 * unit tests cover the runtime behaviour, this script covers the
 * packaging — a regression in either layer would still trip one of them.
 *
 * Usage:
 *   bun packages/atomic-sdk/script/verify-bundled-cli.ts <registry> <version>
 *
 * Both args are required so the same script works against verdaccio in
 * the validate matrix and against npm during release-day smoke checks.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [, , registry, version] = process.argv;
if (!registry || !version) {
  console.error(
    "[verify-bundled-cli] usage: verify-bundled-cli.ts <registry-url> <sdk-version>",
  );
  process.exit(2);
}

const SDK_PKG = "@bastani/atomic-sdk";
const SIBLING_PKG_DIR = "atomic"; // pre-fix path walk landed in this sibling

let workdir: string | null = null;
let exitCode = 0;

try {
  // ── 1. Fresh consumer project ───────────────────────────────────────────
  workdir = await mkdtemp(join(tmpdir(), "atomic-sdk-verify-"));
  log(`workdir: ${workdir}`);

  run("bun", ["init", "-y"], workdir);
  run(
    "bun",
    ["add", `${SDK_PKG}@${version}`, "--registry", registry],
    workdir,
  );

  // ── 2. Layout assertions on the installed package ───────────────────────
  const sdkRoot = join(workdir, "node_modules", "@bastani", "atomic-sdk");
  await assertExists(sdkRoot, "installed SDK package directory");
  await assertExists(
    join(sdkRoot, "dist", "cli.js"),
    "bundled CLI dispatcher (dist/cli.js)",
  );
  await assertExists(
    join(sdkRoot, "dist", "runtime", "footer-command.js"),
    "bundled footer command (dist/runtime/footer-command.js)",
  );

  // ── 3. Published package.json has `./cli` + `./runtime/footer-command`. ─
  //
  // The build script bundles every `exports` entry, so a missing export
  // here means the bundle silently lacks the corresponding file. Easier
  // to fail fast on the manifest than chase missing imports later.
  const pkg = (await Bun.file(join(sdkRoot, "package.json")).json()) as {
    name: string;
    exports: Record<string, unknown>;
  };
  assert(pkg.name === SDK_PKG, `package.json#name === "${SDK_PKG}"`);
  assert(pkg.exports["./cli"] !== undefined, "package.json#exports['./cli']");
  assert(
    pkg.exports["./runtime/footer-command"] !== undefined,
    "package.json#exports['./runtime/footer-command']",
  );

  // ── 4. Sibling-package regression guard ─────────────────────────────────
  //
  // Pre-fix the SDK walked `../../../atomic/src/cli.ts` from its own
  // runtime/ — a path that resolved into `node_modules/@bastani/atomic/`
  // (or `node_modules/atomic/`) and quietly broke when only the SDK was
  // installed. Verify neither sibling layout is present and that the SDK
  // doesn't depend on either.
  const siblingScoped = join(workdir, "node_modules", "@bastani", SIBLING_PKG_DIR);
  const siblingFlat = join(workdir, "node_modules", SIBLING_PKG_DIR);
  await assertMissing(siblingScoped, "@bastani/atomic sibling (regression)");
  await assertMissing(siblingFlat, "atomic sibling (regression)");

  // ── 5. Bundled CLI dispatches hidden subcommands ────────────────────────
  //
  // Commander prints the hidden-subcommand help to stdout and exits 0
  // when given `--help`, even though the subcommand is `hidden: true` in
  // the help listing. This proves: bun can run the file, the bundle's
  // imports resolve, Commander parses argv, and the orchestrator-entry
  // command is registered. It does NOT spawn tmux or a workflow — those
  // require positional args we deliberately omit.
  const cliPath = join(sdkRoot, "dist", "cli.js");
  const help = spawnSync(
    "bun",
    [cliPath, "_orchestrator-entry", "--help"],
    {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      // Don't inherit the monorepo's bun workspace context — the
      // consumer scenario is a standalone install.
      cwd: workdir,
    },
  );
  if (help.status !== 0) {
    console.error("[verify-bundled-cli] bundled cli failed to start");
    console.error("stdout:", help.stdout);
    console.error("stderr:", help.stderr);
    throw new Error("bundled cli.js exited non-zero");
  }
  const helpOut = `${help.stdout}\n${help.stderr}`;
  assert(
    helpOut.includes("_orchestrator-entry") || helpOut.includes("workflowName"),
    "Commander dispatched _orchestrator-entry help",
  );

  console.log("\n[verify-bundled-cli] all checks passed");
} catch (err) {
  exitCode = 1;
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`\n[verify-bundled-cli] FAILED:\n${msg}`);
} finally {
  if (workdir) {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

process.exit(exitCode);

// ── helpers ──────────────────────────────────────────────────────────────

function log(msg: string): void {
  console.log(`[verify-bundled-cli] ${msg}`);
}

function run(cmd: string, args: string[], cwd: string): void {
  log(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`command failed (exit ${result.status}): ${cmd} ${args.join(" ")}`);
  }
}

function assert(cond: unknown, label: string): void {
  if (cond) {
    log(`✓ ${label}`);
    return;
  }
  throw new Error(`assertion failed: ${label}`);
}

async function assertExists(path: string, label: string): Promise<void> {
  try {
    await stat(path);
    log(`✓ exists: ${label} (${path})`);
  } catch {
    throw new Error(`missing: ${label} — expected at ${path}`);
  }
}

async function assertMissing(path: string, label: string): Promise<void> {
  try {
    await stat(path);
    throw new Error(`unexpected: ${label} — found at ${path}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("unexpected:")) {
      throw err;
    }
    log(`✓ absent: ${label}`);
  }
}
