/**
 * Unit tests for graph type definitions
 *
 * Tests cover:
 * - Type guards for runtime type checking
 * - Default configuration values
 * - Type structure validation
 */

import { describe, test, expect } from "bun:test";
import {
  isNodeType,
  isSignal,
  isExecutionStatus,
  isBaseState,
  isNodeResult,
  isDebugReport,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_GRAPH_CONFIG,
  type NodeType,
  type Signal,
  type ExecutionStatus,
  type BaseState,
  type NodeResult,
  type DebugReport,
  type RetryConfig,
  type NodeDefinition,
  type ExecutionContext,
  type GraphConfig,
  type Edge,
  type ExecutionError,
  type SignalData,
  type ContextWindowUsage,
  type ProgressEvent,
  type ExecutionSnapshot,
  type Checkpointer,
} from "../../src/graph/types.ts";

// ============================================================================
// Type Guard Tests
// ============================================================================

describe("isNodeType", () => {
  test("returns true for valid node types", () => {
    const validTypes: NodeType[] = ["agent", "tool", "decision", "wait", "subgraph", "parallel"];
    for (const type of validTypes) {
      expect(isNodeType(type)).toBe(true);
    }
  });

  test("returns false for invalid node types", () => {
    expect(isNodeType("invalid")).toBe(false);
    expect(isNodeType("")).toBe(false);
    expect(isNodeType(123)).toBe(false);
    expect(isNodeType(null)).toBe(false);
    expect(isNodeType(undefined)).toBe(false);
    expect(isNodeType({})).toBe(false);
  });
});

describe("isSignal", () => {
  test("returns true for valid signals", () => {
    const validSignals: Signal[] = [
      "context_window_warning",
      "checkpoint",
      "human_input_required",
      "debug_report_generated",
    ];
    for (const signal of validSignals) {
      expect(isSignal(signal)).toBe(true);
    }
  });

  test("returns false for invalid signals", () => {
    expect(isSignal("invalid")).toBe(false);
    expect(isSignal("")).toBe(false);
    expect(isSignal(123)).toBe(false);
    expect(isSignal(null)).toBe(false);
    expect(isSignal(undefined)).toBe(false);
  });
});

describe("isExecutionStatus", () => {
  test("returns true for valid execution statuses", () => {
    const validStatuses: ExecutionStatus[] = [
      "pending",
      "running",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ];
    for (const status of validStatuses) {
      expect(isExecutionStatus(status)).toBe(true);
    }
  });

  test("returns false for invalid execution statuses", () => {
    expect(isExecutionStatus("invalid")).toBe(false);
    expect(isExecutionStatus("")).toBe(false);
    expect(isExecutionStatus(123)).toBe(false);
    expect(isExecutionStatus(null)).toBe(false);
    expect(isExecutionStatus(undefined)).toBe(false);
  });
});

describe("isBaseState", () => {
  test("returns true for valid BaseState objects", () => {
    const validState: BaseState = {
      executionId: "exec-123",
      lastUpdated: new Date().toISOString(),
      outputs: {},
    };
    expect(isBaseState(validState)).toBe(true);
  });

  test("returns true for BaseState with outputs", () => {
    const validState: BaseState = {
      executionId: "exec-123",
      lastUpdated: new Date().toISOString(),
      outputs: {
        "node-1": { result: "success" },
        "node-2": 42,
      },
    };
    expect(isBaseState(validState)).toBe(true);
  });

  test("returns false for invalid BaseState objects", () => {
    expect(isBaseState(null)).toBe(false);
    expect(isBaseState(undefined)).toBe(false);
    expect(isBaseState({})).toBe(false);
    expect(isBaseState({ executionId: "test" })).toBe(false);
    expect(isBaseState({ executionId: "test", lastUpdated: "2024-01-01" })).toBe(false);
    expect(isBaseState({ executionId: 123, lastUpdated: "2024-01-01", outputs: {} })).toBe(false);
    expect(isBaseState({ executionId: "test", lastUpdated: 123, outputs: {} })).toBe(false);
    expect(isBaseState({ executionId: "test", lastUpdated: "2024-01-01", outputs: null })).toBe(
      false
    );
  });
});

