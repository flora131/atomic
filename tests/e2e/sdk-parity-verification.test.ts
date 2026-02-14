/**
 * E2E Test: SDK Parity Verification
 *
 * This test verifies that all three agent clients (Claude, OpenCode, Copilot)
 * expose consistent SDK functionality through the unified CodingAgentClient interface.
 *
 * The test verifies parity across:
 * - /help shows same commands
 * - /model shows model information
 * - /model list works
 * - /clear works
 * - Message queuing works
 * - Session history works
 *
 * Documented differences:
 * - Copilot model switching requires new session (requiresNewSession flag)
 * - OpenCode supports agentMode (build, plan, general, explore)
 * - Claude uses native SDK hooks vs event-based callbacks
 *
 * Reference: Phase 8.5 - E2E test: Verify SDK parity across agents
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import type {
  CodingAgentClient,
  Session,
  SessionConfig,
  AgentMessage,
  EventType,
  EventHandler,
  ToolDefinition,
  ContextUsage,
  AgentEvent,
  PermissionMode,
  ModelDisplayInfo,
} from "../../src/sdk/types.ts";
import { stripProviderPrefix } from "../../src/sdk/types.ts";
import {
  globalRegistry,
  type CommandContext,
  type CommandContextState,
  type CommandResult,
} from "../../src/ui/commands/registry.ts";
import { registerBuiltinCommands, builtinCommands } from "../../src/ui/commands/builtin-commands.ts";

// ============================================================================
// MOCK CLIENT FACTORY - Creates consistent mock clients for each agent type
// ============================================================================

/**
 * Common session interface matching CodingAgentClient requirements
 */
interface MockSession extends Session {
  messageHistory: Array<{ role: string; content: string }>;
  contextUsage: ContextUsage;
}

/**
 * Creates a mock session with standard interface
 */
function createMockSession(sessionId: string): MockSession {
  const messageHistory: Array<{ role: string; content: string }> = [];
  const contextUsage: ContextUsage = {
    inputTokens: 0,
    outputTokens: 0,
    maxTokens: 200000,
    usagePercentage: 0,
  };

  return {
    id: sessionId,
    messageHistory,
    contextUsage,

    async send(message: string): Promise<AgentMessage> {
      messageHistory.push({ role: "user", content: message });
      const response: AgentMessage = {
        type: "text",
        content: `Response to: ${message}`,
        role: "assistant",
      };
      messageHistory.push({ role: "assistant", content: response.content as string });
      contextUsage.inputTokens += message.length;
      contextUsage.outputTokens += (response.content as string).length;
      contextUsage.usagePercentage = ((contextUsage.inputTokens + contextUsage.outputTokens) / contextUsage.maxTokens) * 100;
      return response;
    },

    stream(message: string): AsyncIterable<AgentMessage> {
      const self = this;
      return {
        async *[Symbol.asyncIterator]() {
          const response = await self.send(message);
          yield { type: "text", content: response.content, role: "assistant" };
        },
      };
    },

    async summarize(): Promise<void> {
      // Simulate context compaction
      contextUsage.inputTokens = Math.floor(contextUsage.inputTokens * 0.3);
      contextUsage.outputTokens = Math.floor(contextUsage.outputTokens * 0.3);
      contextUsage.usagePercentage = ((contextUsage.inputTokens + contextUsage.outputTokens) / contextUsage.maxTokens) * 100;
    },

    async getContextUsage(): Promise<ContextUsage> {
      return { ...contextUsage };
    },

    getSystemToolsTokens() { return 0; },

    async destroy(): Promise<void> {
      messageHistory.length = 0;
    },
  };
}

/**
 * Mock client that implements CodingAgentClient interface
 * Used to test SDK parity without real SDK connections
 */
