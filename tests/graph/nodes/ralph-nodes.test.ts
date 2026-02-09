/**
 * Tests for Ralph Node Factory Functions
 *
 * Tests the RalphWorkflowState interface and related factory functions
 * for the Ralph autonomous workflow graph nodes.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  // Types
  type RalphWorkflowState,
  type RalphSession,

  // Type guards
  isRalphWorkflowState,

  // State factories
  createRalphWorkflowState,
  sessionToWorkflowState,
  workflowStateToSession,

  // Node factories
  initRalphSessionNode,
  type InitRalphSessionNodeConfig,
  implementFeatureNode,
  type ImplementFeatureNodeConfig,
  processFeatureImplementationResult,
  type ImplementFeatureOutputConfig,
  checkCompletionNode,
  type CheckCompletionNodeConfig,
  createPRNode,
  type CreatePRNodeConfig,
  processCreatePRResult,
  extractPRUrl,
  extractBranchName,
  CREATE_PR_PROMPT,

  // Status display functions
  formatSessionStatus,
  type RalphSessionStatus,

  // Terminal hyperlink functions
  supportsTerminalHyperlinks,
  formatTerminalHyperlink,

  // Re-exported functions
  generateSessionId,
  getSessionDir,
  createRalphSession,
  isRalphSession,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,
} from "../../../src/graph/nodes/ralph-nodes.ts";
import type { TodoItem } from "../../../src/sdk/tools/todo-write.ts";
import type { ExecutionContext, GraphConfig, ExecutionError } from "../../../src/graph/types.ts";

// ============================================================================
// TEST FIXTURES
// ============================================================================

const TEST_SESSION_DIR = ".ralph-test/sessions";

/**
 * Create a valid RalphWorkflowState for testing.
 */
function createTestState(): RalphWorkflowState {
  return {
    // BaseState fields
    executionId: "exec-test-123",
    lastUpdated: "2026-02-02T10:00:00.000Z",
    outputs: {},

    // Ralph session identity
    ralphSessionId: "session-test-456",
    ralphSessionDir: ".ralph/sessions/session-test-456/",

    // Session configuration
    userPrompt: undefined,

    // Task tracking
    tasks: [
      {
        id: "feat-001",
        content: "Add login",
        status: "completed",
        activeForm: "Implementing Add login",
      },
      {
        id: "feat-002",
        content: "Add logout",
        status: "pending",
        activeForm: "Implementing Add logout",
      },
    ],
    currentFeatureIndex: 1,
    completedFeatures: ["feat-001"],
    currentTask: null,

    // Execution tracking
    iteration: 5,
    sessionStatus: "running",

    // Control flow flags
    shouldContinue: true,

    // PR artifacts
    prUrl: undefined,
    prBranch: "feature/my-feature",

    // Context tracking
    contextWindowUsage: undefined,

    // Debug reports
    debugReports: [],
  };
}

/**
 * Create a valid RalphSession for testing.
 */
function createTestSession(): RalphSession {
  return {
    sessionId: "session-test-789",
    sessionDir: ".ralph/sessions/session-test-789/",
    createdAt: "2026-02-02T08:00:00.000Z",
    lastUpdated: "2026-02-02T10:00:00.000Z",
    tasks: [
      {
        id: "feat-001",
        content: "Test feature",
        status: "completed",
        activeForm: "Implementing Test feature",
      },
    ],
    currentFeatureIndex: 0,
    completedFeatures: ["feat-001"],
    iteration: 10,
    status: "running",
    prUrl: "https://github.com/test/repo/pull/1",
    prBranch: "test-branch",
  };
}

// ============================================================================
// FORMAT SESSION STATUS TESTS
// ============================================================================

describe("formatSessionStatus", () => {
  test("formats 'running' status as 'Running'", () => {
    expect(formatSessionStatus("running")).toBe("Running");
  });

  test("formats 'paused' status as 'Paused'", () => {
    expect(formatSessionStatus("paused")).toBe("Paused");
  });

  test("formats 'completed' status as 'Completed'", () => {
    expect(formatSessionStatus("completed")).toBe("Completed");
  });

  test("formats 'failed' status as 'Failed'", () => {
    expect(formatSessionStatus("failed")).toBe("Failed");
  });
});

// ============================================================================
// RALPH WORKFLOW STATE TESTS
// ============================================================================

