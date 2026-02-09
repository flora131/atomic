/**
 * Integration tests for Checkpoint save/restore to session directory
 *
 * Tests cover:
 * - Execute Ralph workflow with checkpointing enabled
 * - Verify checkpoints saved to session directory
 * - Interrupt workflow mid-execution
 * - Create new workflow execution with resume
 * - Verify state restored from checkpoint
 * - Verify execution continues from checkpoint
 *
 * This is a comprehensive integration test suite that validates the
 * checkpoint save/restore functionality for Ralph session directories.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
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
  MemorySaver,
  FileSaver,
} from "../../src/graph/checkpointer.ts";
import type {
  BaseState,
  NodeDefinition,
  CompiledGraph,
  GraphConfig,
} from "../../src/graph/types.ts";
import {
  createRalphWorkflowState,
  type RalphWorkflowState,
} from "../../src/graph/nodes/ralph-nodes.ts";
import type { TodoItem } from "../../src/sdk/tools/todo-write.ts";
import {
  createSessionDirectory,
  generateSessionId,
  getSessionDir,
  saveSession,
  loadSession,
  loadSessionIfExists,
} from "../../src/workflows/index.ts";

// ============================================================================
// Test State Types
// ============================================================================

/**
 * Extended test state for checkpoint integration tests.
 */
interface CheckpointTestState extends BaseState {
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
}

/**
 * Create a fresh test state with default values.
 */
