/**
 * Conductor Module Barrel
 *
 * Public API surface for the conductor module. Re-exports types,
 * guards, and the conductor class from immediate children only
 * (max re-export depth: 1).
 */

export type {
  AccumulatedContextPressure,
  ConductorConfig,
  ContextPressureConfig,
  ContextPressureLevel,
  ContextPressureSnapshot,
  StageContext,
  StageDefinition,
  StageOutput,
  StageOutputStatus,
  WorkflowResult,
} from "@/services/workflows/conductor/types.ts";

export {
  CONTEXT_PRESSURE_LEVELS,
  STAGE_OUTPUT_STATUSES,
} from "@/services/workflows/conductor/types.ts";

export {
  isAccumulatedContextPressure,
  isConductorConfig,
  isContextPressureConfig,
  isContextPressureLevel,
  isContextPressureSnapshot,
  isStageContext,
  isStageDefinition,
  isStageOutput,
  isStageOutputStatus,
  isWorkflowResult,
} from "@/services/workflows/conductor/guards.ts";

export {
  accumulateStageSnapshot,
  computePressureLevel,
  createDefaultContextPressureConfig,
  createEmptyAccumulatedPressure,
  createSnapshot,
  DEFAULT_CRITICAL_THRESHOLD,
  DEFAULT_ELEVATED_THRESHOLD,
  takeContextSnapshot,
} from "@/services/workflows/conductor/context-pressure.ts";

export {
  truncateStageOutput,
  type TruncationResult,
} from "@/services/workflows/conductor/truncate.ts";

export { WorkflowSessionConductor } from "@/services/workflows/conductor/conductor.ts";

export { createTaskUpdatePublisher } from "@/services/workflows/conductor/event-bridge.ts";

export { getNextExecutableNodes } from "@/services/workflows/conductor/graph-traversal.ts";
