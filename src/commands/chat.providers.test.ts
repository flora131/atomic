import { describe, expect, mock, test } from "bun:test";
import type {
  AgentMessage,
  CodingAgentClient,
  EventHandler,
  EventType,
  ModelDisplayInfo,
  Session,
  SessionConfig,
  ToolDefinition,
} from "../sdk/types.ts";

function createMockSession(id: string): Session {
  return {
    id,
    async send(message: string): Promise<AgentMessage> {
      return { type: "text", role: "assistant", content: message };
    },
    async *stream(message: string): AsyncIterable<AgentMessage> {
      yield { type: "text", role: "assistant", content: message };
    },
    async summarize(): Promise<void> {},
    async getContextUsage() {
      return {
        inputTokens: 0,
        outputTokens: 0,
        maxTokens: 1,
        usagePercentage: 0,
      };
    },
    getSystemToolsTokens(): number {
      return 0;
    },
    async destroy(): Promise<void> {},
  };
}

function createMockClient(agentType: CodingAgentClient["agentType"]): CodingAgentClient {
  const modelDisplay: ModelDisplayInfo = { model: "mock-model", tier: "mock-tier" };
  const session = createMockSession(`${agentType}-session`);

  return {
    agentType,
    async createSession(_config?: SessionConfig): Promise<Session> {
      return session;
    },
    async resumeSession(): Promise<Session | null> {
      return null;
    },
    on<T extends EventType>(_eventType: T, _handler: EventHandler<T>): () => void {
      return () => {};
    },
    registerTool(_tool: ToolDefinition): void {},
    async start(): Promise<void> {},
    async stop(): Promise<void> {},
    async getModelDisplayInfo(): Promise<ModelDisplayInfo> {
      return modelDisplay;
    },
    getSystemToolsTokens(): number | null {
      return null;
    },
  };
}

mock.module("../sdk/clients/index.ts", () => ({
  createClaudeAgentClient: () => createMockClient("claude"),
  createOpenCodeClient: () => createMockClient("opencode"),
  createCopilotClient: () => createMockClient("copilot"),
}));

mock.module("../telemetry/index.ts", () => ({
  trackAtomicCommand: () => {},
}));

describe("chat command provider wiring", () => {
  test("createClientForAgentType maps all providers to their matching clients", async () => {
    const { createClientForAgentType } = await import("./chat.ts");

    expect((await createClientForAgentType("claude")).agentType).toBe("claude");
    expect((await createClientForAgentType("opencode")).agentType).toBe("opencode");
    expect((await createClientForAgentType("copilot")).agentType).toBe("copilot");
  });

  test("getAgentDisplayName returns stable names for all chat providers", async () => {
    const { getAgentDisplayName } = await import("./chat.ts");

    expect(getAgentDisplayName("claude")).toBe("Claude");
    expect(getAgentDisplayName("opencode")).toBe("OpenCode");
    expect(getAgentDisplayName("copilot")).toBe("Copilot");
  });
});