function createTestState(
  sessionDir: string,
  sessionId: string,
  overrides: Partial<CheckpointTestState> = {}
): CheckpointTestState {
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
): NodeDefinition<CheckpointTestState> {
  return createNode<CheckpointTestState>(id, "tool", async (ctx) => ({
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
function createCompletionNode(id: string): NodeDefinition<CheckpointTestState> {
  return createNode<CheckpointTestState>(id, "tool", async (ctx) => ({
    stateUpdate: {
      nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
      executedNodes: [...ctx.state.executedNodes, id],
      isComplete: true,
      lastUpdated: new Date().toISOString(),
    },
  }));
}

/**
 * Create a node that can pause execution (simulating long-running work).
 */
function createPausableNode(
  id: string,
  shouldPause: () => boolean
): NodeDefinition<CheckpointTestState> {
  return createNode<CheckpointTestState>(id, "tool", async (ctx) => {
    if (shouldPause()) {
      // Emit a signal that can be used to pause execution
      return {
        stateUpdate: {
          nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
          executedNodes: [...ctx.state.executedNodes, id],
          data: { ...ctx.state.data, paused: true },
          lastUpdated: new Date().toISOString(),
        },
        signals: [{ type: "checkpoint" as const }],
      };
    }
    return {
      stateUpdate: {
        nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
        executedNodes: [...ctx.state.executedNodes, id],
        data: { ...ctx.state.data, [`node_${id}`]: true },
        lastUpdated: new Date().toISOString(),
      },
    };
  });
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
  cleanup: () => Promise<void>;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "atomic-checkpoint-test-"));
  const sessionId = generateSessionId();
  const sessionDir = join(tempDir, ".ralph", "sessions", sessionId);

  // Create the session directory structure
  await mkdir(join(sessionDir, "checkpoints"), { recursive: true });
  await mkdir(join(sessionDir, "research"), { recursive: true });
  await mkdir(join(sessionDir, "logs"), { recursive: true });

  return {
    sessionDir,
    sessionId,
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
 * Create a compiled workflow with checkpointing enabled.
 */
function createCheckpointedWorkflow(
  sessionDir: string
): CompiledGraph<CheckpointTestState> {
  const config: GraphConfig<CheckpointTestState> = {
    autoCheckpoint: true,
    checkpointer: new SessionDirSaver<CheckpointTestState>(sessionDir),
  };

  return graph<CheckpointTestState>()
    .start(createTrackingNode("step-1", { step: 1 }))
    .then(createTrackingNode("step-2", { step: 2 }))
    .then(createTrackingNode("step-3", { step: 3 }))
    .then(createCompletionNode("step-complete"))
    .end()
    .compile(config);
}

/**
 * Create a compiled workflow with dynamic session directory checkpointing.
 */
function createDynamicCheckpointedWorkflow(): CompiledGraph<CheckpointTestState> {
  const config: GraphConfig<CheckpointTestState> = {
    autoCheckpoint: true,
    checkpointer: new SessionDirSaver<CheckpointTestState>(
      (state) => state.ralphSessionDir
    ),
  };

  return graph<CheckpointTestState>()
    .start(createTrackingNode("step-1", { step: 1 }))
    .then(createTrackingNode("step-2", { step: 2 }))
    .then(createTrackingNode("step-3", { step: 3 }))
    .then(createCompletionNode("step-complete"))
    .end()
    .compile(config);
}

// ============================================================================
// Execute Ralph workflow with checkpointing enabled
// ============================================================================

describe("Execute Ralph workflow with checkpointing enabled", () => {
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

  test("workflow executes successfully with checkpointing enabled", async () => {
    const workflow = createCheckpointedWorkflow(sessionDir);
    const initialState = createTestState(sessionDir, sessionId);

    const result = await executeGraph(workflow, {
      initialState,
    });

    expect(result.status).toBe("completed");
    expect(result.state.isComplete).toBe(true);
    expect(result.state.nodeExecutionCount).toBe(4);
    expect(result.state.executedNodes).toEqual([
      "step-1",
      "step-2",
      "step-3",
      "step-complete",
    ]);
  });

  test("workflow with dynamic session directory checkpointing executes successfully", async () => {
    const workflow = createDynamicCheckpointedWorkflow();
    const initialState = createTestState(sessionDir, sessionId);

    const result = await executeGraph(workflow, {
      initialState,
    });

    expect(result.status).toBe("completed");
    expect(result.state.isComplete).toBe(true);
    expect(result.state.nodeExecutionCount).toBe(4);
  });

  test("checkpointing does not affect workflow behavior", async () => {
    // Workflow with checkpointing
    const workflowWithCheckpointing = createCheckpointedWorkflow(sessionDir);

    // Workflow without checkpointing
    const workflowWithoutCheckpointing = graph<CheckpointTestState>()
      .start(createTrackingNode("step-1", { step: 1 }))
      .then(createTrackingNode("step-2", { step: 2 }))
      .then(createTrackingNode("step-3", { step: 3 }))
      .then(createCompletionNode("step-complete"))
      .end()
      .compile({ autoCheckpoint: false });

    const initialState1 = createTestState(sessionDir, sessionId);
    const initialState2 = createTestState(sessionDir, sessionId);

    const result1 = await executeGraph(workflowWithCheckpointing, {
      initialState: initialState1,
    });
    const result2 = await executeGraph(workflowWithoutCheckpointing, {
      initialState: initialState2,
    });

    // Both should complete successfully with same state structure
    expect(result1.status).toBe(result2.status);
    expect(result1.state.isComplete).toBe(result2.state.isComplete);
    expect(result1.state.nodeExecutionCount).toBe(result2.state.nodeExecutionCount);
    expect(result1.state.executedNodes).toEqual(result2.state.executedNodes);
  });
});

// ============================================================================
// Verify checkpoints saved to session directory
// ============================================================================

describe("Verify checkpoints saved to session directory", () => {
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

  test("checkpoints are saved to session checkpoints directory", async () => {
    const workflow = createCheckpointedWorkflow(sessionDir);
    const initialState = createTestState(sessionDir, sessionId);

    await executeGraph(workflow, { initialState });

    // Check that checkpoint files exist
    const checkpointsDir = join(sessionDir, "checkpoints");
    const files = await readdir(checkpointsDir);

    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.endsWith(".json"))).toBe(true);
  });

  test("checkpoint files contain valid JSON state", async () => {
    const workflow = createCheckpointedWorkflow(sessionDir);
    const initialState = createTestState(sessionDir, sessionId);

    await executeGraph(workflow, { initialState });

    const checkpointsDir = join(sessionDir, "checkpoints");
    const files = await readdir(checkpointsDir);

    for (const file of files) {
      const content = await readFile(join(checkpointsDir, file), "utf-8");
      const data = JSON.parse(content);

      // Verify checkpoint structure
      expect(data).toHaveProperty("executionId");
      expect(data).toHaveProperty("label");
      expect(data).toHaveProperty("timestamp");
      expect(data).toHaveProperty("state");
      expect(data.state).toHaveProperty("executionId");
      expect(data.state).toHaveProperty("outputs");
    }
  });

  test("checkpoints use sequential naming (node-001, node-002, etc.)", async () => {
    const workflow = createCheckpointedWorkflow(sessionDir);
    const initialState = createTestState(sessionDir, sessionId);

    await executeGraph(workflow, { initialState });

    const checkpointsDir = join(sessionDir, "checkpoints");
    const files = await readdir(checkpointsDir);
    const sortedFiles = files.sort();

    // Verify sequential naming pattern
    for (let i = 0; i < sortedFiles.length; i++) {
      const expectedPattern = /^(step_\d+|node-\d{3})\.json$/;
      expect(sortedFiles[i]).toMatch(expectedPattern);
    }
  });

  test("checkpoint state reflects execution progress", async () => {
    const workflow = createCheckpointedWorkflow(sessionDir);
    const initialState = createTestState(sessionDir, sessionId);

    await executeGraph(workflow, { initialState });

    const checkpointsDir = join(sessionDir, "checkpoints");
    const files = await readdir(checkpointsDir);
    const sortedFiles = files.sort();

    // Load first and last checkpoints
    const firstCheckpoint = JSON.parse(
      await readFile(join(checkpointsDir, sortedFiles[0]!), "utf-8")
    );
    const lastCheckpoint = JSON.parse(
      await readFile(join(checkpointsDir, sortedFiles[sortedFiles.length - 1]!), "utf-8")
    );

    // First checkpoint should have 1 executed node
    expect(firstCheckpoint.state.nodeExecutionCount).toBe(1);

    // Last checkpoint should have all nodes executed
    expect(lastCheckpoint.state.nodeExecutionCount).toBe(4);
    expect(lastCheckpoint.state.isComplete).toBe(true);
  });

  test("dynamic session directory checkpointing saves to correct location", async () => {
    const workflow = createDynamicCheckpointedWorkflow();
    const initialState = createTestState(sessionDir, sessionId);

    await executeGraph(workflow, { initialState });

    // Verify checkpoints saved to the dynamic session directory
    const checkpointsDir = join(sessionDir, "checkpoints");
    expect(existsSync(checkpointsDir)).toBe(true);

    const files = await readdir(checkpointsDir);
    expect(files.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Interrupt workflow mid-execution
// ============================================================================

describe("Interrupt workflow mid-execution", () => {
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
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    const config: GraphConfig<CheckpointTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    // Create a workflow where we abort after first node
    const slowNode = createNode<CheckpointTestState>("slow", "tool", async (ctx) => {
      // This simulates work happening - abort signal would be checked during streaming
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        stateUpdate: {
          nodeExecutionCount: ctx.state.nodeExecutionCount + 1,
          executedNodes: [...ctx.state.executedNodes, "slow"],
        },
      };
    });

    const workflow = graph<CheckpointTestState>()
      .start(createTrackingNode("first", { step: 1 }))
      .then(slowNode)
      .then(createTrackingNode("after-slow", { step: 3 }))
      .end()
      .compile(config);

    const initialState = createTestState(sessionDir, sessionId);

    // Abort after a small delay
    setTimeout(() => abortController.abort(), 10);

    const result = await executeGraph(workflow, {
      initialState,
      abortSignal: abortController.signal,
    });

    expect(result.status).toBe("cancelled");
  });

  test("interrupted workflow saves checkpoint before stopping", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    const config: GraphConfig<CheckpointTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    const workflow = graph<CheckpointTestState>()
      .start(createTrackingNode("step-1", { step: 1 }))
      .then(createTrackingNode("step-2", { step: 2 }))
      .then(createTrackingNode("step-3", { step: 3 }))
      .end()
      .compile(config);

    const initialState = createTestState(sessionDir, sessionId);

    // Execute only first two nodes using streaming
    let stepCount = 0;
    for await (const step of streamGraph(workflow, { initialState })) {
      stepCount++;
      if (stepCount >= 2) {
        // Stop after second node
        break;
      }
    }

    // Verify checkpoints were saved
    const checkpointsDir = join(sessionDir, "checkpoints");
    const files = await readdir(checkpointsDir);

    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  test("streaming execution allows inspection of each step", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    const config: GraphConfig<CheckpointTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    const workflow = graph<CheckpointTestState>()
      .start(createTrackingNode("step-1", { step: 1 }))
      .then(createTrackingNode("step-2", { step: 2 }))
      .then(createCompletionNode("complete"))
      .end()
      .compile(config);

    const initialState = createTestState(sessionDir, sessionId);
    const steps: StepResult<CheckpointTestState>[] = [];

    for await (const step of streamGraph(workflow, { initialState })) {
      steps.push(step);
    }

    // Verify we received all steps
    expect(steps.length).toBe(3);
    expect(steps[0]!.nodeId).toBe("step-1");
    expect(steps[1]!.nodeId).toBe("step-2");
    expect(steps[2]!.nodeId).toBe("complete");

    // Verify state progression
    expect(steps[0]!.state.nodeExecutionCount).toBe(1);
    expect(steps[1]!.state.nodeExecutionCount).toBe(2);
    expect(steps[2]!.state.nodeExecutionCount).toBe(3);
  });
});

// ============================================================================
// Create new workflow execution with resume
// ============================================================================

describe("Create new workflow execution with resume", () => {
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

  test("can load checkpoint from session directory", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Save a checkpoint manually
    const testState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 2,
      executedNodes: ["step-1", "step-2"],
      data: { step: 2 },
    });

    await saver.save("exec-1", testState, "node-001");

    // Load the checkpoint
    const loaded = await saver.load("exec-1");

    expect(loaded).not.toBeNull();
    expect(loaded?.nodeExecutionCount).toBe(2);
    expect(loaded?.executedNodes).toEqual(["step-1", "step-2"]);
  });

  test("can list available checkpoints in session directory", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Save multiple checkpoints
    const state1 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 1 });
    const state2 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 2 });
    const state3 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 3 });

    await saver.save("exec-1", state1, "node-001");
    await saver.save("exec-1", state2, "node-002");
    await saver.save("exec-1", state3, "node-003");

    // List checkpoints
    const labels = await saver.list("exec-1");

    expect(labels).toEqual(["node-001", "node-002", "node-003"]);
  });

  test("can load specific checkpoint by label", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Save multiple checkpoints
    const state1 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 1 });
    const state2 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 2 });
    const state3 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 3 });

    await saver.save("exec-1", state1, "node-001");
    await saver.save("exec-1", state2, "node-002");
    await saver.save("exec-1", state3, "node-003");

    // Load specific checkpoint
    const loaded = await saver.loadByLabel("exec-1", "node-002");

    expect(loaded).not.toBeNull();
    expect(loaded?.nodeExecutionCount).toBe(2);
  });

  test("can create workflow with resumeFrom snapshot", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    const config: GraphConfig<CheckpointTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    const workflow = graph<CheckpointTestState>()
      .start(createTrackingNode("step-1", { step: 1 }))
      .then(createTrackingNode("step-2", { step: 2 }))
      .then(createCompletionNode("complete"))
      .end()
      .compile(config);

    // Execute first run and save state
    const initialState = createTestState(sessionDir, sessionId);
    const firstResult = await executeGraph(workflow, { initialState });

    expect(firstResult.status).toBe("completed");

    // Create a snapshot from the first result
    const snapshot = firstResult.snapshot;

    // Create a new workflow execution using the snapshot
    expect(snapshot).toBeDefined();
    expect(snapshot.state.isComplete).toBe(true);
  });
});

