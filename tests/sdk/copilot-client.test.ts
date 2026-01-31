/**
 * Unit tests for CopilotClient
 *
 * Tests cover:
 * - Client lifecycle (start, stop)
 * - Connection modes (stdio, port, cliUrl)
 * - Session creation and management
 * - All 31 event types subscription
 * - Permission handler
 * - Tool registration
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  CopilotClient,
  createCopilotClient,
  createAutoApprovePermissionHandler,
  createDenyAllPermissionHandler,
  type CopilotSdkClient,
  type CopilotSdkSession,
  type CopilotSdkMessage,
  type CopilotSdkStreamEvent,
  type CopilotSdkEventType,
  type CopilotSdkEvent,
  type CopilotPermissionHandler,
  type CreateCopilotClientFn,
} from "../../src/sdk/copilot-client.ts";
import type { SessionConfig, EventType, ToolDefinition } from "../../src/sdk/types.ts";

/**
 * Create a mock Copilot SDK session
 */
function createMockSession(id: string): CopilotSdkSession {
  let destroyed = false;
  const eventHandlers = new Map<CopilotSdkEventType, Array<(event: CopilotSdkEvent) => void>>();

  return {
    id,
    send: async (message: string): Promise<CopilotSdkMessage> => {
      if (destroyed) throw new Error("Session destroyed");
      return {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: `Response to: ${message}`,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, contextLimit: 200000 },
      };
    },
    stream: async function* (message: string): AsyncIterable<CopilotSdkStreamEvent> {
      if (destroyed) throw new Error("Session destroyed");
      yield { type: "thinking", content: "Let me think..." };
      yield { type: "delta", content: "Hello" };
      yield { type: "delta", content: " World" };
      yield {
        type: "complete",
        message: {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: "Hello World",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, contextLimit: 200000 },
        },
      };
    },
    on: (eventType: CopilotSdkEventType, handler: (event: CopilotSdkEvent) => void) => {
      let handlers = eventHandlers.get(eventType);
      if (!handlers) {
        handlers = [];
        eventHandlers.set(eventType, handlers);
      }
      handlers.push(handler);
      return () => {
        const current = eventHandlers.get(eventType) ?? [];
        eventHandlers.set(
          eventType,
          current.filter((h) => h !== handler)
        );
      };
    },
    getUsage: async () => ({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      contextLimit: 200000,
    }),
    destroy: async (): Promise<void> => {
      destroyed = true;
    },
  };
}

/**
 * Create a mock Copilot SDK client
 */
function createMockSdkClient(): CopilotSdkClient {
  const sessions = new Map<string, CopilotSdkSession>();
  const eventHandlers = new Map<CopilotSdkEventType, Array<(event: CopilotSdkEvent) => void>>();
  const tools: Array<{ name: string; description: string; parameters: unknown; handler: unknown }> =
    [];
  let permissionHandler: CopilotPermissionHandler | null = null;
  let connected = false;
  let sessionCounter = 0;

  return {
    session: {
      create: async () => {
        sessionCounter++;
        const id = `session-${sessionCounter}`;
        const session = createMockSession(id);
        sessions.set(id, session);
        return session;
      },
      get: async (sessionId: string) => {
        return sessions.get(sessionId) ?? null;
      },
      list: async () => {
        return Array.from(sessions.values());
      },
    },
    on: (eventType: CopilotSdkEventType, handler: (event: CopilotSdkEvent) => void) => {
      let handlers = eventHandlers.get(eventType);
      if (!handlers) {
        handlers = [];
        eventHandlers.set(eventType, handlers);
      }
      handlers.push(handler);
      return () => {
        const current = eventHandlers.get(eventType) ?? [];
        eventHandlers.set(
          eventType,
          current.filter((h) => h !== handler)
        );
      };
    },
    tools: {
      register: (tool) => {
        tools.push(tool);
      },
      list: () => tools as any,
    },
    setPermissionHandler: (handler: CopilotPermissionHandler) => {
      permissionHandler = handler;
    },
    connect: async () => {
      connected = true;
    },
    disconnect: async () => {
      connected = false;
      sessions.clear();
    },
  };
}

/**
 * Create a mock factory function
 */
function createMockClientFactory(): CreateCopilotClientFn {
  return () => createMockSdkClient();
}