describe("isNodeResult", () => {
  test("returns true for empty NodeResult", () => {
    expect(isNodeResult({})).toBe(true);
  });

  test("returns true for NodeResult with stateUpdate", () => {
    const result: NodeResult = {
      stateUpdate: { outputs: { "node-1": "done" } },
    };
    expect(isNodeResult(result)).toBe(true);
  });

  test("returns true for NodeResult with goto string", () => {
    const result: NodeResult = {
      goto: "next-node",
    };
    expect(isNodeResult(result)).toBe(true);
  });

  test("returns true for NodeResult with goto array", () => {
    const result: NodeResult = {
      goto: ["node-a", "node-b"],
    };
    expect(isNodeResult(result)).toBe(true);
  });

  test("returns true for NodeResult with signals", () => {
    const result: NodeResult = {
      signals: [{ type: "checkpoint", message: "Progress saved" }],
    };
    expect(isNodeResult(result)).toBe(true);
  });

  test("returns true for complete NodeResult", () => {
    const result: NodeResult = {
      stateUpdate: { outputs: { "node-1": "done" } },
      goto: "next-node",
      signals: [{ type: "checkpoint" }],
    };
    expect(isNodeResult(result)).toBe(true);
  });

  test("returns false for invalid NodeResult", () => {
    expect(isNodeResult(null)).toBe(false);
    expect(isNodeResult(undefined)).toBe(false);
    expect(isNodeResult("string")).toBe(false);
    expect(isNodeResult({ stateUpdate: "invalid" })).toBe(false);
    expect(isNodeResult({ goto: 123 })).toBe(false);
    expect(isNodeResult({ signals: "not-array" })).toBe(false);
  });
});

describe("isDebugReport", () => {
  test("returns true for valid DebugReport", () => {
    const report: DebugReport = {
      errorSummary: "Test error occurred",
      relevantFiles: ["file1.ts", "file2.ts"],
      suggestedFixes: ["Fix 1", "Fix 2"],
      generatedAt: new Date().toISOString(),
    };
    expect(isDebugReport(report)).toBe(true);
  });

  test("returns true for DebugReport with optional fields", () => {
    const report: DebugReport = {
      errorSummary: "Test error occurred",
      stackTrace: "Error: Test\n  at ...",
      relevantFiles: ["file1.ts"],
      suggestedFixes: ["Fix 1"],
      generatedAt: new Date().toISOString(),
      nodeId: "node-1",
      executionId: "exec-123",
    };
    expect(isDebugReport(report)).toBe(true);
  });

  test("returns false for invalid DebugReport", () => {
    expect(isDebugReport(null)).toBe(false);
    expect(isDebugReport(undefined)).toBe(false);
    expect(isDebugReport({})).toBe(false);
    expect(isDebugReport({ errorSummary: "test" })).toBe(false);
    expect(
      isDebugReport({
        errorSummary: "test",
        relevantFiles: [],
        suggestedFixes: [],
      })
    ).toBe(false);
    expect(
      isDebugReport({
        errorSummary: 123,
        relevantFiles: [],
        suggestedFixes: [],
        generatedAt: "2024-01-01",
      })
    ).toBe(false);
  });
});

// ============================================================================
// Default Configuration Tests
// ============================================================================

describe("DEFAULT_RETRY_CONFIG", () => {
  test("has expected default values", () => {
    expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.backoffMs).toBe(1000);
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
    expect(DEFAULT_RETRY_CONFIG.retryOn).toBeUndefined();
  });

  test("is a valid RetryConfig", () => {
    const config: RetryConfig = DEFAULT_RETRY_CONFIG;
    expect(config).toBeDefined();
    expect(typeof config.maxAttempts).toBe("number");
    expect(typeof config.backoffMs).toBe("number");
    expect(typeof config.backoffMultiplier).toBe("number");
  });
});

