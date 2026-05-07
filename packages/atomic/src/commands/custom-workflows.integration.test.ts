/**
 * Integration tests for custom-workflows / hostLocalWorkflows end-to-end.
 *
 * Uses the real SDK fixture at tests/fixtures/sdk-host-consumer/index.ts
 * to exercise the full spawn-parse cycle that the production loader
 * (loadCustomWorkflows) drives, as well as two direct-spawn paths that
 * exercise hostLocalWorkflows() behaviour:
 *   1. _emit-workflow-meta with valid token  → ATOMIC_WORKFLOW_META emitted
 *   2. no env tokens                         → user main() runs, no meta
 *   3. _atomic-run --detach                  → exit 0 (creates tmux session)
 *
 * Test 3 uses --detach because the foreground attach path calls
 * `tmux switch-client`, which requires an active tmux client and therefore
 * fails in a plain terminal test harness.  The detach path creates the
 * session and exits 0 without attaching.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import path from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadCustomWorkflows } from "./custom-workflows.ts";

// ─── Timeout env override ─────────────────────────────────────────────────────

// Bun's cold TS resolution + workspace dep chain can exceed the production 5s
// default under `bun test --parallel` cold caches; production users on warm
// caches are unaffected.
let _priorMetaTimeout: string | undefined;
beforeAll(() => {
  _priorMetaTimeout = process.env.ATOMIC_WORKFLOWS_META_TIMEOUT_MS;
  process.env.ATOMIC_WORKFLOWS_META_TIMEOUT_MS = "15000";
});
afterAll(async () => {
  if (_priorMetaTimeout === undefined) {
    delete process.env.ATOMIC_WORKFLOWS_META_TIMEOUT_MS;
  } else {
    process.env.ATOMIC_WORKFLOWS_META_TIMEOUT_MS = _priorMetaTimeout;
  }

  // Tear down any mux sessions + orchestrator processes the
  // `_atomic-run --detach` test spawned. Two-step cleanup is required:
  //
  //   1. Kill the mux session via the SDK's platform-agnostic helper
  //      (tmux on POSIX, psmux on Windows) — drops the launcher script
  //      and the pane.
  //   2. Kill the orchestrator-entry bun process. The mux's
  //      `kill-session` only HUPs the pane's direct child; that child
  //      doesn't propagate to its bun grandchild, so bun gets
  //      reparented to init/PID 1 and stays alive (atomic's runtime
  //      ignores SIGHUP by design so the orchestrator survives client
  //      detach for `--detach` mode — but it means tests must signal
  //      bun explicitly to reap it).
  //
  // Without this, every test run leaks one mux session and one bun
  // process, which accumulate across iterations and slow the box down.
  await reapDetachedTestArtifacts();
});

/**
 * Cross-platform cleanup for orphans the `_atomic-run --detach` test
 * leaves behind. Implemented in TypeScript (rather than a bash
 * one-liner) so Windows devs running the suite under PowerShell get
 * the same teardown — the mux helper handles tmux-vs-psmux, and the
 * process-listing branch picks `ps` on POSIX and `wmic` on Windows.
 */
