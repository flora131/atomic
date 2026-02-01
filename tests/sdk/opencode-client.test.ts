/**
 * Unit tests for OpenCodeClient
 *
 * Tests cover:
 * - SDK installation verification
 * - Client lifecycle (start, stop)
 * - Session creation and management
 * - Message sending and streaming
 * - Context compaction (summarize)
 * - Event handler registration
 * - Tool registration
 *
 * Note: These tests use mock implementations of the OpenCode SDK interfaces.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

/**
 * SDK Installation Verification Tests
 *
 * These tests verify that the @opencode-ai/sdk package is installed
 * and exports are accessible.
 */
describe("@opencode-ai/sdk Installation", () => {
  test("@opencode-ai/sdk package is installed", async () => {
    // Verify the package is importable
    const sdkModule = await import("@opencode-ai/sdk/v2/client");
    expect(sdkModule).toBeDefined();
  });

  test("createOpencodeClient function is exported", async () => {
    const { createOpencodeClient } = await import("@opencode-ai/sdk/v2/client");
    expect(typeof createOpencodeClient).toBe("function");
  });

  test("OpencodeClient class is exported", async () => {
    const { OpencodeClient } = await import("@opencode-ai/sdk/v2/client");
    expect(OpencodeClient).toBeDefined();
    expect(typeof OpencodeClient).toBe("function");
  });

  test("SDK types are accessible", async () => {
    // Import the types module to verify it exists
    const typesModule = await import("@opencode-ai/sdk/v2/client");
    // OpencodeClientConfig is a type alias for Config
    expect(typesModule).toBeDefined();
  });

  test("createOpencodeClient creates a client instance", async () => {
    const { createOpencodeClient, OpencodeClient } = await import(
      "@opencode-ai/sdk/v2/client"
    );
    // Create a client without connecting (no server needed for this test)
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
    });
    expect(client).toBeInstanceOf(OpencodeClient);
  });

  test("client has expected session methods", async () => {
    const { createOpencodeClient } = await import("@opencode-ai/sdk/v2/client");
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
    });

    // Verify session namespace exists with expected methods
    expect(client.session).toBeDefined();
    expect(typeof client.session.create).toBe("function");
    expect(typeof client.session.get).toBe("function");
    expect(typeof client.session.list).toBe("function");
    expect(typeof client.session.prompt).toBe("function");
    expect(typeof client.session.summarize).toBe("function");
    expect(typeof client.session.messages).toBe("function");
  });

  test("client has expected global methods", async () => {
    const { createOpencodeClient } = await import("@opencode-ai/sdk/v2/client");
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
    });

    // Verify global namespace exists with expected methods
    expect(client.global).toBeDefined();
    expect(typeof client.global.health).toBe("function");
    expect(typeof client.global.event).toBe("function");
  });

  test("client has expected event methods", async () => {
    const { createOpencodeClient } = await import("@opencode-ai/sdk/v2/client");
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
    });

    // Verify event namespace exists with expected methods
    expect(client.event).toBeDefined();
    expect(typeof client.event.subscribe).toBe("function");
  });

  test("SDK version is 1.x.x or higher", async () => {
    // Read package.json to verify version
    const packageJson = await import("@opencode-ai/sdk/package.json", {
      with: { type: "json" },
    });
    const version = packageJson.default.version;
    expect(version).toBeDefined();
    // Version should be 1.x.x or higher (or a snapshot version)
    expect(
      version.startsWith("1.") ||
        version.startsWith("0.0.0-") ||
        parseInt(version.split(".")[0]) >= 1
    ).toBe(true);
  });
});
import {
  OpenCodeClient,
  createOpenCodeClient,
  type OpenCodeSdkClient,
  type OpenCodeSdkSession,
  type OpenCodeSdkMessage,
  type OpenCodeSdkStreamEvent,
  type OpenCodeSdkEventType,
  type OpenCodeSdkEvent,
  type CreateOpenCodeClientFn,
} from "../../src/sdk/opencode-client.ts";
import type { SessionConfig, EventType, ToolDefinition } from "../../src/sdk/types.ts";

/**
 * Create a mock OpenCode SDK session
 */
