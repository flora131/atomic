/**
 * Unit tests for graph telemetry integration
 *
 * Tests cover:
 * - createProgressHandler for tracking node events
 * - withGraphTelemetry wrapper
 * - trackGraphExecution factory
 * - withExecutionTracking convenience wrapper
 * - withCheckpointTelemetry for checkpoint operations
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createProgressHandler,
  withGraphTelemetry,
  trackGraphExecution,
  withExecutionTracking,
  withCheckpointTelemetry,
  trackWorkflowExecution,
  withWorkflowTelemetry,
  type GraphTelemetryConfig,
  type ExecutionTracker,
  type WorkflowTracker,
  type WorkflowTelemetryConfig,
} from "../../src/telemetry/graph-integration.ts";
import {
  setGlobalCollector,
  resetGlobalCollector,
} from "../../src/telemetry/collector.ts";
import type { TelemetryCollector } from "../../src/telemetry/types.ts";
import type {
  BaseState,
  ProgressEvent,
  GraphConfig,
  Checkpointer,
} from "../../src/graph/types.ts";

// ============================================================================
// Test Helpers
// ============================================================================

interface TrackedEvent {
  eventType: string;
  properties: Record<string, unknown>;
  options?: { executionId?: string; sessionId?: string };
}

/**
 * Create a mock collector that tracks events.
 */
function createTrackingCollector(): {
  collector: TelemetryCollector;
  events: TrackedEvent[];
  getEvent: (index: number) => TrackedEvent;
  clear: () => void;
} {
  const events: TrackedEvent[] = [];

  const collector: TelemetryCollector = {
    track(eventType, properties = {}, options) {
      events.push({ eventType, properties: properties as Record<string, unknown>, options });
    },
    async flush() {
      return { eventCount: events.length, localLogSuccess: true, remoteSuccess: true };
    },
    isEnabled() {
      return true;
    },
    async shutdown() {},
    getBufferSize() {
      return events.length;
    },
    getConfig() {
      return { enabled: true };
    },
  };

  const getEvent = (index: number): TrackedEvent => {
    const event = events[index];
    if (!event) throw new Error(`No event at index ${index}`);
    return event;
  };

  const clear = () => {
    events.length = 0;
  };

  return { collector, events, getEvent, clear };
}

/**
 * Create a valid BaseState for testing.
 */
function createBaseState(): BaseState {
  return {
    executionId: "test-exec",
    lastUpdated: new Date().toISOString(),
    outputs: {},
  };
}

/**
 * Create a valid ProgressEvent for testing.
 */
function createProgressEvent<TState extends BaseState>(
  type: ProgressEvent<TState>["type"],
  nodeId: string,
  state: TState,
  error?: ProgressEvent<TState>["error"]
): ProgressEvent<TState> {
  return {
    type,
    nodeId,
    state,
    timestamp: new Date().toISOString(),
    error,
  };
}

/**
 * Create a mock checkpointer for testing.
 */
function createMockCheckpointer(): Checkpointer<BaseState> {
  const storage = new Map<string, { state: BaseState; label?: string }>();

  return {
    async save(executionId: string, state: BaseState, label?: string): Promise<void> {
      storage.set(`${executionId}:${label ?? "latest"}`, { state, label });
    },
    async load(executionId: string): Promise<BaseState | null> {
      const entry = storage.get(`${executionId}:latest`);
      return entry?.state ?? null;
    },
    async list(executionId: string): Promise<string[]> {
      return Array.from(storage.keys())
        .filter((key) => key.startsWith(`${executionId}:`))
        .map((key) => key.split(":")[1]!);
    },
    async delete(executionId: string, label?: string): Promise<void> {
      storage.delete(`${executionId}:${label ?? "latest"}`);
    },
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  resetGlobalCollector();
});

afterEach(() => {
  resetGlobalCollector();
});

// ============================================================================
// createProgressHandler Tests
// ============================================================================

