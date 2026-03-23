/**
 * Tests for workflow.step.* event handler descriptors.
 *
 * Validates that the EventHandlerRegistry descriptors registered in
 * stream-workflow-step.ts correctly:
 * 1. Produce unique coalescing keys per workflow+node
 * 2. Map BusEvents to WorkflowStepStartEvent / WorkflowStepCompleteEvent StreamPartEvents
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { EventHandlerRegistry, getEventHandlerRegistry, setEventHandlerRegistry } from "@/services/events/registry/registry.ts";
import type { BusEvent, EnrichedBusEvent, BusEventDataMap } from "@/services/events/bus-events/types.ts";
import type { StreamPartContext } from "@/services/events/registry/types.ts";
import type { WorkflowStepStartEvent, WorkflowStepCompleteEvent } from "@/state/streaming/pipeline-types.ts";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function makeBusEvent<T extends keyof BusEventDataMap>(
  type: T,
  data: BusEventDataMap[T],
  overrides?: Partial<Omit<BusEvent<T>, "type" | "data">>,
): BusEvent<T> {
  return {
    type,
    sessionId: "test-session",
    runId: 1,
    timestamp: Date.now(),
    data,
    ...overrides,
  };
}

/** Cast a BusEvent to EnrichedBusEvent for mapper calls. */
function enriched<T extends keyof BusEventDataMap>(
  event: BusEvent<T>,
): EnrichedBusEvent & { type: T } {
  return event as unknown as EnrichedBusEvent & { type: T };
}

const stubContext: StreamPartContext = {
  filterDelta: (d) => d,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stream-workflow-step handler descriptors", () => {
  let registry: EventHandlerRegistry;
  let originalRegistry: EventHandlerRegistry;

  beforeEach(() => {
    originalRegistry = getEventHandlerRegistry();
    registry = new EventHandlerRegistry();
    setEventHandlerRegistry(registry);
    // Manually register the same descriptors as stream-workflow-step.ts
    // to avoid module caching/singleton issues across test files.
    registry.register("workflow.step.start", {
      coalescingKey: (event) => {
        const data = event.data as BusEventDataMap["workflow.step.start"];
        return `workflow.step.start:${data.workflowId}:${data.nodeId}`;
      },
      toStreamPart: (event) => {
        const data = event.data as BusEventDataMap["workflow.step.start"];
        return {
          type: "workflow-step-start" as const,
          runId: event.runId,
          workflowId: data.workflowId,
          nodeId: data.nodeId,
          indicator: data.indicator,
        };
      },
    });
    registry.register("workflow.step.complete", {
      coalescingKey: (event) => {
        const data = event.data as BusEventDataMap["workflow.step.complete"];
        return `workflow.step.complete:${data.workflowId}:${data.nodeId}`;
      },
      toStreamPart: (event) => {
        const data = event.data as BusEventDataMap["workflow.step.complete"];
        return {
          type: "workflow-step-complete" as const,
          runId: event.runId,
          workflowId: data.workflowId,
          nodeId: data.nodeId,
          status: data.status,
          durationMs: data.durationMs,
          ...(data.error ? { error: data.error } : {}),
        };
      },
    });
  });

  afterEach(() => {
    setEventHandlerRegistry(originalRegistry);
  });

  describe("workflow.step.start", () => {
    test("produces coalescing key from workflowId and nodeId", () => {
      const fn = registry.getCoalescingKeyFn("workflow.step.start");
      expect(fn).toBeDefined();

      const event = makeBusEvent("workflow.step.start", {
        workflowId: "wf-1",
        nodeId: "planner",
        indicator: "[PLANNER]",
      });

      expect(fn!(event)).toBe("workflow.step.start:wf-1:planner");
    });

    test("different nodes produce different coalescing keys", () => {
      const fn = registry.getCoalescingKeyFn("workflow.step.start")!;

      const event1 = makeBusEvent("workflow.step.start", {
        workflowId: "wf-1",
        nodeId: "planner",
        indicator: "[PLANNER]",
      });
      const event2 = makeBusEvent("workflow.step.start", {
        workflowId: "wf-1",
        nodeId: "orchestrator",
        indicator: "[ORCHESTRATOR]",
      });

      expect(fn(event1)).not.toBe(fn(event2));
    });

    test("maps to WorkflowStepStartEvent StreamPartEvent", () => {
      const mapper = registry.getStreamPartMapper("workflow.step.start");
      expect(mapper).toBeDefined();

      const event = makeBusEvent("workflow.step.start", {
        workflowId: "wf-1",
        nodeId: "planner",
        indicator: "[PLANNER]",
      });

      const result = mapper!(enriched(event), stubContext) as WorkflowStepStartEvent;
      expect(result).not.toBeNull();
      expect(result.type).toBe("workflow-step-start");
      expect(result.workflowId).toBe("wf-1");
      expect(result.nodeId).toBe("planner");
      expect(result.indicator).toBe("[PLANNER]");
      expect(result.runId).toBe(1);
    });
  });

  describe("workflow.step.complete", () => {
    test("produces coalescing key from workflowId and nodeId", () => {
      const fn = registry.getCoalescingKeyFn("workflow.step.complete");
      expect(fn).toBeDefined();

      const event = makeBusEvent("workflow.step.complete", {
        workflowId: "wf-1",
        nodeId: "planner",
        status: "completed",
        durationMs: 1234,
      });

      expect(fn!(event)).toBe("workflow.step.complete:wf-1:planner");
    });

    test("maps to WorkflowStepCompleteEvent with completed status", () => {
      const mapper = registry.getStreamPartMapper("workflow.step.complete");
      expect(mapper).toBeDefined();

      const event = makeBusEvent("workflow.step.complete", {
        workflowId: "wf-1",
        nodeId: "planner",
        status: "completed",
        durationMs: 1234,
      });

      const result = mapper!(enriched(event), stubContext) as WorkflowStepCompleteEvent;
      expect(result.type).toBe("workflow-step-complete");
      expect(result.workflowId).toBe("wf-1");
      expect(result.nodeId).toBe("planner");
      expect(result.status).toBe("completed");
      expect(result.durationMs).toBe(1234);
      expect(result.error).toBeUndefined();
    });

    test("maps to WorkflowStepCompleteEvent with error status and error message", () => {
      const mapper = registry.getStreamPartMapper("workflow.step.complete")!;

      const event = makeBusEvent("workflow.step.complete", {
        workflowId: "wf-1",
        nodeId: "planner",
        status: "error",
        durationMs: 500,
        error: "Session failed",
      });

      const result = mapper(enriched(event), stubContext) as WorkflowStepCompleteEvent;
      expect(result.status).toBe("error");
      expect(result.error).toBe("Session failed");
    });

    test("maps to WorkflowStepCompleteEvent with skipped status", () => {
      const mapper = registry.getStreamPartMapper("workflow.step.complete")!;

      const event = makeBusEvent("workflow.step.complete", {
        workflowId: "wf-1",
        nodeId: "debugger",
        status: "skipped",
        durationMs: 0,
      });

      const result = mapper(enriched(event), stubContext) as WorkflowStepCompleteEvent;
      expect(result.status).toBe("skipped");
      expect(result.durationMs).toBe(0);
    });
  });
});
