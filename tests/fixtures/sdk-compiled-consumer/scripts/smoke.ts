#!/usr/bin/env bun
/**
 * Smoke matrix for the sdk-compiled-consumer fixture.
 *
 * Validates the two SDK-distribution scenarios:
 *
 *   • Host-bun: third-party CLI runs under `bun cli.ts`. The SDK
 *     resolver picks the `host-bun` branch and spawns the SDK's
 *     prebundled `@bastani/atomic-sdk/cli` via the host bun.
 *
 *   • Compiled binary: third-party CLI is built with `bun build
 *     --compile`. The bundled SDK's cli.ts is bunfs-only, so the SDK
 *     auto-defaults `pathToAtomicExecutable` to `process.execPath` so
 *     the consumer's own binary self-dispatches the internal sub-
 *     command. The SDK barrel installs the dispatch handler at module-
 *     load time — no consumer boilerplate required.
 *
 * Six-step matrix:
 *   1. `bun install`
 *   2. host-bun: `bun src/cli.ts greet` — assert "workflow:launched"
 *   3. `bun run compile` (bun build --compile → dist/my-app)
 *   4. compiled: `dist/my-app greet` — assert "workflow:launched"
 *   5. compiled with empty override: `dist/my-app greet
 *      --atomic-executable=""` — assert NoDispatcherError before tmux
 *      side-effect.
 *   6. host-bun: re-run after first invocation to confirm the SDK's
 *      bundled cli.ts is repeatable (cache, idempotency).
 *
 * Usage:
 *   bun tests/fixtures/sdk-compiled-consumer/scripts/smoke.ts [--skip-steps 4,5] [--verbose]
 *
 * NOTE on tmux: steps 2, 4, 6 require tmux on PATH (Linux/macOS) or
 * psmux (Windows). When the binary is unavailable the launch step will
 * fail; smoke.ts surfaces the underlying error.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Paths ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const FIXTURE_DIR = resolve(__dirname, "..");
const DIST_DIR    = join(FIXTURE_DIR, "dist");
const BINARY_NAME = process.platform === "win32" ? "my-app.exe" : "my-app";
const COMPILED    = join(DIST_DIR, BINARY_NAME);

// ── CLI parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const skipIdxRaw = args.findIndex((a) => a === "--skip-steps");
const skipSteps: Set<number> = new Set(
  skipIdxRaw !== -1
    ? (args[skipIdxRaw + 1] ?? "").split(",").map(Number).filter((n) => !isNaN(n))
    : [],
);
const verbose = args.includes("--verbose");

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string): void {
  process.stdout.write(`[smoke] ${msg}\n`);
}

function fail(msg: string): never {
  process.stderr.write(`[smoke] FAIL: ${msg}\n`);
  process.exit(1);
}

function run(
  cmd: string,
  cmdArgs: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string } = {},
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: opts.cwd ?? FIXTURE_DIR,
    env: { ...process.env, ...opts.env },
    encoding: "utf-8",
    input: opts.input,
  });
  if (verbose) {
    if (result.stdout) process.stdout.write(`  stdout: ${result.stdout}`);
    if (result.stderr) process.stderr.write(`  stderr: ${result.stderr}`);
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

/** Kill any orchestrator session spawned during smoke so the host atomic
 *  socket isn't littered. Best-effort: tmux may not be installed. */
function killSpawnedSessions(): void {
  const r = spawnSync("tmux", ["-L", "atomic", "ls", "-F", "#{session_name}"], {
    encoding: "utf-8",
  });
  if (r.status !== 0) return;
  const lines = (r.stdout ?? "").split("\n").filter((l) => l.startsWith("atomic-wf-"));
  for (const sess of lines) {
    if (sess.includes("fixture-greet")) {
      spawnSync("tmux", ["-L", "atomic", "kill-session", "-t", sess]);
    }
  }
}

// ── Step 1: bun install ──────────────────────────────────────────────────────

if (!skipSteps.has(1)) {
  log("Step 1 — bun install");
  const r = run("bun", ["install"]);
  if (r.status !== 0) fail(`bun install exited ${r.status}:\n${r.stderr}`);
  log("Step 1 PASSED");
} else {
  log("Step 1 SKIPPED");
}

// ── Step 2: host-bun mode (bun src/cli.ts greet) ─────────────────────────────

