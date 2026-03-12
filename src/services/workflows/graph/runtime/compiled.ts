/**
 * CompiledGraph Execution Engine
 *
 * This module provides the execution engine for compiled graphs.
 * It handles:
 * - BFS-style graph traversal
 * - State management with annotation reducers
 * - Retry with exponential backoff
 * - Checkpointing for resumption
 * - Signal handling (human_input_required, checkpoint, etc.)
 * - Streaming execution via AsyncGenerator
 *
 * Reference: Feature 13 - Implement CompiledGraph execution engine
 */

import type {
  BaseState,
  NodeId,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
  ExecutionError,
  ExecutionSnapshot,
  ExecutionStatus,
  GraphConfig,
  CompiledGraph,
  Checkpointer,
} from "@/services/workflows/graph/types.ts";
import { DEFAULT_GRAPH_CONFIG } from "@/services/workflows/graph/types.ts";
import type { WorkflowTelemetryConfig } from "@/services/telemetry/graph-integration.ts";
import { StateValidator } from "@/services/workflows/graph/state-validator.ts";
import type { StreamEvent, StreamMode } from "@/services/workflows/graph/stream.ts";
import { routeStream } from "@/services/workflows/graph/stream.ts";
import {
  createExecutionSnapshot,
  executeGraphStreamSteps,
  executeNodeWithRetry,
  getNextExecutableNodes,
  resolveNodeModel,
  saveExecutionCheckpoint,
} from "@/services/workflows/graph/runtime/execution-ops.ts";
export {
  generateExecutionId,
  initializeExecutionState,
  isLoopNode,
  mergeState,
} from "@/services/workflows/graph/runtime/execution-state.ts";

// ============================================================================
// EXECUTION TYPES
// ============================================================================

/**
 * Options for graph execution.
 *
 * @template TState - The state type for the workflow
 */
export interface ExecutionOptions<TState extends BaseState = BaseState> {
  /** Initial state to use (overrides default initialization) */
  initialState?: Partial<TState>;

  /** Execution ID (auto-generated if not provided) */
  executionId?: string;

  /** Resume from a previous snapshot */
  resumeFrom?: ExecutionSnapshot<TState>;

  /** AbortSignal for cancellation */
  abortSignal?: AbortSignal;

  /** Maximum number of nodes to execute (safety limit) */
  maxSteps?: number;

  /** Workflow name for telemetry tracking */
  workflowName?: string;

  /** Telemetry configuration */
  telemetry?: WorkflowTelemetryConfig;
}

/**
 * Result of a single node execution step.
 *
 * @template TState - The state type
 */
export interface StepResult<TState extends BaseState = BaseState> {
  /** The node that was executed */
  nodeId: NodeId;

  /** Updated state after execution */
  state: TState;

  /** Result from the node execution */
  result: NodeResult<TState>;

  /** Current execution status */
  status: ExecutionStatus;

  /** Any error that occurred */
  error?: ExecutionError;

  /** Total execution time for this node in milliseconds */
  executionTime?: number;

  /** Number of retries before this step succeeded */
  retryCount?: number;

  /** Resolved model used for this node execution */
  modelUsed?: string;

  /** Custom events emitted by the node during execution */
  emittedEvents?: EmittedEvent[];
}

/**
 * Custom event emitted by a node execution context.
 */
export interface EmittedEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/**
 * Final result of graph execution.
 *
 * @template TState - The state type
 */
export interface ExecutionResult<TState extends BaseState = BaseState> {
  /** Final state after execution */
  state: TState;

  /** Final execution status */
  status: ExecutionStatus;

  /** Full execution snapshot for checkpointing */
  snapshot: ExecutionSnapshot<TState>;
}

type RoutedExecutionOptions<TState extends BaseState = BaseState> =
  ExecutionOptions<TState> & { modes: StreamMode[] | undefined };

function hasRoutedModes<TState extends BaseState = BaseState>(
  options: ExecutionOptions<TState> | RoutedExecutionOptions<TState>
): options is RoutedExecutionOptions<TState> {
  return Object.prototype.hasOwnProperty.call(options, "modes");
}

// ============================================================================
// GRAPH EXECUTOR CLASS
// ============================================================================

/**
 * Executor for compiled graphs.
 *
 * Handles the actual execution of nodes, managing:
 * - Graph traversal
 * - State updates
 * - Retry logic
 * - Checkpointing
 * - Signal handling
 *
 * @template TState - The state type for the workflow
 */
export class GraphExecutor<TState extends BaseState = BaseState> {
  private readonly graph: CompiledGraph<TState>;
  private readonly config: GraphConfig<TState>;
  private readonly stateValidator: StateValidator<TState>;

  constructor(graph: CompiledGraph<TState>) {
    this.graph = graph;
    // Type assertion needed due to generic constraints
    this.config = {
      ...DEFAULT_GRAPH_CONFIG,
      ...graph.config,
    } as GraphConfig<TState>;
    this.stateValidator = StateValidator.fromGraphConfig(this.config);
  }

  /**
   * Execute the graph and return the final result.
   *
   * @param options - Execution options
   * @returns Final execution result
   */
  async execute(options: ExecutionOptions<TState> = {}): Promise<ExecutionResult<TState>> {
    let lastResult: StepResult<TState> | undefined;

    for await (const stepResult of this.stream(options)) {
      lastResult = stepResult;

      // Stop on terminal states
      if (
        stepResult.status === "completed" ||
        stepResult.status === "failed" ||
        stepResult.status === "cancelled" ||
        stepResult.status === "paused"
      ) {
        break;
      }
    }

    if (!lastResult) {
      throw new Error("Graph execution produced no results");
    }

    return {
      state: lastResult.state,
      status: lastResult.status,
      snapshot: this.createSnapshot(lastResult),
    };
  }

