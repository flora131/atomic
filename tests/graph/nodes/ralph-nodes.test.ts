/**
 * Tests for Ralph Node Factory Functions
 *
 * Tests the RalphWorkflowState interface and related factory functions
 * for the Ralph autonomous workflow graph nodes.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  // Types
  type RalphWorkflowState,
  type RalphSession,
  type RalphFeature,

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

  // Yolo mode functions
  processYoloResult,
  checkYoloCompletion,
  YOLO_COMPLETION_INSTRUCTION,

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
  createRalphFeature,
  isRalphSession,
  isRalphFeature,
  createSessionDirectory,
  saveSession,
  loadSession,
  loadSessionIfExists,
  appendLog,
  appendProgress,
} from "../../../src/graph/nodes/ralph-nodes.ts";
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
    yolo: false,
    maxIterations: 50,
    sourceFeatureListPath: "research/feature-list.json",
    userPrompt: undefined,

    // Feature tracking
    features: [
      {
        id: "feat-001",
        name: "Add login",
        description: "Implement user login",
        status: "passing",
        implementedAt: "2026-02-02T09:00:00.000Z",
      },
      {
        id: "feat-002",
        name: "Add logout",
        description: "Implement user logout",
        status: "pending",
      },
    ],
    currentFeatureIndex: 1,
    completedFeatures: ["feat-001"],
    currentFeature: null,

    // Execution tracking
    iteration: 5,
    sessionStatus: "running",

    // Control flow flags
    shouldContinue: true,
    allFeaturesPassing: false,
    maxIterationsReached: false,
    yoloComplete: false,

    // PR artifacts
    prUrl: undefined,
    prBranch: "feature/my-feature",

    // Context tracking
    contextWindowUsage: undefined,
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
    yolo: false,
    maxIterations: 100,
    sourceFeatureListPath: "research/feature-list.json",
    features: [
      {
        id: "feat-001",
        name: "Test feature",
        description: "A test feature",
        status: "passing",
        implementedAt: "2026-02-02T09:00:00.000Z",
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
      expect(state.yolo).toBe(false);
      expect(state.maxIterations).toBe(50);
      expect(state.sourceFeatureListPath).toBeUndefined();
      expect(state.userPrompt).toBeUndefined();

      // Check feature tracking
      expect(state.features).toEqual([]);
      expect(state.currentFeatureIndex).toBe(0);
      expect(state.completedFeatures).toEqual([]);
      expect(state.currentFeature).toBeNull();

      // Check execution tracking
      expect(state.iteration).toBe(1);
      expect(state.sessionStatus).toBe("running");

      // Check control flow flags
      expect(state.shouldContinue).toBe(true);
      expect(state.allFeaturesPassing).toBe(false);
      expect(state.maxIterationsReached).toBe(false);
      expect(state.yoloComplete).toBe(false);

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

    test("accepts yolo mode configuration", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "Build a snake game",
      });

      expect(state.yolo).toBe(true);
      expect(state.userPrompt).toBe("Build a snake game");
    });

    test("accepts max iterations configuration", () => {
      const state = createRalphWorkflowState({
        maxIterations: 100,
      });

      expect(state.maxIterations).toBe(100);
    });

    test("accepts unlimited iterations (0)", () => {
      const state = createRalphWorkflowState({
        maxIterations: 0,
      });

      expect(state.maxIterations).toBe(0);
    });

    test("accepts source feature list path", () => {
      const state = createRalphWorkflowState({
        sourceFeatureListPath: "custom/feature-list.json",
      });

      expect(state.sourceFeatureListPath).toBe("custom/feature-list.json");
    });

    test("accepts initial features", () => {
      const features: RalphFeature[] = [
        {
          id: "feat-1",
          name: "Feature 1",
          description: "First feature",
          status: "pending",
        },
        {
          id: "feat-2",
          name: "Feature 2",
          description: "Second feature",
          status: "pending",
        },
      ];

      const state = createRalphWorkflowState({ features });

      expect(state.features).toHaveLength(2);
      expect(state.features[0].id).toBe("feat-1");
      expect(state.features[1].id).toBe("feat-2");
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

    test("returns false for non-boolean yolo", () => {
      const state = createTestState();
      (state as any).yolo = "true";
      expect(isRalphWorkflowState(state)).toBe(false);
    });

    test("returns false for non-array features", () => {
      const state = createTestState();
      (state as any).features = "not an array";
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
      expect(state.yolo).toBe(session.yolo);
      expect(state.maxIterations).toBe(session.maxIterations);
      expect(state.features).toEqual(session.features);
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

    test("sets shouldContinue based on session status", () => {
      const runningSession = createTestSession();
      runningSession.status = "running";
      expect(sessionToWorkflowState(runningSession).shouldContinue).toBe(true);

      const pausedSession = createTestSession();
      pausedSession.status = "paused";
      expect(sessionToWorkflowState(pausedSession).shouldContinue).toBe(false);

      const completedSession = createTestSession();
      completedSession.status = "completed";
      expect(sessionToWorkflowState(completedSession).shouldContinue).toBe(false);
    });

    test("calculates allFeaturesPassing from features", () => {
      const sessionWithAllPassing = createTestSession();
      sessionWithAllPassing.features = [
        { id: "1", name: "F1", description: "D1", status: "passing" },
        { id: "2", name: "F2", description: "D2", status: "passing" },
      ];
      expect(sessionToWorkflowState(sessionWithAllPassing).allFeaturesPassing).toBe(true);

      const sessionWithPending = createTestSession();
      sessionWithPending.features = [
        { id: "1", name: "F1", description: "D1", status: "passing" },
        { id: "2", name: "F2", description: "D2", status: "pending" },
      ];
      expect(sessionToWorkflowState(sessionWithPending).allFeaturesPassing).toBe(false);
    });

    test("calculates maxIterationsReached from session", () => {
      const sessionAtLimit = createTestSession();
      sessionAtLimit.maxIterations = 10;
      sessionAtLimit.iteration = 10;
      expect(sessionToWorkflowState(sessionAtLimit).maxIterationsReached).toBe(true);

      const sessionBelowLimit = createTestSession();
      sessionBelowLimit.maxIterations = 10;
      sessionBelowLimit.iteration = 5;
      expect(sessionToWorkflowState(sessionBelowLimit).maxIterationsReached).toBe(false);

      const sessionUnlimited = createTestSession();
      sessionUnlimited.maxIterations = 0;
      sessionUnlimited.iteration = 1000;
      expect(sessionToWorkflowState(sessionUnlimited).maxIterationsReached).toBe(false);
    });

    test("sets currentFeature from features array", () => {
      const session = createTestSession();
      session.currentFeatureIndex = 0;
      const state = sessionToWorkflowState(session);

      expect(state.currentFeature).toEqual(session.features[0]);
    });

    test("sets currentFeature to null if index out of bounds", () => {
      const session = createTestSession();
      session.currentFeatureIndex = 999;
      const state = sessionToWorkflowState(session);

      expect(state.currentFeature).toBeNull();
    });
  });

  describe("workflowStateToSession", () => {
    test("converts RalphWorkflowState to RalphSession", () => {
      const state = createTestState();
      const session = workflowStateToSession(state);

      expect(session.sessionId).toBe(state.ralphSessionId);
      expect(session.sessionDir).toBe(state.ralphSessionDir);
      expect(session.yolo).toBe(state.yolo);
      expect(session.maxIterations).toBe(state.maxIterations);
      expect(session.features).toEqual(state.features);
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
      expect(recoveredSession.yolo).toBe(originalSession.yolo);
      expect(recoveredSession.maxIterations).toBe(originalSession.maxIterations);
      expect(recoveredSession.features).toEqual(originalSession.features);
      expect(recoveredSession.currentFeatureIndex).toBe(originalSession.currentFeatureIndex);
      expect(recoveredSession.completedFeatures).toEqual(originalSession.completedFeatures);
      expect(recoveredSession.iteration).toBe(originalSession.iteration);
      expect(recoveredSession.status).toBe(originalSession.status);
      expect(recoveredSession.prUrl).toBe(originalSession.prUrl);
      expect(recoveredSession.prBranch).toBe(originalSession.prBranch);
    });

    test("state -> session -> state preserves key data", () => {
      const originalState = createRalphWorkflowState({
        yolo: true,
        maxIterations: 100,
        userPrompt: "Test prompt",
      });
      const session = workflowStateToSession(originalState);
      const recoveredState = sessionToWorkflowState(session);

      // Check key fields are preserved
      expect(recoveredState.ralphSessionId).toBe(originalState.ralphSessionId);
      expect(recoveredState.ralphSessionDir).toBe(originalState.ralphSessionDir);
      expect(recoveredState.yolo).toBe(originalState.yolo);
      expect(recoveredState.maxIterations).toBe(originalState.maxIterations);
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
    const session = createRalphSession({ yolo: true });
    expect(session.yolo).toBe(true);
    expect(isRalphSession(session)).toBe(true);
  });

  test("createRalphFeature is re-exported and works", () => {
    const feature = createRalphFeature({
      id: "test-feat",
      name: "Test Feature",
      description: "A test feature",
    });
    expect(feature.id).toBe("test-feat");
    expect(isRalphFeature(feature)).toBe(true);
  });

  test("isRalphSession is re-exported and works", () => {
    expect(isRalphSession(createTestSession())).toBe(true);
    expect(isRalphSession({})).toBe(false);
  });

  test("isRalphFeature is re-exported and works", () => {
    const feature: RalphFeature = {
      id: "f1",
      name: "Feature",
      description: "Desc",
      status: "pending",
    };
    expect(isRalphFeature(feature)).toBe(true);
    expect(isRalphFeature({})).toBe(false);
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
    expect(loaded.yolo).toBe(session.yolo);
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

    const entry1 = JSON.parse(lines[0]);
    expect(entry1.action).toBe("test");
    expect(entry1.value).toBe(42);
    expect(entry1.timestamp).toBeDefined();

    const entry2 = JSON.parse(lines[1]);
    expect(entry2.action).toBe("test2");
    expect(entry2.value).toBe(43);
  });

  test("appendProgress is re-exported and works", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "passing",
    };

    await appendProgress(testSessionDir, feature, true);
    await appendProgress(testSessionDir, feature, false);

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
      yolo: false,
      maxIterations: 25,
      features: [
        {
          id: "f1",
          name: "Feature 1",
          description: "First feature",
          status: "pending",
        },
        {
          id: "f2",
          name: "Feature 2",
          description: "Second feature",
          status: "pending",
        },
      ],
    });

    // 2. Create session directory
    await createSessionDirectory(testSessionId);

    // 3. Simulate some work
    initialState.currentFeatureIndex = 1;
    initialState.iteration = 5;
    initialState.features[0].status = "passing";
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
    await appendProgress(testSessionDir, initialState.features[0], true);

    // 7. Load and resume
    const loadedSession = await loadSession(testSessionDir);
    const resumedState = sessionToWorkflowState(loadedSession);

    // Verify state was preserved
    expect(resumedState.ralphSessionId).toBe(testSessionId);
    expect(resumedState.currentFeatureIndex).toBe(1);
    expect(resumedState.iteration).toBe(5);
    expect(resumedState.completedFeatures).toEqual(["f1"]);
    expect(resumedState.features[0].status).toBe("passing");
    expect(resumedState.features[1].status).toBe("pending");

    // Verify control flags are set correctly
    expect(resumedState.shouldContinue).toBe(true); // status was running
    expect(resumedState.allFeaturesPassing).toBe(false); // f2 is pending
    expect(resumedState.maxIterationsReached).toBe(false); // 5 < 25
  });

  test("yolo mode workflow", async () => {
    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      yolo: true,
      maxIterations: 0, // unlimited
      userPrompt: "Build a snake game in Rust",
    });

    expect(state.yolo).toBe(true);
    expect(state.maxIterations).toBe(0);
    expect(state.userPrompt).toBe("Build a snake game in Rust");
    expect(state.features).toEqual([]);

    // Save and restore
    await createSessionDirectory(testSessionId);
    const session = workflowStateToSession(state);
    await saveSession(testSessionDir, session);

    const loaded = await loadSession(testSessionDir);
    expect(loaded.yolo).toBe(true);
    expect(loaded.maxIterations).toBe(0);
  });
});

// ============================================================================
// INIT RALPH SESSION NODE TESTS
// ============================================================================

describe("initRalphSessionNode", () => {
  const testSessionId = "init-node-test-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);
  const testFeatureListDir = ".test-feature-list-" + Date.now();
  const testFeatureListPath = `${testFeatureListDir}/feature-list.json`;

  /**
   * Create a mock ExecutionContext for testing.
   */
  function createMockContext(state: Partial<RalphWorkflowState> = {}): ExecutionContext<RalphWorkflowState> {
    const defaultState = createRalphWorkflowState();
    return {
      state: { ...defaultState, ...state },
      config: {} as GraphConfig<RalphWorkflowState>,
      errors: [] as ExecutionError[],
    };
  }

  /**
   * Create a test feature list file.
   */
  async function createTestFeatureList(features: Array<{
    category: string;
    description: string;
    steps: string[];
    passes: boolean;
  }>): Promise<void> {
    await mkdir(testFeatureListDir, { recursive: true });
    await writeFile(testFeatureListPath, JSON.stringify({ features }, null, 2), "utf-8");
  }

  beforeEach(async () => {
    // Clean up any existing test data
    if (existsSync(testSessionDir)) {
      await rm(testSessionDir, { recursive: true });
    }
    if (existsSync(testFeatureListDir)) {
      await rm(testFeatureListDir, { recursive: true });
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
    if (existsSync(testFeatureListDir)) {
      await rm(testFeatureListDir, { recursive: true });
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
      await createTestFeatureList([
        {
          category: "functional",
          description: "Test feature 1",
          steps: ["Step 1", "Step 2"],
          passes: false,
        },
      ]);

      const node = initRalphSessionNode({
        id: "init-new",
        featureListPath: testFeatureListPath,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate!.ralphSessionId).toBeDefined();
      expect(result.stateUpdate!.ralphSessionDir).toContain(result.stateUpdate!.ralphSessionId);
      expect(result.stateUpdate!.yolo).toBe(false);
      expect(result.stateUpdate!.features).toHaveLength(1);
      expect(result.stateUpdate!.sessionStatus).toBe("running");
    });

    test("creates session directory structure", async () => {
      await createTestFeatureList([
        {
          category: "functional",
          description: "Test feature",
          steps: [],
          passes: false,
        },
      ]);

      const node = initRalphSessionNode({
        id: "init-dirs",
        featureListPath: testFeatureListPath,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      const sessionDir = result.stateUpdate!.ralphSessionDir;
      expect(existsSync(sessionDir)).toBe(true);
      expect(existsSync(`${sessionDir}checkpoints`)).toBe(true);
      expect(existsSync(`${sessionDir}research`)).toBe(true);
      expect(existsSync(`${sessionDir}logs`)).toBe(true);
    });

    test("loads features from feature list file", async () => {
      await createTestFeatureList([
        {
          category: "functional",
          description: "Feature one",
          steps: ["Step A", "Step B"],
          passes: false,
        },
        {
          category: "refactor",
          description: "Feature two",
          steps: ["Step C"],
          passes: true,
        },
      ]);

      const node = initRalphSessionNode({
        id: "init-features",
        featureListPath: testFeatureListPath,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.features).toHaveLength(2);
      expect(result.stateUpdate!.features![0].name).toBe("Feature one");
      expect(result.stateUpdate!.features![0].status).toBe("pending");
      expect(result.stateUpdate!.features![0].acceptanceCriteria).toEqual(["Step A", "Step B"]);
      expect(result.stateUpdate!.features![1].name).toBe("Feature two");
      expect(result.stateUpdate!.features![1].status).toBe("passing");
    });

    test("creates progress.txt with session header", async () => {
      await createTestFeatureList([
        {
          category: "functional",
          description: "Test",
          steps: [],
          passes: false,
        },
      ]);

      const node = initRalphSessionNode({
        id: "init-progress",
        featureListPath: testFeatureListPath,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      const progressPath = `${result.stateUpdate!.ralphSessionDir}progress.txt`;
      expect(existsSync(progressPath)).toBe(true);

      const content = await readFile(progressPath, "utf-8");
      expect(content).toContain("# Ralph Session Progress");
      expect(content).toContain(`Session ID: ${result.stateUpdate!.ralphSessionId}`);
      expect(content).toContain("Feature List (1 features)");
    });

    test("saves session.json file", async () => {
      await createTestFeatureList([
        {
          category: "functional",
          description: "Test",
          steps: [],
          passes: false,
        },
      ]);

      const node = initRalphSessionNode({
        id: "init-save",
        featureListPath: testFeatureListPath,
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
      await createTestFeatureList([
        {
          category: "functional",
          description: "Test",
          steps: [],
          passes: false,
        },
      ]);

      const node = initRalphSessionNode({
        id: "init-log",
        featureListPath: testFeatureListPath,
        maxIterations: 75,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      const logPath = `${result.stateUpdate!.ralphSessionDir}logs/agent-calls.jsonl`;
      expect(existsSync(logPath)).toBe(true);

      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("init");
      expect(entry.yolo).toBe(false);
      expect(entry.maxIterations).toBe(75);
      expect(entry.featureCount).toBe(1);
    });

    test("copies features to session research directory", async () => {
      await createTestFeatureList([
        {
          category: "test",
          description: "Test feature",
          steps: ["Step 1"],
          passes: false,
        },
      ]);

      const node = initRalphSessionNode({
        id: "init-copy",
        featureListPath: testFeatureListPath,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      const sessionFeatureListPath = `${result.stateUpdate!.ralphSessionDir}research/feature-list.json`;
      expect(existsSync(sessionFeatureListPath)).toBe(true);

      const content = await readFile(sessionFeatureListPath, "utf-8");
      const featureList = JSON.parse(content);
      expect(featureList.features).toHaveLength(1);
      expect(featureList.features[0].description).toBe("Test feature");
    });

    test("uses custom maxIterations", async () => {
      await createTestFeatureList([]);

      const node = initRalphSessionNode({
        id: "init-iterations",
        featureListPath: testFeatureListPath,
        maxIterations: 200,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.maxIterations).toBe(200);
    });

    test("throws error for non-existent feature list", async () => {
      const node = initRalphSessionNode({
        id: "init-missing",
        featureListPath: "nonexistent/feature-list.json",
      });

      const ctx = createMockContext();

      await expect(node.execute(ctx)).rejects.toThrow("Feature list not found");
    });
  });

  describe("yolo mode", () => {
    test("creates session without loading features in yolo mode", async () => {
      const node = initRalphSessionNode({
        id: "init-yolo",
        yolo: true,
        userPrompt: "Build something cool",
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.yolo).toBe(true);
      expect(result.stateUpdate!.features).toEqual([]);
      expect(result.stateUpdate!.userPrompt).toBe("Build something cool");
    });

    test("creates progress.txt with yolo mode header", async () => {
      const node = initRalphSessionNode({
        id: "init-yolo-progress",
        yolo: true,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      const progressPath = `${result.stateUpdate!.ralphSessionDir}progress.txt`;
      const content = await readFile(progressPath, "utf-8");
      expect(content).toContain("YOLO (freestyle)");
    });

    test("logs yolo flag in agent-calls.jsonl", async () => {
      const node = initRalphSessionNode({
        id: "init-yolo-log",
        yolo: true,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      const logPath = `${result.stateUpdate!.ralphSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.yolo).toBe(true);
    });

    test("does not create feature-list.json in research directory for yolo mode", async () => {
      const node = initRalphSessionNode({
        id: "init-yolo-no-features",
        yolo: true,
      });

      const ctx = createMockContext();
      const result = await node.execute(ctx);

      // In yolo mode, saveSessionFeatureList is not called because features array is empty
      // But the research directory should still exist
      expect(existsSync(`${result.stateUpdate!.ralphSessionDir}research`)).toBe(true);
    });
  });

  describe("session resumption", () => {
    test("resumes existing session from disk", async () => {
      // First, create a session manually
      await createSessionDirectory(testSessionId);
      const existingSession = createRalphSession({
        sessionId: testSessionId,
        yolo: false,
        maxIterations: 30,
        features: [
          {
            id: "f1",
            name: "Existing Feature",
            description: "Pre-existing",
            status: "passing",
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
      expect(result.stateUpdate!.features![0].name).toBe("Existing Feature");
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
        yolo: true, // Use yolo to avoid feature list requirement
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
   * Create a mock ExecutionContext for testing with features.
   */
  function createImplementMockContext(
    features: RalphFeature[],
    overrides: Partial<RalphWorkflowState> = {}
  ): ExecutionContext<RalphWorkflowState> {
    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features,
    });
    return {
      state: { ...state, ...overrides },
      config: {} as GraphConfig<RalphWorkflowState>,
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
      expect(node.description).toBe("Find and prepare the next pending feature for implementation");
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

  describe("finding pending features", () => {
    test("finds the first pending feature", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "pending" },
        { id: "f3", name: "Feature 3", description: "Desc 3", status: "pending" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(features);
      const result = await node.execute(ctx);

      expect(result.stateUpdate).toBeDefined();
      expect(result.stateUpdate!.currentFeatureIndex).toBe(1);
      expect(result.stateUpdate!.currentFeature).toBeDefined();
      expect(result.stateUpdate!.currentFeature!.id).toBe("f2");
      expect(result.stateUpdate!.currentFeature!.status).toBe("in_progress");
    });

    test("marks feature as in_progress", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(features);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.features![0].status).toBe("in_progress");
    });

    test("sets shouldContinue to true when pending feature found", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(features);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(true);
      expect(result.stateUpdate!.allFeaturesPassing).toBe(false);
    });

    test("displays current feature name when implementing", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Add User Authentication", description: "Implement OAuth2 flow", status: "pending" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(features);
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Implementing: Add User Authentication"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays feature description when different from name", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Short Name", description: "This is a much longer description of the feature", status: "pending" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(features);
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Implementing: Short Name"))).toBe(true);
        expect(logs.some(log => log.includes("This is a much longer description of the feature"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("does not display description when same as name", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Same Name", description: "Same Name", status: "pending" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(features);
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Implementing: Same Name"))).toBe(true);
        // Should only have one log entry for the feature (just the name)
        const implementingLogs = logs.filter(log => log.includes("Implementing:") || log.includes("Same Name"));
        expect(implementingLogs.length).toBe(1);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays iteration count with finite max iterations", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(features, { iteration: 5, maxIterations: 100 });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Iteration 5/100"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays iteration count with infinite max iterations (0)", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(features, { iteration: 3, maxIterations: 0 });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Iteration 3/∞"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays iteration count at start of yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext([], {
          yolo: true,
          userPrompt: "Build a test app",
          iteration: 7,
          maxIterations: 50,
        });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Iteration 7/50"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays session status as Running during active execution", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(features, { sessionStatus: "running" });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Status: Running"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays session status in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext([], {
          yolo: true,
          userPrompt: "Build a test app",
          sessionStatus: "running",
        });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Status: Running"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays completed features count with some features completed", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "passing" },
        { id: "f3", name: "Feature 3", description: "Desc 3", status: "pending" },
        { id: "f4", name: "Feature 4", description: "Desc 4", status: "pending" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(features);
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Features: 2/4 completed"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays completed features count with zero features completed", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "pending" },
        { id: "f3", name: "Feature 3", description: "Desc 3", status: "pending" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(features);
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Features: 0/3 completed"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays completed features count with all features completed", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "passing" },
      ];

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext(features);
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Features: 2/2 completed"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("does not display completed features count in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = implementFeatureNode({ id: "impl" });
        const ctx = createImplementMockContext([], {
          yolo: true,
          userPrompt: "Build a test app",
        });
        await node.execute(ctx);

        // Should not display "Features:" line in yolo mode
        expect(logs.some(log => log.includes("Features:"))).toBe(false);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("no pending features", () => {
    test("sets allFeaturesPassing to true when all features are passing", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "passing" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(features);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.allFeaturesPassing).toBe(true);
      expect(result.stateUpdate!.shouldContinue).toBe(false);
      expect(result.stateUpdate!.currentFeature).toBeNull();
    });

    test("sets shouldContinue to true when some features are failing", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "failing" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(features);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.allFeaturesPassing).toBe(false);
      expect(result.stateUpdate!.shouldContinue).toBe(true); // Continue because there are failing features
    });

    test("logs completion check to agent-calls.jsonl", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(features);
      await node.execute(ctx);

      const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("implement-feature-check");
      expect(entry.result).toBe("no_pending_features");
      expect(entry.allFeaturesPassing).toBe(true);
    });
  });

  describe("prompt template", () => {
    test("builds prompt from template with placeholders", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        {
          id: "f1",
          name: "Add Login",
          description: "Implement user login",
          acceptanceCriteria: ["Users can enter email", "Users can enter password"],
          status: "pending",
        },
      ];

      const node = implementFeatureNode({
        id: "impl",
        promptTemplate: "Feature: {{name}}\nDescription: {{description}}\nCriteria:\n- {{acceptanceCriteria}}",
      });

      const ctx = createImplementMockContext(features);
      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["impl_prompt"] as string;
      expect(prompt).toContain("Feature: Add Login");
      expect(prompt).toContain("Description: Implement user login");
      expect(prompt).toContain("Users can enter email");
    });

    test("stores prompt in outputs with node id suffix", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature", description: "Desc", status: "pending" },
      ];

      const node = implementFeatureNode({
        id: "my-impl-node",
        promptTemplate: "Implement: {{description}}",
      });

      const ctx = createImplementMockContext(features);
      const result = await node.execute(ctx);

      expect(result.stateUpdate!.outputs).toBeDefined();
      expect(result.stateUpdate!.outputs!["my-impl-node_prompt"]).toBe("Implement: Desc");
    });
  });

  describe("session persistence", () => {
    test("saves session with updated feature status", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(features);
      await node.execute(ctx);

      const sessionPath = `${testSessionDir}session.json`;
      const content = await readFile(sessionPath, "utf-8");
      const session = JSON.parse(content);
      expect(session.features[0].status).toBe("in_progress");
    });

    test("updates session feature-list.json", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(features);
      await node.execute(ctx);

      const featureListPath = `${testSessionDir}research/feature-list.json`;
      const content = await readFile(featureListPath, "utf-8");
      const featureList = JSON.parse(content);
      expect(featureList.features[0].passes).toBe(false); // in_progress is not passing
    });

    test("logs agent call start to agent-calls.jsonl", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      const node = implementFeatureNode({ id: "impl" });
      const ctx = createImplementMockContext(features);
      await node.execute(ctx);

      const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("implement-feature-start");
      expect(entry.featureId).toBe("f1");
      expect(entry.featureName).toBe("Feature 1");
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

  test("updates feature to passing status when passed=true", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "in_progress",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [feature],
    });
    state.currentFeature = feature;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, true);

    expect(result.features![0].status).toBe("passing");
    expect(result.features![0].implementedAt).toBeDefined();
  });

  test("updates feature to failing status when passed=false", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "in_progress",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [feature],
    });
    state.currentFeature = feature;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, false);

    expect(result.features![0].status).toBe("failing");
    expect(result.features![0].implementedAt).toBeUndefined();
  });

  test("adds feature to completedFeatures when passing", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "in_progress",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [feature],
    });
    state.currentFeature = feature;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, true);

    expect(result.completedFeatures).toContain("f1");
  });

  test("does not add feature to completedFeatures when failing", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "in_progress",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [feature],
    });
    state.currentFeature = feature;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, false);

    expect(result.completedFeatures).not.toContain("f1");
  });

  test("increments iteration", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "in_progress",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [feature],
    });
    state.currentFeature = feature;
    state.currentFeatureIndex = 0;
    state.iteration = 5;

    const result = await processFeatureImplementationResult(state, true);

    expect(result.iteration).toBe(6);
  });

  test("detects max iterations reached", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "in_progress",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [feature],
      maxIterations: 10,
    });
    state.currentFeature = feature;
    state.currentFeatureIndex = 0;
    state.iteration = 9; // After increment will be 10 (>= maxIterations)

    const result = await processFeatureImplementationResult(state, true);

    expect(result.maxIterationsReached).toBe(true);
    expect(result.shouldContinue).toBe(false);
  });

  test("clears currentFeature after processing", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "in_progress",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [feature],
    });
    state.currentFeature = feature;
    state.currentFeatureIndex = 0;

    const result = await processFeatureImplementationResult(state, true);

    expect(result.currentFeature).toBeNull();
  });

  test("returns empty object if no current feature", async () => {
    const state = createRalphWorkflowState({
      sessionId: testSessionId,
    });
    state.currentFeature = null;

    const result = await processFeatureImplementationResult(state, true);

    expect(result).toEqual({});
  });

  test("saves session to disk", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "in_progress",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [feature],
    });
    state.currentFeature = feature;
    state.currentFeatureIndex = 0;

    await processFeatureImplementationResult(state, true);

    const sessionPath = `${testSessionDir}session.json`;
    const content = await readFile(sessionPath, "utf-8");
    const session = JSON.parse(content);
    expect(session.features[0].status).toBe("passing");
  });

  test("appends to progress.txt", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "in_progress",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [feature],
    });
    state.currentFeature = feature;
    state.currentFeatureIndex = 0;

    await processFeatureImplementationResult(state, true);

    const progressPath = `${testSessionDir}progress.txt`;
    const content = await readFile(progressPath, "utf-8");
    expect(content).toContain("✓ Test Feature");
  });

  test("logs result to agent-calls.jsonl", async () => {
    await createSessionDirectory(testSessionId);

    const feature: RalphFeature = {
      id: "f1",
      name: "Test Feature",
      description: "Test",
      status: "in_progress",
    };

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [feature],
    });
    state.currentFeature = feature;
    state.currentFeatureIndex = 0;

    await processFeatureImplementationResult(state, true);

    const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
    const content = await readFile(logPath, "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.action).toBe("implement-feature-result");
    expect(entry.featureId).toBe("f1");
    expect(entry.passed).toBe(true);
  });
});

// ============================================================================
// YOLO MODE TESTS
// ============================================================================

describe("Yolo Mode", () => {
  const testSessionId = "yolo-test-" + Date.now();
  const testSessionDir = getSessionDir(testSessionId);

  /**
   * Create a mock ExecutionContext for yolo mode testing.
   */
  function createYoloMockContext(
    overrides: Partial<RalphWorkflowState> = {}
  ): ExecutionContext<RalphWorkflowState> {
    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      yolo: true,
      userPrompt: "Build a snake game in Rust",
    });
    return {
      state: { ...state, ...overrides },
      config: {} as GraphConfig<RalphWorkflowState>,
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

  describe("YOLO_COMPLETION_INSTRUCTION", () => {
    test("contains EXTREMELY_IMPORTANT tag", async () => {
      const { YOLO_COMPLETION_INSTRUCTION } = await import(
        "../../../src/graph/nodes/ralph-nodes.ts"
      );
      expect(YOLO_COMPLETION_INSTRUCTION).toContain("EXTREMELY_IMPORTANT");
    });

    test("contains COMPLETE instruction", async () => {
      const { YOLO_COMPLETION_INSTRUCTION } = await import(
        "../../../src/graph/nodes/ralph-nodes.ts"
      );
      expect(YOLO_COMPLETION_INSTRUCTION).toContain("COMPLETE");
    });

    test("instructs to only output COMPLETE when truly finished", async () => {
      const { YOLO_COMPLETION_INSTRUCTION } = await import(
        "../../../src/graph/nodes/ralph-nodes.ts"
      );
      expect(YOLO_COMPLETION_INSTRUCTION).toContain(
        "Only output COMPLETE when you are truly finished"
      );
    });
  });

  describe("checkYoloCompletion", () => {
    test("returns true when output contains COMPLETE", async () => {
      const { checkYoloCompletion } = await import(
        "../../../src/graph/nodes/ralph-nodes.ts"
      );
      expect(checkYoloCompletion("Task is done. COMPLETE")).toBe(true);
    });

    test("returns true when COMPLETE is on its own line", async () => {
      const { checkYoloCompletion } = await import(
        "../../../src/graph/nodes/ralph-nodes.ts"
      );
      expect(checkYoloCompletion("Task is done.\nCOMPLETE\nDone.")).toBe(true);
    });

    test("returns false when output does not contain COMPLETE", async () => {
      const { checkYoloCompletion } = await import(
        "../../../src/graph/nodes/ralph-nodes.ts"
      );
      expect(checkYoloCompletion("Still working on it...")).toBe(false);
    });

    test("returns false for partial match (COMPLETED)", async () => {
      const { checkYoloCompletion } = await import(
        "../../../src/graph/nodes/ralph-nodes.ts"
      );
      // \bCOMPLETE\b does NOT match COMPLETED because the "D" breaks the word boundary
      // The regex requires COMPLETE to be a standalone word
      expect(checkYoloCompletion("COMPLETED")).toBe(false);
    });

    test("returns false for lowercase complete", async () => {
      const { checkYoloCompletion } = await import(
        "../../../src/graph/nodes/ralph-nodes.ts"
      );
      expect(checkYoloCompletion("complete")).toBe(false);
    });

    test("returns true when COMPLETE appears in the middle of text", async () => {
      const { checkYoloCompletion } = await import(
        "../../../src/graph/nodes/ralph-nodes.ts"
      );
      expect(checkYoloCompletion("I have finished the task. COMPLETE. Thank you.")).toBe(true);
    });
  });

  describe("implementFeatureNode yolo mode", () => {
    test("throws error when yolo mode has no prompt", async () => {
      await createSessionDirectory(testSessionId);

      const node = implementFeatureNode({ id: "impl-yolo" });
      const ctx = createYoloMockContext({
        userPrompt: undefined,
      });

      await expect(node.execute(ctx)).rejects.toThrow("Yolo mode requires a prompt");
    });

    test("uses userPrompt from state in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = implementFeatureNode({ id: "impl-yolo" });
      const ctx = createYoloMockContext({
        userPrompt: "Build a todo app",
      });

      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["impl-yolo_prompt"] as string;
      expect(prompt).toContain("Build a todo app");
    });

    test("uses prompt from config in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = implementFeatureNode({
        id: "impl-yolo",
        prompt: "Build a calculator",
      });
      const ctx = createYoloMockContext({
        userPrompt: undefined, // No state prompt
      });

      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["impl-yolo_prompt"] as string;
      expect(prompt).toContain("Build a calculator");
    });

    test("config prompt takes precedence over state prompt", async () => {
      await createSessionDirectory(testSessionId);

      const node = implementFeatureNode({
        id: "impl-yolo",
        prompt: "Config prompt",
      });
      const ctx = createYoloMockContext({
        userPrompt: "State prompt",
      });

      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["impl-yolo_prompt"] as string;
      expect(prompt).toContain("Config prompt");
      expect(prompt).not.toContain("State prompt");
    });

    test("appends COMPLETION_INSTRUCTION to prompt in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = implementFeatureNode({ id: "impl-yolo" });
      const ctx = createYoloMockContext({
        userPrompt: "Build something",
      });

      const result = await node.execute(ctx);

      const prompt = result.stateUpdate!.outputs!["impl-yolo_prompt"] as string;
      expect(prompt).toContain("EXTREMELY_IMPORTANT");
      expect(prompt).toContain("output the following on its own line");
      expect(prompt).toContain("COMPLETE");
    });

    test("sets yolo flag in outputs", async () => {
      await createSessionDirectory(testSessionId);

      const node = implementFeatureNode({ id: "impl-yolo" });
      const ctx = createYoloMockContext();

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.outputs!["impl-yolo_yolo"]).toBe(true);
    });

    test("sets shouldContinue to true in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = implementFeatureNode({ id: "impl-yolo" });
      const ctx = createYoloMockContext();

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(true);
    });

    test("sets yoloComplete to false initially", async () => {
      await createSessionDirectory(testSessionId);

      const node = implementFeatureNode({ id: "impl-yolo" });
      const ctx = createYoloMockContext();

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.yoloComplete).toBe(false);
    });

    test("logs yolo action to agent-calls.jsonl", async () => {
      await createSessionDirectory(testSessionId);

      const node = implementFeatureNode({ id: "impl-yolo" });
      const ctx = createYoloMockContext();

      await node.execute(ctx);

      const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("yolo");
      expect(entry.yolo).toBe(true);
      expect(entry.iteration).toBeDefined();
    });
  });

  describe("processYoloResult", () => {
    const { processYoloResult } = require("../../../src/graph/nodes/ralph-nodes.ts");

    test("sets yoloComplete to true when output contains COMPLETE", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
      });

      const result = await processYoloResult(state, "Task done. COMPLETE");

      expect(result.yoloComplete).toBe(true);
    });

    test("sets yoloComplete to false when output does not contain COMPLETE", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
      });

      const result = await processYoloResult(state, "Still working...");

      expect(result.yoloComplete).toBe(false);
    });

    test("sets shouldContinue to false when COMPLETE detected", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
      });

      const result = await processYoloResult(state, "COMPLETE");

      expect(result.shouldContinue).toBe(false);
    });

    test("sets shouldContinue to true when not complete", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
      });

      const result = await processYoloResult(state, "Working on it...");

      expect(result.shouldContinue).toBe(true);
    });

    test("increments iteration", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
      });
      state.iteration = 5;

      const result = await processYoloResult(state, "Still going...");

      expect(result.iteration).toBe(6);
    });

    test("detects max iterations reached", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
        maxIterations: 10,
      });
      state.iteration = 9; // Will become 10 after increment

      const result = await processYoloResult(state, "Working...");

      expect(result.maxIterationsReached).toBe(true);
      expect(result.shouldContinue).toBe(false);
    });

    test("unlimited iterations when maxIterations is 0", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
        maxIterations: 0,
      });
      state.iteration = 1000;

      const result = await processYoloResult(state, "Still going...");

      expect(result.maxIterationsReached).toBe(false);
      expect(result.shouldContinue).toBe(true);
    });

    test("sets sessionStatus to completed when COMPLETE detected", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
      });

      const result = await processYoloResult(state, "COMPLETE");

      expect(result.sessionStatus).toBe("completed");
    });

    test("saves session to disk", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
      });
      state.iteration = 3;

      await processYoloResult(state, "Working...");

      const sessionPath = `${testSessionDir}session.json`;
      const content = await readFile(sessionPath, "utf-8");
      const session = JSON.parse(content);
      expect(session.iteration).toBe(4); // Incremented from 3
    });

    test("appends to progress.txt", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
      });
      state.iteration = 1;

      await processYoloResult(state, "COMPLETE");

      const progressPath = `${testSessionDir}progress.txt`;
      const content = await readFile(progressPath, "utf-8");
      expect(content).toContain("✓");
      expect(content).toContain("Yolo Iteration 1");
    });

    test("appends failure mark when not complete", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
      });
      state.iteration = 1;

      await processYoloResult(state, "Still working...");

      const progressPath = `${testSessionDir}progress.txt`;
      const content = await readFile(progressPath, "utf-8");
      expect(content).toContain("✗");
      expect(content).toContain("Yolo Iteration 1");
    });

    test("logs yolo-result to agent-calls.jsonl", async () => {
      await createSessionDirectory(testSessionId);

      const state = createRalphWorkflowState({
        sessionId: testSessionId,
        yolo: true,
      });
      state.iteration = 2;

      await processYoloResult(state, "COMPLETE");

      const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("yolo-result");
      expect(entry.yolo).toBe(true);
      expect(entry.isComplete).toBe(true);
      expect(entry.iteration).toBe(2);
      expect(entry.shouldContinue).toBe(false);
    });
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
      config: {} as GraphConfig<RalphWorkflowState>,
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

  describe("yolo mode completion check", () => {
    test("sets shouldContinue to false when yoloComplete is true", async () => {
      await createSessionDirectory(testSessionId);

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: true,
        yoloComplete: true,
        sessionStatus: "running",
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(false);
      expect(result.stateUpdate!.yoloComplete).toBe(true);
    });

    test("sets shouldContinue to false when sessionStatus is completed", async () => {
      await createSessionDirectory(testSessionId);

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: true,
        yoloComplete: false,
        sessionStatus: "completed",
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(false);
    });

    test("sets shouldContinue to true when not complete in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: true,
        yoloComplete: false,
        sessionStatus: "running",
        maxIterations: 100,
        iteration: 5,
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(true);
    });

    test("sets shouldContinue to false when max iterations reached in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: true,
        yoloComplete: false,
        sessionStatus: "running",
        maxIterations: 10,
        iteration: 10,
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.shouldContinue).toBe(false);
      expect(result.stateUpdate!.maxIterationsReached).toBe(true);
    });

    test("updates sessionStatus to completed when done in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: true,
        yoloComplete: true,
        sessionStatus: "running",
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.sessionStatus).toBe("completed");
    });

    test("logs check-completion action in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: true,
        yoloComplete: false,
        iteration: 3,
      });

      await node.execute(ctx);

      const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("check-completion");
      expect(entry.mode).toBe("yolo");
      expect(entry.iteration).toBe(3);
      expect(entry.yoloComplete).toBe(false);
    });

    test("saves session when completing in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: true,
        yoloComplete: true,
        sessionStatus: "running",
        iteration: 5,
      });

      await node.execute(ctx);

      const sessionPath = `${testSessionDir}session.json`;
      const content = await readFile(sessionPath, "utf-8");
      const session = JSON.parse(content);
      expect(session.status).toBe("completed");
    });
  });

  describe("feature-list mode completion check", () => {
    test("sets allFeaturesPassing to true when all features are passing", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "passing" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.allFeaturesPassing).toBe(true);
      expect(result.stateUpdate!.shouldContinue).toBe(false);
    });

    test("sets shouldContinue to true when some features are pending", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "pending" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
        maxIterations: 100,
        iteration: 5,
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.allFeaturesPassing).toBe(false);
      expect(result.stateUpdate!.shouldContinue).toBe(true);
    });

    test("sets shouldContinue to true when some features are failing", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "failing" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
        maxIterations: 100,
        iteration: 5,
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.allFeaturesPassing).toBe(false);
      expect(result.stateUpdate!.shouldContinue).toBe(true);
    });

    test("sets shouldContinue to false when max iterations reached", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "pending" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
        maxIterations: 10,
        iteration: 10,
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.maxIterationsReached).toBe(true);
      expect(result.stateUpdate!.shouldContinue).toBe(false);
    });

    test("updates sessionStatus to completed when all features passing", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
        sessionStatus: "running",
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.sessionStatus).toBe("completed");
    });

    test("updates sessionStatus to completed when max iterations reached", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
        sessionStatus: "running",
        maxIterations: 5,
        iteration: 5,
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.sessionStatus).toBe("completed");
    });

    test("logs check-completion action in feature-list mode", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "pending" },
        { id: "f3", name: "Feature 3", description: "Desc 3", status: "failing" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
        iteration: 7,
      });

      await node.execute(ctx);

      const logPath = `${testSessionDir}logs/agent-calls.jsonl`;
      const content = await readFile(logPath, "utf-8");
      const entry = JSON.parse(content.trim());
      expect(entry.action).toBe("check-completion");
      expect(entry.mode).toBe("feature-list");
      expect(entry.iteration).toBe(7);
      expect(entry.totalFeatures).toBe(3);
      expect(entry.passingFeatures).toBe(1);
      expect(entry.pendingFeatures).toBe(1);
      expect(entry.failingFeatures).toBe(1);
    });

    test("saves session when completing in feature-list mode", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
        sessionStatus: "running",
        iteration: 3,
      });

      await node.execute(ctx);

      const sessionPath = `${testSessionDir}session.json`;
      const content = await readFile(sessionPath, "utf-8");
      const session = JSON.parse(content);
      expect(session.status).toBe("completed");
    });

    test("does not save session when continuing in feature-list mode", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
        sessionStatus: "running",
        maxIterations: 100,
        iteration: 5,
      });

      await node.execute(ctx);

      // Session should not be saved when continuing
      const sessionPath = `${testSessionDir}session.json`;
      expect(existsSync(sessionPath)).toBe(false);
    });
  });

  describe("unlimited iterations", () => {
    test("maxIterations 0 means unlimited in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: true,
        yoloComplete: false,
        maxIterations: 0,
        iteration: 1000,
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.maxIterationsReached).toBe(false);
      expect(result.stateUpdate!.shouldContinue).toBe(true);
    });

    test("maxIterations 0 means unlimited in feature-list mode", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
        maxIterations: 0,
        iteration: 1000,
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.maxIterationsReached).toBe(false);
      expect(result.stateUpdate!.shouldContinue).toBe(true);
    });
  });

  describe("status display", () => {
    test("displays Completed status when yolo mode completes", async () => {
      await createSessionDirectory(testSessionId);

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = checkCompletionNode({ id: "check" });
        const ctx = createCheckMockContext({
          yolo: true,
          yoloComplete: true,
          sessionStatus: "running",
        });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Status: Completed"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays Completed status when max iterations reached in yolo mode", async () => {
      await createSessionDirectory(testSessionId);

      // Capture console.log output
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };

      try {
        const node = checkCompletionNode({ id: "check" });
        const ctx = createCheckMockContext({
          yolo: true,
          yoloComplete: false,
          maxIterations: 5,
          iteration: 5,
          sessionStatus: "running",
        });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Status: Completed"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays Completed status when all features passing", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
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
          yolo: false,
          features,
          sessionStatus: "running",
        });
        await node.execute(ctx);

        expect(logs.some(log => log.includes("Status: Completed"))).toBe(true);
      } finally {
        console.log = originalLog;
      }
    });

    test("displays Completed status when max iterations reached in feature-list mode", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
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
          yolo: false,
          features,
          maxIterations: 5,
          iteration: 5,
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

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "pending" },
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
          yolo: false,
          features,
          maxIterations: 100,
          iteration: 5,
          sessionStatus: "running",
        });
        await node.execute(ctx);

        // Should not display status when continuing (status displayed by implementFeatureNode)
        expect(logs.some(log => log.includes("Status:"))).toBe(false);
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("edge cases", () => {
    test("handles empty features array in feature-list mode", async () => {
      await createSessionDirectory(testSessionId);

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features: [],
      });

      const result = await node.execute(ctx);

      // Empty array means all features are passing (vacuously true)
      expect(result.stateUpdate!.allFeaturesPassing).toBe(true);
      expect(result.stateUpdate!.shouldContinue).toBe(false);
    });

    test("handles mixed feature statuses correctly", async () => {
      await createSessionDirectory(testSessionId);

      const features: RalphFeature[] = [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "in_progress" },
        { id: "f3", name: "Feature 3", description: "Desc 3", status: "pending" },
        { id: "f4", name: "Feature 4", description: "Desc 4", status: "failing" },
      ];

      const node = checkCompletionNode({ id: "check" });
      const ctx = createCheckMockContext({
        yolo: false,
        features,
        maxIterations: 100,
        iteration: 5,
      });

      const result = await node.execute(ctx);

      expect(result.stateUpdate!.allFeaturesPassing).toBe(false);
      expect(result.stateUpdate!.shouldContinue).toBe(true);
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
      features: [
        { id: "f1", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc 2", status: "passing" },
        { id: "f3", name: "Feature 3", description: "Desc 3", status: "pending" },
      ],
    });
    return {
      state: { ...state, ...overrides },
      config: {} as GraphConfig<RalphWorkflowState>,
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
      expect(prompt).toContain("Feature 1");
      expect(prompt).toContain("Feature 2");
      // Feature 3 is pending, should not be in completed features
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
      features: [
        { id: "f1", name: "Feature 1", description: "Desc", status: "passing" },
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
      features: [],
    });

    const result = await processCreatePRResult(state, "PR_URL: https://github.com/test/pull/1");

    expect(result.sessionStatus).toBe("completed");
  });

  test("sets shouldContinue to false", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [],
    });

    const result = await processCreatePRResult(state, "Done");

    expect(result.shouldContinue).toBe(false);
  });

  test("saves session to disk", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [
        { id: "f1", name: "Feature", description: "Desc", status: "passing" },
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
      features: [
        { id: "f1", name: "Feature", description: "Desc", status: "passing" },
      ],
    });

    await processCreatePRResult(state, "PR_URL: https://github.com/test/pull/1");

    const progressPath = `${testSessionDir}progress.txt`;
    const content = await readFile(progressPath, "utf-8");
    expect(content).toContain("Session Complete");
    expect(content).toContain("1/1 features");
    expect(content).toContain("✓");
  });

  test("logs create-pr-result action", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [
        { id: "f1", name: "Feature 1", description: "Desc", status: "passing" },
        { id: "f2", name: "Feature 2", description: "Desc", status: "passing" },
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
      features: [],
    });

    const result = await processCreatePRResult(state, "Error: Could not create PR");

    expect(result.prUrl).toBeUndefined();
    expect(result.sessionStatus).toBe("completed"); // Still completes the session
  });

  test("marks progress as failing when no PR URL", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [],
    });

    await processCreatePRResult(state, "Error creating PR");

    const progressPath = `${testSessionDir}progress.txt`;
    const content = await readFile(progressPath, "utf-8");
    expect(content).toContain("✗");
  });

  test("extracts branch name when present", async () => {
    await createSessionDirectory(testSessionId);

    const state = createRalphWorkflowState({
      sessionId: testSessionId,
      features: [],
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
      features: [
        { id: "f1", name: "Feature 1", description: "Desc", status: "passing" },
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
      features: [],
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
      features: [],
    });

    await processCreatePRResult(state, "PR_URL: https://github.com/test/pull/1");

    expect(logCalls.length).toBeGreaterThan(0);
    const statusCall = logCalls.find((msg) =>
      msg.includes("Status: Completed")
    );
    expect(statusCall).toBeDefined();
  });
});
