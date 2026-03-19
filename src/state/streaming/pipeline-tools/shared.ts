import type { ToolState } from "@/state/parts/types.ts";
import type { ToolStatus } from "@/state/streaming/pipeline-types.ts";

const HITL_EXACT_NAMES = new Set(["askuserquestion", "question", "ask_user", "ask_question"]);
const HITL_SUFFIXES = ["/ask_user", "__ask_user", "/ask_question", "__ask_question"];

export function isHitlToolName(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  if (HITL_EXACT_NAMES.has(normalized)) return true;
  return HITL_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
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


