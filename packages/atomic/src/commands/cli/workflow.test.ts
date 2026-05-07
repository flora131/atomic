/**
 * Tests for the new workflow.ts additions:
 *   - dispatchExternal argv/env composition (via pure helpers)
 *   - hard-block on activeBroken
 *   - rebuildWorkflowCommand re-syncs dynamic options
 *   - dispatch() return type is Promise<void> for both branches
 */

import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { constants as osConstants } from "node:os";
import type { ExternalWorkflow } from "@bastani/atomic-sdk";

// ─── Import module under test ────────────────────────────────────────────────
// Static import loads real executor first; then we can replace Bun.spawn for
// testing external dispatch without actually spawning processes.

const {
  buildExternalDispatchArgv,
  buildExternalDispatchEnv,
  dispatch,
  buildWorkflowCommand,
  rebuildWorkflowCommand,
  getActiveRegistry,
  getActiveBroken,
} = await import("./workflow.ts");

const { createRegistry } = await import("@bastani/atomic-sdk/registry");
const { defineWorkflow } = await import("@bastani/atomic-sdk/define-workflow");

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeExternal(overrides: Partial<ExternalWorkflow> = {}): ExternalWorkflow {
  return {
    kind: "external",
    name: "my-ext",
    agent: "claude",
    inputs: [],
    description: "test external",
    source: { command: "/usr/bin/mybin", args: ["--config", "cfg.json"] },
    ...overrides,
  };
}

// ─── buildExternalDispatchArgv ────────────────────────────────────────────────

describe("buildExternalDispatchArgv", () => {
  test("basic structure without detach, no extra inputs", () => {
    const w = makeExternal();
    const argv = buildExternalDispatchArgv(w, {}, false, "deadbeef01234567deadbeef01234567");
    expect(argv).toEqual([
      "/usr/bin/mybin",
      "--config", "cfg.json",
      "_atomic-run",
      "--dispatch-token=deadbeef01234567deadbeef01234567",
      "--name", "my-ext",
      "--agent", "claude",
    ]);
  });

  test("includes --detach when detach=true", () => {
    const w = makeExternal();
    const argv = buildExternalDispatchArgv(w, {}, true, "aabbccdd00112233aabbccdd00112233");
    expect(argv).toContain("--detach");
    const detachIdx = argv.indexOf("--detach");
    // --detach appears after --agent
    const agentIdx = argv.indexOf("--agent");
    expect(detachIdx).toBeGreaterThan(agentIdx);
  });

  test("omits --detach when detach=false", () => {
    const w = makeExternal();
    const argv = buildExternalDispatchArgv(w, {}, false, "token");
    expect(argv).not.toContain("--detach");
  });

  test("appends cliInputs as --key value pairs", () => {
    const w = makeExternal();
    const argv = buildExternalDispatchArgv(
      w,
      { prompt: "hello world", max_loops: "3" },
      false,
      "token",
    );
    expect(argv).toContain("--prompt");
    expect(argv).toContain("hello world");
    expect(argv).toContain("--max_loops");
    expect(argv).toContain("3");
  });

  test("token appears in dispatch-token flag", () => {
    const w = makeExternal();
    const token = "cafebabe12345678cafebabe12345678";
    const argv = buildExternalDispatchArgv(w, {}, false, token);
    expect(argv).toContain(`--dispatch-token=${token}`);
  });

  test("command is first element", () => {
    const w = makeExternal({ source: { command: "/bin/sh", args: [] } });
    const argv = buildExternalDispatchArgv(w, {}, false, "tok");
    expect(argv[0]).toBe("/bin/sh");
  });

  test("source.args are spread before _atomic-run", () => {
    const w = makeExternal({ source: { command: "/bin/sh", args: ["arg1", "arg2"] } });
    const argv = buildExternalDispatchArgv(w, {}, false, "tok");
    const atomicRunIdx = argv.indexOf("_atomic-run");
    const arg1Idx = argv.indexOf("arg1");
    const arg2Idx = argv.indexOf("arg2");
    expect(arg1Idx).toBeLessThan(atomicRunIdx);
    expect(arg2Idx).toBeLessThan(atomicRunIdx);
  });

  test("full argv matches expected shape with all pieces", () => {
    const w = makeExternal({
      name: "wf",
      agent: "opencode",
      source: { command: "/bin/wf-runner", args: [] },
    });
    const argv = buildExternalDispatchArgv(w, { topic: "auth" }, true, "tok123");
    expect(argv).toEqual([
      "/bin/wf-runner",
      "_atomic-run",
      "--dispatch-token=tok123",
      "--name", "wf",
      "--agent", "opencode",
      "--detach",
      "--topic", "auth",
    ]);
  });
});

