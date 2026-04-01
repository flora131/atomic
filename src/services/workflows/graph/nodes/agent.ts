import type {
  BaseState,
  NodeId,
  NodeDefinition,
  NodeResult,
  RetryConfig,
  ExecutionContext,
} from "@/services/workflows/graph/types.ts";
import type {
  SessionConfig,
  AgentMessage,
  CodingAgentClient,
} from "@/services/agents/types.ts";

/**
 * Agent type identifier resolved by the client/provider registry.
 */
export type AgentNodeAgentType = string;

/**
 * Function to map agent output to state updates.
 */
export type OutputMapper<TState extends BaseState = BaseState> = (
  messages: AgentMessage[],
  state: TState,
) => Partial<TState>;

/**
 * Configuration for creating an agent node.
 */
export interface AgentNodeConfig<TState extends BaseState = BaseState> {
  id: NodeId;
  agentType: AgentNodeAgentType;
  additionalInstructions?: string;
  tools?: string[];
  outputMapper?: OutputMapper<TState>;
  sessionConfig?: Partial<SessionConfig>;
  retry?: RetryConfig;
  name?: string;
  description?: string;
  buildMessage?: (state: TState) => string;
}

/**
 * Client provider function type for dependency injection.
 */
export type ClientProvider = (
  agentType: AgentNodeAgentType,
) => CodingAgentClient | null;

/**
 * Default retry configuration for agent nodes.
 */
export const AGENT_NODE_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
};

export function agentNode<TState extends BaseState = BaseState>(
  config: AgentNodeConfig<TState>,
): NodeDefinition<TState> {
  const {
    id,
    agentType,
    additionalInstructions,
    tools,
    outputMapper,
    sessionConfig,
    retry = AGENT_NODE_RETRY_CONFIG,
    name,
    description,
    buildMessage,
  } = config;

  return {
    id,
    type: "agent",
    name: name ?? `${agentType} agent`,
    description,
    retry,
    execute: async (ctx: ExecutionContext<TState>): Promise<NodeResult<TState>> => {
      const client = ctx.config.runtime?.clientProvider?.(agentType);

      if (!client) {
        throw new Error(
          `No client provider configured for agent type "${agentType}". ` +
            "Execute this graph through executeWorkflow() with providers configured.",
        );
      }

      const fullSessionConfig: SessionConfig = {
        ...sessionConfig,
        model: ctx.model ?? sessionConfig?.model,
        additionalInstructions:
          additionalInstructions ?? sessionConfig?.additionalInstructions,
        tools: tools ?? sessionConfig?.tools,
      };

      const session = await client.createSession(fullSessionConfig);

      try {
        const message = buildMessage ? buildMessage(ctx.state) : "";
        const messages: AgentMessage[] = [];
        for await (const chunk of session.stream(message)) {
          messages.push(chunk);
        }

        const stateUpdate = outputMapper
          ? outputMapper(messages, ctx.state)
          : ({
              outputs: {
                ...ctx.state.outputs,
                [id]: messages,
              },
            } as Partial<TState>);

        return { stateUpdate };
      } finally {
        await session.destroy();
      }
    },
  };
}
