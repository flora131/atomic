/**
 * Conductor Type Guards
 *
 * Runtime type guards for conductor types, following the same pattern
 * as `graph/contracts/guards.ts`.
 */

import type {
  ConductorConfig,
  StageContext,
  StageDefinition,
  StageOutput,
  StageOutputStatus,
  WorkflowResult,
  ContextPressureLevel,
  ContextPressureSnapshot,
  ContextPressureConfig,
  AccumulatedContextPressure,
} from "@/services/workflows/conductor/types.ts";
import {
  STAGE_OUTPUT_STATUSES,
  CONTEXT_PRESSURE_LEVELS,
} from "@/services/workflows/conductor/types.ts";

/** Check whether a value is a valid `StageOutputStatus`. */
export function isStageOutputStatus(value: unknown): value is StageOutputStatus {
  return typeof value === "string" && (STAGE_OUTPUT_STATUSES as readonly string[]).includes(value);
}

/** Check whether a value satisfies the `StageOutput` shape. */
export function isStageOutput(value: unknown): value is StageOutput {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.stageId === "string" &&
    typeof obj.rawResponse === "string" &&
    isStageOutputStatus(obj.status) &&
    (obj.error === undefined || typeof obj.error === "string")
  );
}

/** Check whether a value satisfies the `StageContext` shape. */
export function isStageContext(value: unknown): value is StageContext {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.userPrompt === "string" &&
    obj.stageOutputs instanceof Map &&
    Array.isArray(obj.tasks) &&
    obj.abortSignal instanceof AbortSignal
  );
}

/** Check whether a value satisfies the `StageDefinition` shape. */
export function isStageDefinition(value: unknown): value is StageDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.indicator === "string" &&
    typeof obj.buildPrompt === "function" &&
    (obj.parseOutput === undefined || typeof obj.parseOutput === "function") &&
    (obj.shouldRun === undefined || typeof obj.shouldRun === "function") &&
    (obj.sessionConfig === undefined || (typeof obj.sessionConfig === "object" && obj.sessionConfig !== null))
  );
}

/** Check whether a value satisfies the `ConductorConfig` shape. */
export function isConductorConfig(value: unknown): value is ConductorConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.graph === "object" && obj.graph !== null &&
    typeof obj.createSession === "function" &&
    typeof obj.destroySession === "function" &&
    typeof obj.onStageTransition === "function" &&
    typeof obj.onTaskUpdate === "function" &&
    obj.abortSignal instanceof AbortSignal &&
    (obj.maxStageOutputBytes === undefined || typeof obj.maxStageOutputBytes === "number") &&
    (obj.partsTruncation === undefined || (typeof obj.partsTruncation === "object" && obj.partsTruncation !== null))
  );
}

/** Check whether a value satisfies the `WorkflowResult` shape. */
export function isWorkflowResult(value: unknown): value is WorkflowResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.success === "boolean" &&
    obj.stageOutputs instanceof Map &&
    Array.isArray(obj.tasks) &&
    typeof obj.state === "object" && obj.state !== null
  );
}

// ---------------------------------------------------------------------------
// Context Pressure Guards
// ---------------------------------------------------------------------------

/** Check whether a value is a valid `ContextPressureLevel`. */
export function isContextPressureLevel(value: unknown): value is ContextPressureLevel {
  return typeof value === "string" && (CONTEXT_PRESSURE_LEVELS as readonly string[]).includes(value);
}

/** Check whether a value satisfies the `ContextPressureSnapshot` shape. */
export function isContextPressureSnapshot(value: unknown): value is ContextPressureSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.inputTokens === "number" &&
    typeof obj.outputTokens === "number" &&
    typeof obj.maxTokens === "number" &&
    typeof obj.usagePercentage === "number" &&
    isContextPressureLevel(obj.level) &&
    typeof obj.timestamp === "string"
  );
}

/** Check whether a value satisfies the `ContextPressureConfig` shape. */
export function isContextPressureConfig(value: unknown): value is ContextPressureConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.elevatedThreshold === "number" &&
    typeof obj.criticalThreshold === "number"
  );
}

/** Check whether a value satisfies the `AccumulatedContextPressure` shape. */
export function isAccumulatedContextPressure(value: unknown): value is AccumulatedContextPressure {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.totalInputTokens === "number" &&
    typeof obj.totalOutputTokens === "number" &&
    obj.stageSnapshots instanceof Map
  );
}