describe("RalphWorkflowState", () => {
  describe("createRalphWorkflowState", () => {
    test("creates default state with all required fields", () => {
      const state = createRalphWorkflowState();

      // Check BaseState fields
      expect(state.executionId).toBeDefined();
      expect(typeof state.executionId).toBe("string");
      expect(state.lastUpdated).toBeDefined();
      expect(state.outputs).toEqual({});

      // Check Ralph session identity
      expect(state.ralphSessionId).toBeDefined();
      expect(state.ralphSessionDir).toContain(state.ralphSessionId);

      // Check session configuration
      expect(state.userPrompt).toBeUndefined();

      // Check task tracking
      expect(state.tasks).toEqual([]);
      expect(state.currentFeatureIndex).toBe(0);
      expect(state.completedFeatures).toEqual([]);
      expect(state.currentTask).toBeNull();

      // Check execution tracking
      expect(state.iteration).toBe(1);
      expect(state.sessionStatus).toBe("running");

      // Check control flow flags
      expect(state.shouldContinue).toBe(true);

      // Check PR artifacts
      expect(state.prUrl).toBeUndefined();
      expect(state.prBranch).toBeUndefined();
    });

    test("accepts custom session ID", () => {
      const state = createRalphWorkflowState({
        sessionId: "custom-session-id",
      });

      expect(state.ralphSessionId).toBe("custom-session-id");
      expect(state.ralphSessionDir).toBe(".ralph/sessions/custom-session-id/");
    });

    test("accepts custom execution ID", () => {
      const state = createRalphWorkflowState({
        executionId: "custom-exec-id",
      });

      expect(state.executionId).toBe("custom-exec-id");
    });

    test("accepts user prompt", () => {
      const state = createRalphWorkflowState({
        userPrompt: "Build a snake game",
      });

      expect(state.userPrompt).toBe("Build a snake game");
    });

    test("accepts initial tasks", () => {
      const tasks: TodoItem[] = [
        {
          id: "task-1",
          content: "Task 1",
          status: "pending",
          activeForm: "Implementing Task 1",
        },
        {
          id: "task-2",
          content: "Task 2",
          status: "pending",
          activeForm: "Implementing Task 2",
        },
      ];

      const state = createRalphWorkflowState({ tasks });

      expect(state.tasks).toHaveLength(2);
      expect(state.tasks[0]!.id).toBe("task-1");
      expect(state.tasks[1]!.id).toBe("task-2");
    });

    test("generates unique session IDs", () => {
      const state1 = createRalphWorkflowState();
      const state2 = createRalphWorkflowState();

      expect(state1.ralphSessionId).not.toBe(state2.ralphSessionId);
    });

    test("generates unique execution IDs", () => {
      const state1 = createRalphWorkflowState();
      const state2 = createRalphWorkflowState();

      expect(state1.executionId).not.toBe(state2.executionId);
    });
  });

  describe("isRalphWorkflowState", () => {
    test("returns true for valid state", () => {
      const state = createTestState();
      expect(isRalphWorkflowState(state)).toBe(true);
    });

    test("returns true for state created by factory", () => {
      const state = createRalphWorkflowState();
      expect(isRalphWorkflowState(state)).toBe(true);
    });

    test("returns false for null", () => {
      expect(isRalphWorkflowState(null)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(isRalphWorkflowState(undefined)).toBe(false);
    });

    test("returns false for non-object", () => {
      expect(isRalphWorkflowState("string")).toBe(false);
      expect(isRalphWorkflowState(123)).toBe(false);
      expect(isRalphWorkflowState(true)).toBe(false);
    });

    test("returns false for empty object", () => {
      expect(isRalphWorkflowState({})).toBe(false);
    });

    test("returns false for missing executionId", () => {
      const state = createTestState();
      const { executionId, ...rest } = state;
      expect(isRalphWorkflowState(rest)).toBe(false);
    });

    test("returns false for missing ralphSessionId", () => {
      const state = createTestState();
      const { ralphSessionId, ...rest } = state;
      expect(isRalphWorkflowState(rest)).toBe(false);
    });

    test("returns false for missing shouldContinue", () => {
      const state = createTestState();
      const { shouldContinue, ...rest } = state;
      expect(isRalphWorkflowState(rest)).toBe(false);
    });

    test("returns false for invalid sessionStatus", () => {
      const state = createTestState();
      (state as any).sessionStatus = "invalid";
      expect(isRalphWorkflowState(state)).toBe(false);
    });

    test("returns false for non-array tasks", () => {
      const state = createTestState();
      (state as any).tasks = "not an array";
      expect(isRalphWorkflowState(state)).toBe(false);
    });
  });
});

// ============================================================================
// STATE CONVERSION TESTS
// ============================================================================

describe("State Conversion", () => {
  describe("sessionToWorkflowState", () => {
    test("converts RalphSession to RalphWorkflowState", () => {
      const session = createTestSession();
      const state = sessionToWorkflowState(session);

      expect(state.ralphSessionId).toBe(session.sessionId);
      expect(state.ralphSessionDir).toBe(session.sessionDir);
      expect(state.tasks).toEqual(session.tasks);
      expect(state.currentFeatureIndex).toBe(session.currentFeatureIndex);
      expect(state.completedFeatures).toEqual(session.completedFeatures);
      expect(state.iteration).toBe(session.iteration);
      expect(state.sessionStatus).toBe(session.status);
      expect(state.prUrl).toBe(session.prUrl);
      expect(state.prBranch).toBe(session.prBranch);
    });

    test("generates new execution ID", () => {
      const session = createTestSession();
      const state = sessionToWorkflowState(session);

      expect(state.executionId).toBeDefined();
      expect(typeof state.executionId).toBe("string");
    });

    test("accepts custom execution ID", () => {
      const session = createTestSession();
      const state = sessionToWorkflowState(session, "custom-exec-id");

      expect(state.executionId).toBe("custom-exec-id");
    });

    test("sets shouldContinue based on available tasks", () => {
      const sessionWithPending = createTestSession();
      sessionWithPending.tasks = [
        { id: "1", content: "T1", status: "pending", activeForm: "Doing T1" },
      ];
      expect(sessionToWorkflowState(sessionWithPending).shouldContinue).toBe(true);

      const sessionAllCompleted = createTestSession();
      sessionAllCompleted.tasks = [
        { id: "1", content: "T1", status: "completed", activeForm: "Doing T1" },
      ];
      expect(sessionToWorkflowState(sessionAllCompleted).shouldContinue).toBe(false);

      const sessionAllBlocked = createTestSession();
      sessionAllBlocked.tasks = [
        { id: "1", content: "T1", status: "pending", activeForm: "Doing T1", blockedBy: ["bug-1"] },
      ];
      expect(sessionToWorkflowState(sessionAllBlocked).shouldContinue).toBe(false);
    });

    test("sets currentTask from tasks array", () => {
      const session = createTestSession();
      session.currentFeatureIndex = 0;
      const state = sessionToWorkflowState(session);

      expect(state.currentTask).toEqual(session.tasks[0]!);
    });

    test("sets currentTask to null if index out of bounds", () => {
      const session = createTestSession();
      session.currentFeatureIndex = 999;
      const state = sessionToWorkflowState(session);

      expect(state.currentTask).toBeNull();
    });
  });

  describe("workflowStateToSession", () => {
    test("converts RalphWorkflowState to RalphSession", () => {
      const state = createTestState();
      const session = workflowStateToSession(state);

      expect(session.sessionId).toBe(state.ralphSessionId);
      expect(session.sessionDir).toBe(state.ralphSessionDir);
      expect(session.tasks).toEqual(state.tasks);
      expect(session.currentFeatureIndex).toBe(state.currentFeatureIndex);
      expect(session.completedFeatures).toEqual(state.completedFeatures);
      expect(session.iteration).toBe(state.iteration);
      expect(session.status).toBe(state.sessionStatus);
      expect(session.prUrl).toBe(state.prUrl);
      expect(session.prBranch).toBe(state.prBranch);
    });

    test("updates lastUpdated timestamp", () => {
      const state = createTestState();
      const before = new Date().toISOString();
      const session = workflowStateToSession(state);
      const after = new Date().toISOString();

      expect(session.lastUpdated >= before).toBe(true);
      expect(session.lastUpdated <= after).toBe(true);
    });

    test("result is valid RalphSession", () => {
      const state = createTestState();
      const session = workflowStateToSession(state);

      expect(isRalphSession(session)).toBe(true);
    });
  });

  describe("round-trip conversion", () => {
    test("session -> state -> session preserves data", () => {
      const originalSession = createTestSession();
      const state = sessionToWorkflowState(originalSession);
      const recoveredSession = workflowStateToSession(state);

      // Check key fields are preserved
      expect(recoveredSession.sessionId).toBe(originalSession.sessionId);
      expect(recoveredSession.sessionDir).toBe(originalSession.sessionDir);
      expect(recoveredSession.tasks).toEqual(originalSession.tasks);
      expect(recoveredSession.currentFeatureIndex).toBe(originalSession.currentFeatureIndex);
      expect(recoveredSession.completedFeatures).toEqual(originalSession.completedFeatures);
      expect(recoveredSession.iteration).toBe(originalSession.iteration);
      expect(recoveredSession.status).toBe(originalSession.status);
      expect(recoveredSession.prUrl).toBe(originalSession.prUrl);
      expect(recoveredSession.prBranch).toBe(originalSession.prBranch);
    });

    test("state -> session -> state preserves key data", () => {
      const originalState = createRalphWorkflowState({
        userPrompt: "Test prompt",
      });
      const session = workflowStateToSession(originalState);
      const recoveredState = sessionToWorkflowState(session);

      // Check key fields are preserved
      expect(recoveredState.ralphSessionId).toBe(originalState.ralphSessionId);
      expect(recoveredState.ralphSessionDir).toBe(originalState.ralphSessionDir);
      expect(recoveredState.iteration).toBe(originalState.iteration);
    });
  });
});

// ============================================================================
// RE-EXPORTED FUNCTION TESTS
// ============================================================================

describe("Re-exported functions", () => {
  test("generateSessionId is re-exported and works", () => {
    const id = generateSessionId();
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    // UUID v4 format
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test("getSessionDir is re-exported and works", () => {
    const dir = getSessionDir("test-id");
    expect(dir).toBe(".ralph/sessions/test-id/");
  });

  test("createRalphSession is re-exported and works", () => {
    const session = createRalphSession();
    expect(isRalphSession(session)).toBe(true);
  });

  test("isRalphSession is re-exported and works", () => {
    expect(isRalphSession(createTestSession())).toBe(true);
    expect(isRalphSession({})).toBe(false);
  });
});

// ============================================================================
// FILE SYSTEM OPERATION RE-EXPORTS
// ============================================================================

describe("File system re-exports", () => {
  const testSessionId = "test-ralph-nodes-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);

  beforeEach(async () => {
    // Clean up any existing test data
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
  });

  afterEach(async () => {
    // Clean up test data
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    // Clean up .ralph-test directory if it exists
    if (existsSync(".ralph-test")) {
      await rm(".ralph-test", { recursive: true });
    }
  });

  test("createSessionDirectory is re-exported and works", async () => {
    const dir = await createSessionDirectory(testSessionId);
    expect(dir).toBe(testSessionDir);
    expect(existsSync(testSessionDir)).toBe(true);
    expect(existsSync(`${testSessionDir}checkpoints`)).toBe(true);
    expect(existsSync(`${testSessionDir}research`)).toBe(true);
    expect(existsSync(`${testSessionDir}logs`)).toBe(true);
  });

  test("saveSession and loadSession are re-exported and work", async () => {
    await createSessionDirectory(testSessionId);
    const session = createRalphSession({ sessionId: testSessionId });

    await saveSession(testSessionDir, session);
    const loaded = await loadSession(testSessionDir);

    expect(loaded.sessionId).toBe(session.sessionId);
    expect(loaded.status).toBe(session.status);
  });

  test("loadSessionIfExists is re-exported and works", async () => {
    // Non-existent session
    const notFound = await loadSessionIfExists(".ralph/sessions/nonexistent/");
    expect(notFound).toBeNull();

    // Existing session
    await createSessionDirectory(testSessionId);
    const session = createRalphSession({ sessionId: testSessionId });
    await saveSession(testSessionDir, session);

    const found = await loadSessionIfExists(testSessionDir);
    expect(found).not.toBeNull();
    expect(found?.sessionId).toBe(testSessionId);
  });

  test("appendLog is re-exported and works", async () => {
    await createSessionDirectory(testSessionId);

    await appendLog(testSessionDir, "test-log", { action: "test", value: 42 });
    await appendLog(testSessionDir, "test-log", { action: "test2", value: 43 });

    const content = await readFile(`${testSessionDir}logs/test-log.jsonl`, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const entry1 = JSON.parse(lines[0]!);
    expect(entry1.action).toBe("test");
    expect(entry1.value).toBe(42);
    expect(entry1.timestamp).toBeDefined();

    const entry2 = JSON.parse(lines[1]!);
    expect(entry2.action).toBe("test2");
    expect(entry2.value).toBe(43);
  });

  test("appendProgress is re-exported and works", async () => {
    await createSessionDirectory(testSessionId);

    await appendProgress(testSessionDir, "✓ Test Feature: completed");
    await appendProgress(testSessionDir, "✗ Test Feature: failing");

    const content = await readFile(`${testSessionDir}progress.txt`, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("✓ Test Feature");
    expect(lines[1]).toContain("✗ Test Feature");
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("Integration", () => {
  const testSessionId = "integration-test-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);

  afterEach(async () => {
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
  });

  test("full workflow: create state -> save session -> resume", async () => {
    // 1. Create initial state
    const initialState = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [
        {
          id: "f1",
          content: "Feature 1",
          status: "pending",
          activeForm: "Implementing Feature 1",
        },
        {
          id: "f2",
          content: "Feature 2",
          status: "pending",
          activeForm: "Implementing Feature 2",
        },
      ],
    });

    // 2. Create session directory
    await createSessionDirectory(testSessionId);

    // 3. Simulate some work
    initialState.currentFeatureIndex = 1;
    initialState.iteration = 5;
    initialState.tasks[0]!.status = "completed";
    initialState.completedFeatures = ["f1"];

    // 4. Save session
    const session = workflowStateToSession(initialState);
    await saveSession(testSessionDir, session);

    // 5. Log some activity
    await appendLog(testSessionDir, "agent-calls", {
      agent: "codebase-analyzer",
      input: "Analyze feature 1",
    });

    // 6. Record progress
    await appendProgress(testSessionDir, "✓ Feature 1: completed");

    // 7. Load and resume
    const loadedSession = await loadSession(testSessionDir);
    const resumedState = sessionToWorkflowState(loadedSession);

    // Verify state was preserved
    expect(resumedState.ralphSessionId).toBe(testSessionId);
    expect(resumedState.currentFeatureIndex).toBe(1);
    expect(resumedState.iteration).toBe(5);
    expect(resumedState.completedFeatures).toEqual(["f1"]);
    expect(resumedState.tasks[0]!.status).toBe("completed");
    expect(resumedState.tasks[1]!.status).toBe("pending");

    // Verify control flags are set correctly
    expect(resumedState.shouldContinue).toBe(true); // f2 is pending and not blocked
  });

  test("task-based workflow", async () => {
    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      userPrompt: "Build a snake game in Rust",
    });

    expect(state.userPrompt).toBe("Build a snake game in Rust");
    expect(state.tasks).toEqual([]);

    // Save and restore
    await createSessionDirectory(testSessionId);
    const session = workflowStateToSession(state);
    await saveSession(testSessionDir, session);

    const loaded = await loadSession(testSessionDir);
    expect(loaded.tasks).toEqual([]);
  });
});

// ============================================================================
// INIT RALPH SESSION NODE TESTS
// ============================================================================

describe("initRalphSessionNode", () => {
  const testSessionId = "init-node-test-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);

  /**
   * Create a mock ExecutionContext for testing.
   */
  function createMockContext(state: Partial<RalphWorkflowState> = {}): ExecutionContext<RalphWorkflowState> {
    const defaultState = createRalphWorkflowState();
    return {
      state: { ...defaultState, ...state },
      config: {} as any,
      errors: [] as ExecutionError[],
    };
  }

  beforeEach(async () => {
    // Clean up any existing test data
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    // Clean up .ralph directory
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  afterEach(async () => {
    // Clean up test data
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    // Clean up .ralph directory
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  describe("node creation", () => {
    test("creates a NodeDefinition with correct properties", () => {
      const node = initRalphSessionNode({
        id: "test-init",
      });

      expect(node.id).toBe("test-init");
      expect(node.type).toBe("tool");
      expect(node.name).toBe("init-ralph-session");
      expect(node.description).toBe("Initialize or resume a Ralph session");
      expect(typeof node.execute).toBe("function");
    });

    test("accepts custom name and description", () => {
      const node = initRalphSessionNode({
        id: "custom-init",
        name: "Custom Init",
        description: "Custom description",
      });

      expect(node.name).toBe("Custom Init");
      expect(node.description).toBe("Custom description");
    });
  });

  describe("new session creation", () => {
    test("creates a new session with generated ID", async () => {
      const node = initRalphSessionNode({
        id: "init-new",
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate!.ralphSessionId).toBeDefined();
      expect(result.stateUpdate!.ralphSessionDir).toContain(result.stateUpdate!.ralphSessionId);
      expect(result.stateUpdate!.tasks).toEqual([]);
      expect(result.stateUpdate!.sessionStatus).toBe("running");
    });

    test("creates session directory structure", async () => {
      const node = initRalphSessionNode({
        id: "init-dirs",
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      const sessionDir = result.stateUpdate!.ralphSessionDir!;
      expect(existsSync(sessionDir)).toBe(true);
      expect(existsSync(`${sessionDir}checkpoints`)).toBe(true);
      expect(existsSync(`${sessionDir}research`)).toBe(true);
      expect(existsSync(`${sessionDir}logs`)).toBe(true);
    });

    test("creates progress.txt with session header", async () => {
      const node = initRalphSessionNode({
        id: "init-progress",
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      const progressPath = `${result.stateUpdate!.ralphSessionDir}progress.txt`;
      expect(existsSync(progressPath)).toBe(true);

      const content = await readFile(progressPath, "utf-8");
      expect(content).toContain("# Ralph Session Progress");
      expect(content).toContain(`Session ID: ${result.stateUpdate!.ralphSessionId}`);
    });

    test("saves session.json file", async () => {
      const node = initRalphSessionNode({
        id: "init-save",
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      const sessionPath = `${result.stateUpdate!.ralphSessionDir}session.json`;
      expect(existsSync(sessionPath)).toBe(true);

      const content = await readFile(sessionPath, "utf-8");
      const session = JSON.parse(content);
      expect(session.sessionId).toBe(result.stateUpdate!.ralphSessionId);
      expect(session.status).toBe("running");
    });

    test("logs init action to agent-calls.jsonl", async () => {
      const node = initRalphSessionNode({
        id: "init-log",
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      const logPath = `${result.stateUpdate!.ralphSessionDir}logs/agent-calls.jsonl`;
      expect(existsSync(logPath)).toBe(true);

      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("init");
    });
  });

  describe("session resumption", () => {
    test("resumes existing session from disk", async () => {
      // First, create a session manually
      await createSessionDirectory(testSessionId);
      const existingSession = createRalphSession({
        sessionId: testSessionId,
        tasks: [
          {
            id: "f1",
            content: "Existing Task",
            status: "completed",
            activeForm: "Implementing Existing Task",
          },
        ],
        currentFeatureIndex: 0,
        completedFeatures: ["f1"],
        iteration: 10,
        status: "running",
      });
      await saveSession(testSessionDir, existingSession);

      // Now try to resume it
      const node = initRalphSessionNode({
        id: "init-resume",
        resumeSessionId: testSessionId,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.ralphSessionId).toBe(testSessionId);
      expect(result.stateUpdate!.iteration).toBe(10);
      expect(result.stateUpdate!.completedFeatures).toEqual(["f1"]);
      expect(result.stateUpdate!.tasks![0]!.content).toBe("Existing Task");
    });

    test("logs resume action to agent-calls.jsonl", async () => {
      await createSessionDirectory(testSessionId);
      const existingSession = createRalphSession({
        sessionId: testSessionId,
        iteration: 5,
      });
      await saveSession(testSessionDir, existingSession);

      const node = initRalphSessionNode({
        id: "init-resume-log",
        resumeSessionId: testSessionId,
      });

      const ctx = createMockContext();
      await node.execute(ctx);

      const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("resume");
      expect(entry.sessionId).toBe(testSessionId);
      expect(entry.iteration).toBe(5);
    });

    test("creates new session if resume ID not found", async () => {
      const node = initRalphSessionNode({
        id: "init-resume-not-found",
        resumeSessionId: "nonexistent-session-id",
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      // Should create a new session with the provided ID
      expect(result.stateUpdate!.ralphSessionId).toBe("nonexistent-session-id");
      expect(result.stateUpdate!.iteration).toBe(1); // Fresh session starts at 1
    });
  });
});

// ============================================================================
// IMPLEMENT FEATURE NODE TESTS
// ============================================================================

describe("implementFeatureNode", () => {
  const testSessionId = "implement-node-test-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);

  /**
   * Create a mock ExecutionContext for testing with tasks.
   */
  function createImplementMockContext(
    tasks: TodoItem[],
    overrides: Partial<RalphWorkflowState> = {}
  ): ExecutionContext<RalphWorkflowState> {
    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks,
    });
    return {
      state: { ...state, ...overrides },
      config: {} as any,
      errors: [] as ExecutionError[],
    };
  }

  beforeEach(async () => {
    // Clean up any existing test data
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    // Clean up .ralph directory
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  afterEach(async () => {
    // Clean up test data
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    // Clean up .ralph directory
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  describe("node creation", () => {
    test("creates a NodeDefinition with correct properties", () => {
      const node = implementFeatureNode({
        id: "test-implement",
      });

      expect(node.id).toBe("test-implement");
      expect(node.type).toBe("tool");
      expect(node.name).toBe("implement-feature");
      expect(node.description).toBe("Find and prepare the next pending task for implementation");
      expect(typeof node.execute).toBe("function");
    });

    test("accepts custom name and description", () => {
      const node = implementFeatureNode({
        id: "custom-implement",
        name: "Custom Implement",
        description: "Custom description",
      });

      expect(node.name).toBe("Custom Implement");
      expect(node.description).toBe("Custom description");
    });
  });

  describe("finding pending tasks", () => {
    test("finds the first pending task", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
        { id: "f2", content: "Task 2", status: "pending", activeForm: "Doing Task 2" },
        { id: "f3", content: "Task 3", status: "pending", activeForm: "Doing Task 3" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(tasks);
      const result = await node.execute(ctx);

      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate!.currentFeatureIndex).toBe(1);
      expect(result.stateUpdate!.currentTask).toBeDefined();
      expect(result.stateUpdate!.currentTask!.id).toBe("f2");
      expect(result.stateUpdate!.currentTask!.status).toBe("in_progress");
    });

    test("marks task as in_progress", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "pending", activeForm: "Doing Task 1" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(tasks);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.tasks![0]!.status).toBe("in_progress");
    });

    test("sets shouldContinue to true when pending task found", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "pending", activeForm: "Doing Task 1" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(tasks);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(true);
    });

    test("displays current task content when implementing", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Add User Authentication", status: "pending", activeForm: "Implementing auth" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(tasks);
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Implementing: Add User Authentication"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays iteration count", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "pending", activeForm: "Doing Task 1" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(tasks, { iteration: 5 });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Iteration 5"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays session status as Running during active execution", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "pending", activeForm: "Doing Task 1" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(tasks, { sessionStatus: "running" });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Status: Running"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays completed tasks count", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
        { id: "f2", content: "Task 2", status: "completed", activeForm: "Doing Task 2" },
        { id: "f3", content: "Task 3", status: "pending", activeForm: "Doing Task 3" },
        { id: "f4", content: "Task 4", status: "pending", activeForm: "Doing Task 4" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(tasks);
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Tasks: 2/4 completed"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("skips blocked tasks", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "pending", activeForm: "Doing Task 1", blockedBy: ["bug-1"] },
        { id: "f2", content: "Task 2", status: "pending", activeForm: "Doing Task 2" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(tasks);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.currentTask!.id).toBe("f2");
      expect(result.stateUpdate!.currentFeatureIndex).toBe(1);
    });
  });

  describe("no pending tasks", () => {
    test("sets shouldContinue to false when all tasks completed", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
        { id: "f2", content: "Task 2", status: "completed", activeForm: "Doing Task 2" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(tasks);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(false);
      expect(result.stateUpdate!.currentTask).toBeNull();
    });

    test("sets shouldContinue to false when all remaining tasks blocked", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
        { id: "f2", content: "Task 2", status: "pending", activeForm: "Doing Task 2", blockedBy: ["bug-1"] },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(tasks);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(false);
    });
  });

  describe("prompt template", () => {
    test("builds prompt from template with placeholders", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        {
          id: "f1",
          content: "Add Login",
          status: "pending",
          activeForm: "Implementing login",
        },
      ];

      const node = implementFeatureNode({
        id: "impl",
        promptTemplate: "Task: {{content}}\nActive: {{activeForm}}",
      });

      const ctx = createImplementMockContext(tasks);
      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["impl_prompt"] as string;
      expect(prompt).toContain("Task: Add Login");
      expect(prompt).toContain("Active: Implementing login");
    });

    test("stores prompt in outputs with node id suffix", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task", status: "pending", activeForm: "Doing Task" },
      ];

      const node = implementFeatureNode({
        id: "my-impl-node",
        promptTemplate: "Implement: {{content}}",
      });

      const ctx = createImplementMockContext(tasks);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.outputs).toBeDefined();
      expect((result.stateUpdate!.outputs!["my-impl-node_prompt"] as string)).toContain("Implement: Task");
    });
  });

  describe("session persistence", () => {
    test("saves session with updated task status", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "pending", activeForm: "Doing Task 1" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(tasks);
      await node.execute(ctx);

      const sessionPath = `${testSessionDir}session.json`;
      const content = await readFile(sessionPath, "utf-8");
      const session = JSON.parse(content);
      expect(session.tasks[0].status).toBe("in_progress");
    });

    test("logs agent call start to agent-calls.jsonl", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "pending", activeForm: "Doing Task 1" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(tasks);
      await node.execute(ctx);

      const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("implement-task-start");
      expect(entry.taskId).toBe("f1");
      expect(entry.taskContent).toBe("Task 1");
    });
  });
});

// ============================================================================
// PROCESS FEATURE IMPLEMENTATION RESULT TESTS
// ============================================================================

describe("processFeatureImplementationResult", () => {
  const testSessionId = "process-result-test-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);

  beforeEach(async () => {
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  afterEach(async () => {
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  test("updates task to completed status when passed=true", async () => {
    await createSessionDirectory(testSessionId);

    const task: TodoItem = {
      id: "f1",
      content: "Test Task",
      status: "in_progress",
      activeForm: "Implementing Test Task",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [task],
    });
    state.currentTask = task;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, true);

    expect(result.tasks![0]!.status).toBe("completed");
  });

  test("creates bug-fix task when passed=false", async () => {
    await createSessionDirectory(testSessionId);

    const task: TodoItem = {
      id: "f1",
      content: "Test Task",
      status: "in_progress",
      activeForm: "Implementing Test Task",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [task],
    });
    state.currentTask = task;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, false, "tests failing");

    // Original task should be reset to pending and blocked
    expect(result.tasks![0]!.status).toBe("pending");
    expect(result.tasks![0]!.blockedBy).toBeDefined();
    expect(result.tasks![0]!.blockedBy!.length).toBeGreaterThan(0);

    // Bug-fix task should be inserted after
    expect(result.tasks!.length).toBe(2);
    expect(result.tasks![1]!.content).toContain("Fix:");
    expect(result.tasks![1]!.content).toContain("tests failing");
    expect(result.tasks![1]!.status).toBe("pending");
  });

  test("adds task to completedFeatures when passing", async () => {
    await createSessionDirectory(testSessionId);

    const task: TodoItem = {
      id: "f1",
      content: "Test Task",
      status: "in_progress",
      activeForm: "Implementing Test Task",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [task],
    });
    state.currentTask = task;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, true);

    expect(result.completedFeatures).toContain("f1");
  });

  test("does not add task to completedFeatures when failing", async () => {
    await createSessionDirectory(testSessionId);

    const task: TodoItem = {
      id: "f1",
      content: "Test Task",
      status: "in_progress",
      activeForm: "Implementing Test Task",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [task],
    });
    state.currentTask = task;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, false);

    expect(result.completedFeatures).not.toContain("f1");
  });

  test("increments iteration", async () => {
    await createSessionDirectory(testSessionId);

    const task: TodoItem = {
      id: "f1",
      content: "Test Task",
      status: "in_progress",
      activeForm: "Implementing Test Task",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [task],
    });
    state.currentTask = task;
    state.currentFeatureIndex = 0;
    state.iteration = 5;

    const result = await processFeatureImplementationResult(state, true);

    expect(result.iteration).toBe(6);
  });

  test("resolves blockedBy on downstream tasks when task completes", async () => {
    await createSessionDirectory(testSessionId);

    const tasks: TodoItem[] = [
      { id: "f1", content: "Task 1", status: "in_progress", activeForm: "Doing 1" },
      { id: "f2", content: "Task 2", status: "pending", activeForm: "Doing 2", blockedBy: ["f1"] },
    ];

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks,
    });
    state.currentTask = tasks[0]!;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, true);

    // f2 should no longer be blocked by f1
    expect(result.tasks![1]!.blockedBy).toEqual([]);
  });

  test("clears currentTask after processing", async () => {
    await createSessionDirectory(testSessionId);

    const task: TodoItem = {
      id: "f1",
      content: "Test Task",
      status: "in_progress",
      activeForm: "Implementing Test Task",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [task],
    });
    state.currentTask = task;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, true);

    expect(result.currentTask).toBeNull();
  });

  test("returns empty object if no current task", async () => {
    const state = createRalphWorkflowState({
      sessionId: testSessionId,
    });
    state.currentTask = null;

    const result = await processFeatureImplementationResult(state, true);

    expect(result).toEqual({});
  });

  test("saves session to disk", async () => {
    await createSessionDirectory(testSessionId);

    const task: TodoItem = {
      id: "f1",
      content: "Test Task",
      status: "in_progress",
      activeForm: "Implementing Test Task",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [task],
    });
    state.currentTask = task;
    state.currentFeatureIndex = 0;

    await processFeatureImplementationResult(state, true);

    const sessionPath = `${testSessionDir}session.json`;
    const content = await readFile(sessionPath, "utf-8");
    const session = JSON.parse(content);
    expect(session.tasks[0].status).toBe("completed");
  });

  test("appends to progress.txt", async () => {
    await createSessionDirectory(testSessionId);

    const task: TodoItem = {
      id: "f1",
      content: "Test Task",
      status: "in_progress",
      activeForm: "Implementing Test Task",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [task],
    });
    state.currentTask = task;
    state.currentFeatureIndex = 0;

    await processFeatureImplementationResult(state, true);

    const progressPath = `${testSessionDir}progress.txt`;
    const content = await readFile(progressPath, "utf-8");
    expect(content).toContain("✓");
    expect(content).toContain("Test Task");
  });

  test("logs result to agent-calls.jsonl", async () => {
    await createSessionDirectory(testSessionId);

    const task: TodoItem = {
      id: "f1",
      content: "Test Task",
      status: "in_progress",
      activeForm: "Implementing Test Task",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [task],
    });
    state.currentTask = task;
    state.currentFeatureIndex = 0;

    await processFeatureImplementationResult(state, true);

    const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
    const content = await readFile(logPath, "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.action).toBe("implement-task-result");
    expect(entry.taskId).toBe("f1");
    expect(entry.passed).toBe(true);
  });

  test("shouldContinue is false when no available tasks remain after completion", async () => {
    await createSessionDirectory(testSessionId);

    const task: TodoItem = {
      id: "f1",
      content: "Only Task",
      status: "in_progress",
      activeForm: "Doing Only Task",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [task],
    });
    state.currentTask = task;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, true);

    expect(result.shouldContinue).toBe(false);
  });
});

