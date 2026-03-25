/**
 * Tests for pipeline workflow reducer functions.
 *
 * Covers normalizeTaskItemStatus and upsertTaskResultPart in depth,
 * plus complementary edge-case tests for upsertWorkflowStepStart and
 * upsertWorkflowStepComplete that are not already covered in
 * pipeline-workflow-step.test.ts.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  normalizeTaskItemStatus,
  upsertTaskResultPart,
  upsertWorkflowStepStart,
  upsertWorkflowStepComplete,
} from "@/state/streaming/pipeline-workflow.ts";
import { _resetPartCounter } from "@/state/parts/id.ts";
import {
  createWorkflowStepPart,
  createTaskResultPart,
  resetPartIdCounter,
} from "../../test-support/fixtures/parts.ts";
import type { Part, TaskResultPart, WorkflowStepPart } from "@/state/parts/types.ts";
import type {
  TaskResultUpsertEvent,
  WorkflowStepStartEvent,
  WorkflowStepCompleteEvent,
} from "@/state/streaming/pipeline-types.ts";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function taskResultEvent(
  overrides?: Partial<TaskResultUpsertEvent["envelope"]>,
): TaskResultUpsertEvent {
  return {
    type: "task-result-upsert",
    envelope: {
      task_id: "task-1",
      tool_name: "Task",
      title: "Test Task",
      status: "completed",
      output_text: "Done",
      ...overrides,
    },
  };
}

function startEvent(
  overrides?: Partial<WorkflowStepStartEvent>,
): WorkflowStepStartEvent {
  return {
    type: "workflow-step-start",
    workflowId: "wf-1",
    nodeId: "planner",
    indicator: "[PLANNER]",
    ...overrides,
  };
}

function completeEvent(
  overrides?: Partial<WorkflowStepCompleteEvent>,
): WorkflowStepCompleteEvent {
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

describe("pipeline-workflow", () => {
  beforeEach(() => {
    _resetPartCounter();
    resetPartIdCounter();
  });

  // -------------------------------------------------------------------------
  // normalizeTaskItemStatus
  // -------------------------------------------------------------------------

  describe("normalizeTaskItemStatus", () => {
    test("maps 'pending' to 'pending'", () => {
      expect(normalizeTaskItemStatus("pending")).toBe("pending");
    });

    test("maps 'in_progress' to 'in_progress'", () => {
      expect(normalizeTaskItemStatus("in_progress")).toBe("in_progress");
    });

    test("maps 'completed' to 'completed'", () => {
      expect(normalizeTaskItemStatus("completed")).toBe("completed");
    });

    test("maps 'complete' to 'completed'", () => {
      expect(normalizeTaskItemStatus("complete")).toBe("completed");
    });

    test("maps 'done' to 'completed'", () => {
      expect(normalizeTaskItemStatus("done")).toBe("completed");
    });

    test("maps 'success' to 'completed'", () => {
      expect(normalizeTaskItemStatus("success")).toBe("completed");
    });

    test("maps 'error' to 'error'", () => {
      expect(normalizeTaskItemStatus("error")).toBe("error");
    });

    test("maps 'failed' to 'error'", () => {
      expect(normalizeTaskItemStatus("failed")).toBe("error");
    });

    test("defaults unknown status to 'pending'", () => {
      expect(normalizeTaskItemStatus("unknown")).toBe("pending");
    });

    test("defaults empty string to 'pending'", () => {
      expect(normalizeTaskItemStatus("")).toBe("pending");
    });

    test("defaults arbitrary string to 'pending'", () => {
      expect(normalizeTaskItemStatus("banana")).toBe("pending");
    });
  });

  // -------------------------------------------------------------------------
  // upsertTaskResultPart
  // -------------------------------------------------------------------------

  describe("upsertTaskResultPart", () => {
    test("creates new TaskResultPart when no existing part matches", () => {
      const parts: Part[] = [];
      const result = upsertTaskResultPart(parts, taskResultEvent());

      expect(result).toHaveLength(1);
      const part = result[0] as TaskResultPart;
      expect(part.type).toBe("task-result");
      expect(part.taskId).toBe("task-1");
      expect(part.toolName).toBe("Task");
      expect(part.title).toBe("Test Task");
      expect(part.status).toBe("completed");
      expect(part.outputText).toBe("Done");
      expect(part.id).toBeDefined();
      expect(part.createdAt).toBeDefined();
    });

    test("updates existing TaskResultPart when matching task_id found", () => {
      const parts: Part[] = [];
      const afterCreate = upsertTaskResultPart(parts, taskResultEvent());
      expect(afterCreate).toHaveLength(1);

      const originalId = afterCreate[0]!.id;
      const originalCreatedAt = afterCreate[0]!.createdAt;

      const afterUpdate = upsertTaskResultPart(
        afterCreate,
        taskResultEvent({
          task_id: "task-1",
          status: "error",
          output_text: "Something failed",
          error: "timeout",
        }),
      );

      expect(afterUpdate).toHaveLength(1);
      const updated = afterUpdate[0] as TaskResultPart;
      // id and createdAt should be preserved from the original
      expect(updated.id).toBe(originalId);
      expect(updated.createdAt).toBe(originalCreatedAt);
      // fields should be updated
      expect(updated.status).toBe("error");
      expect(updated.outputText).toBe("Something failed");
      expect(updated.error).toBe("timeout");
    });

    test("includes optional fields (envelopeText, error, metadata) when present", () => {
      const result = upsertTaskResultPart(
        [],
        taskResultEvent({
          envelope_text: "Raw envelope content",
          error: "Partial failure",
          metadata: {
            sessionId: "session-abc",
            providerBindings: { openai: "gpt-4" },
          },
        }),
      );

      expect(result).toHaveLength(1);
      const part = result[0] as TaskResultPart;
      expect(part.envelopeText).toBe("Raw envelope content");
      expect(part.error).toBe("Partial failure");
      expect(part.metadata).toEqual({
        sessionId: "session-abc",
        providerBindings: { openai: "gpt-4" },
      });
    });

    test("omits optional fields when not present in envelope", () => {
      const result = upsertTaskResultPart([], taskResultEvent());

      const part = result[0] as TaskResultPart;
      expect(part.envelopeText).toBeUndefined();
      expect(part.error).toBeUndefined();
      expect(part.metadata).toBeUndefined();
    });

    test("creates separate parts for different task_ids", () => {
      let parts: Part[] = [];
      parts = upsertTaskResultPart(parts, taskResultEvent({ task_id: "task-1" }));
      parts = upsertTaskResultPart(parts, taskResultEvent({ task_id: "task-2", title: "Second Task" }));

      expect(parts).toHaveLength(2);
      expect((parts[0] as TaskResultPart).taskId).toBe("task-1");
      expect((parts[1] as TaskResultPart).taskId).toBe("task-2");
      expect((parts[1] as TaskResultPart).title).toBe("Second Task");
    });

    test("preserves other existing parts when creating a new task result", () => {
      const existingPart = createWorkflowStepPart();
      const parts: Part[] = [existingPart];
      const result = upsertTaskResultPart(parts, taskResultEvent());

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(existingPart);
      expect((result[1] as TaskResultPart).type).toBe("task-result");
    });

    test("updates correct part among multiple task results", () => {
      let parts: Part[] = [];
      parts = upsertTaskResultPart(parts, taskResultEvent({ task_id: "task-1", title: "First" }));
      parts = upsertTaskResultPart(parts, taskResultEvent({ task_id: "task-2", title: "Second" }));
      parts = upsertTaskResultPart(parts, taskResultEvent({ task_id: "task-3", title: "Third" }));

      // Update the second one
      parts = upsertTaskResultPart(
        parts,
        taskResultEvent({ task_id: "task-2", title: "Second (Updated)", status: "error" }),
      );

      expect(parts).toHaveLength(3);
      expect((parts[0] as TaskResultPart).title).toBe("First");
      expect((parts[0] as TaskResultPart).status).toBe("completed");
      expect((parts[1] as TaskResultPart).title).toBe("Second (Updated)");
      expect((parts[1] as TaskResultPart).status).toBe("error");
      expect((parts[2] as TaskResultPart).title).toBe("Third");
    });

    test("does not mutate the original parts array", () => {
      const parts: Part[] = [];
      const result = upsertTaskResultPart(parts, taskResultEvent());

      expect(parts).toHaveLength(0);
      expect(result).toHaveLength(1);
      expect(result).not.toBe(parts);
    });

    test("does not mutate original array when updating existing part", () => {
      const parts = upsertTaskResultPart([], taskResultEvent());
      const originalPart = parts[0] as TaskResultPart;

      const updated = upsertTaskResultPart(
        parts,
        taskResultEvent({ task_id: "task-1", status: "error" }),
      );

      // Original part object should be unchanged
      expect(originalPart.status).toBe("completed");
      // Updated array should have the new status
      expect((updated[0] as TaskResultPart).status).toBe("error");
    });
  });

  // -------------------------------------------------------------------------
  // upsertWorkflowStepStart — complementary edge cases
  // -------------------------------------------------------------------------

  describe("upsertWorkflowStepStart (complementary)", () => {
    test("preserves createdAt when re-starting an existing step", () => {
      const parts = upsertWorkflowStepStart([], startEvent());
      const originalCreatedAt = parts[0]!.createdAt;

      // Small delay isn't needed — createdAt should be preserved from lookup
      const restarted = upsertWorkflowStepStart(parts, startEvent());
      expect(restarted[0]!.createdAt).toBe(originalCreatedAt);
    });

    test("resets status to running when re-starting a completed step", () => {
      let parts = upsertWorkflowStepStart([], startEvent());
      parts = upsertWorkflowStepComplete(parts, completeEvent());
      expect((parts[0] as WorkflowStepPart).status).toBe("completed");

      parts = upsertWorkflowStepStart(parts, startEvent());
      expect((parts[0] as WorkflowStepPart).status).toBe("running");
      // completedAt should be cleared since the new part doesn't include it
      expect((parts[0] as WorkflowStepPart).completedAt).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // upsertWorkflowStepComplete — complementary edge cases
  // -------------------------------------------------------------------------

  describe("upsertWorkflowStepComplete (complementary)", () => {
    test("skipped status returns parts unchanged (no part created)", () => {
      const parts: Part[] = [createWorkflowStepPart({ nodeId: "other" })];
      const result = upsertWorkflowStepComplete(
        parts,
        completeEvent({ status: "skipped", durationMs: 0 }),
      );

      expect(result).toBe(parts);
      expect(result).toHaveLength(1);
    });

    test("creates new part when completing a step that was never started", () => {
      const parts: Part[] = [];
      const result = upsertWorkflowStepComplete(
        parts,
        completeEvent({ status: "completed", durationMs: 500 }),
      );

      expect(result).toHaveLength(1);
      const part = result[0] as WorkflowStepPart;
      expect(part.type).toBe("workflow-step");
      expect(part.status).toBe("completed");
      expect(part.durationMs).toBe(500);
      expect(part.startedAt).toBeDefined();
      expect(part.completedAt).toBeDefined();
    });

    test("interrupted status creates/updates part (not treated as skipped)", () => {
      const parts = upsertWorkflowStepStart([], startEvent());
      const result = upsertWorkflowStepComplete(
        parts,
        completeEvent({ status: "interrupted", durationMs: 100 }),
      );

      expect(result).toHaveLength(1);
      const part = result[0] as WorkflowStepPart;
      expect(part.status).toBe("interrupted");
      expect(part.durationMs).toBe(100);
    });

    test("skipped status does not modify existing parts for other steps", () => {
      const parts = upsertWorkflowStepStart([], startEvent({ nodeId: "orchestrator" }));
      const result = upsertWorkflowStepComplete(
        parts,
        completeEvent({ nodeId: "planner", status: "skipped", durationMs: 0 }),
      );

      // The orchestrator step should still be there, untouched
      expect(result).toBe(parts);
      expect(result).toHaveLength(1);
      expect((result[0] as WorkflowStepPart).nodeId).toBe("orchestrator");
      expect((result[0] as WorkflowStepPart).status).toBe("running");
    });
  });
});
