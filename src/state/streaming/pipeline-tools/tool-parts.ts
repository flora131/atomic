import { createPartId } from "@/state/parts/id.ts";
import { upsertPart } from "@/state/parts/store.ts";
import type { Part, ToolPart, ToolState } from "@/state/parts/types.ts";
import { finalizeLastStreamingTextPart } from "@/state/streaming/pipeline-thinking.ts";
import type {
  ToolCompleteEvent,
  ToolPartialResultEvent,
  ToolStartEvent,
} from "@/state/streaming/pipeline-types.ts";

export function upsertToolPartStart(
  parts: Part[],
  event: ToolStartEvent,
): Part[] {
  const existingIdx = parts.findIndex(
    (part) =>
      part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
  );

  if (existingIdx >= 0) {
    const existing = parts[existingIdx] as ToolPart;
    const updated = [...parts];
    const startedAt =
      existing.state.status === "running"
        ? existing.state.startedAt
        : event.startedAt ?? new Date().toISOString();
    updated[existingIdx] = {
      ...existing,
      toolName: event.toolName,
      input: event.input,
      metadata: event.toolMetadata ?? existing.metadata,
      state: { status: "running", startedAt },
    };
    return updated;
  }

  const toolPart: ToolPart = {
    id: createPartId(),
    type: "tool",
    toolCallId: event.toolId,
    toolName: event.toolName,
    input: event.input,
    metadata: event.toolMetadata,
    state: {
      status: "running",
      startedAt: event.startedAt ?? new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };

  return upsertPart(finalizeLastStreamingTextPart(parts), toolPart);
}

export function upsertToolPartComplete(
  parts: Part[],
  event: ToolCompleteEvent,
): Part[] {
  const toolPartIdx = parts.findIndex(
    (part) =>
      part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
  );

  if (toolPartIdx >= 0) {
    const existing = parts[toolPartIdx] as ToolPart;
    let durationMs = 0;
    if (existing.state.status === "running") {
      const startedAtMs = new Date(existing.state.startedAt).getTime();
      durationMs = Number.isFinite(startedAtMs)
        ? Math.max(0, Date.now() - startedAtMs)
        : 0;
    }
    const updatedInput =
      event.input && Object.keys(existing.input).length === 0
        ? event.input
        : existing.input;
    const newState: ToolState = event.success
      ? { status: "completed", output: event.output, durationMs }
      : {
          status: "error",
          error: event.error || "Unknown error",
          output: event.output,
        };

    const updated = [...parts];
    updated[toolPartIdx] = {
      ...existing,
      toolName:
        existing.toolName === "unknown"
          ? (event.toolName ?? "unknown")
          : existing.toolName,
      input: updatedInput,
      metadata: event.toolMetadata ?? existing.metadata,
      output: event.output,
      state: newState,
    };
    return updated;
  }

  return upsertPart(parts, {
    id: createPartId(),
    type: "tool",
    toolCallId: event.toolId,
    toolName: event.toolName ?? "unknown",
    input: event.input ?? {},
    metadata: event.toolMetadata,
    output: event.output,
    state: event.success
      ? { status: "completed", output: event.output, durationMs: 0 }
      : {
          status: "error",
          error: event.error || "Unknown error",
          output: event.output,
        },
    createdAt: new Date().toISOString(),
  } satisfies ToolPart);
}

export function applyToolPartialResultToParts(
  parts: Part[],
  event: ToolPartialResultEvent,
): Part[] {
  const updatedParts = [...parts];
  const toolPartIdx = updatedParts.findIndex(
    (part) => part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
  );
  if (toolPartIdx >= 0) {
    const existing = updatedParts[toolPartIdx] as ToolPart;
    updatedParts[toolPartIdx] = {
      ...existing,
      partialOutput: (existing.partialOutput ?? "") + event.partialOutput,
    };
  }
  return updatedParts;
}