// ============================================================================
// CHECK COMPLETION NODE TESTS
// ============================================================================

describe("checkCompletionNode", () => {
  const testSessionId = "check-completion-test-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);

  /**
   * Create a mock ExecutionContext for testing.
   */
  function createCheckMockContext(
    overrides: Partial<RalphWorkflowState> = {}
  ): ExecutionContext<RalphWorkflowState> {
    const state = createRalphWorkflowState({
      sessionId: testSessionId,
    });
    return {
      state: { ...state, ...overrides },
      config: {} as any,
      errors: [] as ExecutionError[],
    };
  }

  beforeEach(async () => {
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  afterEach(async () => {
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  describe("node creation", () => {
    test("creates a NodeDefinition with correct properties", () => {
      const node = checkCompletionNode({
        id: "test-check",
      });

      expect(node.id).toBe("test-check");
      expect(node.type).toBe("tool");
      expect(node.name).toBe("check-completion");
      expect(node.description).toBe("Check if the Ralph workflow should continue or exit");
      expect(typeof node.execute).toBe("function");
    });

    test("accepts custom name and description", () => {
      const node = checkCompletionNode({
        id: "custom-check",
        name: "Custom Check",
        description: "Custom description",
      });

      expect(node.name).toBe("Custom Check");
      expect(node.description).toBe("Custom description");
    });
  });

  describe("deterministic termination", () => {
    test("sets shouldContinue to false when all tasks completed", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
        { id: "f2", content: "Task 2", status: "completed", activeForm: "Doing Task 2" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({ tasks });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(false);
      expect(result.stateUpdate!.sessionStatus).toBe("completed");
    });

    test("sets shouldContinue to true when available tasks exist", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
        { id: "f2", content: "Task 2", status: "pending", activeForm: "Doing Task 2" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({ tasks });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(true);
    });

    test("sets shouldContinue to false when all remaining tasks blocked", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
        { id: "f2", content: "Task 2", status: "pending", activeForm: "Doing Task 2", blockedBy: ["bug-1"] },
        { id: "f3", content: "Task 3", status: "pending", activeForm: "Doing Task 3", blockedBy: ["bug-2"] },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({ tasks });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(false);
      expect(result.stateUpdate!.sessionStatus).toBe("completed");
    });

    test("handles empty tasks array", async () => {
      await createSessionDirectory(testSessionId);

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({ tasks: [] });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(false);
    });

    test("logs check-completion action", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
        { id: "f2", content: "Task 2", status: "pending", activeForm: "Doing Task 2" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({ tasks, iteration: 7 });

      await node.execute(ctx);

      const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("check-completion");
      expect(entry.iteration).toBe(7);
      expect(entry.totalTasks).toBe(2);
      expect(entry.completedTasks).toBe(1);
      expect(entry.pendingTasks).toBe(1);
    });

    test("saves session when completing", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        tasks,
        sessionStatus: "running",
      });

      await node.execute(ctx);

      const sessionPath = `${testSessionDir}session.json`;
      const content = await readFile(sessionPath, "utf-8");
      const session = JSON.parse(content);
      expect(session.status).toBe("completed");
    });

    test("does not save session when continuing", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "pending", activeForm: "Doing Task 1" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        tasks,
        sessionStatus: "running",
      });

      await node.execute(ctx);

      // Session should not be saved when continuing
      const sessionPath = `${testSessionDir}session.json`;
      expect(existsSync(sessionPath)).toBe(false);
    });
  });

  describe("status display", () => {
    test("displays Completed status when all tasks completed", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = checkCompletionNode({ id: "check" });
        const ctx = createCheckMockContext({
          tasks,
          sessionStatus: "running",
        });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Status: Completed"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("does not display status when workflow is continuing", async () => {
      await createSessionDirectory(testSessionId);

      const tasks: TodoItem[] = [
        { id: "f1", content: "Task 1", status: "pending", activeForm: "Doing Task 1" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = checkCompletionNode({ id: "check" });
        const ctx = createCheckMockContext({
          tasks,
          sessionStatus: "running",
        });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Status:"))).toBe(false);
      } finally {
        console.log = originalLog;
      }
    });
  });
});