describe("createProgressHandler", () => {
  test("tracks node_started events", () => {
    const { collector, events } = createTrackingCollector();
    const handler = createProgressHandler<BaseState>(collector, "exec-123");

    handler(createProgressEvent("node_started", "node-1", createBaseState()));

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.node.started");
    expect(events[0]!.properties.nodeId).toBe("node-1");
    expect(events[0]!.options?.executionId).toBe("exec-123");
  });

  test("tracks node_completed events", () => {
    const { collector, events } = createTrackingCollector();
    const handler = createProgressHandler<BaseState>(collector, "exec-456");

    handler(createProgressEvent("node_completed", "node-2", createBaseState()));

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.node.completed");
    expect(events[0]!.properties.nodeId).toBe("node-2");
    expect(events[0]!.options?.executionId).toBe("exec-456");
  });

  test("tracks node_error events with Error object", () => {
    const { collector, events } = createTrackingCollector();
    const handler = createProgressHandler<BaseState>(collector, "exec-789");

    handler(createProgressEvent("node_error", "node-3", createBaseState(), {
      error: new Error("Node processing failed"),
      nodeId: "node-3",
      timestamp: new Date().toISOString(),
      attempt: 1,
    }));

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.node.failed");
    expect(events[0]!.properties.nodeId).toBe("node-3");
    expect(events[0]!.properties.errorMessage).toBe("Node processing failed");
  });

  test("tracks node_error events with string error", () => {
    const { collector, events } = createTrackingCollector();
    const handler = createProgressHandler<BaseState>(collector, "exec-abc");

    handler(createProgressEvent("node_error", "node-4", createBaseState(), {
      error: "String error message",
      nodeId: "node-4",
      timestamp: new Date().toISOString(),
      attempt: 1,
    }));

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.node.failed");
    expect(events[0]!.properties.errorMessage).toBe("String error message");
  });

  test("tracks checkpoint_saved events", () => {
    const { collector, events } = createTrackingCollector();
    const handler = createProgressHandler<BaseState>(collector, "exec-def");

    handler(createProgressEvent("checkpoint_saved", "checkpoint-node", createBaseState()));

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.checkpoint.saved");
    expect(events[0]!.properties.nodeId).toBe("checkpoint-node");
  });

  test("skips node events when trackNodes is false", () => {
    const { collector, events } = createTrackingCollector();
    const handler = createProgressHandler<BaseState>(collector, "exec-123", {
      trackNodes: false,
    });

    handler(createProgressEvent("node_started", "node-1", createBaseState()));
    handler(createProgressEvent("node_completed", "node-1", createBaseState()));

    expect(events.length).toBe(0);
  });

  test("skips checkpoint events when trackCheckpoints is false", () => {
    const { collector, events } = createTrackingCollector();
    const handler = createProgressHandler<BaseState>(collector, "exec-123", {
      trackCheckpoints: false,
    });

    handler(createProgressEvent("checkpoint_saved", "node-1", createBaseState()));

    expect(events.length).toBe(0);
  });

  test("includes additional properties in events", () => {
    const { collector, events } = createTrackingCollector();
    const handler = createProgressHandler<BaseState>(collector, "exec-123", {
      additionalProperties: {
        nodeCount: 5,
        status: "running",
      },
    });

    handler(createProgressEvent("node_started", "node-1", createBaseState()));

    expect(events[0]!.properties.nodeCount).toBe(5);
    expect(events[0]!.properties.status).toBe("running");
    expect(events[0]!.properties.nodeId).toBe("node-1");
  });
});

// ============================================================================
// withGraphTelemetry Tests
// ============================================================================

