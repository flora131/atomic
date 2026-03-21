/**
 * Workflow Definition Types
 *
 * Core type definitions for workflow metadata and definition contracts.
 * These types describe how a workflow is declared and registered.
 */

import type { BaseState, CompiledGraph, Edge, NodeDefinition } from "@/services/workflows/graph/types.ts";
import type { WorkflowRuntimeFeatureFlagOverrides } from "@/services/workflows/runtime-contracts.ts";
import type { StageDefinition } from "@/services/workflows/conductor/types.ts";

export interface WorkflowMetadata {
  name: string;
  description: string;
  /** @deprecated Use workflow name directly for command routing. Will be removed in a future release. */
  aliases?: string[];
  defaultConfig?: Record<string, unknown>;
  version?: string;
  minSDKVersion?: string;
  /** @deprecated State migration is no longer supported. Will be removed in a future release. */
  stateVersion?: number;
  /** @deprecated State migration is no longer supported. Will be removed in a future release. */
  migrateState?: WorkflowStateMigrator;
  source?: "builtin" | "global" | "local";
  argumentHint?: string;
}

/** @deprecated State migration is no longer supported. Will be removed in a future release. */
export type WorkflowStateMigrator = (
  oldState: unknown,
  fromVersion: number,
) => BaseState;

/** @deprecated Use conductor stages instead of declarative graph config. Will be removed in a future release. */
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
  /** @deprecated Use conductor stages instead of declarative graph config. Will be removed in a future release. */
  graphConfig?: WorkflowGraphConfig;
  /**
   * Factory function returning a pre-compiled graph (builder pattern).
   * Used by workflows like Ralph that build graphs programmatically
   * instead of providing declarative graphConfig.
   *
   * @deprecated Use `createConductorGraph` instead. Will be removed in a future release.
   */
  createGraph?: () => CompiledGraph<BaseState>;
  createState?: (params: WorkflowStateParams) => BaseState;
  nodeDescriptions?: Record<string, string>;
  /**
   * Conductor stage definitions. When present, the command factory uses
   * the `WorkflowSessionConductor` to execute the workflow instead of
   * the legacy `streamGraph()` executor. Each "agent" node in the
   * compiled graph is matched to a `StageDefinition` by ID.
   */
  conductorStages?: readonly StageDefinition[];
  /**
   * Factory for a conductor-specific compiled graph. This graph typically
   * contains only agent nodes (no tool nodes), since the conductor's
   * stage definitions handle inter-stage communication. When omitted,
   * the conductor falls back to `createGraph()` or `graphConfig`.
   */
  createConductorGraph?: () => CompiledGraph<BaseState>;
  runtime?: {
    featureFlags?: WorkflowRuntimeFeatureFlagOverrides;
  };
}