// ============================================================================
// CREATE PR NODE TESTS
// ============================================================================

describe("createPRNode", () => {
  const testSessionId = "create-pr-test-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);

  /**
   * Create a mock ExecutionContext for testing.
   */
  function createPRMockContext(
    overrides: Partial<RalphWorkflowState> = {}
  ): ExecutionContext<RalphWorkflowState> {
    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
        { id: "f2", content: "Task 2", status: "completed", activeForm: "Doing Task 2" },
        { id: "f3", content: "Task 3", status: "pending", activeForm: "Doing Task 3" },
      ],
    });
    return {
      state: { ...state, ...overrides },
      config: {} as any,
      errors: [] as ExecutionError[],
    };
  }

  beforeEach(async () => {
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  afterEach(async () => {
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  describe("CREATE_PR_PROMPT", () => {
    test("contains session ID placeholder", () => {
      expect(CREATE_PR_PROMPT).toContain("$SESSION_ID");
    });

    test("contains completed features placeholder", () => {
      expect(CREATE_PR_PROMPT).toContain("$COMPLETED_FEATURES");
    });

    test("contains base branch placeholder", () => {
      expect(CREATE_PR_PROMPT).toContain("$BASE_BRANCH");
    });

    test("contains gh CLI instructions", () => {
      expect(CREATE_PR_PROMPT).toContain("gh pr create");
    });

    test("contains PR_URL output format instruction", () => {
      expect(CREATE_PR_PROMPT).toContain("PR_URL:");
    });
  });

  describe("extractPRUrl", () => {
    test("extracts PR URL from PR_URL: marker", () => {
      const output = "Done! PR_URL: https://github.com/owner/repo/pull/123";
      expect(extractPRUrl(output)).toBe("https://github.com/owner/repo/pull/123");
    });

    test("extracts PR URL from GitHub PR pattern", () => {
      const output = "Created PR at https://github.com/owner/repo/pull/456";
      expect(extractPRUrl(output)).toBe("https://github.com/owner/repo/pull/456");
    });

    test("prefers PR_URL marker over raw URL", () => {
      const output = "https://github.com/other/repo/pull/1\nPR_URL: https://github.com/owner/repo/pull/999";
      expect(extractPRUrl(output)).toBe("https://github.com/owner/repo/pull/999");
    });

    test("returns undefined when no PR URL found", () => {
      const output = "No PR was created due to errors";
      expect(extractPRUrl(output)).toBeUndefined();
    });

    test("handles multiline output", () => {
      const output = `
Creating pull request...
Done!
PR_URL: https://github.com/test/project/pull/42
Thanks for using Ralph!
      `;
      expect(extractPRUrl(output)).toBe("https://github.com/test/project/pull/42");
    });
  });

  describe("extractBranchName", () => {
    test("extracts branch name from output", () => {
      const output = "Pushed to branch: feature/my-feature";
      expect(extractBranchName(output)).toBe("feature/my-feature");
    });

    test("extracts branch name with quotes", () => {
      const output = "Branch: 'main'";
      expect(extractBranchName(output)).toBe("main");
    });

    test("returns undefined when no branch found", () => {
      const output = "PR created successfully";
      expect(extractBranchName(output)).toBeUndefined();
    });
  });

  describe("node creation", () => {
    test("creates a NodeDefinition with correct properties", () => {
      const node = createPRNode({
        id: "test-pr",
      });

      expect(node.id).toBe("test-pr");
      expect(node.type).toBe("tool");
      expect(node.name).toBe("create-pr");
      expect(node.description).toBe("Create a pull request with session metadata");
      expect(typeof node.execute).toBe("function");
    });

    test("accepts custom name and description", () => {
      const node = createPRNode({
        id: "custom-pr",
        name: "Custom PR",
        description: "Custom description",
      });

      expect(node.name).toBe("Custom PR");
      expect(node.description).toBe("Custom description");
    });

    test("accepts custom base branch", () => {
      const node = createPRNode({
        id: "pr-develop",
        baseBranch: "develop",
      });

      expect(node).toBeDefined();
    });
  });

  describe("execute function", () => {
    test("builds prompt with session ID", async () => {
      await createSessionDirectory(testSessionId);

      const node = createPRNode({ id: "pr" });
      const ctx = createPRMockContext();
      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["pr_prompt"] as string;
      expect(prompt).toContain(testSessionId);
    });

    test("builds prompt with completed features", async () => {
      await createSessionDirectory(testSessionId);

      const node = createPRNode({ id: "pr" });
      const ctx = createPRMockContext();
      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["pr_prompt"] as string;
      expect(prompt).toContain("Task 1");
      expect(prompt).toContain("Task 2");
      // Task 3 is pending, should not be in completed features
    });

    test("builds prompt with base branch", async () => {
      await createSessionDirectory(testSessionId);

      const node = createPRNode({ id: "pr", baseBranch: "develop" });
      const ctx = createPRMockContext();
      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["pr_prompt"] as string;
      expect(prompt).toContain("develop");
      expect(result.stateUpdate!.outputs!["pr_baseBranch"]).toBe("develop");
    });

    test("builds prompt with feature counts", async () => {
      await createSessionDirectory(testSessionId);

      const node = createPRNode({ id: "pr" });
      const ctx = createPRMockContext();
      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["pr_prompt"] as string;
      // 2 passing out of 3 total
      expect(prompt).toContain("Total features: 3");
      expect(prompt).toContain("Passing features: 2");
    });

    test("stores title in outputs when titleTemplate provided", async () => {
      await createSessionDirectory(testSessionId);

      const node = createPRNode({
        id: "pr",
        titleTemplate: "feat: Ralph session $SESSION_ID ($FEATURE_COUNT features)",
      });
      const ctx = createPRMockContext();
      const result = await node.execute(ctx);

      const title = result.stateUpdate!.outputs!["pr_title"] as string;
      expect(title).toContain(testSessionId);
      expect(title).toContain("2 features");
    });

    test("logs create-pr-start action", async () => {
      await createSessionDirectory(testSessionId);

      const node = createPRNode({ id: "pr" });
      const ctx = createPRMockContext();
      await node.execute(ctx);

      const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("create-pr-start");
      expect(entry.completedFeatures).toBe(2);
      expect(entry.totalFeatures).toBe(3);
    });

    test("uses custom prompt template", async () => {
      await createSessionDirectory(testSessionId);

      const customPrompt = "Create a PR for session $SESSION_ID with $PASSING_FEATURES features";
      const node = createPRNode({
        id: "pr",
        promptTemplate: customPrompt,
      });
      const ctx = createPRMockContext();
      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["pr_prompt"] as string;
      expect(prompt).toContain(testSessionId);
      expect(prompt).toContain("2 features");
    });
  });
});

// ============================================================================
// PROCESS CREATE PR RESULT TESTS
// ============================================================================

describe("processCreatePRResult", () => {
  const testSessionId = "process-pr-test-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);

  beforeEach(async () => {
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  afterEach(async () => {
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  test("extracts PR URL from agent output", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
      ],
    });

    const result = await processCreatePRResult(
      state,
      "Created PR: PR_URL: https://github.com/owner/repo/pull/123"
    );

    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/123");
  });

  test("sets sessionStatus to completed", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [],
    });

    const result = await processCreatePRResult(state, "PR_URL: https://github.com/test/pull/1");

    expect(result.sessionStatus).toBe("completed");
  });

  test("sets shouldContinue to false", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [],
    });

    const result = await processCreatePRResult(state, "Done");

    expect(result.shouldContinue).toBe(false);
  });

  test("saves session to disk", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [
        { id: "f1", content: "Task", status: "completed", activeForm: "Doing Task" },
      ],
    });

    await processCreatePRResult(state, "PR_URL: https://github.com/test/pull/42");

    const sessionPath = `${testSessionDir}session.json`;
    const content = await readFile(sessionPath, "utf-8");
    const session = JSON.parse(content);
    expect(session.status).toBe("completed");
    expect(session.prUrl).toBe("https://github.com/test/pull/42");
  });

  test("appends to progress.txt", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [
        { id: "f1", content: "Task", status: "completed", activeForm: "Doing Task" },
      ],
    });

    await processCreatePRResult(state, "PR_URL: https://github.com/test/pull/1");

    const progressPath = `${testSessionDir}progress.txt`;
    const content = await readFile(progressPath, "utf-8");
    expect(content).toContain("Session Complete");
    expect(content).toContain("1/1");
  });

  test("logs create-pr-result action", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
        { id: "f2", content: "Task 2", status: "completed", activeForm: "Doing Task 2" },
      ],
    });

    await processCreatePRResult(state, "PR_URL: https://github.com/test/pull/100");

    const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
    const content = await readFile(logPath, "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.action).toBe("create-pr-result");
    expect(entry.prUrl).toBe("https://github.com/test/pull/100");
    expect(entry.success).toBe(true);
    expect(entry.completedFeatures).toBe(2);
  });

  test("handles output without PR URL", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [],
    });

    const result = await processCreatePRResult(state, "Error: Could not create PR");

    expect(result.prUrl).toBeUndefined();
    expect(result.sessionStatus).toBe("completed"); // Still completes the session
  });

  test("marks progress as failing when no PR URL", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [],
    });

    await processCreatePRResult(state, "Error creating PR");

    const progressPath = `${testSessionDir}progress.txt`;
    const content = await readFile(progressPath, "utf-8");
    expect(content).toContain("Status: failed");
  });

  test("extracts branch name when present", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [],
    });

    const result = await processCreatePRResult(
      state,
      "Pushed to branch: feature/my-work\nPR_URL: https://github.com/test/pull/1"
    );

    expect(result.prBranch).toBe("feature/my-work");
  });
});