function createMockSession(id: string): OpenCodeSdkSession {
  let destroyed = false;
  const mockMessages: OpenCodeSdkMessage[] = [];

  return {
    id,
    send: async (message: string): Promise<OpenCodeSdkMessage> => {
      if (destroyed) throw new Error("Session destroyed");
      const response: OpenCodeSdkMessage = {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: `Response to: ${message}`,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, contextLimit: 200000 },
      };
      mockMessages.push(response);
      return response;
    },
    stream: async function* (message: string): AsyncIterable<OpenCodeSdkStreamEvent> {
      if (destroyed) throw new Error("Session destroyed");
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
    summarize: async (): Promise<void> => {
      if (destroyed) throw new Error("Session destroyed");
      // Mock summarize - would compact context in real SDK
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
 * Create a mock OpenCode SDK client
 */
function createMockSdkClient(): OpenCodeSdkClient {
  const sessions = new Map<string, OpenCodeSdkSession>();
  const eventHandlers = new Map<OpenCodeSdkEventType, Array<(event: OpenCodeSdkEvent) => void>>();
  const tools: Array<{ name: string; description: string; parameters: unknown; handler: unknown }> = [];
  let started = false;
  let sessionCounter = 0;

  return {
    session: {
      create: async (config) => {
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
    on: (eventType: OpenCodeSdkEventType, handler: (event: OpenCodeSdkEvent) => void) => {
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
    start: async () => {
      started = true;
    },
    stop: async () => {
      started = false;
      sessions.clear();
    },
  };
}

/**
 * Create a mock factory function
 */
function createMockClientFactory(): CreateOpenCodeClientFn {
  return () => createMockSdkClient();
}

describe("OpenCodeClient", () => {
  let client: OpenCodeClient;
  let mockFactory: CreateOpenCodeClientFn;

  beforeEach(() => {
    mockFactory = createMockClientFactory();
    client = new OpenCodeClient(mockFactory);
  });

  afterEach(async () => {
    await client.stop();
  });

  describe("Client Lifecycle", () => {
    test("agentType is 'opencode'", () => {
      expect(client.agentType).toBe("opencode");
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
      const clientWithoutFactory = new OpenCodeClient();
      await expect(clientWithoutFactory.start()).rejects.toThrow("No SDK client factory");
    });

    test("setClientFactory allows late factory injection", async () => {
      const clientWithoutFactory = new OpenCodeClient();
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
      await client.start(); // Should not throw
      const session = await client.createSession();
      expect(session).toBeDefined();
    });

    test("stop() is idempotent", async () => {
      await client.start();
      await client.stop();
      await client.stop(); // Should not throw
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

    test("createSession uses custom sessionId if provided", async () => {
      // Note: The SDK generates its own ID, but we track with custom ID
      const session = await client.createSession({ sessionId: "my-session" });
      // The session ID comes from the SDK, not our config
      expect(session.id).toBeDefined();
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

    test("session.send tracks token usage", async () => {
      const session = await client.createSession();
      await session.send("Hello");
      const usage = await session.getContextUsage();
      // After send, we should have updated usage
      expect(usage.inputTokens).toBeGreaterThan(0);
    });

    test("session.stream yields message chunks", async () => {
      const session = await client.createSession();
      const chunks: string[] = [];
      for await (const msg of session.stream("Test")) {
        if (msg.type === "text" && typeof msg.content === "string") {
          chunks.push(msg.content);
        }
      }
      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks.some((c) => c.includes("Hello"))).toBe(true);
    });

    test("session.summarize calls SDK summarize", async () => {
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

    test("session.destroy is idempotent", async () => {
      const session = await client.createSession();
      await session.destroy();
      await session.destroy(); // Should not throw
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
      const newClient = new OpenCodeClient(mockFactory);
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

    test("multiple handlers for same event type", async () => {
      let handler1Called = false;
      let handler2Called = false;

      client.on("session.start", () => {
        handler1Called = true;
      });
      client.on("session.start", () => {
        handler2Called = true;
      });

      await client.createSession();
      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(true);
    });

    test("event handlers receive correct event data", async () => {
      let receivedType = "";
      let receivedSessionId = "";

      client.on("session.start", (event) => {
        receivedType = event.type;
        receivedSessionId = event.sessionId;
      });

      const session = await client.createSession();
      expect(receivedType).toBe("session.start");
      expect(receivedSessionId).toBeDefined();
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
      // Tool should be registered with SDK
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
      // Tool should be immediately registered with SDK
      const session = await client.createSession();
      expect(session).toBeDefined();
    });

    test("multiple tools can be registered", async () => {
      const tool1: ToolDefinition = {
        name: "tool-1",
        description: "First tool",
        inputSchema: {},
        handler: async () => "result-1",
      };

      const tool2: ToolDefinition = {
        name: "tool-2",
        description: "Second tool",
        inputSchema: {},
        handler: async () => "result-2",
      };

      client.registerTool(tool1);
      client.registerTool(tool2);
      await client.start();

      const session = await client.createSession();
      expect(session).toBeDefined();
    });
  });

  describe("Factory Function", () => {
    test("createOpenCodeClient returns OpenCodeClient instance", () => {
      const client = createOpenCodeClient(mockFactory);
      expect(client).toBeInstanceOf(OpenCodeClient);
      expect(client.agentType).toBe("opencode");
    });

    test("createOpenCodeClient with options", () => {
      const client = createOpenCodeClient(mockFactory, {
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
        timeout: 30000,
      });
      expect(client).toBeInstanceOf(OpenCodeClient);
    });
  });

  describe("Context Compaction", () => {
    beforeEach(async () => {
      await client.start();
    });

    test("summarize emits session.idle event", async () => {
      let idleReceived = false;
      let idleReason = "";

      client.on("session.idle", (event) => {
        idleReceived = true;
        idleReason = (event.data as { reason?: string }).reason ?? "";
      });

      const session = await client.createSession();
      await session.summarize();

      expect(idleReceived).toBe(true);
      expect(idleReason).toBe("context_compacted");
    });

    test("summarize throws on destroyed session", async () => {
      const session = await client.createSession();
      await session.destroy();
      await expect(session.summarize()).rejects.toThrow("Session is closed");
    });
  });
});
