import type { z } from "zod";
import type { CodingAgentClient, Session, SessionConfig } from "@/services/agents/types.ts";
import type { SubagentEntry } from "@/services/workflows/graph/subagent-registry.ts";
import type {
  BaseState,
  Checkpointer,
  ContextWindowUsage,
  DebugReport,
  ErrorAction,
  ExecutionError,
  ModelSpec,
  NodeId,
  NodeType,
  RetryConfig,
  SignalData,
} from "@/services/workflows/graph/contracts/core.ts";
import type {
  WorkflowRuntimeFeatureFlags,
  WorkflowRuntimeTask,
  WorkflowRuntimeTaskIdentityRuntime,
} from "@/services/workflows/runtime-contracts.ts";

export interface NodeResult<TState extends BaseState = BaseState> {
  stateUpdate?: Partial<TState>;
  goto?: NodeId | NodeId[];
  signals?: SignalData[];
}

export interface ExecutionContext<TState extends BaseState = BaseState> {
  state: TState;
  config: GraphConfig;
  errors: ExecutionError[];
  abortSignal?: AbortSignal;
  contextWindowUsage?: ContextWindowUsage;
  contextWindowThreshold?: number;
  emit?: (type: string, data?: Record<string, unknown>) => void;
  getNodeOutput?: (nodeId: NodeId) => unknown;
  model?: string;
}

export type NodeExecuteFn<TState extends BaseState = BaseState> = (
  context: ExecutionContext<TState>
) => Promise<NodeResult<TState>>;

export interface NodeDefinition<TState extends BaseState = BaseState> {
  id: NodeId;
  type: NodeType;
  execute: NodeExecuteFn<TState>;
  inputSchema?: z.ZodType<TState>;
  outputSchema?: z.ZodType<TState>;
  retry?: RetryConfig;
  onError?: (
    error: Error,
    context: ExecutionContext<TState>
  ) => ErrorAction<TState> | Promise<ErrorAction<TState>>;
  isRecoveryNode?: boolean;
  name?: string;
  description?: string;
  model?: ModelSpec;
}

export interface ProgressEvent<TState extends BaseState = BaseState> {
  type: "node_started" | "node_completed" | "node_error" | "checkpoint_saved";
  nodeId: NodeId;
  state: TState;
  error?: ExecutionError;
  timestamp: string;
}

export interface RuntimeSubgraph {
  execute(state: BaseState): Promise<BaseState>;
}

export type CreateSessionFn = (config?: SessionConfig) => Promise<Session>;

export interface SubagentSpawnOptions {
  agentId: string;
  agentName: string;
  task: string;
  model?: string;
  tools?: string[];
  timeout?: number;
  abortSignal?: AbortSignal;
}

export interface SubagentToolDetail {
  toolId: string;
  toolName: string;
  durationMs: number;
  success: boolean;
}

export interface SubagentStreamResult {
  agentId: string;
  success: boolean;
  output: string;
  error?: string;
  toolUses: number;
  durationMs: number;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  thinkingDurationMs?: number;
  toolDetails?: SubagentToolDetail[];
}

export interface GraphRuntimeDependencies {
  clientProvider?: (agentType: string) => CodingAgentClient | null;
  workflowResolver?: (name: string) => RuntimeSubgraph | null;
  spawnSubagent?: (agent: SubagentSpawnOptions, abortSignal?: AbortSignal) => Promise<SubagentStreamResult>;
  spawnSubagentParallel?: (agents: SubagentSpawnOptions[], abortSignal?: AbortSignal) => Promise<SubagentStreamResult[]>;
  taskIdentity?: WorkflowRuntimeTaskIdentityRuntime;
  featureFlags?: WorkflowRuntimeFeatureFlags;
  subagentRegistry?: {
    get(name: string): SubagentEntry | undefined;
    getAll(): SubagentEntry[];
  };
  notifyTaskStatusChange?: (
    taskIds: string[],
    newStatus: string,
    tasks: WorkflowRuntimeTask[],
  ) => void;
}

export interface GraphConfig<TState extends BaseState = BaseState> {
  checkpointer?: Checkpointer<TState>;
  maxConcurrency?: number;
  timeout?: number;
  onProgress?: (event: ProgressEvent<TState>) => void;
  contextWindowThreshold?: number;
  autoCheckpoint?: boolean;
  metadata?: Record<string, unknown>;
  defaultModel?: ModelSpec;
  outputSchema?: z.ZodType<TState>;
  runtime?: GraphRuntimeDependencies;
}

export type EdgeCondition<TState extends BaseState = BaseState> = (
  state: TState
) => boolean;

export interface Edge<TState extends BaseState = BaseState> {
  from: NodeId;
  to: NodeId;
  condition?: EdgeCondition<TState>;
  label?: string;
}

export interface CompiledGraph<TState extends BaseState = BaseState> {
  nodes: Map<NodeId, NodeDefinition<TState>>;
  edges: Edge<TState>[];
  startNode: NodeId;
  endNodes: Set<NodeId>;
  config: GraphConfig<TState>;
}

export type ExecutionStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface ExecutionSnapshot<TState extends BaseState = BaseState> {
  executionId: string;
  state: TState;
  status: ExecutionStatus;
  currentNodeId?: NodeId;
  visitedNodes: NodeId[];
  errors: ExecutionError[];
  signals: SignalData[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  nodeExecutionCount: number;
}

export type StateOf<T> = T extends NodeDefinition<infer S> ? S : never;

export type StateUpdate<TState extends BaseState> = Partial<Omit<TState, keyof BaseState>> & {
  outputs?: Record<NodeId, unknown>;
};

export interface WorkflowToolContext {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  abort: AbortSignal;
  workflowState: Readonly<Record<string, unknown>>;
  nodeId: string;
  executionId: string;
}

export type { DebugReport };
