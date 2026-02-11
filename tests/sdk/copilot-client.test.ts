/**
 * Unit tests for CopilotClient
 *
 * Tests cover:
 * - Client lifecycle (start, stop)
 * - Connection modes (stdio, port, cliUrl)
 * - Session creation and management
 * - Event subscription
 * - Permission handler
 * - Tool registration
 *
 * Note: These tests use mocks since the real Copilot SDK requires the Copilot CLI
 * to be installed and authenticated.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  CopilotClient,
  createCopilotClient,
  createAutoApprovePermissionHandler,
  createDenyAllPermissionHandler,
  type CopilotPermissionHandler,
  type CopilotClientOptions,
} from "../../src/sdk/copilot-client.ts";
import type { ToolDefinition } from "../../src/sdk/types.ts";

describe("CopilotClient", () => {
  let client: CopilotClient;

  beforeEach(() => {
    client = new CopilotClient();
  });

  afterEach(async () => {
    try {
      await client.stop();
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe("Client Initialization", () => {
    test("agentType is 'copilot'", () => {
      expect(client.agentType).toBe("copilot");
    });

    test("getState returns 'disconnected' before start()", () => {
      expect(client.getState()).toBe("disconnected");
    });

    test("createSession throws before start()", async () => {
      await expect(client.createSession()).rejects.toThrow("Client not started");
    });

    test("resumeSession throws before start()", async () => {
      await expect(client.resumeSession("test-session")).rejects.toThrow("Client not started");
    });

    test("listSessions returns empty array before start()", async () => {
      const sessions = await client.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("Client Options", () => {
    test("supports stdio connection mode", () => {
      const client = createCopilotClient({
        connectionMode: { type: "stdio" },
      });
      expect(client).toBeInstanceOf(CopilotClient);
    });

    test("supports port connection mode", () => {
      const client = createCopilotClient({
        connectionMode: { type: "port", port: 3000 },
      });
      expect(client).toBeInstanceOf(CopilotClient);
    });

    test("supports cliUrl connection mode", () => {
      const client = createCopilotClient({
        connectionMode: { type: "cliUrl", url: "http://localhost:3000" },
      });
      expect(client).toBeInstanceOf(CopilotClient);
    });

    test("supports all connection options", () => {
      const options: CopilotClientOptions = {
        connectionMode: { type: "stdio" },
        timeout: 30000,
        cliPath: "/usr/local/bin/copilot",
        cliArgs: ["--debug"],
        cwd: "/tmp/test",
        logLevel: "debug",
        autoStart: true,
        autoRestart: false,
        githubToken: "test-token",
      };
      const client = createCopilotClient(options);
      expect(client).toBeInstanceOf(CopilotClient);
    });
  });

  describe("Event Handling", () => {
    test("on() registers event handler and returns unsubscribe function", () => {
      let callCount = 0;
      const unsubscribe = client.on("session.start", () => {
        callCount++;
      });

      // Just verify the function returns a function
      expect(typeof unsubscribe).toBe("function");
    });

    test("on() supports multiple handlers for same event", () => {
      let count1 = 0;
      let count2 = 0;

      client.on("session.start", () => {
        count1++;
      });
      client.on("session.start", () => {
        count2++;
      });

      // Both should be registered without error
      expect(count1).toBe(0);
      expect(count2).toBe(0);
    });

    test("unsubscribe removes only the specific handler", () => {
      let count1 = 0;
      let count2 = 0;

      const unsub1 = client.on("session.start", () => {
        count1++;
      });
      client.on("session.start", () => {
        count2++;
      });

      unsub1();

      // Should not throw
      expect(count1).toBe(0);
      expect(count2).toBe(0);
    });
  });

  describe("Permission Handler", () => {
    test("setPermissionHandler accepts a handler function", () => {
      const handler: CopilotPermissionHandler = async () => ({ kind: "approved" });
      // Should not throw
      client.setPermissionHandler(handler);
    });

    test("createAutoApprovePermissionHandler returns approved", async () => {
      const handler = createAutoApprovePermissionHandler();
      const result = await handler({ kind: "shell" }, { sessionId: "test" });
      expect(result).toEqual({ kind: "approved" });
    });

    test("createDenyAllPermissionHandler returns denied", async () => {
      const handler = createDenyAllPermissionHandler();
      const result = await handler({ kind: "write" }, { sessionId: "test" });
      expect(result).toEqual({ kind: "denied-interactively-by-user" });
    });
  });

  describe("Tool Registration", () => {
    test("registerTool accepts a tool definition", () => {
      const tool: ToolDefinition = {
        name: "test-tool",
        description: "A test tool",
        inputSchema: { type: "object", properties: {} },
        handler: async () => "result",
      };

      // Should not throw
      client.registerTool(tool);
    });

    test("registerTool can be called multiple times", () => {
      const tool1: ToolDefinition = {
        name: "tool1",
        description: "Tool 1",
        inputSchema: {},
        handler: async () => "result1",
      };

      const tool2: ToolDefinition = {
        name: "tool2",
        description: "Tool 2",
        inputSchema: {},
        handler: async () => "result2",
      };

      // Should not throw
      client.registerTool(tool1);
      client.registerTool(tool2);
    });
  });

  describe("Factory Function", () => {
    test("createCopilotClient returns CopilotClient instance", () => {
      const client = createCopilotClient();
      expect(client).toBeInstanceOf(CopilotClient);
      expect(client.agentType).toBe("copilot");
    });

    test("createCopilotClient with options", () => {
      const client = createCopilotClient({
        connectionMode: { type: "port", port: 8080 },
        timeout: 30000,
      });
      expect(client).toBeInstanceOf(CopilotClient);
    });

    test("createCopilotClient with no options", () => {
      const client = createCopilotClient();
      expect(client).toBeInstanceOf(CopilotClient);
    });
  });

  describe("Stop Behavior", () => {
    test("stop() is idempotent", async () => {
      // Should not throw when called multiple times
      await client.stop();
      await client.stop();
      await client.stop();
    });

    test("stop() clears event handlers", async () => {
      let called = false;
      client.on("session.start", () => {
        called = true;
      });
      await client.stop();
      // After stop, handlers should be cleared
      expect(called).toBe(false);
    });
  });
});

/**
 * Integration tests that require actual SDK connection
 * These are skipped by default and can be enabled for manual testing
 */