describe("DEFAULT_GRAPH_CONFIG", () => {
  test("has expected default values", () => {
    expect(DEFAULT_GRAPH_CONFIG.maxConcurrency).toBe(1);
    expect(DEFAULT_GRAPH_CONFIG.contextWindowThreshold).toBe(45);
    expect(DEFAULT_GRAPH_CONFIG.autoCheckpoint).toBe(true);
  });

  test("is a valid partial GraphConfig", () => {
    const config: Partial<GraphConfig> = DEFAULT_GRAPH_CONFIG;
    expect(config).toBeDefined();
  });
});

// ============================================================================
// Type Structure Tests (Compile-time validation)
// ============================================================================

describe("Type Structure", () => {
  test("NodeDefinition can be created with required fields", () => {
    const node: NodeDefinition = {
      id: "test-node",
      type: "agent",
      execute: async () => ({}),
    };
    expect(node.id).toBe("test-node");
    expect(node.type).toBe("agent");
    expect(typeof node.execute).toBe("function");
  });

  test("NodeDefinition can include optional fields", () => {
    const node: NodeDefinition = {
      id: "test-node",
      type: "tool",
      execute: async () => ({ stateUpdate: {} }),
      retry: DEFAULT_RETRY_CONFIG,
      name: "Test Node",
      description: "A test node for unit tests",
    };
    expect(node.name).toBe("Test Node");
    expect(node.description).toBeDefined();
    expect(node.retry).toBeDefined();
  });

  test("ExecutionContext can be created", () => {
    const context: ExecutionContext = {
      state: {
        executionId: "exec-123",
        lastUpdated: new Date().toISOString(),
        outputs: {},
      },
      config: {},
      errors: [],
    };
    expect(context.state.executionId).toBe("exec-123");
    expect(context.errors).toEqual([]);
  });

  test("Edge can be created with condition", () => {
    const edge: Edge = {
      from: "node-a",
      to: "node-b",
      condition: (state) => state.executionId !== "",
      label: "success path",
    };
    expect(edge.from).toBe("node-a");
    expect(edge.to).toBe("node-b");
    expect(typeof edge.condition).toBe("function");
    expect(edge.label).toBe("success path");
  });

  test("ExecutionError can be created", () => {
    const error: ExecutionError = {
      nodeId: "node-1",
      error: new Error("Test error"),
      timestamp: new Date().toISOString(),
      attempt: 1,
    };
    expect(error.nodeId).toBe("node-1");
    expect(error.attempt).toBe(1);
  });

  test("ExecutionError can use string error", () => {
    const error: ExecutionError = {
      nodeId: "node-1",
      error: "Simple error message",
      timestamp: new Date().toISOString(),
      attempt: 2,
    };
    expect(error.error).toBe("Simple error message");
  });

  test("SignalData can be created", () => {
    const signal: SignalData = {
      type: "checkpoint",
      message: "Progress saved",
      data: { iteration: 5 },
    };
    expect(signal.type).toBe("checkpoint");
    expect(signal.message).toBe("Progress saved");
  });

  test("ContextWindowUsage can be created", () => {
    const usage: ContextWindowUsage = {
      inputTokens: 5000,
      outputTokens: 2000,
      maxTokens: 200000,
      usagePercentage: 3.5,
    };
    expect(usage.inputTokens).toBe(5000);
    expect(usage.usagePercentage).toBe(3.5);
  });

  test("ProgressEvent can be created", () => {
    const event: ProgressEvent = {
      type: "node_completed",
      nodeId: "node-1",
      state: {
        executionId: "exec-123",
        lastUpdated: new Date().toISOString(),
        outputs: { "node-1": "done" },
      },
      timestamp: new Date().toISOString(),
    };
    expect(event.type).toBe("node_completed");
    expect(event.nodeId).toBe("node-1");
  });

  test("ExecutionSnapshot can be created", () => {
    const snapshot: ExecutionSnapshot = {
      executionId: "exec-123",
      state: {
        executionId: "exec-123",
        lastUpdated: new Date().toISOString(),
        outputs: {},
      },
      status: "running",
      currentNodeId: "node-2",
      visitedNodes: ["node-1"],
      errors: [],
      signals: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodeExecutionCount: 1,
    };
    expect(snapshot.status).toBe("running");
    expect(snapshot.visitedNodes).toContain("node-1");
  });

  test("GraphConfig can be created with checkpointer", () => {
    const mockCheckpointer: Checkpointer = {
      save: async () => {},
      load: async () => null,
      list: async () => [],
      delete: async () => {},
    };

    const config: GraphConfig = {
      checkpointer: mockCheckpointer,
      maxConcurrency: 2,
      timeout: 60000,
      onProgress: (event) => console.log(event),
      contextWindowThreshold: 80,
      autoCheckpoint: false,
      metadata: { version: "1.0" },
    };

    expect(config.checkpointer).toBeDefined();
    expect(config.maxConcurrency).toBe(2);
    expect(config.timeout).toBe(60000);
  });
});

