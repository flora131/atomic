import { describe, expect, test, mock } from "bun:test";

import { CopilotClient } from "@/services/agents/clients/copilot.ts";

function createBasicSdkSession(sessionId = "test-session") {
  return {
    sessionId,
    on: mock(() => () => {}),
    send: mock(() => Promise.resolve()),
    sendAndWait: mock(() => Promise.resolve({ data: { content: "test" } })),
    destroy: mock(() => Promise.resolve()),
    abort: mock(() => Promise.resolve()),
  };
}

function createBasicSdkClient(overrides: Record<string, unknown> = {}) {
  return {
    start: mock(() => Promise.resolve()),
    stop: mock(() => Promise.resolve()),
    createSession: mock(),
    resumeSession: mock(),
    listModels: mock(() => Promise.resolve([
      {
        id: "test-model",
        capabilities: {
          limits: { max_context_window_tokens: 128000 },
          supports: {},
        },
      },
    ])),
    ...overrides,
  };
}

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

    const session = await client.createSession({ sessionId: "test-session" });

    expect(session.abort).toBeDefined();
    expect(typeof session.abort).toBe("function");

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

describe("CopilotClient session config parity", () => {
  test("passes raw tool names through unchanged and auto-approves permissions on create", async () => {
    const mockSdkSession = createBasicSdkSession();
    const mockCreateSession = mock(async (_config: Record<string, unknown>) => mockSdkSession);
    const mockSdkClient = createBasicSdkClient({
      createSession: mockCreateSession,
    });

    const client = new CopilotClient({});
    (client as unknown as { sdkClient: unknown }).sdkClient = mockSdkClient;
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as {
      loadCopilotSessionArtifacts: () => Promise<{
        customAgents?: Array<Record<string, unknown>>;
        skillDirectories?: string[];
      }>;
    }).loadCopilotSessionArtifacts = async () => ({
      customAgents: [
        {
          name: "worker",
          description: "Worker agent",
          tools: ["execute", "agent", "edit", "search", "read"],
          prompt: "Do work",
        },
      ],
      skillDirectories: ["/tmp/copilot-skills"],
    });

    await client.createSession({
      sessionId: "test-session",
      tools: ["execute", "read", "web"],
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "test-session",
        availableTools: ["execute", "read", "web"],
        customAgents: [
          expect.objectContaining({
            name: "worker",
            tools: ["execute", "agent", "edit", "search", "read"],
          }),
        ],
        skillDirectories: ["/tmp/copilot-skills"],
      }),
    );

    const createConfig = mockCreateSession.mock.calls[0]?.[0] as {
      onPermissionRequest: () => Promise<{ kind: string }>;
    };
    await expect(createConfig.onPermissionRequest()).resolves.toEqual({ kind: "approved" });
  });

  test("preserves raw tool config and approve-all permissions during model switch", async () => {
    const initialSdkSession = createBasicSdkSession("test-session");
    const resumedSdkSession = createBasicSdkSession("test-session");
    const mockCreateSession = mock(async () => initialSdkSession);
    const mockResumeSession = mock(
      async (_sessionId: string, _config: Record<string, unknown>) => resumedSdkSession,
    );
    const mockSdkClient = createBasicSdkClient({
      createSession: mockCreateSession,
      resumeSession: mockResumeSession,
    });

    const client = new CopilotClient({});
    (client as unknown as { sdkClient: unknown }).sdkClient = mockSdkClient;
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as {
      loadCopilotSessionArtifacts: () => Promise<{
        customAgents?: Array<Record<string, unknown>>;
        skillDirectories?: string[];
      }>;
    }).loadCopilotSessionArtifacts = async () => ({
      customAgents: [
        {
          name: "planner",
          description: "Planner agent",
          tools: ["search", "read", "execute"],
          prompt: "Plan work",
        },
      ],
      skillDirectories: ["/tmp/copilot-skills"],
    });

    await client.createSession({
      sessionId: "test-session",
      model: "github-copilot/test-model",
      additionalInstructions: "Follow repository conventions.",
      tools: ["execute", "read", "web"],
      mcpServers: [
        {
          name: "docs",
          type: "stdio",
          command: "bun",
          args: ["run", "mcp"],
          tools: ["lookup"],
        },
      ],
    });

    await client.setActiveSessionModel("github-copilot/test-model");

    expect(mockResumeSession).toHaveBeenCalledTimes(1);
    expect(mockResumeSession).toHaveBeenCalledWith(
      "test-session",
      expect.objectContaining({
        model: "test-model",
        availableTools: ["execute", "read", "web"],
        systemMessage: {
          mode: "append",
          content: "Follow repository conventions.",
        },
        customAgents: [
          expect.objectContaining({
            name: "planner",
            tools: ["search", "read", "execute"],
          }),
        ],
        skillDirectories: ["/tmp/copilot-skills"],
        mcpServers: {
          docs: expect.objectContaining({
            type: "stdio",
            command: "bun",
            args: ["run", "mcp"],
            tools: ["lookup"],
          }),
        },
      }),
    );

    const resumeConfig = mockResumeSession.mock.calls[0]?.[1] as {
      onPermissionRequest: () => Promise<{ kind: string }>;
    };
    await expect(resumeConfig.onPermissionRequest()).resolves.toEqual({ kind: "approved" });
  });

  test("appends loaded Copilot instructions ahead of per-session instructions", async () => {
    const mockSdkSession = createBasicSdkSession();
    const mockCreateSession = mock(async (_config: Record<string, unknown>) => mockSdkSession);
    const mockSdkClient = createBasicSdkClient({
      createSession: mockCreateSession,
    });

    const client = new CopilotClient({});
    (client as unknown as { sdkClient: unknown }).sdkClient = mockSdkClient;
    (client as unknown as { isRunning: boolean }).isRunning = true;
    (client as unknown as {
      loadCopilotSessionArtifacts: () => Promise<{
        customAgents?: Array<Record<string, unknown>>;
        skillDirectories?: string[];
        instructions?: string;
      }>;
    }).loadCopilotSessionArtifacts = async () => ({
      instructions: "Repository-wide Copilot instructions.",
    });

    await client.createSession({
      sessionId: "instruction-session",
      additionalInstructions: "Current task instructions.",
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "instruction-session",
        systemMessage: {
          mode: "append",
          content:
            "Repository-wide Copilot instructions.\n\nCurrent task instructions.",
        },
      }),
    );
  });

  test("uses approve-all permissions for the startup probe session", async () => {
    const probeSession = {
      on: mock((_eventType: string, handler: (event: { data: Record<string, unknown> }) => void) => {
        handler({ data: { currentTokens: 42 } });
        return () => {};
      }),
      destroy: mock(() => Promise.resolve()),
    };
    const mockCreateSession = mock(async (_config: Record<string, unknown>) => probeSession);

    const client = new CopilotClient({});
    (client as unknown as {
      buildSdkOptions: () => Promise<Record<string, unknown>>;
    }).buildSdkOptions = async () => ({ useStdio: true });
    (client as unknown as {
      createSdkClientInstance: (_options: Record<string, unknown>) => {
        start: () => Promise<void>;
        stop: () => Promise<void>;
        createSession: typeof mockCreateSession;
      };
    }).createSdkClientInstance = () => ({
      start: async () => {},
      stop: async () => {},
      createSession: mockCreateSession,
    });

    await client.start();
    await client.stop();

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    const probeConfig = mockCreateSession.mock.calls[0]?.[0] as {
      onPermissionRequest: () => Promise<{ kind: string }>;
    };
    await expect(probeConfig.onPermissionRequest()).resolves.toEqual({ kind: "approved" });
  });
});
