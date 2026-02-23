export type AutoCompactionIndicatorStatus = "idle" | "running" | "completed" | "error";

export interface AutoCompactionIndicatorState {
  status: AutoCompactionIndicatorStatus;
  errorMessage?: string;
}

export const AUTO_COMPACTION_RESULT_VISIBILITY_MS = 4000;

export const AUTO_COMPACTION_INDICATOR_IDLE_STATE: AutoCompactionIndicatorState = {
  status: "idle",
};

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

export function isAutoCompactionToolName(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  if (!normalized) return false;

  return normalized === "compact"
    || normalized.endsWith("/compact")
    || normalized.endsWith("__compact")
    || normalized.includes("precompact")
    || normalized.includes("context_compact")
    || normalized.includes("context-compact")
    || normalized.includes("auto_compact")
    || normalized.includes("auto-compact");
}

export function startAutoCompactionIndicator(
  current: AutoCompactionIndicatorState,
  toolName: string,
): AutoCompactionIndicatorState {
  if (!isAutoCompactionToolName(toolName)) return current;
  if (current.status === "running") return current;
  return { status: "running" };
}

export function completeAutoCompactionIndicator(
  current: AutoCompactionIndicatorState,
  toolName: string,
  success: boolean,
  error?: string,
): AutoCompactionIndicatorState {
  if (!isAutoCompactionToolName(toolName)) return current;

  if (success) {
    return { status: "completed" };
  }

  const trimmedError = error?.trim();
  return {
    status: "error",
    errorMessage: trimmedError && trimmedError.length > 0 ? trimmedError : undefined,
  };
}

export function clearRunningAutoCompactionIndicator(
  current: AutoCompactionIndicatorState,
): AutoCompactionIndicatorState {
  if (current.status !== "running") return current;
  return AUTO_COMPACTION_INDICATOR_IDLE_STATE;
}

export function shouldShowAutoCompactionIndicator(
  current: AutoCompactionIndicatorState,
): boolean {
  return current.status !== "idle";
}

export function getAutoCompactionIndicatorLabel(
  current: AutoCompactionIndicatorState,
): string {
  switch (current.status) {
    case "running":
      return "in progress";
    case "completed":
      return "completed";
    case "error":
      return current.errorMessage
        ? `failed (${current.errorMessage})`
        : "failed";
    case "idle":
    default:
      return "";
  }
}
