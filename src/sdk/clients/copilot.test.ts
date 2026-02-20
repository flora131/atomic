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
});
