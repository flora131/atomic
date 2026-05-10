#!/usr/bin/env bun
/**
 * Cross-platform regression guard for SDK-only consumers.
 *
 * Atomic 2 no longer publishes an SDK-bundled CLI dispatcher. The SDK is a
 * daemon JSON-RPC client and discovers/spawns the Atomic binary through the
 * package's optional platform dependencies (or ATOMIC_BINARY/PATH overrides).
 *
 * This verifier installs the SDK from a registry and asserts the published
 * package has the clean-break shape: no `./cli` export, no bundled `cli.js`,
 * and optional Atomic binary packages declared.
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const [, , registry, version] = process.argv;
if (!registry || !version) {
  console.error(
    "[verify-sdk-daemon-package] usage: verify-bundled-cli.ts <registry-url> <sdk-version>",
  );
  process.exit(2);
}

const SDK_PKG = "@bastani/atomic-sdk";

let workdir: string | null = null;
let exitCode = 0;

try {
  workdir = await mkdtemp(join(tmpdir(), "atomic-sdk-verify-"));
  log(`workdir: ${workdir}`);

  run("bun", ["init", "-y"], workdir);
  run("bun", ["add", `${SDK_PKG}@${version}`, "--registry", registry], workdir);

  const sdkRoot = join(workdir, "node_modules", "@bastani", "atomic-sdk");
  await assertExists(sdkRoot, "installed SDK package directory");

  const pkg = (await Bun.file(join(sdkRoot, "package.json")).json()) as {
    name: string;
    exports: Record<string, unknown>;
    optionalDependencies?: Record<string, string>;
  };
  assert(pkg.name === SDK_PKG, `package.json#name === "${SDK_PKG}"`);
  assert(pkg.exports["./cli"] == null, "package.json#exports['./cli'] is absent");
  await assertMissing(join(sdkRoot, "dist", "cli.js"), "removed SDK dispatcher dist/cli.js");

  const optional = pkg.optionalDependencies ?? {};
  assert(
    Object.keys(optional).some((name) => name.startsWith("@bastani/atomic-")),
    "package.json declares optional @bastani/atomic-* binary dependencies",
  );

  console.log("\n[verify-sdk-daemon-package] all checks passed");
} catch (err) {
  exitCode = 1;
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`\n[verify-sdk-daemon-package] FAILED:\n${msg}`);
} finally {
  if (workdir) {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

process.exit(exitCode);

function log(msg: string): void {
  console.log(`[verify-sdk-daemon-package] ${msg}`);
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

async function assertExists(path: string, label: string): Promise<void> {
  try {
    await stat(path);
    log(`ok: ${label}`);
  } catch {
    throw new Error(`${label} missing at ${path}`);
  }
}

async function assertMissing(path: string, label: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    log(`ok: ${label} absent`);
    return;
  }
  throw new Error(`${label} unexpectedly exists at ${path}`);
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
  log(`ok: ${label}`);
}
