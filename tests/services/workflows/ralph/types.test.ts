import { describe, test, expect } from "bun:test";
import {
  toRalphWorkflowContext,
  type RalphWorkflowContext,
  type RalphRuntimeDependencies,
  type RalphCommandState,
  type FeatureProgressState,
  defaultRalphCommandState,
} from "@/services/workflows/ralph/types.ts";
import { createRalphState } from "@/services/workflows/ralph/state.ts";
import type { ExecutionContext } from "@/services/workflows/graph/contracts/runtime.ts";
import type { RalphWorkflowState } from "@/services/workflows/ralph/state.ts";

function stubSpawnSubagent() {
  return Promise.resolve({
    agentId: "test",
    success: true,
    output: "",
    toolUses: 0,
    durationMs: 0,
  });
}

function stubSpawnSubagentParallel() {
  return Promise.resolve([]);
}

function buildExecutionContext(
  runtimeOverrides: Record<string, unknown> = {},
): ExecutionContext<RalphWorkflowState> {
  return {
    state: createRalphState("exec-1"),
    config: {
      runtime: {
        spawnSubagent: stubSpawnSubagent,
        spawnSubagentParallel: stubSpawnSubagentParallel,
        ...runtimeOverrides,
      },
    },
    errors: [],
  };
}

describe("toRalphWorkflowContext", () => {
  test("extracts state from ExecutionContext", () => {
    const ctx = buildExecutionContext();
    const result = toRalphWorkflowContext(ctx);

    expect(result.state).toBe(ctx.state);
    expect(result.state.executionId).toBe("exec-1");
  });

  test("extracts required runtime dependencies", () => {
    const ctx = buildExecutionContext();
    const result = toRalphWorkflowContext(ctx);

    expect(result.runtime.spawnSubagent).toBe(stubSpawnSubagent);
    expect(result.runtime.spawnSubagentParallel).toBe(stubSpawnSubagentParallel);
  });

  test("forwards optional taskIdentity when present", () => {
    const mockTaskIdentity = {
      backfillTask: (t: never) => t,
      backfillTasks: (ts: never) => ts,
      bindProviderId: (t: never) => t,
      resolveCanonicalTaskId: () => null,
    };
    const ctx = buildExecutionContext({ taskIdentity: mockTaskIdentity });
    const result = toRalphWorkflowContext(ctx);

    expect(result.runtime.taskIdentity).toBe(mockTaskIdentity);
  });

  test("forwards optional notifyTaskStatusChange when present", () => {
    const notifyFn = () => {};
    const ctx = buildExecutionContext({ notifyTaskStatusChange: notifyFn });
    const result = toRalphWorkflowContext(ctx);

    expect(result.runtime.notifyTaskStatusChange).toBe(notifyFn);
  });

  test("leaves optional fields undefined when absent", () => {
    const ctx = buildExecutionContext();
    const result = toRalphWorkflowContext(ctx);

    expect(result.runtime.taskIdentity).toBeUndefined();
    expect(result.runtime.notifyTaskStatusChange).toBeUndefined();
  });

  test("forwards abortSignal from ExecutionContext", () => {
    const controller = new AbortController();
    const ctx = buildExecutionContext();
    ctx.abortSignal = controller.signal;
    const result = toRalphWorkflowContext(ctx);

    expect(result.abortSignal).toBe(controller.signal);
  });

  test("abortSignal is undefined when not provided", () => {
    const ctx = buildExecutionContext();
    const result = toRalphWorkflowContext(ctx);

    expect(result.abortSignal).toBeUndefined();
  });

  test("throws when spawnSubagent is missing", () => {
    const ctx: ExecutionContext<RalphWorkflowState> = {
      state: createRalphState("exec-1"),
      config: {
        runtime: {
          spawnSubagentParallel: stubSpawnSubagentParallel,
        },
      },
      errors: [],
    };

    expect(() => toRalphWorkflowContext(ctx)).toThrow(
      "RalphWorkflowContext requires spawnSubagent in runtime config",
    );
  });

  test("throws when spawnSubagentParallel is missing", () => {
    const ctx: ExecutionContext<RalphWorkflowState> = {
      state: createRalphState("exec-1"),
      config: {
        runtime: {
          spawnSubagent: stubSpawnSubagent,
        },
      },
      errors: [],
    };

    expect(() => toRalphWorkflowContext(ctx)).toThrow(
      "RalphWorkflowContext requires spawnSubagentParallel in runtime config",
    );
  });

  test("throws when runtime is entirely absent", () => {
    const ctx: ExecutionContext<RalphWorkflowState> = {
      state: createRalphState("exec-1"),
      config: {},
      errors: [],
    };

    expect(() => toRalphWorkflowContext(ctx)).toThrow(
      "RalphWorkflowContext requires spawnSubagent in runtime config",
    );
  });
});

describe("RalphWorkflowContext interface", () => {
  test("satisfies the interface when constructed manually", () => {
    const context: RalphWorkflowContext = {
      state: createRalphState("manual-ctx"),
      runtime: {
        spawnSubagent: stubSpawnSubagent,
        spawnSubagentParallel: stubSpawnSubagentParallel,
      },
    };

    expect(context.state.executionId).toBe("manual-ctx");
    expect(context.runtime.spawnSubagent).toBeDefined();
    expect(context.runtime.spawnSubagentParallel).toBeDefined();
    expect(context.abortSignal).toBeUndefined();
  });
});

describe("RalphRuntimeDependencies interface", () => {
  test("allows minimal required-only shape", () => {
    const deps: RalphRuntimeDependencies = {
      spawnSubagent: stubSpawnSubagent,
      spawnSubagentParallel: stubSpawnSubagentParallel,
    };

    expect(deps.spawnSubagent).toBeDefined();
    expect(deps.taskIdentity).toBeUndefined();
    expect(deps.notifyTaskStatusChange).toBeUndefined();
  });
});

describe("RalphCommandState", () => {
  test("defaultRalphCommandState has correct default values", () => {
    expect(defaultRalphCommandState).toEqual({
      currentNode: null,
      iteration: 0,
      maxIterations: undefined,
      featureProgress: null,
      pendingApproval: false,
      specApproved: false,
      feedback: null,
    });
  });

  test("defaultRalphCommandState is a plain object (not frozen)", () => {
    // Spread should work for overriding defaults
    const overridden: RalphCommandState = {
      ...defaultRalphCommandState,
      pendingApproval: true,
      specApproved: true,
    };
    expect(overridden.pendingApproval).toBe(true);
    expect(overridden.specApproved).toBe(true);
    expect(overridden.currentNode).toBeNull();
  });

  test("FeatureProgressState has required fields", () => {
    const progress: FeatureProgressState = {
      completed: 2,
      total: 5,
      currentFeature: "implement auth",
    };
    expect(progress.currentFeature).toBe("implement auth");
    expect(progress.total).toBe(5);
    expect(progress.completed).toBe(2);
  });
});
