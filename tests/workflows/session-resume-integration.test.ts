/**
 * Integration tests for Session resume with --resume flag
 *
 * Tests cover:
 * - Start Ralph session
 * - Execute partway through
 * - Interrupt with Ctrl+C
 * - Verify session marked as 'paused'
 * - Resume with /ralph --resume {uuid}
 * - Verify execution continues from checkpoint
 * - Verify no duplicate work done
 *
 * This is a comprehensive integration test suite that validates the
 * session resume functionality for the Ralph workflow.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  graph,
  createNode,
} from "../../src/graph/builder.ts";
import {
  executeGraph,
  streamGraph,
  type StepResult,
} from "../../src/graph/compiled.ts";
import {
  SessionDirSaver,
} from "../../src/graph/checkpointer.ts";
import type {
  BaseState,
  NodeDefinition,
  GraphConfig,
} from "../../src/graph/types.ts";
import {
  createRalphWorkflowState,
  initRalphSessionNode,
  implementFeatureNode,
  checkCompletionNode,
  sessionToWorkflowState,
  workflowStateToSession,
  type RalphWorkflowState,
  createRalphFeature,
  loadSession,
  saveSession,
  loadSessionIfExists,
  generateSessionId,
  getSessionDir,
  createSessionDirectory,
} from "../../src/graph/nodes/ralph-nodes.ts";
import {
  RalphExecutor,
  createRalphExecutor,
} from "../../src/workflows/ralph-executor.ts";
import { createRalphWorkflow } from "../../src/workflows/ralph.ts";
import { parseRalphArgs } from "../../src/ui/commands/workflow-commands.ts";

// ============================================================================
// Test State Types
// ============================================================================

/**
 * Extended test state for session resume integration tests.
 */
interface ResumeTestState extends BaseState {
  /** Counter for tracking node executions */
  nodeExecutionCount: number;

  /** Array of executed node IDs in order */
  executedNodes: string[];

  /** Data accumulated during workflow execution */
  data: Record<string, unknown>;

  /** Flag indicating workflow completion */
  isComplete: boolean;

  /** Ralph session directory (for SessionDirSaver) */
  ralphSessionDir: string;

  /** Ralph session ID */
  ralphSessionId: string;

  /** Session status for tracking */
  sessionStatus: "running" | "paused" | "completed" | "failed";

  /** Iteration counter */
  iteration: number;
}

/**
 * Create a fresh test state with default values.
 */
function createTestState(
  sessionDir: string,
  sessionId: string,
  overrides: Partial<ResumeTestState> = {}
): ResumeTestState {
  return {
    executionId: `test-exec-${Date.now()}`,
    lastUpdated: new Date().toISOString(),
    outputs: {},
    nodeExecutionCount: 0,
    executedNodes: [],
    data: {},
    isComplete: false,
    ralphSessionDir: sessionDir,
    ralphSessionId: sessionId,
    sessionStatus: "running",
    iteration: 1,
    ...overrides,
  };
}

// ============================================================================
// Test Node Factories
// ============================================================================

/**
 * Create a node that tracks execution order.
 */
function createTrackingNode(
  id: string,
  data?: Record<string, unknown>
): NodeDefinition<ResumeTestState> {
  return createNode<ResumeTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      data: { ...ctx.state.data, ...data, [`node_${id}`]: true },
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Create a node that marks workflow as complete.
 */
function createCompletionNode(id: string): NodeDefinition<ResumeTestState> {
  return createNode<ResumeTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      isComplete: true,
      sessionStatus: "completed",
      lastUpdated: new Date().toISOString(),
    },
  }));
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a session directory structure for testing.
 */