// ============================================================================
// TERMINAL HYPERLINK TESTS
// ============================================================================

describe("supportsTerminalHyperlinks", () => {
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
    });
  });

  test("returns false when not running in TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      writable: true,
    });
    expect(supportsTerminalHyperlinks()).toBe(false);
  });

  test("returns true for iTerm.app terminal", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    process.env.TERM_PROGRAM = "iTerm.app";
    expect(supportsTerminalHyperlinks()).toBe(true);
  });

  test("returns true for Windows Terminal", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    process.env.WT_SESSION = "some-session-id";
    expect(supportsTerminalHyperlinks()).toBe(true);
  });

  test("returns true for VTE terminals with version >= 5000", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    process.env.VTE_VERSION = "6000";
    expect(supportsTerminalHyperlinks()).toBe(true);
  });

  test("returns false for VTE terminals with version < 5000", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    // Clear other env vars that could trigger true
    delete process.env.TERM_PROGRAM;
    delete process.env.WT_SESSION;
    delete process.env.COLORTERM;
    process.env.TERM = "dumb";
    process.env.VTE_VERSION = "4999";
    expect(supportsTerminalHyperlinks()).toBe(false);
  });

  test("returns true for truecolor terminals", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    process.env.COLORTERM = "truecolor";
    expect(supportsTerminalHyperlinks()).toBe(true);
  });

  test("returns true for 24bit color terminals", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    process.env.COLORTERM = "24bit";
    expect(supportsTerminalHyperlinks()).toBe(true);
  });

  test("returns true for xterm-256color", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    // Clear other env vars
    delete process.env.TERM_PROGRAM;
    delete process.env.WT_SESSION;
    delete process.env.VTE_VERSION;
    delete process.env.COLORTERM;
    process.env.TERM = "xterm-256color";
    expect(supportsTerminalHyperlinks()).toBe(true);
  });

  test("returns true for Hyper terminal", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    process.env.TERM_PROGRAM = "Hyper";
    expect(supportsTerminalHyperlinks()).toBe(true);
  });
});