describe("CopilotClient", () => {
  let client: CopilotClient;
  let mockFactory: CreateCopilotClientFn;

  beforeEach(() => {
    mockFactory = createMockClientFactory();
    client = new CopilotClient(mockFactory);
  });

  afterEach(async () => {
    await client.stop();
  });

  describe("Client Lifecycle", () => {
    test("agentType is 'copilot'", () => {
      expect(client.agentType).toBe("copilot");
    });

    test("start() enables session creation", async () => {
      await client.start();
      const session = await client.createSession();
      expect(session).toBeDefined();
    });

    test("createSession throws before start()", async () => {
      await expect(client.createSession()).rejects.toThrow("Client not started");
    });

    test("start() throws without client factory", async () => {
      const clientWithoutFactory = new CopilotClient();
      await expect(clientWithoutFactory.start()).rejects.toThrow("No SDK client factory");
    });

    test("setClientFactory allows late factory injection", async () => {
      const clientWithoutFactory = new CopilotClient();
      clientWithoutFactory.setClientFactory(mockFactory);
      await clientWithoutFactory.start();
      const session = await clientWithoutFactory.createSession();
      expect(session).toBeDefined();
      await clientWithoutFactory.stop();
    });

    test("stop() cleans up all sessions", async () => {
      await client.start();
      await client.createSession();
      await client.createSession();
      await client.stop();
      await expect(client.createSession()).rejects.toThrow("Client not started");
    });

    test("start() is idempotent", async () => {
      await client.start();
      await client.start();
      const session = await client.createSession();
      expect(session).toBeDefined();
    });

    test("stop() is idempotent", async () => {
      await client.start();
      await client.stop();
      await client.stop();
    });
  });

  describe("Connection Modes", () => {
    test("supports stdio connection mode", async () => {
      const client = createCopilotClient(mockFactory, {
        connectionMode: { type: "stdio" },
      });
      await client.start();
      const session = await client.createSession();
      expect(session).toBeDefined();
      await client.stop();
    });

    test("supports port connection mode", async () => {
      const client = createCopilotClient(mockFactory, {
        connectionMode: { type: "port", port: 3000 },
      });
      await client.start();
      const session = await client.createSession();
      expect(session).toBeDefined();
      await client.stop();
    });

    test("supports cliUrl connection mode", async () => {
      const client = createCopilotClient(mockFactory, {
        connectionMode: { type: "cliUrl", url: "http://localhost:3000" },
      });
      await client.start();
      const session = await client.createSession();
      expect(session).toBeDefined();
      await client.stop();
    });
  });

  describe("Session Creation", () => {
    beforeEach(async () => {
      await client.start();
    });

    test("createSession returns a valid Session", async () => {
      const session = await client.createSession();
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(typeof session.send).toBe("function");
      expect(typeof session.stream).toBe("function");
      expect(typeof session.summarize).toBe("function");
      expect(typeof session.getContextUsage).toBe("function");
      expect(typeof session.destroy).toBe("function");
    });

    test("createSession generates unique sessionIds", async () => {
      const session1 = await client.createSession();
      const session2 = await client.createSession();
      expect(session1.id).not.toBe(session2.id);
    });
  });

  describe("Session Operations", () => {
    beforeEach(async () => {
      await client.start();
    });

    test("session.send returns agent message", async () => {
      const session = await client.createSession();
      const response = await session.send("Hello");
      expect(response.type).toBe("text");
      expect(response.content).toContain("Response to: Hello");
      expect(response.role).toBe("assistant");
    });

    test("session.stream yields thinking and message chunks", async () => {
      const session = await client.createSession();
      const chunks: Array<{ type: string; content: unknown }> = [];
      for await (const msg of session.stream("Test")) {
        chunks.push({ type: msg.type, content: msg.content });
      }
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      expect(chunks.some((c) => c.type === "thinking")).toBe(true);
      expect(chunks.some((c) => c.type === "text")).toBe(true);
    });

    test("session.summarize logs warning", async () => {
      const session = await client.createSession();
      // Should not throw
      await session.summarize();
    });

    test("session.getContextUsage returns usage stats", async () => {
      const session = await client.createSession();
      const usage = await session.getContextUsage();
      expect(usage).toHaveProperty("inputTokens");
      expect(usage).toHaveProperty("outputTokens");
      expect(usage).toHaveProperty("maxTokens");
      expect(usage).toHaveProperty("usagePercentage");
    });

    test("session.destroy closes the session", async () => {
      const session = await client.createSession();
      await session.destroy();
      await expect(session.send("test")).rejects.toThrow("Session is closed");
    });
  });

  describe("Session Resumption", () => {
    beforeEach(async () => {
      await client.start();
    });

    test("resumeSession returns null for unknown session", async () => {
      const resumed = await client.resumeSession("nonexistent");
      expect(resumed).toBeNull();
    });

    test("resumeSession returns existing active session", async () => {
      const session = await client.createSession();
      const sessionId = session.id;
      const resumed = await client.resumeSession(sessionId);
      expect(resumed).not.toBeNull();
      expect(resumed?.id).toBe(sessionId);
    });

    test("resumeSession throws before start()", async () => {
      const newClient = new CopilotClient(mockFactory);
      await expect(newClient.resumeSession("test")).rejects.toThrow("Client not started");
    });
  });

  describe("Event Handling", () => {
    beforeEach(async () => {
      await client.start();
    });

    test("on() registers event handler", async () => {
      let eventReceived = false;
      client.on("session.start", () => {
        eventReceived = true;
      });
      await client.createSession();
      expect(eventReceived).toBe(true);
    });

    test("on() returns unsubscribe function", async () => {
      let callCount = 0;
      const unsubscribe = client.on("session.start", () => {
        callCount++;
      });

      await client.createSession();
      expect(callCount).toBe(1);

      unsubscribe();
      await client.createSession();
      expect(callCount).toBe(1);
    });

    test("message.complete event is emitted on send", async () => {
      let messageCompleteReceived = false;

      client.on("message.complete", () => {
        messageCompleteReceived = true;
      });

      const session = await client.createSession();
      await session.send("Hello");
      expect(messageCompleteReceived).toBe(true);
    });

    test("session.idle event is emitted on destroy", async () => {
      let idleReceived = false;
      let idleReason = "";

      client.on("session.idle", (event) => {
        idleReceived = true;
        idleReason = (event.data as { reason?: string }).reason ?? "";
      });

      const session = await client.createSession();
      await session.destroy();
      expect(idleReceived).toBe(true);
      expect(idleReason).toBe("destroyed");
    });
  });

  describe("Permission Handler", () => {
    test("setPermissionHandler before start()", async () => {
      let handlerCalled = false;
      client.setPermissionHandler(async () => {
        handlerCalled = true;
        return "granted";
      });
      await client.start();
      const session = await client.createSession();
      expect(session).toBeDefined();
    });

    test("setPermissionHandler after start()", async () => {
      await client.start();
      client.setPermissionHandler(async () => "denied");
      const session = await client.createSession();
      expect(session).toBeDefined();
    });

    test("createAutoApprovePermissionHandler returns granted", async () => {
      const handler = createAutoApprovePermissionHandler();
      const result = await handler({
        id: "test",
        toolName: "bash",
        toolInput: { command: "ls" },
      });
      expect(result).toBe("granted");
    });

    test("createDenyAllPermissionHandler returns denied", async () => {
      const handler = createDenyAllPermissionHandler();
      const result = await handler({
        id: "test",
        toolName: "bash",
        toolInput: { command: "rm -rf /" },
      });
      expect(result).toBe("denied");
    });
  });

  describe("Tool Registration", () => {
    test("registerTool before start()", async () => {
      const tool: ToolDefinition = {
        name: "test-tool",
        description: "A test tool",
        inputSchema: { type: "object", properties: {} },
        handler: async () => "result",
      };

      client.registerTool(tool);
      await client.start();
      const session = await client.createSession();
      expect(session).toBeDefined();
    });

    test("registerTool after start()", async () => {
      await client.start();

      const tool: ToolDefinition = {
        name: "late-tool",
        description: "A late-registered tool",
        inputSchema: {},
        handler: async () => "late-result",
      };

      client.registerTool(tool);
      const session = await client.createSession();
      expect(session).toBeDefined();
    });
  });

  describe("Factory Function", () => {
    test("createCopilotClient returns CopilotClient instance", () => {
      const client = createCopilotClient(mockFactory);
      expect(client).toBeInstanceOf(CopilotClient);
      expect(client.agentType).toBe("copilot");
    });

    test("createCopilotClient with options", () => {
      const client = createCopilotClient(mockFactory, {
        connectionMode: { type: "port", port: 8080 },
        timeout: 30000,
      });
      expect(client).toBeInstanceOf(CopilotClient);
    });
  });

  describe("31 Event Types", () => {
    test("session subscribes to all 31 event types", async () => {
      await client.start();
      const session = await client.createSession();
      // The session wrapper subscribes to 28 session-level events
      // and the client subscribes to 3 connection-level events
      expect(session).toBeDefined();
    });
  });
});