// ─── buildExternalDispatchEnv ─────────────────────────────────────────────────

describe("buildExternalDispatchEnv", () => {
  test("contains ATOMIC_HOST=1", () => {
    const env = buildExternalDispatchEnv("sometoken");
    expect(env["ATOMIC_HOST"]).toBe("1");
  });

  test("contains ATOMIC_DISPATCH_TOKEN matching the supplied token", () => {
    const token = "0011223344556677001122334455667a";
    const env = buildExternalDispatchEnv(token);
    expect(env["ATOMIC_DISPATCH_TOKEN"]).toBe(token);
  });

  test("argv token and env token match", () => {
    const w = makeExternal();
    const token = "ffffffffffffffffffffffffffffffff";
    const argv = buildExternalDispatchArgv(w, {}, false, token);
    const env = buildExternalDispatchEnv(token);
    // Token in argv is --dispatch-token=<token>
    const dispatchTokenArg = argv.find((a) => a.startsWith("--dispatch-token="));
    expect(dispatchTokenArg).toBe(`--dispatch-token=${env["ATOMIC_DISPATCH_TOKEN"]}`);
  });
});

// ─── Hard-block: activeBroken populated ───────────────────────────────────────

/** Intercept process.exit for the duration of an async fn; return {exitCode, threw}. */
async function withExitIntercept(fn: () => Promise<unknown>): Promise<{ exitCode: number | undefined; threw: boolean }> {
  let exitCode: number | undefined;
  let threw = false;
  const origExit = process.exit;
  process.exit = ((code?: number) => {
    exitCode = code as number;
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;
  try {
    await fn();
  } catch {
    threw = true;
  } finally {
    process.exit = origExit;
  }
  return { exitCode, threw };
}

describe("hard-block on activeBroken", () => {
  beforeEach(() => {
    // Reset activeBroken to empty before each test to avoid cross-test pollution.
    rebuildWorkflowCommand(getActiveRegistry(), new Map());
  });

  test("action writes all three diagnostic lines to stderr and calls process.exit(2) — non-empty registry", async () => {
    // Build a registry that contains broken-wf so the name validator can
    // look it up and accept it via the broken-alias short-circuit (Iteration 6 §5.6.1).
    const wf = defineWorkflow({
      name: "broken-wf",
      inputs: [],
    })
      .for("claude")
      .run(async () => {})
      .compile();
    const registry = createRegistry().register(wf);

    const brokenEntry = {
      alias: "broken-wf",
      origin: "local" as const,
      agents: ["claude" as const],
      reason: "SyntaxError in source file",
      source: "/home/user/.config/atomic/settings.json",
      fix: "Check the syntax of your workflow file",
    };

    const brokenMap = new Map([["claude/broken-wf", brokenEntry]]);
    // Set module-level activeBroken and activeRegistry so both the name
    // validator (isBrokenAlias short-circuit) and the action (blockIfBroken)
    // see the broken entry.
    rebuildWorkflowCommand(registry, brokenMap);

    // Use liveRegistry=true so the command reads activeRegistry / activeBroken
    // lazily on every parse — this is the broken-alias path added in Iteration 6.
    const cmd = buildWorkflowCommand(registry, true);
    cmd.exitOverride();

    // Capture stderr and intercept process.exit.
    let captured = "";
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;

    const { exitCode, threw } = await withExitIntercept(() =>
      cmd.parseAsync(["node", "cli", "-n", "broken-wf", "-a", "claude"]),
    ).finally(() => {
      process.stderr.write = origWrite;
    });

    expect(threw).toBe(true);
    expect(exitCode).toBe(2);
    expect(captured).toContain("reason ·");
    expect(captured).toContain("source ·");
    expect(captured).toContain("fix    ·");
    expect(captured).toContain("SyntaxError in source file");
    expect(captured).toContain("/home/user/.config/atomic/settings.json");
    expect(captured).toContain("Check the syntax of your workflow file");
  });

  // ─── §8.3: Per-agent broken scoping ────────────────────────────────────────
  //
  // (claude, Y) broken but (opencode, Y) healthy:
  //   - `-n Y -a opencode` must NOT exit 2
  //   - `-n Y -a claude`   must exit 2

  test("§8.3 per-agent scoping: broken claude/scoped-wf does NOT block opencode/scoped-wf", async () => {
    const { spyOn } = await import("bun:test");

    // Register scoped-wf for both claude and opencode.
    const wfClaude = defineWorkflow({
      name: "scoped-wf",
      inputs: [],
    })
      .for("claude")
      .run(async () => {})
      .compile();

    // Build an ExternalWorkflow for the opencode variant so dispatch goes
    // through Bun.spawn (easily stubbable).
    const wfOpencode: import("@bastani/atomic-sdk").ExternalWorkflow = {
      kind: "external",
      name: "scoped-wf",
      agent: "opencode",
      description: "scoped-wf opencode variant",
      inputs: [],
      source: { command: "/usr/bin/scoped-runner", args: [] },
    };

    const registry = createRegistry().register(wfClaude).upsert(wfOpencode);

    // Mark claude/scoped-wf broken; opencode/scoped-wf is healthy.
    const brokenMap = new Map([
      ["claude/scoped-wf", {
        alias: "scoped-wf",
        origin: "local" as const,
        agents: ["claude" as const],
        reason: "Import failed",
        source: "settings.json",
        fix: "Fix the import",
      }],
    ]);
    rebuildWorkflowCommand(registry, brokenMap);

    const cmd = buildWorkflowCommand(registry, true);
    cmd.exitOverride();

    // Stub Bun.spawn so the opencode dispatch does not actually spawn.
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation((() => ({
      exited: Promise.resolve(0),
      stdin: null,
      stdout: null,
      stderr: null,
    })) as unknown as typeof Bun.spawn);

    let caughtErr: Error | undefined;
    try {
      await cmd.parseAsync(["node", "cli", "-n", "scoped-wf", "-a", "opencode"]);
    } catch (err) {
      caughtErr = err instanceof Error ? err : new Error(String(err));
    } finally {
      spawnSpy.mockRestore();
    }

    // Must NOT have called process.exit(2); any error must not be the broken-block.
    if (caughtErr) {
      expect(caughtErr.message).not.toContain("process.exit(2)");
    }
  });

  test("§8.3 per-agent scoping: broken claude/scoped-wf exits 2 for -a claude", async () => {
    const wfClaude = defineWorkflow({
      name: "scoped-wf",
      inputs: [],
    })
      .for("claude")
      .run(async () => {})
      .compile();

    const registry = createRegistry().register(wfClaude);

    const brokenMap = new Map([
      ["claude/scoped-wf", {
        alias: "scoped-wf",
        origin: "local" as const,
        agents: ["claude" as const],
        reason: "Import failed",
        source: "settings.json",
        fix: "Fix the import",
      }],
    ]);
    rebuildWorkflowCommand(registry, brokenMap);

    const cmd = buildWorkflowCommand(registry, true);
    cmd.exitOverride();

    let captured = "";
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;

    const { exitCode, threw } = await withExitIntercept(() =>
      cmd.parseAsync(["node", "cli", "-n", "scoped-wf", "-a", "claude"]),
    ).finally(() => {
      process.stderr.write = origWrite;
    });

    expect(threw).toBe(true);
    expect(exitCode).toBe(2);
    expect(captured).toContain("reason ·");
    expect(captured).toContain("Import failed");
  });

  // ─── §8.3: Listener leak smoke test ────────────────────────────────────────
  //
  // Call rebuildWorkflowCommand 20 times; assert listener count ≤ 1 on a
  // dynamic option that the builtin registry declares (design-system).

  test("§8.3 listener leak: 20 rebuilds do not accumulate listeners on design-system option", async () => {
    const { createBuiltinRegistry: cbr } = await import("../builtin-registry.ts");
    const { workflowCommand: wc } = await import("./workflow.ts");

    const reg = cbr();
    for (let i = 0; i < 20; i++) {
      rebuildWorkflowCommand(reg, new Map());
    }

    // Commander registers listeners as "option:<long-without-dashes>".
    // The design-system option flag is "--design-system" → event "option:design-system".
    const count = (wc as unknown as { listenerCount(event: string): number }).listenerCount(
      "option:design-system",
    );
    expect(count).toBeLessThanOrEqual(1);
  });
});

// ─── rebuildWorkflowCommand re-syncs dynamic options ─────────────────────────

describe("rebuildWorkflowCommand", () => {
  test("adds new dynamic options from fresh registry", async () => {
    const { workflowCommand } = await import("./workflow.ts");
    const { createBuiltinRegistry } = await import("../builtin-registry.ts");

    // Build registry with a workflow that has a unique input.
    const wf = defineWorkflow({
      name: "new-workflow",
      inputs: [{ name: "custom-option", type: "text", required: false }],
    })
      .for("claude")
      .run(async () => {})
      .compile();

    const registry = createBuiltinRegistry().upsert(wf);
    rebuildWorkflowCommand(registry, new Map());

    const hasCustomOption = workflowCommand.options.some(
      (o) => o.long === "--custom-option",
    );
    expect(hasCustomOption).toBe(true);
  });

  test("getActiveRegistry returns the updated registry", async () => {
    const { createBuiltinRegistry } = await import("../builtin-registry.ts");
    const freshRegistry = createBuiltinRegistry();
    rebuildWorkflowCommand(freshRegistry, new Map());
    expect(getActiveRegistry()).toBe(freshRegistry);
  });

  test("getActiveBroken returns the updated broken map", () => {
    const brokenMap = new Map([
      ["claude/test-wf", {
        alias: "test-wf",
        origin: "local" as const,
        agents: ["claude" as const],
        reason: "test reason",
        source: "test.json",
        fix: "test fix",
      }],
    ]);
    rebuildWorkflowCommand(getActiveRegistry(), brokenMap);
    expect(getActiveBroken()).toBe(brokenMap);
  });
});

// ─── dispatch() return type is Promise<void> ─────────────────────────────────

describe("dispatch() type annotation", () => {
  test("dispatch signature is compatible with () => Promise<void>", () => {
    // This is a compile-time assertion. If dispatch returned Promise<never>
    // (as the old throw branch did), TypeScript would reject the assignment.
    const _: (
      workflow: Parameters<typeof dispatch>[0],
      inputs: Parameters<typeof dispatch>[1],
      detach: Parameters<typeof dispatch>[2],
    ) => Promise<void> = dispatch;
    expect(_).toBeDefined();
  });
});

// ─── R1 regression: name validator reads activeRegistry lazily ────────────────
//
// §5.6.3 closure-staleness invariant:
//   When liveRegistry === true, allNames must NOT be captured at buildWorkflowCommand
//   call time.  rebuildWorkflowCommand must make subsequent parseAsync calls see
//   the updated name set.

// ─── R1 fixtures (module-level so top-level await is valid) ──────────────────

const { createBuiltinRegistry } = await import("../builtin-registry.ts");

// Custom ExternalWorkflow fixture for R1 tests.
const r1CustomWorkflow: ExternalWorkflow = {
  kind: "external",
  name: "my-custom-wf",
  agent: "claude",
  description: "custom workflow for R1 regression test",
  inputs: [],
  source: { command: "/usr/bin/my-custom-cli", args: [] },
};

const r1RegistryWithCustom = createBuiltinRegistry().upsert(r1CustomWorkflow);

describe("R1 regression — name validator reads activeRegistry lazily after rebuildWorkflowCommand", () => {
  // Reset module state before each test so registry pollution from other
  // describe blocks cannot interfere.
  beforeEach(() => {
    rebuildWorkflowCommand(createBuiltinRegistry(), new Map());
  });

  test("positive: -n my-custom-wf is accepted after rebuildWorkflowCommand adds it", async () => {
    // Build the singleton-style command (liveRegistry=true so it reads
    // activeRegistry lazily on each parse call).
    const cmd = buildWorkflowCommand(createBuiltinRegistry(), true);
    cmd.exitOverride();

    // Hot-swap the module-level activeRegistry to include the custom workflow.
    rebuildWorkflowCommand(r1RegistryWithCustom, new Map());

    // Stub Bun.spawn so dispatchExternal does not actually spawn a subprocess.
    // The validator check happens at option-parse time, well before dispatch.
    const origSpawn = Bun.spawn;
    Bun.spawn = (() => {
      return {
        exited: Promise.resolve(0),
        pid: 0,
        kill: () => {},
        stdout: null,
        stderr: null,
        stdin: null,
      };
    }) as unknown as typeof Bun.spawn;

    let caughtError: Error | undefined;
    try {
      await cmd.parseAsync(["node", "atomic", "workflow", "-n", "my-custom-wf", "-a", "claude"]);
    } catch (err) {
      caughtError = err instanceof Error ? err : new Error(String(err));
    } finally {
      Bun.spawn = origSpawn;
    }

    // The name-validator must NOT have fired.  Any other error (e.g. from
    // Commander's exitOverride) is acceptable; the important thing is the
    // exact closure-staleness message did not appear.
    if (caughtError) {
      expect(caughtError.message).not.toContain(
        '[atomic/workflow] Unknown workflow name "my-custom-wf"',
      );
    }
  });

  test("negative: unknown name still throws with post-rebuild Available list that includes my-custom-wf", async () => {
    // Hot-swap the module-level activeRegistry to include the custom workflow.
    rebuildWorkflowCommand(r1RegistryWithCustom, new Map());

    // Build a fresh command that reads the live registry.
    const cmd = buildWorkflowCommand(createBuiltinRegistry(), true);
    cmd.exitOverride();

    let caughtError: Error | undefined;
    try {
      await cmd.parseAsync(["node", "atomic", "workflow", "-n", "totally-unknown-wf", "-a", "claude"]);
    } catch (err) {
      caughtError = err instanceof Error ? err : new Error(String(err));
    }

    // The validator must throw with the expected template.
    expect(caughtError).toBeDefined();
    expect(caughtError!.message).toContain(
      '[atomic/workflow] Unknown workflow name "totally-unknown-wf"',
    );
    // The "Available: …" list must include the newly registered custom workflow.
    expect(caughtError!.message).toContain("my-custom-wf");
  });
});

// ─── ATOMIC_DEBUG=1 dispatch-trace log ───────────────────────────────────────

describe("ATOMIC_DEBUG=1 dispatch-trace log", () => {
  // Build a minimal registry with one builtin workflow that has one input.
  const traceWf = defineWorkflow({
    name: "trace-wf",
    inputs: [{ name: "repo", type: "text", required: false }],
  })
    .for("claude")
    .run(async () => {})
    .compile();
  const traceRegistry = createRegistry().register(traceWf);

  /** Capture process.stderr.write output for the duration of `fn`. */
  async function captureStderr(fn: () => Promise<unknown>): Promise<string> {
    let captured = "";
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      await fn();
    } catch {
      // Swallow — dispatch errors are expected in these tests.
    } finally {
      process.stderr.write = orig;
    }
    return captured;
  }

  /** Stub Bun.spawn so dispatch does not actually launch subprocesses. */
  function stubSpawn(): () => void {
    const origSpawn = Bun.spawn;
    (Bun as unknown as { spawn: unknown }).spawn = () => ({
      exited: Promise.resolve(0),
      stdin: null,
      stdout: null,
      stderr: null,
    });
    return () => { (Bun as unknown as { spawn: unknown }).spawn = origSpawn; };
  }

  /** Stub process.exit so tests do not terminate the runner. */
  function stubExit(): () => void {
    const origExit = process.exit;
    process.exit = ((_code?: number) => { throw new Error("exit"); }) as typeof process.exit;
    return () => { process.exit = origExit; };
  }

  /** Set / restore ATOMIC_DEBUG around a test. */
  function withDebug(value: string | undefined): () => void {
    const saved = process.env.ATOMIC_DEBUG;
    if (value === undefined) delete process.env.ATOMIC_DEBUG;
    else process.env.ATOMIC_DEBUG = value;
    return () => {
      if (saved === undefined) delete process.env.ATOMIC_DEBUG;
      else process.env.ATOMIC_DEBUG = saved;
    };
  }

  test("emits RFC-format line to stderr when ATOMIC_DEBUG=1 (no inputs supplied)", async () => {
    const cmd = buildWorkflowCommand(traceRegistry);
    cmd.exitOverride();

    const restoreSpawn = stubSpawn();
    const restoreExit = stubExit();
    const restoreDebug = withDebug("1");

    const stderr = await captureStderr(() =>
      cmd.parseAsync(["node", "cli", "-n", "trace-wf", "-a", "claude"]),
    );

    restoreSpawn();
    restoreExit();
    restoreDebug();

    expect(stderr).toContain(
      "[atomic/workflow] dispatching trace-wf/claude kind=builtin inputs=[]",
    );
  });

  test("includes key names (not values) when inputs supplied", async () => {
    const cmd = buildWorkflowCommand(traceRegistry);
    cmd.exitOverride();

    const restoreSpawn = stubSpawn();
    const restoreExit = stubExit();
    const restoreDebug = withDebug("1");

    const stderr = await captureStderr(() =>
      cmd.parseAsync(["node", "cli", "-n", "trace-wf", "-a", "claude", "--repo", "my-secret-value"]),
    );

    restoreSpawn();
    restoreExit();
    restoreDebug();

    expect(stderr).toContain(
      "[atomic/workflow] dispatching trace-wf/claude kind=builtin inputs=[repo]",
    );
    // Must NOT leak the value.
    expect(stderr).not.toContain("my-secret-value");
  });

  test("no dispatch-trace log when ATOMIC_DEBUG is unset", async () => {
    const cmd = buildWorkflowCommand(traceRegistry);
    cmd.exitOverride();

    const restoreSpawn = stubSpawn();
    const restoreExit = stubExit();
    const restoreDebug = withDebug(undefined);

    const stderr = await captureStderr(() =>
      cmd.parseAsync(["node", "cli", "-n", "trace-wf", "-a", "claude"]),
    );

    restoreSpawn();
    restoreExit();
    restoreDebug();

    expect(stderr).not.toContain("[atomic/workflow] dispatching");
  });

  test("no dispatch-trace log when ATOMIC_DEBUG=0", async () => {
    const cmd = buildWorkflowCommand(traceRegistry);
    cmd.exitOverride();

    const restoreSpawn = stubSpawn();
    const restoreExit = stubExit();
    const restoreDebug = withDebug("0");

    const stderr = await captureStderr(() =>
      cmd.parseAsync(["node", "cli", "-n", "trace-wf", "-a", "claude"]),
    );

    restoreSpawn();
    restoreExit();
    restoreDebug();

    expect(stderr).not.toContain("[atomic/workflow] dispatching");
  });
});

// ─── R2 regression: custom-workflow-only inputs forwarded to subprocess ───────
//
// Previously the action closed over a build-time `unionInputs` snapshot, so
// custom-workflow-only inputs were silently dropped before the _atomic-run
// spawn.  Fix made the action recompute `effectiveInputs = buildInputUnion(
// listWorkflows(effectiveRegistry))` on every invocation.  These tests enforce:
//   1. Positive  — custom-only input `uniq-input` appears in spawn argv.
//   2. Symmetric — builtin input `prompt` (from ralph/claude) still forwarded.
//   3. Entrypoint — spawn argv contains `_atomic-run` and `--dispatch-token=`.

// External workflow that declares an input no builtin owns.
const r2CustomWorkflow: ExternalWorkflow = {
  kind: "external",
  name: "r2-custom-wf",
  agent: "claude",
  description: "custom workflow for R2 regression test",
  inputs: [
    { name: "uniq-input", type: "text", required: false, description: "unique to this custom wf" },
  ],
  source: { command: "/usr/bin/r2-runner", args: [] },
};

// External wrapper of ralph that forces the Bun.spawn path.
// (The builtin ralph/claude is a WorkflowDefinition and uses runWorkflow, not Bun.spawn.)
const r2RalphExternal: ExternalWorkflow = {
  kind: "external",
  name: "ralph",
  agent: "claude",
  description: "ralph external wrapper for R2 symmetric test",
  inputs: [
    { name: "prompt", type: "text", required: true, description: "task prompt" },
    { name: "max_loops", type: "integer", description: "max loops" },
  ],
  source: { command: "/usr/bin/r2-ralph-runner", args: [] },
};

describe("R2 regression — custom-workflow-only inputs forwarded via spawn", () => {
  test("positive: custom-only --uniq-input value123 appears in spawn argv", async () => {
    const { spyOn } = await import("bun:test");
    const registry = createBuiltinRegistry().upsert(r2CustomWorkflow);
    const cmd = buildWorkflowCommand(registry, false);
    cmd.exitOverride();

    let capturedArgv: string[] = [];
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((argv: string[]) => {
      capturedArgv = argv;
      return { exited: Promise.resolve(0) } as ReturnType<typeof Bun.spawn>;
    }) as unknown as typeof Bun.spawn);

    try {
      await cmd.parseAsync([
        "node", "atomic", "workflow",
        "-n", "r2-custom-wf",
        "-a", "claude",
        "--uniq-input", "value123",
      ]);
    } finally {
      spawnSpy.mockRestore();
    }

    const idx = capturedArgv.indexOf("--uniq-input");
    expect(idx).toBeGreaterThan(-1);
    expect(capturedArgv[idx + 1]).toBe("value123");
  });

  test("symmetric: builtin --prompt still forwarded when ralph overridden with external variant", async () => {
    const { spyOn } = await import("bun:test");
    // Override ralph/claude with an external wrapper so dispatch goes through
    // Bun.spawn (the builtin ralph/claude is a WorkflowDefinition, not ExternalWorkflow).
    const registry = createBuiltinRegistry().upsert(r2RalphExternal);
    const cmd = buildWorkflowCommand(registry, false);
    cmd.exitOverride();

    let capturedArgv: string[] = [];
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((argv: string[]) => {
      capturedArgv = argv;
      return { exited: Promise.resolve(0) } as ReturnType<typeof Bun.spawn>;
    }) as unknown as typeof Bun.spawn);

    try {
      await cmd.parseAsync([
        "node", "atomic", "workflow",
        "-n", "ralph",
        "-a", "claude",
        "--prompt", "refactor the auth module",
      ]);
    } finally {
      spawnSpy.mockRestore();
    }

    const idx = capturedArgv.indexOf("--prompt");
    expect(idx).toBeGreaterThan(-1);
    expect(capturedArgv[idx + 1]).toBe("refactor the auth module");
  });

  test("entrypoint: spawn argv contains _atomic-run and --dispatch-token=", async () => {
    const { spyOn } = await import("bun:test");
    const registry = createBuiltinRegistry().upsert(r2CustomWorkflow);
    const cmd = buildWorkflowCommand(registry, false);
    cmd.exitOverride();

    let capturedArgv: string[] = [];
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((argv: string[]) => {
      capturedArgv = argv;
      return { exited: Promise.resolve(0) } as ReturnType<typeof Bun.spawn>;
    }) as unknown as typeof Bun.spawn);

    try {
      await cmd.parseAsync([
        "node", "atomic", "workflow",
        "-n", "r2-custom-wf",
        "-a", "claude",
        "--uniq-input", "whatever",
      ]);
    } finally {
      spawnSpy.mockRestore();
    }

    expect(capturedArgv).toContain("_atomic-run");
    expect(capturedArgv.some((a) => a.startsWith("--dispatch-token="))).toBe(true);
  });
});

