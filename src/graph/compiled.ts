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
  SignalData,
  Edge,
  Checkpointer,
} from "./types.ts";
import { DEFAULT_RETRY_CONFIG, DEFAULT_GRAPH_CONFIG } from "./types.ts";
import {
  trackWorkflowExecution,
  type WorkflowTracker,
  type WorkflowTelemetryConfig,
} from "../telemetry/graph-integration.ts";

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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique execution ID.
 */
function generateExecutionId(): string {
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get current ISO timestamp.
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a node is a loop-related node (for special handling).
 */
export function isLoopNode(nodeId: NodeId): boolean {
  return nodeId.includes("loop_start") || nodeId.includes("loop_check");
}

/**
 * Initialize execution state with base fields.
 *
 * @template TState - The state type
 * @param executionId - The execution ID
 * @param initial - Optional initial state values
 * @returns Initialized state
 */
export function initializeExecutionState<TState extends BaseState>(
  executionId: string,
  initial?: Partial<TState>
): TState {
  // Start with a fresh base state
  const baseState: BaseState = {
    executionId,
    lastUpdated: now(),
    outputs: {},
  };

  // Merge initial values, ensuring outputs is preserved properly
  const initialOutputs = initial?.outputs ?? {};

  return {
    ...baseState,
    ...initial,
    outputs: { ...baseState.outputs, ...initialOutputs },
    executionId, // Ensure executionId is not overwritten
    lastUpdated: now(), // Always use current timestamp
  } as TState;
}

/**
 * Merge state updates immutably.
 *
 * @template TState - The state type
 * @param current - Current state
 * @param update - Partial update to apply
 * @returns New state with updates applied
 */
export function mergeState<TState extends BaseState>(
  current: TState,
  update: Partial<TState>
): TState {
  // Handle outputs specially - merge rather than replace
  const outputs =
    update.outputs !== undefined
      ? { ...current.outputs, ...update.outputs }
      : current.outputs;

  return {
    ...current,
    ...update,
    outputs,
    lastUpdated: now(),
  };
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

  constructor(graph: CompiledGraph<TState>) {
    this.graph = graph;
    // Type assertion needed due to generic constraints
    this.config = {
      ...DEFAULT_GRAPH_CONFIG,
      ...graph.config,
    } as GraphConfig<TState>;
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
   * @yields StepResult for each executed node
   */
  async *stream(options: ExecutionOptions<TState> = {}): AsyncGenerator<StepResult<TState>> {
    const executionId = options.executionId ?? generateExecutionId();
    const maxSteps = options.maxSteps ?? 1000;
    const workflowStartTime = Date.now();

    // Initialize telemetry tracker
    const tracker: WorkflowTracker | null = options.telemetry
      ? trackWorkflowExecution(executionId, options.telemetry)
      : null;

    // Track workflow start
    if (tracker) {
      tracker.start(options.workflowName ?? "unnamed", {
        maxSteps,
        resuming: !!options.resumeFrom,
      });
    }

    // Initialize or resume state
    let state: TState;
    let visitedNodes: NodeId[] = [];
    let errors: ExecutionError[] = [];
    let signals: SignalData[] = [];
    let nodeQueue: NodeId[];
    let stepCount = 0;

    if (options.resumeFrom) {
      // Resume from snapshot
      const snapshot = options.resumeFrom;
      state = snapshot.state;
      visitedNodes = [...snapshot.visitedNodes];
      errors = [...snapshot.errors];
      signals = [...snapshot.signals];
      nodeQueue = snapshot.currentNodeId ? [snapshot.currentNodeId] : [];
    } else {
      // Fresh start
      state = initializeExecutionState<TState>(executionId, options.initialState);
      nodeQueue = [this.graph.startNode];
    }

    // Track visited for loop detection (per-execution, not permanent)
    const executionVisited = new Set<string>();

    while (nodeQueue.length > 0 && stepCount < maxSteps) {
      // Check for abort
      if (options.abortSignal?.aborted) {
        // Track workflow cancellation as completion with failure
        if (tracker) {
          tracker.complete(false, Date.now() - workflowStartTime);
        }
        yield {
          nodeId: nodeQueue[0]!,
          state,
          result: {},
          status: "cancelled",
        };
        return;
      }

      const currentNodeId = nodeQueue.shift()!;
      const node = this.graph.nodes.get(currentNodeId);

      if (!node) {
        errors.push({
          nodeId: currentNodeId,
          error: new Error(`Node "${currentNodeId}" not found in graph`),
          timestamp: now(),
          attempt: 1,
        });
        continue;
      }

      // Create visit key for loop detection
      const visitKey = `${currentNodeId}:${stepCount}`;
      if (executionVisited.has(visitKey) && !isLoopNode(currentNodeId)) {
        // Already visited this exact step, skip to prevent infinite loop
        continue;
      }
      executionVisited.add(visitKey);

      // Track node enter
      const nodeStartTime = Date.now();
      if (tracker) {
        tracker.nodeEnter(currentNodeId, node.type);
      }

      // Execute node with retry
      let result: NodeResult<TState>;
      let nodeError: ExecutionError | undefined;

      try {
        result = await this.executeWithRetry(node, state, errors, options.abortSignal);
      } catch (error) {
        nodeError = {
          nodeId: currentNodeId,
          error: error instanceof Error ? error : new Error(String(error)),
          timestamp: now(),
          attempt: node.retry?.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
        };
        errors.push(nodeError);

        // Track node exit with failure
        if (tracker) {
          tracker.nodeExit(currentNodeId, node.type, Date.now() - nodeStartTime);
        }

        // Track workflow error
        if (tracker) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          tracker.error(errorMessage, currentNodeId);
          tracker.complete(false, Date.now() - workflowStartTime);
        }

        yield {
          nodeId: currentNodeId,
          state,
          result: {},
          status: "failed",
          error: nodeError,
        };
        return;
      }

      // Track node exit
      if (tracker) {
        tracker.nodeExit(currentNodeId, node.type, Date.now() - nodeStartTime);
      }

      // Update state
      if (result.stateUpdate) {
        state = mergeState(state, result.stateUpdate);
      }

      // Track visited nodes
      visitedNodes.push(currentNodeId);
      stepCount++;

      // Collect signals
      if (result.signals) {
        signals.push(...result.signals);

        // Check for human_input_required signal
        const humanInputSignal = result.signals.find(
          (s) => s.type === "human_input_required"
        );
        if (humanInputSignal) {
          yield {
            nodeId: currentNodeId,
            state,
            result,
            status: "paused",
          };
          return;
        }

        // Handle checkpoint signal
        const checkpointSignal = result.signals.find((s) => s.type === "checkpoint");
        if (checkpointSignal && this.config.checkpointer) {
          await this.saveCheckpoint(
            this.config.checkpointer,
            executionId,
            state,
            `checkpoint_${stepCount}`
          );
        }
      }

      // Auto-checkpoint after each node if enabled
      if (this.config.autoCheckpoint && this.config.checkpointer) {
        await this.saveCheckpoint(
          this.config.checkpointer,
          executionId,
          state,
          `step_${stepCount}`
        );
      }

      // Emit progress event
      if (this.config.onProgress) {
        this.config.onProgress({
          type: "node_completed",
          nodeId: currentNodeId,
          state,
          timestamp: now(),
        });
      }

      // Determine next nodes
      const nextNodes = this.getNextNodes(currentNodeId, state, result);

      // Add next nodes to queue
      nodeQueue.push(...nextNodes);

      // Check if we've reached an end node AND the queue is empty
      // (meaning all parallel branches have been processed)
      const isEndNode =
        this.graph.endNodes.has(currentNodeId) && nodeQueue.length === 0;

      // Track workflow completion BEFORE yield to ensure it's tracked even if consumer breaks
      if (isEndNode && tracker) {
        tracker.complete(true, Date.now() - workflowStartTime);
      }

      yield {
        nodeId: currentNodeId,
        state,
        result,
        status: isEndNode ? "completed" : "running",
      };

      if (isEndNode) {
        return;
      }
    }

    // Exceeded max steps
    if (stepCount >= maxSteps) {
      // Track workflow error for max steps exceeded
      if (tracker) {
        tracker.error(`Exceeded maximum steps (${maxSteps})`, this.graph.startNode);
        tracker.complete(false, Date.now() - workflowStartTime);
      }
      yield {
        nodeId: nodeQueue[0] ?? this.graph.startNode,
        state,
        result: {},
        status: "failed",
        error: {
          nodeId: this.graph.startNode,
          error: new Error(`Exceeded maximum steps (${maxSteps})`),
          timestamp: now(),
          attempt: 1,
        },
      };
    }
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
    const nodeId = node.id;
    
    // Debug: Log resolution attempt with all inputs
    console.debug(`[resolveModel] Resolving model for node ${nodeId}`);
    console.debug(
      `[resolveModel] Node model: ${node.model ?? 'undefined'}, ` +
      `Parent model: ${parentContext?.model ?? 'undefined'}, ` +
      `Default: ${this.config.defaultModel ?? 'undefined'}`
    );

    let result: string | undefined;

    // 1. If node.model exists and is not 'inherit', use it
    if (node.model && node.model !== "inherit") {
      result = node.model;
    }
    // 2. If parentContext.model exists, inherit from parent
    else if (parentContext?.model) {
      result = parentContext.model;
    }
    // 3. If config.defaultModel exists and is not 'inherit', use it
    else if (this.config.defaultModel && this.config.defaultModel !== "inherit") {
      result = this.config.defaultModel;
    }
    // 4. Return undefined - let SDK use its default

    console.debug(`[resolveModel] Resolved to: ${result ?? 'undefined (SDK default)'}`);
    return result;
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
  ): Promise<NodeResult<TState>> {
    const retryConfig = node.retry ?? DEFAULT_RETRY_CONFIG;
    let lastError: Error | undefined;
    let attempt = 0;

    while (attempt < retryConfig.maxAttempts) {
      attempt++;

      try {
        // Resolve model for this node
        const resolvedModel = this.resolveModel(node, parentContext);

        // Build execution context
        const context: ExecutionContext<TState> = {
          state,
          // Cast config to non-generic type for ExecutionContext compatibility
          config: this.config as unknown as GraphConfig,
          errors,
          abortSignal,
          model: resolvedModel,
          emit: (_signal) => {
            // Signals are collected in the result
          },
          getNodeOutput: (nodeId) => state.outputs[nodeId],
        };

        // Execute node
        const result = await node.execute(context);

        // Emit progress
        if (this.config.onProgress) {
          this.config.onProgress({
            type: "node_started",
            nodeId: node.id,
            state,
            timestamp: now(),
          });
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry
        if (retryConfig.retryOn && !retryConfig.retryOn(lastError)) {
          throw lastError;
        }

        // Last attempt - throw
        if (attempt >= retryConfig.maxAttempts) {
          throw lastError;
        }

        // Calculate backoff delay
        const delay =
          retryConfig.backoffMs *
          Math.pow(retryConfig.backoffMultiplier, attempt - 1);

        // Wait before retry
        await sleep(delay);
      }
    }

    throw lastError ?? new Error("Unexpected retry failure");
  }

  /**
   * Get the next nodes to execute based on edges and result.
   */
  private getNextNodes(
    currentNodeId: NodeId,
    state: TState,
    result: NodeResult<TState>
  ): NodeId[] {
    // If result specifies goto, use that
    if (result.goto) {
      return Array.isArray(result.goto) ? result.goto : [result.goto];
    }

    // Find matching edges from current node
    const outgoingEdges = this.graph.edges.filter((e) => e.from === currentNodeId);

    if (outgoingEdges.length === 0) {
      return [];
    }

    // Evaluate conditional edges
    const matchingEdges: Edge<TState>[] = [];

    for (const edge of outgoingEdges) {
      if (!edge.condition || edge.condition(state)) {
        matchingEdges.push(edge);
      }
    }

    // Return unique target nodes
    const targets = new Set(matchingEdges.map((e) => e.to));
    return Array.from(targets);
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
    try {
      await checkpointer.save(executionId, state, label);

      if (this.config.onProgress) {
        this.config.onProgress({
          type: "checkpoint_saved",
          nodeId: "",
          state,
          timestamp: now(),
        });
      }
    } catch (error) {
      // Log but don't fail on checkpoint errors
      console.error("Failed to save checkpoint:", error);
    }
  }

  /**
   * Create an execution snapshot from a step result.
   */
  private createSnapshot(stepResult: StepResult<TState>): ExecutionSnapshot<TState> {
    return {
      executionId: stepResult.state.executionId,
      state: stepResult.state,
      status: stepResult.status,
      currentNodeId: stepResult.nodeId,
      visitedNodes: [], // Would need to track this during execution
      errors: stepResult.error ? [stepResult.error] : [],
      signals: stepResult.result.signals ?? [],
      startedAt: stepResult.state.lastUpdated,
      updatedAt: now(),
      nodeExecutionCount: 0, // Would need to track this
    };
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
 * @yields StepResult for each executed node
 */
export async function* streamGraph<TState extends BaseState = BaseState>(
  graph: CompiledGraph<TState>,
  options?: ExecutionOptions<TState>
): AsyncGenerator<StepResult<TState>> {
  const executor = createExecutor(graph);
  yield* executor.stream(options);
}
