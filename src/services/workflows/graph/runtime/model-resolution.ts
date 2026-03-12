import type {
  BaseState,
  ExecutionContext,
  GraphConfig,
  NodeDefinition,
} from "@/services/workflows/graph/types.ts";

export function resolveNodeModel<TState extends BaseState>(
  node: NodeDefinition<TState>,
  config: GraphConfig<TState>,
  parentContext?: ExecutionContext<TState>,
): string | undefined {
  if (node.model && node.model !== "inherit") {
    return node.model;
  }
  if (parentContext?.model) {
    return parentContext.model;
  }
  if (config.defaultModel && config.defaultModel !== "inherit") {
    return config.defaultModel;
  }
  return undefined;
}
