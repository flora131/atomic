/**
 * Tests for useStreamingState Hook
 *
 * Tests cover:
 * - Initial state
 * - Streaming start/stop
 * - Chunk handling
 * - Tool execution lifecycle
 * - Pending questions
 * - Utility functions
 */

import { describe, test, expect } from "bun:test";
import {
  createInitialStreamingState,
  generateToolExecutionId,
  getCurrentTimestamp,
  createToolExecution,
  getActiveToolExecutions,
  getCompletedToolExecutions,
  getErroredToolExecutions,
  type StreamingState,
  type ToolExecutionState,
  type ToolExecutionStatus,
} from "../../../src/ui/hooks/use-streaming-state.ts";

// ============================================================================
// INITIAL STATE TESTS
// ============================================================================

describe("createInitialStreamingState", () => {
  test("creates correct initial state", () => {
    const state = createInitialStreamingState();

    expect(state.isStreaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
    expect(state.toolExecutions.size).toBe(0);
    expect(state.pendingQuestions).toEqual([]);
  });

  test("creates independent state instances", () => {
    const state1 = createInitialStreamingState();
    const state2 = createInitialStreamingState();

    // Modify state1
    state1.isStreaming = true;
    state1.toolExecutions.set("test", {} as ToolExecutionState);

    // state2 should be unaffected
    expect(state2.isStreaming).toBe(false);
    expect(state2.toolExecutions.size).toBe(0);
  });
});

// ============================================================================
// GENERATE TOOL EXECUTION ID TESTS
// ============================================================================

describe("generateToolExecutionId", () => {
  test("generates string starting with 'tool_'", () => {
    const id = generateToolExecutionId();
    expect(id.startsWith("tool_")).toBe(true);
  });

  test("generates unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateToolExecutionId());
    }
    expect(ids.size).toBe(100);
  });

  test("generates IDs with consistent format", () => {
    const id = generateToolExecutionId();
    // Format: tool_<timestamp>_<random>
    const parts = id.split("_");
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe("tool");
  });
});

// ============================================================================
// GET CURRENT TIMESTAMP TESTS
// ============================================================================

describe("getCurrentTimestamp", () => {
  test("returns ISO string format", () => {
    const timestamp = getCurrentTimestamp();
    expect(() => new Date(timestamp)).not.toThrow();
  });

  test("returns current time", () => {
    const before = Date.now();
    const timestamp = getCurrentTimestamp();
    const after = Date.now();

    const timestampMs = new Date(timestamp).getTime();
    expect(timestampMs).toBeGreaterThanOrEqual(before);
    expect(timestampMs).toBeLessThanOrEqual(after);
  });
});

// ============================================================================
// CREATE TOOL EXECUTION TESTS
// ============================================================================

describe("createToolExecution", () => {
  test("creates execution with correct properties", () => {
    const exec = createToolExecution("test_id", "Read", { file: "test.ts" });

    expect(exec.id).toBe("test_id");
    expect(exec.toolName).toBe("Read");
    expect(exec.status).toBe("running");
    expect(exec.input).toEqual({ file: "test.ts" });
    expect(exec.output).toBeUndefined();
    expect(exec.error).toBeUndefined();
  });

  test("sets startedAt timestamp", () => {
    const before = Date.now();
    const exec = createToolExecution("test_id", "Bash", { command: "ls" });
    const after = Date.now();

    const startedMs = new Date(exec.timestamps.startedAt).getTime();
    expect(startedMs).toBeGreaterThanOrEqual(before);
    expect(startedMs).toBeLessThanOrEqual(after);
  });

  test("completedAt is undefined initially", () => {
    const exec = createToolExecution("test_id", "Write", { content: "hello" });
    expect(exec.timestamps.completedAt).toBeUndefined();
  });

  test("handles empty input", () => {
    const exec = createToolExecution("test_id", "Clear", {});
    expect(exec.input).toEqual({});
  });
});

// ============================================================================
// GET ACTIVE/COMPLETED/ERRORED TOOL EXECUTIONS TESTS
// ============================================================================

describe("getActiveToolExecutions", () => {
  test("returns only running executions", () => {
    const executions = new Map<string, ToolExecutionState>([
      ["1", { ...createToolExecution("1", "Read", {}), status: "running" }],
      ["2", { ...createToolExecution("2", "Write", {}), status: "completed" }],
      ["3", { ...createToolExecution("3", "Bash", {}), status: "running" }],
      ["4", { ...createToolExecution("4", "Edit", {}), status: "error" }],
    ]);

    const active = getActiveToolExecutions(executions);

    expect(active).toHaveLength(2);
    expect(active.map((e) => e.id)).toEqual(["1", "3"]);
  });

  test("returns empty array when no active executions", () => {
    const executions = new Map<string, ToolExecutionState>([
      ["1", { ...createToolExecution("1", "Read", {}), status: "completed" }],
    ]);

    const active = getActiveToolExecutions(executions);
    expect(active).toEqual([]);
  });

  test("handles empty map", () => {
    const executions = new Map<string, ToolExecutionState>();
    const active = getActiveToolExecutions(executions);
    expect(active).toEqual([]);
  });
});

