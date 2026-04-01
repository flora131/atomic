import type {
  BaseState,
  DebugReport,
  NodeType,
  Signal,
} from "@/services/workflows/graph/contracts/core.ts";
import type {
  ExecutionStatus,
  NodeResult,
} from "@/services/workflows/graph/contracts/runtime.ts";

export function isNodeType(value: unknown): value is NodeType {
  return (
    typeof value === "string" &&
    ["agent", "tool", "decision", "wait", "ask_user", "subgraph", "parallel"].includes(value)
  );
}

export function isSignal(value: unknown): value is Signal {
  return (
    typeof value === "string" &&
    [
      "checkpoint",
      "human_input_required",
      "debug_report_generated",
    ].includes(value)
  );
}

export function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return (
    typeof value === "string" &&
    ["pending", "running", "paused", "completed", "failed", "cancelled"].includes(value)
  );
}

export function isBaseState(value: unknown): value is BaseState {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.executionId === "string" &&
    typeof obj.lastUpdated === "string" &&
    typeof obj.outputs === "object" &&
    obj.outputs !== null
  );
}

export function isNodeResult(value: unknown): value is NodeResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  if (obj.stateUpdate !== undefined && typeof obj.stateUpdate !== "object") {
    return false;
  }
  if (obj.goto !== undefined && typeof obj.goto !== "string" && !Array.isArray(obj.goto)) {
    return false;
  }
  if (obj.signals !== undefined && !Array.isArray(obj.signals)) {
    return false;
  }
  return true;
}

export function isDebugReport(value: unknown): value is DebugReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.errorSummary === "string" &&
    Array.isArray(obj.relevantFiles) &&
    Array.isArray(obj.suggestedFixes) &&
    typeof obj.generatedAt === "string"
  );
}
