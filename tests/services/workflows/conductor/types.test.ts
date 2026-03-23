import { describe, expect, test } from "bun:test";
import {
  isConductorConfig,
  isStageContext,
  isStageDefinition,
  isStageOutput,
  isStageOutputStatus,
  isWorkflowResult,
  STAGE_OUTPUT_STATUSES,
  type ConductorConfig,
  type StageContext,
  type StageDefinition,
  type StageOutput,
  type StageOutputStatus,
  type WorkflowResult,
} from "@/services/workflows/conductor/index.ts";

// ---------------------------------------------------------------------------
// STAGE_OUTPUT_STATUSES constant
// ---------------------------------------------------------------------------

describe("STAGE_OUTPUT_STATUSES", () => {
  test("contains exactly the expected values", () => {
    expect(STAGE_OUTPUT_STATUSES).toEqual(["completed", "interrupted", "error"]);
  });

  test("is a readonly tuple (as const)", () => {
    // `as const` ensures TypeScript readonly at compile time;
    // verify length is stable and values match the type union.
    expect(STAGE_OUTPUT_STATUSES.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// isStageOutputStatus
// ---------------------------------------------------------------------------

describe("isStageOutputStatus", () => {
  test("returns true for valid statuses", () => {
    const validStatuses: StageOutputStatus[] = ["completed", "interrupted", "error"];
    for (const status of validStatuses) {
      expect(isStageOutputStatus(status)).toBe(true);
    }
  });

  test("returns false for invalid strings", () => {
    expect(isStageOutputStatus("pending")).toBe(false);
    expect(isStageOutputStatus("running")).toBe(false);
    expect(isStageOutputStatus("")).toBe(false);
    expect(isStageOutputStatus("COMPLETED")).toBe(false);
  });

  test("returns false for non-string values", () => {
    expect(isStageOutputStatus(null)).toBe(false);
    expect(isStageOutputStatus(undefined)).toBe(false);
    expect(isStageOutputStatus(42)).toBe(false);
    expect(isStageOutputStatus({})).toBe(false);
    expect(isStageOutputStatus([])).toBe(false);
    expect(isStageOutputStatus(true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isStageOutput
// ---------------------------------------------------------------------------

describe("isStageOutput", () => {
  const validOutput: StageOutput = {
    stageId: "planner",
    rawResponse: "Here is the task list...",
    status: "completed",
  };

  test("returns true for minimal valid StageOutput", () => {
    expect(isStageOutput(validOutput)).toBe(true);
  });

  test("returns true for StageOutput with all optional fields", () => {
    const full: StageOutput = {
      stageId: "reviewer",
      rawResponse: "Review findings: ...",
      parsedOutput: { findings: ["bug in auth"] },
      status: "completed",
      error: undefined,
    };
    expect(isStageOutput(full)).toBe(true);
  });

  test("returns true for error status with error message", () => {
    const errored: StageOutput = {
      stageId: "orchestrator",
      rawResponse: "",
      status: "error",
      error: "Session creation failed",
    };
    expect(isStageOutput(errored)).toBe(true);
  });

  test("returns true for interrupted status", () => {
    const interrupted: StageOutput = {
      stageId: "planner",
      rawResponse: "Partial output...",
      status: "interrupted",
    };
    expect(isStageOutput(interrupted)).toBe(true);
  });

  test("returns false when stageId is missing", () => {
    expect(isStageOutput({ rawResponse: "test", status: "completed" })).toBe(false);
  });

  test("returns false when rawResponse is missing", () => {
    expect(isStageOutput({ stageId: "x", status: "completed" })).toBe(false);
  });

  test("returns false when status is missing", () => {
    expect(isStageOutput({ stageId: "x", rawResponse: "y" })).toBe(false);
  });

  test("returns false for invalid status value", () => {
    expect(isStageOutput({ stageId: "x", rawResponse: "y", status: "pending" })).toBe(false);
  });

  test("returns false when error is non-string", () => {
    expect(isStageOutput({ stageId: "x", rawResponse: "y", status: "error", error: 42 })).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(isStageOutput(null)).toBe(false);
    expect(isStageOutput(undefined)).toBe(false);
  });

  test("returns false for non-object values", () => {
    expect(isStageOutput("string")).toBe(false);
    expect(isStageOutput(123)).toBe(false);
    expect(isStageOutput([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isStageContext
// ---------------------------------------------------------------------------

describe("isStageContext", () => {
  function makeValidContext(): StageContext {
    return {
      userPrompt: "Build an auth module",
      stageOutputs: new Map(),
      tasks: [],
      abortSignal: new AbortController().signal,
    };
  }

  test("returns true for valid StageContext", () => {
    expect(isStageContext(makeValidContext())).toBe(true);
  });

  test("returns true for context with populated stageOutputs and tasks", () => {
    const ctx = makeValidContext();
    const outputs = new Map<string, StageOutput>();
    outputs.set("planner", {
      stageId: "planner",
      rawResponse: "task list",
      status: "completed",
    });

    const populated: StageContext = {
      ...ctx,
      stageOutputs: outputs,
      tasks: [{ description: "Create user model", status: "pending", summary: "User model" }],
    };
    expect(isStageContext(populated)).toBe(true);
  });

  test("returns false when userPrompt is missing", () => {
    const { userPrompt: _, ...rest } = makeValidContext();
    expect(isStageContext(rest)).toBe(false);
  });

  test("returns false when stageOutputs is not a Map", () => {
    expect(isStageContext({ ...makeValidContext(), stageOutputs: {} })).toBe(false);
    expect(isStageContext({ ...makeValidContext(), stageOutputs: [] })).toBe(false);
  });

  test("returns false when tasks is not an array", () => {
    expect(isStageContext({ ...makeValidContext(), tasks: "not array" })).toBe(false);
    expect(isStageContext({ ...makeValidContext(), tasks: {} })).toBe(false);
  });

  test("returns false when abortSignal is not an AbortSignal", () => {
    expect(isStageContext({ ...makeValidContext(), abortSignal: {} })).toBe(false);
    expect(isStageContext({ ...makeValidContext(), abortSignal: "signal" })).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(isStageContext(null)).toBe(false);
    expect(isStageContext(undefined)).toBe(false);
  });

  test("returns false for non-object values", () => {
    expect(isStageContext("string")).toBe(false);
    expect(isStageContext(42)).toBe(false);
    expect(isStageContext(true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isStageDefinition
// ---------------------------------------------------------------------------

describe("isStageDefinition", () => {
  function makeValidDefinition(): StageDefinition {
    return {
      id: "planner",
      indicator: "[PLANNER]",
      buildPrompt: (_ctx: StageContext) => "Plan the following...",
    };
  }

  test("returns true for minimal valid StageDefinition", () => {
    expect(isStageDefinition(makeValidDefinition())).toBe(true);
  });

  test("returns true with all optional fields", () => {
    const full: StageDefinition = {
      ...makeValidDefinition(),
      parseOutput: (response: string) => JSON.parse(response),
      shouldRun: (_ctx: StageContext) => true,
      sessionConfig: { model: "claude-sonnet-4-20250514" },
    };
    expect(isStageDefinition(full)).toBe(true);
  });

  test("returns false when id is missing", () => {
    const { id: _, ...rest } = makeValidDefinition();
    expect(isStageDefinition(rest)).toBe(false);
  });

  test("returns false when indicator is missing", () => {
    const { indicator: _, ...rest } = makeValidDefinition();
    expect(isStageDefinition(rest)).toBe(false);
  });

  test("returns false when buildPrompt is missing", () => {
    const { buildPrompt: _, ...rest } = makeValidDefinition();
    expect(isStageDefinition(rest)).toBe(false);
  });

  test("returns false when buildPrompt is not a function", () => {
    expect(isStageDefinition({ ...makeValidDefinition(), buildPrompt: "not a fn" })).toBe(false);
  });

  test("returns false when parseOutput is not a function", () => {
    expect(isStageDefinition({ ...makeValidDefinition(), parseOutput: "not a fn" })).toBe(false);
  });

  test("returns false when shouldRun is not a function", () => {
    expect(isStageDefinition({ ...makeValidDefinition(), shouldRun: true })).toBe(false);
  });

  test("returns false when sessionConfig is not an object", () => {
    expect(isStageDefinition({ ...makeValidDefinition(), sessionConfig: "bad" })).toBe(false);
  });

  test("returns false when sessionConfig is null", () => {
    expect(isStageDefinition({ ...makeValidDefinition(), sessionConfig: null })).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(isStageDefinition(null)).toBe(false);
    expect(isStageDefinition(undefined)).toBe(false);
  });

  test("returns false for non-object values", () => {
    expect(isStageDefinition("string")).toBe(false);
    expect(isStageDefinition(123)).toBe(false);
    expect(isStageDefinition([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isConductorConfig
// ---------------------------------------------------------------------------

describe("isConductorConfig", () => {
  function makeValidConfig(): ConductorConfig {
    return {
      graph: { nodes: new Map(), edges: [], startNode: "start", endNodes: new Set(), config: {} } as ConductorConfig["graph"],
      createSession: async () => ({ id: "s1" }) as never,
      destroySession: async () => {},
      onStageTransition: () => {},
      onTaskUpdate: () => {},
      abortSignal: new AbortController().signal,
    };
  }

  test("returns true for valid ConductorConfig", () => {
    expect(isConductorConfig(makeValidConfig())).toBe(true);
  });

  test("returns false when graph is missing", () => {
    const { graph: _, ...rest } = makeValidConfig();
    expect(isConductorConfig(rest)).toBe(false);
  });

  test("returns false when graph is null", () => {
    expect(isConductorConfig({ ...makeValidConfig(), graph: null })).toBe(false);
  });

  test("returns false when createSession is not a function", () => {
    expect(isConductorConfig({ ...makeValidConfig(), createSession: "bad" })).toBe(false);
  });

  test("returns false when destroySession is not a function", () => {
    expect(isConductorConfig({ ...makeValidConfig(), destroySession: "bad" })).toBe(false);
  });

  test("returns false when onStageTransition is not a function", () => {
    expect(isConductorConfig({ ...makeValidConfig(), onStageTransition: "bad" })).toBe(false);
  });

  test("returns false when onTaskUpdate is not a function", () => {
    expect(isConductorConfig({ ...makeValidConfig(), onTaskUpdate: "bad" })).toBe(false);
  });

  test("returns false when abortSignal is not an AbortSignal", () => {
    expect(isConductorConfig({ ...makeValidConfig(), abortSignal: {} })).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(isConductorConfig(null)).toBe(false);
    expect(isConductorConfig(undefined)).toBe(false);
  });

  test("returns false for non-object values", () => {
    expect(isConductorConfig("string")).toBe(false);
    expect(isConductorConfig(42)).toBe(false);
    expect(isConductorConfig(true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isWorkflowResult
// ---------------------------------------------------------------------------

describe("isWorkflowResult", () => {
  function makeValidResult(): WorkflowResult {
    return {
      success: true,
      stageOutputs: new Map(),
      tasks: [],
      state: { executionId: "exec-1", lastUpdated: "2026-03-20T00:00:00Z", outputs: {} },
    };
  }

  test("returns true for valid WorkflowResult", () => {
    expect(isWorkflowResult(makeValidResult())).toBe(true);
  });

  test("returns true for failed result", () => {
    const failed: WorkflowResult = {
      ...makeValidResult(),
      success: false,
    };
    expect(isWorkflowResult(failed)).toBe(true);
  });

  test("returns true with populated stageOutputs and tasks", () => {
    const outputs = new Map<string, StageOutput>();
    outputs.set("planner", {
      stageId: "planner",
      rawResponse: "tasks...",
      status: "completed",
    });

    const result: WorkflowResult = {
      success: true,
      stageOutputs: outputs,
      tasks: [{ description: "Task 1", status: "completed", summary: "First task" }],
      state: { executionId: "exec-2", lastUpdated: "2026-03-20T00:00:00Z", outputs: {} },
    };
    expect(isWorkflowResult(result)).toBe(true);
  });

  test("returns false when success is missing", () => {
    const { success: _, ...rest } = makeValidResult();
    expect(isWorkflowResult(rest)).toBe(false);
  });

  test("returns false when success is not a boolean", () => {
    expect(isWorkflowResult({ ...makeValidResult(), success: "true" })).toBe(false);
  });

  test("returns false when stageOutputs is not a Map", () => {
    expect(isWorkflowResult({ ...makeValidResult(), stageOutputs: {} })).toBe(false);
  });

  test("returns false when tasks is not an array", () => {
    expect(isWorkflowResult({ ...makeValidResult(), tasks: {} })).toBe(false);
  });

  test("returns false when state is null", () => {
    expect(isWorkflowResult({ ...makeValidResult(), state: null })).toBe(false);
  });

  test("returns false when state is not an object", () => {
    expect(isWorkflowResult({ ...makeValidResult(), state: "bad" })).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(isWorkflowResult(null)).toBe(false);
    expect(isWorkflowResult(undefined)).toBe(false);
  });

  test("returns false for non-object values", () => {
    expect(isWorkflowResult("string")).toBe(false);
    expect(isWorkflowResult(123)).toBe(false);
    expect(isWorkflowResult([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type-level compile checks (these test TypeScript assignability)
// ---------------------------------------------------------------------------

describe("type assignability", () => {
  test("StageOutput.parsedOutput accepts any structured data", () => {
    const output: StageOutput = {
      stageId: "planner",
      rawResponse: '{"tasks": []}',
      parsedOutput: { tasks: [{ id: "t1", description: "Create user model" }] },
      status: "completed",
    };
    expect(output.parsedOutput).toBeDefined();
  });

  test("StageContext.tasks accepts TaskItem array", () => {
    const ctx: StageContext = {
      userPrompt: "Build auth",
      stageOutputs: new Map(),
      tasks: [
        { description: "Create user model", status: "pending", summary: "User model" },
        { description: "Add JWT auth", status: "pending", summary: "JWT", blockedBy: ["t1"] },
      ],
      abortSignal: new AbortController().signal,
    };
    expect(ctx.tasks).toHaveLength(2);
  });

  test("StageDefinition.buildPrompt receives StageContext and returns string", () => {
    const def: StageDefinition = {
      id: "test",
      indicator: "[TEST]",
      buildPrompt: (ctx) => `Prompt: ${ctx.userPrompt}`,
    };
    const ctx: StageContext = {
      userPrompt: "hello",
      stageOutputs: new Map(),
      tasks: [],
      abortSignal: new AbortController().signal,
    };
    expect(def.buildPrompt(ctx)).toBe("Prompt: hello");
  });

  test("StageDefinition.shouldRun controls stage execution", () => {
    const def: StageDefinition = {
      id: "debugger",
      indicator: "🔧 DEBUGGER",
      buildPrompt: () => "fix it",
      shouldRun: (ctx) => {
        const reviewOutput = ctx.stageOutputs.get("reviewer");
        return reviewOutput?.parsedOutput !== undefined;
      },
    };

    const emptyCtx: StageContext = {
      userPrompt: "test",
      stageOutputs: new Map(),
      tasks: [],
      abortSignal: new AbortController().signal,
    };
    expect(def.shouldRun!(emptyCtx)).toBe(false);

    const withReview: StageContext = {
      ...emptyCtx,
      stageOutputs: new Map([
        ["reviewer", { stageId: "reviewer", rawResponse: "issues found", parsedOutput: { issues: 3 }, status: "completed" as const }],
      ]),
    };
    expect(def.shouldRun!(withReview)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Context Pressure Type Guards
// ---------------------------------------------------------------------------

import {
  isContextPressureLevel,
  isContextPressureSnapshot,
  isContextPressureConfig,
  isContinuationRecord,
  isAccumulatedContextPressure,
  CONTEXT_PRESSURE_LEVELS,
} from "@/services/workflows/conductor/index.ts";

describe("CONTEXT_PRESSURE_LEVELS", () => {
  test("contains exactly the expected values", () => {
    expect(CONTEXT_PRESSURE_LEVELS).toEqual(["normal", "elevated", "critical"]);
  });

  test("is a readonly tuple", () => {
    expect(CONTEXT_PRESSURE_LEVELS.length).toBe(3);
  });
});

describe("isContextPressureLevel", () => {
  test("accepts valid pressure levels", () => {
    expect(isContextPressureLevel("normal")).toBe(true);
    expect(isContextPressureLevel("elevated")).toBe(true);
    expect(isContextPressureLevel("critical")).toBe(true);
  });

  test("rejects invalid values", () => {
    expect(isContextPressureLevel("high")).toBe(false);
    expect(isContextPressureLevel("")).toBe(false);
    expect(isContextPressureLevel(42)).toBe(false);
    expect(isContextPressureLevel(null)).toBe(false);
    expect(isContextPressureLevel(undefined)).toBe(false);
  });
});

describe("isContextPressureSnapshot", () => {
  const validSnapshot = {
    inputTokens: 5000,
    outputTokens: 3000,
    maxTokens: 100000,
    usagePercentage: 8,
    level: "normal" as const,
    timestamp: "2026-03-20T00:00:00.000Z",
  };

  test("accepts a valid snapshot", () => {
    expect(isContextPressureSnapshot(validSnapshot)).toBe(true);
  });

  test("accepts snapshots with all pressure levels", () => {
    for (const level of CONTEXT_PRESSURE_LEVELS) {
      expect(isContextPressureSnapshot({ ...validSnapshot, level })).toBe(true);
    }
  });

  test("rejects missing fields", () => {
    expect(isContextPressureSnapshot({})).toBe(false);
    expect(isContextPressureSnapshot({ inputTokens: 0 })).toBe(false);

    const { level: _, ...noLevel } = validSnapshot;
    expect(isContextPressureSnapshot(noLevel)).toBe(false);

    const { timestamp: __, ...noTimestamp } = validSnapshot;
    expect(isContextPressureSnapshot(noTimestamp)).toBe(false);
  });

  test("rejects invalid level", () => {
    expect(isContextPressureSnapshot({ ...validSnapshot, level: "high" })).toBe(false);
  });

  test("rejects non-objects", () => {
    expect(isContextPressureSnapshot(null)).toBe(false);
    expect(isContextPressureSnapshot("string")).toBe(false);
    expect(isContextPressureSnapshot(42)).toBe(false);
  });
});

describe("isContextPressureConfig", () => {
  const validConfig = {
    elevatedThreshold: 45,
    criticalThreshold: 60,
    maxContinuationsPerStage: 3,
    enableContinuation: true,
  };

  test("accepts a valid config", () => {
    expect(isContextPressureConfig(validConfig)).toBe(true);
  });

  test("accepts config with continuation disabled", () => {
    expect(isContextPressureConfig({ ...validConfig, enableContinuation: false })).toBe(true);
  });

  test("rejects missing fields", () => {
    expect(isContextPressureConfig({})).toBe(false);
    expect(isContextPressureConfig({ elevatedThreshold: 45 })).toBe(false);
  });

  test("rejects wrong types", () => {
    expect(isContextPressureConfig({ ...validConfig, enableContinuation: "yes" })).toBe(false);
    expect(isContextPressureConfig({ ...validConfig, criticalThreshold: "high" })).toBe(false);
  });

  test("rejects non-objects", () => {
    expect(isContextPressureConfig(null)).toBe(false);
    expect(isContextPressureConfig(undefined)).toBe(false);
  });
});

describe("isContinuationRecord", () => {
  const validRecord = {
    stageId: "orchestrator",
    continuationIndex: 0,
    triggerSnapshot: {
      inputTokens: 5000,
      outputTokens: 3000,
      maxTokens: 100000,
      usagePercentage: 70,
      level: "critical" as const,
      timestamp: "2026-03-20T00:00:00.000Z",
    },
    partialResponse: "partial work done",
    timestamp: "2026-03-20T00:00:01.000Z",
  };

  test("accepts a valid continuation record", () => {
    expect(isContinuationRecord(validRecord)).toBe(true);
  });

  test("rejects missing fields", () => {
    expect(isContinuationRecord({})).toBe(false);
    expect(isContinuationRecord({ stageId: "x" })).toBe(false);
  });

  test("rejects invalid triggerSnapshot", () => {
    expect(isContinuationRecord({
      ...validRecord,
      triggerSnapshot: { inputTokens: 0 },
    })).toBe(false);
  });

  test("rejects non-objects", () => {
    expect(isContinuationRecord(null)).toBe(false);
    expect(isContinuationRecord(42)).toBe(false);
  });
});

describe("isAccumulatedContextPressure", () => {
  const validAccumulated = {
    totalInputTokens: 5000,
    totalOutputTokens: 3000,
    totalContinuations: 1,
    stageSnapshots: new Map(),
    continuations: [],
  };

  test("accepts a valid accumulated pressure", () => {
    expect(isAccumulatedContextPressure(validAccumulated)).toBe(true);
  });

  test("accepts with populated snapshots and continuations", () => {
    const withData = {
      ...validAccumulated,
      stageSnapshots: new Map([["planner", {
        inputTokens: 5000,
        outputTokens: 3000,
        maxTokens: 100000,
        usagePercentage: 8,
        level: "normal" as const,
        timestamp: "2026-03-20T00:00:00.000Z",
      }]]),
      continuations: [{
        stageId: "x",
        continuationIndex: 0,
        triggerSnapshot: {} as never,
        partialResponse: "",
        timestamp: "",
      }],
    };
    expect(isAccumulatedContextPressure(withData)).toBe(true);
  });

  test("rejects missing fields", () => {
    expect(isAccumulatedContextPressure({})).toBe(false);
    expect(isAccumulatedContextPressure({ totalInputTokens: 0 })).toBe(false);
  });

  test("rejects when stageSnapshots is not a Map", () => {
    expect(isAccumulatedContextPressure({
      ...validAccumulated,
      stageSnapshots: {},
    })).toBe(false);
  });

  test("rejects when continuations is not an array", () => {
    expect(isAccumulatedContextPressure({
      ...validAccumulated,
      continuations: "not-array",
    })).toBe(false);
  });

  test("rejects non-objects", () => {
    expect(isAccumulatedContextPressure(null)).toBe(false);
    expect(isAccumulatedContextPressure(undefined)).toBe(false);
  });
});