async function reapDetachedTestArtifacts(): Promise<void> {
  // 1. Kill any leftover mux sessions matching the test fixture's prefix.
  try {
    const { listSessions, killSession } = await import("@bastani/atomic-sdk/runtime/tmux");
    for (const s of listSessions()) {
      if (s.name.startsWith("atomic-wf-claude-demo-wf-")) {
        killSession(s.name);
      }
    }
  } catch {
    // Mux binary may be absent (e.g. CI sandbox without tmux/psmux);
    // nothing to clean up in that case.
  }

  // 2. Kill orphan orchestrator-entry bun processes.
  const isWin = process.platform === "win32";
  if (isWin) {
    // Windows: use wmic to list pids whose CommandLine references our
    // fixture, then taskkill each. wmic is available out of the box on
    // every supported Windows release.
    Bun.spawnSync({
      cmd: ["powershell", "-NoProfile", "-Command",
        "Get-CimInstance Win32_Process | " +
        "Where-Object { $_.CommandLine -match '_orchestrator-entry .*demo-wf' } | " +
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      stdout: "ignore",
      stderr: "ignore",
    });
  } else {
    // POSIX: ps + awk + kill. Bash is guaranteed present on Linux/macOS;
    // even minimal containers ship `/bin/sh` + `ps` + `awk` + `kill`.
    Bun.spawnSync({
      cmd: ["sh", "-c",
        "ps -eo pid,cmd | awk '/bun.*_orchestrator-entry .*demo-wf/ && !/awk/ {print $1}' | " +
        "xargs -r kill -TERM 2>/dev/null; true",
      ],
      stdout: "ignore",
      stderr: "ignore",
    });
  }
}

// ─── Fixture path ─────────────────────────────────────────────────────────────

// import.meta.dir = packages/atomic/src/commands
// ../../../../          = repo root
const FIXTURE_DIR = path.resolve(import.meta.dir, "../../../../tests/fixtures/sdk-host-consumer");
const FIXTURE_ENTRY = path.join(FIXTURE_DIR, "index.ts");

// ─── CLI path for subprocess tests ────────────────────────────────────────────
const CLI_PATH = path.resolve(import.meta.dir, "../cli.ts");

// ─── Test 1: loadCustomWorkflows discovers the real SDK fixture ───────────────

test("loadCustomWorkflows spawns sdk-host-consumer fixture and discovers compiled workflow", async () => {
  const result = await loadCustomWorkflows(
    {
      "demo-wf": {
        command: "bun",
        args: ["run", FIXTURE_ENTRY],
        agents: ["claude"],
      },
    },
    "local",
    "<settings-path-stub>",
  );

  expect(result.loaded).toHaveLength(1);
  expect(result.loaded[0]!.alias).toBe("demo-wf");
  expect(result.loaded[0]!.workflow.name).toBe("demo-wf");
  expect(result.loaded[0]!.workflow.agent).toBe("claude");
  expect(result.broken).toHaveLength(0);
}, 30000);

// ─── Test 2: no env tokens → user main runs, no meta emitted ─────────────────

test("fixture invoked directly without atomic env runs user main(); does not emit meta", async () => {
  const child = Bun.spawn(
    ["bun", "run", FIXTURE_ENTRY, "_emit-workflow-meta"],
    {
      stdout: "pipe",
      stderr: "pipe",
      // Deliberately exclude ATOMIC_HOST and ATOMIC_DISPATCH_TOKEN
      env: { PATH: process.env.PATH ?? "" },
    },
  );

  const stdout = await new Response(child.stdout).text();
  await child.exited;

  expect(stdout).not.toContain("ATOMIC_WORKFLOW_META:");
  expect(stdout).toContain("user main ran");
}, 30000);

// ─── Test 2b: RFC §8.3 token-isolation — dispatch-token in argv but no env tokens ──────────────

test("RFC §8.3: fixture invoked with _emit-workflow-meta and --dispatch-token but no env tokens falls through to user main(); no meta emitted", async () => {
  const token = "a".repeat(32);
  const child = Bun.spawn(
    [
      "bun", "run", FIXTURE_ENTRY,
      "_emit-workflow-meta",
      `--dispatch-token=${token}`,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      // Deliberately exclude ATOMIC_HOST and ATOMIC_DISPATCH_TOKEN from env
      env: { PATH: process.env.PATH ?? "" },
    },
  );

  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;

  // Exit 0: consumer's own main() ran to completion
  expect(exitCode).toBe(0);
  // No meta line emitted — token-gating blocked dispatch
  expect(stdout.split("\n").some((l) => l.startsWith("ATOMIC_WORKFLOW_META: "))).toBe(false);
  // Consumer's standalone print confirms user main() executed
  expect(stdout).toContain("user main ran");
}, 30000);

// ─── Test 2c: RFC §8.3 symmetry — valid env tokens + matching dispatch-token → meta emitted ──

test("RFC §8.3 symmetry: fixture invoked with _emit-workflow-meta and valid env tokens emits ATOMIC_WORKFLOW_META line", async () => {
  const token = "b".repeat(32);
  const child = Bun.spawn(
    [
      "bun", "run", FIXTURE_ENTRY,
      "_emit-workflow-meta",
      `--dispatch-token=${token}`,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "",
        ATOMIC_HOST: "1",
        ATOMIC_DISPATCH_TOKEN: token,
      },
    },
  );

  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;

  // Exits 0 after emitting meta (process.exit(0) in hostLocalWorkflows)
  expect(exitCode).toBe(0);
  // Must contain the meta sentinel line
  const metaLine = stdout.split("\n").find((l) => l.startsWith("ATOMIC_WORKFLOW_META: "));
  expect(metaLine).toBeDefined();
  // The JSON payload must include the demo-wf workflow definition
  const payload = JSON.parse(metaLine!.slice("ATOMIC_WORKFLOW_META: ".length)) as unknown[];
  expect(Array.isArray(payload)).toBe(true);
  expect(payload.length).toBeGreaterThan(0);
  const first = payload[0] as Record<string, unknown>;
  expect(first["name"]).toBe("demo-wf");
  expect(first["agent"]).toBe("claude");
}, 30000);

