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

describe("CopilotClient subagent event mapping", () => {
  test("maps subagent.started to subagent.start with enriched data", async () => {
    const events: Array<{ type: string; sessionId: string; data: Record<string, unknown> }> = [];
    
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

    const client = new CopilotClient({});
    (client as any).sdkClient = mockSdkClient;
    (client as any).isRunning = true;

    // Register event listener
    client.on("subagent.start", (event) => {
      events.push({ type: "subagent.start", sessionId: event.sessionId, data: event.data });
    });

    // Trigger the internal event handler
    const handleSdkEvent = (client as any).handleSdkEvent.bind(client);
    handleSdkEvent("test-session", {
      type: "subagent.started",
      data: {
        toolCallId: "tc-123",
        agentName: "worker",
        agentDisplayName: "Worker",
        agentDescription: "Fix bug",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("subagent.start");
    expect(events[0]!.sessionId).toBe("test-session");
    expect(events[0]!.data).toEqual({
      subagentId: "tc-123",
      subagentType: "worker",
      toolCallId: "tc-123",
      task: "Fix bug",
    });
  });

  test("maps subagent.started with empty task when agentDescription is missing", async () => {
    const events: Array<{ type: string; sessionId: string; data: Record<string, unknown> }> = [];
    
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

    const client = new CopilotClient({});
    (client as any).sdkClient = mockSdkClient;
    (client as any).isRunning = true;

    client.on("subagent.start", (event) => {
      events.push({ type: "subagent.start", sessionId: event.sessionId, data: event.data });
    });

    const handleSdkEvent = (client as any).handleSdkEvent.bind(client);
    handleSdkEvent("test-session", {
      type: "subagent.started",
      data: {
        toolCallId: "tc-456",
        agentName: "debugger",
        agentDisplayName: "Debugger",
        agentDescription: "",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toEqual({
      subagentId: "tc-456",
      subagentType: "debugger",
      toolCallId: "tc-456",
      task: "",
    });
  });

  test("maps subagent.started with agentDescription when available, empty when not", async () => {
    const events: Array<{ type: string; sessionId: string; data: Record<string, unknown> }> = [];
    
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

    const client = new CopilotClient({});
    (client as any).sdkClient = mockSdkClient;
    (client as any).isRunning = true;

    client.on("subagent.start", (event) => {
      events.push({ type: "subagent.start", sessionId: event.sessionId, data: event.data });
    });

    const handleSdkEvent = (client as any).handleSdkEvent.bind(client);
    handleSdkEvent("test-session", {
      type: "subagent.started",
      data: {
        toolCallId: "tc-789",
        agentName: "explorer",
        agentDisplayName: "Explorer",
        agentDescription: "",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.data).toEqual({
      subagentId: "tc-789",
      subagentType: "explorer",
      toolCallId: "tc-789",
      task: "",
    });
  });

  test("maps subagent.completed to subagent.complete with success: true", async () => {
    const events: Array<{ type: string; sessionId: string; data: Record<string, unknown> }> = [];
    
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

    const client = new CopilotClient({});
    (client as any).sdkClient = mockSdkClient;
    (client as any).isRunning = true;

    client.on("subagent.complete", (event) => {
      events.push({ type: "subagent.complete", sessionId: event.sessionId, data: event.data });
    });

    const handleSdkEvent = (client as any).handleSdkEvent.bind(client);
    handleSdkEvent("test-session", {
      type: "subagent.completed",
      data: {
        toolCallId: "tc-123",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("subagent.complete");
    expect(events[0]!.sessionId).toBe("test-session");
    expect(events[0]!.data).toEqual({
      subagentId: "tc-123",
      success: true,
    });
  });

  test("maps subagent.failed to subagent.complete with success: false and error", async () => {
    const events: Array<{ type: string; sessionId: string; data: Record<string, unknown> }> = [];
    
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

    const client = new CopilotClient({});
    (client as any).sdkClient = mockSdkClient;
    (client as any).isRunning = true;

    client.on("subagent.complete", (event) => {
      events.push({ type: "subagent.complete", sessionId: event.sessionId, data: event.data });
    });

    const handleSdkEvent = (client as any).handleSdkEvent.bind(client);
    handleSdkEvent("test-session", {
      type: "subagent.failed",
      data: {
        toolCallId: "tc-456",
        error: "Task execution failed",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("subagent.complete");
    expect(events[0]!.sessionId).toBe("test-session");
    expect(events[0]!.data).toEqual({
      subagentId: "tc-456",
      success: false,
      error: "Task execution failed",
    });
  });
});

describe("CopilotClient tool event mapping", () => {
  test("maps tool.execution_start using mcpToolName fallback", () => {
    const client = new CopilotClient({});
    const events: Array<{ sessionId: string; data: Record<string, unknown> }> = [];

    client.on("tool.start", (event) => {
      events.push({ sessionId: event.sessionId, data: event.data as Record<string, unknown> });
    });

    (client as unknown as {
      sessions: Map<string, {
        sdkSession: unknown;
        sessionId: string;
        config: Record<string, unknown>;
        inputTokens: number;
        outputTokens: number;
        isClosed: boolean;
        unsubscribe: () => void;
        toolCallIdToName: Map<string, string>;
        contextWindow: number | null;
        systemToolsBaseline: number | null;
      }>;
    }).sessions.set("test-session", {
      sdkSession: {},
      sessionId: "test-session",
      config: {},
      inputTokens: 0,
      outputTokens: 0,
      isClosed: false,
      unsubscribe: () => {},
      toolCallIdToName: new Map(),
      contextWindow: null,
      systemToolsBaseline: null,
    });

    const handleSdkEvent = (client as unknown as {
      handleSdkEvent: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
    }).handleSdkEvent.bind(client);

    handleSdkEvent("test-session", {
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-1",
        mcpToolName: "filesystem/read_file",
        arguments: "README.md",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.sessionId).toBe("test-session");
    expect(events[0]!.data).toEqual({
      toolName: "filesystem/read_file",
      toolInput: "README.md",
      toolCallId: "tool-1",
      parentId: undefined,
    });
  });

  test("maps tool.execution_complete with result fallbacks and tracked tool name", () => {
    const client = new CopilotClient({});
    const events: Array<{ sessionId: string; data: Record<string, unknown> }> = [];

    client.on("tool.complete", (event) => {
      events.push({ sessionId: event.sessionId, data: event.data as Record<string, unknown> });
    });

    const trackedNames = new Map<string, string>();
    trackedNames.set("tool-2", "view");

    (client as unknown as {
      sessions: Map<string, {
        sdkSession: unknown;
        sessionId: string;
        config: Record<string, unknown>;
        inputTokens: number;
        outputTokens: number;
        isClosed: boolean;
        unsubscribe: () => void;
        toolCallIdToName: Map<string, string>;
        contextWindow: number | null;
        systemToolsBaseline: number | null;
      }>;
    }).sessions.set("test-session", {
      sdkSession: {},
      sessionId: "test-session",
      config: {},
      inputTokens: 0,
      outputTokens: 0,
      isClosed: false,
      unsubscribe: () => {},
      toolCallIdToName: trackedNames,
      contextWindow: null,
      systemToolsBaseline: null,
    });

    const handleSdkEvent = (client as unknown as {
      handleSdkEvent: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
    }).handleSdkEvent.bind(client);

    handleSdkEvent("test-session", {
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-2",
        success: true,
        result: {
          detailedContent: "line 1\nline 2",
        },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.sessionId).toBe("test-session");
    expect(events[0]!.data).toEqual({
      toolName: "view",
      success: true,
      toolResult: "line 1\nline 2",
      error: undefined,
      toolCallId: "tool-2",
      parentId: undefined,
    });
  });
});
