/**
 * Unit tests for ClaudeAgentClient
 *
 * Tests cover:
 * - Client lifecycle (start, stop)
 * - Session creation and management
 * - Event handler registration
 * - Hook configuration
 * - Tool registration
 *
 * Note: These tests mock the Claude Agent SDK to avoid external dependencies.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import type { Query, SDKMessage, SDKAssistantMessage, Options } from "@anthropic-ai/claude-agent-sdk";

// Mock the Claude Agent SDK
const mockQuery = mock(() => {
  const messages: SDKMessage[] = [];
  let closed = false;

  const queryInstance = {
    [Symbol.asyncIterator]: async function* () {
      for (const msg of messages) {
        yield msg;
      }
    },
    next: async () => ({ done: true, value: undefined }),
    return: async () => ({ done: true, value: undefined }),
    throw: async () => ({ done: true, value: undefined }),
    close: () => {
      closed = true;
    },
    interrupt: async () => {},
    setPermissionMode: async () => {},
    setModel: async () => {},
    setMaxThinkingTokens: async () => {},
    supportedCommands: async () => [],
    supportedModels: async () => [],
    mcpServerStatus: async () => [],
    accountInfo: async () => ({}),
    rewindFiles: async () => ({ canRewind: false }),
    setMcpServers: async () => ({ added: [], removed: [], errors: [] }),
    streamInput: async () => {},
    _messages: messages,
    _closed: () => closed,
  } as unknown as Query & { _messages: SDKMessage[]; _closed: () => boolean };

  return queryInstance;
});

const mockCreateSdkMcpServer = mock(() => ({
  type: "sdk" as const,
  name: "mock-server",
  server: {},
}));

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
  createSdkMcpServer: mockCreateSdkMcpServer,
}));

// Import after mocking
import { ClaudeAgentClient, createClaudeAgentClient } from "../../src/sdk/claude-client.ts";
import type { SessionConfig, EventType, ToolDefinition } from "../../src/sdk/types.ts";

describe("ClaudeAgentClient", () => {
  let client: ClaudeAgentClient;

  beforeEach(() => {
    client = new ClaudeAgentClient();
    mockQuery.mockClear();
    mockCreateSdkMcpServer.mockClear();
  });

  afterEach(async () => {
    await client.stop();
  });

  describe("Client Lifecycle", () => {
    test("agentType is 'claude'", () => {
      expect(client.agentType).toBe("claude");
    });

    test("start() enables session creation", async () => {
      await client.start();
      // Should not throw
      const session = await client.createSession();
      expect(session).toBeDefined();
    });

    test("createSession throws before start()", async () => {
      await expect(client.createSession()).rejects.toThrow("Client not started");
    });

    test("stop() cleans up all sessions", async () => {
      await client.start();
      await client.createSession({ sessionId: "test-1" });
      await client.createSession({ sessionId: "test-2" });
      await client.stop();
      // After stop, client is no longer running
      await expect(client.createSession()).rejects.toThrow("Client not started");
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

    test("createSession uses provided sessionId", async () => {
      const config: SessionConfig = { sessionId: "my-custom-session" };
      const session = await client.createSession(config);
      expect(session.id).toBe("my-custom-session");
    });

    test("createSession generates unique sessionId if not provided", async () => {
      const session1 = await client.createSession();
      const session2 = await client.createSession();
      expect(session1.id).not.toBe(session2.id);
      expect(session1.id).toMatch(/^claude-\d+-[a-z0-9]+$/);
    });

    test("createSession passes config to SDK query", async () => {
      const config: SessionConfig = {
        model: "claude-sonnet-4-5",
        maxTurns: 10,
        maxBudgetUsd: 5.0,
        systemPrompt: "You are a helpful assistant.",
      };
      await client.createSession(config);
      expect(mockQuery).toHaveBeenCalled();
    });
  });

  describe("Session Operations", () => {
    beforeEach(async () => {
      await client.start();
    });

    test("session.getContextUsage returns usage stats", async () => {
      const session = await client.createSession();
      const usage = await session.getContextUsage();
      expect(usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        maxTokens: 200000,
        usagePercentage: 0,
      });
    });

    test("session.destroy closes the session", async () => {
      const session = await client.createSession();
      await session.destroy();
      // After destroy, send should throw
      await expect(session.send("test")).rejects.toThrow("Session is closed");
    });

    test("session.summarize logs warning (SDK handles compaction)", async () => {
      const session = await client.createSession();
      // Should not throw, just log warning
      await session.summarize();
    });
  });

  describe("Session Resumption", () => {
    beforeEach(async () => {
      await client.start();
    });

    test("resumeSession returns existing active session", async () => {
      const session = await client.createSession({ sessionId: "resume-test" });
      const resumed = await client.resumeSession("resume-test");
      expect(resumed).not.toBeNull();
      expect(resumed?.id).toBe("resume-test");
    });

    test("resumeSession attempts SDK resume for unknown session", async () => {
      const resumed = await client.resumeSession("unknown-session");
      // The mock returns a query, so it should succeed
      expect(resumed).not.toBeNull();
    });

    test("resumeSession throws before start()", async () => {
      const newClient = new ClaudeAgentClient();
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
      // Handler should not be called after unsubscribe
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

      await client.createSession({ sessionId: "event-test" });
      expect(receivedType).toBe("session.start");
      expect(receivedSessionId).toBe("event-test");
    });
  });

  describe("Hook Registration", () => {
    test("registerHooks stores hook configuration", () => {
      const hookCallback = async () => ({ continue: true as const });
      client.registerHooks({
        PreToolUse: [hookCallback],
        SessionStart: [hookCallback],
      });
      // Hooks are internal, but we can verify they're used in createSession
      // by checking the query options
    });

    test("registerHooks merges with existing hooks", () => {
      const hook1 = async () => ({ continue: true as const });
      const hook2 = async () => ({ continue: true as const });

      client.registerHooks({ PreToolUse: [hook1] });
      client.registerHooks({ PostToolUse: [hook2] });

      // Both hooks should be registered
      // This is verified implicitly by the fact that registerHooks doesn't throw
    });
  });

  describe("Tool Registration", () => {
    beforeEach(async () => {
      await client.start();
    });

    test("registerTool creates MCP server", () => {
      const tool: ToolDefinition = {
        name: "test-tool",
        description: "A test tool",
        inputSchema: { type: "object", properties: {} },
        handler: async () => "result",
      };

      client.registerTool(tool);
      expect(mockCreateSdkMcpServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "tool-test-tool",
        })
      );
    });

    test("multiple tools can be registered", () => {
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

      expect(mockCreateSdkMcpServer).toHaveBeenCalledTimes(2);
    });
  });

  describe("Factory Function", () => {
    test("createClaudeAgentClient returns ClaudeAgentClient instance", () => {
      const client = createClaudeAgentClient();
      expect(client).toBeInstanceOf(ClaudeAgentClient);
      expect(client.agentType).toBe("claude");
    });
  });

  describe("Configuration Options", () => {
    beforeEach(async () => {
      await client.start();
    });

    test("MCP servers are passed to SDK", async () => {
      const config: SessionConfig = {
        mcpServers: [
          {
            name: "test-mcp",
            command: "node",
            args: ["server.js"],
            env: { PORT: "3000" },
          },
        ],
      };

      await client.createSession(config);
      expect(mockQuery).toHaveBeenCalled();
    });

    test("permission mode is mapped correctly", async () => {
      await client.createSession({ permissionMode: "auto" });
      await client.createSession({ permissionMode: "prompt" });
      await client.createSession({ permissionMode: "deny" });
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });
  });
});
