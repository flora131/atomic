import type { z } from "zod";
import type { CodingAgentClient, Session, SessionConfig } from "../../sdk/types.ts";
import type { SubagentEntry } from "./subagent-registry.ts";

/**
 * Graph Execution Engine Types
 *
 * This module defines the core types for the graph-based workflow execution engine.
 * The graph engine enables declarative workflow definitions with support for:
 * - Node-based execution (agents, tools, decisions, waits)
 * - State management with typed annotations
 * - Checkpointing and resumption
 * - Human-in-the-loop interactions
 * - Error handling and retry logic
 *
 * Reference: Feature 9 - Create src/graph/types.ts with all graph type definitions
 */

// ============================================================================
// CHECKPOINTER INTERFACE (Forward declaration - full impl in checkpointer.ts)
// ============================================================================

/**
 * Interface for checkpoint storage and retrieval.
 * Implementations handle persisting execution state for resumption.
 *
 * @template TState - The state type being checkpointed
 */
export interface Checkpointer<TState extends BaseState = BaseState> {
  /**
   * Save a checkpoint of the current execution state.
   * @param executionId - Unique identifier for the execution
   * @param state - The state to checkpoint
   * @param label - Optional label for the checkpoint
   */
  save(executionId: string, state: TState, label?: string): Promise<void>;

  /**
   * Load the most recent checkpoint for an execution.
   * @param executionId - Unique identifier for the execution
   * @returns The checkpointed state, or null if not found
   */
  load(executionId: string): Promise<TState | null>;

  /**
   * List all checkpoint IDs for an execution.
   * @param executionId - Unique identifier for the execution
   * @returns Array of checkpoint labels/timestamps
   */
  list(executionId: string): Promise<string[]>;

  /**
   * Delete a specific checkpoint.
   * @param executionId - Unique identifier for the execution
   * @param label - Optional label to delete specific checkpoint
   */
  delete(executionId: string, label?: string): Promise<void>;
}

// ============================================================================
// NODE TYPES
// ============================================================================

/**
 * Unique identifier for a node in the graph.
 * Used to reference nodes when defining edges and control flow.
 */
export type NodeId = string;

/**
 * Model specification for agent nodes.
 *
 * Defines which LLM model an agent node should use. The format is SDK-specific:
 * - **Anthropic SDK**: `"claude-3-5-sonnet-20241022"`, `"claude-3-opus-20240229"`
 * - **OpenAI SDK**: `"gpt-4o"`, `"gpt-4-turbo"`, `"gpt-3.5-turbo"`
 * - **Google SDK**: `"gemini-1.5-pro"`, `"gemini-1.5-flash"`
 * - **Ollama**: `"llama3.1:70b"`, `"mistral:7b"`
 *
 * Special values:
 * - `"inherit"`: Use the model configured at the graph or session level
 *
 * @example
 * // Use a specific model
 * const modelSpec: ModelSpec = "claude-3-5-sonnet-20241022";
 *
 * @example
 * // Inherit from parent configuration
 * const modelSpec: ModelSpec = "inherit";
 */
export type ModelSpec = string | "inherit";

/**
 * Types of nodes supported in the graph execution engine.
 *
 * - `agent`: Executes an AI agent to process input and generate output
 * - `tool`: Executes a specific tool/function
 * - `decision`: Evaluates conditions to determine next node
 * - `wait`: Pauses execution for human input (legacy)
 * - `ask_user`: Pauses execution for explicit user question with structured options
 * - `subgraph`: Executes a nested graph
 * - `parallel`: Executes multiple branches concurrently
 */
export type NodeType = "agent" | "tool" | "decision" | "wait" | "ask_user" | "subgraph" | "parallel";

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * Base state interface for all graph executions.
 * All workflow states should extend this interface.
 */
export interface BaseState {
  /** Unique identifier for this execution instance */
  executionId: string;
  /** ISO timestamp of last state update */
  lastUpdated: string;
  /** Map of node outputs keyed by node ID */
  outputs: Record<NodeId, unknown>;
}

/**
 * Context usage tracking for monitoring token consumption.
 */
export interface ContextWindowUsage {
  /** Number of input tokens used */
  inputTokens: number;
  /** Number of output tokens used */
  outputTokens: number;
  /** Maximum tokens available */
  maxTokens: number;
  /** Usage as a percentage (0-100) */
  usagePercentage: number;
}

