import type { MessageToolCall } from "@/types/chat.ts";
import { createPartId, type PartId } from "@/state/parts/id.ts";
import type { Part, ToolPart } from "@/state/parts/types.ts";
import type {
  ToolCompleteEvent,
  ToolStartEvent,
} from "@/state/streaming/pipeline-types.ts";
import { mergeToolCallOutput, toToolState } from "@/state/streaming/pipeline-tools/shared.ts";

export function upsertToolCallStart(
  toolCalls: MessageToolCall[] | undefined,
  event: ToolStartEvent,
): MessageToolCall[] {
  const current = toolCalls ?? [];
  let matched = false;
  const updated = current.map((toolCall) => {
    if (toolCall.id !== event.toolId) {
      return toolCall;
    }
    matched = true;
    return {
      ...toolCall,
      toolName: event.toolName,
      input: event.input,
      status: "running" as const,
    };
  });

  if (matched) {
    return updated;
  }

  return [
    ...updated,
    {
      id: event.toolId,
      toolName: event.toolName,
      input: event.input,
      status: "running" as const,
    },
  ];
}

export function upsertToolCallComplete(
  toolCalls: MessageToolCall[] | undefined,
  event: ToolCompleteEvent,
): MessageToolCall[] {
  const current = toolCalls ?? [];
  let matched = false;
  const updated = current.map((toolCall) => {
    if (toolCall.id !== event.toolId) {
      return toolCall;
    }
    matched = true;
    const updatedInput =
      event.input && Object.keys(toolCall.input).length === 0
        ? event.input
        : toolCall.input;
    const updatedToolName =
      toolCall.toolName === "unknown"
        ? (event.toolName ?? "unknown")
        : toolCall.toolName;
    return {
      ...toolCall,
      toolName: updatedToolName,
      input: updatedInput,
      output: mergeToolCallOutput(toolCall, event.output),
      status: event.success ? ("completed" as const) : ("error" as const),
    };
  });

  if (matched) {
    return updated;
  }

  return [
    ...updated,
    {
      id: event.toolId,
      toolName: event.toolName ?? "unknown",
      input: event.input ?? {},
      output: event.output,
      status: event.success ? ("completed" as const) : ("error" as const),
    },
  ];
}

export function syncToolCallsIntoParts(
  parts: Part[],
  toolCalls: MessageToolCall[],
  messageTimestamp: string,
  messageId?: string,
): Part[] {
  const nextParts = [...parts];

  for (const toolCall of toolCalls) {
    const existingIdx = nextParts.findIndex(
      (part) =>
        part.type === "tool" && (part as ToolPart).toolCallId === toolCall.id,
    );

    if (existingIdx >= 0) {
      const existing = nextParts[existingIdx] as ToolPart;
      nextParts[existingIdx] = {
        ...existing,
        toolName: toolCall.toolName,
        input: toolCall.input,
        output: toolCall.output,
        hitlResponse: toolCall.hitlResponse ?? existing.hitlResponse,
        state: toToolState(
          toolCall.status,
          toolCall.output,
          messageTimestamp,
          existing.state,
        ),
      };
      continue;
    }

    const fallbackId = messageId
      ? (`tool-${messageId}-${toolCall.id}` as unknown as PartId)
      : createPartId();
    nextParts.push({
      id: fallbackId,
      type: "tool",
      toolCallId: toolCall.id,
      toolName: toolCall.toolName,
      input: toolCall.input,
      output: toolCall.output,
      hitlResponse: toolCall.hitlResponse,
      state: toToolState(toolCall.status, toolCall.output, messageTimestamp),
      createdAt: messageTimestamp,
    } satisfies ToolPart);
  }

  return nextParts;
}
