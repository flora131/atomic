import { describe, expect, test, mock } from "bun:test";

import { resolveCopilotUserInputSessionId } from "@/services/agents/clients/copilot.ts";
import { CopilotClient } from "@/services/agents/clients/copilot.ts";
import { getBundledCopilotCliPath } from "@/services/agents/clients/copilot.ts";

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

describe("getBundledCopilotCliPath", () => {
  test("prefers an installed copilot binary on PATH over the bundled package", async () => {
    const cliPath = await getBundledCopilotCliPath({
      which: () => "/usr/local/bin/copilot",
      pathExists: async (path) => path === "/usr/local/bin/copilot",
      resolveImport: (specifier) => {
        if (specifier === "@github/copilot/sdk") {
          return "file:///tmp/node_modules/@github/copilot/sdk/index.js";
        }
        if (specifier === "@github/copilot-sdk") {
          return "file:///tmp/node_modules/@github/copilot-sdk/dist/index.js";
        }
        throw new Error(`Unexpected import resolution for ${specifier}`);
      },
    });

    expect(cliPath).toBe("/usr/local/bin/copilot");
  });

  test("skips project-local node_modules shims and prefers an external copilot binary", async () => {
    const cliPath = await getBundledCopilotCliPath({
      which: () => "/workspace/app/node_modules/.bin/copilot",
      pathEnv: "/workspace/app/node_modules/.bin:/home/alice/.local/bin:/usr/bin",
      pathExists: async (path) =>
        path === "/workspace/app/node_modules/.bin/copilot" ||
        path === "/home/alice/.local/bin/copilot",
      resolveImport: (specifier) => {
        if (specifier === "@github/copilot/sdk") {
          return "file:///tmp/node_modules/@github/copilot/sdk/index.js";
        }
        if (specifier === "@github/copilot-sdk") {
          return "file:///tmp/node_modules/@github/copilot-sdk/dist/index.js";
        }
        throw new Error(`Unexpected import resolution for ${specifier}`);
      },
    });

    expect(cliPath).toBe("/home/alice/.local/bin/copilot");
  });

  test("falls back to the bundled copilot package when no PATH binary exists", async () => {
    const cliPath = await getBundledCopilotCliPath({
      which: () => undefined,
      pathExists: async (path) => path === "/tmp/node_modules/@github/copilot/index.js",
      resolveImport: (specifier) => {
        if (specifier === "@github/copilot/sdk") {
          return "file:///tmp/node_modules/@github/copilot/sdk/index.js";
        }
        if (specifier === "@github/copilot-sdk") {
          return "file:///tmp/node_modules/@github/copilot-sdk/dist/index.js";
        }
        throw new Error(`Unexpected import resolution for ${specifier}`);
      },
    });

    expect(cliPath).toBe("/tmp/node_modules/@github/copilot/index.js");
  });

});

describe("CopilotClient.getModelDisplayInfo", () => {
  test("includes default reasoning effort for hinted reasoning-capable model", async () => {
    const client = new CopilotClient({});
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { sdkClient: { listModels: () => Promise<unknown[]> } }).sdkClient = {
      listModels: mock(async () => ([
        {
          id: "gpt-5",
          defaultReasoningEffort: "high",
          capabilities: {
            supports: { reasoningEffort: true },
            limits: { max_context_window_tokens: 256000 },
          },
        },
      ])),
    };

    const info = await client.getModelDisplayInfo("github-copilot/gpt-5");

    expect(info.model).toBe("gpt-5");
    expect(info.supportsReasoning).toBe(true);
    expect(info.defaultReasoningEffort).toBe("high");
  });

  test("uses first model default reasoning effort when no hint is provided", async () => {
    const client = new CopilotClient({});
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { sdkClient: { listModels: () => Promise<unknown[]> } }).sdkClient = {
      listModels: mock(async () => ([
        {
          id: "claude-opus-4.6",
          defaultReasoningEffort: "medium",
          capabilities: {
            supports: { reasoningEffort: true },
            limits: { max_context_window_tokens: 200000 },
          },
        },
      ])),
    };

    const info = await client.getModelDisplayInfo();

    expect(info.model).toBe("claude-opus-4.6");
    expect(info.supportsReasoning).toBe(true);
    expect(info.defaultReasoningEffort).toBe("medium");
  });
});