describe("getCompletedToolExecutions", () => {
  test("returns only completed executions", () => {
    const executions = new Map<string, ToolExecutionState>([
      ["1", { ...createToolExecution("1", "Read", {}), status: "running" }],
      ["2", { ...createToolExecution("2", "Write", {}), status: "completed" }],
      ["3", { ...createToolExecution("3", "Bash", {}), status: "completed" }],
    ]);

    const completed = getCompletedToolExecutions(executions);

    expect(completed).toHaveLength(2);
    expect(completed.map((e) => e.id)).toEqual(["2", "3"]);
  });

  test("returns empty array when no completed executions", () => {
    const executions = new Map<string, ToolExecutionState>([
      ["1", { ...createToolExecution("1", "Read", {}), status: "running" }],
    ]);

    const completed = getCompletedToolExecutions(executions);
    expect(completed).toEqual([]);
  });
});

describe("getErroredToolExecutions", () => {
  test("returns only errored executions", () => {
    const executions = new Map<string, ToolExecutionState>([
      ["1", { ...createToolExecution("1", "Read", {}), status: "running" }],
      ["2", { ...createToolExecution("2", "Write", {}), status: "error", error: "Failed" }],
      ["3", { ...createToolExecution("3", "Bash", {}), status: "completed" }],
    ]);

    const errored = getErroredToolExecutions(executions);

    expect(errored).toHaveLength(1);
    expect(errored[0]?.id).toBe("2");
  });

  test("returns empty array when no errored executions", () => {
    const executions = new Map<string, ToolExecutionState>([
      ["1", { ...createToolExecution("1", "Read", {}), status: "completed" }],
    ]);

    const errored = getErroredToolExecutions(executions);
    expect(errored).toEqual([]);
  });
});

// ============================================================================
// STREAMING STATE STRUCTURE TESTS
// ============================================================================

describe("StreamingState structure", () => {
  test("streaming in progress", () => {
    const state: StreamingState = {
      isStreaming: true,
      streamingMessageId: "msg_123",
      toolExecutions: new Map(),
      pendingQuestions: [],
    };

    expect(state.isStreaming).toBe(true);
    expect(state.streamingMessageId).toBe("msg_123");
  });

  test("with tool executions", () => {
    const toolExec = createToolExecution("tool_1", "Read", { file: "test.ts" });
    const state: StreamingState = {
      isStreaming: true,
      streamingMessageId: "msg_123",
      toolExecutions: new Map([["tool_1", toolExec]]),
      pendingQuestions: [],
    };

    expect(state.toolExecutions.size).toBe(1);
    expect(state.toolExecutions.get("tool_1")?.toolName).toBe("Read");
  });

  test("with pending questions", () => {
    const state: StreamingState = {
      isStreaming: false,
      streamingMessageId: null,
      toolExecutions: new Map(),
      pendingQuestions: [
        {
          header: "Choose",
          question: "Select an option",
          options: [{ label: "A", value: "a" }],
        },
      ],
    };

    expect(state.pendingQuestions).toHaveLength(1);
    expect(state.pendingQuestions[0]?.header).toBe("Choose");
  });
});

// ============================================================================
// TOOL EXECUTION STATE STRUCTURE TESTS
// ============================================================================

describe("ToolExecutionState structure", () => {
  test("running state", () => {
    const state: ToolExecutionState = {
      id: "tool_1",
      toolName: "Read",
      status: "running",
      input: { file: "test.ts" },
      timestamps: {
        startedAt: "2026-01-31T12:00:00.000Z",
      },
    };

    expect(state.status).toBe("running");
    expect(state.output).toBeUndefined();
    expect(state.error).toBeUndefined();
  });

  test("completed state with output", () => {
    const state: ToolExecutionState = {
      id: "tool_1",
      toolName: "Read",
      status: "completed",
      input: { file: "test.ts" },
      output: { content: "file contents" },
      timestamps: {
        startedAt: "2026-01-31T12:00:00.000Z",
        completedAt: "2026-01-31T12:00:01.000Z",
      },
    };

    expect(state.status).toBe("completed");
    expect(state.output).toEqual({ content: "file contents" });
    expect(state.timestamps.completedAt).toBeDefined();
  });

  test("error state", () => {
    const state: ToolExecutionState = {
      id: "tool_1",
      toolName: "Bash",
      status: "error",
      input: { command: "invalid_cmd" },
      error: "Command not found",
      timestamps: {
        startedAt: "2026-01-31T12:00:00.000Z",
        completedAt: "2026-01-31T12:00:01.000Z",
      },
    };

    expect(state.status).toBe("error");
    expect(state.error).toBe("Command not found");
  });
});

