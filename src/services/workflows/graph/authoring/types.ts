import type {
  BaseState,
  EdgeCondition,
  NodeDefinition,
  NodeId,
  RetryConfig,
} from "@/services/workflows/graph/types.ts";
import type { SubagentStreamResult } from "@/services/workflows/graph/types.ts";

export interface LoopConfig<TState extends BaseState = BaseState> {
  until: EdgeCondition<TState>;
  maxIterations?: number;
}

export type MergeStrategy = "all" | "race" | "any";

export interface ParallelConfig<TState extends BaseState = BaseState> {
  branches: NodeId[];
  strategy?: MergeStrategy;
  merge?: (results: Map<NodeId, unknown>, state: TState) => Partial<TState>;
}

export interface SubAgentConfig<TState extends BaseState> {
  id: string;
  agent: string;
  task: string | ((state: TState) => string);
  model?: string;
  tools?: string[];
  outputMapper?: (
    result: SubagentStreamResult,
    state: TState,
  ) => Partial<TState>;
  retry?: RetryConfig;
  name?: string;
  description?: string;
}

export interface ToolBuilderConfig<
  TState extends BaseState,
  TArgs = unknown,
  TResult = unknown,
> {
  id: string;
  toolName?: string;
  execute?: (args: TArgs, abortSignal?: AbortSignal) => Promise<TResult>;
  args?: TArgs | ((state: TState) => TArgs);
  outputMapper?: (result: TResult, state: TState) => Partial<TState>;
  timeout?: number;
  retry?: RetryConfig;
  name?: string;
  description?: string;
}

export interface IfConfig<TState extends BaseState> {
  condition: (state: TState) => boolean;
  then: NodeDefinition<TState>[];
  else_if?: {
    condition: (state: TState) => boolean;
    then: NodeDefinition<TState>[];
  }[];
  else?: NodeDefinition<TState>[];
}

export interface ConditionalBranch<TState extends BaseState = BaseState> {
  decisionNodeId: NodeId;
  condition: EdgeCondition<TState>;
  ifBranchStart?: NodeId;
  ifBranchEnd?: NodeId;
  elseBranchStart?: NodeId;
  elseBranchEnd?: NodeId;
  inElseBranch: boolean;
}

export interface AuthoringGraphOps<TState extends BaseState = BaseState> {
  addNode(node: NodeDefinition<TState>): void;
  addEdge(
    from: NodeId,
    to: NodeId,
    condition?: EdgeCondition<TState>,
    label?: string,
  ): void;
  generateNodeId(prefix?: string): NodeId;
}

export interface ConditionalDslState<TState extends BaseState = BaseState> {
  currentNodeId: NodeId | null;
  conditionalStack: ConditionalBranch<TState>[];
}

export interface IterationDslState<TState extends BaseState = BaseState> {
  startNodeId: NodeId | null;
  currentNodeId: NodeId | null;
  pendingEdgeCondition?: EdgeCondition<TState>;
  pendingEdgeLabel?: string;
}
