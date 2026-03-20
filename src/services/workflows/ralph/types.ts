/**
 * Ralph Workflow Context Types
 *
 * Provides a typed abstraction over the generic ExecutionContext for Ralph's
 * custom graph nodes (worker, fixer). Instead of reaching into
 * ctx.config.runtime?.X at each call site, nodes can consume a
 * RalphWorkflowContext that explicitly declares its dependencies.
 *
 * Also defines RalphCommandState — the Ralph-specific UI state that was
 * previously inlined in the shared CommandContextState. Isolating it here
 * keeps the generic CommandContext free of workflow-specific fields
 * (Interface Segregation).
 *
 * RalphCommandState now derives from the generic WorkflowCommandState,
 * mapping Ralph-specific concepts to the generic fields:
 * - `featureProgress` → `progress` (via WorkflowProgressState)
 * - `specApproved` → `approved`
 */

import type { RalphWorkflowState } from "@/services/workflows/ralph/state.ts";
import type {
  ExecutionContext,
  SubagentSpawnOptions,
  SubagentStreamResult,
} from "@/services/workflows/graph/contracts/runtime.ts";
import type {
  WorkflowRuntimeTask,
  WorkflowRuntimeTaskIdentityRuntime,
  WorkflowRuntimeTaskStatus,
} from "@/services/workflows/runtime-contracts.ts";
import type {
  WorkflowCommandState,
  WorkflowProgressState,
} from "@/services/workflows/workflow-types.ts";
import {
  defaultWorkflowCommandState,
} from "@/services/workflows/workflow-types.ts";

/**
 * Progress indicator for Ralph's feature-by-feature implementation.
 *
 * @deprecated Use {@link WorkflowProgressState} from `workflow-types.ts` instead.
 * This is now a type alias — the shapes are compatible (`currentFeature` maps
 * to `currentItem`).
 */
export interface FeatureProgressState {
  completed: number;
  total: number;
  currentFeature?: string;
}

/**
 * Convert a FeatureProgressState to the generic WorkflowProgressState.
 */
export function toWorkflowProgress(fp: FeatureProgressState | null): WorkflowProgressState | null {
  if (!fp) return null;
  return { completed: fp.completed, total: fp.total, currentItem: fp.currentFeature };
}

/**
 * Convert a generic WorkflowProgressState back to FeatureProgressState.
 */
export function fromWorkflowProgress(wp: WorkflowProgressState | null): FeatureProgressState | null {
  if (!wp) return null;
  return { completed: wp.completed, total: wp.total, currentFeature: wp.currentItem };
}

/**
 * Ralph-specific command/UI state that flows through WorkflowChatState.
 *
 * This interface extends the generic WorkflowCommandState with Ralph-specific
 * convenience accessors. The `approved` generic field maps to `specApproved`,
 * and `progress` maps to the feature progress concept.
 *
 * @deprecated Consumers should migrate to {@link WorkflowCommandState} from
 * `workflow-types.ts`. During the transition, RalphCommandState provides
 * backward-compatible field names alongside the generic ones.
 */
export interface RalphCommandState extends WorkflowCommandState {
  /** @deprecated Use `progress` instead (with WorkflowProgressState shape). */
  featureProgress: FeatureProgressState | null;
  /** @deprecated Use `approved` instead. */
  specApproved: boolean;
}

/** Default values for RalphCommandState — used when initializing or resetting. */
export const defaultRalphCommandState: RalphCommandState = {
  ...defaultWorkflowCommandState,
  featureProgress: null,
  specApproved: false,
};

/**
 * Runtime dependencies required by Ralph's custom graph nodes.
 *
 * Extracts the subset of GraphRuntimeDependencies actually used by the Ralph
 * workflow, marking the capabilities each node requires as non-optional while
 * keeping optional capabilities (taskIdentity, notifyTaskStatusChange) that
 * degrade gracefully when absent.
 */
export interface RalphRuntimeDependencies {
  /** Spawn a single sub-agent and await its result. */
  spawnSubagent: (
    agent: SubagentSpawnOptions,
    abortSignal?: AbortSignal,
  ) => Promise<SubagentStreamResult>;

  /** Spawn multiple sub-agents in parallel and await all results. */
  spawnSubagentParallel: (
    agents: SubagentSpawnOptions[],
    abortSignal?: AbortSignal,
    onAgentComplete?: (result: SubagentStreamResult) => void,
  ) => Promise<SubagentStreamResult[]>;

  /** Canonical task identity management (optional — degrades gracefully). */
  taskIdentity?: WorkflowRuntimeTaskIdentityRuntime;

  /** Publish workflow.task.statusChange events (optional — degrades gracefully). */
  notifyTaskStatusChange?: (
    taskIds: string[],
    newStatus: WorkflowRuntimeTaskStatus,
    tasks: WorkflowRuntimeTask[],
  ) => void;
}

/**
 * Ralph-specific workflow context passed to custom graph nodes.
 *
 * Provides a focused API surface for Ralph nodes instead of exposing
 * the entire generic ExecutionContext. Nodes consume only what they need:
 * - workflow state
 * - runtime dependencies (subagent spawning, task identity, status notification)
 * - abort signal
 */
export interface RalphWorkflowContext {
  /** Current workflow state (read-only snapshot). */
  readonly state: Readonly<RalphWorkflowState>;

  /** Ralph-specific runtime dependencies. */
  readonly runtime: RalphRuntimeDependencies;

  /** Cancellation signal for aborting long-running operations. */
  readonly abortSignal?: AbortSignal;
}

/**
 * Extract a RalphWorkflowContext from a generic ExecutionContext.
 *
 * Validates that required runtime dependencies (spawnSubagent,
 * spawnSubagentParallel) are present, throwing descriptive errors when a
 * required capability is missing. Optional capabilities (taskIdentity,
 * notifyTaskStatusChange) are forwarded as-is.
 */
export function toRalphWorkflowContext(
  ctx: ExecutionContext<RalphWorkflowState>,
): RalphWorkflowContext {
  const runtime = ctx.config.runtime;

  if (!runtime?.spawnSubagent) {
    throw new Error(
      "RalphWorkflowContext requires spawnSubagent in runtime config",
    );
  }
  if (!runtime?.spawnSubagentParallel) {
    throw new Error(
      "RalphWorkflowContext requires spawnSubagentParallel in runtime config",
    );
  }

  return {
    state: ctx.state,
    runtime: {
      spawnSubagent: runtime.spawnSubagent,
      spawnSubagentParallel: runtime.spawnSubagentParallel,
      taskIdentity: runtime.taskIdentity,
      notifyTaskStatusChange: runtime.notifyTaskStatusChange,
    },
    abortSignal: ctx.abortSignal,
  };
}