// ─── Test 3: _atomic-run --detach path exits 0 ────────────────────────────────

test("hostLocalWorkflows _atomic-run --detach path creates tmux session and exits 0", async () => {
  // The foreground _atomic-run path calls `tmux switch-client` which requires
  // an active tmux client.  Using --detach avoids the attach step so the
  // process can exit cleanly in a plain terminal harness.
  const token = "a".repeat(32);
  const child = Bun.spawn(
    [
      "bun", "run", FIXTURE_ENTRY,
      "_atomic-run",
      `--dispatch-token=${token}`,
      "--name", "demo-wf",
      "--agent", "claude",
      "--detach",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "",
        ATOMIC_HOST: "1",
        ATOMIC_DISPATCH_TOKEN: token,
      },
    },
  );

  const exitCode = await child.exited;
  expect(exitCode).toBe(0);
}, 30000);

// ─── Test 4: _runtime-assets-smoke skips workflow bootstrap ───────────────────

test("_runtime-assets-smoke exits 0 and does not trigger workflow bootstrap even with broken workflow entry", async () => {
  // Write a settings.json whose workflow command crashes with exit 7 and never
  // emits the ATOMIC_WORKFLOW_META line. If the bootstrap were NOT skipped,
  // the loader would spawn this command, fail to parse meta, and emit
  // [atomic/workflows] diagnostics to stderr. The skip predicate must prevent
  // that entirely.
  const tmpHome = await mkdtemp(path.join(tmpdir(), "atomic-smoke-test-home-"));
  const tmpCwd = await mkdtemp(path.join(tmpdir(), "atomic-smoke-test-cwd-"));
  try {
    await mkdir(path.join(tmpHome, ".atomic"), { recursive: true });
    await mkdir(path.join(tmpCwd, ".atomic"), { recursive: true });
    await writeFile(
      path.join(tmpHome, ".atomic", "settings.json"),
      JSON.stringify({
        workflows: {
          "crash-wf": {
            command: "/bin/sh",
            args: ["-c", "exit 7"],
            agents: ["claude"],
          },
        },
      }),
    );

    const child = Bun.spawn(
      ["bun", CLI_PATH, "_runtime-assets-smoke"],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: tmpCwd,
        env: {
          ...process.env,
          ATOMIC_SETTINGS_HOME: tmpHome,
          ATOMIC_SKIP_AUTOSYNC: "1",
        },
      },
    );

    const [stderr] = await Promise.all([
      new Response(child.stderr as ReadableStream<Uint8Array>).text(),
      new Response(child.stdout as ReadableStream<Uint8Array>).text(),
    ]);
    const exitCode = await child.exited;

    // Command must exit 0 (smoke check may report individual asset failures
    // but always exits cleanly)
    expect(exitCode).toBe(0);

    // No workflow bootstrap diagnostics — bootstrap was skipped
    expect(stderr).not.toContain("[atomic/workflows]");
  } finally {
    await rm(tmpHome, { recursive: true, force: true });
    await rm(tmpCwd, { recursive: true, force: true });
  }
}, 30000);
