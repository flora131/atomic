import type {
  AgentMessage,
  CodingAgentClient,
  Session,
} from "@/services/agents/types.ts";

export function createMockChatClient(): CodingAgentClient {
  return {
    agentType: "claude",

    async createSession(): Promise<Session> {
      const sessionId = `mock_${Date.now()}`;

      return {
        id: sessionId,

        async send(message: string): Promise<AgentMessage> {
          await new Promise((resolve) => setTimeout(resolve, 100));

          return {
            type: "text",
            content: `Echo: ${message}`,
            role: "assistant",
          };
        },

        async *stream(message: string): AsyncIterable<AgentMessage> {
          const response =
            `I received your message: "${message}". This is a mock response for testing purposes.`;
          const words = response.split(" ");

          for (const word of words) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            yield {
              type: "text",
              content: `${word} `,
              role: "assistant",
            };
          }
        },

        async summarize(): Promise<void> {
        },

        async getContextUsage() {
          return {
            inputTokens: 0,
            outputTokens: 0,
            maxTokens: 100000,
            usagePercentage: 0,
          };
        },

        getSystemToolsTokens(): number {
          return 0;
        },

        async destroy(): Promise<void> {
        },
      };
    },

    async resumeSession(): Promise<Session | null> {
      return null;
    },

    on() {
      return () => {};
    },

    registerTool() {
    },

    async start(): Promise<void> {
    },

    async stop(): Promise<void> {
    },

    async getModelDisplayInfo() {
      return { model: "Mock Model", tier: "Mock Tier" };
    },

    getSystemToolsTokens() {
      return null;
    },
  };
}
