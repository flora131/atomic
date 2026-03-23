import type {
  BaseState,
  NodeId,
  NodeDefinition,
  NodeResult,
  RetryConfig,
  ExecutionContext,
} from "@/services/workflows/graph/types.ts";
import type {
  SubagentSpawnOptions,
  SubagentStreamResult,
} from "@/services/workflows/graph/types.ts";
import { pipelineLog } from "@/services/events/pipeline-logger.ts";

export type ParallelMergeStrategy = "all" | "race" | "any";

export type ParallelMerger<TState extends BaseState = BaseState> = (
  results: Map<NodeId, unknown>,
  state: TState,
) => Partial<TState>;

export interface ParallelNodeConfig<TState extends BaseState = BaseState> {
  id: NodeId;
  branches: NodeId[];
  strategy?: ParallelMergeStrategy;
  outputMapper?: ParallelMerger<TState>;
  merge?: ParallelMerger<TState>;
  name?: string;
  description?: string;
}

export interface ParallelExecutionContext<TState extends BaseState = BaseState> {
  branches: NodeId[];
  strategy: ParallelMergeStrategy;
  outputMapper?: ParallelMerger<TState>;
  merge?: ParallelMerger<TState>;
}

export function parallelNode<TState extends BaseState = BaseState>(
  config: ParallelNodeConfig<TState>,
): NodeDefinition<TState> {
  const {
    id,
    branches,
    strategy = "all",
    outputMapper,
    merge,
    name,
    description,
  } = config;
  const resolvedOutputMapper = outputMapper ?? merge;

  if (branches.length === 0) {
    throw new Error(`Parallel node "${id}" requires at least one branch`);
  }

  return {
    id,
    type: "parallel",
    name: name ?? "parallel",
    description,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const parallelContext: ParallelExecutionContext<TState> = {
        branches,
        strategy,
        outputMapper: resolvedOutputMapper,
        merge: resolvedOutputMapper,
      };

      return {
        stateUpdate: {
          outputs: {
            ...ctx.state.outputs,
            [id]: {
              _parallel: true,
              ...parallelContext,
            },
          },
        } as Partial<TState>,
        goto: branches,
      };
    },
  };
}

export interface ParallelSubagentNodeConfig<TState extends BaseState> {
  id: string;
  name?: string;
  description?: string;
  agents: Array<{
    agentName: string;
    task: string | ((state: TState) => string);
    model?: string;
    tools?: string[];
  }>;
  outputMapper?: (
    results: Map<string, SubagentStreamResult>,
    state: TState,
  ) => Partial<TState>;
  merge?: (
    results: Map<string, SubagentStreamResult>,
    state: TState,
  ) => Partial<TState>;
  retry?: RetryConfig;
}

export function parallelSubagentNode<TState extends BaseState>(
  config: ParallelSubagentNodeConfig<TState>,
): NodeDefinition<TState> {
  const resolvedOutputMapper = config.outputMapper ?? config.merge;
  if (!resolvedOutputMapper) {
    throw new Error(
      `Parallel sub-agent node "${config.id}" requires outputMapper (or legacy merge)`,
    );
  }

  return {
    id: config.id,
    type: "parallel",
    name: config.name ?? `Parallel sub-agents (${config.agents.length})`,
    description: config.description,
    retry: config.retry,
    async execute(ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy spawn path removed from GraphRuntimeDependencies
      const spawnSubagentParallel = (ctx.config.runtime as any)?.spawnSubagentParallel as
        | ((agents: SubagentSpawnOptions[], abortSignal?: AbortSignal, onAgentComplete?: (result: SubagentStreamResult) => void) => Promise<SubagentStreamResult[]>)
        | undefined;
      if (!spawnSubagentParallel) {
        throw new Error(
          "spawnSubagentParallel not initialized. Execute this graph through executeWorkflow().",
        );
      }

      const spawnOptions: SubagentSpawnOptions[] = config.agents.map(
        (agent, index) => ({
          agentId: `${config.id}-${index}-${ctx.state.executionId}`,
          agentName: agent.agentName,
          task:
            typeof agent.task === "function"
              ? agent.task(ctx.state)
              : agent.task,
          model: agent.model ?? ctx.model,
          tools: agent.tools,
        }),
      );

      pipelineLog("Subagent", "parallel_spawn", {
        count: spawnOptions.length,
        agents: spawnOptions.map((option) => option.agentName),
      });

      const results = await spawnSubagentParallel(spawnOptions);

      pipelineLog("Subagent", "parallel_complete", { count: results.length });

      const resultMap = new Map<string, SubagentStreamResult>();
      results.forEach((result, index) => {
        const key = `${config.agents[index]!.agentName}-${index}`;
        resultMap.set(key, result);
      });

      return {
        stateUpdate: resolvedOutputMapper(resultMap, ctx.state),
      };
    },
  };
}