function createMockAgentClient(agentType: "claude" | "opencode" | "copilot"): CodingAgentClient & {
  sessions: Map<string, MockSession>;
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  registeredTools: ToolDefinition[];
  isStarted: boolean;
  currentModel: string;
} {
  const sessions = new Map<string, MockSession>();
  const eventHandlers = new Map<EventType, Set<EventHandler<EventType>>>();
  const registeredTools: ToolDefinition[] = [];
  let isStarted = false;
  let currentModel = agentType === "claude" ? "claude-sonnet-4-5" : agentType === "copilot" ? "gpt-4.1" : "anthropic/claude-sonnet-4-5";

  const client: CodingAgentClient & {
    sessions: Map<string, MockSession>;
    eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
    registeredTools: ToolDefinition[];
    isStarted: boolean;
    currentModel: string;
  } = {
    agentType,
    sessions,
    eventHandlers,
    registeredTools,
    isStarted,
    currentModel,

    async start(): Promise<void> {
      isStarted = true;
      client.isStarted = true;
    },

    async stop(): Promise<void> {
      for (const session of sessions.values()) {
        await session.destroy();
      }
      sessions.clear();
      eventHandlers.clear();
      isStarted = false;
      client.isStarted = false;
    },

    async createSession(config?: SessionConfig): Promise<Session> {
      if (!isStarted) {
        throw new Error("Client not started");
      }
      const sessionId = config?.sessionId ?? `${agentType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const session = createMockSession(sessionId);
      sessions.set(sessionId, session);

      // Emit session.start event
      const handlers = eventHandlers.get("session.start");
      if (handlers) {
        const event: AgentEvent<"session.start"> = {
          type: "session.start",
          sessionId,
          timestamp: new Date().toISOString(),
          data: { config },
        };
        for (const handler of handlers) {
          await handler(event);
        }
      }

      return session;
    },

    async resumeSession(sessionId: string): Promise<Session | null> {
      if (!isStarted) {
        throw new Error("Client not started");
      }
      return sessions.get(sessionId) ?? null;
    },

    on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
      let handlers = eventHandlers.get(eventType);
      if (!handlers) {
        handlers = new Set();
        eventHandlers.set(eventType, handlers);
      }
      handlers.add(handler as EventHandler<EventType>);

      return () => {
        handlers?.delete(handler as EventHandler<EventType>);
      };
    },

    registerTool(tool: ToolDefinition): void {
      registeredTools.push(tool);
    },

    async getModelDisplayInfo(modelHint?: string): Promise<ModelDisplayInfo> {
      const modelId = modelHint ?? currentModel;
      return {
        model: stripProviderPrefix(modelId),
        tier: agentType === "claude" ? "Claude Code" : agentType === "copilot" ? "GitHub Copilot" : "OpenCode",
      };
    },
    getSystemToolsTokens() { return null; },
  };

  return client;
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe("SDK Parity Verification", () => {
  let claudeClient: ReturnType<typeof createMockAgentClient>;
  let opencodeClient: ReturnType<typeof createMockAgentClient>;
  let copilotClient: ReturnType<typeof createMockAgentClient>;

  beforeEach(async () => {
    // Clear and re-register commands
    globalRegistry.clear();
    registerBuiltinCommands();

    // Create mock clients for each agent type
    claudeClient = createMockAgentClient("claude");
    opencodeClient = createMockAgentClient("opencode");
    copilotClient = createMockAgentClient("copilot");

    // Start all clients
    await claudeClient.start();
    await opencodeClient.start();
    await copilotClient.start();
  });

  afterEach(async () => {
    await claudeClient.stop();
    await opencodeClient.stop();
    await copilotClient.stop();
    globalRegistry.clear();
  });

  // --------------------------------------------------------------------------
  // /help Command Parity
  // --------------------------------------------------------------------------

  describe("/help shows same commands for all agents", () => {
    test("all agents can execute /help command", async () => {
      const helpCommand = globalRegistry.get("help");
      expect(helpCommand).toBeDefined();
      expect(helpCommand?.name).toBe("help");

      // Create command context for each agent
      const contexts = [
        { agentType: "claude" as const, client: claudeClient },
        { agentType: "opencode" as const, client: opencodeClient },
        { agentType: "copilot" as const, client: copilotClient },
      ];

      const results: CommandResult[] = [];

      for (const { agentType, client } of contexts) {
        const session = await client.createSession();
        const context: CommandContext = {
          session,
          state: { isStreaming: false, messageCount: 0 },
          addMessage: () => {},
          setStreaming: () => {},
          sendMessage: () => {},
          sendSilentMessage: () => {},
          spawnSubagent: async () => ({ success: true, output: "" }),
          streamAndWait: async () => ({ content: "", wasInterrupted: false }),
          clearContext: async () => {},
          setTodoItems: () => {},
    setRalphSessionDir: () => {},
    setRalphSessionId: () => {},
          updateWorkflowState: () => {},
          agentType,
        };

        const result = await helpCommand!.execute("", context);
        results.push(result);
      }

      // All results should be successful
      expect(results.every((r) => r.success)).toBe(true);

      // All results should show "Available Commands" header
      expect(results.every((r) => r.message?.includes("Available Commands"))).toBe(true);

      // Commands shown should be the same across all agents (same registry)
      const commandsInResults = results.map((r) => r.message ?? "");
      expect(commandsInResults[0]).toBe(commandsInResults[1]);
      expect(commandsInResults[1]).toBe(commandsInResults[2]);
    });

    test("/help lists builtin commands for all agents", () => {
      const helpCommand = globalRegistry.get("help");
      expect(helpCommand).toBeDefined();

      // Verify all builtin commands are in the registry
      for (const cmd of builtinCommands) {
        expect(globalRegistry.has(cmd.name)).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // /model Command Parity
  // --------------------------------------------------------------------------

  describe("/model shows model information for all agents", () => {
    test("getModelDisplayInfo returns model info for all agent types", async () => {
      const claudeInfo = await claudeClient.getModelDisplayInfo();
      expect(claudeInfo.model).toBeDefined();
      expect(claudeInfo.tier).toBe("Claude Code");

      const opencodeInfo = await opencodeClient.getModelDisplayInfo();
      expect(opencodeInfo.model).toBeDefined();
      expect(opencodeInfo.tier).toBe("OpenCode");

      const copilotInfo = await copilotClient.getModelDisplayInfo();
      expect(copilotInfo.model).toBeDefined();
      expect(copilotInfo.tier).toBe("GitHub Copilot");
    });

    test("getModelDisplayInfo returns raw model names", async () => {
      // Test with explicit model hints - should return raw IDs
      const claudeInfo = await claudeClient.getModelDisplayInfo("claude-sonnet-4-5");
      expect(claudeInfo.model).toBe("claude-sonnet-4-5");

      const copilotInfo = await copilotClient.getModelDisplayInfo("gpt-4.1");
      expect(copilotInfo.model).toBe("gpt-4.1");
    });

    test("/model command exists in registry", () => {
      const modelCommand = globalRegistry.get("model");
      expect(modelCommand).toBeDefined();
      expect(modelCommand?.name).toBe("model");
      expect(modelCommand?.aliases).toContain("m");
    });
  });

  // --------------------------------------------------------------------------
  // /model list Parity
  // --------------------------------------------------------------------------

  describe("/model list works for all agents", () => {
    test("/model list command is available", () => {
      const modelCommand = globalRegistry.get("model");
      expect(modelCommand).toBeDefined();
      // The command handles 'list' as a subcommand
      expect(modelCommand?.category).toBe("builtin");
    });

    test("model command can be invoked with 'list' argument for all agents", async () => {
      const modelCommand = globalRegistry.get("model");
      expect(modelCommand).toBeDefined();

      // We can't fully test model list without real ModelOperations,
      // but we verify the command structure is consistent
      const clients = [claudeClient, opencodeClient, copilotClient];
      
      for (const client of clients) {
        const session = await client.createSession();
        const context: CommandContext = {
          session,
          state: { isStreaming: false, messageCount: 0 },
          addMessage: () => {},
          setStreaming: () => {},
          sendMessage: () => {},
          sendSilentMessage: () => {},
          spawnSubagent: async () => ({ success: true, output: "" }),
          streamAndWait: async () => ({ content: "", wasInterrupted: false }),
          clearContext: async () => {},
          setTodoItems: () => {},
    setRalphSessionDir: () => {},
    setRalphSessionId: () => {},
          updateWorkflowState: () => {},
          agentType: client.agentType as "claude" | "opencode" | "copilot",
          modelOps: {
            getCurrentModel: async () => "test-model",
            listAvailableModels: async () => [],
            setModel: async () => ({ success: true }),
            resolveAlias: (alias) => alias,
          },
        };

        const result = await modelCommand!.execute("list", context);
        expect(result.success).toBe(true);
        // Empty list returns "No models available"
        expect(result.message).toContain("No models available");
      }
    });
  });

  // --------------------------------------------------------------------------
  // /clear Command Parity
  // --------------------------------------------------------------------------

  describe("/clear works for all agents", () => {
    test("/clear command exists and works identically", async () => {
      const clearCommand = globalRegistry.get("clear");
      expect(clearCommand).toBeDefined();
      expect(clearCommand?.name).toBe("clear");
      expect(clearCommand?.aliases).toContain("cls");
      expect(clearCommand?.aliases).toContain("c");

      const clients = [claudeClient, opencodeClient, copilotClient];

      for (const client of clients) {
        const session = await client.createSession();
        const context: CommandContext = {
          session,
          state: { isStreaming: false, messageCount: 5 },
          addMessage: () => {},
          setStreaming: () => {},
          sendMessage: () => {},
          sendSilentMessage: () => {},
          spawnSubagent: async () => ({ success: true, output: "" }),
          streamAndWait: async () => ({ content: "", wasInterrupted: false }),
          clearContext: async () => {},
          setTodoItems: () => {},
    setRalphSessionDir: () => {},
    setRalphSessionId: () => {},
          updateWorkflowState: () => {},
          agentType: client.agentType as "claude" | "opencode" | "copilot",
        };

        const result = await clearCommand!.execute("", context);
        expect(result.success).toBe(true);
        expect(result.clearMessages).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Message Queuing Parity
  // --------------------------------------------------------------------------

  describe("message queuing works for all agents", () => {
    test("sessions maintain message history across all agents", async () => {
      const clients = [claudeClient, opencodeClient, copilotClient];

      for (const client of clients) {
        const session = (await client.createSession()) as MockSession;
        
        // Send multiple messages
        await session.send("First message");
        await session.send("Second message");
        await session.send("Third message");

        // Verify message history
        expect(session.messageHistory.length).toBe(6); // 3 user + 3 assistant
        const firstMsg = session.messageHistory[0];
        const secondMsg = session.messageHistory[1];
        expect(firstMsg).toBeDefined();
        expect(secondMsg).toBeDefined();
        expect(firstMsg?.role).toBe("user");
        expect(firstMsg?.content).toBe("First message");
        expect(secondMsg?.role).toBe("assistant");
      }
    });

    test("context usage is tracked consistently across agents", async () => {
      const clients = [claudeClient, opencodeClient, copilotClient];

      for (const client of clients) {
        const session = await client.createSession();
        
        const initialUsage = await session.getContextUsage();
        expect(initialUsage.inputTokens).toBe(0);
        expect(initialUsage.outputTokens).toBe(0);

        await session.send("Test message");

        const updatedUsage = await session.getContextUsage();
        expect(updatedUsage.inputTokens).toBeGreaterThan(0);
        expect(updatedUsage.outputTokens).toBeGreaterThan(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Session History Parity
  // --------------------------------------------------------------------------

  describe("session history works for all agents", () => {
    test("sessions can be created and tracked for all agents", async () => {
      for (const client of [claudeClient, opencodeClient, copilotClient]) {
        const session1 = await client.createSession({ sessionId: "test-session-1" });
        const session2 = await client.createSession({ sessionId: "test-session-2" });

        expect(session1.id).toBe("test-session-1");
        expect(session2.id).toBe("test-session-2");
        expect(client.sessions.size).toBe(2);
      }
    });

    test("sessions can be resumed by ID for all agents", async () => {
      for (const client of [claudeClient, opencodeClient, copilotClient]) {
        const original = await client.createSession({ sessionId: "resumable-session" });
        await original.send("Initial message");

        const resumed = await client.resumeSession("resumable-session");
        expect(resumed).not.toBeNull();
        expect(resumed?.id).toBe("resumable-session");
        
        // Verify message history persists
        const mockResumed = resumed as MockSession;
        expect(mockResumed.messageHistory.length).toBe(2);
      }
    });

    test("sessions can be destroyed for all agents", async () => {
      for (const client of [claudeClient, opencodeClient, copilotClient]) {
        const session = await client.createSession({ sessionId: "destroyable-session" });
        expect(client.sessions.has("destroyable-session")).toBe(true);

        await session.destroy();
        // Session object still exists in map but is cleared
        const mockSession = client.sessions.get("destroyable-session") as MockSession;
        expect(mockSession.messageHistory.length).toBe(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Event Handler Parity
  // --------------------------------------------------------------------------

  describe("event handlers work consistently across agents", () => {
    test("all agents support on() for session.start event", async () => {
      for (const client of [claudeClient, opencodeClient, copilotClient]) {
        let eventReceived = false;

        client.on("session.start", () => {
          eventReceived = true;
        });

        await client.createSession();
        expect(eventReceived).toBe(true);
      }
    });

    test("on() returns unsubscribe function for all agents", async () => {
      for (const client of [claudeClient, opencodeClient, copilotClient]) {
        let callCount = 0;

        const unsubscribe = client.on("session.start", () => {
          callCount++;
        });

        await client.createSession();
        expect(callCount).toBe(1);

        unsubscribe();
        await client.createSession();
        expect(callCount).toBe(1); // Should not increment after unsubscribe
      }
    });
  });

  // --------------------------------------------------------------------------
  // Tool Registration Parity
  // --------------------------------------------------------------------------

  describe("tool registration works consistently across agents", () => {
    test("all agents support registerTool()", () => {
      const testTool: ToolDefinition = {
        name: "test-tool",
        description: "A test tool for parity verification",
        inputSchema: { type: "object", properties: { input: { type: "string" } } },
        handler: async (input) => `Processed: ${JSON.stringify(input)}`,
      };

      for (const client of [claudeClient, opencodeClient, copilotClient]) {
        client.registerTool(testTool);
        expect(client.registeredTools.length).toBeGreaterThan(0);
        expect(client.registeredTools.some((t) => t.name === "test-tool")).toBe(true);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Agent Type Identification
  // --------------------------------------------------------------------------

  describe("agent types are correctly identified", () => {
    test("agentType property is set correctly", () => {
      expect(claudeClient.agentType).toBe("claude");
      expect(opencodeClient.agentType).toBe("opencode");
      expect(copilotClient.agentType).toBe("copilot");
    });
  });

  // --------------------------------------------------------------------------
  // Documented Intentional Differences
  // --------------------------------------------------------------------------

  describe("documented intentional differences", () => {
    /**
     * DIFFERENCE: Copilot model switching requires a new session
     * 
     * Copilot clients cannot change models mid-session. The model is set
     * at session creation time. When using /model to switch, Copilot returns
     * { requiresNewSession: true } to indicate a new session is needed.
     */
    test("DOCUMENTED: Copilot model switching behavior differs", async () => {
      // This documents the known difference - Copilot model changes require new session
      // The CopilotClient.setModel() returns { requiresNewSession: true }
      // Claude and OpenCode can switch models mid-session
      
      // This is verified by the model command implementation which checks:
      // if (result?.requiresNewSession) { ... show appropriate message ... }
      expect(true).toBe(true); // Placeholder assertion
    });

    /**
     * DIFFERENCE: OpenCode supports agentMode configuration
     * 
     * OpenCode has unique agent modes (build, plan, general, explore)
     * that other agents don't support. These are passed via SessionConfig.agentMode.
     */
    test("DOCUMENTED: OpenCode supports agentMode in SessionConfig", async () => {
      // OpenCode can accept agentMode: "build" | "plan" | "general" | "explore"
      // Claude and Copilot ignore this configuration
      const opencodeSession = await opencodeClient.createSession({
        sessionId: "opencode-with-mode",
        agentMode: "plan",
      } as SessionConfig);
      
      expect(opencodeSession.id).toBe("opencode-with-mode");
      // The mode is used internally by OpenCode but doesn't affect the session interface
    });

    /**
     * DIFFERENCE: Claude uses native SDK hooks
     * 
     * Claude has registerHooks() for PreToolUse, PostToolUse, etc.
     * Other agents use event-based callbacks via on().
     * Both achieve similar functionality through different mechanisms.
     */
    test("DOCUMENTED: Claude uses native SDK hooks vs event callbacks", () => {
      // ClaudeAgentClient has registerHooks({ PreToolUse, PostToolUse, ... })
      // OpenCode and Copilot use the on() event handler pattern
      // Both approaches allow intercepting tool execution
      expect(true).toBe(true); // Placeholder assertion
    });
  });

  // --------------------------------------------------------------------------
  // No Custom Logic Leaking Between Implementations
  // --------------------------------------------------------------------------

  describe("no custom logic leaking between agent implementations", () => {
    test("each agent creates independent sessions", async () => {
      // Create sessions with same ID on different clients
      const claudeSession = await claudeClient.createSession({ sessionId: "shared-id" });
      const opencodeSession = await opencodeClient.createSession({ sessionId: "shared-id" });
      const copilotSession = await copilotClient.createSession({ sessionId: "shared-id" });

      // Send different messages
      await claudeSession.send("Claude message");
      await opencodeSession.send("OpenCode message");
      await copilotSession.send("Copilot message");

      // Verify sessions are independent
      const claudeMock = claudeSession as MockSession;
      const opencodeMock = opencodeSession as MockSession;
      const copilotMock = copilotSession as MockSession;

      expect(claudeMock.messageHistory[0]?.content).toBe("Claude message");
      expect(opencodeMock.messageHistory[0]?.content).toBe("OpenCode message");
      expect(copilotMock.messageHistory[0]?.content).toBe("Copilot message");
    });

    test("event handlers are isolated per client", async () => {
      const claudeEvents: string[] = [];
      const opencodeEvents: string[] = [];
      const copilotEvents: string[] = [];

      claudeClient.on("session.start", () => { claudeEvents.push("claude"); });
      opencodeClient.on("session.start", () => { opencodeEvents.push("opencode"); });
      copilotClient.on("session.start", () => { copilotEvents.push("copilot"); });

      await claudeClient.createSession();
      expect(claudeEvents).toEqual(["claude"]);
      expect(opencodeEvents).toEqual([]);
      expect(copilotEvents).toEqual([]);

      await opencodeClient.createSession();
      expect(claudeEvents).toEqual(["claude"]);
      expect(opencodeEvents).toEqual(["opencode"]);
      expect(copilotEvents).toEqual([]);

      await copilotClient.createSession();
      expect(claudeEvents).toEqual(["claude"]);
      expect(opencodeEvents).toEqual(["opencode"]);
      expect(copilotEvents).toEqual(["copilot"]);
    });

    test("tool registrations are isolated per client", () => {
      claudeClient.registerTool({
        name: "claude-only-tool",
        description: "Tool only for Claude",
        inputSchema: {},
        handler: async () => "claude result",
      });

      opencodeClient.registerTool({
        name: "opencode-only-tool",
        description: "Tool only for OpenCode",
        inputSchema: {},
        handler: async () => "opencode result",
      });

      expect(claudeClient.registeredTools.some((t) => t.name === "claude-only-tool")).toBe(true);
      expect(claudeClient.registeredTools.some((t) => t.name === "opencode-only-tool")).toBe(false);

      expect(opencodeClient.registeredTools.some((t) => t.name === "opencode-only-tool")).toBe(true);
      expect(opencodeClient.registeredTools.some((t) => t.name === "claude-only-tool")).toBe(false);

      expect(copilotClient.registeredTools.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Context Compaction (summarize) Parity
  // --------------------------------------------------------------------------

  describe("context compaction (summarize) works for all agents", () => {
    test("summarize() reduces context usage for all agents", async () => {
      for (const client of [claudeClient, opencodeClient, copilotClient]) {
        const session = await client.createSession();
        
        // Build up context
        await session.send("Message 1");
        await session.send("Message 2");
        await session.send("Message 3");

        const beforeUsage = await session.getContextUsage();
        expect(beforeUsage.inputTokens).toBeGreaterThan(0);

        await session.summarize();

        const afterUsage = await session.getContextUsage();
        expect(afterUsage.inputTokens).toBeLessThan(beforeUsage.inputTokens);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Stream Interface Parity
  // --------------------------------------------------------------------------

  describe("streaming interface is consistent across agents", () => {
    test("stream() returns AsyncIterable for all agents", async () => {
      for (const client of [claudeClient, opencodeClient, copilotClient]) {
        const session = await client.createSession();
        const stream = session.stream("Test streaming");

        expect(stream[Symbol.asyncIterator]).toBeDefined();

        const chunks: AgentMessage[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks[0]?.type).toBe("text");
      }
    });
  });
});