// ─── Signal-aware exit propagation in dispatchExternal ───────────────────────
//
// Covers Iteration 9 §5.6: 128+N exit codes for signals, non-numeric exit
// fallback to exit(1), numeric non-zero passthrough, and zero / success.

describe("dispatchExternal signal-aware exit propagation", () => {
  // A minimal ExternalWorkflow fixture for this suite.
  const sigWf: ExternalWorkflow = {
    kind: "external",
    name: "sig-wf",
    agent: "claude",
    description: "signal test workflow",
    inputs: [],
    source: { command: "/usr/bin/sig-runner", args: [] },
  };

  // Build a registry that contains sig-wf.
  const sigRegistry = createBuiltinRegistry().upsert(sigWf);

  /** Build a Bun.spawn stub that returns a controlled child. */
  function makeSpawnStub(
    signalCode: string | null,
    exited: number | null,
  ): typeof Bun.spawn {
    return ((_argv: string[], _opts?: unknown) => ({
      exited: Promise.resolve(exited),
      signalCode,
      stdin: null,
      stdout: null,
      stderr: null,
      pid: 0,
      kill: () => {},
    })) as unknown as typeof Bun.spawn;
  }

  /** Run dispatchExternal for sig-wf via the command, capturing exit+stderr. */
  async function runSigTest(
    signalCode: string | null,
    exitedValue: number | null,
  ): Promise<{ exitCode: number | undefined; stderr: string }> {
    const cmd = buildWorkflowCommand(sigRegistry, false);
    cmd.exitOverride();

    let stderrOut = "";
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      stderrOut += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;

    let exitCode: number | undefined;
    const origExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code as number;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;

    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(
      makeSpawnStub(signalCode, exitedValue),
    );

    try {
      await cmd.parseAsync(["node", "cli", "-n", "sig-wf", "-a", "claude"]);
    } catch {
      // Swallow process.exit throw and Commander exitOverride throws.
    } finally {
      process.stderr.write = origWrite;
      process.exit = origExit;
      spawnSpy.mockRestore();
    }

    return { exitCode, stderr: stderrOut };
  }

  test("SIGTERM → exit 128 + os.constants.signals.SIGTERM with signal message", async () => {
    const { exitCode, stderr } = await runSigTest("SIGTERM", null);
    expect(exitCode).toBe(128 + osConstants.signals.SIGTERM);
    expect(stderr).toContain('[atomic/workflows] "sig-wf": child terminated by signal SIGTERM\n');
  });

  test("SIGINT → exit 128 + os.constants.signals.SIGINT with signal message", async () => {
    const { exitCode, stderr } = await runSigTest("SIGINT", null);
    expect(exitCode).toBe(128 + osConstants.signals.SIGINT);
    expect(stderr).toContain("signal SIGINT");
  });

  test("SIGUSR2 → exit 128 + os.constants.signals.SIGUSR2 with signal name in stderr", async () => {
    const { exitCode, stderr } = await runSigTest("SIGUSR2", null);
    expect(exitCode).toBe(128 + osConstants.signals.SIGUSR2);
    expect(stderr).toContain("SIGUSR2");
  });

  test("synthetic unknown signal → exit 129 (UNKNOWN_SIGNAL_EXIT) with signal name in stderr", async () => {
    // Cast needed: makeSpawnStub accepts string|null but TypeScript's Bun types
    // narrow signalCode to NodeJS.Signals. We use a string not in os.constants.signals
    // to exercise the UNKNOWN_SIGNAL_EXIT=129 branch.
    const fakeSignal = "SIGFAKE_NOT_REAL_999";
    const { exitCode, stderr } = await runSigTest(fakeSignal, null);
    expect(exitCode).toBe(129);
    expect(stderr).toContain(fakeSignal);
  });

  test("non-numeric exit (null, no signal) → exit(1) with diagnostic", async () => {
    const { exitCode, stderr } = await runSigTest(null, null);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('[atomic/workflows] "sig-wf": child exited without numeric code (got null)\n');
  });

  test("numeric non-zero exit → exit(code), no signal stderr line", async () => {
    const { exitCode, stderr } = await runSigTest(null, 2);
    expect(exitCode).toBe(2);
    expect(stderr).not.toContain("child terminated by signal");
  });

  test("zero exit → process.exit NOT called", async () => {
    const { exitCode } = await runSigTest(null, 0);
    expect(exitCode).toBeUndefined();
  });
});