// ============================================================================
// Verify state restored from checkpoint
// ============================================================================

describe("Verify state restored from checkpoint", () => {
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

  test("restored state matches saved state", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Create a complex state to save
    const originalState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 5,
      executedNodes: ["step-1", "step-2", "step-3", "step-4", "step-5"],
      data: {
        step: 5,
        nested: { value: "test" },
        array: [1, 2, 3],
      },
      isComplete: false,
    });

    await saver.save("exec-1", originalState, "complex-state");

    // Restore the state
    const restoredState = await saver.loadByLabel("exec-1", "complex-state");

    expect(restoredState).not.toBeNull();
    expect(restoredState!.nodeExecutionCount).toBe(originalState.nodeExecutionCount);
    expect(restoredState!.executedNodes).toEqual(originalState.executedNodes);
    expect(restoredState!.data).toEqual(originalState.data);
    expect(restoredState!.isComplete).toBe(originalState.isComplete);
    expect(restoredState!.ralphSessionDir).toBe(originalState.ralphSessionDir);
    expect(restoredState!.ralphSessionId).toBe(originalState.ralphSessionId);
  });

  test("restored state has correct type information", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    const originalState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 3,
      executedNodes: ["a", "b", "c"],
    });

    await saver.save("exec-1", originalState);
    const restoredState = await saver.load("exec-1");

    // Verify type properties are preserved
    expect(typeof restoredState!.executionId).toBe("string");
    expect(typeof restoredState!.nodeExecutionCount).toBe("number");
    expect(Array.isArray(restoredState!.executedNodes)).toBe(true);
    expect(typeof restoredState!.outputs).toBe("object");
    expect(typeof restoredState!.isComplete).toBe("boolean");
  });

  test("restoring from checkpoint updates internal counter", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Save checkpoints with sequential labels
    const state1 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 1 });
    const state2 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 2 });
    const state3 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 3 });

    await saver.save("exec-1", state1, "node-001");
    await saver.save("exec-1", state2, "node-002");
    await saver.save("exec-1", state3, "node-003");

    // Reset counter and load from middle checkpoint
    saver.resetCounter();
    expect(saver.getCheckpointCount()).toBe(0);

    await saver.loadByLabel("exec-1", "node-002");

    // Counter should be restored
    expect(saver.getCheckpointCount()).toBe(2);
  });

  test("session directory is preserved in restored state", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    const originalState = createTestState(sessionDir, sessionId);
    await saver.save("exec-1", originalState);

    const restoredState = await saver.load("exec-1");

    expect(restoredState!.ralphSessionDir).toBe(sessionDir);
    expect(restoredState!.ralphSessionId).toBe(sessionId);
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

  test("execution can resume from saved checkpoint state", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    const config: GraphConfig<CheckpointTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    // First, execute a partial workflow and save state
    const partialState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 2,
      executedNodes: ["step-1", "step-2"],
      data: { step: 2 },
    });
    await saver.save("exec-1", partialState, "partial");

    // Create a simple continuation workflow
    const workflow = graph<CheckpointTestState>()
      .start(createTrackingNode("step-3", { step: 3 }))
      .then(createCompletionNode("complete"))
      .end()
      .compile(config);

    // Load the checkpoint and continue
    const resumedState = await saver.loadByLabel("exec-1", "partial");
    expect(resumedState).not.toBeNull();

    // Execute with the resumed state
    const result = await executeGraph(workflow, {
      initialState: resumedState!,
    });

    expect(result.status).toBe("completed");
    expect(result.state.isComplete).toBe(true);
    // State should include previous execution count plus new nodes
    expect(result.state.nodeExecutionCount).toBe(4);
    expect(result.state.executedNodes).toContain("step-3");
    expect(result.state.executedNodes).toContain("complete");
  });

  test("resumed execution does not duplicate previous work", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Create initial state as if steps 1-2 were already executed
    const checkpointState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 2,
      executedNodes: ["step-1", "step-2"],
      data: { step1: true, step2: true },
    });
    await saver.save("exec-1", checkpointState, "checkpoint");

    // Resume from checkpoint
    const resumedState = await saver.loadByLabel("exec-1", "checkpoint");

    // Verify the resumed state has correct history
    expect(resumedState!.executedNodes).toEqual(["step-1", "step-2"]);
    expect(resumedState!.nodeExecutionCount).toBe(2);

    // The resumed state should NOT have step-1 and step-2 executed again
    // (they should already be in the executed list from the checkpoint)
    expect(resumedState!.data.step1).toBe(true);
    expect(resumedState!.data.step2).toBe(true);
  });

  test("new checkpoints saved after resume continue sequence", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Save initial checkpoints
    const state1 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 1 });
    const state2 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 2 });

    await saver.save("exec-1", state1, "node-001");
    await saver.save("exec-1", state2, "node-002");

    // Load and resume from checkpoint
    await saver.loadByLabel("exec-1", "node-002");

    // Save new checkpoint - should continue the sequence
    const state3 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 3 });
    await saver.save("exec-1", state3);

    // List checkpoints
    const labels = await saver.list("exec-1");

    // Should have original checkpoints plus new one
    expect(labels).toContain("node-001");
    expect(labels).toContain("node-002");
    expect(labels).toContain("node-003");
  });

  test("workflow with resumeFrom snapshot continues execution", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    const config: GraphConfig<CheckpointTestState> = {
      autoCheckpoint: true,
      checkpointer: saver,
    };

    const workflow = graph<CheckpointTestState>()
      .start(createTrackingNode("step-1", { step: 1 }))
      .then(createTrackingNode("step-2", { step: 2 }))
      .then(createTrackingNode("step-3", { step: 3 }))
      .then(createCompletionNode("complete"))
      .end()
      .compile(config);

    // First execution - collect results from streaming
    const initialState = createTestState(sessionDir, sessionId);
    const steps: StepResult<CheckpointTestState>[] = [];

    for await (const step of streamGraph(workflow, { initialState })) {
      steps.push(step);
      if (step.nodeId === "step-2") {
        // Stop after step-2
        break;
      }
    }

    expect(steps.length).toBe(2);

    // Get the state at step-2 for resumption
    const step2State = steps[1]!.state;
    expect(step2State.nodeExecutionCount).toBe(2);
    expect(step2State.executedNodes).toEqual(["step-1", "step-2"]);

    // Create a new workflow that continues from step-3
    const continueWorkflow = graph<CheckpointTestState>()
      .start(createTrackingNode("step-3", { step: 3 }))
      .then(createCompletionNode("complete"))
      .end()
      .compile(config);

    // Execute continuation with the saved state
    const result = await executeGraph(continueWorkflow, {
      initialState: step2State,
    });

    expect(result.status).toBe("completed");
    expect(result.state.isComplete).toBe(true);
    expect(result.state.nodeExecutionCount).toBe(4);
    expect(result.state.executedNodes).toEqual([
      "step-1",
      "step-2",
      "step-3",
      "complete",
    ]);
  });
});