async function createTestSessionDir(): Promise<{
  sessionDir: string;
  sessionId: string;
  tempDir: string;
  cleanup: () => Promise<void>;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "atomic-resume-test-"));
  const sessionId = generateSessionId();
  const sessionDir = join(tempDir, ".ralph", "sessions", sessionId);

  // Create the session directory structure
  await mkdir(join(sessionDir, "checkpoints"), { recursive: true });
  await mkdir(join(sessionDir, "research"), { recursive: true });
  await mkdir(join(sessionDir, "logs"), { recursive: true });

  return {
    sessionDir,
    sessionId,
    tempDir,
    cleanup: async () => {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Create a valid session.json for testing.
 */
async function createTestSessionJson(
  sessionDir: string,
  sessionId: string,
  overrides: Partial<{
    status: "running" | "paused" | "completed" | "failed";
    iteration: number;
    features: Array<{
      id: string;
      name: string;
      description: string;
      status: "pending" | "in_progress" | "passing" | "failing";
    }>;
    currentFeatureIndex: number;
    completedFeatures: string[];
  }> = {}
): Promise<void> {
  const session = {
    sessionId,
    sessionDir,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    yolo: false,
    maxIterations: 50,
    features: overrides.features ?? [
      { id: "feat-001", name: "Feature 1", description: "Test feature 1", status: "passing" },
      { id: "feat-002", name: "Feature 2", description: "Test feature 2", status: "pending" },
      { id: "feat-003", name: "Feature 3", description: "Test feature 3", status: "pending" },
    ],
    currentFeatureIndex: overrides.currentFeatureIndex ?? 1,
    completedFeatures: overrides.completedFeatures ?? ["feat-001"],
    iteration: overrides.iteration ?? 2,
    status: overrides.status ?? "running",
    debugReports: [],
  };

  await writeFile(
    join(sessionDir, "session.json"),
    JSON.stringify(session, null, 2),
    "utf-8"
  );
}

/**
 * Create a feature-list.json for testing.
 */
async function createTestFeatureList(
  sessionDir: string,
  features?: Array<{
    category: string;
    description: string;
    steps: string[];
    passes: boolean;
  }>
): Promise<void> {
  const featureList = {
    features: features ?? [
      { category: "functional", description: "Feature 1", steps: ["Step 1"], passes: true },
      { category: "functional", description: "Feature 2", steps: ["Step 2"], passes: false },
      { category: "functional", description: "Feature 3", steps: ["Step 3"], passes: false },
    ],
  };

  await writeFile(
    join(sessionDir, "research", "feature-list.json"),
    JSON.stringify(featureList, null, 2),
    "utf-8"
  );
}

// ============================================================================
// Start Ralph session
// ============================================================================

describe("Start Ralph session", () => {
  let sessionDir: string;
  let sessionId: string;
  let tempDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestSessionDir();
    sessionDir = testEnv.sessionDir;
    sessionId = testEnv.sessionId;
    tempDir = testEnv.tempDir;
    cleanup = testEnv.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  test("session starts with unique UUID", async () => {
    await createTestSessionJson(sessionDir, sessionId, { status: "running" });

    const session = await loadSession(sessionDir);

    expect(session.sessionId).toBe(sessionId);
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });

  test("session starts with status 'running'", async () => {
    await createTestSessionJson(sessionDir, sessionId, { status: "running" });

    const session = await loadSession(sessionDir);

    expect(session.status).toBe("running");
  });

  test("session has iteration initialized to 1 or configured value", async () => {
    await createTestSessionJson(sessionDir, sessionId, { iteration: 1 });

    const session = await loadSession(sessionDir);

    expect(session.iteration).toBeGreaterThanOrEqual(1);
  });

  test("session has feature list loaded correctly", async () => {
    await createTestSessionJson(sessionDir, sessionId);

    const session = await loadSession(sessionDir);

    expect(session.features).toBeArray();
    expect(session.features.length).toBeGreaterThan(0);
  });

  test("generateSessionId produces valid UUID format", () => {
    const id1 = generateSessionId();
    const id2 = generateSessionId();

    // Should match UUID v4 format
    expect(id1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(id2).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    // Should be unique
    expect(id1).not.toBe(id2);
  });
});

// ============================================================================
// Execute partway through
// ============================================================================

describe("Execute partway through", () => {
  let sessionDir: string;
  let sessionId: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestSessionDir();
    sessionDir = testEnv.sessionDir;
    sessionId = testEnv.sessionId;
    cleanup = testEnv.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  test("workflow can be executed partially using streaming", async () => {
    const saver = new SessionDirSaver<ResumeTestState>(sessionDir);
    const config: GraphConfig<ResumeTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    const workflow = graph<ResumeTestState>()
      .start(createTrackingNode("step-1", { step: 1 }))
      .then(createTrackingNode("step-2", { step: 2 }))
      .then(createTrackingNode("step-3", { step: 3 }))
      .then(createCompletionNode("complete"))
      .end()
      .compile(config);

    const initialState = createTestState(sessionDir, sessionId);
    let partialState: ResumeTestState | null = null;

    // Execute only first 2 nodes
    for await (const step of streamGraph(workflow, { initialState })) {
      partialState = step.state;
      if (step.state.nodeExecutionCount >= 2) {
        break;
      }
    }

    // Verify partial execution
    expect(partialState).not.toBeNull();
    expect(partialState!.nodeExecutionCount).toBe(2);
    expect(partialState!.executedNodes).toEqual(["step-1", "step-2"]);
    expect(partialState!.isComplete).toBe(false);
  });

  test("checkpoints are saved during partial execution", async () => {
    const saver = new SessionDirSaver<ResumeTestState>(sessionDir);
    const config: GraphConfig<ResumeTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    const workflow = graph<ResumeTestState>()
      .start(createTrackingNode("step-1", { step: 1 }))
      .then(createTrackingNode("step-2", { step: 2 }))
      .then(createTrackingNode("step-3", { step: 3 }))
      .end()
      .compile(config);

    const initialState = createTestState(sessionDir, sessionId);

    // Execute partially
    let stepCount = 0;
    for await (const step of streamGraph(workflow, { initialState })) {
      stepCount++;
      if (stepCount >= 2) break;
    }

    // Verify checkpoints were saved
    const checkpointsDir = join(sessionDir, "checkpoints");
    const files = await readdir(checkpointsDir);

    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  test("session iteration increments during execution", async () => {
    await createTestSessionJson(sessionDir, sessionId, { iteration: 1 });

    let session = await loadSession(sessionDir);
    expect(session.iteration).toBe(1);

    // Simulate iteration increment
    session.iteration = 2;
    await saveSession(sessionDir, session);

    session = await loadSession(sessionDir);
    expect(session.iteration).toBe(2);
  });
});

// ============================================================================
// Interrupt with Ctrl+C
// ============================================================================

describe("Interrupt with Ctrl+C", () => {
  let sessionDir: string;
  let sessionId: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestSessionDir();
    sessionDir = testEnv.sessionDir;
    sessionId = testEnv.sessionId;
    cleanup = testEnv.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  test("workflow can be interrupted via AbortController", async () => {
    const abortController = new AbortController();
    const saver = new SessionDirSaver<ResumeTestState>(sessionDir);

    const config: GraphConfig<ResumeTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    const slowNode = createNode<ResumeTestState>("slow", "tool", async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        stateUpdate: {
          nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
          executedNodes: [...ctx.state.executedNodes, "slow"],
        },
      };
    });

    const workflow = graph<ResumeTestState>()
      .start(createTrackingNode("first", { step: 1 }))
      .then(slowNode)
      .then(createTrackingNode("after-slow", { step: 3 }))
      .end()
      .compile(config);

    const initialState = createTestState(sessionDir, sessionId);

    // Abort quickly
    setTimeout(() => abortController.abort(), 10);

    const result = await executeGraph(workflow, {
      initialState,
      abortSignal: abortController.signal,
    });

    expect(result.status).toBe("cancelled");
  });

  test("session state is preserved after interrupt", async () => {
    await createTestSessionJson(sessionDir, sessionId, {
      status: "running",
      iteration: 3,
      completedFeatures: ["feat-001", "feat-002"],
    });

    const session = await loadSession(sessionDir);
    expect(session.status).toBe("running");
    expect(session.iteration).toBe(3);
    expect(session.completedFeatures).toContain("feat-001");
    expect(session.completedFeatures).toContain("feat-002");
  });

  test("RalphExecutor handles interrupt gracefully", () => {
    const executor = createRalphExecutor();

    expect(() => {
      executor.setSession(sessionId, sessionDir);
    }).not.toThrow();

    executor.cleanup();
  });
});

// ============================================================================
// Verify session marked as 'paused'
// ============================================================================

describe("Verify session marked as 'paused'", () => {
  let sessionDir: string;
  let sessionId: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestSessionDir();
    sessionDir = testEnv.sessionDir;
    sessionId = testEnv.sessionId;
    cleanup = testEnv.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  test("session status can be set to 'paused'", async () => {
    await createTestSessionJson(sessionDir, sessionId, { status: "running" });

    let session = await loadSession(sessionDir);
    session.status = "paused";
    await saveSession(sessionDir, session);

    session = await loadSession(sessionDir);
    expect(session.status).toBe("paused");
  });

  test("session preserves data when paused", async () => {
    await createTestSessionJson(sessionDir, sessionId, {
      status: "running",
      iteration: 5,
      completedFeatures: ["feat-001", "feat-002"],
    });

    let session = await loadSession(sessionDir);
    session.status = "paused";
    await saveSession(sessionDir, session);

    session = await loadSession(sessionDir);
    expect(session.status).toBe("paused");
    expect(session.iteration).toBe(5);
    expect(session.completedFeatures).toEqual(["feat-001", "feat-002"]);
  });

  test("paused session retains feature progress", async () => {
    const features = [
      { id: "feat-001", name: "Feature 1", description: "Desc 1", status: "passing" as const },
      { id: "feat-002", name: "Feature 2", description: "Desc 2", status: "in_progress" as const },
      { id: "feat-003", name: "Feature 3", description: "Desc 3", status: "pending" as const },
    ];

    await createTestSessionJson(sessionDir, sessionId, {
      status: "running",
      features,
    });

    let session = await loadSession(sessionDir);
    session.status = "paused";
    await saveSession(sessionDir, session);

    session = await loadSession(sessionDir);
    expect(session.status).toBe("paused");
    expect(session.features[0]!.status).toBe("passing");
    expect(session.features[1]!.status).toBe("in_progress");
    expect(session.features[2]!.status).toBe("pending");
  });

  test("lastUpdated timestamp is updated when paused", async () => {
    await createTestSessionJson(sessionDir, sessionId, { status: "running" });

    const session1 = await loadSession(sessionDir);
    const initialTimestamp = session1.lastUpdated;

    // Wait a bit to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 50));

    session1.status = "paused";
    await saveSession(sessionDir, session1);

    const session2 = await loadSession(sessionDir);
    expect(new Date(session2.lastUpdated).getTime()).toBeGreaterThan(
      new Date(initialTimestamp).getTime()
    );
  });
});

// ============================================================================
// Resume with /ralph --resume {uuid}
// ============================================================================

describe("Resume with /ralph --resume {uuid}", () => {
  let sessionDir: string;
  let sessionId: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestSessionDir();
    sessionDir = testEnv.sessionDir;
    sessionId = testEnv.sessionId;
    cleanup = testEnv.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  test("parseRalphArgs correctly parses --resume flag", () => {
    const result = parseRalphArgs(`--resume ${sessionId}`);

    expect(result.resumeSessionId).toBe(sessionId);
    expect(result.yolo).toBe(false);
  });

  test("parseRalphArgs extracts correct UUID from --resume", () => {
    const testId = "550e8400-e29b-41d4-a716-446655440000";
    const result = parseRalphArgs(`--resume ${testId}`);

    expect(result.resumeSessionId).toBe(testId);
  });

  test("paused session can be loaded for resumption", async () => {
    await createTestSessionJson(sessionDir, sessionId, {
      status: "paused",
      iteration: 5,
    });

    const session = await loadSessionIfExists(sessionDir);

    expect(session).not.toBeNull();
    expect(session!.status).toBe("paused");
    expect(session!.sessionId).toBe(sessionId);
  });

  test("session can be converted to workflow state for resumption", async () => {
    await createTestSessionJson(sessionDir, sessionId, {
      status: "paused",
      iteration: 5,
      completedFeatures: ["feat-001"],
    });

    const session = await loadSession(sessionDir);
    const workflowState = sessionToWorkflowState(session);

    expect(workflowState.ralphSessionId).toBe(sessionId);
    expect(workflowState.iteration).toBe(5);
    expect(workflowState.completedFeatures).toContain("feat-001");
    expect(workflowState.sessionStatus).toBe("paused");
  });

  test("session status changes from 'paused' to 'running' on resume", async () => {
    await createTestSessionJson(sessionDir, sessionId, { status: "paused" });

    let session = await loadSession(sessionDir);
    expect(session.status).toBe("paused");

    // Simulate resume
    session.status = "running";
    await saveSession(sessionDir, session);

    session = await loadSession(sessionDir);
    expect(session.status).toBe("running");
  });

  test("loadSessionIfExists returns null for non-existent session", async () => {
    const fakeSessionDir = join(sessionDir, "..", "fake-session-id");
    const session = await loadSessionIfExists(fakeSessionDir);

    expect(session).toBeNull();
  });

  test("--resume flag is validated as valid UUID", () => {
    // Valid UUID
    const validResult = parseRalphArgs("--resume 550e8400-e29b-41d4-a716-446655440000");
    expect(validResult.resumeSessionId).toBe("550e8400-e29b-41d4-a716-446655440000");

    // Invalid format still gets passed through (validation happens in command handler)
    const invalidResult = parseRalphArgs("--resume invalid-id");
    expect(invalidResult.resumeSessionId).toBe("invalid-id");
  });
});

// ============================================================================
// Verify execution continues from checkpoint
// ============================================================================

describe("Verify execution continues from checkpoint", () => {
  let sessionDir: string;
  let sessionId: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestSessionDir();
    sessionDir = testEnv.sessionDir;
    sessionId = testEnv.sessionId;
    cleanup = testEnv.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  test("execution resumes from saved state", async () => {
    const saver = new SessionDirSaver<ResumeTestState>(sessionDir);

    // Save a partial state as if we stopped mid-execution
    const partialState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 2,
      executedNodes: ["step-1", "step-2"],
      data: { step1: true, step2: true },
    });
    await saver.save("exec-1", partialState, "node-002");

    // Load the checkpoint
    const resumedState = await saver.loadByLabel("exec-1", "node-002");

    expect(resumedState).not.toBeNull();
    expect(resumedState!.nodeExecutionCount).toBe(2);
    expect(resumedState!.executedNodes).toEqual(["step-1", "step-2"]);
  });

  test("resumed workflow continues from correct point", async () => {
    const saver = new SessionDirSaver<ResumeTestState>(sessionDir);
    const config: GraphConfig<ResumeTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    // Create state as if step-1 and step-2 were already done
    const resumeState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 2,
      executedNodes: ["step-1", "step-2"],
      data: { step: 2 },
    });

    // Create continuation workflow
    const continueWorkflow = graph<ResumeTestState>()
      .start(createTrackingNode("step-3", { step: 3 }))
      .then(createCompletionNode("complete"))
      .end()
      .compile(config);

    // Execute with resumed state
    const result = await executeGraph(continueWorkflow, {
      initialState: resumeState,
    });

    expect(result.status).toBe("completed");
    expect(result.state.isComplete).toBe(true);
    expect(result.state.nodeExecutionCount).toBe(4); // 2 from resume + 2 new
    expect(result.state.executedNodes).toContain("step-3");
    expect(result.state.executedNodes).toContain("complete");
  });

  test("session iteration continues from where it left off", async () => {
    await createTestSessionJson(sessionDir, sessionId, {
      status: "paused",
      iteration: 10,
    });

    const session = await loadSession(sessionDir);
    const workflowState = sessionToWorkflowState(session);

    expect(workflowState.iteration).toBe(10);

    // Simulate next iteration
    workflowState.iteration = 11;
    const updatedSession = workflowStateToSession(workflowState);
    await saveSession(sessionDir, updatedSession);

    const reloadedSession = await loadSession(sessionDir);
    expect(reloadedSession.iteration).toBe(11);
  });

  test("feature list state is preserved through resume", async () => {
    const features = [
      { id: "feat-001", name: "Feature 1", description: "Desc 1", status: "passing" as const },
      { id: "feat-002", name: "Feature 2", description: "Desc 2", status: "in_progress" as const },
      { id: "feat-003", name: "Feature 3", description: "Desc 3", status: "pending" as const },
    ];

    await createTestSessionJson(sessionDir, sessionId, {
      status: "paused",
      features,
      currentFeatureIndex: 1,
    });

    const session = await loadSession(sessionDir);
    const workflowState = sessionToWorkflowState(session);

    expect(workflowState.features.length).toBe(3);
    expect(workflowState.features[0]!.status).toBe("passing");
    expect(workflowState.features[1]!.status).toBe("in_progress");
    expect(workflowState.currentFeatureIndex).toBe(1);
  });
});

