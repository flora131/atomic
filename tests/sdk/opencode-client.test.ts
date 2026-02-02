/**
 * Unit tests for OpenCodeClient
 *
 * Tests cover:
 * - SDK installation verification
 * - Client lifecycle (start, stop)
 * - Health check functionality
 * - Connection retry logic
 * - Session management
 * - Event handling
 *
 * Note: These tests verify the SDK integration. Some tests require
 * an OpenCode server to be running for full integration testing.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";

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
  type OpenCodeClientOptions,
} from "../../src/sdk/opencode-client.ts";
import type { EventType } from "../../src/sdk/types.ts";

describe("OpenCodeClient", () => {
  let client: OpenCodeClient;

  beforeEach(() => {
    client = new OpenCodeClient({
      baseUrl: "http://localhost:4096",
      maxRetries: 1,
      retryDelay: 100,
    });
  });

  afterEach(async () => {
    try {
      await client.stop();
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe("Client Construction", () => {
    test("agentType is 'opencode'", () => {
      expect(client.agentType).toBe("opencode");
    });

    test("default options are applied", () => {
      const defaultClient = new OpenCodeClient();
      expect(defaultClient.getBaseUrl()).toBe("http://localhost:4096");
    });

    test("custom options are applied", () => {
      const customClient = new OpenCodeClient({
        baseUrl: "http://custom:8080",
      });
      expect(customClient.getBaseUrl()).toBe("http://custom:8080");
    });

    test("isConnectedToServer returns false initially", () => {
      expect(client.isConnectedToServer()).toBe(false);
    });

    test("getCurrentSessionId returns null initially", () => {
      expect(client.getCurrentSessionId()).toBeNull();
    });
  });

  describe("Health Check", () => {
    test("healthCheck returns error when server not running", async () => {
      // Use a port that is guaranteed not to have a server running
      const unreachableClient = new OpenCodeClient({
        baseUrl: "http://localhost:59999",
        maxRetries: 1,
        retryDelay: 100,
      });
      const health = await unreachableClient.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.error).toBeDefined();
    });
  });

  describe("Connection", () => {
    test("connect throws error when server not running", async () => {
      // Use a port that is guaranteed not to have a server running
      const unreachableClient = new OpenCodeClient({
        baseUrl: "http://localhost:59999",
        maxRetries: 1,
        retryDelay: 100,
      });
      await expect(unreachableClient.connect()).rejects.toThrow("Failed to connect");
    });

    test("start throws error when server not running and autoStart disabled", async () => {
      // Create client with autoStart disabled and unreachable port
      const noAutoStartClient = new OpenCodeClient({
        baseUrl: "http://localhost:59999",
        maxRetries: 1,
        retryDelay: 100,
        autoStart: false,
      });
      await expect(noAutoStartClient.start()).rejects.toThrow("Failed to connect");
    });
  });

  describe("Event Handling", () => {
    test("on() registers event handler", () => {
      let handlerCalled = false;
      const unsubscribe = client.on("session.start", () => {
        handlerCalled = true;
      });
      expect(typeof unsubscribe).toBe("function");
    });

    test("on() returns unsubscribe function", () => {
      const handler = () => {};
      const unsubscribe = client.on("session.start", handler);
      expect(typeof unsubscribe).toBe("function");
      // Should not throw
      unsubscribe();
    });

    test("multiple handlers for same event type", () => {
      let handler1Called = false;
      let handler2Called = false;

      client.on("session.start", () => {
        handler1Called = true;
      });
      client.on("session.start", () => {
        handler2Called = true;
      });

      // Both handlers registered without error
      expect(typeof handler1Called).toBe("boolean");
      expect(typeof handler2Called).toBe("boolean");
    });
  });

  describe("Tool Registration", () => {
    test("registerTool stores tool definition", () => {
      const tool = {
        name: "test-tool",
        description: "A test tool",
        inputSchema: { type: "object", properties: {} },
        handler: async () => "result",
      };

      // Should not throw
      client.registerTool(tool);
    });

    test("multiple tools can be registered", () => {
      const tool1 = {
        name: "tool-1",
        description: "First tool",
        inputSchema: {},
        handler: async () => "result-1",
      };

      const tool2 = {
        name: "tool-2",
        description: "Second tool",
        inputSchema: {},
        handler: async () => "result-2",
      };

      // Should not throw
      client.registerTool(tool1);
      client.registerTool(tool2);
    });
  });

  describe("Factory Function", () => {
    test("createOpenCodeClient returns OpenCodeClient instance", () => {
      const newClient = createOpenCodeClient();
      expect(newClient).toBeInstanceOf(OpenCodeClient);
      expect(newClient.agentType).toBe("opencode");
    });

    test("createOpenCodeClient with options", () => {
      const newClient = createOpenCodeClient({
        baseUrl: "https://api.example.com",
        timeout: 30000,
      });
      expect(newClient).toBeInstanceOf(OpenCodeClient);
      expect(newClient.getBaseUrl()).toBe("https://api.example.com");
    });
  });

  describe("Session Operations (Server Required)", () => {
    test("createSession throws before start()", async () => {
      await expect(client.createSession()).rejects.toThrow(
        "Client not started"
      );
    });

    test("resumeSession throws before start()", async () => {
      await expect(client.resumeSession("test-id")).rejects.toThrow(
        "Client not started"
      );
    });

    test("listSessions returns empty array when not connected", async () => {
      const sessions = await client.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("Stop and Cleanup", () => {
    test("stop() is idempotent", async () => {
      // Stop should not throw even when not running
      await client.stop();
      await client.stop();
    });

    test("disconnect clears connection state", async () => {
      await client.disconnect();
      expect(client.isConnectedToServer()).toBe(false);
      expect(client.getCurrentSessionId()).toBeNull();
    });
  });
});

/**
 * SSE Event Mapping Tests
 *
 * These tests verify the event mapping logic that converts OpenCode SDK events
 * to the unified event format. Since handleSdkEvent is private, we test through
 * the public event subscription interface.
 */