describe("formatTerminalHyperlink", () => {
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
    });
  });

  test("returns plain URL when terminal does not support hyperlinks", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      writable: true,
    });
    const url = "https://github.com/owner/repo/pull/123";
    expect(formatTerminalHyperlink(url)).toBe(url);
  });

  test("returns OSC 8 formatted hyperlink when terminal supports it", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    process.env.TERM_PROGRAM = "iTerm.app";
    const url = "https://github.com/owner/repo/pull/123";
    const result = formatTerminalHyperlink(url);
    expect(result).toBe(`\x1b]8;;${url}\x07${url}\x1b]8;;\x07`);
  });

  test("uses custom display text when provided", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
    });
    process.env.TERM_PROGRAM = "iTerm.app";
    const url = "https://github.com/owner/repo/pull/123";
    const text = "PR #123";
    const result = formatTerminalHyperlink(url, text);
    expect(result).toBe(`\x1b]8;;${url}\x07${text}\x1b]8;;\x07`);
  });

  test("returns custom text without formatting when not supported", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      writable: true,
    });
    const url = "https://github.com/owner/repo/pull/123";
    const text = "PR #123";
    expect(formatTerminalHyperlink(url, text)).toBe(text);
  });
});

// ============================================================================
// PR URL DISPLAY TESTS
// ============================================================================