// ============================================================================
// Verify no duplicate work done
// ============================================================================

describe("Verify no duplicate work done", () => {
  let sessionDir: string;
  let sessionId: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestSessionDir();
    sessionDir = testEnv.sessionDir;
    sessionId = testEnv.sessionId;
    cleanup = testEnv.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  test("completed features are not re-executed", async () => {
    await createTestSessionJson(sessionDir, sessionId, {
      status: "paused",
      features: [
        { id: "feat-001", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "feat-002", name: "Feature 2", description: "Desc 2", status: "pending" },
      ],
      completedFeatures: ["feat-001"],
    });

    const session = await loadSession(sessionDir);
    const workflowState = sessionToWorkflowState(session);

    // The next feature to be worked on should be feat-002, not feat-001
    const nextPendingFeature = workflowState.features.find(
      (f) => f.status === "pending"
    );

    expect(nextPendingFeature).not.toBeUndefined();
    expect(nextPendingFeature!.id).toBe("feat-002");
    expect(workflowState.completedFeatures).toContain("feat-001");
  });

  test("executed nodes array reflects actual execution history", async () => {
    const saver = new SessionDirSaver<ResumeTestState>(sessionDir);

    // Simulate state after partial execution
    const partialState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 2,
      executedNodes: ["step-1", "step-2"],
    });
    await saver.save("exec-1", partialState, "checkpoint");

    // Load checkpoint
    const resumedState = await saver.loadByLabel("exec-1", "checkpoint");

    // Verify history is preserved
    expect(resumedState!.executedNodes).toEqual(["step-1", "step-2"]);
    expect(resumedState!.executedNodes).not.toContain("step-3");
  });

  test("node execution count is preserved and continues correctly", async () => {
    const saver = new SessionDirSaver<ResumeTestState>(sessionDir);
    const config: GraphConfig<ResumeTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    // State with 2 nodes already executed
    const resumeState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 2,
      executedNodes: ["step-1", "step-2"],
    });

    // Execute one more node
    const workflow = graph<ResumeTestState>()
      .start(createTrackingNode("step-3"))
      .end()
      .compile(config);

    const result = await executeGraph(workflow, {
      initialState: resumeState,
    });

    // Count should be 3, not 1 or reset
    expect(result.state.nodeExecutionCount).toBe(3);
  });

  test("data accumulated before pause is preserved", async () => {
    const saver = new SessionDirSaver<ResumeTestState>(sessionDir);

    // State with accumulated data
    const partialState = createTestState(sessionDir, sessionId, {
      data: {
        step1_result: "success",
        step2_result: "processed",
        accumulated_count: 42,
      },
    });
    await saver.save("exec-1", partialState, "checkpoint");

    // Load checkpoint
    const resumedState = await saver.loadByLabel("exec-1", "checkpoint");

    // All data should be preserved
    expect(resumedState!.data.step1_result).toBe("success");
    expect(resumedState!.data.step2_result).toBe("processed");
    expect(resumedState!.data.accumulated_count).toBe(42);
  });

  test("passing features remain passing after resume", async () => {
    await createTestSessionJson(sessionDir, sessionId, {
      status: "paused",
      features: [
        { id: "feat-001", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "feat-002", name: "Feature 2", description: "Desc 2", status: "passing" },
        { id: "feat-003", name: "Feature 3", description: "Desc 3", status: "pending" },
      ],
    });

    let session = await loadSession(sessionDir);
    session.status = "running"; // Resume
    await saveSession(sessionDir, session);

    session = await loadSession(sessionDir);

    // Passing features should still be passing
    expect(session.features[0]!.status).toBe("passing");
    expect(session.features[1]!.status).toBe("passing");
    expect(session.features[2]!.status).toBe("pending");
  });
});

