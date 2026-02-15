/**
 * Tests for graph telemetry integration: tracker factory, sampling, safe emit, and noop behavior.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import {
  trackWorkflowExecution,
  type WorkflowTelemetryEvent,
  type WorkflowTelemetryConfig,
  type WorkflowTracker,
} from "./graph-integration.ts";

describe("trackWorkflowExecution", () => {
  const executionId = "exec-001";

  describe("clampSampleRate (tested indirectly)", () => {
    test("defaults to sampling when sampleRate is undefined", () => {
      const events: WorkflowTelemetryEvent[] = [];
      const tracker = trackWorkflowExecution(executionId, {
        onEvent: (e) => events.push(e),
      });

      tracker.start("workflow-a");
      expect(events.length).toBe(1);
      expect(events[0]!.eventType).toBe("workflow_start");
    });

    test("clamps sampleRate of 0 to produce a noop tracker", () => {
      const events: WorkflowTelemetryEvent[] = [];
      const tracker = trackWorkflowExecution(executionId, {
        sampleRate: 0,
        onEvent: (e) => events.push(e),
      });

      tracker.start("workflow-a");
      tracker.nodeEnter("node1", "action");
      tracker.complete(true, 100);
      expect(events.length).toBe(0);
    });

    test("clamps negative sampleRate to 0 producing a noop tracker", () => {
      const events: WorkflowTelemetryEvent[] = [];
      const tracker = trackWorkflowExecution(executionId, {
        sampleRate: -0.5,
        onEvent: (e) => events.push(e),
      });

      tracker.start("workflow-a");
      expect(events.length).toBe(0);
    });

    test("clamps sampleRate above 1 to 1 producing an active tracker", () => {
      const events: WorkflowTelemetryEvent[] = [];
      const tracker = trackWorkflowExecution(executionId, {
        sampleRate: 5.0,
        onEvent: (e) => events.push(e),
      });

      tracker.start("workflow-a");
      expect(events.length).toBe(1);
    });

    test("clamps NaN sampleRate to default (1), producing an active tracker", () => {
      const events: WorkflowTelemetryEvent[] = [];
      const tracker = trackWorkflowExecution(executionId, {
        sampleRate: NaN,
        onEvent: (e) => events.push(e),
      });

      tracker.start("workflow-a");
      expect(events.length).toBe(1);
    });

    test("sampleRate of exactly 1 always produces an active tracker", () => {
      const events: WorkflowTelemetryEvent[] = [];
      const tracker = trackWorkflowExecution(executionId, {
        sampleRate: 1,
        onEvent: (e) => events.push(e),
      });

      tracker.start("workflow-a");
      expect(events.length).toBe(1);
    });

    test("sampleRate between 0 and 1 is preserved and used for probabilistic sampling", () => {
      // With sampleRate=0.5, run many tracker creations and verify some are active and some are noop.
      let activeCount = 0;
      const trials = 200;

      for (let i = 0; i < trials; i++) {
        const events: WorkflowTelemetryEvent[] = [];
        const tracker = trackWorkflowExecution(`exec-${i}`, {
          sampleRate: 0.5,
          onEvent: (e) => events.push(e),
        });
        tracker.start("workflow-a");
        if (events.length > 0) {
          activeCount++;
        }
      }

      // With 200 trials at 50%, active count should be roughly 100.
      // Use a generous tolerance to avoid flaky tests (expect between 40 and 160).
      expect(activeCount).toBeGreaterThan(40);
      expect(activeCount).toBeLessThan(160);
    });
  });

  describe("enabled config flag", () => {
    test("returns noop tracker when enabled is false", () => {
      const events: WorkflowTelemetryEvent[] = [];
      const tracker = trackWorkflowExecution(executionId, {
        enabled: false,
        onEvent: (e) => events.push(e),
      });

      tracker.start("workflow-a");
      tracker.nodeEnter("n1", "action");
      tracker.nodeExit("n1", "action", 50);
      tracker.error("boom");
      tracker.complete(false, 200);

      expect(events.length).toBe(0);
    });

    test("returns active tracker when enabled is true", () => {
      const events: WorkflowTelemetryEvent[] = [];
      const tracker = trackWorkflowExecution(executionId, {
        enabled: true,
        onEvent: (e) => events.push(e),
      });

      tracker.start("workflow-a");
      expect(events.length).toBe(1);
    });

    test("returns active tracker when enabled is undefined (default true)", () => {
      const events: WorkflowTelemetryEvent[] = [];
      const tracker = trackWorkflowExecution(executionId, {
        onEvent: (e) => events.push(e),
      });

      tracker.start("workflow-a");
      expect(events.length).toBe(1);
    });

    test("returns active tracker when config is undefined", () => {
      // No config at all - should still produce an active tracker.
      // Without onEvent, no events are captured, but it should not throw.
      const tracker = trackWorkflowExecution(executionId);
      expect(() => tracker.start("workflow-a")).not.toThrow();
      expect(() => tracker.nodeEnter("n1", "action")).not.toThrow();
      expect(() => tracker.complete(true, 100)).not.toThrow();
    });
  });

  describe("safeEmit (tested indirectly)", () => {
    test("swallows errors thrown by the onEvent callback", () => {
      const tracker = trackWorkflowExecution(executionId, {
        onEvent: () => {
          throw new Error("callback exploded");
        },
      });

      // None of these should throw despite onEvent throwing
      expect(() => tracker.start("workflow-a")).not.toThrow();
      expect(() => tracker.nodeEnter("n1", "action")).not.toThrow();
      expect(() => tracker.nodeExit("n1", "action", 50)).not.toThrow();
      expect(() => tracker.error("oops")).not.toThrow();
      expect(() => tracker.complete(false, 200)).not.toThrow();
    });

    test("does not emit when onEvent is undefined", () => {
      // No onEvent provided, should not throw for any tracker method
      const tracker = trackWorkflowExecution(executionId, { enabled: true });

      expect(() => tracker.start("workflow-a")).not.toThrow();
      expect(() => tracker.nodeEnter("n1", "action")).not.toThrow();
      expect(() => tracker.nodeExit("n1", "action", 50)).not.toThrow();
      expect(() => tracker.error("oops")).not.toThrow();
      expect(() => tracker.complete(true, 200)).not.toThrow();
    });
  });

  describe("active tracker method events", () => {
    let events: WorkflowTelemetryEvent[];
    let tracker: WorkflowTracker;

    beforeEach(() => {
      events = [];
      tracker = trackWorkflowExecution(executionId, {
        sampleRate: 1,
        onEvent: (e) => events.push(e),
      });
    });

    test("start emits workflow_start with workflowName and meta", () => {
      tracker.start("my-workflow", { maxSteps: 10, resuming: true });

      expect(events.length).toBe(1);
      const event = events[0]!;
      expect(event.eventType).toBe("workflow_start");
      expect(event.executionId).toBe(executionId);
      expect(event.workflowName).toBe("my-workflow");
      expect(event.maxSteps).toBe(10);
      expect(event.resuming).toBe(true);
      expect(event.timestamp).toBeDefined();
      // Timestamp should be a valid ISO string
      expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
    });

    test("start emits workflow_start without meta fields when not provided", () => {
      tracker.start("simple-workflow");

      const event = events[0]!;
      expect(event.eventType).toBe("workflow_start");
      expect(event.workflowName).toBe("simple-workflow");
      expect(event.maxSteps).toBeUndefined();
      expect(event.resuming).toBeUndefined();
    });

    test("nodeEnter emits workflow_node_enter with nodeId and nodeType", () => {
      tracker.nodeEnter("node-abc", "llm_call");

      expect(events.length).toBe(1);
      const event = events[0]!;
      expect(event.eventType).toBe("workflow_node_enter");
      expect(event.executionId).toBe(executionId);
      expect(event.nodeId).toBe("node-abc");
      expect(event.nodeType).toBe("llm_call");
      expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
    });

    test("nodeExit emits workflow_node_exit with floored non-negative durationMs", () => {
      tracker.nodeExit("node-abc", "llm_call", 123.789);

      expect(events.length).toBe(1);
      const event = events[0]!;
      expect(event.eventType).toBe("workflow_node_exit");
      expect(event.executionId).toBe(executionId);
      expect(event.nodeId).toBe("node-abc");
      expect(event.nodeType).toBe("llm_call");
      expect(event.durationMs).toBe(123);
    });

    test("nodeExit clamps negative durationMs to 0", () => {
      tracker.nodeExit("node-abc", "llm_call", -50);

      const event = events[0]!;
      expect(event.durationMs).toBe(0);
    });

    test("error emits workflow_error with errorMessage and optional nodeId", () => {
      tracker.error("something went wrong", "node-xyz");

      expect(events.length).toBe(1);
      const event = events[0]!;
      expect(event.eventType).toBe("workflow_error");
      expect(event.executionId).toBe(executionId);
      expect(event.errorMessage).toBe("something went wrong");
      expect(event.nodeId).toBe("node-xyz");
    });

    test("error emits workflow_error without nodeId when not provided", () => {
      tracker.error("general failure");

      const event = events[0]!;
      expect(event.eventType).toBe("workflow_error");
      expect(event.errorMessage).toBe("general failure");
      expect(event.nodeId).toBeUndefined();
    });

    test("complete emits workflow_complete with success and floored durationMs", () => {
      tracker.complete(true, 5678.99);

      expect(events.length).toBe(1);
      const event = events[0]!;
      expect(event.eventType).toBe("workflow_complete");
      expect(event.executionId).toBe(executionId);
      expect(event.success).toBe(true);
      expect(event.durationMs).toBe(5678);
    });

    test("complete clamps negative durationMs to 0", () => {
      tracker.complete(false, -10);

      const event = events[0]!;
      expect(event.durationMs).toBe(0);
    });

    test("full workflow lifecycle emits events in correct order", () => {
      tracker.start("e2e-workflow", { maxSteps: 5 });
      tracker.nodeEnter("step-1", "action");
      tracker.nodeExit("step-1", "action", 42);
      tracker.nodeEnter("step-2", "decision");
      tracker.error("step-2 failed", "step-2");
      tracker.complete(false, 300);

      expect(events.length).toBe(6);
      expect(events.map((e) => e.eventType)).toEqual([
        "workflow_start",
        "workflow_node_enter",
        "workflow_node_exit",
        "workflow_node_enter",
        "workflow_error",
        "workflow_complete",
      ]);
      // All events share the same executionId
      for (const event of events) {
        expect(event.executionId).toBe(executionId);
      }
    });
  });

  describe("noop tracker behavior", () => {
    test("noop tracker methods do not throw and produce no events", () => {
      const events: WorkflowTelemetryEvent[] = [];
      const tracker = trackWorkflowExecution(executionId, {
        enabled: false,
        onEvent: (e) => events.push(e),
      });

      // All methods should be callable without error
      tracker.start("workflow-a", { maxSteps: 5, resuming: false });
      tracker.nodeEnter("node-1", "action");
      tracker.nodeExit("node-1", "action", 100);
      tracker.error("failure", "node-1");
      tracker.complete(false, 500);

      expect(events.length).toBe(0);
    });

    test("all disabled trackers share the same noop instance", () => {
      const tracker1 = trackWorkflowExecution("exec-a", { enabled: false });
      const tracker2 = trackWorkflowExecution("exec-b", { enabled: false });

      // Same object reference (optimization: NOOP_TRACKER is a singleton)
      expect(tracker1).toBe(tracker2);
    });
  });
});