describe("withGraphTelemetry", () => {
  test("returns config with onProgress handler", () => {
    const { collector } = createTrackingCollector();
    const config = withGraphTelemetry<BaseState>({}, { collector });

    expect(config.onProgress).toBeDefined();
    expect(typeof config.onProgress).toBe("function");
  });

  test("preserves existing config properties", () => {
    const { collector } = createTrackingCollector();
    const checkpointer = createMockCheckpointer();
    
    const config = withGraphTelemetry<BaseState>(
      {
        checkpointer,
        autoCheckpoint: true,
        maxConcurrency: 4,
      },
      { collector }
    );

    expect(config.checkpointer).toBe(checkpointer);
    expect(config.autoCheckpoint).toBe(true);
    expect(config.maxConcurrency).toBe(4);
  });

  test("adds executionId to metadata", () => {
    const { collector } = createTrackingCollector();
    const config = withGraphTelemetry<BaseState>({}, { collector });

    expect(config.metadata?.executionId).toBeDefined();
    expect(typeof config.metadata?.executionId).toBe("string");
  });

  test("preserves existing executionId from metadata", () => {
    const { collector } = createTrackingCollector();
    const config = withGraphTelemetry<BaseState>(
      {
        metadata: { executionId: "custom-exec-id" },
      },
      { collector }
    );

    expect(config.metadata?.executionId).toBe("custom-exec-id");
  });

  test("combines with existing onProgress handler", () => {
    const { collector, events } = createTrackingCollector();
    let existingHandlerCalled = false;

    const config = withGraphTelemetry<BaseState>(
      {
        onProgress: () => {
          existingHandlerCalled = true;
        },
      },
      { collector }
    );

    config.onProgress!(createProgressEvent("node_started", "test-node", createBaseState()));

    expect(events.length).toBe(1);
    expect(existingHandlerCalled).toBe(true);
  });

  test("uses global collector when not provided", () => {
    const { collector, events } = createTrackingCollector();
    setGlobalCollector(collector);

    const config = withGraphTelemetry<BaseState>();

    config.onProgress!(createProgressEvent("node_started", "test-node", createBaseState()));

    expect(events.length).toBe(1);
  });
});

// ============================================================================
// trackGraphExecution Tests
// ============================================================================

describe("trackGraphExecution", () => {
  test("started() tracks execution start", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-start", { collector });

    tracker.started({ nodeCount: 10 });

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.execution.started");
    expect(events[0]!.properties.nodeCount).toBe(10);
    expect(events[0]!.options?.executionId).toBe("exec-start");
  });

  test("completed() tracks successful completion", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-complete", { collector });

    tracker.completed({
      completedNodeCount: 5,
      nodeCount: 5,
    });

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.execution.completed");
    expect(events[0]!.properties.status).toBe("completed");
    expect(events[0]!.properties.completedNodeCount).toBe(5);
    expect(events[0]!.properties.nodeCount).toBe(5);
  });

  test("failed() tracks execution failure", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-fail", { collector });

    tracker.failed("Timeout exceeded", "slow-node");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.execution.failed");
    expect(events[0]!.properties.status).toBe("failed");
    expect(events[0]!.properties.errorMessage).toBe("Timeout exceeded");
    expect(events[0]!.properties.nodeId).toBe("slow-node");
  });

  test("checkpointSaved() tracks checkpoint operations", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-checkpoint", { collector });

    tracker.checkpointSaved("iteration-5");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.checkpoint.saved");
    expect(events[0]!.properties.checkpointLabel).toBe("iteration-5");
  });

  test("checkpointLoaded() tracks checkpoint loading", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-load", { collector });

    tracker.checkpointLoaded("latest");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.checkpoint.loaded");
    expect(events[0]!.properties.checkpointLabel).toBe("latest");
  });

  test("nodeStarted() tracks node start", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-node", { collector });

    tracker.nodeStarted("planning-node", "agent");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.node.started");
    expect(events[0]!.properties.nodeId).toBe("planning-node");
    expect(events[0]!.properties.nodeType).toBe("agent");
  });

  test("nodeCompleted() tracks node completion with duration", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-node", { collector });

    tracker.nodeCompleted("task-node", "tool", 1500);

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.node.completed");
    expect(events[0]!.properties.nodeId).toBe("task-node");
    expect(events[0]!.properties.nodeType).toBe("tool");
    expect(events[0]!.properties.durationMs).toBe(1500);
  });

  test("nodeFailed() tracks node failure", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-node", { collector });

    tracker.nodeFailed("error-node", "Connection failed", "tool");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.node.failed");
    expect(events[0]!.properties.nodeId).toBe("error-node");
    expect(events[0]!.properties.errorMessage).toBe("Connection failed");
    expect(events[0]!.properties.nodeType).toBe("tool");
  });

  test("nodeRetried() tracks retry attempts", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-retry", { collector });

    tracker.nodeRetried("flaky-node", 3);

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.node.retried");
    expect(events[0]!.properties.nodeId).toBe("flaky-node");
    expect(events[0]!.properties.retryAttempt).toBe(3);
  });

  test("skips node events when trackNodes is false", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-skip", {
      collector,
      trackNodes: false,
    });

    tracker.nodeStarted("node-1", "agent");
    tracker.nodeCompleted("node-1", "agent", 100);
    tracker.nodeFailed("node-2", "error", "tool");
    tracker.nodeRetried("node-3", 1);

    expect(events.length).toBe(0);
  });

  test("skips checkpoint events when trackCheckpoints is false", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-skip", {
      collector,
      trackCheckpoints: false,
    });

    tracker.checkpointSaved("checkpoint-1");
    tracker.checkpointLoaded("checkpoint-1");

    expect(events.length).toBe(0);
  });

  test("includes additional properties in all events", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackGraphExecution("exec-props", {
      collector,
      additionalProperties: {
        status: "test",
        nodeCount: 10,
      },
    });

    tracker.started();
    tracker.nodeStarted("node-1", "agent");
    tracker.completed();

    expect(events.length).toBe(3);
    for (const event of events) {
      expect(event.properties.nodeCount).toBe(10);
    }
  });
});

