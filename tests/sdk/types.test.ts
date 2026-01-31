/**
 * Unit tests for SDK types module
 *
 * Tests cover:
 * - Type exports availability
 * - Interface shape validation via type assertions
 * - Type-safe event handling patterns
 * - Mock implementations to verify interface contracts
 */

import { describe, test, expect } from "bun:test";
import type {
  PermissionMode,
  McpServerConfig,
  SessionConfig,
  MessageRole,
  MessageContentType,
  MessageMetadata,
  AgentMessage,
  ContextUsage,
  Session,
  EventType,
  BaseEventData,
  SessionStartEventData,
  SessionIdleEventData,
  SessionErrorEventData,
  MessageDeltaEventData,
  MessageCompleteEventData,
  ToolStartEventData,
  ToolCompleteEventData,
  SubagentStartEventData,
  SubagentCompleteEventData,
  EventDataMap,
  AgentEvent,
  EventHandler,
  ToolDefinition,
  CodingAgentClient,
  CodingAgentClientFactory,
} from "../../src/sdk/types.ts";

describe("SDK Types Module", () => {
  describe("PermissionMode", () => {
    test("allows valid permission modes", () => {
      const auto: PermissionMode = "auto";
      const prompt: PermissionMode = "prompt";
      const deny: PermissionMode = "deny";

      expect(auto).toBe("auto");
      expect(prompt).toBe("prompt");
      expect(deny).toBe("deny");
    });
  });

  describe("McpServerConfig", () => {
    test("creates valid MCP server configuration", () => {
      const config: McpServerConfig = {
        name: "test-server",
        command: "node",
        args: ["server.js"],
        env: { PORT: "3000" },
      };

      expect(config.name).toBe("test-server");
      expect(config.command).toBe("node");
      expect(config.args).toEqual(["server.js"]);
      expect(config.env).toEqual({ PORT: "3000" });
    });

    test("allows minimal MCP server configuration", () => {
      const config: McpServerConfig = {
        name: "minimal-server",
        command: "server-binary",
      };

      expect(config.name).toBe("minimal-server");
      expect(config.args).toBeUndefined();
      expect(config.env).toBeUndefined();
    });
  });

  describe("SessionConfig", () => {
    test("creates valid session configuration", () => {
      const config: SessionConfig = {
        model: "claude-opus-4-5",
        sessionId: "test-session-123",
        systemPrompt: "You are a helpful assistant.",
        tools: ["read", "write", "bash"],
        mcpServers: [{ name: "test", command: "test-cmd" }],
        permissionMode: "prompt",
        maxBudgetUsd: 10.0,
        maxTurns: 100,
      };

      expect(config.model).toBe("claude-opus-4-5");
      expect(config.sessionId).toBe("test-session-123");
      expect(config.tools).toHaveLength(3);
      expect(config.maxBudgetUsd).toBe(10.0);
    });

    test("allows empty session configuration", () => {
      const config: SessionConfig = {};

      expect(config.model).toBeUndefined();
      expect(config.systemPrompt).toBeUndefined();
    });
  });

  describe("AgentMessage", () => {
    test("creates text message", () => {
      const message: AgentMessage = {
        type: "text",
        content: "Hello, world!",
        role: "assistant",
        metadata: {
          tokenUsage: { inputTokens: 10, outputTokens: 20 },
          model: "claude-opus-4-5",
        },
      };

      expect(message.type).toBe("text");
      expect(message.content).toBe("Hello, world!");
      expect(message.role).toBe("assistant");
      expect(message.metadata?.tokenUsage?.inputTokens).toBe(10);
    });

    test("creates tool use message", () => {
      const message: AgentMessage = {
        type: "tool_use",
        content: { name: "read_file", input: { path: "/test.txt" } },
        metadata: { toolName: "read_file" },
      };

      expect(message.type).toBe("tool_use");
      expect(typeof message.content).toBe("object");
    });

    test("allows minimal message", () => {
      const message: AgentMessage = {
        type: "text",
        content: "Simple message",
      };

      expect(message.role).toBeUndefined();
      expect(message.metadata).toBeUndefined();
    });
  });

  describe("ContextUsage", () => {
    test("creates valid context usage", () => {
      const usage: ContextUsage = {
        inputTokens: 5000,
        outputTokens: 2000,
        maxTokens: 200000,
        usagePercentage: 3.5,
      };

      expect(usage.inputTokens).toBe(5000);
      expect(usage.outputTokens).toBe(2000);
      expect(usage.maxTokens).toBe(200000);
      expect(usage.usagePercentage).toBe(3.5);
    });
  });

  describe("EventType", () => {
    test("includes all expected event types", () => {
      const events: EventType[] = [
        "session.start",
        "session.idle",
        "session.error",
        "message.delta",
        "message.complete",
        "tool.start",
        "tool.complete",
        "subagent.start",
        "subagent.complete",
      ];

      expect(events).toHaveLength(9);
      expect(events).toContain("session.start");
      expect(events).toContain("message.complete");
      expect(events).toContain("tool.complete");
    });
  });

  describe("AgentEvent", () => {
    test("creates session start event", () => {
      const event: AgentEvent<"session.start"> = {
        type: "session.start",
        sessionId: "sess-123",
        timestamp: new Date().toISOString(),
        data: {
          config: { model: "claude-opus-4-5" },
        },
      };

      expect(event.type).toBe("session.start");
      expect(event.sessionId).toBe("sess-123");
      expect(event.data.config?.model).toBe("claude-opus-4-5");
    });

    test("creates session error event", () => {
      const event: AgentEvent<"session.error"> = {
        type: "session.error",
        sessionId: "sess-123",
        timestamp: new Date().toISOString(),
        data: {
          error: new Error("Connection failed"),
          code: "CONNECTION_ERROR",
        },
      };

      expect(event.type).toBe("session.error");
      expect(event.data.error).toBeInstanceOf(Error);
      expect(event.data.code).toBe("CONNECTION_ERROR");
    });

    test("creates message delta event", () => {
      const event: AgentEvent<"message.delta"> = {
        type: "message.delta",
        sessionId: "sess-123",
        timestamp: new Date().toISOString(),
        data: {
          delta: "Hello",
          contentType: "text",
        },
      };

      expect(event.type).toBe("message.delta");
      expect(event.data.delta).toBe("Hello");
    });

    test("creates tool complete event", () => {
      const event: AgentEvent<"tool.complete"> = {
        type: "tool.complete",
        sessionId: "sess-123",
        timestamp: new Date().toISOString(),
        data: {
          toolName: "read_file",
          toolResult: { content: "file contents" },
          success: true,
        },
      };

      expect(event.type).toBe("tool.complete");
      expect(event.data.success).toBe(true);
      expect(event.data.toolName).toBe("read_file");
    });
  });

  describe("ToolDefinition", () => {
    test("creates valid tool definition", () => {
      const tool: ToolDefinition = {
        name: "calculator",
        description: "Performs basic arithmetic operations",
        inputSchema: {
          type: "object",
          properties: {
            operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] },
            a: { type: "number" },
            b: { type: "number" },
          },
          required: ["operation", "a", "b"],
        },
        handler: (input) => {
          const { operation, a, b } = input as { operation: string; a: number; b: number };
          switch (operation) {
            case "add":
              return a + b;
            case "subtract":
              return a - b;
            case "multiply":
              return a * b;
            case "divide":
              return a / b;
            default:
              throw new Error("Unknown operation");
          }
        },
      };

      expect(tool.name).toBe("calculator");
      expect(tool.description).toContain("arithmetic");
      expect(tool.inputSchema.type).toBe("object");

      // Test the handler
      const result = tool.handler({ operation: "add", a: 2, b: 3 });
      expect(result).toBe(5);
    });

    test("supports async tool handlers", async () => {
      const asyncTool: ToolDefinition = {
        name: "async_fetch",
        description: "Simulates async operation",
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
          return Promise.resolve({ status: "ok" });
        },
      };

      const result = await asyncTool.handler({});
      expect(result).toEqual({ status: "ok" });
    });
  });

  describe("Session interface contract", () => {
    test("mock session implements required interface", async () => {
      // Create a mock session to verify the interface contract
      const mockSession: Session = {
        id: "mock-session-123",
        send: async (message: string) => ({
          type: "text",
          content: `Response to: ${message}`,
          role: "assistant",
        }),
        stream: async function* (message: string) {
          yield { type: "text", content: "Hello", role: "assistant" };
          yield { type: "text", content: " World", role: "assistant" };
        },
        summarize: async () => {
          // No-op for mock
        },
        getContextUsage: async () => ({
          inputTokens: 1000,
          outputTokens: 500,
          maxTokens: 200000,
          usagePercentage: 0.75,
        }),
        destroy: async () => {
          // Cleanup for mock
        },
      };

      // Test the mock session
      expect(mockSession.id).toBe("mock-session-123");

      const response = await mockSession.send("Hello");
      expect(response.content).toContain("Hello");

      const usage = await mockSession.getContextUsage();
      expect(usage.usagePercentage).toBe(0.75);

      // Test streaming
      const chunks: AgentMessage[] = [];
      for await (const chunk of mockSession.stream("Test")) {
        chunks.push(chunk);
      }
      expect(chunks).toHaveLength(2);
    });
  });

  describe("CodingAgentClient interface contract", () => {
    test("mock client implements required interface", async () => {
      const mockSessions = new Map<string, Session>();
      const eventHandlers = new Map<EventType, EventHandler[]>();

      // Create a mock client to verify the interface contract
      const mockClient: CodingAgentClient = {
        agentType: "claude",
        createSession: async (config?: SessionConfig) => {
          const session: Session = {
            id: config?.sessionId ?? `session-${Date.now()}`,
            send: async (message) => ({
              type: "text",
              content: `Echo: ${message}`,
            }),
            stream: async function* () {
              yield { type: "text", content: "Streamed response" };
            },
            summarize: async () => {},
            getContextUsage: async () => ({
              inputTokens: 0,
              outputTokens: 0,
              maxTokens: 200000,
              usagePercentage: 0,
            }),
            destroy: async () => {
              mockSessions.delete(session.id);
            },
          };
          mockSessions.set(session.id, session);
          return session;
        },
        resumeSession: async (sessionId: string) => {
          return mockSessions.get(sessionId) ?? null;
        },
        on: <T extends EventType>(eventType: T, handler: EventHandler<T>) => {
          const handlers = eventHandlers.get(eventType) ?? [];
          handlers.push(handler as EventHandler);
          eventHandlers.set(eventType, handlers);
          return () => {
            const current = eventHandlers.get(eventType) ?? [];
            eventHandlers.set(
              eventType,
              current.filter((h) => h !== handler)
            );
          };
        },
        registerTool: (tool: ToolDefinition) => {
          // Store tool for mock
        },
        start: async () => {
          // Initialize mock client
        },
        stop: async () => {
          // Cleanup mock client
          mockSessions.clear();
          eventHandlers.clear();
        },
      };

      // Test the mock client
      expect(mockClient.agentType).toBe("claude");

      await mockClient.start();

      const session = await mockClient.createSession({ sessionId: "test-123" });
      expect(session.id).toBe("test-123");

      const resumed = await mockClient.resumeSession("test-123");
      expect(resumed).not.toBeNull();
      expect(resumed?.id).toBe("test-123");

      const notFound = await mockClient.resumeSession("nonexistent");
      expect(notFound).toBeNull();

      // Test event handler registration
      let eventReceived = false;
      const unsubscribe = mockClient.on("session.start", () => {
        eventReceived = true;
      });

      // Verify handler was registered
      expect(eventHandlers.has("session.start")).toBe(true);

      // Test unsubscribe
      unsubscribe();
      expect(eventHandlers.get("session.start")).toHaveLength(0);

      // Test tool registration
      mockClient.registerTool({
        name: "test_tool",
        description: "A test tool",
        inputSchema: { type: "object" },
        handler: () => "result",
      });

      await mockClient.stop();
      expect(mockSessions.size).toBe(0);
    });
  });

  describe("EventHandler type safety", () => {
    test("event handlers receive correctly typed events", () => {
      // Type-safe handler for session.start
      const startHandler: EventHandler<"session.start"> = (event) => {
        // TypeScript should know event.data has config property
        const config = event.data.config;
        expect(event.type).toBe("session.start");
      };

      // Type-safe handler for tool.complete
      const toolHandler: EventHandler<"tool.complete"> = (event) => {
        // TypeScript should know event.data has success property
        const success = event.data.success;
        expect(typeof success).toBe("boolean");
      };

      // Test handlers with mock events
      startHandler({
        type: "session.start",
        sessionId: "test",
        timestamp: new Date().toISOString(),
        data: { config: { model: "test" } },
      });

      toolHandler({
        type: "tool.complete",
        sessionId: "test",
        timestamp: new Date().toISOString(),
        data: { toolName: "test", success: true },
      });
    });
  });

  describe("CodingAgentClientFactory", () => {
    test("factory creates clients for different agent types", () => {
      const mockFactory: CodingAgentClientFactory = (agentType, options) => {
        // Create appropriate mock client based on agent type
        return {
          agentType,
          createSession: async () => ({
            id: "test",
            send: async () => ({ type: "text", content: "" }),
            stream: async function* () {},
            summarize: async () => {},
            getContextUsage: async () => ({
              inputTokens: 0,
              outputTokens: 0,
              maxTokens: 200000,
              usagePercentage: 0,
            }),
            destroy: async () => {},
          }),
          resumeSession: async () => null,
          on: () => () => {},
          registerTool: () => {},
          start: async () => {},
          stop: async () => {},
        };
      };

      const claudeClient = mockFactory("claude");
      expect(claudeClient.agentType).toBe("claude");

      const opencodeClient = mockFactory("opencode");
      expect(opencodeClient.agentType).toBe("opencode");

      const copilotClient = mockFactory("copilot");
      expect(copilotClient.agentType).toBe("copilot");
    });
  });
});
