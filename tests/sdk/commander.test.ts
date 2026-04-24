/**
 * Tests for the Commander adapter — `toCommand(cli, name?)` and
 * `runCli(clis, cliFn)`.
 *
 * `toCommand` is covered indirectly by workflow-cli.test.ts (which verifies
 * the Command shape: declared options, no stale flags, etc). This file
 * focuses on `runCli` — the embed bootstrap that owns orchestrator
 * re-entry transparently.
 *
 * Mocking strategy: mock `./runtime/executor.ts` to replace `runOrchestrator`
 * with a spy so tests never touch tmux or spawn processes.
 */

import {
  test,
  expect,
  describe,
  beforeEach,
  afterEach,
  mock,
} from "bun:test";
import type { WorkflowDefinition } from "../../src/sdk/types.ts";

// ─── Module-level mock ─────────────────────────────────────────────────────

const runOrchestratorCalls: WorkflowDefinition[] = [];

const realExecutor = await import("../../src/sdk/runtime/executor.ts");
await mock.module("../../src/sdk/runtime/executor.ts", () => ({
  ...realExecutor,
  runOrchestrator: async (def: WorkflowDefinition): Promise<void> => {
    runOrchestratorCalls.push(def);
  },
}));

// Import AFTER mock.module is set up
import { createWorkflowCli } from "../../src/sdk/workflow-cli.ts";
import { createRegistry } from "../../src/sdk/registry.ts";
import { defineWorkflow } from "../../src/sdk/define-workflow.ts";
import { runCli } from "../../src/sdk/commander.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeWorkflow(name: string, agent: "claude" | "opencode" | "copilot") {
  return defineWorkflow({ name })
    .for(agent)
    .run(async () => {})
    .compile();
}

// ─── Env helpers ──────────────────────────────────────────────────────────

const ENV_KEYS = ["ATOMIC_ORCHESTRATOR_MODE", "ATOMIC_WF_KEY"] as const;
const savedEnv: Partial<Record<string, string>> = {};

function clearOrchEnv(): void {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
}

function restoreEnv(): void {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
}

beforeEach(() => {
  runOrchestratorCalls.length = 0;
  clearOrchEnv();
});

afterEach(() => {
  restoreEnv();
});

// ─── runCli — normal CLI path ──────────────────────────────────────────────

describe("runCli — normal CLI path (no orchestrator env)", () => {
  test("invokes the cliFn callback when ATOMIC_ORCHESTRATOR_MODE is unset", async () => {
    let called = false;
    const cli = createWorkflowCli(makeWorkflow("foo", "claude"));

    await runCli(cli, () => {
      called = true;
    });

    expect(called).toBe(true);
    expect(runOrchestratorCalls).toHaveLength(0);
  });

  test("awaits async cliFn to completion", async () => {
    let completed = false;
    const cli = createWorkflowCli(makeWorkflow("foo", "claude"));

    await runCli(cli, async () => {
      await new Promise((r) => setTimeout(r, 10));
      completed = true;
    });

    expect(completed).toBe(true);
  });

  test("accepts an array of clis", async () => {
    let called = false;
    const d1 = createWorkflowCli(makeWorkflow("a", "claude"));
    const d2 = createWorkflowCli(makeWorkflow("b", "opencode"));

    await runCli([d1, d2], () => {
      called = true;
    });

    expect(called).toBe(true);
  });
});

// ─── runCli — orchestrator re-entry path ───────────────────────────────────

describe("runCli — orchestrator re-entry path", () => {
  test("resolves the cli's registry and calls runOrchestrator, skipping cliFn", async () => {
    const wf = makeWorkflow("myflow", "claude");
    const cli = createWorkflowCli(wf);

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "claude/myflow";

    let cliCalled = false;
    await runCli(cli, () => {
      cliCalled = true;
    });

    expect(cliCalled).toBe(false);
    expect(runOrchestratorCalls).toHaveLength(1);
    expect(runOrchestratorCalls[0]!.name).toBe("myflow");
    expect(runOrchestratorCalls[0]!.agent).toBe("claude");
  });

  test("resolves from a registry-built cli", async () => {
    const wf = makeWorkflow("gen-spec", "opencode");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "opencode/gen-spec";

    await runCli(cli, () => {
      throw new Error("cliFn must not be called in orchestrator mode");
    });

    expect(runOrchestratorCalls).toHaveLength(1);
    expect(runOrchestratorCalls[0]!.name).toBe("gen-spec");
  });

  test("tries clis in order; picks the first match", async () => {
    const wfA = makeWorkflow("shared", "claude");
    const wfB = makeWorkflow("shared", "copilot");
    const dA = createWorkflowCli(wfA);
    const dB = createWorkflowCli(wfB);

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "copilot/shared";

    await runCli([dA, dB], () => {});

    expect(runOrchestratorCalls).toHaveLength(1);
    expect(runOrchestratorCalls[0]!.agent).toBe("copilot");
  });

  test("throws when ATOMIC_WF_KEY is malformed (no slash)", async () => {
    const cli = createWorkflowCli(makeWorkflow("foo", "claude"));

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "not-a-slash-separated-key";

    await expect(runCli(cli, () => {})).rejects.toThrow(/malformed/);
    expect(runOrchestratorCalls).toHaveLength(0);
  });

  test("throws when ATOMIC_WF_KEY is missing entirely", async () => {
    const cli = createWorkflowCli(makeWorkflow("foo", "claude"));

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    delete process.env.ATOMIC_WF_KEY;

    await expect(runCli(cli, () => {})).rejects.toThrow(/malformed/);
    expect(runOrchestratorCalls).toHaveLength(0);
  });

  test("throws when key is not found in any cli", async () => {
    const cli = createWorkflowCli(makeWorkflow("foo", "claude"));

    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "opencode/unknown";

    await expect(runCli(cli, () => {})).rejects.toThrow(
      /opencode\/unknown.*not found/,
    );
    expect(runOrchestratorCalls).toHaveLength(0);
  });

  test("ATOMIC_ORCHESTRATOR_MODE=0 does not trigger orchestrator path", async () => {
    const cli = createWorkflowCli(makeWorkflow("foo", "claude"));

    process.env.ATOMIC_ORCHESTRATOR_MODE = "0";
    process.env.ATOMIC_WF_KEY = "claude/foo";

    let cliCalled = false;
    await runCli(cli, () => {
      cliCalled = true;
    });

    expect(cliCalled).toBe(true);
    expect(runOrchestratorCalls).toHaveLength(0);
  });
});

// ─── createWorkflowCli overload coverage ────────────────────────────────────

describe("createWorkflowCli — input overloads", () => {
  test("accepts a single WorkflowDefinition", async () => {
    const wf = makeWorkflow("solo", "claude");
    const cli = createWorkflowCli(wf);
    expect(cli.registry.list()).toHaveLength(1);
    expect(cli.registry.list()[0]!.name).toBe("solo");
  });

  test("accepts an array of WorkflowDefinitions", async () => {
    const wfA = makeWorkflow("a", "claude");
    const wfB = makeWorkflow("b", "opencode");
    const cli = createWorkflowCli([wfA, wfB]);
    expect(cli.registry.list()).toHaveLength(2);
  });

  test("accepts a Registry built via createRegistry", async () => {
    const wf = makeWorkflow("reg", "copilot");
    const registry = createRegistry().register(wf);
    const cli = createWorkflowCli(registry);
    expect(cli.registry).toBe(registry);
  });
});