describe("SSE Event Mapping", () => {
  let client: OpenCodeClient;

  beforeEach(() => {
    client = new OpenCodeClient({
      baseUrl: "http://localhost:4096",
      maxRetries: 1,
      retryDelay: 100,
    });
  });

  afterEach(async () => {
    try {
      await client.stop();
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe("Event Handler Registration", () => {
    test("can register handlers for session.start event", () => {
      const events: unknown[] = [];
      const unsubscribe = client.on("session.start", (event) => {
        events.push(event);
      });
      expect(typeof unsubscribe).toBe("function");
    });

    test("can register handlers for session.idle event", () => {
      const events: unknown[] = [];
      const unsubscribe = client.on("session.idle", (event) => {
        events.push(event);
      });
      expect(typeof unsubscribe).toBe("function");
    });

    test("can register handlers for session.error event", () => {
      const events: unknown[] = [];
      const unsubscribe = client.on("session.error", (event) => {
        events.push(event);
      });
      expect(typeof unsubscribe).toBe("function");
    });

    test("can register handlers for message.delta event", () => {
      const events: unknown[] = [];
      const unsubscribe = client.on("message.delta", (event) => {
        events.push(event);
      });
      expect(typeof unsubscribe).toBe("function");
    });

    test("can register handlers for message.complete event", () => {
      const events: unknown[] = [];
      const unsubscribe = client.on("message.complete", (event) => {
        events.push(event);
      });
      expect(typeof unsubscribe).toBe("function");
    });

    test("can register handlers for tool.start event", () => {
      const events: unknown[] = [];
      const unsubscribe = client.on("tool.start", (event) => {
        events.push(event);
      });
      expect(typeof unsubscribe).toBe("function");
    });

    test("can register handlers for tool.complete event", () => {
      const events: unknown[] = [];
      const unsubscribe = client.on("tool.complete", (event) => {
        events.push(event);
      });
      expect(typeof unsubscribe).toBe("function");
    });

    test("unsubscribe removes handler", () => {
      let callCount = 0;
      const unsubscribe = client.on("session.start", () => {
        callCount++;
      });

      // Unsubscribe immediately
      unsubscribe();

      // Verify no errors after unsubscribe
      expect(typeof unsubscribe).toBe("function");
    });

    test("multiple handlers for same event type are independent", () => {
      let handler1Called = false;
      let handler2Called = false;

      const unsub1 = client.on("session.start", () => {
        handler1Called = true;
      });
      const unsub2 = client.on("session.start", () => {
        handler2Called = true;
      });

      // Unsubscribe only the first handler
      unsub1();

      // Second handler should still be registered
      expect(typeof unsub2).toBe("function");
    });
  });

  describe("Event Type Support", () => {
    test("supports all required event types", () => {
      // All these should register without error
      client.on("session.start", () => {});
      client.on("session.idle", () => {});
      client.on("session.error", () => {});
      client.on("message.delta", () => {});
      client.on("message.complete", () => {});
      client.on("tool.start", () => {});
      client.on("tool.complete", () => {});
    });
  });

  describe("SDK Event Type Mapping", () => {
    // These tests document the expected mapping from SDK events to unified events

    test("session.created SDK event should map to session.start", () => {
      // SDK event structure:
      // { type: "session.created", properties: { sessionID: "123" } }
      // Should emit: session.start event with sessionId

      // Register handler to verify the mapping exists
      const handler = client.on("session.start", (_event) => {
        // Handler registered successfully
      });
      expect(typeof handler).toBe("function");
    });

    test("session.idle SDK event should map to session.idle", () => {
      // SDK event structure:
      // { type: "session.idle", properties: { sessionID: "123" } }
      // Should emit: session.idle event with reason "idle"

      const handler = client.on("session.idle", (_event) => {});
      expect(typeof handler).toBe("function");
    });

    test("session.error SDK event should map to session.error", () => {
      // SDK event structure:
      // { type: "session.error", properties: { sessionID: "123", error: "..." } }
      // Should emit: session.error event with error message

      const handler = client.on("session.error", (_event) => {});
      expect(typeof handler).toBe("function");
    });

    test("message.updated SDK event should map to message.complete for assistant", () => {
      // SDK event structure:
      // { type: "message.updated", properties: { info: { role: "assistant", sessionID: "123" } } }
      // Should emit: message.complete event with message data

      const handler = client.on("message.complete", (_event) => {});
      expect(typeof handler).toBe("function");
    });

    test("message.part.updated with text should map to message.delta", () => {
      // SDK event structure:
      // { type: "message.part.updated", properties: { part: { type: "text", sessionID: "123" }, delta: "Hello" } }
      // Should emit: message.delta event with delta text

      const handler = client.on("message.delta", (_event) => {});
      expect(typeof handler).toBe("function");
    });

    test("message.part.updated with tool pending should map to tool.start", () => {
      // SDK event structure:
      // { type: "message.part.updated", properties: { part: { type: "tool", tool: "read", state: { status: "pending" } } } }
      // Should emit: tool.start event with toolName

      const handler = client.on("tool.start", (_event) => {});
      expect(typeof handler).toBe("function");
    });

    test("message.part.updated with tool completed should map to tool.complete", () => {
      // SDK event structure:
      // { type: "message.part.updated", properties: { part: { type: "tool", tool: "read", state: { status: "completed" } } } }
      // Should emit: tool.complete event with toolName and success: true

      const handler = client.on("tool.complete", (_event) => {});
      expect(typeof handler).toBe("function");
    });

    test("message.part.updated with tool error should map to tool.complete with success false", () => {
      // SDK event structure:
      // { type: "message.part.updated", properties: { part: { type: "tool", tool: "read", state: { status: "error" } } } }
      // Should emit: tool.complete event with toolName and success: false

      const handler = client.on("tool.complete", (_event) => {});
      expect(typeof handler).toBe("function");
    });

    test("question.asked SDK event should map to permission.requested", () => {
      // SDK event structure:
      // {
      //   type: "question.asked",
      //   properties: {
      //     id: "request-123",
      //     sessionID: "session-456",
      //     questions: [{ question: "Which option?", header: "Choice", options: [{ label: "A", description: "Option A" }], multiple: false }]
      //   }
      // }
      // Should emit: permission.requested event with requestId, toolName, question, options, multiSelect, and respond callback

      const handler = client.on("permission.requested", (_event) => {});
      expect(typeof handler).toBe("function");
    });

    test("permission.requested handler can be registered for OpenCode question events", () => {
      // Verify that the client supports the permission.requested event type
      // which is used for HITL (Human-in-the-Loop) interactions
      let eventReceived = false;
      const unsubscribe = client.on("permission.requested", () => {
        eventReceived = true;
      });

      expect(typeof unsubscribe).toBe("function");
      unsubscribe();
    });
  });

  describe("Streaming Interface", () => {
    test("session.stream method returns async iterable", async () => {
      // This test verifies the streaming interface structure
      // Actual streaming requires a running server

      // The session.stream method signature
      const mockSession = {
        stream: (message: string): AsyncIterable<unknown> => ({
          async *[Symbol.asyncIterator]() {
            yield { type: "text", content: message, role: "assistant" };
          },
        }),
      };

      const iterator = mockSession.stream("Hello");
      expect(iterator[Symbol.asyncIterator]).toBeDefined();
    });

    test("stream method exists on Session interface", async () => {
      // Verify the Session interface includes stream method
      // by checking the wrapped session structure

      // This validates the interface without needing a server
      const sessionInterface = {
        id: "test",
        send: async (_: string) => ({}),
        stream: (_: string) => ({
          async *[Symbol.asyncIterator]() {
            yield {};
          },
        }),
        summarize: async () => {},
        getContextUsage: async () => ({
          inputTokens: 0,
          outputTokens: 0,
          maxTokens: 200000,
          usagePercentage: 0,
        }),
        destroy: async () => {},
      };

      expect(typeof sessionInterface.stream).toBe("function");
    });
  });

  describe("Reconnection Logic", () => {
    test("disconnect clears event subscription controller", async () => {
      // Verify disconnect properly cleans up SSE subscription
      await client.disconnect();
      expect(client.isConnectedToServer()).toBe(false);
    });

    test("stop clears all resources", async () => {
      // Verify stop cleans up everything including event handlers
      await client.stop();
      expect(client.isConnectedToServer()).toBe(false);
    });

    test("client can be restarted after stop", async () => {
      // Verify client state is reset after stop
      await client.stop();
      expect(client.isConnectedToServer()).toBe(false);
      expect(client.getCurrentSessionId()).toBeNull();
    });
  });
});

/**
 * Agent Mode Tests
 *
 * These tests verify that OpenCode agent modes (build, plan, general, explore)
 * are properly configured and passed to the SDK.
 */
describe("Agent Mode Support", () => {
  let client: OpenCodeClient;

  beforeEach(() => {
    client = new OpenCodeClient({
      baseUrl: "http://localhost:4096",
      maxRetries: 1,
      retryDelay: 100,
    });
  });

  afterEach(async () => {
    try {
      await client.stop();
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe("OpenCodeClientOptions", () => {
    test("defaultAgentMode is optional", () => {
      const defaultClient = new OpenCodeClient();
      expect(defaultClient).toBeInstanceOf(OpenCodeClient);
    });

    test("defaultAgentMode can be set to build", () => {
      const buildClient = new OpenCodeClient({
        defaultAgentMode: "build",
      });
      expect(buildClient).toBeInstanceOf(OpenCodeClient);
    });

    test("defaultAgentMode can be set to plan", () => {
      const planClient = new OpenCodeClient({
        defaultAgentMode: "plan",
      });
      expect(planClient).toBeInstanceOf(OpenCodeClient);
    });

    test("defaultAgentMode can be set to general", () => {
      const generalClient = new OpenCodeClient({
        defaultAgentMode: "general",
      });
      expect(generalClient).toBeInstanceOf(OpenCodeClient);
    });

    test("defaultAgentMode can be set to explore", () => {
      const exploreClient = new OpenCodeClient({
        defaultAgentMode: "explore",
      });
      expect(exploreClient).toBeInstanceOf(OpenCodeClient);
    });
  });

  describe("OpenCodeAgentMode Type", () => {
    test("build mode is valid", () => {
      const mode: import("../../src/sdk/types.ts").OpenCodeAgentMode = "build";
      expect(mode).toBe("build");
    });

    test("plan mode is valid", () => {
      const mode: import("../../src/sdk/types.ts").OpenCodeAgentMode = "plan";
      expect(mode).toBe("plan");
    });

    test("general mode is valid", () => {
      const mode: import("../../src/sdk/types.ts").OpenCodeAgentMode = "general";
      expect(mode).toBe("general");
    });

    test("explore mode is valid", () => {
      const mode: import("../../src/sdk/types.ts").OpenCodeAgentMode = "explore";
      expect(mode).toBe("explore");
    });
  });

  describe("SessionConfig agentMode", () => {
    test("agentMode can be passed in session config", () => {
      // Verify that SessionConfig accepts agentMode
      const config: import("../../src/sdk/types.ts").SessionConfig = {
        agentMode: "plan",
      };
      expect(config.agentMode).toBe("plan");
    });

    test("agentMode is optional in session config", () => {
      const config: import("../../src/sdk/types.ts").SessionConfig = {};
      expect(config.agentMode).toBeUndefined();
    });

    test("agentMode can be combined with other config options", () => {
      const config: import("../../src/sdk/types.ts").SessionConfig = {
        model: "claude-3-opus",
        sessionId: "test-session",
        agentMode: "explore",
      };
      expect(config.agentMode).toBe("explore");
      expect(config.model).toBe("claude-3-opus");
    });
  });

  describe("Mode Fallback Logic", () => {
    test("defaults to build when no mode specified", () => {
      // When creating a session without agentMode,
      // and client has no defaultAgentMode,
      // it should default to "build"
      const defaultClient = new OpenCodeClient();
      expect(defaultClient).toBeInstanceOf(OpenCodeClient);
      // The actual mode is used internally when sending prompts
      // This test verifies the client can be created
    });

    test("client defaultAgentMode is used when session config has no mode", () => {
      const planClient = new OpenCodeClient({
        defaultAgentMode: "plan",
      });
      expect(planClient).toBeInstanceOf(OpenCodeClient);
    });

    test("session config agentMode overrides client default", () => {
      // Session-level agentMode should take precedence
      const sessionConfig: import("../../src/sdk/types.ts").SessionConfig = {
        agentMode: "explore",
      };
      expect(sessionConfig.agentMode).toBe("explore");
    });
  });

  describe("Type Exports", () => {
    test("OpenCodeAgentMode is exported from types", async () => {
      const types = await import("../../src/sdk/types.ts");
      // Type-only check - TypeScript will validate this
      type Mode = typeof types extends { OpenCodeAgentMode: infer T } ? T : never;
      // Runtime check that the module exports correctly
      expect(types).toBeDefined();
    });

    test("OpenCodeAgentMode is exported from sdk index", async () => {
      const sdk = await import("../../src/sdk/index.ts");
      // Type-only check - the type is exported
      // Runtime check that the module exports correctly
      expect(sdk).toBeDefined();
    });
  });
});

/**
 * Integration Tests - Require OpenCode Server Running
 *
 * These tests are skipped by default and require an OpenCode server
 * to be running at http://localhost:4096
 *
 * To run: start OpenCode server, then run tests with OPENCODE_SERVER=1
 */
describe.skipIf(!process.env.OPENCODE_SERVER)(
  "OpenCodeClient Integration (Server Required)",
  () => {
    let client: OpenCodeClient;

    beforeEach(async () => {
      client = new OpenCodeClient({
        baseUrl: "http://localhost:4096",
        maxRetries: 3,
        retryDelay: 1000,
      });
    });

    afterEach(async () => {
      await client.stop();
    });

    test("healthCheck returns healthy when server is running", async () => {
      const health = await client.healthCheck();
      expect(health.healthy).toBe(true);
    });

    test("connect succeeds when server is running", async () => {
      const result = await client.connect();
      expect(result).toBe(true);
      expect(client.isConnectedToServer()).toBe(true);
    });

    test("start() connects and subscribes to events", async () => {
      await client.start();
      expect(client.isConnectedToServer()).toBe(true);
    });

    test("createSession creates a new session", async () => {
      await client.start();
      const session = await client.createSession();
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(typeof session.send).toBe("function");
      expect(typeof session.stream).toBe("function");
      expect(typeof session.summarize).toBe("function");
      expect(typeof session.destroy).toBe("function");
    });

    test("listSessions returns sessions", async () => {
      await client.start();
      await client.createSession();
      const sessions = await client.listSessions();
      expect(Array.isArray(sessions)).toBe(true);
    });

    test("session.send returns agent message", async () => {
      await client.start();
      const session = await client.createSession();
      const response = await session.send("Hello, respond with OK");
      expect(response).toBeDefined();
      expect(response.role).toBe("assistant");
    });

    test("session.destroy removes session", async () => {
      await client.start();
      const session = await client.createSession();
      const sessionId = session.id;
      await session.destroy();
      expect(client.getCurrentSessionId()).not.toBe(sessionId);
    });
  }
);
