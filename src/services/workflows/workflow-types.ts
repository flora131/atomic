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

export interface WorkflowTask {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "blocked";
  blockedBy?: string[];
  error?: string;
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