// ============================================================================
// withExecutionTracking Tests
// ============================================================================

describe("withExecutionTracking", () => {
  test("tracks started and completed on success", async () => {
    const { collector, events } = createTrackingCollector();

    const result = await withExecutionTracking(
      "exec-success",
      async () => {
        return "success result";
      },
      { collector }
    );

    expect(result).toBe("success result");
    expect(events.length).toBe(2);
    expect(events[0]!.eventType).toBe("graph.execution.started");
    expect(events[1]!.eventType).toBe("graph.execution.completed");
    expect(events[1]!.properties.status).toBe("completed");
    expect(events[1]!.properties.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("tracks started and failed on error", async () => {
    const { collector, events } = createTrackingCollector();

    try {
      await withExecutionTracking(
        "exec-error",
        async () => {
          throw new Error("Execution failed");
        },
        { collector }
      );
    } catch (error) {
      // Expected
    }

    expect(events.length).toBe(2);
    expect(events[0]!.eventType).toBe("graph.execution.started");
    expect(events[1]!.eventType).toBe("graph.execution.failed");
    expect(events[1]!.properties.status).toBe("failed");
    expect(events[1]!.properties.errorMessage).toBe("Execution failed");
  });

  test("provides tracker to the function", async () => {
    const { collector, events } = createTrackingCollector();

    await withExecutionTracking(
      "exec-tracker",
      async (tracker) => {
        tracker.nodeStarted("inner-node", "agent");
        tracker.nodeCompleted("inner-node", "agent", 50);
        return true;
      },
      { collector }
    );

    // started + nodeStarted + nodeCompleted + completed
    expect(events.length).toBe(4);
    expect(events[1]!.eventType).toBe("graph.node.started");
    expect(events[2]!.eventType).toBe("graph.node.completed");
  });

  test("rethrows errors after tracking", async () => {
    const { collector } = createTrackingCollector();

    await expect(
      withExecutionTracking(
        "exec-rethrow",
        async () => {
          throw new Error("Must propagate");
        },
        { collector }
      )
    ).rejects.toThrow("Must propagate");
  });

  test("handles non-Error throws", async () => {
    const { collector, events } = createTrackingCollector();

    try {
      await withExecutionTracking(
        "exec-string-error",
        async () => {
          throw "String error";
        },
        { collector }
      );
    } catch {
      // Expected
    }

    expect(events[1]!.properties.errorMessage).toBe("String error");
  });
});

// ============================================================================
// withCheckpointTelemetry Tests
// ============================================================================

describe("withCheckpointTelemetry", () => {
  test("wraps checkpointer and tracks save operations", async () => {
    const { collector, events } = createTrackingCollector();
    const checkpointer = createMockCheckpointer();

    const wrapped = withCheckpointTelemetry(checkpointer, "exec-save", { collector });

    await wrapped.save("exec-save", createBaseState(), "checkpoint-1");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.checkpoint.saved");
    expect(events[0]!.properties.checkpointLabel).toBe("checkpoint-1");
  });

  test("uses 'auto' label when no label provided", async () => {
    const { collector, events } = createTrackingCollector();
    const checkpointer = createMockCheckpointer();

    const wrapped = withCheckpointTelemetry(checkpointer, "exec-auto", { collector });

    await wrapped.save("exec-auto", createBaseState());

    expect(events[0]!.properties.checkpointLabel).toBe("auto");
  });

  test("tracks load operations when state is found", async () => {
    const { collector, events } = createTrackingCollector();
    const checkpointer = createMockCheckpointer();

    // Save first
    const state = createBaseState();
    await checkpointer.save("exec-load", state, "latest");

    const wrapped = withCheckpointTelemetry(checkpointer, "exec-load", { collector });

    const loadedState = await wrapped.load("exec-load");

    expect(loadedState).not.toBeNull();
    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("graph.checkpoint.loaded");
    expect(events[0]!.properties.checkpointLabel).toBe("latest");
  });

  test("does not track load when state not found", async () => {
    const { collector, events } = createTrackingCollector();
    const checkpointer = createMockCheckpointer();

    const wrapped = withCheckpointTelemetry(checkpointer, "exec-empty", { collector });

    const state = await wrapped.load("nonexistent");

    expect(state).toBeNull();
    expect(events.length).toBe(0);
  });

  test("passes through list operation", async () => {
    const { collector } = createTrackingCollector();
    const checkpointer = createMockCheckpointer();

    await checkpointer.save("exec-list", createBaseState(), "cp-1");
    await checkpointer.save("exec-list", createBaseState(), "cp-2");

    const wrapped = withCheckpointTelemetry(checkpointer, "exec-list", { collector });

    const labels = await wrapped.list("exec-list");

    expect(labels.length).toBe(2);
    expect(labels).toContain("cp-1");
    expect(labels).toContain("cp-2");
  });

  test("passes through delete operation", async () => {
    const { collector } = createTrackingCollector();
    const checkpointer = createMockCheckpointer();

    await checkpointer.save("exec-delete", createBaseState(), "to-delete");

    const wrapped = withCheckpointTelemetry(checkpointer, "exec-delete", { collector });

    await wrapped.delete("exec-delete", "to-delete");

    const state = await checkpointer.load("exec-delete");
    expect(state).toBeNull();
  });

  test("skips tracking when trackCheckpoints is false", async () => {
    const { collector, events } = createTrackingCollector();
    const checkpointer = createMockCheckpointer();

    const wrapped = withCheckpointTelemetry(checkpointer, "exec-skip", {
      collector,
      trackCheckpoints: false,
    });

    await wrapped.save("exec-skip", createBaseState(), "skipped");

    // Still saves, but doesn't track
    expect(events.length).toBe(0);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration", () => {
  test("full workflow tracking scenario", async () => {
    const { collector, events } = createTrackingCollector();

    const result = await withExecutionTracking(
      "workflow-full",
      async (tracker) => {
        // Simulate a workflow with multiple nodes
        tracker.nodeStarted("planner", "agent");
        await new Promise((r) => setTimeout(r, 10));
        tracker.nodeCompleted("planner", "agent", 10);

        tracker.nodeStarted("executor", "tool");
        await new Promise((r) => setTimeout(r, 10));
        tracker.nodeCompleted("executor", "tool", 10);

        tracker.checkpointSaved("after-execution");

        tracker.nodeStarted("validator", "agent");
        await new Promise((r) => setTimeout(r, 10));
        tracker.nodeCompleted("validator", "agent", 10);

        return { success: true, nodesCompleted: 3 };
      },
      {
        collector,
        additionalProperties: { nodeCount: 3 },
      }
    );

    expect(result.nodesCompleted).toBe(3);
    
    // started + 3*(nodeStarted + nodeCompleted) + checkpointSaved + completed
    expect(events.length).toBe(9);

    // Verify event sequence - order:
    // 0: started
    // 1-2: planner node (started, completed)
    // 3-4: executor node (started, completed)
    // 5: checkpoint saved
    // 6-7: validator node (started, completed)
    // 8: completed
    expect(events[0]!.eventType).toBe("graph.execution.started");
    expect(events[1]!.eventType).toBe("graph.node.started");
    expect(events[2]!.eventType).toBe("graph.node.completed");
    expect(events[5]!.eventType).toBe("graph.checkpoint.saved");
    expect(events[8]!.eventType).toBe("graph.execution.completed");

    // Verify additional properties are on all events
    for (const event of events) {
      expect(event.properties.nodeCount).toBe(3);
    }
  });

  test("withGraphTelemetry config integrates with progress handler", () => {
    const { collector, events } = createTrackingCollector();

    const config = withGraphTelemetry<BaseState>(
      {
        maxConcurrency: 4,
        autoCheckpoint: true,
      },
      {
        collector,
        additionalProperties: { nodeCount: 10 },
      }
    );

    // Simulate graph emitting progress events
    const progressHandler = config.onProgress!;

    progressHandler(createProgressEvent("node_started", "start-node", createBaseState()));
    progressHandler(createProgressEvent("node_completed", "start-node", createBaseState()));
    progressHandler(createProgressEvent("checkpoint_saved", "checkpoint", createBaseState()));

    expect(events.length).toBe(3);
    expect(events[0]!.properties.nodeCount).toBe(10);
    expect(events[1]!.properties.nodeCount).toBe(10);
    expect(events[2]!.properties.nodeCount).toBe(10);
  });
});

// ============================================================================
// trackWorkflowExecution Tests
// ============================================================================

describe("trackWorkflowExecution", () => {
  test("start() tracks workflow start", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackWorkflowExecution("exec-workflow-start", { collector });

    tracker.start("ralph-workflow", { maxIterations: 100 });

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("workflow.start");
    expect(events[0]!.options?.executionId).toBe("exec-workflow-start");
  });

  test("nodeEnter() tracks node entry", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackWorkflowExecution("exec-node-enter", { collector });

    tracker.nodeEnter("init-session", "ralph_init");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("workflow.node.enter");
    expect(events[0]!.options?.executionId).toBe("exec-node-enter");
  });

  test("nodeExit() tracks node exit with duration", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackWorkflowExecution("exec-node-exit", { collector });

    tracker.nodeExit("implement-feature", "ralph_implement", 1500);

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("workflow.node.exit");
    expect(events[0]!.properties.durationMs).toBe(1500);
    expect(events[0]!.options?.executionId).toBe("exec-node-exit");
  });

  test("complete() tracks workflow completion with success", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackWorkflowExecution("exec-complete-success", { collector });

    tracker.complete(true, 5000);

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("workflow.complete");
    expect(events[0]!.properties.durationMs).toBe(5000);
    expect(events[0]!.options?.executionId).toBe("exec-complete-success");
  });

  test("complete() tracks workflow completion with failure", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackWorkflowExecution("exec-complete-fail", { collector });

    tracker.complete(false, 3000);

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("workflow.complete");
    expect(events[0]!.properties.durationMs).toBe(3000);
  });

  test("error() tracks workflow error", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackWorkflowExecution("exec-error", { collector });

    tracker.error("Feature implementation failed", "implement-node");

    expect(events.length).toBe(1);
    expect(events[0]!.eventType).toBe("workflow.error");
    expect(events[0]!.options?.executionId).toBe("exec-error");
  });

  test("skips node events when trackNodes is false", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackWorkflowExecution("exec-skip-nodes", {
      collector,
      trackNodes: false,
    });

    tracker.nodeEnter("node-1", "agent");
    tracker.nodeExit("node-1", "agent", 100);

    expect(events.length).toBe(0);
  });

  test("includes additional properties in all events", () => {
    const { collector, events } = createTrackingCollector();
    const tracker = trackWorkflowExecution("exec-props", {
      collector,
      additionalProperties: {
        totalFeatures: 5,
        iteration: 1,
      },
    });

    tracker.start("test-workflow", {});
    tracker.nodeEnter("node-1", "agent");
    tracker.complete(true, 100);

    expect(events.length).toBe(3);
    for (const event of events) {
      expect(event.properties.totalFeatures).toBe(5);
      expect(event.properties.iteration).toBe(1);
    }
  });
});

