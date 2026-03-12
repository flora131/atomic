import { pipelineLog } from "@/services/events/pipeline-logger.ts";
import type {
  BaseState,
  ExecutionContext,
  NodeDefinition,
  NodeResult,
  RetryConfig,
} from "@/services/workflows/graph/types.ts";
import type { SubagentStreamResult } from "@/services/workflows/graph/types.ts";

export interface SubagentNodeConfig<TState extends BaseState> {
  id: string;
  name?: string;
  description?: string;
  agentName: string;
  task: string | ((state: TState) => string);
  model?: string;
  tools?: string[];
  outputMapper?: (
    result: SubagentStreamResult,
    state: TState,
  ) => Partial<TState>;
  retry?: RetryConfig;
}

export function subagentNode<TState extends BaseState>(
  config: SubagentNodeConfig<TState>,
): NodeDefinition<TState> {
  return {
    id: config.id,
    type: "agent",
    name: config.name ?? config.agentName,
    description: config.description ?? `Sub-agent: ${config.agentName}`,
    retry: config.retry,
    async execute(ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> {
      const spawnSubagent = ctx.config.runtime?.spawnSubagent;
      if (!spawnSubagent) {
        throw new Error(
          "spawnSubagent not initialized. " +
            "Execute this graph through WorkflowSDK.init().",
        );
      }

      const registry = ctx.config.runtime?.subagentRegistry;
      if (!registry) {
        throw new Error(
          "SubagentTypeRegistry not initialized. " +
            "Execute this graph through WorkflowSDK.init().",
        );
      }
      const entry = registry.get(config.agentName);
      if (!entry) {
        pipelineLog("Subagent", "registry_miss", {
          agentName: config.agentName,
        });
        throw new Error(
          `Sub-agent "${config.agentName}" not found in registry. ` +
            `Available agents: ${registry.getAll().map((agent) => agent.name).join(", ")}`,
        );
      }

      const task =
        typeof config.task === "function"
          ? config.task(ctx.state)
          : config.task;

      const result = await spawnSubagent({
        agentId: `${config.id}-${ctx.state.executionId}`,
        agentName: config.agentName,
        task,
        model: config.model ?? ctx.model,
        tools: config.tools,
      });

      pipelineLog("Subagent", "spawn_complete", {
        agentName: config.agentName,
        success: result.success,
      });

      if (!result.success) {
        throw new Error(
          `Sub-agent "${config.agentName}" failed: ${
            result.error ?? "Unknown error"
          }`,
        );
      }

      const stateUpdate = config.outputMapper
        ? config.outputMapper(result, ctx.state)
        : ({
            outputs: {
              ...ctx.state.outputs,
              [config.id]: result.output,
            },
          } as Partial<TState>);

      return { stateUpdate };
    },
  };
}