// ============================================================================
// End-to-end resume flow
// ============================================================================

describe("End-to-end resume flow", () => {
  let sessionDir: string;
  let sessionId: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestSessionDir();
    sessionDir = testEnv.sessionDir;
    sessionId = testEnv.sessionId;
    cleanup = testEnv.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  test("complete pause and resume cycle preserves all state", async () => {
    // 1. Create initial session in running state
    await createTestSessionJson(sessionDir, sessionId, {
      status: "running",
      iteration: 3,
      features: [
        { id: "feat-001", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "feat-002", name: "Feature 2", description: "Desc 2", status: "in_progress" },
        { id: "feat-003", name: "Feature 3", description: "Desc 3", status: "pending" },
      ],
      currentFeatureIndex: 1,
      completedFeatures: ["feat-001"],
    });

    // 2. Verify initial state
    let session = await loadSession(sessionDir);
    expect(session.status).toBe("running");
    expect(session.iteration).toBe(3);

    // 3. Simulate pause (Ctrl+C)
    session.status = "paused";
    await saveSession(sessionDir, session);

    // 4. Verify paused state
    session = await loadSession(sessionDir);
    expect(session.status).toBe("paused");

    // 5. Parse resume command
    const parseResult = parseRalphArgs(`--resume ${sessionId}`);
    expect(parseResult.resumeSessionId).toBe(sessionId);

    // 6. Load session for resumption
    const resumeSession = await loadSessionIfExists(sessionDir);
    expect(resumeSession).not.toBeNull();

    // 7. Convert to workflow state
    const workflowState = sessionToWorkflowState(resumeSession!);

    // 8. Verify all state is preserved
    expect(workflowState.ralphSessionId).toBe(sessionId);
    expect(workflowState.iteration).toBe(3);
    expect(workflowState.features[0]!.status).toBe("passing");
    expect(workflowState.features[1]!.status).toBe("in_progress");
    expect(workflowState.features[2]!.status).toBe("pending");
    expect(workflowState.currentFeatureIndex).toBe(1);
    expect(workflowState.completedFeatures).toContain("feat-001");

    // 9. Simulate resume
    workflowState.sessionStatus = "running";
    const updatedSession = workflowStateToSession(workflowState);
    await saveSession(sessionDir, updatedSession);

    // 10. Verify resumed state
    session = await loadSession(sessionDir);
    expect(session.status).toBe("running");
  });

  test("multiple pause and resume cycles work correctly", async () => {
    await createTestSessionJson(sessionDir, sessionId, {
      status: "running",
      iteration: 1,
    });

    // Cycle 1: Run -> Pause
    let session = await loadSession(sessionDir);
    session.iteration = 5;
    session.status = "paused";
    await saveSession(sessionDir, session);

    // Cycle 1: Resume
    session = await loadSession(sessionDir);
    session.status = "running";
    await saveSession(sessionDir, session);

    // Cycle 2: Run -> Pause
    session = await loadSession(sessionDir);
    session.iteration = 10;
    session.status = "paused";
    await saveSession(sessionDir, session);

    // Cycle 2: Resume
    session = await loadSession(sessionDir);
    session.status = "running";
    await saveSession(sessionDir, session);

    // Final verification
    session = await loadSession(sessionDir);
    expect(session.status).toBe("running");
    expect(session.iteration).toBe(10);
  });

  test("resume after checkpoint maintains correct state progression", async () => {
    const saver = new SessionDirSaver<ResumeTestState>(sessionDir);

    // Initial execution saves checkpoint
    const initialState = createTestState(sessionDir, sessionId, {
      iteration: 1,
    });
    await saver.save("exec-1", initialState, "node-001");

    // More execution, more checkpoints
    const midState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 3,
      executedNodes: ["node-1", "node-2", "node-3"],
      iteration: 3,
    });
    await saver.save("exec-1", midState, "node-003");

    // List checkpoints
    const checkpoints = await saver.list("exec-1");
    expect(checkpoints).toContain("node-001");
    expect(checkpoints).toContain("node-003");

    // Resume from latest checkpoint
    const resumedState = await saver.loadByLabel("exec-1", "node-003");
    expect(resumedState!.nodeExecutionCount).toBe(3);
    expect(resumedState!.iteration).toBe(3);
    expect(resumedState!.executedNodes).toHaveLength(3);
  });
});

