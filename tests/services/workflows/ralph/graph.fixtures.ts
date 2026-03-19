import { createRalphWorkflow } from "@/services/workflows/ralph/graph.ts";
import { TaskIdentityService } from "@/services/workflows/task-identity-service.ts";
import type {
  SubagentSpawnOptions,
  SubagentStreamResult,
} from "@/services/workflows/graph/types.ts";

export type MockResponseMap = Map<
  string,
  (opts: SubagentSpawnOptions) => SubagentStreamResult | Promise<SubagentStreamResult>
>;

export function createMockSpawnFunctions(responses: MockResponseMap) {
  async function spawnSubagent(agent: SubagentSpawnOptions): Promise<SubagentStreamResult> {
    const handler = responses.get(agent.agentName);
    if (!handler) {
      return {
        agentId: agent.agentId,
        success: false,
        output: "",
        error: `No handler for agent: ${agent.agentName}`,
        toolUses: 0,
        durationMs: 0,
      };
    }
    return await handler(agent);
  }

  async function spawnSubagentParallel(
    agents: SubagentSpawnOptions[],
    _abortSignal?: AbortSignal,
    onAgentComplete?: (result: SubagentStreamResult) => void,
  ): Promise<SubagentStreamResult[]> {
    return Promise.all(
      agents.map(async (agent) => {
        const result = await spawnSubagent(agent);
        const correlatedResult = { ...result, agentId: agent.agentId };
        onAgentComplete?.(correlatedResult);
        return correlatedResult;
      }),
    );
  }

  return { spawnSubagent, spawnSubagentParallel };
}

export function createMockRegistry() {
  return {
    get(name: string) {
      return {
        name,
        info: {
          name,
          description: `Mock agent: ${name}`,
          source: "project" as const,
          filePath: `/mock/${name}.md`,
        },
        source: "project" as const,
      };
    },
    getAll() {
      return [];
    },
  };
}

export function createWorkflowWithMockBridge(responses: MockResponseMap) {
  const baseWorkflow = createRalphWorkflow();
  const { spawnSubagent, spawnSubagentParallel } = createMockSpawnFunctions(responses);
  return {
    ...baseWorkflow,
    config: {
      ...baseWorkflow.config,
      runtime: {
        spawnSubagent,
        spawnSubagentParallel,
        taskIdentity: new TaskIdentityService(),
        subagentRegistry: createMockRegistry(),
      },
    },
  };
}
