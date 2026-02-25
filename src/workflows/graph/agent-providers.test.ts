import { describe, expect, test } from "bun:test";
import type {
  AgentMessage,
  CodingAgentClient,
  EventHandler,
  EventType,
  ModelDisplayInfo,
  Session,
  SessionConfig,
  ToolDefinition,
} from "../../sdk/types.ts";
import {
  ClientBackedAgentProvider,
  createClaudeAgentProvider,
  createCopilotAgentProvider,
  createDefaultProviderRegistry,
  createOpenCodeAgentProvider,
} from "./agent-providers.ts";

function createMockSession(id: string): Session {
  return {
    id,
    async send(message: string): Promise<AgentMessage> {
      return { type: "text", content: message, role: "assistant" };
    },
    async *stream(message: string): AsyncIterable<AgentMessage> {
      yield { type: "text", content: message, role: "assistant" };
    },
    async summarize(): Promise<void> {},
    async getContextUsage() {
      return {
        inputTokens: 1,
        outputTokens: 1,
        maxTokens: 1000,
        usagePercentage: 0.2,
      };
    },
    getSystemToolsTokens(): number {
      return 0;
    },
    async destroy(): Promise<void> {},
  };
}

interface MockClientState {
  startCalls: number;
  createSessionCalls: SessionConfig[];
}

function createMockClient(
  agentType: CodingAgentClient["agentType"],
): { client: CodingAgentClient; state: MockClientState } {
  const state: MockClientState = {
    startCalls: 0,
    createSessionCalls: [],
  };

  const mockDisplay: ModelDisplayInfo = { model: "mock-model", tier: "mock-tier" };
  const session = createMockSession(`${agentType}-session`);

  const client: CodingAgentClient = {
    agentType,
    async createSession(config?: SessionConfig): Promise<Session> {
      state.createSessionCalls.push(config ?? {});
      return session;
    },
    async resumeSession(): Promise<Session | null> {
      return null;
    },
    on<T extends EventType>(_eventType: T, _handler: EventHandler<T>): () => void {
      return () => {};
    },
    registerTool(_tool: ToolDefinition): void {},
    async start(): Promise<void> {
      state.startCalls += 1;
    },
    async stop(): Promise<void> {},
    async getModelDisplayInfo(): Promise<ModelDisplayInfo> {
      return mockDisplay;
    },
    getSystemToolsTokens(): number | null {
      return null;
    },
  };

  return { client, state };
}

describe("ClientBackedAgentProvider", () => {
  test("starts client lazily and delegates createSession", async () => {
    const mock = createMockClient("claude");
    const provider = new ClientBackedAgentProvider({
      name: "claude",
      client: mock.client,
      supportedModels: ["sonnet"],
    });

    const first = await provider.createSession({ model: "anthropic/sonnet" });
    const second = await provider.createSession({ model: "anthropic/opus" });

    expect(first.id).toBe("claude-session");
    expect(second.id).toBe("claude-session");
    expect(mock.state.startCalls).toBe(1);
    expect(mock.state.createSessionCalls).toEqual([
      { model: "anthropic/sonnet" },
      { model: "anthropic/opus" },
    ]);
  });

  test("returns a defensive copy from supportedModels", () => {
    const mock = createMockClient("claude");
    const provider = new ClientBackedAgentProvider({
      name: "claude",
      client: mock.client,
      supportedModels: ["opus", "sonnet"],
    });

    const models = provider.supportedModels();
    models.push("unexpected-model");

    expect(provider.supportedModels()).toEqual(["opus", "sonnet"]);
  });
});

describe("agent provider factories", () => {
  test("creates claude provider with default supported models", () => {
    const mock = createMockClient("claude");
    const provider = createClaudeAgentProvider({ client: mock.client });

    expect(provider.name).toBe("claude");
    expect(provider.supportedModels()).toEqual(["opus", "sonnet", "haiku"]);
  });

  test("creates opencode and copilot providers with provided models", () => {
    const opencodeMock = createMockClient("opencode");
    const copilotMock = createMockClient("copilot");

    const opencode = createOpenCodeAgentProvider({
      client: opencodeMock.client,
      supportedModels: ["anthropic/claude-sonnet-4"],
    });
    const copilot = createCopilotAgentProvider({
      client: copilotMock.client,
      supportedModels: ["claude-opus-4.6", "gpt-5.2"],
    });

    expect(opencode.name).toBe("opencode");
    expect(opencode.supportedModels()).toEqual(["anthropic/claude-sonnet-4"]);
    expect(copilot.name).toBe("copilot");
    expect(copilot.supportedModels()).toEqual(["claude-opus-4.6", "gpt-5.2"]);
  });

  test("creates registry containing all default providers", async () => {
    const claudeMock = createMockClient("claude");
    const opencodeMock = createMockClient("opencode");
    const copilotMock = createMockClient("copilot");

    const registry = createDefaultProviderRegistry({
      claude: { client: claudeMock.client },
      opencode: { client: opencodeMock.client },
      copilot: { client: copilotMock.client },
    });

    expect(registry.list()).toEqual(["claude", "opencode", "copilot"]);

    await registry.get("claude")?.createSession({});
    await registry.get("opencode")?.createSession({});
    await registry.get("copilot")?.createSession({});

    expect(claudeMock.state.startCalls).toBe(1);
    expect(opencodeMock.state.startCalls).toBe(1);
    expect(copilotMock.state.startCalls).toBe(1);
  });
});
