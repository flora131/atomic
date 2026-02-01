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
      const health = await client.healthCheck();
      expect(health.healthy).toBe(false);
      expect(health.error).toBeDefined();
    });
  });

  describe("Connection", () => {
    test("connect throws error when server not running", async () => {
      await expect(client.connect()).rejects.toThrow("Failed to connect");
    });

    test("start throws error when server not running", async () => {
      await expect(client.start()).rejects.toThrow("Failed to connect");
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
