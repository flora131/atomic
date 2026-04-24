import { test, expect, describe, afterEach } from "bun:test";
import type { WorkflowRunOptions } from "../../../src/sdk/runtime/executor.ts";
import { runOrchestrator } from "../../../src/sdk/runtime/executor.ts";
// Import validateOrchestratorEnv from the un-mocked sub-module so env-var
// tests are not affected by mock.module("executor.ts") in worker/command tests.
import { validateOrchestratorEnv } from "../../../src/sdk/runtime/executor-env.ts";
import type { WorkflowDefinition } from "../../../src/sdk/types.ts";
import { defineWorkflow } from "../../../src/sdk/define-workflow.ts";

// ---------------------------------------------------------------------------
// WorkflowRunOptions shape
// ---------------------------------------------------------------------------

describe("WorkflowRunOptions shape", () => {
  test("accepts entrypointFile and workflowKey (compile-time coverage)", () => {
    // This test validates the required fields are present in the interface.
    // At runtime this is a no-op — the real check is that tsc compiles without errors.
    const opts = {
      definition: defineWorkflow({ name: "hello-world" })
        .for("claude")
        .run(async () => {})
        .compile(),
      agent: "claude" as const,
      entrypointFile: "/home/user/src/worker.ts",
      workflowKey: "claude/hello-world",
    } satisfies WorkflowRunOptions;

    expect(opts.entrypointFile).toBe("/home/user/src/worker.ts");
    expect(opts.workflowKey).toBe("claude/hello-world");
  });

  test("workflowKey follows <agent>/<name> format", () => {
    const opts: WorkflowRunOptions = {
      definition: defineWorkflow({ name: "deep-research" })
        .for("copilot")
        .run(async () => {})
        .compile(),
      agent: "copilot",
      entrypointFile: "/app/worker.ts",
      workflowKey: "copilot/deep-research",
    };
    expect(opts.workflowKey).toMatch(/^[a-z]+\/.+/);
  });

  test("WorkflowRunOptions does not have workflowFile field", () => {
    // The old API used workflowFile; the new API uses entrypointFile + workflowKey.
    // This checks the interface no longer exposes workflowFile.
    const opts: WorkflowRunOptions = {
      definition: defineWorkflow({ name: "wf" })
        .for("opencode")
        .run(async () => {})
        .compile(),
      agent: "opencode",
      entrypointFile: "/src/worker.ts",
      workflowKey: "opencode/wf",
    };
    // @ts-expect-error — workflowFile is not a field on WorkflowRunOptions
    const _unused = (opts as Record<string, unknown>).workflowFile;
    expect("workflowFile" in opts).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateOrchestratorEnv — env var validation
//
// Uses validateOrchestratorEnv directly (imported from executor-env.ts, NOT
// from executor.ts) so that mock.module("executor.ts") in worker.test.ts and
// workflow-command.test.ts does not interfere with these tests.
// ---------------------------------------------------------------------------

describe("runOrchestrator env var validation", () => {
  const REQUIRED_VARS = ["ATOMIC_WF_ID", "ATOMIC_WF_TMUX", "ATOMIC_WF_AGENT", "ATOMIC_WF_CWD"] as const;

  // Save and restore process.env around each test.
  const savedEnv: Partial<Record<string, string>> = {};

  function saveEnv(): void {
    for (const key of [...REQUIRED_VARS, "ATOMIC_ORCHESTRATOR_MODE", "ATOMIC_WF_KEY", "ATOMIC_WF_INPUTS"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  function restoreEnv(): void {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  afterEach(restoreEnv);

  test("throws when ATOMIC_WF_ID is missing", () => {
    saveEnv();
    // Set all required vars except ATOMIC_WF_ID
    process.env.ATOMIC_WF_TMUX = "atomic-wf-claude-hello-world-abc";
    process.env.ATOMIC_WF_AGENT = "claude";
    process.env.ATOMIC_WF_CWD = "/tmp";

    expect(() => validateOrchestratorEnv()).toThrow("ATOMIC_WF_ID");
  });

  test("throws when ATOMIC_WF_TMUX is missing", () => {
    saveEnv();
    process.env.ATOMIC_WF_ID = "wf-run-123";
    process.env.ATOMIC_WF_AGENT = "claude";
    process.env.ATOMIC_WF_CWD = "/tmp";

    expect(() => validateOrchestratorEnv()).toThrow("ATOMIC_WF_TMUX");
  });

  test("throws when ATOMIC_WF_AGENT is missing", () => {
    saveEnv();
    process.env.ATOMIC_WF_ID = "wf-run-123";
    process.env.ATOMIC_WF_TMUX = "atomic-wf-claude-hello-world-abc";
    process.env.ATOMIC_WF_CWD = "/tmp";

    expect(() => validateOrchestratorEnv()).toThrow("ATOMIC_WF_AGENT");
  });

  test("throws when ATOMIC_WF_CWD is missing", () => {
    saveEnv();
    process.env.ATOMIC_WF_ID = "wf-run-123";
    process.env.ATOMIC_WF_TMUX = "atomic-wf-claude-hello-world-abc";
    process.env.ATOMIC_WF_AGENT = "claude";

    expect(() => validateOrchestratorEnv()).toThrow("ATOMIC_WF_CWD");
  });

  test("throws for invalid ATOMIC_WF_AGENT value", () => {
    saveEnv();
    process.env.ATOMIC_WF_ID = "wf-run-123";
    process.env.ATOMIC_WF_TMUX = "atomic-wf-bad-hello-world-abc";
    process.env.ATOMIC_WF_AGENT = "not-an-agent";
    process.env.ATOMIC_WF_CWD = "/tmp";

    expect(() => validateOrchestratorEnv()).toThrow(/Invalid ATOMIC_WF_AGENT/);
  });

  test("error message for invalid agent includes the bad value", () => {
    saveEnv();
    process.env.ATOMIC_WF_ID = "wf-run-123";
    process.env.ATOMIC_WF_TMUX = "atomic-wf-bad-hello-world-abc";
    process.env.ATOMIC_WF_AGENT = "gpt";
    process.env.ATOMIC_WF_CWD = "/tmp";

    let message = "";
    try {
      validateOrchestratorEnv();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("gpt");
  });
});

// ---------------------------------------------------------------------------
// runOrchestrator — accepts WorkflowDefinition (not a string path)
// ---------------------------------------------------------------------------

describe("runOrchestrator accepts WorkflowDefinition", () => {
  test("signature accepts a compiled WorkflowDefinition", () => {
    // Compile-time test: runOrchestrator must accept a WorkflowDefinition object.
    const definition = defineWorkflow({ name: "test-wf" })
      .for("copilot")
      .run(async () => {})
      .compile();

    // Type must be WorkflowDefinition — if it were string the tsc would reject it.
    const _check: (d: WorkflowDefinition) => Promise<void> = runOrchestrator;
    expect(typeof _check).toBe("function");
    expect(definition.__brand).toBe("WorkflowDefinition");
  });

  test("runOrchestrator does not accept a string path (compile-time)", () => {
    // This confirms the old API (runOrchestrator("<path>")) is gone.
    // The @ts-expect-error verifies that a string is rejected by TypeScript.
    const _fn = runOrchestrator;
    // @ts-expect-error — string path is not accepted; WorkflowDefinition required
    const _call = () => _fn("/some/path/to/workflow.ts");
    expect(typeof _fn).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Launcher script env vars — ATOMIC_ORCHESTRATOR_MODE and ATOMIC_WF_KEY
// ---------------------------------------------------------------------------

describe("launcher script env var names", () => {
  test("ATOMIC_ORCHESTRATOR_MODE is the orchestrator re-entry signal (not ATOMIC_WF_FILE)", async () => {
    // Regression guard: asserts the launcher-building source in executor.ts
    // uses ATOMIC_ORCHESTRATOR_MODE and ATOMIC_WF_KEY, not the removed ATOMIC_WF_FILE.
    // The launcher script is built inline inside executeWorkflow (not an exported helper),
    // so we assert on the source text directly.
    const src = await Bun.file(
      "src/sdk/runtime/executor.ts"
    ).text();

    // Old file-based var must not appear anywhere in the launcher logic.
    expect(src).not.toContain("ATOMIC_WF_FILE");
    // Re-entry signal must be present.
    expect(src).toContain("ATOMIC_ORCHESTRATOR_MODE=1");
    // Workflow key env var must be present.
    expect(src).toContain("ATOMIC_WF_KEY");
  });
});
