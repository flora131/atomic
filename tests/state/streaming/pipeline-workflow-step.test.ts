/**
 * Tests for pipeline workflow step reducer functions.
 *
 * Validates that upsertWorkflowStepStart and upsertWorkflowStepComplete
 * correctly create and update WorkflowStepPart entries in the parts array.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  upsertWorkflowStepStart,
  upsertWorkflowStepComplete,
} from "@/state/streaming/pipeline-workflow.ts";
import { _resetPartCounter } from "@/state/parts/id.ts";
import type { Part, WorkflowStepPart } from "@/state/parts/types.ts";
import type { WorkflowStepStartEvent, WorkflowStepCompleteEvent } from "@/state/streaming/pipeline-types.ts";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function startEvent(overrides?: Partial<WorkflowStepStartEvent>): WorkflowStepStartEvent {
  return {
    type: "workflow-step-start",
    workflowId: "wf-1",
    nodeId: "planner",
    indicator: "[PLANNER]",
    ...overrides,
  };
}

function completeEvent(overrides?: Partial<WorkflowStepCompleteEvent>): WorkflowStepCompleteEvent {
  return {
    type: "workflow-step-complete",
    workflowId: "wf-1",
    nodeId: "planner",
    status: "completed",
    durationMs: 1234,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pipeline-workflow step reducers", () => {
  beforeEach(() => {
    _resetPartCounter();
  });

  describe("upsertWorkflowStepStart", () => {
    test("creates a new WorkflowStepPart with running status", () => {
      const parts: Part[] = [];
      const result = upsertWorkflowStepStart(parts, startEvent());

      expect(result).toHaveLength(1);
      const part = result[0] as WorkflowStepPart;
      expect(part.type).toBe("workflow-step");
      expect(part.workflowId).toBe("wf-1");
      expect(part.nodeId).toBe("planner");
      expect(part.status).toBe("running");
      expect(part.startedAt).toBeDefined();
      expect(part.completedAt).toBeUndefined();
      expect(part.durationMs).toBeUndefined();
    });

    test("preserves existing parts when adding a new step", () => {
      const existingPart: Part = {
        id: "existing-1" as Part["id"],
        type: "text",
        content: "Hello",
        isStreaming: false,
        createdAt: new Date().toISOString(),
      };
      const parts: Part[] = [existingPart];
      const result = upsertWorkflowStepStart(parts, startEvent());

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(existingPart);
      expect((result[1] as WorkflowStepPart).type).toBe("workflow-step");
    });

    test("updates existing WorkflowStepPart with same nodeId and workflowId", () => {
      const parts: Part[] = [];
      const afterFirst = upsertWorkflowStepStart(parts, startEvent());
      const originalId = afterFirst[0]!.id;

      // Re-start the same step (e.g., retry scenario)
      const afterSecond = upsertWorkflowStepStart(afterFirst, startEvent());

      expect(afterSecond).toHaveLength(1);
      expect(afterSecond[0]!.id).toBe(originalId);
      expect((afterSecond[0] as WorkflowStepPart).status).toBe("running");
    });

    test("creates separate parts for different nodeIds", () => {
      const parts: Part[] = [];
      const afterFirst = upsertWorkflowStepStart(parts, startEvent({ nodeId: "planner" }));
      const afterSecond = upsertWorkflowStepStart(afterFirst, startEvent({ nodeId: "orchestrator" }));

      expect(afterSecond).toHaveLength(2);
      expect((afterSecond[0] as WorkflowStepPart).nodeId).toBe("planner");
      expect((afterSecond[1] as WorkflowStepPart).nodeId).toBe("orchestrator");
    });

    test("creates separate parts for different workflowIds", () => {
      const parts: Part[] = [];
      const afterFirst = upsertWorkflowStepStart(parts, startEvent({ workflowId: "wf-1" }));
      const afterSecond = upsertWorkflowStepStart(afterFirst, startEvent({ workflowId: "wf-2" }));

      expect(afterSecond).toHaveLength(2);
      expect((afterSecond[0] as WorkflowStepPart).workflowId).toBe("wf-1");
      expect((afterSecond[1] as WorkflowStepPart).workflowId).toBe("wf-2");
    });
  });

  describe("upsertWorkflowStepComplete", () => {
    test("updates existing running step to completed", () => {
      const parts = upsertWorkflowStepStart([], startEvent());
      const result = upsertWorkflowStepComplete(parts, completeEvent());

      expect(result).toHaveLength(1);
      const part = result[0] as WorkflowStepPart;
      expect(part.status).toBe("completed");
      expect(part.durationMs).toBe(1234);
      expect(part.completedAt).toBeDefined();
      expect(part.error).toBeUndefined();
    });

    test("preserves part id when updating existing step", () => {
      const parts = upsertWorkflowStepStart([], startEvent());
      const originalId = parts[0]!.id;
      const result = upsertWorkflowStepComplete(parts, completeEvent());

      expect(result[0]!.id).toBe(originalId);
    });

    test("sets error field when status is error", () => {
      const parts = upsertWorkflowStepStart([], startEvent());
      const result = upsertWorkflowStepComplete(
        parts,
        completeEvent({ status: "error", error: "Session failed" }),
      );

      const part = result[0] as WorkflowStepPart;
      expect(part.status).toBe("error");
      expect(part.error).toBe("Session failed");
    });

    test("does not create a part for skipped steps", () => {
      const parts: Part[] = [];
      const result = upsertWorkflowStepComplete(
        parts,
        completeEvent({ status: "skipped", durationMs: 0 }),
      );

      expect(result).toHaveLength(0);
      expect(result).toBe(parts);
    });

    test("handles complete event for correct step among multiple", () => {
      let parts = upsertWorkflowStepStart([], startEvent({ nodeId: "planner" }));
      parts = upsertWorkflowStepStart(parts, startEvent({ nodeId: "orchestrator" }));

      const result = upsertWorkflowStepComplete(
        parts,
        completeEvent({ nodeId: "planner", durationMs: 500 }),
      );

      expect(result).toHaveLength(2);
      expect((result[0] as WorkflowStepPart).nodeId).toBe("planner");
      expect((result[0] as WorkflowStepPart).status).toBe("completed");
      expect((result[0] as WorkflowStepPart).durationMs).toBe(500);

      expect((result[1] as WorkflowStepPart).nodeId).toBe("orchestrator");
      expect((result[1] as WorkflowStepPart).status).toBe("running");
    });
  });

  describe("full lifecycle: start → complete", () => {
    test("multi-step workflow produces correct parts sequence", () => {
      let parts: Part[] = [];

      // Step 1: planner starts
      parts = upsertWorkflowStepStart(parts, startEvent({ nodeId: "planner" }));
      expect(parts).toHaveLength(1);
      expect((parts[0] as WorkflowStepPart).status).toBe("running");

      // Step 2: planner completes
      parts = upsertWorkflowStepComplete(parts, completeEvent({ nodeId: "planner", durationMs: 1000 }));
      expect(parts).toHaveLength(1);
      expect((parts[0] as WorkflowStepPart).status).toBe("completed");

      // Step 3: orchestrator starts
      parts = upsertWorkflowStepStart(parts, startEvent({ nodeId: "orchestrator" }));
      expect(parts).toHaveLength(2);
      expect((parts[1] as WorkflowStepPart).status).toBe("running");

      // Step 4: orchestrator completes with error
      parts = upsertWorkflowStepComplete(parts, completeEvent({
        nodeId: "orchestrator",
        status: "error",
        error: "timeout",
        durationMs: 5000,
      }));
      expect(parts).toHaveLength(2);
      expect((parts[1] as WorkflowStepPart).status).toBe("error");
      expect((parts[1] as WorkflowStepPart).error).toBe("timeout");
    });
  });
});
