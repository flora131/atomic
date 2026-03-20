/**
 * Conductor Module Barrel
 *
 * Public API surface for the conductor module. Re-exports types and
 * guards from immediate children only (max re-export depth: 1).
 */

export type {
  ConductorConfig,
  StageContext,
  StageDefinition,
  StageOutput,
  StageOutputStatus,
  WorkflowResult,
} from "@/services/workflows/conductor/types.ts";

export { STAGE_OUTPUT_STATUSES } from "@/services/workflows/conductor/types.ts";

export {
  isConductorConfig,
  isStageContext,
  isStageDefinition,
  isStageOutput,
  isStageOutputStatus,
  isWorkflowResult,
} from "@/services/workflows/conductor/guards.ts";