if (!skipSteps.has(2)) {
  log("Step 2 — host-bun: bun src/cli.ts greet --who=smoke-host");
  const r = run("bun", ["src/cli.ts", "greet", "--who", "smoke-host"], {
    env: { ATOMIC_DEBUG: "1" },
  });
  if (r.status !== 0) {
    fail(`bun src/cli.ts exited ${r.status}:\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  if (!r.stdout.includes("workflow:launched")) {
    fail(`stdout did not contain "workflow:launched":\n  stdout: ${r.stdout}`);
  }
  if (!r.stderr.includes("kind=host-bun")) {
    fail(`stderr did not contain "kind=host-bun" debug line:\n  stderr: ${r.stderr}`);
  }
  killSpawnedSessions();
  log("Step 2 PASSED");
} else {
  log("Step 2 SKIPPED");
}

// ── Step 3: bun build --compile ──────────────────────────────────────────────

if (!skipSteps.has(3)) {
  log("Step 3 — bun run compile");
  mkdirSync(DIST_DIR, { recursive: true });
  const r = run("bun", ["run", "compile"]);
  if (r.status !== 0) fail(`compile exited ${r.status}:\n${r.stderr}`);
  if (!existsSync(COMPILED)) fail(`compiled binary not found at ${COMPILED}`);
  log("Step 3 PASSED");
} else {
  log("Step 3 SKIPPED");
}

// ── Step 4: compiled mode (SDK auto-defaults override to process.execPath) ──

if (!skipSteps.has(4)) {
  log("Step 4 — compiled: dist/my-app greet --who=smoke-compiled");
  const r = run(COMPILED, ["greet", "--who", "smoke-compiled"], {
    cwd: DIST_DIR,
    env: { ATOMIC_DEBUG: "1" },
  });
  if (r.status !== 0) {
    fail(`dist/my-app exited ${r.status}:\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  if (!r.stdout.includes("workflow:launched")) {
    fail(`stdout did not contain "workflow:launched":\n  stdout: ${r.stdout}`);
  }
  if (!r.stderr.includes("kind=override-binary")) {
    fail(`stderr did not contain "kind=override-binary" debug line:\n  stderr: ${r.stderr}`);
  }
  killSpawnedSessions();
  log("Step 4 PASSED");
} else {
  log("Step 4 SKIPPED");
}

// ── Step 5: NoDispatcherError when compiled has no resolvable dispatcher ────

if (!skipSteps.has(5)) {
  log("Step 5 — compiled: pass --atomic-executable=__none__ to disable defaults → NoDispatcherError");
  // Use ATOMIC_EXECUTABLE env var to feed an empty override; cli.ts
  // treats explicit empty as "no override", which short-circuits the
  // process.execPath default.  In compiled mode the SDK cli.ts is
  // bunfs-rooted so host-bun resolution skips → NoDispatcherError.
  const r = run(COMPILED, ["greet", "--who", "smoke-no-disp"], {
    cwd: DIST_DIR,
    env: { ATOMIC_DEBUG: "1", ATOMIC_DISABLE_DEFAULT_EXEC: "1" },
  });
  if (r.status === 0) {
    fail(
      "expected non-zero exit when no dispatcher available, got exit 0.\n" +
      `stdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
  }
  if (!r.stderr.includes("NoDispatcherError")) {
    fail(`stderr did not contain "NoDispatcherError":\n  stderr: ${r.stderr}`);
  }
  log("Step 5 PASSED — NoDispatcherError raised before tmux side-effect");
} else {
  log("Step 5 SKIPPED");
}

// ── Step 6: host-bun second run (idempotency) ────────────────────────────────

if (!skipSteps.has(6)) {
  log("Step 6 — host-bun re-run: bun src/cli.ts greet --who=smoke-host-2");
  const r = run("bun", ["src/cli.ts", "greet", "--who", "smoke-host-2"], {
    env: { ATOMIC_DEBUG: "1" },
  });
  if (r.status !== 0) {
    fail(`bun src/cli.ts (re-run) exited ${r.status}:\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  }
  if (!r.stdout.includes("workflow:launched")) {
    fail(`stdout did not contain "workflow:launched":\n  stdout: ${r.stdout}`);
  }
  killSpawnedSessions();
  log("Step 6 PASSED");
} else {
  log("Step 6 SKIPPED");
}

// ── Cleanup: ensure no leftover dist binary so subsequent runs are deterministic
if (existsSync(COMPILED)) {
  rmSync(COMPILED, { force: true });
}

log("Smoke matrix complete.");