// ============================================================================
// withWorkflowTelemetry Tests
// ============================================================================

describe("withWorkflowTelemetry", () => {
  test("tracks started and completed on success", async () => {
    const { collector, events } = createTrackingCollector();

    const result = await withWorkflowTelemetry(
      "exec-success",
      "test-workflow",
      async () => {
        return "success result";
      },
      { collector }
    );

    expect(result).toBe("success result");
    expect(events.length).toBe(2);
    expect(events[0]!.eventType).toBe("workflow.start");
    expect(events[1]!.eventType).toBe("workflow.complete");
    expect(events[1]!.properties.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("tracks started and failed on error", async () => {
    const { collector, events } = createTrackingCollector();

    try {
      await withWorkflowTelemetry(
        "exec-error",
        "failing-workflow",
        async () => {
          throw new Error("Workflow failed");
        },
        { collector }
      );
    } catch (error) {
      // Expected
    }

    expect(events.length).toBe(3);
    expect(events[0]!.eventType).toBe("workflow.start");
    expect(events[1]!.eventType).toBe("workflow.error");
    expect(events[2]!.eventType).toBe("workflow.complete");
  });

  test("provides tracker to the function", async () => {
    const { collector, events } = createTrackingCollector();

    await withWorkflowTelemetry(
      "exec-tracker",
      "tracked-workflow",
      async (tracker) => {
        tracker.nodeEnter("inner-node", "agent");
        tracker.nodeExit("inner-node", "agent", 50);
        return true;
      },
      { collector }
    );

    // start + nodeEnter + nodeExit + complete
    expect(events.length).toBe(4);
    expect(events[1]!.eventType).toBe("workflow.node.enter");
    expect(events[2]!.eventType).toBe("workflow.node.exit");
  });

  test("rethrows errors after tracking", async () => {
    const { collector } = createTrackingCollector();

    await expect(
      withWorkflowTelemetry(
        "exec-rethrow",
        "error-workflow",
        async () => {
          throw new Error("Must propagate");
        },
        { collector }
      )
    ).rejects.toThrow("Must propagate");
  });
});

// ============================================================================
// Workflow Telemetry Integration Tests
// ============================================================================

describe("Workflow Telemetry Integration", () => {
  test("full workflow tracking scenario", async () => {
    const { collector, events } = createTrackingCollector();

    const result = await withWorkflowTelemetry(
      "workflow-full",
      "ralph-implementation",
      async (tracker) => {
        // Simulate a Ralph workflow with multiple nodes
        tracker.nodeEnter("init-session", "ralph_init");
        await new Promise((r) => setTimeout(r, 10));
        tracker.nodeExit("init-session", "ralph_init", 10);

        tracker.nodeEnter("implement-feature", "ralph_implement");
        await new Promise((r) => setTimeout(r, 10));
        tracker.nodeExit("implement-feature", "ralph_implement", 10);

        tracker.nodeEnter("check-completion", "ralph_check");
        await new Promise((r) => setTimeout(r, 10));
        tracker.nodeExit("check-completion", "ralph_check", 10);

        return { success: true, nodesCompleted: 3 };
      },
      {
        collector,
        additionalProperties: { totalFeatures: 10 },
      }
    );

    expect(result.nodesCompleted).toBe(3);

    // start + 3*(nodeEnter + nodeExit) + complete = 8
    expect(events.length).toBe(8);

    // Verify event sequence
    expect(events[0]!.eventType).toBe("workflow.start");
    expect(events[1]!.eventType).toBe("workflow.node.enter");
    expect(events[2]!.eventType).toBe("workflow.node.exit");
    expect(events[7]!.eventType).toBe("workflow.complete");

    // Verify additional properties are on all events
    for (const event of events) {
      expect(event.properties.totalFeatures).toBe(10);
    }
  });
});
