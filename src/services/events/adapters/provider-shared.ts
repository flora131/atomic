import type { BusEvent } from "@/services/events/bus-events/index.ts";

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
  const errorMessage = toErrorMessage(error);
  return {
    type: "stream.session.error",
    sessionId,
    runId,
    timestamp: Date.now(),
    data: {
      error: errorMessage,
      ...(isSessionExpiredMessage(errorMessage) ? { code: "session_expired" } : {}),
    },
  };
}

const SESSION_EXPIRED_PATTERNS = [
  "unknown session",
  "session not found",
  "session expired",
  "invalid session",
  "session_expired",
];

export function isSessionExpiredMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return SESSION_EXPIRED_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Error indicating that a session has expired and is no longer valid.
 *
 * Thrown by the provider runtime adapters when a stream error message
 * matches one of the known session-expiry patterns (see
 * {@link isSessionExpiredMessage}).  The TUI controller catches this error
 * to transparently create a fresh session and retry the operation.
 */
export class SessionExpiredError extends Error {
  override readonly name = "SessionExpiredError";

  constructor(message: string) {
    super(message);
  }
}

export function drainUnsubscribers(
  unsubscribers: Array<() => void>,
): Array<() => void> {
  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }
  return [];
}
