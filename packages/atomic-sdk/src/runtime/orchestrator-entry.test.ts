/**
 * Integration test: `_orchestrator-entry` against the real compiled binary.
 *
 * Catches dev-vs-binary divergences in the orchestrator dispatch path.
 * Two known prior regressions this guards against:
 *
 *   1. `import.meta.path` collapse (bunfs): `bun build --compile`
 *      points every bundled module's `import.meta.path` at the binary
 *      entry, so the captured `definition.source` re-imported cli.ts
 *      and the pane died with "does not export a valid WorkflowDefinition"
 *      while the launcher exited 0 (silent failure).
 *
 *   2. Static import cycle in the SDK barrel: `host-local-workflows.ts`
 *      → `auto-dispatch.ts` (TLA) → `orchestrator-entry.ts` →
 *      `host-local-workflows.ts` (still suspended). The orchestrator
 *      called `lookupLocalWorkflow` while `localWorkflowRegistry` was in
 *      TDZ → "TypeError: undefined is not an object". Same silent-exit
 *      shape (parent CLI returns 0). Fixed by extracting helpers into
 *      `lib/dispatch-utils.ts` so the cycle is broken.
 *
 * Both bugs only manifest in compiled binaries because dev mode
 * dispatches through the SDK's standalone cli.ts (no barrel re-export),
 * and both surface as the orchestrator pane crashing while the parent
 * exits 0. The assertions below combine the two bug signatures: any new
 * "TypeError"/"ReferenceError" / "is not an object" / "does not export
 * a valid WorkflowDefinition" output means a regression.
 *
 * `locateBuiltBinary()` throws (rather than returning null) when run
 * under CI without a built binary — otherwise these tests would silently
 * skip on every PR and the regression class would slip through.
 */
import { test, expect, describe } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const builtBinary = locateBuiltBinary();

describe.skipIf(!builtBinary)("compiled binary _orchestrator-entry", () => {
  test("registry-resolves a builtin workflow when source is a bunfs path", () => {
    const bin = builtBinary!;
    // `cli-build-host-default.test.ts` deletes and rebuilds DIST_DIR in
    // parallel; if it ran between locateBuiltBinary() and now, skip
    // rather than fail on a transient ENOENT.
    if (!existsSync(bin)) return;
    // Post-fix arg order: <name> <agent> <inputsB64> <source>.
    // The bunfs source signals "compiled binary" and triggers the
    // registry-lookup branch in the cli action.
    const result = Bun.spawnSync({
      cmd: [bin, "_orchestrator-entry", "ralph", "claude", "", "/$bunfs/root/atomic"],
      stdout: "pipe",
      stderr: "pipe",
      env: stripWorkflowEnv(process.env),
    });

    const out = result.stdout.toString() + result.stderr.toString();

    // Bug signatures from the two known prior regressions (see file header).
    // Pre-fix #1: the dynamic import re-loaded cli.ts and threw
    // InvalidWorkflowError → "does not export a valid WorkflowDefinition".
    expect(out).not.toContain("does not export a valid WorkflowDefinition");
    // Pre-fix #2: TDZ in localWorkflowRegistry due to static import cycle
    // through the SDK barrel.
    expect(out).not.toContain("undefined is not an object");
    // Catch-all for any new module-evaluation crash on the dispatch path —
    // a clean miss should surface a domain error (registry/env), not a
    // runtime exception class.
    expect(out).not.toMatch(/TypeError|ReferenceError/);

    // Positive signal: we got past workflow resolution into
    // runOrchestrator → validateOrchestratorEnv. The next failure mode
    // is the missing ATOMIC_WF_* env we deliberately stripped.
    expect(out).toContain("ATOMIC_WF_ID");
  });

  test("unknown workflow name surfaces a clean registry-miss error", () => {
    const bin = builtBinary!;
    if (!existsSync(bin)) return;
    const result = Bun.spawnSync({
      cmd: [bin, "_orchestrator-entry", "no-such-workflow", "claude", "", "/$bunfs/root/atomic"],
      stdout: "pipe",
      stderr: "pipe",
      env: stripWorkflowEnv(process.env),
    });

    const out = result.stdout.toString() + result.stderr.toString();
    expect(out).toContain("no-such-workflow");
    expect(out).toContain("builtin registry");
    expect(result.exitCode).not.toBe(0);
    // Same module-evaluation regression guards as the registry-hit case —
    // a registry miss must come back as a clean domain error, not a
    // runtime exception thrown from a broken import graph.
    expect(out).not.toContain("undefined is not an object");
    expect(out).not.toMatch(/TypeError|ReferenceError/);
  });
});

function stripWorkflowEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (
      typeof v === "string" &&
      k !== "ATOMIC_WF_ID" &&
      k !== "ATOMIC_WF_TMUX" &&
      k !== "ATOMIC_WF_AGENT" &&
      k !== "ATOMIC_WF_CWD"
    ) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Resolve the host's built atomic binary, or return `null` so the
 * `describe.skipIf(!builtBinary)` gate skips the suite locally.
 *
 * In CI we throw instead of returning `null`. These tests are the only
 * regression guard for an entire class of dev-vs-binary divergence
 * (silent orchestrator-pane crashes while the parent exits 0); a silent
 * skip on a CI runner that forgot the build step would re-open that
 * gap. The `checks` job in `.github/workflows/ci.yml` is responsible
 * for running `bun packages/atomic/script/build.ts` before `bun test`.
 */
function locateBuiltBinary(): string | null {
  const ext = process.platform === "win32" ? ".exe" : "";
  let dir = import.meta.dir;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "packages"))) {
      const distRoot = join(dir, "packages", "atomic", "dist");
      const targets = [
        "linux-x64",
        "linux-arm64",
        "darwin-x64",
        "darwin-arm64",
        "windows-x64",
      ];
      for (const target of targets) {
        const candidate = join(distRoot, target, "bin", `atomic${ext}`);
        if (existsSync(candidate)) return candidate;
      }
      if (process.env.CI) {
        throw new Error(
          `[orchestrator-entry.test] No built atomic binary found under ${distRoot}. ` +
            `Run \`bun packages/atomic/script/build.ts\` before \`bun test\` in CI — ` +
            `silently skipping these tests on a CI runner re-opens the dev-vs-binary ` +
            `regression gap they exist to catch.`,
        );
      }
      return null;
    }
    dir = dirname(dir);
  }
  if (process.env.CI) {
    throw new Error(
      `[orchestrator-entry.test] Could not locate workspace root from ${import.meta.dir}; ` +
        `binary-gated tests cannot run in CI without a build.`,
    );
  }
  return null;
}
