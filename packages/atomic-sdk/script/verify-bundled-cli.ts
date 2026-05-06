#!/usr/bin/env bun
/**
 * Cross-platform regression guard for SDK-only consumers — apps that
 * install `@bastani/atomic-sdk` without the user-facing `@bastani/atomic`
 * CLI package alongside.
 *
 * The SDK's contract: a single `runWorkflow()` call must "just work" for
 * SDK-only consumers without requiring them to install
 * `@bastani/atomic` or its per-platform binary packages. The SDK ships
 * its own prebundled CLI dispatcher (`@bastani/atomic-sdk/cli`) and
 * routes workflow subprocesses through it via host bun.
 *
 * Asserted properties:
 *
 *   1. `bun add @bastani/atomic-sdk` succeeds without `@bastani/atomic`
 *      and without any per-platform binary packages.
 *   2. The published `package.json` declares `./cli` as an export — the
 *      resolver hits this path via `import.meta.resolve("@bastani/atomic-sdk/cli")`
 *      and would throw `NoDispatcherError` if the export went missing.
 *   3. Neither the scoped nor the flat `@bastani/atomic` sibling is
 *      present in the SDK-only install (regression guard).
 *
 * The resolver itself is pinned by the unit tests in
 * `src/lib/self-exec.test.ts`. Together they bracket the regression:
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

  // ── 3. Published package.json must declare the dispatcher exports. ─────
  //
  // The SDK's prebundled dispatcher is the SDK's only default route to
  // `_orchestrator-entry` / `_cc-debounce`; the resolver hits it via
  // `import.meta.resolve("@bastani/atomic-sdk/cli")`. If the export
  // disappears the resolver throws `NoDispatcherError` and `runWorkflow`
  // breaks for every SDK-only consumer.
  const pkg = (await Bun.file(join(sdkRoot, "package.json")).json()) as {
    name: string;
    exports: Record<string, unknown>;
  };
  assert(pkg.name === SDK_PKG, `package.json#name === "${SDK_PKG}"`);
  // Published exports are rewritten by `script/publish.ts` from string
  // ("./src/cli.ts") into a conditional object ({ types, import }).
  // Accept either shape so the script works on a source checkout *and*
  // on a verdaccio/npm-published install.
  assert(
    pkg.exports["./cli"] != null,
    "package.json#exports['./cli'] is declared (prebundled dispatcher)",
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