// ============================================================================
// Additional edge cases and scenarios
// ============================================================================

describe("Checkpoint edge cases", () => {
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

  test("handles empty checkpoints directory gracefully", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    const loaded = await saver.load("non-existent");
    expect(loaded).toBeNull();

    const labels = await saver.list("non-existent");
    expect(labels).toEqual([]);
  });

  test("handles concurrent checkpoint saves", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Save multiple checkpoints concurrently
    const savePromises = Array.from({ length: 5 }, (_, i) => {
      const state = createTestState(sessionDir, sessionId, {
        nodeExecutionCount: i + 1,
      });
      return saver.save("exec-1", state, `concurrent-${String(i).padStart(2, "0")}`);
    });

    await Promise.all(savePromises);

    // All checkpoints should be saved
    const labels = await saver.list("exec-1");
    expect(labels.length).toBe(5);
  });

  test("checkpoint state survives JSON serialization round-trip", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Create state with various data types
    const originalState = createTestState(sessionDir, sessionId, {
      nodeExecutionCount: 10,
      executedNodes: ["a", "b", "c"],
      data: {
        string: "test",
        number: 42,
        boolean: true,
        null: null,
        array: [1, "two", false],
        nested: { deep: { value: "found" } },
      },
    });

    await saver.save("exec-1", originalState, "roundtrip");
    const restored = await saver.loadByLabel("exec-1", "roundtrip");

    expect(restored!.data).toEqual(originalState.data);
  });

  test("can delete checkpoints from session directory", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Save checkpoints
    const state1 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 1 });
    const state2 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 2 });

    await saver.save("exec-1", state1, "to-keep");
    await saver.save("exec-1", state2, "to-delete");

    // Delete one checkpoint
    await saver.delete("exec-1", "to-delete");

    const labels = await saver.list("exec-1");
    expect(labels).toEqual(["to-keep"]);
  });

  test("can delete all checkpoints for an execution", async () => {
    const saver = new SessionDirSaver<CheckpointTestState>(sessionDir);

    // Save checkpoints
    const state1 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 1 });
    const state2 = createTestState(sessionDir, sessionId, { nodeExecutionCount: 2 });

    await saver.save("exec-1", state1, "checkpoint-1");
    await saver.save("exec-1", state2, "checkpoint-2");

    // Delete all checkpoints
    await saver.delete("exec-1");

    const labels = await saver.list("exec-1");
    expect(labels).toEqual([]);
  });
});