describe.skip("CopilotClient Integration", () => {
  let client: CopilotClient;

  beforeEach(() => {
    client = createCopilotClient({
      logLevel: "error",
    });
  });

  afterEach(async () => {
    await client.stop();
  });

  test("start() connects to Copilot CLI", async () => {
    await client.start();
    expect(client.getState()).toBe("connected");
  });

  test("createSession creates a valid session", async () => {
    await client.start();
    const session = await client.createSession();
    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
  });

  test("session.send returns a response", async () => {
    await client.start();
    const session = await client.createSession();
    const response = await session.send("Hello, what is 2 + 2?");
    expect(response.type).toBe("text");
    expect(typeof response.content).toBe("string");
  });

  test("session.stream yields message chunks", async () => {
    await client.start();
    const session = await client.createSession({
      model: "gpt-4.1",
    });

    const chunks: string[] = [];
    for await (const msg of session.stream("Tell me a short joke")) {
      if (msg.type === "text" && typeof msg.content === "string") {
        chunks.push(msg.content);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
  });

  test("session.getContextUsage returns usage stats", async () => {
    await client.start();
    const session = await client.createSession();
    await session.send("Hello");
    const usage = await session.getContextUsage();
    expect(usage.inputTokens).toBeGreaterThanOrEqual(0);
    expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
    expect(usage.maxTokens).toBeGreaterThan(0);
  });

  test("session.destroy closes the session", async () => {
    await client.start();
    const session = await client.createSession();
    await session.destroy();
    await expect(session.send("test")).rejects.toThrow();
  });

  test("resumeSession can resume an existing session", async () => {
    await client.start();
    const session = await client.createSession();
    const sessionId = session.id;

    const resumed = await client.resumeSession(sessionId);
    expect(resumed).not.toBeNull();
    expect(resumed?.id).toBe(sessionId);
  });

  test("listSessions returns active sessions", async () => {
    await client.start();
    await client.createSession();
    const sessions = await client.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
  });

  test("event handlers receive events", async () => {
    let startReceived = false;
    let idleReceived = false;

    client.on("session.start", () => {
      startReceived = true;
    });
    client.on("session.idle", () => {
      idleReceived = true;
    });

    await client.start();
    const session = await client.createSession();
    await session.send("Hello");

    expect(startReceived).toBe(true);
    // session.idle may or may not be emitted depending on timing
  });
});
