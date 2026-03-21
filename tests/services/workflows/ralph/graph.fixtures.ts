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

/**
 * Create a mock `createSession` factory for the graph runtime.
 *
 * Returns mock sessions whose `stream()` method yields a single text chunk
 * derived from the `MockResponseMap`. The response handler for the agent
 * named "session" is used when present, otherwise the session streams an
 * empty string.
 *
 * This factory is primarily used to satisfy the `createSession` requirement
 * on the runtime config while the test exercises `spawnSubagent` directly.
 */
export function createMockSessionFactory(_responses: MockResponseMap) {
  return async () => ({
    id: `mock-session-${Date.now()}`,
    send: async () => ({ type: "text" as const, content: "" }),
    stream: async function* (
      _message: string,
      _options?: { agent?: string; abortSignal?: AbortSignal },
    ) {
      yield { type: "text" as const, content: "" };
    },
    summarize: async () => {},
    getContextUsage: async () => ({
      inputTokens: 0,
      outputTokens: 0,
      maxTokens: 100000,
      usagePercentage: 0,
    }),
    getSystemToolsTokens: () => 0,
    destroy: async () => {},
  });
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
