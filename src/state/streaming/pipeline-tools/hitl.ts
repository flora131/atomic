import type { ChatMessage } from "@/screens/chat-screen.tsx";
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
  const toolPartIdx = parts.findIndex(
    (part) =>
      part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
  );

  if (toolPartIdx >= 0) {
    const existing = parts[toolPartIdx] as ToolPart;
    const updated = [...parts];
    updated[toolPartIdx] = {
      ...existing,
      pendingQuestion: event.request,
    };
    return updated;
  }

  return upsertPart(parts, {
    id: createPartId(),
    type: "tool",
    toolCallId: event.toolId,
    toolName: "AskUserQuestion",
    input: {},
    state: { status: "running", startedAt: new Date().toISOString() },
    pendingQuestion: event.request,
    createdAt: new Date().toISOString(),
  } satisfies ToolPart);
}

export function applyHitlResponse(
  message: ChatMessage,
  event: HitlResponseEvent,
): ChatMessage {
  const nextToolCalls = (message.toolCalls ?? []).map((toolCall) => {
    if (toolCall.id !== event.toolId) {
      return toolCall;
    }
    return {
      ...toolCall,
      output: {
        ...(toolCall.output && typeof toolCall.output === "object"
          ? (toolCall.output as Record<string, unknown>)
          : {}),
        answer: event.response.answerText,
        cancelled: event.response.cancelled,
        responseMode: event.response.responseMode,
        displayText: event.response.displayText,
      },
      hitlResponse: event.response,
    };
  });

  let nextParts = message.parts;
  if (message.parts && message.parts.length > 0) {
    const updatedParts = [...message.parts];
    const toolPartIdx = updatedParts.findIndex(
      (part) =>
        part.type === "tool" && (part as ToolPart).toolCallId === event.toolId,
    );
    if (toolPartIdx >= 0) {
      const toolPart = updatedParts[toolPartIdx] as ToolPart;
      updatedParts[toolPartIdx] = {
        ...toolPart,
        pendingQuestion: undefined,
        hitlResponse: event.response,
      };
      nextParts = updatedParts;
    }
  }

  return {
    ...message,
    toolCalls: nextToolCalls,
    parts: nextParts,
  };
}