describe("processCreatePRResult console output", () => {
  const testSessionId = "pr-display-test-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);
  let logCalls: string[];
  let originalLog: typeof console.log;

  beforeEach(async () => {
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
    logCalls = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logCalls.push(String(args[0]));
    };
  });

  afterEach(async () => {
    console.log = originalLog;
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(".ralph")) {
      await rm(".ralph", { recursive: true });
    }
  });

  test("displays 'Pull request created: {url}' when PR URL is extracted", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [
        { id: "f1", content: "Task 1", status: "completed", activeForm: "Doing Task 1" },
      ],
    });

    const prUrl = "https://github.com/owner/repo/pull/123";
    await processCreatePRResult(state, `PR_URL: ${prUrl}`);

    expect(logCalls.length).toBeGreaterThan(0);
    // Find the call that contains the PR URL message
    const prMessageCall = logCalls.find((msg) =>
      msg.includes("Pull request created:")
    );
    expect(prMessageCall).toBeDefined();
    expect(prMessageCall).toContain(prUrl);
  });

  test("displays 'Session completed (no PR URL extracted)' when no URL found", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [],
    });

    await processCreatePRResult(state, "Error: Could not create PR");

    expect(logCalls.length).toBeGreaterThan(0);
    const sessionCompleteCall = logCalls.find((msg) =>
      msg.includes("Session completed (no PR URL extracted")
    );
    expect(sessionCompleteCall).toBeDefined();
  });

  test("displays 'Status: Completed' after PR creation", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      tasks: [],
    });

    await processCreatePRResult(state, "PR_URL: https://github.com/test/pull/1");

    expect(logCalls.length).toBeGreaterThan(0);
    const statusCall = logCalls.find((msg) =>
      msg.includes("Status: Completed")
    );
    expect(statusCall).toBeDefined();
  });
});

