import type {
  BaseState,
  EdgeCondition,
  NodeDefinition,
  NodeExecuteFn,
  NodeId,
  NodeType,
  RetryConfig,
} from "@/services/workflows/graph/types.ts";

export interface CreateNodeOptions<TState extends BaseState = BaseState> {
  name?: string;
  description?: string;
  inputSchema?: NodeDefinition<TState>["inputSchema"];
  outputSchema?: NodeDefinition<TState>["outputSchema"];
  retry?: RetryConfig;
  onError?: NodeDefinition<TState>["onError"];
  isRecoveryNode?: boolean;
}

export function createNode<TState extends BaseState = BaseState>(
  id: NodeId,
  type: NodeType,
  execute: NodeExecuteFn<TState>,
  options?: CreateNodeOptions<TState>,
): NodeDefinition<TState> {
  return {
    id,
    type,
    execute,
    ...options,
  };
}

export function createDecisionNode<TState extends BaseState = BaseState>(
  id: NodeId,
  routes: Array<{ condition: EdgeCondition<TState>; target: NodeId }>,
  fallback: NodeId,
): NodeDefinition<TState> {
  return {
    id,
    type: "decision",
    execute: async (ctx) => {
      for (const route of routes) {
        if (route.condition(ctx.state)) {
          return { goto: route.target };
        }
      }
      return { goto: fallback };
    },
  };
}

export function createWaitNode<TState extends BaseState = BaseState>(
  id: NodeId,
  prompt: string,
): NodeDefinition<TState> {
  return {
    id,
    type: "wait",
    execute: async () => ({
      signals: [
        {
          type: "human_input_required",
          message: prompt,
        },
      ],
    }),
  };
}

export function createNoopDecisionNode<TState extends BaseState = BaseState>(
  id: NodeId,
): NodeDefinition<TState> {
  return createNode(id, "decision", async () => ({}));
}