// ============================================================================
// SIGNALS
// ============================================================================

/**
 * Signal types that nodes can emit to affect execution flow.
 *
 * - `context_window_warning`: Context is approaching capacity, consider compaction
 * - `checkpoint`: Request to save current state
 * - `human_input_required`: Pause execution and wait for user input
 * - `debug_report_generated`: A debug report was created for an error
 */
export type Signal =
  | "context_window_warning"
  | "checkpoint"
  | "human_input_required"
  | "debug_report_generated";

/**
 * Data associated with a signal emission.
 */
export interface SignalData {
  /** The type of signal being emitted */
  type: Signal;
  /** Optional message describing the signal */
  message?: string;
  /** Additional data specific to the signal type */
  data?: Record<string, unknown>;
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Represents an error that occurred during node execution.
 */
export interface ExecutionError {
  /** ID of the node where the error occurred */
  nodeId: NodeId;
  /** The error that was thrown */
  error: Error | string;
  /** ISO timestamp when the error occurred */
  timestamp: string;
  /** Retry attempt number (1-based) */
  attempt: number;
}

/**
 * Configuration for retry behavior on node failures.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
  /** Initial delay between retries in milliseconds (default: 1000) */
  backoffMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number;
  /**
   * Optional predicate to determine if an error should be retried.
   * If not provided, all errors are retried up to maxAttempts.
   */
  retryOn?: (error: Error) => boolean;
}

/**
 * Action returned by node-level error handlers.
 */
export type ErrorAction<TState extends BaseState = BaseState> =
  | { action: "retry"; delay?: number }
  | { action: "skip"; fallbackState?: Partial<TState> }
  | { action: "abort"; error?: Error }
  | { action: "goto"; nodeId: NodeId };

/**
 * Debug report generated when an error occurs during execution.
 * Contains diagnostic information to help resolve the issue.
 */
export interface DebugReport {
  /** Brief summary of the error */
  errorSummary: string;
  /** Full stack trace if available */
  stackTrace?: string;
  /** Files that may be relevant to the error */
  relevantFiles: string[];
  /** Suggested fixes or actions to resolve the error */
  suggestedFixes: string[];
  /** ISO timestamp when the report was generated */
  generatedAt: string;
  /** Node ID where the error occurred */
  nodeId?: NodeId;
  /** Execution ID for correlation */
  executionId?: string;
}

// ============================================================================
// NODE EXECUTION
// ============================================================================

/**
 * Result returned from node execution.
 * Contains state updates, control flow instructions, and signals.
 *
 * @template TState - The state type for the workflow
 */
export interface NodeResult<TState extends BaseState = BaseState> {
  /**
   * Partial state update to merge into the current state.
   * Uses the annotation reducers to determine how to merge.
   */
  stateUpdate?: Partial<TState>;

  /**
   * Override the next node to execute.
   * If not provided, follows the default edge from this node.
   */
  goto?: NodeId | NodeId[];

  /**
   * Signals to emit that affect execution flow.
   */
  signals?: SignalData[];
}

/**
 * Context provided to node execution functions.
 * Contains current state, configuration, and utilities.
 *
 * @template TState - The state type for the workflow
 */
export interface ExecutionContext<TState extends BaseState = BaseState> {
  /** Current workflow state */
  state: TState;

  /** Graph configuration */
  config: GraphConfig;

  /** Errors that have occurred during execution */
  errors: ExecutionError[];

  /** Signal to abort execution */
  abortSignal?: AbortSignal;

  /** Current context window usage from agent sessions */
  contextWindowUsage?: ContextWindowUsage;

  /** Context window threshold percentage for triggering summarization */
  contextWindowThreshold?: number;

  /**
   * Emit a custom stream event during execution.
   * - `emit(type, data)` emits a custom stream event payload.
   */
  emit?: (type: string, data?: Record<string, unknown>) => void;

  /**
   * Get the output from a previously executed node.
   * @param nodeId - The ID of the node to get output from
   * @returns The output from the node, or undefined if not executed
   */
  getNodeOutput?: (nodeId: NodeId) => unknown;

  /**
   * Resolved model for this execution context.
   * Set by GraphExecutor based on node.model, parent context, or defaultModel.
   * Passed to agent nodes for session creation.
   */
  model?: string;
}

