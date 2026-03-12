import type {
  BaseState,
  Checkpointer,
  CompiledGraph,
  Edge,
  ExecutionContext,
  ExecutionError,
  ExecutionSnapshot,
  GraphConfig,
  NodeDefinition,
  NodeId,
  NodeResult,
  SignalData,
} from "@/services/workflows/graph/types.ts";
import { DEFAULT_RETRY_CONFIG } from "@/services/workflows/graph/types.ts";
import {
  trackWorkflowExecution,
  type WorkflowTracker,
} from "@/services/telemetry/graph-integration.ts";
import { StateValidator } from "@/services/workflows/graph/state-validator.ts";
import type {
  EmittedEvent,
  ExecutionOptions,
  StepResult,
} from "@/services/workflows/graph/runtime/compiled.ts";
import {
  executionNow,
  generateExecutionId,
  initializeExecutionState,
  isLoopNode,
  mergeState,
  sleep,
} from "@/services/workflows/graph/runtime/execution-state.ts";
import { resolveNodeModel } from "@/services/workflows/graph/runtime/model-resolution.ts";
export { resolveNodeModel } from "@/services/workflows/graph/runtime/model-resolution.ts";

interface NodeExecutionResult<TState extends BaseState = BaseState> {
  result: NodeResult<TState>;
  retryCount: number;
  modelUsed?: string;
  emittedEvents: EmittedEvent[];
}

