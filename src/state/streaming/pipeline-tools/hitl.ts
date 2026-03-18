import type { ChatMessage } from "@/types/chat.ts";
import { createPartId } from "@/state/parts/id.ts";
import { upsertPart } from "@/state/parts/store.ts";
import type { Part, ToolPart } from "@/state/parts/types.ts";
import type {
  HitlRequestEvent,
  HitlResponseEvent,
} from "@/state/streaming/pipeline-types.ts";

export function upsertHitlRequest(
  parts: Part[],
  event: HitlRequestEvent,
): Part[] {
  const requestInput = {
    header: event.request.header,
    question: event.request.question,
    options: event.request.options,
  } satisfies Record<string, unknown>;
  const toolPartIdx = parts.findIndex(
    (part) =>
      part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
  );

  if (toolPartIdx >= 0) {
    const existing = parts[toolPartIdx] as ToolPart;
    const updated = [...parts];
    updated[toolPartIdx] = {
      ...existing,
      input: Object.keys(existing.input).length > 0 ? existing.input : requestInput,
      pendingQuestion: event.request,
    };
    return updated;
  }

  return upsertPart(parts, {
    id: createPartId(),
    type: "tool",
    toolCallId: event.toolId,
    toolName: "AskUserQuestion",
    input: requestInput,
    state: { status: "running", startedAt: new Date().toISOString() },
    pendingQuestion: event.request,
    createdAt: new Date().toISOString(),
  } satisfies ToolPart);
}

export function applyHitlResponse(
  message: ChatMessage,
  event: HitlResponseEvent,
): ChatMessage {
  const parts = message.parts ?? [];
  if (parts.length === 0) {
    return message;
  }

  const updatedParts = [...parts];
  const toolPartIdx = updatedParts.findIndex(
    (part) =>
      part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
  );
  if (toolPartIdx < 0) {
    return message;
  }

  const toolPart = updatedParts[toolPartIdx] as ToolPart;
  updatedParts[toolPartIdx] = {
    ...toolPart,
    output: {
      ...(toolPart.output && typeof toolPart.output === "object"
        ? (toolPart.output as Record<string, unknown>)
        : {}),
      answer: event.response.answerText,
      cancelled: event.response.cancelled,
      responseMode: event.response.responseMode,
      displayText: event.response.displayText,
    },
    pendingQuestion: undefined,
    hitlResponse: event.response,
  };

  return {
    ...message,
    parts: updatedParts,
  };
}
