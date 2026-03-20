/**
 * Workflow Type Definitions
 *
 * Shared types for the workflow system. These types are used by both
 * the command layer (`commands/tui/workflow-commands/`) and the service
 * layer (`services/workflows/`). They live in `services/workflows/` since
 * workflows are a service-layer concern, and services must not import
 * from commands.
 */

import type { BaseState, CompiledGraph, Edge, NodeDefinition } from "@/services/workflows/graph/types.ts";
import type { WorkflowRuntimeFeatureFlagOverrides } from "@/services/workflows/runtime-contracts.ts";

export interface WorkflowCommandArgs {
  prompt: string;
}

/** @deprecated Use {@link WorkflowCommandArgs} instead. */
export type RalphCommandArgs = WorkflowCommandArgs;

// ============================================================================
// GENERIC WORKFLOW COMMAND STATE
// ============================================================================

/**
 * Progress indicator for iterative workflows (e.g., feature-by-feature implementation).
 *
 * This is the generic version of what was previously `FeatureProgressState`
 * in Ralph's types. Any workflow that tracks progress through a list of items
 * can use this interface.
 */
export interface WorkflowProgressState {
  completed: number;
  total: number;
  currentItem?: string;
}

/**
 * Generic workflow command/UI state that flows through WorkflowChatState.
 *
 * Replaces the Ralph-specific `RalphCommandState`. This interface provides
 * workflow-agnostic fields that any workflow conductor can populate:
 *
 * - `currentNode` / `iteration` / `maxIterations` — execution progress
 * - `currentStage` / `stageIndicator` — stage-based conductor state
 * - `pendingApproval` / `approved` / `feedback` — HITL interaction
 * - `progress` — optional progress tracking for iterative workflows
 * - `extensions` — escape hatch for workflow-specific data
 */
export interface WorkflowCommandState {
  currentNode: string | null;
  iteration: number;
  maxIterations: number | undefined;
  currentStage: string | null;
  stageIndicator: string | null;
  progress: WorkflowProgressState | null;
  pendingApproval: boolean;
  approved: boolean;
  feedback: string | null;
  extensions: Record<string, unknown>;
}

/** Default values for WorkflowCommandState — used when initializing or resetting. */
export const defaultWorkflowCommandState: WorkflowCommandState = {
  currentNode: null,
  iteration: 0,
  maxIterations: undefined,
  currentStage: null,
  stageIndicator: null,
  progress: null,
  pendingApproval: false,
  approved: false,
  feedback: null,
  extensions: {},
};

export type WorkflowStateMigrator = (
  oldState: unknown,
  fromVersion: number,
) => BaseState;

export interface WorkflowMetadata {
  name: string;
  description: string;
  aliases?: string[];
  defaultConfig?: Record<string, unknown>;
  version?: string;
  minSDKVersion?: string;
  stateVersion?: number;
  migrateState?: WorkflowStateMigrator;
  source?: "builtin" | "global" | "local";
  argumentHint?: string;
}

export interface WorkflowGraphConfig<TState extends BaseState = BaseState> {
  nodes: NodeDefinition<TState>[];
  edges: Edge<TState>[];
  startNode: string;
  maxIterations?: number;
}

export interface WorkflowStateParams {
  prompt: string;
  sessionId: string;
  sessionDir: string;
  maxIterations: number;
}

export interface WorkflowDefinition extends WorkflowMetadata {
  graphConfig?: WorkflowGraphConfig;
  /**
   * Factory function returning a pre-compiled graph (builder pattern).
   * Used by workflows like Ralph that build graphs programmatically
   * instead of providing declarative graphConfig.
   */
  createGraph?: () => CompiledGraph<BaseState>;
  createState?: (params: WorkflowStateParams) => BaseState;
  nodeDescriptions?: Record<string, string>;
  runtime?: {
    featureFlags?: WorkflowRuntimeFeatureFlagOverrides;
  };
}