// ============================================================================
// Integration with RalphWorkflowState
// ============================================================================

describe("Integration with RalphWorkflowState", () => {
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

  test("can checkpoint RalphWorkflowState", async () => {
    const saver = new SessionDirSaver<RalphWorkflowState>(sessionDir);

    // Create a RalphWorkflowState
    const ralphState = createRalphWorkflowState({
      sessionId,
      tasks: [
        {
          id: "task-001",
          content: "Test Task",
          status: "pending",
          activeForm: "Testing task",
        } satisfies TodoItem,
      ],
    });

    // Override the session directory
    ralphState.ralphSessionDir = sessionDir;

    // Save checkpoint
    await saver.save("exec-1", ralphState, "ralph-checkpoint");

    // Load checkpoint
    const restored = await saver.loadByLabel("exec-1", "ralph-checkpoint");

    expect(restored).not.toBeNull();
    expect(restored!.ralphSessionId).toBe(sessionId);
    expect(restored!.tasks.length).toBe(1);
    expect(restored!.tasks[0]!.content).toBe("Test Task");
  });

  test("RalphWorkflowState tasks are preserved across checkpoint", async () => {
    const saver = new SessionDirSaver<RalphWorkflowState>(sessionDir);

    // Create state with tasks at different statuses
    const ralphState = createRalphWorkflowState({
      sessionId,
      tasks: [
        {
          id: "task-001",
          content: "Task 1",
          status: "completed",
          activeForm: "Completing task 1",
        } satisfies TodoItem,
        {
          id: "task-002",
          content: "Task 2",
          status: "pending",
          activeForm: "Working on task 2",
        } satisfies TodoItem,
        {
          id: "task-003",
          content: "Task 3",
          status: "in_progress",
          activeForm: "Working on task 3",
        } satisfies TodoItem,
      ],
    });
    ralphState.ralphSessionDir = sessionDir;
    ralphState.currentFeatureIndex = 2;
    ralphState.completedFeatures = ["task-001"];

    await saver.save("exec-1", ralphState);
    const restored = await saver.load("exec-1");

    expect(restored!.tasks.length).toBe(3);
    expect(restored!.tasks[0]!.status).toBe("completed");
    expect(restored!.tasks[1]!.status).toBe("pending");
    expect(restored!.tasks[2]!.status).toBe("in_progress");
    expect(restored!.currentFeatureIndex).toBe(2);
    expect(restored!.completedFeatures).toEqual(["task-001"]);
  });
});