/**
 * Function type for node execution.
 *
 * @template TState - The state type for the workflow
 * @param context - The execution context with current state and utilities
 * @returns A promise resolving to the node result
 */
export type NodeExecuteFn<TState extends BaseState = BaseState> = (
  context: ExecutionContext<TState>
) => Promise<NodeResult<TState>>;

/**
 * Definition of a node in the graph.
 *
 * @template TState - The state type for the workflow
 */
export interface NodeDefinition<TState extends BaseState = BaseState> {
  /** Unique identifier for the node */
  id: NodeId;

  /** Type of node (determines execution behavior) */
  type: NodeType;

  /** Function to execute when the node is visited */
  execute: NodeExecuteFn<TState>;

  /** Optional schema for validating node input state before execution */
  inputSchema?: z.ZodType<TState>;

  /** Optional schema for validating node output state after execution */
  outputSchema?: z.ZodType<TState>;

  /** Optional retry configuration for error handling */
  retry?: RetryConfig;

  /**
   * Optional node-level error hook for custom recovery behavior.
   */
  onError?: (
    error: Error,
    context: ExecutionContext<TState>
  ) => ErrorAction<TState> | Promise<ErrorAction<TState>>;

  /**
   * Marks this node as a valid recovery target for `onError` goto actions.
   */
  isRecoveryNode?: boolean;

  /** Human-readable name for the node (used in logging/UI) */
  name?: string;

  /** Description of what the node does */
  description?: string;

  /**
   * Model specification for this node.
   *
   * Per-SDK behavior:
   * - **Claude** (`-a claude`): `'opus'`, `'sonnet'`, `'haiku'` aliases; `'inherit'` for parent; full ID supported
   * - **OpenCode** (`-a opencode`): `'providerID/modelID'` format; `'inherit'` for parent
   * - **Copilot** (`-a copilot`): Model IDs; `'inherit'` for session; NOTE: changes require new session
   */
  model?: ModelSpec;
}

// ============================================================================
// GRAPH CONFIGURATION
// ============================================================================

/**
 * Progress callback type for tracking execution progress.
 */
export interface ProgressEvent<TState extends BaseState = BaseState> {
  /** Type of progress event */
  type: "node_started" | "node_completed" | "node_error" | "checkpoint_saved";
  /** ID of the node this event relates to */
  nodeId: NodeId;
  /** Current state at time of event */
  state: TState;
  /** Error if this is an error event */
  error?: ExecutionError;
  /** Timestamp of the event */
  timestamp: string;
}

export interface RuntimeSubgraph {
  execute(state: BaseState): Promise<BaseState>;
}

// ============================================================================
// SUBAGENT TYPES
// ============================================================================

/**
 * Factory function that creates independent sessions for sub-agents.
 */
export type CreateSessionFn = (config?: SessionConfig) => Promise<Session>;

/**
 * Options for spawning a single sub-agent session.
 */
export interface SubagentSpawnOptions {
  /** Unique identifier for this sub-agent */
  agentId: string;
  /** Display name (e.g., "codebase-analyzer", "debugger") */
  agentName: string;
  /** Task description to send to the sub-agent */
  task: string;
  /** Optional system prompt override */
  systemPrompt?: string;
  /** Optional model override */
  model?: string;
  /** Optional tool restrictions */
  tools?: string[];
  /** Optional timeout in milliseconds. When exceeded, the session is aborted. */
  timeout?: number;
  /** Optional external abort signal (e.g., from Ctrl+C) to cancel the sub-agent. */
  abortSignal?: AbortSignal;
}

/**
 * Result returned after a sub-agent completes or fails.
 */
export interface SubagentResult {
  /** Agent identifier matching SubagentSpawnOptions.agentId */
  agentId: string;
  /** Whether the sub-agent completed successfully */
  success: boolean;
  /** Summary text returned to parent (truncated to MAX_SUMMARY_LENGTH) */
  output: string;
  /** Error message if the sub-agent failed */
  error?: string;
  /** Number of tool invocations during execution */
  toolUses: number;
  /** Execution duration in milliseconds */
  durationMs: number;
}

// ============================================================================
// GRAPH RUNTIME DEPENDENCIES
// ============================================================================