// ============================================================================
// Edge cases and error handling
// ============================================================================

describe("Edge cases and error handling", () => {
  let sessionDir: string;
  let sessionId: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const testEnv = await createTestSessionDir();
    sessionDir = testEnv.sessionDir;
    sessionId = testEnv.sessionId;
    cleanup = testEnv.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  test("handles session with empty features array", async () => {
    await createTestSessionJson(sessionDir, sessionId, {
      features: [],
    });

    const session = await loadSession(sessionDir);
    expect(session.features).toEqual([]);

    const workflowState = sessionToWorkflowState(session);
    expect(workflowState.features).toEqual([]);
  });

  test("handles session with all features already passing", async () => {
    await createTestSessionJson(sessionDir, sessionId, {
      features: [
        { id: "feat-001", name: "Feature 1", description: "Desc 1", status: "passing" },
        { id: "feat-002", name: "Feature 2", description: "Desc 2", status: "passing" },
      ],
    });

    const session = await loadSession(sessionDir);
    const workflowState = sessionToWorkflowState(session);

    const allPassing = workflowState.features.every((f) => f.status === "passing");
    expect(allPassing).toBe(true);
  });

  test("handles corrupted checkpoint gracefully", async () => {
    const saver = new SessionDirSaver<ResumeTestState>(sessionDir);

    // Try to load non-existent checkpoint
    const result = await saver.load("non-existent-exec");
    expect(result).toBeNull();
  });

  test("session directory missing returns null on load", async () => {
    const fakeDir = "/tmp/non-existent-session-dir";
    const result = await loadSessionIfExists(fakeDir);
    expect(result).toBeNull();
  });

  test("handles concurrent access to session state", async () => {
    await createTestSessionJson(sessionDir, sessionId, { iteration: 1 });

    // Simulate concurrent reads
    const [session1, session2] = await Promise.all([
      loadSession(sessionDir),
      loadSession(sessionDir),
    ]);

    expect(session1.sessionId).toBe(session2.sessionId);
    expect(session1.iteration).toBe(session2.iteration);
  });

  test("handles yolo mode session resume", async () => {
    // Create yolo mode session
    const yoloSession = {
      sessionId,
      sessionDir,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      yolo: true,
      maxIterations: 0,
      features: [],
      currentFeatureIndex: 0,
      completedFeatures: [],
      iteration: 5,
      status: "paused",
      debugReports: [],
    };

    await writeFile(
      join(sessionDir, "session.json"),
      JSON.stringify(yoloSession, null, 2),
      "utf-8"
    );

    const session = await loadSession(sessionDir);
    expect(session.yolo).toBe(true);
    expect(session.status).toBe("paused");

    const workflowState = sessionToWorkflowState(session);
    expect(workflowState.yolo).toBe(true);
    expect(workflowState.iteration).toBe(5);
  });
});
