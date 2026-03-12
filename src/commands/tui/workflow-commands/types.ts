import type { BaseState, Edge, NodeDefinition } from "@/services/workflows/graph/types.ts";
import type { WorkflowRuntimeFeatureFlagOverrides } from "@/services/workflows/runtime-contracts.ts";

export interface RalphCommandArgs {
  prompt: string;
}

export function parseRalphArgs(args: string): RalphCommandArgs {
  const trimmed = args.trim();

  if (!trimmed) {
    throw new Error(
      'Usage: /ralph "<prompt-or-spec-path>"\n' +
        "A prompt argument is required.",
    );
  }

  return { prompt: trimmed };
}

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
  createState?: (params: WorkflowStateParams) => BaseState;
  nodeDescriptions?: Record<string, string>;
  runtime?: {
    featureFlags?: WorkflowRuntimeFeatureFlagOverrides;
  };
}