export interface GraphRuntimeDependencies {
  clientProvider?: (agentType: string) => CodingAgentClient | null;
  workflowResolver?: (name: string) => RuntimeSubgraph | null;
  spawnSubagent?: (agent: SubagentSpawnOptions, abortSignal?: AbortSignal) => Promise<SubagentResult>;
  spawnSubagentParallel?: (agents: SubagentSpawnOptions[], abortSignal?: AbortSignal) => Promise<SubagentResult[]>;
  subagentRegistry?: {
    get(name: string): SubagentEntry | undefined;
    getAll(): SubagentEntry[];
  };
}

/**
 * Configuration for graph execution.
 *
 * @template TState - The state type for the workflow
 */
export interface GraphConfig<TState extends BaseState = BaseState> {
  /**
   * Checkpointer for saving and restoring execution state.
   * If not provided, state is only kept in memory.
   */
  checkpointer?: Checkpointer<TState>;

  /**
   * Maximum number of nodes to execute concurrently (default: 1).
   * Only affects parallel nodes.
   */
  maxConcurrency?: number;

  /**
   * Maximum execution time in milliseconds (default: no limit).
   * Execution will be aborted if this limit is exceeded.
   */
  timeout?: number;

  /**
   * Callback for progress events during execution.
   */
  onProgress?: (event: ProgressEvent<TState>) => void;

  /**
   * Context window usage threshold (0-100) that triggers a warning signal.
   * Default: 45 (45%)
   */
  contextWindowThreshold?: number;

  /**
   * Whether to automatically checkpoint after each node completion.
   * Default: true
   */
  autoCheckpoint?: boolean;

  /**
   * Custom metadata to include with checkpoints.
   */
  metadata?: Record<string, unknown>;

  /**
   * Default model specification for graph execution.
   *
   * Used when nodes don't specify a model or use `'inherit'`.
   * Format: `'providerID/modelID'` (e.g., `'anthropic/claude-sonnet-4-5'`, `'openai/gpt-4.1'`)
   * Claude aliases (`opus`, `sonnet`, `haiku`) are also accepted.
   */
  defaultModel?: ModelSpec;

  /**
   * Optional runtime validation schema for workflow state.
   * When provided, state updates are validated after each node execution.
   */
  outputSchema?: z.ZodType<TState>;

  /**
   * Runtime dependencies provided by WorkflowSDK.init().
   * Used by node factories that require SDK services.
   */
  runtime?: GraphRuntimeDependencies;
}

// ============================================================================
// EDGE DEFINITIONS
// ============================================================================

/**
 * Condition function for conditional edges.
 *
 * @template TState - The state type for the workflow
 * @param state - The current workflow state
 * @returns True if the edge should be followed
 */
export type EdgeCondition<TState extends BaseState = BaseState> = (
  state: TState
) => boolean;

/**
 * Definition of an edge connecting two nodes.
 *
 * @template TState - The state type for the workflow
 */
export interface Edge<TState extends BaseState = BaseState> {
  /** Source node ID */
  from: NodeId;
  /** Target node ID */
  to: NodeId;
  /**
   * Optional condition for the edge.
   * If provided, the edge is only followed when the condition returns true.
   */
  condition?: EdgeCondition<TState>;
  /** Human-readable label for the edge (used in visualization) */
  label?: string;
}

// ============================================================================
// COMPILED GRAPH
// ============================================================================

/**
 * A compiled graph ready for execution.
 * Created by the GraphBuilder.compile() method.
 *
 * @template TState - The state type for the workflow
 */
export interface CompiledGraph<TState extends BaseState = BaseState> {
  /** All nodes in the graph */
  nodes: Map<NodeId, NodeDefinition<TState>>;
  /** All edges in the graph */
  edges: Edge<TState>[];
  /** The starting node ID */
  startNode: NodeId;
  /** Terminal node IDs (nodes with no outgoing edges) */
  endNodes: Set<NodeId>;
  /** Graph configuration */
  config: GraphConfig<TState>;
}

// ============================================================================
// EXECUTION STATE
// ============================================================================

/**
 * Status of a graph execution.
 */
export type ExecutionStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Snapshot of graph execution state.
 * Used for checkpointing and resumption.
 *
 * @template TState - The state type for the workflow
 */
