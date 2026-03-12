import type {
  BaseState,
  NodeDefinition,
} from "@/services/workflows/graph/types.ts";
import { createNode } from "@/services/workflows/graph/authoring/node-factories.ts";
import type {
  AuthoringGraphOps,
  IterationDslState,
  LoopConfig,
  ParallelConfig,
} from "@/services/workflows/graph/authoring/types.ts";

export function addParallelSegment<TState extends BaseState>(
  state: IterationDslState<TState>,
  ops: AuthoringGraphOps<TState>,
  config: ParallelConfig<TState>,
): void {
  const parallelNodeId = ops.generateNodeId("parallel");
  const parallelNode = createNode<TState>(parallelNodeId, "parallel", async (ctx) => ({
    stateUpdate: {
      outputs: {
        ...ctx.state.outputs,
        [parallelNodeId]: {
          branches: config.branches,
          strategy: config.strategy ?? "all",
        },
      },
    } as Partial<TState>,
  }));

  ops.addNode(parallelNode);

  if (state.currentNodeId !== null) {
    ops.addEdge(state.currentNodeId, parallelNodeId);
  } else if (state.startNodeId === null) {
    state.startNodeId = parallelNodeId;
  }

  for (const branchId of config.branches) {
    ops.addEdge(parallelNodeId, branchId, undefined, `parallel-${branchId}`);
  }

  state.currentNodeId = parallelNodeId;
}

export function addLoopSegment<TState extends BaseState>(
  state: IterationDslState<TState>,
  ops: AuthoringGraphOps<TState>,
  bodyNodes: NodeDefinition<TState> | NodeDefinition<TState>[],
  config: LoopConfig<TState>,
): void {
  const bodyNodeArray = Array.isArray(bodyNodes) ? bodyNodes : [bodyNodes];

  if (bodyNodeArray.length === 0) {
    throw new Error("Loop body must contain at least one node");
  }

  const loopStartId = ops.generateNodeId("loop_start");
  const loopCheckId = ops.generateNodeId("loop_check");
  const maxIterations = config.maxIterations ?? 100;

  const loopStartNode = createNode<TState>(loopStartId, "decision", async (ctx) => {
    const iterationKey = `${loopStartId}_iteration`;
    const currentIteration = (ctx.state.outputs[iterationKey] as number) ?? 0;

    return {
      stateUpdate: {
        outputs: {
          ...ctx.state.outputs,
          [iterationKey]: currentIteration,
        },
      } as Partial<TState>,
    };
  });

  const loopCheckNode = createNode<TState>(loopCheckId, "decision", async (ctx) => {
    const iterationKey = `${loopStartId}_iteration`;
    const currentIteration = (ctx.state.outputs[iterationKey] as number) ?? 0;

    return {
      stateUpdate: {
        outputs: {
          ...ctx.state.outputs,
          [iterationKey]: currentIteration + 1,
        },
      } as Partial<TState>,
    };
  });

  ops.addNode(loopStartNode);
  for (const node of bodyNodeArray) {
    ops.addNode(node);
  }
  ops.addNode(loopCheckNode);

  if (state.currentNodeId !== null) {
    ops.addEdge(state.currentNodeId, loopStartId);
  } else if (state.startNodeId === null) {
    state.startNodeId = loopStartId;
  }

  const firstBodyNode = bodyNodeArray[0]!;
  const lastBodyNode = bodyNodeArray[bodyNodeArray.length - 1]!;

  for (let i = 0; i < bodyNodeArray.length - 1; i++) {
    ops.addEdge(bodyNodeArray[i]!.id, bodyNodeArray[i + 1]!.id);
  }

  ops.addEdge(loopStartId, firstBodyNode.id);
  ops.addEdge(lastBodyNode.id, loopCheckId);

  ops.addEdge(
    loopCheckId,
    firstBodyNode.id,
    (graphState) => {
      const iterationKey = `${loopStartId}_iteration`;
      const currentIteration =
        (graphState.outputs[iterationKey] as number) ?? 0;
      return !config.until(graphState) && currentIteration < maxIterations;
    },
    "loop-continue",
  );

  state.currentNodeId = loopCheckId;
  state.pendingEdgeCondition = (graphState) => {
    const iterationKey = `${loopStartId}_iteration`;
    const currentIteration =
      (graphState.outputs[iterationKey] as number) ?? 0;
    return config.until(graphState) || currentIteration >= maxIterations;
  };
  state.pendingEdgeLabel = "loop-exit";
}
