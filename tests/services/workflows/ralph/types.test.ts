import { describe, test, expect } from "bun:test";
import {
  toRalphWorkflowContext,
  toWorkflowProgress,
  fromWorkflowProgress,
  type RalphWorkflowContext,
  type RalphRuntimeDependencies,
  type RalphCommandState,
  type FeatureProgressState,
  defaultRalphCommandState,
} from "@/services/workflows/ralph/types.ts";
import {
  type WorkflowCommandState,
  type WorkflowProgressState,
  defaultWorkflowCommandState,
} from "@/services/workflows/workflow-types.ts";
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
      // Generic WorkflowCommandState fields
      currentNode: null,
      iteration: 0,
      maxIterations: undefined,
      currentStage: null,
      stageIndicator: null,
      progress: null,
      pendingApproval: false,
      approved: false,
      feedback: null,
      extensions: {},
      // Ralph-specific fields
      featureProgress: null,
      specApproved: false,
    });
  });

  test("defaultRalphCommandState extends defaultWorkflowCommandState", () => {
    // All generic fields should be present with their default values
    for (const key of Object.keys(defaultWorkflowCommandState)) {
      expect(key in defaultRalphCommandState).toBe(true);
    }
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

// ============================================================================
// GENERIC WORKFLOW STATE TYPES
// ============================================================================

describe("WorkflowCommandState", () => {
  test("defaultWorkflowCommandState has correct default values", () => {
    expect(defaultWorkflowCommandState).toEqual({
      currentNode: null,
      iteration: 0,
      maxIterations: undefined,
      currentStage: null,
      stageIndicator: null,
      progress: null,
      pendingApproval: false,
      approved: false,
      feedback: null,
      extensions: {},
    });
  });

  test("defaultWorkflowCommandState is a plain object (not frozen)", () => {
    const overridden: WorkflowCommandState = {
      ...defaultWorkflowCommandState,
      currentStage: "planner",
      stageIndicator: "⌕ PLANNER",
      pendingApproval: true,
      approved: true,
    };
    expect(overridden.currentStage).toBe("planner");
    expect(overridden.stageIndicator).toBe("⌕ PLANNER");
    expect(overridden.pendingApproval).toBe(true);
    expect(overridden.approved).toBe(true);
    expect(overridden.currentNode).toBeNull();
  });

  test("WorkflowProgressState has required fields", () => {
    const progress: WorkflowProgressState = {
      completed: 3,
      total: 10,
      currentItem: "implement auth module",
    };
    expect(progress.completed).toBe(3);
    expect(progress.total).toBe(10);
    expect(progress.currentItem).toBe("implement auth module");
  });

  test("WorkflowProgressState currentItem is optional", () => {
    const progress: WorkflowProgressState = {
      completed: 0,
      total: 5,
    };
    expect(progress.currentItem).toBeUndefined();
  });

  test("extensions supports arbitrary workflow-specific data", () => {
    const state: WorkflowCommandState = {
      ...defaultWorkflowCommandState,
      extensions: {
        featureList: ["auth", "billing"],
        debugMode: true,
        retryCount: 3,
      },
    };
    expect(state.extensions.featureList).toEqual(["auth", "billing"]);
    expect(state.extensions.debugMode).toBe(true);
    expect(state.extensions.retryCount).toBe(3);
  });
});

describe("toWorkflowProgress / fromWorkflowProgress", () => {
  test("toWorkflowProgress converts FeatureProgressState to WorkflowProgressState", () => {
    const fp: FeatureProgressState = {
      completed: 2,
      total: 5,
      currentFeature: "auth",
    };
    const wp = toWorkflowProgress(fp);
    expect(wp).toEqual({ completed: 2, total: 5, currentItem: "auth" });
  });

  test("toWorkflowProgress returns null for null input", () => {
    expect(toWorkflowProgress(null)).toBeNull();
  });

  test("toWorkflowProgress handles missing currentFeature", () => {
    const fp: FeatureProgressState = { completed: 1, total: 3 };
    const wp = toWorkflowProgress(fp);
    expect(wp).toEqual({ completed: 1, total: 3, currentItem: undefined });
  });

  test("fromWorkflowProgress converts WorkflowProgressState to FeatureProgressState", () => {
    const wp: WorkflowProgressState = {
      completed: 3,
      total: 7,
      currentItem: "billing",
    };
    const fp = fromWorkflowProgress(wp);
    expect(fp).toEqual({ completed: 3, total: 7, currentFeature: "billing" });
  });

  test("fromWorkflowProgress returns null for null input", () => {
    expect(fromWorkflowProgress(null)).toBeNull();
  });

  test("round-trip preserves data", () => {
    const original: FeatureProgressState = {
      completed: 4,
      total: 8,
      currentFeature: "deploy",
    };
    const roundTripped = fromWorkflowProgress(toWorkflowProgress(original));
    expect(roundTripped).toEqual(original);
  });
});

describe("RalphCommandState extends WorkflowCommandState", () => {
  test("RalphCommandState is assignable to WorkflowCommandState", () => {
    const ralph: RalphCommandState = { ...defaultRalphCommandState };
    const generic: WorkflowCommandState = ralph;
    expect(generic.currentNode).toBeNull();
    expect(generic.approved).toBe(false);
    expect(generic.pendingApproval).toBe(false);
  });

  test("Ralph-specific fields coexist with generic fields", () => {
    const state: RalphCommandState = {
      ...defaultRalphCommandState,
      approved: true,
      specApproved: true,
      progress: { completed: 1, total: 3, currentItem: "x" },
      featureProgress: { completed: 1, total: 3, currentFeature: "x" },
    };
    expect(state.approved).toBe(true);
    expect(state.specApproved).toBe(true);
    expect(state.progress?.currentItem).toBe("x");
    expect(state.featureProgress?.currentFeature).toBe("x");
  });
});
