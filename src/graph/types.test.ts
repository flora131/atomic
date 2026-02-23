import { describe, expect, test } from "bun:test";
import {
  isNodeType,
  isSignal,
  isExecutionStatus,
  isBaseState,
  isNodeResult,
  isDebugReport,
  type NodeType,
  type Signal,
  type ExecutionStatus,
  type BaseState,
  type NodeResult,
  type DebugReport,
} from "./types.ts";

describe("isNodeType", () => {
  test("returns true for valid node types", () => {
    const validTypes: NodeType[] = ["agent", "tool", "decision", "wait", "subgraph", "parallel"];
    
    for (const type of validTypes) {
      expect(isNodeType(type)).toBe(true);
    }
  });

  test("returns false for invalid strings", () => {
    expect(isNodeType("invalid")).toBe(false);
    expect(isNodeType("")).toBe(false);
    expect(isNodeType("Agent")).toBe(false); // case-sensitive
  });

  test("returns false for non-string values", () => {
    expect(isNodeType(null)).toBe(false);
    expect(isNodeType(undefined)).toBe(false);
    expect(isNodeType(42)).toBe(false);
    expect(isNodeType({})).toBe(false);
    expect(isNodeType([])).toBe(false);
  });

  test("returns false for ask_user which is defined but not in the guard list", () => {
    // Note: ask_user is in the NodeType type but not in the type guard implementation
    expect(isNodeType("ask_user")).toBe(false);
  });
});