describe("CopilotClient.listAvailableModels", () => {
  test("returns models from the active SDK client when using an external server", async () => {
    const client = new CopilotClient({});
    const expectedModels = [
      {
        id: "gpt-5",
        capabilities: {
          supports: { reasoningEffort: true },
          limits: { max_context_window_tokens: 256000 },
        },
      },
    ];
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { isExternalServer: boolean }).isExternalServer = true;
    (client as unknown as { sdkClient: { listModels: () => Promise<unknown[]> } }).sdkClient = {
      listModels: mock(async () => expectedModels),
    };

    await expect(client.listAvailableModels()).resolves.toEqual(expectedModels);
  });

  test("bypasses the SDK model cache via fresh models.list RPC for external servers", async () => {
    const client = new CopilotClient({});
    const staleModels = [
      {
        id: "old-model",
        capabilities: {
          supports: {},
          limits: { max_context_window_tokens: 128000 },
        },
      },
    ];
    const freshModels = [
      {
        id: "new-model",
        capabilities: {
          supports: {},
          limits: { max_context_window_tokens: 256000 },
        },
      },
    ];
    const sendRequest = mock(async (method: string) => {
      expect(method).toBe("models.list");
      return { models: freshModels };
    });
    const listModels = mock(async () => staleModels);

    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { isExternalServer: boolean }).isExternalServer = true;
    (client as unknown as {
      sdkClient: {
        connection: { sendRequest: (method: string, params: Record<string, never>) => Promise<{ models: unknown[] }> };
        modelsCache: unknown[] | null;
        listModels: () => Promise<unknown[]>;
      };
    }).sdkClient = {
      connection: { sendRequest },
      modelsCache: staleModels,
      listModels,
    };

    await expect(client.listAvailableModels()).resolves.toEqual(freshModels);
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(listModels).not.toHaveBeenCalled();
  });

  test("uses a fresh temporary SDK client for local model discovery", async () => {
    const client = new CopilotClient({});
    const freshModels = [
      {
        id: "new-model",
        capabilities: {
          supports: {},
          limits: { max_context_window_tokens: 256000 },
        },
      },
    ];
    const start = mock(async () => {});
    const stop = mock(async () => []);
    const sendRequest = mock(async () => ({ models: freshModels }));

    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { sdkClient: object }).sdkClient = {};
    (
      client as unknown as {
        buildSdkOptions: () => Promise<object>;
        createSdkClientInstance: (options: object) => {
          start: () => Promise<void>;
          stop: () => Promise<unknown[]>;
          connection: { sendRequest: (method: string, params: Record<string, never>) => Promise<{ models: unknown[] }> };
        };
      }
    ).buildSdkOptions = async () => ({ useStdio: true });
    (
      client as unknown as {
        createSdkClientInstance: (options: object) => {
          start: () => Promise<void>;
          stop: () => Promise<unknown[]>;
          connection: { sendRequest: (method: string, params: Record<string, never>) => Promise<{ models: unknown[] }> };
        };
      }
    ).createSdkClientInstance = () => ({
      start,
      stop,
      connection: { sendRequest },
    });

    await expect(client.listAvailableModels()).resolves.toEqual(freshModels);
    expect(start).toHaveBeenCalledTimes(1);
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe("CopilotClient abort support", () => {
  test("creates sessions with append-mode additional instructions", async () => {
    const mockSdkSession = {
      sessionId: "test-session",
      on: mock(() => () => {}),
      send: mock(() => Promise.resolve()),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "test" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    const mockCreateSession = mock(() => Promise.resolve(mockSdkSession));
    const mockSdkClient = {
      start: mock(() => Promise.resolve()),
      stop: mock(() => Promise.resolve()),
      createSession: mockCreateSession,
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

    await client.createSession({
      sessionId: "test-session",
      additionalInstructions: "Follow repository conventions.",
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "test-session",
        systemMessage: {
          mode: "append",
          content: "Follow repository conventions.",
        },
      }),
    );
  });

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
        stream: (message: string, options?: { agent?: string; abortSignal?: AbortSignal }) => AsyncIterable<{
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

  test("stream honors abortSignal and exits promptly", async () => {
    const listeners: Array<(event: {
      type: string;
      data: Record<string, unknown>;
    }) => void> = [];

    const mockSdkSession = {
      sessionId: "copilot-abort-signal-session",
      on: mock((handler: (event: { type: string; data: Record<string, unknown> }) => void) => {
        listeners.push(handler);
        return () => {
          const idx = listeners.indexOf(handler);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }),
      // Do not emit session.idle so the iterator would normally wait forever
      // unless abortSignal is honored.
      send: mock(async () => {
        for (const listener of [...listeners]) {
          listener({
            type: "assistant.message_delta",
            data: { deltaContent: "partial" },
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
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => {
        stream: (message: string, options?: { agent?: string; abortSignal?: AbortSignal }) => AsyncIterable<unknown>;
      };
    }).wrapSession.bind(client);

    const session = wrapSession(mockSdkSession, {});
    const abortController = new AbortController();

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("hello", { abortSignal: abortController.signal })) {
        // no-op
      }
    };

    const consumption = consumeStream();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    abortController.abort();

    await expect(consumption).rejects.toMatchObject({ name: "AbortError" });
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
        pendingAbortPromise: Promise<void> | null;
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
      pendingAbortPromise: null,
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
        pendingAbortPromise: Promise<void> | null;
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
      pendingAbortPromise: null,
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

describe("CopilotClient message_delta preserves parentToolCallId and messageId", () => {
  test("handleSdkEvent passes parentToolCallId and messageId to unified event", () => {
    const client = new CopilotClient({});
    const events: Array<{ data: Record<string, unknown> }> = [];

    client.on("message.delta", (event) => {
      events.push({ data: event.data as Record<string, unknown> });
    });

    const handleSdkEvent = (client as unknown as {
      handleSdkEvent: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
    }).handleSdkEvent.bind(client);

    handleSdkEvent("test-session", {
      type: "assistant.message_delta",
      data: {
        deltaContent: "Hello world",
        messageId: "msg-123",
        parentToolCallId: "tc-456",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.data.delta).toBe("Hello world");
    expect(events[0]!.data.messageId).toBe("msg-123");
    expect(events[0]!.data.parentToolCallId).toBe("tc-456");
  });

  test("handleSdkEvent omits parentToolCallId when not present", () => {
    const client = new CopilotClient({});
    const events: Array<{ data: Record<string, unknown> }> = [];

    client.on("message.delta", (event) => {
      events.push({ data: event.data as Record<string, unknown> });
    });

    const handleSdkEvent = (client as unknown as {
      handleSdkEvent: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
    }).handleSdkEvent.bind(client);

    handleSdkEvent("test-session", {
      type: "assistant.message_delta",
      data: {
        deltaContent: "Main agent text",
        messageId: "msg-789",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.data.delta).toBe("Main agent text");
    expect(events[0]!.data.messageId).toBe("msg-789");
    expect(events[0]!.data.parentToolCallId).toBeUndefined();
  });
});

describe("CopilotClient provider events", () => {
  test("preserves nativeType and native payload on provider events", () => {
    const client = new CopilotClient({});
    const providerEvents: Array<Record<string, unknown>> = [];

    client.onProviderEvent((event) => {
      providerEvents.push(event as unknown as Record<string, unknown>);
    });

    const handleSdkEvent = (client as unknown as {
      handleSdkEvent: (sessionId: string, event: {
        id: string;
        timestamp: string;
        parentId: string | null;
        type: string;
        data: Record<string, unknown>;
      }) => void;
    }).handleSdkEvent.bind(client);

    handleSdkEvent("test-session", {
      id: "evt-1",
      timestamp: new Date(0).toISOString(),
      parentId: null,
      type: "assistant.message_delta",
      data: {
        deltaContent: "Hello world",
        messageId: "msg-123",
      },
    });

    expect(providerEvents).toHaveLength(1);
    expect(providerEvents[0]!.type).toBe("message.delta");
    expect(providerEvents[0]!.nativeType).toBe("assistant.message_delta");
    expect((providerEvents[0]!.native as { type: string }).type).toBe("assistant.message_delta");
    expect(providerEvents[0]!.nativeMeta).toEqual({
      nativeEventId: "evt-1",
      nativeParentEventId: null,
      nativeMessageId: "msg-123",
    });
  });
});

describe("CopilotClient assistant.message preserves toolRequests", () => {
  test("handleSdkEvent passes toolRequests to message.complete event", () => {
    const client = new CopilotClient({});
    const events: Array<{ data: Record<string, unknown> }> = [];

    client.on("message.complete", (event) => {
      events.push({ data: event.data as Record<string, unknown> });
    });

    const handleSdkEvent = (client as unknown as {
      handleSdkEvent: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
    }).handleSdkEvent.bind(client);

    handleSdkEvent("test-session", {
      type: "assistant.message",
      data: {
        content: "Let me check that file.",
        messageId: "msg-001",
        interactionId: "int-001",
        phase: "final",
        reasoningText: "checked file state",
        reasoningOpaque: "opaque-reasoning",
        toolRequests: [
          { toolCallId: "tc-1", name: "view", arguments: { path: "/tmp/file.txt" } },
        ],
      },
    });

    expect(events).toHaveLength(1);
    const data = events[0]!.data;
    expect((data.message as Record<string, unknown>).content).toBe("Let me check that file.");
    expect(data.interactionId).toBe("int-001");
    expect(data.phase).toBe("final");
    expect(data.reasoningText).toBe("checked file state");
    expect(data.reasoningOpaque).toBe("opaque-reasoning");
    expect(data.toolRequests).toEqual([
      { toolCallId: "tc-1", name: "view", arguments: { path: "/tmp/file.txt" }, type: undefined },
    ]);
  });

  test("handleSdkEvent omits toolRequests when not present", () => {
    const client = new CopilotClient({});
    const events: Array<{ data: Record<string, unknown> }> = [];

    client.on("message.complete", (event) => {
      events.push({ data: event.data as Record<string, unknown> });
    });

    const handleSdkEvent = (client as unknown as {
      handleSdkEvent: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
    }).handleSdkEvent.bind(client);

    handleSdkEvent("test-session", {
      type: "assistant.message",
      data: {
        content: "Done!",
        messageId: "msg-002",
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.data.toolRequests).toBeUndefined();
  });
});

describe("CopilotClient stream() filters sub-agent deltas", () => {
  test("stream() skips assistant.message_delta with parentToolCallId", async () => {
    const listeners: Array<(event: {
      type: string;
      data: Record<string, unknown>;
    }) => void> = [];

    const mockSdkSession = {
      sessionId: "copilot-subagent-session",
      on: mock((handler: (event: { type: string; data: Record<string, unknown> }) => void) => {
        listeners.push(handler);
        return () => {
          const idx = listeners.indexOf(handler);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }),
      send: mock(async () => {
        // Main agent text
        for (const listener of [...listeners]) {
          listener({
            type: "assistant.message_delta",
            data: { deltaContent: "main text", messageId: "msg-1" },
          });
        }
        // Sub-agent text (should be skipped)
        for (const listener of [...listeners]) {
          listener({
            type: "assistant.message_delta",
            data: { deltaContent: "sub-agent text", messageId: "msg-2", parentToolCallId: "tc-sub" },
          });
        }
        // More main agent text
        for (const listener of [...listeners]) {
          listener({
            type: "assistant.message_delta",
            data: { deltaContent: " continues", messageId: "msg-1" },
          });
        }
        for (const listener of [...listeners]) {
          listener({ type: "session.idle", data: {} });
        }
      }),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    const client = new CopilotClient({});
    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => {
        stream: (message: string) => AsyncIterable<{
          type: string;
          content: unknown;
        }>;
      };
    }).wrapSession.bind(client);

    const session = wrapSession(mockSdkSession, {});
    const streamed: Array<{ type: string; content: unknown }> = [];
    for await (const chunk of session.stream("hello")) {
      streamed.push(chunk);
    }

    // Only main agent text should be yielded (sub-agent text filtered out)
    const textChunks = streamed.filter(c => c.type === "text");
    expect(textChunks).toHaveLength(2);
    expect(textChunks[0]!.content).toBe("main text");
    expect(textChunks[1]!.content).toBe(" continues");
  });
});

describe("CopilotClient error propagation", () => {
  test("maps structured session.error payloads to readable error strings", () => {
    const client = new CopilotClient({});
    const errors: Array<{ error?: unknown; code?: unknown }> = [];

    client.on("session.error", (event) => {
      const data = event.data as { error?: unknown; code?: unknown };
      errors.push({ error: data.error, code: data.code });
    });

    const handleSdkEvent = (client as unknown as {
      handleSdkEvent: (sessionId: string, event: { type: string; data: Record<string, unknown> }) => void;
    }).handleSdkEvent.bind(client);

    handleSdkEvent("copilot-session", {
      type: "session.error",
      data: {
        error: {
          message: "Copilot rate limit exceeded",
        },
        code: "RATE_LIMIT",
      },
    });

    expect(errors).toEqual([
      {
        error: "Copilot rate limit exceeded",
        code: "RATE_LIMIT",
      },
    ]);
  });

  test("stream propagates normalized provider errors", async () => {
    const listeners: Array<(event: {
      type: string;
      data: Record<string, unknown>;
    }) => void> = [];

    const mockSdkSession = {
      sessionId: "copilot-error-session",
      on: mock((handler: (event: { type: string; data: Record<string, unknown> }) => void) => {
        listeners.push(handler);
        return () => {
          const idx = listeners.indexOf(handler);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      }),
      send: mock(async () => {
        throw {
          error: {
            message: "Authentication failed",
          },
        };
      }),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
    };

    const client = new CopilotClient({});
    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => {
        stream: (message: string) => AsyncIterable<unknown>;
      };
    }).wrapSession.bind(client);

    const session = wrapSession(mockSdkSession, {});

    const consumeStream = async (): Promise<void> => {
      for await (const _chunk of session.stream("hello")) {
        // stream should throw before yielding when send() fails
      }
    };

    await expect(consumeStream()).rejects.toThrow("Authentication failed");
  });
});

describe("CopilotClient model switch event deduplication", () => {
  /**
   * Helper: create a minimal mock SDK session whose `.on()` captures
   * the handler so we can emit synthetic events later.
   */
  function createMockSdkSession(sessionId: string) {
    const listeners = new Set<(event: { type: string; id?: string; data: Record<string, unknown> }) => void>();
    return {
      sessionId,
      listeners,
      on: mock((handler: (event: { type: string; id?: string; data: Record<string, unknown> }) => void) => {
        listeners.add(handler);
        return () => {
          listeners.delete(handler);
        };
      }),
      send: mock(async () => ({})),
      sendAndWait: mock(() => Promise.resolve({ data: { content: "" } })),
      destroy: mock(() => Promise.resolve()),
      abort: mock(() => Promise.resolve()),
      emit(event: { type: string; id?: string; data: Record<string, unknown> }) {
        for (const fn of listeners) fn(event);
      },
    };
  }

  test("stale session events are ignored after setActiveSessionModel", async () => {
    const initialSdkSession = createMockSdkSession("copilot-dedup-session");
    const resumedSdkSession = createMockSdkSession("copilot-dedup-session");

    const client = new CopilotClient({});

    // Provide a mock sdkClient with resumeSession that returns the new session
    (client as unknown as { sdkClient: unknown }).sdkClient = {
      resumeSession: mock(async () => resumedSdkSession),
      listModels: mock(async () => []),
    };
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as { registeredTools: unknown[] }).registeredTools = [];

    // Create the initial wrapped session
    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => unknown;
    }).wrapSession.bind(client);

    wrapSession(initialSdkSession, { model: "gpt-4o" });

    // Collect deltas emitted by the client
    const deltas: string[] = [];
    client.on("message.delta", (event) => {
      deltas.push((event.data as { delta: string }).delta);
    });

    // Switch model — this replaces sdkSession in the state
    await client.setActiveSessionModel("openai/gpt-4o");

    // Events emitted on the OLD session object should be dropped
    initialSdkSession.emit({
      type: "assistant.message_delta",
      id: "stale-1",
      data: { deltaContent: "stale-delta" },
    });

    // Events on the NEW session should be processed
    resumedSdkSession.emit({
      type: "assistant.message_delta",
      id: "fresh-1",
      data: { deltaContent: "fresh-delta" },
    });

    expect(deltas).toEqual(["fresh-delta"]);
  });

  test("duplicate event IDs are suppressed within the same session", () => {
    const sdkSession = createMockSdkSession("copilot-dup-session");

    const client = new CopilotClient({});

    const wrapSession = (client as unknown as {
      wrapSession: (
        sdkSession: unknown,
        config: Record<string, unknown>,
      ) => unknown;
    }).wrapSession.bind(client);

    wrapSession(sdkSession, { model: "gpt-4o" });

    const deltas: string[] = [];
    client.on("message.delta", (event) => {
      deltas.push((event.data as { delta: string }).delta);
    });

    const duplicateEvent = {
      type: "assistant.message_delta" as const,
      id: "dup-evt-1",
      data: { deltaContent: "hello" },
    };

    // Emit the same event twice
    sdkSession.emit(duplicateEvent);
    sdkSession.emit(duplicateEvent);

    // Only one should be processed
    expect(deltas).toEqual(["hello"]);
  });
});
