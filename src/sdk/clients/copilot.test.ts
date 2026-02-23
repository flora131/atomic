import { describe, expect, test, mock } from "bun:test";

import { resolveCopilotUserInputSessionId } from "./copilot.ts";
import { CopilotClient } from "./copilot.ts";

describe("resolveCopilotUserInputSessionId", () => {
  test("keeps preferred session when it is active", () => {
    const resolved = resolveCopilotUserInputSessionId("copilot_123", [
      "copilot_001",
      "copilot_123",
    ]);

    expect(resolved).toBe("copilot_123");
  });

  test("falls back to latest active session when preferred is unknown", () => {
    const resolved = resolveCopilotUserInputSessionId("tentative_session", [
      "copilot_001",
      "copilot_002",
    ]);

    expect(resolved).toBe("copilot_002");
  });

  test("returns preferred session when no active sessions exist", () => {
    const resolved = resolveCopilotUserInputSessionId("tentative_session", []);

    expect(resolved).toBe("tentative_session");
  });
});

describe("CopilotClient abort support", () => {
  test("exposes abort method on wrapped session", async () => {
    // Create a mock SDK session with abort method
    const mockSdkSession = {
      sessionId: "test-session",
      on: mock(() => () => {}),
      send: mock(() => Promise.resolve()),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "test" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    // Create a mock SDK client that returns our mock session
    const mockSdkClient = {
      start: mock(() => Promise.resolve()),
      stop: mock(() => Promise.resolve()),
      createSession: mock(() => Promise.resolve(mockSdkSession)),
      listModels: mock(() => Promise.resolve([
        {
          id: "test-model",
          capabilities: {
            limits: { max_context_window_tokens: 128000 },
            supports: {},
          },
        },
      ])),
    };

    // Create the Copilot client
    const client = new CopilotClient({});
    
    // Replace the SDK client with our mock
    (client as any).sdkClient = mockSdkClient;
    (client as any).isRunning = true;

    // Create a session
    const session = await client.createSession({ sessionId: "test-session" });

    // Verify the session has an abort method
    expect(session.abort).toBeDefined();
    expect(typeof session.abort).toBe("function");

    // Call abort and verify it calls the underlying SDK abort
    await session.abort!();
    expect(mockSdkSession.abort).toHaveBeenCalled();
  });

  test("streams reasoning deltas with provider-native thinking source metadata", async () => {
    const listeners: Array<(event: {
      type: string;
      data: Record<string, unknown>;
    }) => void> = [];

    const mockSdkSession = {
      sessionId: "copilot-thinking-session",
      on: mock((handler: (event: { type: string; data: Record<string, unknown> }) => void) => {
        listeners.push(handler);
        return () => {
          const idx = listeners.indexOf(handler);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }),
      send: mock(async () => {
        for (const listener of [...listeners]) {
          listener({
            type: "assistant.reasoning_delta",
            data: {
              reasoningId: "reasoning_123",
              deltaContent: "planning",
            },
          });
        }
        for (const listener of [...listeners]) {
          listener({
            type: "session.idle",
            data: {},
          });
        }
      }),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    const client = new CopilotClient({});
    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: {
          sessionId: string;
          on: (handler: (event: { type: string; data: Record<string, unknown> }) => void) => () => void;
          send: (args: { prompt: string }) => Promise<void>;
          sendAndWait: (args: { prompt: string }) => Promise<{ data: { content: string } }>;
          destroy: () => Promise<void>;
          abort: () => Promise<void>;
        },
        config: Record<string, unknown>,
      ) => {
        stream: (message: string, options?: { agent?: string }) => AsyncIterable<{
          type: string;
          content: unknown;
          metadata?: Record<string, unknown>;
        }>;
      };
    }).wrapSession.bind(client);

    const session = wrapSession(mockSdkSession, {});
    const streamed: Array<{
      type: string;
      content: unknown;
      metadata?: Record<string, unknown>;
    }> = [];
    for await (const chunk of session.stream("hello")) {
      streamed.push(chunk);
    }

    expect(streamed).toHaveLength(1);
    const thinkingChunk = streamed[0]!;
    expect(thinkingChunk.type).toBe("thinking");
    expect(thinkingChunk.content).toBe("planning");
    expect(thinkingChunk.metadata?.provider).toBe("copilot");
    expect(thinkingChunk.metadata?.thinkingSourceKey).toBe("reasoning_123");
    expect(
      (thinkingChunk.metadata?.streamingStats as { outputTokens?: number } | undefined)
        ?.outputTokens,
    ).toBe(0);
  });
});
