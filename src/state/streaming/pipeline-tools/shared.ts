import type { MessageToolCall } from "@/types/chat.ts";
import type { ToolState } from "@/state/parts/types.ts";
import type { ToolStatus } from "@/state/streaming/pipeline-types.ts";

export function isHitlToolName(toolName: string): boolean {
  return (
    toolName === "AskUserQuestion" ||
    toolName === "question" ||
    toolName === "ask_user"
  );
}

export function isSubagentToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return (
    normalized === "task" ||
    normalized === "agent" ||
    normalized === "launch_agent"
  );
}

export function toToolState(
  status: ToolStatus,
  output: unknown,
  fallbackStartedAt: string,
  existingState?: ToolState,
): ToolState {
  switch (status) {
    case "pending":
      return { status: "pending" };
    case "running":
      return {
        status: "running",
        startedAt:
          existingState?.status === "running"
            ? existingState.startedAt
            : fallbackStartedAt,
      };
    case "completed":
      return {
        status: "completed",
        output,
        durationMs:
          existingState?.status === "completed" ? existingState.durationMs : 0,
      };
    case "error":
      return {
        status: "error",
        error:
          existingState?.status === "error"
            ? existingState.error
            : typeof output === "string" && output.trim()
              ? output
              : "Tool execution failed",
        output,
      };
    case "interrupted": {
      let durationMs: number | undefined;
      if (existingState?.status === "running") {
        const startedAtMs = new Date(existingState.startedAt).getTime();
        durationMs = Number.isFinite(startedAtMs)
          ? Math.max(0, Date.now() - startedAtMs)
          : undefined;
      }
      return { status: "interrupted", partialOutput: output, durationMs };
    }
  }

  const unreachableStatus: never = status;
  throw new Error(`Unsupported tool status: ${String(unreachableStatus)}`);
}

export function mergeToolCallOutput(
  toolCall: MessageToolCall,
  output: unknown,
): unknown {
  if (!isHitlToolName(toolCall.toolName) || !toolCall.hitlResponse) {
    return output !== undefined ? output : toolCall.output;
  }

  const outputObject =
    output !== null && typeof output === "object"
      ? (output as Record<string, unknown>)
      : {};
  return {
    ...outputObject,
    answer: toolCall.hitlResponse.answerText,
    cancelled: toolCall.hitlResponse.cancelled,
    responseMode: toolCall.hitlResponse.responseMode,
    displayText: toolCall.hitlResponse.displayText,
  };
}