describe("isSignal", () => {
  test("returns true for valid signal types", () => {
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

  test("returns false for invalid strings", () => {
    expect(isSignal("invalid_signal")).toBe(false);
    expect(isSignal("")).toBe(false);
    expect(isSignal("checkpoint_saved")).toBe(false);
  });

  test("returns false for non-string values", () => {
    expect(isSignal(null)).toBe(false);
    expect(isSignal(undefined)).toBe(false);
    expect(isSignal(123)).toBe(false);
    expect(isSignal({})).toBe(false);
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

  test("returns false for invalid strings", () => {
    expect(isExecutionStatus("active")).toBe(false);
    expect(isExecutionStatus("")).toBe(false);
    expect(isExecutionStatus("COMPLETED")).toBe(false); // case-sensitive
  });

  test("returns false for non-string values", () => {
    expect(isExecutionStatus(null)).toBe(false);
    expect(isExecutionStatus(undefined)).toBe(false);
    expect(isExecutionStatus(true)).toBe(false);
    expect(isExecutionStatus([])).toBe(false);
  });
});

describe("isBaseState", () => {
  test("returns true for valid BaseState objects", () => {
    const validState: BaseState = {
      executionId: "exec-123",
      lastUpdated: "2024-01-01T00:00:00Z",
      outputs: {},
    };
    
    expect(isBaseState(validState)).toBe(true);
  });

  test("returns true for BaseState with populated outputs", () => {
    const state: BaseState = {
      executionId: "exec-456",
      lastUpdated: "2024-01-01T12:00:00Z",
      outputs: {
        node1: "result1",
        node2: { data: "result2" },
      },
    };
    
    expect(isBaseState(state)).toBe(true);
  });

  test("returns false for objects missing required fields", () => {
    expect(isBaseState({ executionId: "123" })).toBe(false);
    expect(isBaseState({ lastUpdated: "2024-01-01T00:00:00Z" })).toBe(false);
    expect(isBaseState({ outputs: {} })).toBe(false);
    expect(isBaseState({ executionId: "123", lastUpdated: "2024-01-01T00:00:00Z" })).toBe(false);
  });

  test("returns false for objects with wrong field types", () => {
    expect(isBaseState({
      executionId: 123,
      lastUpdated: "2024-01-01T00:00:00Z",
      outputs: {},
    })).toBe(false);

    expect(isBaseState({
      executionId: "123",
      lastUpdated: new Date(),
      outputs: {},
    })).toBe(false);

    expect(isBaseState({
      executionId: "123",
      lastUpdated: "2024-01-01T00:00:00Z",
      outputs: null,
    })).toBe(false);

    expect(isBaseState({
      executionId: "123",
      lastUpdated: "2024-01-01T00:00:00Z",
      outputs: "not-an-object",
    })).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(isBaseState(null)).toBe(false);
    expect(isBaseState(undefined)).toBe(false);
  });

  test("returns false for non-object values", () => {
    expect(isBaseState("string")).toBe(false);
    expect(isBaseState(123)).toBe(false);
    expect(isBaseState(true)).toBe(false);
    expect(isBaseState([])).toBe(false);
  });
});

describe("isNodeResult", () => {
  test("returns true for empty NodeResult", () => {
    expect(isNodeResult({})).toBe(true);
  });

  test("returns true for NodeResult with stateUpdate", () => {
    const result: NodeResult = {
      stateUpdate: { outputs: { node1: "value" } },
    };
    
    expect(isNodeResult(result)).toBe(true);
  });

  test("returns true for NodeResult with goto as string", () => {
    const result: NodeResult = {
      goto: "nextNode",
    };
    
    expect(isNodeResult(result)).toBe(true);
  });

  test("returns true for NodeResult with goto as array", () => {
    const result: NodeResult = {
      goto: ["node1", "node2"],
    };
    
    expect(isNodeResult(result)).toBe(true);
  });

  test("returns true for NodeResult with signals array", () => {
    const result: NodeResult = {
      signals: [
        { type: "checkpoint", message: "Saving state" },
      ],
    };
    
    expect(isNodeResult(result)).toBe(true);
  });

  test("returns true for complete NodeResult", () => {
    const result: NodeResult = {
      stateUpdate: { outputs: {} },
      goto: "nextNode",
      signals: [{ type: "checkpoint" }],
      message: "[Phase] Completed.",
    };
    
    expect(isNodeResult(result)).toBe(true);
  });

  test("returns false for invalid stateUpdate type", () => {
    expect(isNodeResult({ stateUpdate: "invalid" })).toBe(false);
    expect(isNodeResult({ stateUpdate: 123 })).toBe(false);
    // Note: null is accepted because typeof null === "object" in JavaScript
    expect(isNodeResult({ stateUpdate: null })).toBe(true);
  });

  test("returns false for invalid goto type", () => {
    expect(isNodeResult({ goto: 123 })).toBe(false);
    expect(isNodeResult({ goto: {} })).toBe(false);
    expect(isNodeResult({ goto: true })).toBe(false);
  });

  test("returns false for invalid signals type", () => {
    expect(isNodeResult({ signals: "not-array" })).toBe(false);
    expect(isNodeResult({ signals: {} })).toBe(false);
    expect(isNodeResult({ signals: 123 })).toBe(false);
  });

  test("returns false for invalid message type", () => {
    expect(isNodeResult({ message: 123 })).toBe(false);
    expect(isNodeResult({ message: {} })).toBe(false);
    expect(isNodeResult({ message: true })).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(isNodeResult(null)).toBe(false);
    expect(isNodeResult(undefined)).toBe(false);
  });

  test("returns false for non-object values", () => {
    expect(isNodeResult("string")).toBe(false);
    expect(isNodeResult(123)).toBe(false);
    expect(isNodeResult(true)).toBe(false);
  });
});

describe("isDebugReport", () => {
  test("returns true for valid DebugReport", () => {
    const report: DebugReport = {
      errorSummary: "Something went wrong",
      relevantFiles: ["/path/to/file.ts"],
      suggestedFixes: ["Try restarting the service"],
      generatedAt: "2024-01-01T00:00:00Z",
    };
    
    expect(isDebugReport(report)).toBe(true);
  });

  test("returns true for DebugReport with optional fields", () => {
    const report: DebugReport = {
      errorSummary: "Error occurred",
      stackTrace: "Error: test\n  at ...",
      relevantFiles: [],
      suggestedFixes: [],
      generatedAt: "2024-01-01T00:00:00Z",
      nodeId: "node-123",
      executionId: "exec-456",
    };
    
    expect(isDebugReport(report)).toBe(true);
  });

  test("returns false for objects missing required fields", () => {
    expect(isDebugReport({
      errorSummary: "Error",
      relevantFiles: [],
      suggestedFixes: [],
    })).toBe(false);

    expect(isDebugReport({
      relevantFiles: [],
      suggestedFixes: [],
      generatedAt: "2024-01-01T00:00:00Z",
    })).toBe(false);

    expect(isDebugReport({
      errorSummary: "Error",
      suggestedFixes: [],
      generatedAt: "2024-01-01T00:00:00Z",
    })).toBe(false);

    expect(isDebugReport({
      errorSummary: "Error",
      relevantFiles: [],
      generatedAt: "2024-01-01T00:00:00Z",
    })).toBe(false);
  });

  test("returns false for objects with wrong field types", () => {
    expect(isDebugReport({
      errorSummary: 123,
      relevantFiles: [],
      suggestedFixes: [],
      generatedAt: "2024-01-01T00:00:00Z",
    })).toBe(false);

    expect(isDebugReport({
      errorSummary: "Error",
      relevantFiles: "not-array",
      suggestedFixes: [],
      generatedAt: "2024-01-01T00:00:00Z",
    })).toBe(false);

    expect(isDebugReport({
      errorSummary: "Error",
      relevantFiles: [],
      suggestedFixes: {},
      generatedAt: "2024-01-01T00:00:00Z",
    })).toBe(false);

    expect(isDebugReport({
      errorSummary: "Error",
      relevantFiles: [],
      suggestedFixes: [],
      generatedAt: new Date(),
    })).toBe(false);
  });

  test("returns false for null and undefined", () => {
    expect(isDebugReport(null)).toBe(false);
    expect(isDebugReport(undefined)).toBe(false);
  });

  test("returns false for non-object values", () => {
    expect(isDebugReport("string")).toBe(false);
    expect(isDebugReport([])).toBe(false);
    expect(isDebugReport(123)).toBe(false);
  });
});