export interface ExecutionSnapshot<TState extends BaseState = BaseState> {
  /** Unique identifier for this execution */
  executionId: string;
  /** Current workflow state */
  state: TState;
  /** Current execution status */
  status: ExecutionStatus;
  /** ID of the current node being executed (if running) */
  currentNodeId?: NodeId;
  /** IDs of nodes that have been visited */
  visitedNodes: NodeId[];
  /** Errors that occurred during execution */
  errors: ExecutionError[];
  /** Signals that have been emitted */
  signals: SignalData[];
  /** ISO timestamp when execution started */
  startedAt: string;
  /** ISO timestamp when execution was last updated */
  updatedAt: string;
  /** ISO timestamp when execution completed (if completed) */
  completedAt?: string;
  /** Total number of node executions */
  nodeExecutionCount: number;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a value is a valid NodeType.
 */
export function isNodeType(value: unknown): value is NodeType {
  return (
    typeof value === "string" &&
    ["agent", "tool", "decision", "wait", "subgraph", "parallel"].includes(value)
  );
}

/**
 * Type guard to check if a value is a valid Signal.
 */
export function isSignal(value: unknown): value is Signal {
  return (
    typeof value === "string" &&
    [
      "context_window_warning",
      "checkpoint",
      "human_input_required",
      "debug_report_generated",
    ].includes(value)
  );
}

/**
 * Type guard to check if a value is a valid ExecutionStatus.
 */
export function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return (
    typeof value === "string" &&
    ["pending", "running", "paused", "completed", "failed", "cancelled"].includes(
      value
    )
  );
}

/**
 * Type guard to check if an object implements BaseState.
 */
export function isBaseState(value: unknown): value is BaseState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.executionId === "string" &&
    typeof obj.lastUpdated === "string" &&
    typeof obj.outputs === "object" &&
    obj.outputs !== null
  );
}

/**
 * Type guard to check if an object is a NodeResult.
 */
export function isNodeResult(value: unknown): value is NodeResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  // NodeResult can be empty, so we just check that any present fields are valid
  if (obj.stateUpdate !== undefined && typeof obj.stateUpdate !== "object") {
    return false;
  }
  if (obj.goto !== undefined && typeof obj.goto !== "string" && !Array.isArray(obj.goto)) {
    return false;
  }
  if (obj.signals !== undefined && !Array.isArray(obj.signals)) {
    return false;
  }
  return true;
}

/**
 * Type guard to check if an object is a DebugReport.
 */
export function isDebugReport(value: unknown): value is DebugReport {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.errorSummary === "string" &&
    Array.isArray(obj.relevantFiles) &&
    Array.isArray(obj.suggestedFixes) &&
    typeof obj.generatedAt === "string"
  );
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Extract the state type from a NodeDefinition.
 */
export type StateOf<T> = T extends NodeDefinition<infer S> ? S : never;

/**
 * Create a partial state update type.
 */
export type StateUpdate<TState extends BaseState> = Partial<Omit<TState, keyof BaseState>> & {
  outputs?: Record<NodeId, unknown>;
};

/** Compaction triggers at 45% context usage. */
export const BACKGROUND_COMPACTION_THRESHOLD = 0.45;
/** Buffer exhaustion at 60% context usage. */
export const BUFFER_EXHAUSTION_THRESHOLD = 0.6;

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
};

/**
 * Default graph configuration.
 */
export const DEFAULT_GRAPH_CONFIG: Partial<GraphConfig> = {
  maxConcurrency: 1,
  contextWindowThreshold: BACKGROUND_COMPACTION_THRESHOLD * 100,
  autoCheckpoint: true,
};

// ============================================================================
// WORKFLOW TOOL CONTEXT
// ============================================================================

/**
 * Extended tool context for custom tools invoked from graph nodes via customToolNode().
 * Passed unconditionally — existing tools that only use base ToolContext properties
 * work unchanged due to structural typing.
 */
export interface WorkflowToolContext {
  /** Session ID (maps to execution ID in workflow context) */
  sessionID: string;
  /** Unique message ID for this tool invocation */
  messageID: string;
  /** Agent identifier (set to "workflow" for graph-invoked tools) */
  agent: string;
  /** Current working directory */
  directory: string;
  /** Abort signal for timeout/cancellation */
  abort: AbortSignal;
  /** Read-only snapshot of the current workflow state */
  workflowState: Readonly<Record<string, unknown>>;
  /** The graph node ID invoking this tool */
  nodeId: string;
  /** The workflow execution ID */
  executionId: string;
}