// ============================================================================
// Functional Tests
// ============================================================================

describe("NodeExecuteFn", () => {
  test("can be async function returning empty result", async () => {
    const execute = async (): Promise<NodeResult> => {
      return {};
    };

    const result = await execute();
    expect(result).toEqual({});
  });

  test("can return state update", async () => {
    interface CustomState extends BaseState {
      counter: number;
    }

    const execute = async (
      context: ExecutionContext<CustomState>
    ): Promise<NodeResult<CustomState>> => {
      return {
        stateUpdate: {
          counter: context.state.counter + 1,
        },
      };
    };

    const context: ExecutionContext<CustomState> = {
      state: {
        executionId: "exec-123",
        lastUpdated: new Date().toISOString(),
        outputs: {},
        counter: 5,
      },
      config: {},
      errors: [],
    };

    const result = await execute(context);
    expect(result.stateUpdate?.counter).toBe(6);
  });

  test("can return goto instruction", async () => {
    const execute = async (): Promise<NodeResult> => {
      return {
        goto: "error-handler",
      };
    };

    const result = await execute();
    expect(result.goto).toBe("error-handler");
  });

  test("can emit signals", async () => {
    const execute = async (): Promise<NodeResult> => {
      return {
        signals: [
          { type: "checkpoint", message: "Saving progress" },
          { type: "context_window_warning", data: { usage: 75 } },
        ],
      };
    };

    const result = await execute();
    expect(result.signals).toBeDefined();
    expect(result.signals).toHaveLength(2);
    const signals = result.signals ?? [];
    expect(signals[0]?.type).toBe("checkpoint");
    expect(signals[1]?.type).toBe("context_window_warning");
  });
});

describe("EdgeCondition", () => {
  test("can evaluate state conditions", () => {
    interface CustomState extends BaseState {
      approved: boolean;
    }

    const condition = (state: CustomState): boolean => {
      return state.approved === true;
    };

    const approvedState: CustomState = {
      executionId: "exec-123",
      lastUpdated: new Date().toISOString(),
      outputs: {},
      approved: true,
    };

    const rejectedState: CustomState = {
      executionId: "exec-456",
      lastUpdated: new Date().toISOString(),
      outputs: {},
      approved: false,
    };

    expect(condition(approvedState)).toBe(true);
    expect(condition(rejectedState)).toBe(false);
  });
});

describe("RetryConfig.retryOn", () => {
  test("can filter retryable errors", () => {
    const config: RetryConfig = {
      maxAttempts: 3,
      backoffMs: 1000,
      backoffMultiplier: 2,
      retryOn: (error: Error) => {
        return error.message.includes("transient") || error.message.includes("timeout");
      },
    };

    const transientError = new Error("transient network failure");
    const timeoutError = new Error("request timeout");
    const permanentError = new Error("invalid configuration");

    expect(config.retryOn!(transientError)).toBe(true);
    expect(config.retryOn!(timeoutError)).toBe(true);
    expect(config.retryOn!(permanentError)).toBe(false);
  });
});
