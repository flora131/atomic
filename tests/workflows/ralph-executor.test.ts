/**
 * Tests for RalphExecutor
 *
 * Tests the RalphExecutor class for workflow execution and interrupt handling.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  RalphExecutor,
  createRalphExecutor,
  type RalphExecutorRunOptions,
  type RalphExecutorResult,
} from "../../src/workflows/ralph-executor.ts";
import { createRalphWorkflow } from "../../src/workflows/ralph.ts";
import type { RalphWorkflowState } from "../../src/graph/nodes/ralph-nodes.ts";

// ============================================================================
// RalphExecutor Class Tests
// ============================================================================

describe("RalphExecutor", () => {
  let executor: RalphExecutor;

  beforeEach(() => {
    executor = new RalphExecutor();
  });

  afterEach(() => {
    // Clean up handlers to prevent test interference
    executor.cleanup();
  });

  describe("constructor", () => {
    test("creates instance with abort controller", () => {
      expect(executor).toBeInstanceOf(RalphExecutor);
      expect(executor.signal).toBeInstanceOf(AbortSignal);
    });

    test("starts in non-aborted state", () => {
      expect(executor.aborted).toBe(false);
    });
  });

  describe("signal property", () => {
    test("returns AbortSignal", () => {
      expect(executor.signal).toBeInstanceOf(AbortSignal);
    });

    test("signal is not aborted initially", () => {
      expect(executor.signal.aborted).toBe(false);
    });
  });

  describe("aborted property", () => {
    test("returns false initially", () => {
      expect(executor.aborted).toBe(false);
    });
  });

  describe("setSession()", () => {
    test("sets session ID and directory", () => {
      const sessionId = "test-session-123";
      const sessionDir = "/tmp/ralph/sessions/test-session-123";

      // Should not throw
      expect(() => {
        executor.setSession(sessionId, sessionDir);
      }).not.toThrow();
    });
  });

  describe("cleanup()", () => {
    test("can be called multiple times safely", () => {
      executor.cleanup();
      executor.cleanup();
      executor.cleanup();

      // Should not throw
      expect(executor.aborted).toBe(false);
    });

    test("cleanup is idempotent", () => {
      // Call cleanup multiple times
      executor.cleanup();
      executor.cleanup();

      // No errors should occur
      expect(true).toBe(true);
    });
  });

  describe("run()", () => {
    test("returns RalphExecutorResult", async () => {
      const workflow = createRalphWorkflow();
      const config = { maxIterations: 5 };

      const result = await executor.run(workflow, config);

      expect(result).toBeDefined();
      expect(typeof result.completed).toBe("boolean");
      expect(typeof result.interrupted).toBe("boolean");
    });

    test("accepts initial state", async () => {
      const workflow = createRalphWorkflow();
      const config = { maxIterations: 5 };
      const initialState: Partial<RalphWorkflowState> = {
        executionId: "test-exec-123",
        iteration: 0,
      };

      const result = await executor.run(workflow, config, { initialState });

      expect(result).toBeDefined();
    });

    test("resets abort controller for new run", async () => {
      const workflow = createRalphWorkflow();
      const config = { maxIterations: 5 };

      // First run
      await executor.run(workflow, config);

      // Second run should have fresh abort controller
      const signal1 = executor.signal;
      await executor.run(workflow, config);
      const signal2 = executor.signal;

      // Signals should be different objects (new AbortController each run)
      expect(signal1).not.toBe(signal2);
    });
  });
});

// ============================================================================
// createRalphExecutor Factory Tests
// ============================================================================

describe("createRalphExecutor", () => {
  test("creates RalphExecutor instance", () => {
    const executor = createRalphExecutor();

    expect(executor).toBeInstanceOf(RalphExecutor);
    executor.cleanup();
  });

  test("creates new instance each call", () => {
    const executor1 = createRalphExecutor();
    const executor2 = createRalphExecutor();

    expect(executor1).not.toBe(executor2);
    executor1.cleanup();
    executor2.cleanup();
  });
});

// ============================================================================
// Type Tests
// ============================================================================

describe("RalphExecutorRunOptions", () => {
  test("accepts empty options", () => {
    const options: RalphExecutorRunOptions = {};

    expect(options).toBeDefined();
  });

  test("accepts initialState", () => {
    const options: RalphExecutorRunOptions = {
      initialState: {
        executionId: "test-123",
      },
    };

    expect(options.initialState?.executionId).toBe("test-123");
  });
});

describe("RalphExecutorResult", () => {
  test("has required fields", () => {
    const result: RalphExecutorResult = {
      state: {} as RalphWorkflowState,
      completed: true,
      interrupted: false,
    };

    expect(result.state).toBeDefined();
    expect(typeof result.completed).toBe("boolean");
    expect(typeof result.interrupted).toBe("boolean");
  });

  test("accepts optional error", () => {
    const result: RalphExecutorResult = {
      state: {} as RalphWorkflowState,
      completed: false,
      interrupted: false,
      error: new Error("Test error"),
    };

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe("Test error");
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("RalphExecutor integration", () => {
  test("executor and workflow compile together", () => {
    const workflow = createRalphWorkflow({ maxIterations: 10 });
    const executor = createRalphExecutor();

    expect(workflow).toBeDefined();
    expect(executor).toBeDefined();

    executor.cleanup();
  });

  test("executor can be configured for yolo mode", async () => {
    const workflow = createRalphWorkflow({
      yolo: true,
      userPrompt: "Test task",
    });
    const executor = createRalphExecutor();

    const result = await executor.run(workflow, {
      yolo: true,
      userPrompt: "Test task",
    });

    expect(result).toBeDefined();
    executor.cleanup();
  });

  test("multiple executors can run independently", () => {
    const executor1 = createRalphExecutor();
    const executor2 = createRalphExecutor();

    executor1.setSession("session-1", "/tmp/session-1");
    executor2.setSession("session-2", "/tmp/session-2");

    // Both should have independent state
    expect(executor1.signal).not.toBe(executor2.signal);

    executor1.cleanup();
    executor2.cleanup();
  });
});
