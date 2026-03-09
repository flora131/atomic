import type { BusEvent } from "@/services/events/bus-events.ts";

export const DEFAULT_SUBAGENT_TASK_LABEL = "sub-agent task";
export const SYNTHETIC_FOREGROUND_AGENT_PREFIX = "agent-only-";

export function isGenericSubagentTaskLabel(
  task: string | undefined,
): boolean {
  const normalized = (task ?? "").trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === DEFAULT_SUBAGENT_TASK_LABEL ||
    normalized === "subagent task"
  );
}

export function resolveAgentOnlyTaskLabel(
  message: string,
  agentName: string,
): string {
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : agentName;
}

export function buildSyntheticForegroundAgentId(messageId: string): string {
  return `${SYNTHETIC_FOREGROUND_AGENT_PREFIX}${messageId}`;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function normalizeToolName(value: unknown): string {
  return asString(value) ?? "unknown";
}

export function isBuiltInTaskTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return (
    normalized === "task" ||
    normalized === "launch_agent" ||
    normalized === "agent"
  );
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSessionStartEvent(
  sessionId: string,
  runId: number,
): BusEvent<"stream.session.start"> {
  return {
    type: "stream.session.start",
    sessionId,
    runId,
    timestamp: Date.now(),
    data: {},
  };
}

export function createSessionErrorEvent(
  sessionId: string,
  runId: number,
  error: unknown,
): BusEvent<"stream.session.error"> {
  return {
    type: "stream.session.error",
    sessionId,
    runId,
    timestamp: Date.now(),
    data: {
      error: toErrorMessage(error),
    },
  };
}

export function drainUnsubscribers(
  unsubscribers: Array<() => void>,
): Array<() => void> {
  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }
  return [];
}
