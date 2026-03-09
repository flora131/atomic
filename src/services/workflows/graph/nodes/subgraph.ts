import type {
  BaseState,
  NodeId,
  NodeDefinition,
  NodeResult,
  ExecutionContext,
} from "@/services/workflows/graph/types.ts";

export interface CompiledSubgraph<TSubState extends BaseState = BaseState> {
  execute: (state: TSubState) => Promise<TSubState>;
}

export type SubgraphRef<TSubState extends BaseState = BaseState> =
  | CompiledSubgraph<TSubState>
  | string;

export interface SubgraphNodeConfig<
  TState extends BaseState = BaseState,
  TSubState extends BaseState = BaseState,
> {
  id: NodeId;
  subgraph: SubgraphRef<TSubState>;
  inputMapper?: (state: TState) => TSubState;
  outputMapper?: (
    subState: TSubState,
    parentState: TState,
  ) => Partial<TState>;
  name?: string;
  description?: string;
}

export type WorkflowResolver = (
  name: string,
) => CompiledSubgraph<BaseState> | null;

export function subgraphNode<
  TState extends BaseState = BaseState,
  TSubState extends BaseState = BaseState,
>(config: SubgraphNodeConfig<TState, TSubState>): NodeDefinition<TState> {
  const { id, subgraph, inputMapper, outputMapper, name, description } =
    config;

  return {
    id,
    type: "subgraph",
    name: name ?? "subgraph",
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      let resolvedSubgraph: CompiledSubgraph<TSubState>;

      if (typeof subgraph === "string") {
        const resolver = ctx.config.runtime?.workflowResolver;
        if (!resolver) {
          throw new Error(
            `Cannot resolve workflow "${subgraph}": No workflow resolver configured. ` +
              "Execute this graph through WorkflowSDK.init().",
          );
        }

        const resolved = resolver(subgraph);
        if (!resolved) {
          throw new Error(`Workflow not found: ${subgraph}`);
        }

        resolvedSubgraph = resolved as unknown as CompiledSubgraph<TSubState>;
      } else {
        resolvedSubgraph = subgraph;
      }

      const subState = inputMapper
        ? inputMapper(ctx.state)
        : (ctx.state as unknown as TSubState);
      const finalSubState = await resolvedSubgraph.execute(subState);

      const stateUpdate = outputMapper
        ? outputMapper(finalSubState, ctx.state)
        : ({
            outputs: {
              ...ctx.state.outputs,
              [id]: finalSubState,
            },
          } as Partial<TState>);

      return { stateUpdate };
    },
  };
}
