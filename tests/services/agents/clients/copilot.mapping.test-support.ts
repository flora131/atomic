import { mock } from "bun:test";
import { CopilotClient } from "@/services/agents/clients/copilot.ts";

export function createRunningCopilotClient(): CopilotClient {
  const mockSdkSession = {
    sessionId: "test-session",
    on: mock(() => () => {}),
    send: mock(() => Promise.resolve()),
    sendAndWait: mock(() => Promise.resolve({ data: { content: "test" } })),
    destroy: mock(() => Promise.resolve()),
    abort: mock(() => Promise.resolve()),
  };

  const mockSdkClient = {
    start: mock(() => Promise.resolve()),
    stop: mock(() => Promise.resolve()),
    createSession: mock(() => Promise.resolve(mockSdkSession)),
    listModels: mock(() =>
      Promise.resolve([
        {
          id: "test-model",
          capabilities: {
            limits: { max_context_window_tokens: 128000 },
            supports: {},
          },
        },
      ])),
  };

  const client = new CopilotClient({});
  (client as any).sdkClient = mockSdkClient;
  (client as any).isRunning = true;
  return client;
}

export function bindCopilotHandleSdkEvent(client: CopilotClient) {
  return (client as any).handleSdkEvent.bind(client) as (
    sessionId: string,
    event: Record<string, unknown>,
  ) => void;
}

export function seedCopilotSession(client: CopilotClient, toolCallIdToName = new Map<string, string>()) {
  (client as any).sessions.set("test-session", {
    sdkSession: {},
    sessionId: "test-session",
    config: {},
    inputTokens: 0,
    outputTokens: 0,
    isClosed: false,
    unsubscribe: () => {},
    toolCallIdToName,
    contextWindow: null,
    systemToolsBaseline: null,
    pendingAbortPromise: null,
  });
}
