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

  /**
   * Emit a signal during execution.
   * @param signal - The signal data to emit
   */
  emit?: (signal: SignalData) => void;

  /**
   * Get the output from a previously executed node.
   * @param nodeId - The ID of the node to get output from
   * @returns The output from the node, or undefined if not executed
   */
  getNodeOutput?: (nodeId: NodeId) => unknown;
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

  /** Optional retry configuration for error handling */
  retry?: RetryConfig;

  /** Human-readable name for the node (used in logging/UI) */
  name?: string;

  /** Description of what the node does */
  description?: string;
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
   * Default: 60 (60%)
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
  contextWindowThreshold: 60,
  autoCheckpoint: true,
};