export async function executeNodeWithRetry<TState extends BaseState>(args: {
  graph: CompiledGraph<TState>;
  config: GraphConfig<TState>;
  stateValidator: StateValidator<TState>;
  node: NodeDefinition<TState>;
  state: TState;
  errors: ExecutionError[];
  abortSignal?: AbortSignal;
  parentContext?: ExecutionContext<TState>;
}): Promise<NodeExecutionResult<TState>> {
  const retryConfig = args.node.retry ?? DEFAULT_RETRY_CONFIG;
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt < retryConfig.maxAttempts) {
    attempt++;

    const resolvedModel = resolveNodeModel(
      args.node,
      args.config,
      args.parentContext,
    );
    const emittedEvents: EmittedEvent[] = [];

    const context: ExecutionContext<TState> = {
      state: args.state,
      config: args.config as unknown as GraphConfig,
      errors: args.errors,
      abortSignal: args.abortSignal,
      model: resolvedModel,
      emit: (type: string, data?: Record<string, unknown>) => {
        emittedEvents.push({
          type,
          data: data ?? {},
          timestamp: Date.now(),
        });
      },
      getNodeOutput: (nodeId) => args.state.outputs[nodeId],
    };

    try {
      args.stateValidator.validateNodeInput(
        args.node.id,
        args.state,
        args.node.inputSchema,
      );

      const result = await args.node.execute(context);

      if (result.stateUpdate) {
        const nextState = mergeState(args.state, result.stateUpdate);
        args.stateValidator.validateNodeOutput(
          args.node.id,
          nextState,
          args.node.outputSchema,
        );
        args.stateValidator.validate(nextState);
      }

      if (args.config.onProgress) {
        args.config.onProgress({
          type: "node_started",
          nodeId: args.node.id,
          state: args.state,
          timestamp: executionNow(),
        });
      }

      return {
        result,
        retryCount: attempt - 1,
        modelUsed: resolvedModel,
        emittedEvents,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (args.node.onError) {
        const action = await args.node.onError(lastError, context);

        if (action.action === "skip") {
          return {
            result: action.fallbackState
              ? { stateUpdate: action.fallbackState }
              : {},
            retryCount: attempt - 1,
            modelUsed: resolvedModel,
            emittedEvents,
          };
        }

        if (action.action === "abort") {
          throw action.error ?? lastError;
        }

        if (action.action === "goto") {
          const recoveryNode = args.graph.nodes.get(action.nodeId);
          if (!recoveryNode) {
            throw new Error(
              `onError goto target "${action.nodeId}" not found in graph`,
            );
          }
          if (!recoveryNode.isRecoveryNode) {
            throw new Error(
              `onError goto target "${action.nodeId}" must set isRecoveryNode: true`,
            );
          }
          return {
            result: { goto: action.nodeId },
            retryCount: attempt - 1,
            modelUsed: resolvedModel,
            emittedEvents,
          };
        }

        if (attempt >= retryConfig.maxAttempts) {
          throw lastError;
        }

        const retryDelay =
          action.delay ??
          retryConfig.backoffMs *
            Math.pow(retryConfig.backoffMultiplier, attempt - 1);
        if (retryDelay > 0) {
          await sleep(retryDelay);
        }
        continue;
      }

      if (retryConfig.retryOn && !retryConfig.retryOn(lastError)) {
        throw lastError;
      }

      if (attempt >= retryConfig.maxAttempts) {
        throw lastError;
      }

      const delay =
        retryConfig.backoffMs *
        Math.pow(retryConfig.backoffMultiplier, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError ?? new Error("Unexpected retry failure");
}

export function getNextExecutableNodes<TState extends BaseState>(
  graph: CompiledGraph<TState>,
  currentNodeId: NodeId,
  state: TState,
  result: NodeResult<TState>,
): NodeId[] {
  if (result.goto) {
    return Array.isArray(result.goto) ? result.goto : [result.goto];
  }

  const outgoingEdges = graph.edges.filter((edge) => edge.from === currentNodeId);
  if (outgoingEdges.length === 0) {
    return [];
  }

  const matchingEdges: Edge<TState>[] = [];
  for (const edge of outgoingEdges) {
    if (!edge.condition || edge.condition(state)) {
      matchingEdges.push(edge);
    }
  }

  return Array.from(new Set(matchingEdges.map((edge) => edge.to)));
}

export async function saveExecutionCheckpoint<TState extends BaseState>(args: {
  checkpointer: Checkpointer<TState>;
  config: GraphConfig<TState>;
  executionId: string;
  state: TState;
  label: string;
}): Promise<void> {
  try {
    await args.checkpointer.save(args.executionId, args.state, args.label);

    if (args.config.onProgress) {
      args.config.onProgress({
        type: "checkpoint_saved",
        nodeId: "",
        state: args.state,
        timestamp: executionNow(),
      });
    }
  } catch (error) {
    console.error("Failed to save checkpoint:", error);
  }
}

export function createExecutionSnapshot<TState extends BaseState>(
  stepResult: StepResult<TState>,
): ExecutionSnapshot<TState> {
  return {
    executionId: stepResult.state.executionId,
    state: stepResult.state,
    status: stepResult.status,
    currentNodeId: stepResult.nodeId,
    visitedNodes: [],
    errors: stepResult.error ? [stepResult.error] : [],
    signals: stepResult.result.signals ?? [],
    startedAt: stepResult.state.lastUpdated,
    updatedAt: executionNow(),
    nodeExecutionCount: 0,
  };
}

export async function* executeGraphStreamSteps<TState extends BaseState>(args: {
  graph: CompiledGraph<TState>;
  config: GraphConfig<TState>;
  stateValidator: StateValidator<TState>;
  options: ExecutionOptions<TState>;
}): AsyncGenerator<StepResult<TState>> {
  const executionId = args.options.executionId ?? generateExecutionId();
  const maxSteps = args.options.maxSteps ?? 1000;
  const workflowStartTime = Date.now();

  const tracker: WorkflowTracker | null = args.options.telemetry
    ? trackWorkflowExecution(executionId, args.options.telemetry)
    : null;

  if (tracker) {
    tracker.start(args.options.workflowName ?? "unnamed", {
      maxSteps,
      resuming: !!args.options.resumeFrom,
    });
  }

  let state: TState;
  let visitedNodes: NodeId[] = [];
  let errors: ExecutionError[] = [];
  let signals: SignalData[] = [];
  let nodeQueue: NodeId[];
  let stepCount = 0;

  if (args.options.resumeFrom) {
    const snapshot = args.options.resumeFrom;
    state = snapshot.state;
    visitedNodes = [...snapshot.visitedNodes];
    errors = [...snapshot.errors];
    signals = [...snapshot.signals];
    nodeQueue = snapshot.currentNodeId ? [snapshot.currentNodeId] : [];
  } else {
    state = initializeExecutionState<TState>(
      executionId,
      args.options.initialState,
    );
    nodeQueue = [args.graph.startNode];
  }

  const executionVisited = new Set<string>();

  while (nodeQueue.length > 0 && stepCount < maxSteps) {
    if (args.options.abortSignal?.aborted) {
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
    const node = args.graph.nodes.get(currentNodeId);

    if (!node) {
      errors.push({
        nodeId: currentNodeId,
        error: new Error(`Node "${currentNodeId}" not found in graph`),
        timestamp: executionNow(),
        attempt: 1,
      });
      continue;
    }

    const visitKey = `${currentNodeId}:${stepCount}`;
    if (executionVisited.has(visitKey) && !isLoopNode(currentNodeId)) {
      continue;
    }
    executionVisited.add(visitKey);

    const nodeStartTime = Date.now();
    if (tracker) {
      tracker.nodeEnter(currentNodeId, node.type);
    }

    let executionResult: NodeExecutionResult<TState>;
    let result: NodeResult<TState>;
    let nodeError: ExecutionError | undefined;

    try {
      executionResult = await executeNodeWithRetry({
        graph: args.graph,
        config: args.config,
        stateValidator: args.stateValidator,
        node,
        state,
        errors,
        abortSignal: args.options.abortSignal,
      });
      result = executionResult.result;
    } catch (error) {
      nodeError = {
        nodeId: currentNodeId,
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: executionNow(),
        attempt: node.retry?.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
      };
      errors.push(nodeError);

      if (tracker) {
        tracker.nodeExit(currentNodeId, node.type, Date.now() - nodeStartTime);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
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

    if (tracker) {
      tracker.nodeExit(currentNodeId, node.type, Date.now() - nodeStartTime);
    }

    if (result.stateUpdate) {
      state = mergeState(state, result.stateUpdate);
    }

    visitedNodes.push(currentNodeId);
    stepCount++;

    if (result.signals) {
      signals.push(...result.signals);

      const humanInputSignal = result.signals.find(
        (signal) => signal.type === "human_input_required",
      );
      if (humanInputSignal) {
        yield {
          nodeId: currentNodeId,
          state,
          result,
          status: "paused",
          executionTime: Date.now() - nodeStartTime,
          retryCount: executionResult.retryCount,
          modelUsed: executionResult.modelUsed,
          emittedEvents: executionResult.emittedEvents,
        };
        return;
      }

      const checkpointSignal = result.signals.find(
        (signal) => signal.type === "checkpoint",
      );
      if (checkpointSignal && args.config.checkpointer) {
        await saveExecutionCheckpoint({
          checkpointer: args.config.checkpointer,
          config: args.config,
          executionId,
          state,
          label: `checkpoint_${stepCount}`,
        });
      }
    }

    if (args.config.autoCheckpoint && args.config.checkpointer) {
      await saveExecutionCheckpoint({
        checkpointer: args.config.checkpointer,
        config: args.config,
        executionId,
        state,
        label: `step_${stepCount}`,
      });
    }

    if (args.config.onProgress) {
      args.config.onProgress({
        type: "node_completed",
        nodeId: currentNodeId,
        state,
        timestamp: executionNow(),
      });
    }

    const nextNodes = getNextExecutableNodes(
      args.graph,
      currentNodeId,
      state,
      result,
    );
    nodeQueue.push(...nextNodes);

    const isEndNode =
      args.graph.endNodes.has(currentNodeId) && nodeQueue.length === 0;

    if (isEndNode && tracker) {
      tracker.complete(true, Date.now() - workflowStartTime);
    }

    yield {
      nodeId: currentNodeId,
      state,
      result,
      status: isEndNode ? "completed" : "running",
      executionTime: Date.now() - nodeStartTime,
      retryCount: executionResult.retryCount,
      modelUsed: executionResult.modelUsed,
      emittedEvents: executionResult.emittedEvents,
    };

    if (isEndNode) {
      return;
    }
  }

  if (stepCount >= maxSteps) {
    if (tracker) {
      tracker.error(
        `Exceeded maximum steps (${maxSteps})`,
        args.graph.startNode,
      );
      tracker.complete(false, Date.now() - workflowStartTime);
    }
    yield {
      nodeId: nodeQueue[0] ?? args.graph.startNode,
      state,
      result: {},
      status: "failed",
      error: {
        nodeId: args.graph.startNode,
        error: new Error(`Exceeded maximum steps (${maxSteps})`),
        timestamp: executionNow(),
        attempt: 1,
      },
    };
  }
}
