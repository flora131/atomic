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
} from "../../src/workflows/ralph/executor.ts";
import { createRalphWorkflow } from "../../src/workflows/ralph/workflow.ts";
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
      const config = {};

      const result = await executor.run(workflow, config);

      expect(result).toBeDefined();
      expect(typeof result.completed).toBe("boolean");
      expect(typeof result.interrupted).toBe("boolean");
    });

    test("accepts initial state", async () => {
      const workflow = createRalphWorkflow();
      const config = {};
      const initialState: Partial<RalphWorkflowState> = {
        executionId: "test-exec-123",
        iteration: 0,
      };

      const result = await executor.run(workflow, config, { initialState });

      expect(result).toBeDefined();
    });

    test("resets abort controller for new run", async () => {
      const workflow = createRalphWorkflow();
      const config = {};

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
    const workflow = createRalphWorkflow();
    const executor = createRalphExecutor();

    expect(workflow).toBeDefined();
    expect(executor).toBeDefined();

    executor.cleanup();
  });

  test("executor can be configured with user prompt", async () => {
    const workflow = createRalphWorkflow({
      userPrompt: "Test task",
    });
    const executor = createRalphExecutor();

    const result = await executor.run(workflow, {
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

// ============================================================================
// handleInterrupt Display Tests
// ============================================================================

describe("handleInterrupt resume command display", () => {
  let executor: RalphExecutor;
  let consoleLogs: string[];
  let originalConsoleLog: typeof console.log;
  let originalProcessExit: typeof process.exit;

  beforeEach(() => {
    executor = new RalphExecutor();
    consoleLogs = [];

    // Capture console.log calls
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(" "));
    };

    // Mock process.exit to prevent test from exiting
    originalProcessExit = process.exit;
    process.exit = (() => {}) as typeof process.exit;
  });

  afterEach(() => {
    // Restore console.log and process.exit
    console.log = originalConsoleLog;
    process.exit = originalProcessExit;
    executor.cleanup();
  });

  test("displays 'Paused Ralph session: {uuid}' on interrupt when session is set", async () => {
    const sessionId = "test-session-uuid-12345";
    const sessionDir = "/tmp/ralph/sessions/test-session-uuid-12345";

    // Create a mock session file
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "session.json"),
      JSON.stringify({
        sessionId,
        sessionDir,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        tasks: [],
        currentTaskIndex: 0,
        completedTaskIds: [],
        iteration: 1,
        status: "running",
      })
    );

    // Set the session on the executor
    executor.setSession(sessionId, sessionDir);

    // Trigger interrupt by calling the private method through SIGINT simulation
    // We need to access the private handler - let's use a workaround by
    // triggering SIGINT, but we need to ensure handlers are set up first
    const workflow = createRalphWorkflow();
    await executor.run(workflow, {});

    // Now trigger SIGINT
    process.emit("SIGINT");

    // Wait a bit for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the expected console output
    const pausedSessionLog = consoleLogs.find((log) =>
      log.includes(`Paused Ralph session: ${sessionId}`)
    );
    expect(pausedSessionLog).toBeDefined();

    // Cleanup test files
    const { rm } = await import("node:fs/promises");
    await rm("/tmp/ralph", { recursive: true, force: true });
  });

  test("displays 'Resume with: /ralph --resume {uuid}' on interrupt when session is set", async () => {
    const sessionId = "resume-test-session-uuid";
    const sessionDir = "/tmp/ralph/sessions/resume-test-session-uuid";

    // Create a mock session file
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "session.json"),
      JSON.stringify({
        sessionId,
        sessionDir,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        tasks: [],
        currentTaskIndex: 0,
        completedTaskIds: [],
        iteration: 1,
        status: "running",
      })
    );

    // Set the session on the executor
    executor.setSession(sessionId, sessionDir);

    // Set up handlers and trigger interrupt
    const workflow = createRalphWorkflow();
    await executor.run(workflow, {});

    // Trigger SIGINT
    process.emit("SIGINT");

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the resume command output
    const resumeCommandLog = consoleLogs.find((log) =>
      log.includes(`Resume with: /ralph --resume ${sessionId}`)
    );
    expect(resumeCommandLog).toBeDefined();

    // Cleanup
    const { rm } = await import("node:fs/promises");
    await rm("/tmp/ralph", { recursive: true, force: true });
  });

  test("displays 'Stopping Ralph execution...' on interrupt", async () => {
    const sessionId = "stop-test-session";
    const sessionDir = "/tmp/ralph/sessions/stop-test-session";

    // Create a mock session file
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "session.json"),
      JSON.stringify({
        sessionId,
        sessionDir,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        tasks: [],
        currentTaskIndex: 0,
        completedTaskIds: [],
        iteration: 1,
        status: "running",
      })
    );

    executor.setSession(sessionId, sessionDir);

    const workflow = createRalphWorkflow();
    await executor.run(workflow, {});

    // Trigger SIGINT
    process.emit("SIGINT");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the stopping message (note: it starts with newline)
    const stoppingLog = consoleLogs.find(
      (log) =>
        log.includes("Stopping Ralph execution...") ||
        log.includes("\nStopping Ralph execution...")
    );
    expect(stoppingLog).toBeDefined();

    // Cleanup
    const { rm } = await import("node:fs/promises");
    await rm("/tmp/ralph", { recursive: true, force: true });
  });

  test("displays 'Status: Paused' on interrupt", async () => {
    const sessionId = "status-test-session";
    const sessionDir = "/tmp/ralph/sessions/status-test-session";

    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "session.json"),
      JSON.stringify({
        sessionId,
        sessionDir,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        tasks: [],
        currentTaskIndex: 0,
        completedTaskIds: [],
        iteration: 1,
        status: "running",
      })
    );

    executor.setSession(sessionId, sessionDir);

    const workflow = createRalphWorkflow();
    await executor.run(workflow, {});

    // Trigger SIGINT
    process.emit("SIGINT");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify the status message
    const statusLog = consoleLogs.find((log) => log.includes("Status: Paused"));
    expect(statusLog).toBeDefined();

    // Cleanup
    const { rm } = await import("node:fs/promises");
    await rm("/tmp/ralph", { recursive: true, force: true });
  });

  test("does not display resume command when session is not set", async () => {
    // Don't set session on executor
    const workflow = createRalphWorkflow();
    await executor.run(workflow, {});

    // Trigger SIGINT
    process.emit("SIGINT");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should still show stopping message
    const stoppingLog = consoleLogs.find((log) =>
      log.includes("Stopping Ralph execution...")
    );
    expect(stoppingLog).toBeDefined();

    // But should NOT show resume command since no session
    const resumeLog = consoleLogs.find((log) =>
      log.includes("Resume with: /ralph --resume")
    );
    expect(resumeLog).toBeUndefined();
  });

  test("resume command includes the correct session UUID format", async () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const sessionDir = `/tmp/ralph/sessions/${sessionId}`;

    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "session.json"),
      JSON.stringify({
        sessionId,
        sessionDir,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        tasks: [],
        currentTaskIndex: 0,
        completedTaskIds: [],
        iteration: 1,
        status: "running",
      })
    );

    executor.setSession(sessionId, sessionDir);

    const workflow = createRalphWorkflow();
    await executor.run(workflow, {});

    // Trigger SIGINT
    process.emit("SIGINT");

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify exact format of resume command
    const resumeLog = consoleLogs.find((log) =>
      log.includes("Resume with: /ralph --resume 550e8400-e29b-41d4-a716-446655440000")
    );
    expect(resumeLog).toBeDefined();

    // Cleanup
    const { rm } = await import("node:fs/promises");
    await rm("/tmp/ralph", { recursive: true, force: true });
  });
});
