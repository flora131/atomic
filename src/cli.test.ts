/**
 * Tests for cli.ts orchestrator re-entry guard.
 *
 * When ATOMIC_ORCHESTRATOR_MODE=1, the CLI must detect the env var BEFORE
 * commander runs and call runOrchestrator(definition) directly, then exit 0.
 * This is critical for builtin workflows running in --detach mode: the
 * orchestrator tmux pane re-invokes the atomic binary, which enters cli.ts.
 * Without the guard, commander tries to parse argv as a user command and fails.
 *
 * Mocking strategy:
 *   1. mock.module("./sdk/runtime/executor.ts") replaces runOrchestrator with a spy.
 *   2. mock.module("./sdk/workflows/builtin-registry.ts") provides a minimal
 *      fake registry with one entry so tests don't depend on real workflow files.
 *   3. Dynamic import of cli.ts picks up both mocked modules.
 *
 * We export `handleBuiltinOrchestratorReEntry(key)` from cli.ts so tests can
 * call it directly without triggering commander or process.exit.
 */

import { describe, test, expect, mock, beforeEach, afterEach, afterAll } from "bun:test";
import type { WorkflowDefinition } from "./sdk/types.ts";
import type { AgentType } from "./sdk/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeDefinition(agent: AgentType, name: string): WorkflowDefinition {
  return {
    __brand: "WorkflowDefinition",
    agent,
    name,
    description: `Test workflow ${name}`,
    inputs: [],
    minSDKVersion: null,
    run: async () => {},
  } as unknown as WorkflowDefinition;
}

const fakeRalphClaude = makeDefinition("claude", "ralph");

// ─── Mocks ────────────────────────────────────────────────────────────────────

const runOrchestratorMock = mock(async (_def: WorkflowDefinition): Promise<void> => {});

// Spread real module to preserve all exports (escBash, discoverCopilotBinary, etc.)
// so this mock doesn't break other test files that import those exports.
const realExecutor = await import("./sdk/runtime/executor.ts");
await mock.module("./sdk/runtime/executor.ts", () => ({
  ...realExecutor,
  executeWorkflow: async () => {},
  runOrchestrator: runOrchestratorMock,
}));

// Snapshot real builtin-registry BEFORE mock replaces it (live bindings mean
// realBuiltinRegistry.createBuiltinRegistry would point to mock after mock.module).
const realBuiltinRegistry = await import("./sdk/workflows/builtin-registry.ts");
const realCreateBuiltinRegistry = realBuiltinRegistry.createBuiltinRegistry;
await mock.module("./sdk/workflows/builtin-registry.ts", () => ({
  createBuiltinRegistry: () => ({
    resolve: (name: string, agent: AgentType) => {
      if (name === "ralph" && agent === "claude") return fakeRalphClaude;
      return undefined;
    },
    list: () => [fakeRalphClaude],
    has: (key: string) => key === "claude/ralph",
    get: (key: string) => {
      if (key === "claude/ralph") return fakeRalphClaude;
      throw new Error(`Not found: ${key}`);
    },
  }),
}));

// Dynamic import AFTER mocks are installed.
const { handleBuiltinOrchestratorReEntry } = await import("./cli.ts");

// ─── Env cleanup ──────────────────────────────────────────────────────────────

let savedOrchestratorMode: string | undefined;
let savedWfKey: string | undefined;

beforeEach(() => {
  savedOrchestratorMode = process.env.ATOMIC_ORCHESTRATOR_MODE;
  savedWfKey = process.env.ATOMIC_WF_KEY;
  runOrchestratorMock.mockClear();
});

afterEach(() => {
  if (savedOrchestratorMode === undefined) delete process.env.ATOMIC_ORCHESTRATOR_MODE;
  else process.env.ATOMIC_ORCHESTRATOR_MODE = savedOrchestratorMode;

  if (savedWfKey === undefined) delete process.env.ATOMIC_WF_KEY;
  else process.env.ATOMIC_WF_KEY = savedWfKey;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleBuiltinOrchestratorReEntry — orchestrator mode", () => {
  test("returns false and skips runOrchestrator when ATOMIC_ORCHESTRATOR_MODE is unset", async () => {
    delete process.env.ATOMIC_ORCHESTRATOR_MODE;
    delete process.env.ATOMIC_WF_KEY;

    const handled = await handleBuiltinOrchestratorReEntry();

    expect(handled).toBe(false);
    expect(runOrchestratorMock).not.toHaveBeenCalled();
  });

  test("returns false when ATOMIC_ORCHESTRATOR_MODE is '0'", async () => {
    process.env.ATOMIC_ORCHESTRATOR_MODE = "0";
    delete process.env.ATOMIC_WF_KEY;

    const handled = await handleBuiltinOrchestratorReEntry();

    expect(handled).toBe(false);
    expect(runOrchestratorMock).not.toHaveBeenCalled();
  });

  test("calls runOrchestrator with resolved definition for valid key", async () => {
    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "claude/ralph";

    const handled = await handleBuiltinOrchestratorReEntry();

    expect(handled).toBe(true);
    expect(runOrchestratorMock).toHaveBeenCalledTimes(1);
    expect(runOrchestratorMock).toHaveBeenCalledWith(fakeRalphClaude);
  });

  test("throws with exact message when ATOMIC_WF_KEY is missing", async () => {
    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    delete process.env.ATOMIC_WF_KEY;

    await expect(handleBuiltinOrchestratorReEntry()).rejects.toThrow(
      "orchestrator: ATOMIC_WF_KEY '' not found in builtin registry",
    );
    expect(runOrchestratorMock).not.toHaveBeenCalled();
  });

  test("throws with exact message when key is not in builtin registry", async () => {
    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "claude/unknown-workflow";

    await expect(handleBuiltinOrchestratorReEntry()).rejects.toThrow(
      "orchestrator: ATOMIC_WF_KEY 'claude/unknown-workflow' not found in builtin registry",
    );
    expect(runOrchestratorMock).not.toHaveBeenCalled();
  });

  test("does not call runOrchestrator when key is not in builtin registry", async () => {
    process.env.ATOMIC_ORCHESTRATOR_MODE = "1";
    process.env.ATOMIC_WF_KEY = "opencode/nonexistent";

    try {
      await handleBuiltinOrchestratorReEntry();
    } catch {
      // expected
    }

    expect(runOrchestratorMock).not.toHaveBeenCalled();
  });
});

// Restore builtin-registry to real exports so subsequent test files (e.g.,
// workflow-command.test.ts) don't get the single-entry fake registry.
// Also re-mock workflow.ts using the restored createBuiltinRegistry so its
// cached top-level `workflowCommand` is rebuilt with the real registry.
afterAll(async () => {
  // Restore builtin-registry using the snapshotted real function (not live binding).
  mock.module("./sdk/workflows/builtin-registry.ts", () => ({
    createBuiltinRegistry: realCreateBuiltinRegistry,
  }));
  const { createDispatcher } = await import("./sdk/dispatcher.ts");
  const freshWorkflowCommand = createDispatcher(
    realCreateBuiltinRegistry(),
  ).command("workflow");
  // Replace the cached workflow.ts module so subsequent imports get the real registry.
  mock.module("./commands/cli/workflow.ts", () => ({
    workflowCommand: freshWorkflowCommand,
  }));
});
