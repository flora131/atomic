/**
 * Tests for Ralph Node Factory Functions
 *
 * Tests the RalphWorkflowState interface and related factory functions
 * for the Ralph autonomous workflow graph nodes.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rm, mkdir, readFile } from "node:fs/promises";
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
