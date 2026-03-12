import { createPartId } from "@/state/parts/id.ts";
import { upsertPart } from "@/state/parts/store.ts";
import type { Part, TaskResultPart } from "@/state/parts/types.ts";
import type { TaskResultUpsertEvent } from "@/state/streaming/pipeline-types.ts";

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
