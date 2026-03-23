import type {
  BaseState,
  NodeDefinition,
  NodeId,
} from "@/services/workflows/graph/types.ts";
import { toolNode } from "@/services/workflows/graph/nodes/tool.ts";
import { createWaitNode } from "@/services/workflows/graph/authoring/node-factories.ts";
import type {
  ToolBuilderConfig,
} from "@/services/workflows/graph/authoring/types.ts";

export function buildWaitBuilderNode<TState extends BaseState>(
  id: NodeId,
  prompt: string,
): NodeDefinition<TState> {
  return createWaitNode<TState>(id, prompt);
}

export function buildToolBuilderNode<
  TState extends BaseState,
  TArgs = unknown,
  TResult = unknown,
>(
  config: ToolBuilderConfig<TState, TArgs, TResult>,
): NodeDefinition<TState> {
  return toolNode({
    id: config.id,
    toolName: config.toolName ?? config.id,
    execute: config.execute,
    args: config.args,
    outputMapper: config.outputMapper,
    timeout: config.timeout,
    retry: config.retry,
    name: config.name,
    description: config.description,
  });
}