// ============================================================================
// DEBUG REPORTS ACCUMULATION TESTS
// ============================================================================

describe("Debug Reports Accumulation", () => {
  test("RalphWorkflowState includes debugReports field", () => {
    const state = createRalphWorkflowState();
    expect(Array.isArray(state.debugReports)).toBe(true);
    expect(state.debugReports).toEqual([]);
  });

  test("debugReports is initialized as empty array", () => {
    const state = createRalphWorkflowState({
      userPrompt: "test prompt",
    });
    expect(state.debugReports).toEqual([]);
    expect(state.debugReports.length).toBe(0);
  });

  test("debugReports can be set with debug reports", () => {
    const debugReport = {
      errorSummary: "Test error",
      relevantFiles: ["file1.ts", "file2.ts"],
      suggestedFixes: ["Fix 1", "Fix 2"],
      generatedAt: "2026-02-02T10:00:00.000Z",
    };

    // Create state by spreading in debugReports
    const state: RalphWorkflowState = {
      ...createRalphWorkflowState(),
      debugReports: [debugReport],
    };

    expect(state.debugReports).toHaveLength(1);
    expect(state.debugReports[0]?.errorSummary).toBe("Test error");
    expect(state.debugReports[0]?.relevantFiles).toEqual(["file1.ts", "file2.ts"]);
    expect(state.debugReports[0]?.suggestedFixes).toEqual(["Fix 1", "Fix 2"]);
  });

  test("isRalphWorkflowState validates debugReports field", () => {
    const validState = createRalphWorkflowState();
    expect(isRalphWorkflowState(validState)).toBe(true);

    // State without debugReports should be invalid
    const invalidState = { ...validState };
    delete (invalidState as Record<string, unknown>).debugReports;
    expect(isRalphWorkflowState(invalidState)).toBe(false);
  });

  test("isRalphWorkflowState accepts debugReports as array", () => {
    const state = createRalphWorkflowState();
    state.debugReports = [
      {
        errorSummary: "Error 1",
        relevantFiles: [],
        suggestedFixes: [],
        generatedAt: "2026-02-02T10:00:00.000Z",
      },
      {
        errorSummary: "Error 2",
        relevantFiles: ["file.ts"],
        suggestedFixes: ["Fix it"],
        generatedAt: "2026-02-02T11:00:00.000Z",
      },
    ];
    expect(isRalphWorkflowState(state)).toBe(true);
    expect(state.debugReports.length).toBe(2);
  });

  test("sessionToWorkflowState preserves debugReports from session", () => {
    const debugReport = {
      errorSummary: "Session error",
      relevantFiles: ["session.ts"],
      suggestedFixes: ["Fix session"],
      generatedAt: "2026-02-02T10:00:00.000Z",
    };

    const session = createRalphSession({
      debugReports: [debugReport],
    });

    const state = sessionToWorkflowState(session);
    expect(state.debugReports).toHaveLength(1);
    expect(state.debugReports[0]?.errorSummary).toBe("Session error");
  });

  test("sessionToWorkflowState handles missing debugReports gracefully", () => {
    const session = createRalphSession();
    // Simulate old session without debugReports by deleting it
    delete (session as unknown as Record<string, unknown>).debugReports;

    const state = sessionToWorkflowState(session);
    expect(Array.isArray(state.debugReports)).toBe(true);
    expect(state.debugReports).toEqual([]);
  });

  test("workflowStateToSession includes debugReports", () => {
    const debugReport = {
      errorSummary: "Workflow error",
      relevantFiles: ["workflow.ts"],
      suggestedFixes: ["Fix workflow"],
      generatedAt: "2026-02-02T10:00:00.000Z",
    };

    const state = createRalphWorkflowState();
    state.debugReports = [debugReport];

    const session = workflowStateToSession(state);
    expect(session.debugReports).toHaveLength(1);
    expect(session.debugReports?.[0]?.errorSummary).toBe("Workflow error");
  });

  test("debugReports accumulates across multiple additions (simulated concat)", () => {
    const state = createRalphWorkflowState();

    const report1 = {
      errorSummary: "Error 1",
      relevantFiles: ["file1.ts"],
      suggestedFixes: ["Fix 1"],
      generatedAt: "2026-02-02T10:00:00.000Z",
    };

    const report2 = {
      errorSummary: "Error 2",
      relevantFiles: ["file2.ts"],
      suggestedFixes: ["Fix 2"],
      generatedAt: "2026-02-02T11:00:00.000Z",
    };

    // Simulate what Reducers.concat would do
    state.debugReports = [...state.debugReports, report1];
    expect(state.debugReports).toHaveLength(1);

    state.debugReports = [...state.debugReports, report2];
    expect(state.debugReports).toHaveLength(2);

    expect(state.debugReports[0]?.errorSummary).toBe("Error 1");
    expect(state.debugReports[1]?.errorSummary).toBe("Error 2");
  });

  test("debugReports persists through session save and load cycle", async () => {
    const testSessionId = generateSessionId();
    await createSessionDirectory(testSessionId);

    try {
      const debugReport = {
        errorSummary: "Persistent error",
        relevantFiles: ["persist.ts"],
        suggestedFixes: ["Fix persistence"],
        generatedAt: "2026-02-02T10:00:00.000Z",
      };

      const originalSession = createRalphSession({
        sessionId: testSessionId,
        debugReports: [debugReport],
      });

      const sessionDir = getSessionDir(testSessionId);
      await saveSession(sessionDir, originalSession);

      const loadedSession = await loadSession(sessionDir);
      expect(loadedSession.debugReports).toHaveLength(1);
      expect(loadedSession.debugReports?.[0]?.errorSummary).toBe("Persistent error");
    } finally {
      // Cleanup
      const sessionDir = getSessionDir(testSessionId);
      if (existsSync(sessionDir)) {
        await rm(sessionDir, { recursive: true, force: true });
      }
    }
  });

  test("debugReports available for inspection after workflow state round-trip", () => {
    const report1 = {
      errorSummary: "First error",
      relevantFiles: ["first.ts"],
      suggestedFixes: ["First fix"],
      generatedAt: "2026-02-02T10:00:00.000Z",
      nodeId: "node-1",
      executionId: "exec-1",
    };

    const report2 = {
      errorSummary: "Second error",
      relevantFiles: ["second.ts"],
      suggestedFixes: ["Second fix"],
      generatedAt: "2026-02-02T11:00:00.000Z",
      stackTrace: "Error: Second error\n  at test.ts:10",
    };

    const state = createRalphWorkflowState();
    state.debugReports = [report1, report2];

    // Convert to session and back
    const session = workflowStateToSession(state);
    const restoredState = sessionToWorkflowState(session);

    // Verify all debug reports are available for inspection
    expect(restoredState.debugReports).toHaveLength(2);
    expect(restoredState.debugReports[0]?.errorSummary).toBe("First error");
    expect(restoredState.debugReports[0]?.nodeId).toBe("node-1");
    expect(restoredState.debugReports[1]?.stackTrace).toContain("Error: Second error");
  });
});
