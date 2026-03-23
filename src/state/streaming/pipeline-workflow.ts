import { createPartId } from "@/state/parts/id.ts";
import { upsertPart } from "@/state/parts/store.ts";
import type { Part, TaskResultPart, WorkflowStepPart } from "@/state/parts/types.ts";
import type {
  TaskResultUpsertEvent,
  WorkflowStepStartEvent,
  WorkflowStepCompleteEvent,
} from "@/state/streaming/pipeline-types.ts";
import {
  truncateStageParts,
  createDefaultPartsTruncationConfig,
} from "@/state/parts/truncation.ts";

export function upsertTaskResultPart(
  parts: Part[],
  event: TaskResultUpsertEvent,
): Part[] {
  const existingIdx = parts.findIndex(
    (part) =>
      part.type === "task-result" &&
      (part as TaskResultPart).taskId === event.envelope.task_id,
  );

  const basePart: Omit<TaskResultPart, "id" | "createdAt"> = {
    type: "task-result",
    taskId: event.envelope.task_id,
    toolName: event.envelope.tool_name,
    title: event.envelope.title,
    status: event.envelope.status,
    outputText: event.envelope.output_text,
    ...(event.envelope.envelope_text
      ? { envelopeText: event.envelope.envelope_text }
      : {}),
    ...(event.envelope.error ? { error: event.envelope.error } : {}),
    ...(event.envelope.metadata ? { metadata: event.envelope.metadata } : {}),
  };

  if (existingIdx >= 0) {
    const updated = [...parts];
    updated[existingIdx] = {
      ...(updated[existingIdx] as TaskResultPart),
      ...basePart,
    };
    return updated;
  }

  return upsertPart(parts, {
    ...basePart,
    id: createPartId(),
    createdAt: new Date().toISOString(),
  } satisfies TaskResultPart);
}

export function normalizeTaskItemStatus(
  status: string,
): "pending" | "in_progress" | "completed" | "error" {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "in_progress";
    case "completed":
    case "complete":
    case "done":
    case "success":
      return "completed";
    case "error":
    case "failed":
      return "error";
    default:
      return "pending";
  }
}

/**
 * Create a new WorkflowStepPart with "running" status when a step starts.
 * If a part for the same nodeId already exists, it is updated in place.
 */
export function upsertWorkflowStepStart(
  parts: Part[],
  event: WorkflowStepStartEvent,
): Part[] {
  const now = new Date().toISOString();
  const existingIdx = parts.findIndex(
    (part) =>
      part.type === "workflow-step" &&
      (part as WorkflowStepPart).nodeId === event.nodeId &&
      (part as WorkflowStepPart).workflowId === event.workflowId,
  );

  const newPart: WorkflowStepPart = {
    id: existingIdx >= 0 ? parts[existingIdx]!.id : createPartId(),
    type: "workflow-step",
    workflowId: event.workflowId,
    nodeId: event.nodeId,
    status: "running",
    startedAt: now,
    createdAt: existingIdx >= 0 ? parts[existingIdx]!.createdAt : now,
  };

  if (existingIdx >= 0) {
    const updated = [...parts];
    updated[existingIdx] = newPart;
    return updated;
  }

  return upsertPart(parts, newPart);
}

/**
 * Update an existing WorkflowStepPart with final status when a step completes.
 * If no matching part exists (e.g., for skipped steps), creates one.
 *
 * When the event carries a `truncation` config and the step completed
 * successfully, applies parts truncation to reclaim memory from verbose
 * parts (tools, reasoning, text) belonging to the completed stage.
 */
export function upsertWorkflowStepComplete(
  parts: Part[],
  event: WorkflowStepCompleteEvent,
): Part[] {
  // Skipped stages never executed — don't create or retain parts for them.
  if (event.status === "skipped") return parts;

  const now = new Date().toISOString();
  const existingIdx = parts.findIndex(
    (part) =>
      part.type === "workflow-step" &&
      (part as WorkflowStepPart).nodeId === event.nodeId &&
      (part as WorkflowStepPart).workflowId === event.workflowId,
  );

  let updatedParts: Part[];

  if (existingIdx >= 0) {
    const existing = parts[existingIdx] as WorkflowStepPart;
    updatedParts = [...parts];
    updatedParts[existingIdx] = {
      ...existing,
      status: event.status,
      completedAt: now,
      durationMs: event.durationMs,
      ...(event.error ? { error: event.error } : {}),
    } satisfies WorkflowStepPart;
  } else {
    updatedParts = upsertPart(parts, {
      id: createPartId(),
      type: "workflow-step",
      workflowId: event.workflowId,
      nodeId: event.nodeId,
      status: event.status,
      startedAt: now,
      completedAt: now,
      durationMs: event.durationMs,
      createdAt: now,
      ...(event.error ? { error: event.error } : {}),
    } satisfies WorkflowStepPart);
  }

  // Apply parts truncation when configured and the step completed successfully
  if (event.truncation && event.status === "completed") {
    const config = createDefaultPartsTruncationConfig(event.truncation);
    const result = truncateStageParts(
      updatedParts,
      event.nodeId,
      event.workflowId,
      config,
    );
    if (result.truncated) {
      return result.parts;
    }
  }

  return updatedParts;
}
