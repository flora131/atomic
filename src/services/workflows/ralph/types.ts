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

/**
 * Progress indicator for Ralph's feature-by-feature implementation.
 */
export interface FeatureProgressState {
  completed: number;
  total: number;
  currentFeature?: string;
}

/**
 * Ralph-specific command/UI state that flows through WorkflowChatState.
 *
 * Previously these fields were inlined in the shared CommandContextState,
 * coupling every consumer of CommandContext to Ralph-specific concerns.
 * Now they live under `WorkflowChatState.ralphState` and are typed here.
 */
export interface RalphCommandState {
  currentNode: string | null;
  iteration: number;
  maxIterations: number | undefined;
  featureProgress: FeatureProgressState | null;
  pendingApproval: boolean;
  specApproved: boolean;
  feedback: string | null;
}

/** Default values for RalphCommandState — used when initializing or resetting. */
export const defaultRalphCommandState: RalphCommandState = {
  currentNode: null,
  iteration: 0,
  maxIterations: undefined,
  featureProgress: null,
  pendingApproval: false,
  specApproved: false,
  feedback: null,
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
