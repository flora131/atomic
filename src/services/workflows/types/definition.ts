/**
 * Workflow Definition Types
 *
 * Core type definitions for workflow metadata and definition contracts.
 * These types describe how a workflow is declared and registered.
 */

import type { BaseState, CompiledGraph } from "@/services/workflows/graph/types.ts";
import type { WorkflowRuntimeFeatureFlagOverrides } from "@/services/workflows/runtime-contracts.ts";
import type { StageDefinition } from "@/services/workflows/conductor/types.ts";

export interface WorkflowMetadata {
  name: string;
  description: string;
  defaultConfig?: Record<string, unknown>;
  version?: string;
  minSDKVersion?: string;
  source?: "builtin" | "global" | "local";
  argumentHint?: string;
}

export interface WorkflowStateParams {
  prompt: string;
  sessionId: string;
  sessionDir: string;
}

export interface WorkflowDefinition extends WorkflowMetadata {
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
   * stage definitions handle inter-stage communication.
   */
  createConductorGraph?: () => CompiledGraph<BaseState>;
  runtime?: {
    featureFlags?: WorkflowRuntimeFeatureFlagOverrides;
  };
  /**
   * State field names declared in globalState (used for verification).
   * Populated by the DSL compiler from the globalState schema so the
   * verifier can treat these fields as having initial default values.
   */
  stateFields?: string[];
}