  /**
   * Execute the graph as a stream, yielding after each node.
   *
   * @param options - Execution options
   * @yields StepResult for each executed node by default
   * @yields StreamEvent when stream modes are provided
   */
  stream(options?: ExecutionOptions<TState>): AsyncGenerator<StepResult<TState>>;
  stream(options: RoutedExecutionOptions<TState>): AsyncGenerator<StreamEvent<TState>>;
  async *stream(
    options: ExecutionOptions<TState> | RoutedExecutionOptions<TState> = {}
  ): AsyncGenerator<StepResult<TState> | StreamEvent<TState>> {
    if (hasRoutedModes(options)) {
      yield* routeStream(this.streamSteps(options), options.modes);
      return;
    }

    yield* this.streamSteps(options);
  }

  private async *streamSteps(
    options: ExecutionOptions<TState> = {}
  ): AsyncGenerator<StepResult<TState>> {
    yield* executeGraphStreamSteps({
      graph: this.graph,
      config: this.config,
      stateValidator: this.stateValidator,
      options,
    });
  }

  /**
   * Resolve the model for a node based on resolution order:
   * 1. node.model (if not 'inherit')
   * 2. parentContext.model (inherited from parent)
   * 3. config.defaultModel (if not 'inherit')
   * 4. undefined (let SDK use its default)
   */
  private resolveModel(
    node: NodeDefinition<TState>,
    parentContext?: ExecutionContext<TState>
  ): string | undefined {
    return resolveNodeModel(node, this.config, parentContext);
  }

  /**
   * Execute a node with retry logic.
   */
  private async executeWithRetry(
    node: NodeDefinition<TState>,
    state: TState,
    errors: ExecutionError[],
    abortSignal?: AbortSignal,
    parentContext?: ExecutionContext<TState>
  ): Promise<{
    result: NodeResult<TState>;
    retryCount: number;
    modelUsed?: string;
    emittedEvents: EmittedEvent[];
  }> {
    return executeNodeWithRetry({
      graph: this.graph,
      config: this.config,
      stateValidator: this.stateValidator,
      node,
      state,
      errors,
      abortSignal,
      parentContext,
    });
  }

  /**
   * Get the next nodes to execute based on edges and result.
   */
  private getNextNodes(
    currentNodeId: NodeId,
    state: TState,
    result: NodeResult<TState>
  ): NodeId[] {
    return getNextExecutableNodes(this.graph, currentNodeId, state, result);
  }

  /**
   * Save a checkpoint using the checkpointer.
   */
  private async saveCheckpoint(
    checkpointer: Checkpointer<TState>,
    executionId: string,
    state: TState,
    label: string
  ): Promise<void> {
    await saveExecutionCheckpoint({
      checkpointer,
      config: this.config,
      executionId,
      state,
      label,
    });
  }

  /**
   * Create an execution snapshot from a step result.
   */
  private createSnapshot(stepResult: StepResult<TState>): ExecutionSnapshot<TState> {
    return createExecutionSnapshot(stepResult);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a graph executor from a compiled graph.
 *
 * @template TState - The state type
 * @param graph - The compiled graph
 * @returns A GraphExecutor instance
 *
 * @example
 * ```typescript
 * const workflow = graph<MyState>()
 *   .start(researchNode)
 *   .then(processNode)
 *   .end()
 *   .compile();
 *
 * const executor = createExecutor(workflow);
 * const result = await executor.execute();
 * ```
 */
export function createExecutor<TState extends BaseState = BaseState>(
  graph: CompiledGraph<TState>
): GraphExecutor<TState> {
  return new GraphExecutor(graph);
}

/**
 * Execute a compiled graph directly.
 *
 * @template TState - The state type
 * @param graph - The compiled graph
 * @param options - Execution options
 * @returns Execution result
 */
export async function executeGraph<TState extends BaseState = BaseState>(
  graph: CompiledGraph<TState>,
  options?: ExecutionOptions<TState>
): Promise<ExecutionResult<TState>> {
  const executor = createExecutor(graph);
  return executor.execute(options);
}

/**
 * Stream execution of a compiled graph.
 *
 * @template TState - The state type
 * @param graph - The compiled graph
 * @param options - Execution options
 * @yields StepResult for each executed node by default
 * @yields StreamEvent when stream modes are provided
 */
export function streamGraph<TState extends BaseState = BaseState>(
  graph: CompiledGraph<TState>,
  options?: ExecutionOptions<TState>
): AsyncGenerator<StepResult<TState>>;
export function streamGraph<TState extends BaseState = BaseState>(
  graph: CompiledGraph<TState>,
  options: RoutedExecutionOptions<TState>
): AsyncGenerator<StreamEvent<TState>>;
export async function* streamGraph<TState extends BaseState = BaseState>(
  graph: CompiledGraph<TState>,
  options?: ExecutionOptions<TState> | RoutedExecutionOptions<TState>
): AsyncGenerator<StepResult<TState> | StreamEvent<TState>> {
  const executor = createExecutor(graph);
  yield* executor.stream(options ?? {});
}
