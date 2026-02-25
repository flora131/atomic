/**
 * Workflow templates for common graph patterns.
 */

import { graph, type GraphBuilder } from "./builder.ts";
import type { BaseState, GraphConfig, NodeDefinition } from "./types.ts";

/**
 * Configuration for the map-reduce workflow template.
 */
export interface MapReduceOptions<TState extends BaseState> {
  splitter: NodeDefinition<TState>;
  worker: NodeDefinition<TState>;
  merger: (results: Partial<TState>[], state: TState) => Partial<TState>;
  config?: Partial<GraphConfig<TState>>;
}

/**
 * Configuration for the review-cycle workflow template.
 */
export interface ReviewCycleOptions<TState extends BaseState> {
  executor: NodeDefinition<TState>;
  reviewer: NodeDefinition<TState>;
  fixer: NodeDefinition<TState>;
  until: (state: TState) => boolean;
  maxIterations?: number;
  config?: Partial<GraphConfig<TState>>;
}

/**
 * Configuration for the task-loop workflow template.
 */
export interface TaskLoopOptions<TState extends BaseState> {
  decomposer: NodeDefinition<TState>;
  worker: NodeDefinition<TState>;
  reviewer?: NodeDefinition<TState>;
  until?: (state: TState) => boolean;
  maxIterations?: number;
  config?: Partial<GraphConfig<TState>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCompletedStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "completed" || normalized === "complete" || normalized === "done";
}

function defaultTaskLoopUntil<TState extends BaseState>(state: TState, workerNodeId: string): boolean {
  const stateRecord = state as Record<string, unknown>;
  if (stateRecord.shouldContinue === false || stateRecord.allTasksComplete === true) {
    return true;
  }

  const workerOutput = state.outputs[workerNodeId];
  if (!isRecord(workerOutput)) {
    return false;
  }

  if (workerOutput.shouldContinue === false || workerOutput.allTasksComplete === true) {
    return true;
  }

  const tasks = workerOutput.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return false;
  }

  return tasks.every((task) => {
    if (!isRecord(task)) {
      return false;
    }
    return typeof task.status === "string" && isCompletedStatus(task.status);
  });
}

function applyDefaultConfig<TState extends BaseState>(
  builder: GraphBuilder<TState>,
  defaultConfig?: Partial<GraphConfig<TState>>,
): GraphBuilder<TState> {
  if (!defaultConfig) {
    return builder;
  }

  const originalCompile = builder.compile.bind(builder);
  builder.compile = (config = {}) => {
    const mergedConfig: GraphConfig<TState> = {
      ...defaultConfig,
      ...config,
    };

    if (defaultConfig.metadata || config.metadata) {
      mergedConfig.metadata = {
        ...defaultConfig.metadata,
        ...config.metadata,
      };
    }

    return originalCompile(mergedConfig);
  };

  return builder;
}

/**
 * Create a linear node chain (node1 -> node2 -> ... -> nodeN).
 */
export function sequential<TState extends BaseState>(
  nodes: NodeDefinition<TState>[],
  config?: Partial<GraphConfig<TState>>,
): GraphBuilder<TState> {
  if (nodes.length === 0) {
    throw new Error("Sequential template requires at least one node");
  }

  const [startNode, ...restNodes] = nodes;
  const builder = graph<TState>().start(startNode!);

  for (const node of restNodes) {
    builder.then(node);
  }

  return applyDefaultConfig(builder, config);
}

function toStateUpdates<TState extends BaseState>(value: unknown): Partial<TState>[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Partial<TState> => typeof entry === "object" && entry !== null);
  }

  if (value instanceof Map) {
    return Array.from(value.values()).filter(
      (entry): entry is Partial<TState> => typeof entry === "object" && entry !== null,
    );
  }

  if (typeof value === "object" && value !== null) {
    return [value as Partial<TState>];
  }

  return [];
}

/**
 * Create a splitter -> worker -> reducer graph.
 *
 * The reducer receives the worker output normalized to `Partial<TState>[]`.
 * Worker output is read from `state.outputs[worker.id]`.
 */
export function mapReduce<TState extends BaseState>(
  options: MapReduceOptions<TState>,
): GraphBuilder<TState> {
  const reducerNodeId = `${options.worker.id}_reduce`;

  const reducerNode: NodeDefinition<TState> = {
    id: reducerNodeId,
    type: "tool",
    execute: async (ctx) => {
      const workerOutput = ctx.state.outputs[options.worker.id];
      const mappedResults = toStateUpdates<TState>(workerOutput);
      return {
        stateUpdate: options.merger(mappedResults, ctx.state),
      };
    },
  };

  const builder = graph<TState>()
    .start(options.splitter)
    .then(options.worker)
    .then(reducerNode);

  return applyDefaultConfig(builder, options.config);
}

/**
 * Create an execute -> review -> fix loop.
 */
export function reviewCycle<TState extends BaseState>(
  options: ReviewCycleOptions<TState>,
): GraphBuilder<TState> {
  const builder = graph<TState>()
    .loop([options.executor, options.reviewer, options.fixer], {
      until: options.until,
      maxIterations: options.maxIterations,
    })
    .end();

  return applyDefaultConfig(builder, options.config);
}

/**
 * Create a decompose -> worker -> optional reviewer loop.
 */
export function taskLoop<TState extends BaseState>(
  options: TaskLoopOptions<TState>,
): GraphBuilder<TState> {
  const loopNodes = options.reviewer ? [options.worker, options.reviewer] : options.worker;
  const until = options.until ?? ((state: TState) => defaultTaskLoopUntil(state, options.worker.id));

  const builder = graph<TState>()
    .start(options.decomposer)
    .loop(loopNodes, {
      until,
      maxIterations: options.maxIterations,
    })
    .end();

  return applyDefaultConfig(builder, options.config);
}