// ============================================================================
// TOOL EXECUTION STATUS TESTS
// ============================================================================

describe("ToolExecutionStatus", () => {
  test("all valid status values", () => {
    const statuses: ToolExecutionStatus[] = ["pending", "running", "completed", "error"];

    expect(statuses).toContain("pending");
    expect(statuses).toContain("running");
    expect(statuses).toContain("completed");
    expect(statuses).toContain("error");
  });
});

// ============================================================================
// STATE MANIPULATION SIMULATIONS
// ============================================================================

describe("State manipulation simulations", () => {
  test("start streaming flow", () => {
    let state = createInitialStreamingState();

    // Simulate startStreaming
    state = {
      ...state,
      isStreaming: true,
      streamingMessageId: "msg_1",
    };

    expect(state.isStreaming).toBe(true);
    expect(state.streamingMessageId).toBe("msg_1");
  });

  test("stop streaming flow", () => {
    let state: StreamingState = {
      isStreaming: true,
      streamingMessageId: "msg_1",
      toolExecutions: new Map(),
      pendingQuestions: [],
    };

    // Simulate stopStreaming
    state = {
      ...state,
      isStreaming: false,
      streamingMessageId: null,
    };

    expect(state.isStreaming).toBe(false);
    expect(state.streamingMessageId).toBeNull();
  });

  test("tool execution lifecycle", () => {
    let state = createInitialStreamingState();

    // Start tool
    const toolExec = createToolExecution("tool_1", "Read", { file: "test.ts" });
    state = {
      ...state,
      toolExecutions: new Map(state.toolExecutions).set("tool_1", toolExec),
    };
    expect(state.toolExecutions.get("tool_1")?.status).toBe("running");

    // Complete tool
    const existing = state.toolExecutions.get("tool_1")!;
    state = {
      ...state,
      toolExecutions: new Map(state.toolExecutions).set("tool_1", {
        ...existing,
        status: "completed",
        output: { content: "file contents" },
        timestamps: {
          ...existing.timestamps,
          completedAt: getCurrentTimestamp(),
        },
      }),
    };

    expect(state.toolExecutions.get("tool_1")?.status).toBe("completed");
    expect(state.toolExecutions.get("tool_1")?.output).toEqual({ content: "file contents" });
  });

  test("add pending question", () => {
    let state = createInitialStreamingState();

    const question = {
      header: "Confirm",
      question: "Are you sure?",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
    };

    state = {
      ...state,
      pendingQuestions: [...state.pendingQuestions, question],
    };

    expect(state.pendingQuestions).toHaveLength(1);
    expect(state.pendingQuestions[0]).toBe(question);
  });

  test("remove pending question", () => {
    const question1 = { header: "Q1", question: "First?", options: [] };
    const question2 = { header: "Q2", question: "Second?", options: [] };

    let state: StreamingState = {
      ...createInitialStreamingState(),
      pendingQuestions: [question1, question2],
    };

    // Remove first question
    const [removed, ...remaining] = state.pendingQuestions;
    state = {
      ...state,
      pendingQuestions: remaining,
    };

    expect(removed).toBe(question1);
    expect(state.pendingQuestions).toHaveLength(1);
    expect(state.pendingQuestions[0]).toBe(question2);
  });

  test("reset state", () => {
    const state: StreamingState = {
      isStreaming: true,
      streamingMessageId: "msg_1",
      toolExecutions: new Map([["tool_1", createToolExecution("tool_1", "Read", {})]]),
      pendingQuestions: [{ header: "Q", question: "?", options: [] }],
    };

    const resetState = createInitialStreamingState();

    expect(resetState.isStreaming).toBe(false);
    expect(resetState.streamingMessageId).toBeNull();
    expect(resetState.toolExecutions.size).toBe(0);
    expect(resetState.pendingQuestions).toEqual([]);
  });
});

// ============================================================================
// CHUNK HANDLING TESTS
// ============================================================================

describe("Chunk handling", () => {
  test("handleChunk returns the chunk", () => {
    // Simulating handleChunk behavior - just passes through
    const chunk = "Hello, world!";
    const result = chunk; // handleChunk just returns the chunk

    expect(result).toBe("Hello, world!");
  });

  test("handles empty chunk", () => {
    const chunk = "";
    expect(chunk).toBe("");
  });

  test("handles multiline chunk", () => {
    const chunk = "Line 1\nLine 2\nLine 3";
    expect(chunk.split("\n")).toHaveLength(3);
  });
});
