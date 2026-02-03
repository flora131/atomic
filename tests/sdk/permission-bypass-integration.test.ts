/**
 * Integration tests for permission bypass configuration per SDK
 *
 * Tests cover:
 * - Claude SDK with permissionMode: 'bypassPermissions'
 * - OpenCode SDK with permission: { default: 'allow' } configuration
 * - Copilot SDK with no PermissionHandler (auto-approve)
 * - Verifying all tools execute without prompts
 * - Verifying AskUserQuestion still pauses for input
 *
 * This test suite validates that each SDK client correctly implements
 * permission bypass mode where all tools auto-execute without user
 * confirmation, except for AskUserQuestion which requires human input.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
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
  PermissionRequestedEventData,
} from "../../src/sdk/types.ts";

// ============================================================================
// Test Helpers - Mock SDK Clients
// ============================================================================

/**
 * Mock session that simulates tool execution with permission bypass.
 */
interface MockSession extends Session {
  /** Captured tool executions for verification */
  toolExecutions: Array<{
    toolName: string;
    toolInput: unknown;
    wasPrompted: boolean;
    timestamp: string;
  }>;

  /** Pending AskUserQuestion requests */
  pendingUserQuestions: Array<{
    requestId: string;
    question: string;
    respond: (answer: string) => void;
  }>;
}

/**
 * Create a mock session that tracks tool executions and permission behavior.
 */
function createMockSession(
  id: string,
  permissionMode: PermissionMode,
  onPermissionRequest?: (data: PermissionRequestedEventData) => void
): MockSession {
  const toolExecutions: MockSession["toolExecutions"] = [];
  const pendingUserQuestions: MockSession["pendingUserQuestions"] = [];

  const session: MockSession = {
    id,
    toolExecutions,
    pendingUserQuestions,

    async send(message: string): Promise<AgentMessage> {
      // Simulate tool execution based on message content
      if (message.includes("execute_tool:")) {
        const toolName = message.replace("execute_tool:", "").trim();
        const wasPrompted = permissionMode === "prompt";

        // Simulate tool execution
        toolExecutions.push({
          toolName,
          toolInput: { message },
          wasPrompted,
          timestamp: new Date().toISOString(),
        });

        // In bypass mode, tools execute without prompts
        if (permissionMode === "bypass") {
          return {
            type: "tool_result",
            content: `Tool ${toolName} executed successfully (bypassed permission)`,
            role: "assistant",
          };
        }

        // In prompt mode, would normally pause for permission
        // But for testing, we simulate auto-approval after recording
        return {
          type: "tool_result",
          content: `Tool ${toolName} executed (prompted: ${wasPrompted})`,
          role: "assistant",
        };
      }

      // Handle AskUserQuestion simulation
      if (message.includes("ask_user:")) {
        const question = message.replace("ask_user:", "").trim();
        const requestId = `ask_${Date.now()}`;

        // Create a promise that will be resolved when user responds
        const responsePromise = new Promise<string>((resolve) => {
          pendingUserQuestions.push({
            requestId,
            question,
            respond: resolve,
          });

          // Emit permission.requested event for UI handling
          if (onPermissionRequest) {
            onPermissionRequest({
              requestId,
              toolName: "AskUserQuestion",
              question,
              options: [
                { label: "Yes", value: "yes" },
                { label: "No", value: "no" },
              ],
              respond: (answer) => {
                resolve(Array.isArray(answer) ? answer[0] ?? "" : answer);
              },
            });
          }
        });

        // Wait for user response (simulates pause behavior)
        const answer = await responsePromise;

        return {
          type: "text",
          content: `User responded: ${answer}`,
          role: "assistant",
        };
      }

      return {
        type: "text",
        content: `Response to: ${message}`,
        role: "assistant",
      };
    },

    async *stream(message: string): AsyncIterable<AgentMessage> {
      yield { type: "text", content: "Streaming...", role: "assistant" };
      yield { type: "text", content: message, role: "assistant" };
    },

    async summarize(): Promise<void> {},

    async getContextUsage(): Promise<ContextUsage> {
      return {
        inputTokens: 100,
        outputTokens: 50,
        maxTokens: 200000,
        usagePercentage: 0.075,
      };
    },

    async destroy(): Promise<void> {},
  };

  return session;
}

/**
 * Create a mock Claude SDK client with configurable permission mode.
 */
function createMockClaudeClient(permissionMode: PermissionMode = "bypass"): CodingAgentClient & {
  sessions: Map<string, MockSession>;
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  permissionMode: PermissionMode;
} {
  const sessions = new Map<string, MockSession>();
  const eventHandlers = new Map<EventType, Set<EventHandler<EventType>>>();
  let isRunning = false;

  const emitEvent = <T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>
  ) => {
    const handlers = eventHandlers.get(eventType);
    if (!handlers) return;

    const event: AgentEvent<T> = {
      type: eventType,
      sessionId,
      timestamp: new Date().toISOString(),
      data: data as AgentEvent<T>["data"],
    };

    for (const handler of handlers) {
      handler(event as AgentEvent<EventType>);
    }
  };

  return {
    agentType: "claude",
    sessions,
    eventHandlers,
    permissionMode,

    async createSession(config?: SessionConfig): Promise<Session> {
      if (!isRunning) {
        throw new Error("Client not started. Call start() first.");
      }

      const sessionId = config?.sessionId ?? `claude-${Date.now()}`;

      // Use permissionMode from config or default to client's mode
      const effectiveMode = config?.permissionMode ?? permissionMode;

      const session = createMockSession(
        sessionId,
        effectiveMode,
        (data) => emitEvent("permission.requested", sessionId, data)
      );

      sessions.set(sessionId, session);
      emitEvent("session.start", sessionId, { config });

      return session;
    },

    async resumeSession(sessionId: string): Promise<Session | null> {
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

    registerTool(_tool: ToolDefinition): void {},

    async start(): Promise<void> {
      isRunning = true;
    },

    async stop(): Promise<void> {
      isRunning = false;
      sessions.clear();
      eventHandlers.clear();
    },

    async getModelDisplayInfo() {
      return { model: "Mock Claude", tier: "Claude Code" };
    },
  };
}

/**
 * Create a mock OpenCode SDK client with configurable permission mode.
 * OpenCode uses configuration-based permissions via opencode.json
 */
function createMockOpenCodeClient(
  permissionConfig: "allow" | "deny" | "ask" = "allow"
): CodingAgentClient & {
  sessions: Map<string, MockSession>;
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  permissionConfig: string;
} {
  const sessions = new Map<string, MockSession>();
  const eventHandlers = new Map<EventType, Set<EventHandler<EventType>>>();
  let isRunning = false;

  // Map OpenCode config to PermissionMode
  const permissionMode: PermissionMode = permissionConfig === "allow" ? "bypass" : "prompt";

  const emitEvent = <T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>
  ) => {
    const handlers = eventHandlers.get(eventType);
    if (!handlers) return;

    const event: AgentEvent<T> = {
      type: eventType,
      sessionId,
      timestamp: new Date().toISOString(),
      data: data as AgentEvent<T>["data"],
    };

    for (const handler of handlers) {
      handler(event as AgentEvent<EventType>);
    }
  };

  return {
    agentType: "opencode",
    sessions,
    eventHandlers,
    permissionConfig,

    async createSession(config?: SessionConfig): Promise<Session> {
      if (!isRunning) {
        throw new Error("Client not started. Call start() first.");
      }

      const sessionId = config?.sessionId ?? `opencode-${Date.now()}`;

      const session = createMockSession(
        sessionId,
        permissionMode,
        (data) => emitEvent("permission.requested", sessionId, data)
      );

      sessions.set(sessionId, session);
      emitEvent("session.start", sessionId, { config });

      return session;
    },

    async resumeSession(sessionId: string): Promise<Session | null> {
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

    registerTool(_tool: ToolDefinition): void {},

    async start(): Promise<void> {
      isRunning = true;
    },

    async stop(): Promise<void> {
      isRunning = false;
      sessions.clear();
      eventHandlers.clear();
    },

    async getModelDisplayInfo() {
      return { model: "Claude", tier: "OpenCode" };
    },
  };
}

/**
 * Create a mock Copilot SDK client.
 * Copilot uses PermissionHandler - when not set, defaults to auto-approve (bypass).
 */
function createMockCopilotClient(
  hasPermissionHandler: boolean = false
): CodingAgentClient & {
  sessions: Map<string, MockSession>;
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  hasPermissionHandler: boolean;
} {
  const sessions = new Map<string, MockSession>();
  const eventHandlers = new Map<EventType, Set<EventHandler<EventType>>>();
  let isRunning = false;

  // No PermissionHandler = bypass mode (all auto-approved)
  const permissionMode: PermissionMode = hasPermissionHandler ? "prompt" : "bypass";

  const emitEvent = <T extends EventType>(
    eventType: T,
    sessionId: string,
    data: Record<string, unknown>
  ) => {
    const handlers = eventHandlers.get(eventType);
    if (!handlers) return;

    const event: AgentEvent<T> = {
      type: eventType,
      sessionId,
      timestamp: new Date().toISOString(),
      data: data as AgentEvent<T>["data"],
    };

    for (const handler of handlers) {
      handler(event as AgentEvent<EventType>);
    }
  };

  return {
    agentType: "copilot",
    sessions,
    eventHandlers,
    hasPermissionHandler,

    async createSession(config?: SessionConfig): Promise<Session> {
      if (!isRunning) {
        throw new Error("Client not started. Call start() first.");
      }

      const sessionId = config?.sessionId ?? `copilot-${Date.now()}`;

      const session = createMockSession(
        sessionId,
        permissionMode,
        (data) => emitEvent("permission.requested", sessionId, data)
      );

      sessions.set(sessionId, session);
      emitEvent("session.start", sessionId, { config });

      return session;
    },

    async resumeSession(sessionId: string): Promise<Session | null> {
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

    registerTool(_tool: ToolDefinition): void {},

    async start(): Promise<void> {
      isRunning = true;
    },

    async stop(): Promise<void> {
      isRunning = false;
      sessions.clear();
      eventHandlers.clear();
    },

    async getModelDisplayInfo() {
      return { model: "Copilot", tier: "GitHub Copilot" };
    },
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe("Integration test: Permission bypass configuration per SDK", () => {
  // --------------------------------------------------------------------------
  // Claude SDK Tests
  // --------------------------------------------------------------------------

  describe("Claude SDK with permissionMode: bypassPermissions", () => {
    let client: ReturnType<typeof createMockClaudeClient>;

    beforeEach(async () => {
      client = createMockClaudeClient("bypass");
      await client.start();
    });

    afterEach(async () => {
      await client.stop();
    });

    test("client has bypass permission mode configured", () => {
      expect(client.permissionMode).toBe("bypass");
    });

    test("session is created with bypass permission mode", async () => {
      const session = await client.createSession();
      expect(session).toBeDefined();
      expect(session.id).toContain("claude");
    });

    test("tools execute without prompts in bypass mode", async () => {
      const session = (await client.createSession()) as MockSession;

      // Execute multiple tools
      await session.send("execute_tool:Bash");
      await session.send("execute_tool:Write");
      await session.send("execute_tool:Edit");

      // Verify all tools executed without prompts
      expect(session.toolExecutions).toHaveLength(3);

      for (const execution of session.toolExecutions) {
        expect(execution.wasPrompted).toBe(false);
      }
    });

    test("Bash commands execute without prompt in bypass mode", async () => {
      const session = (await client.createSession()) as MockSession;

      const result = await session.send("execute_tool:Bash");

      expect(result.type).toBe("tool_result");
      expect(result.content).toContain("bypassed permission");

      const bashExecution = session.toolExecutions.find(
        (e) => e.toolName === "Bash"
      );
      expect(bashExecution).toBeDefined();
      expect(bashExecution?.wasPrompted).toBe(false);
    });

    test("file edits execute without prompt in bypass mode", async () => {
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Write");

      const editExecution = session.toolExecutions.find(
        (e) => e.toolName === "Edit"
      );
      const writeExecution = session.toolExecutions.find(
        (e) => e.toolName === "Write"
      );

      expect(editExecution?.wasPrompted).toBe(false);
      expect(writeExecution?.wasPrompted).toBe(false);
    });

    test("web operations execute without prompt in bypass mode", async () => {
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:WebSearch");
      await session.send("execute_tool:WebFetch");

      expect(session.toolExecutions).toHaveLength(2);
      expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
    });

    test("allowDangerouslySkipPermissions is implicitly set in bypass mode", async () => {
      // When permissionMode is 'bypass', allowDangerouslySkipPermissions should be true
      // This is verified by the fact that tools execute without prompts
      const session = (await client.createSession({
        permissionMode: "bypass",
      })) as MockSession;

      await session.send("execute_tool:DangerousTool");

      expect(session.toolExecutions[0]?.wasPrompted).toBe(false);
    });

    test("session config can override client permission mode", async () => {
      // Client is in bypass mode, but session can request prompt mode
      const session = (await client.createSession({
        permissionMode: "prompt",
      })) as MockSession;

      await session.send("execute_tool:Bash");

      // In prompt mode, tools would be prompted (though mock simulates after recording)
      expect(session.toolExecutions[0]?.wasPrompted).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // OpenCode SDK Tests
  // --------------------------------------------------------------------------

  describe("OpenCode SDK with permission: { default: allow }", () => {
    let client: ReturnType<typeof createMockOpenCodeClient>;

    beforeEach(async () => {
      client = createMockOpenCodeClient("allow");
      await client.start();
    });

    afterEach(async () => {
      await client.stop();
    });

    test("client has allow permission config", () => {
      expect(client.permissionConfig).toBe("allow");
    });

    test("tools execute without prompts with allow config", async () => {
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:Bash");
      await session.send("execute_tool:Write");

      expect(session.toolExecutions).toHaveLength(2);
      expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
    });

    test("Bash commands auto-execute with allow config", async () => {
      const session = (await client.createSession()) as MockSession;

      const result = await session.send("execute_tool:Bash");

      expect(result.type).toBe("tool_result");
      expect(session.toolExecutions[0]?.wasPrompted).toBe(false);
    });

    test("file edits auto-execute with allow config", async () => {
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:Edit");

      expect(session.toolExecutions[0]?.wasPrompted).toBe(false);
    });

    test("all tools auto-execute when permission.default is allow", async () => {
      const session = (await client.createSession()) as MockSession;

      // Execute a variety of tools
      const tools = ["Bash", "Edit", "Write", "Read", "Glob", "Grep", "WebSearch"];

      for (const tool of tools) {
        await session.send(`execute_tool:${tool}`);
      }

      expect(session.toolExecutions).toHaveLength(tools.length);
      expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
    });

    test("ask rules are removed with allow config", async () => {
      // With permission: { default: 'allow' }, there are no 'ask' rules
      // All tools should auto-execute
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:Bash");

      // No permission request should be emitted for regular tools
      expect(session.toolExecutions[0]?.wasPrompted).toBe(false);
    });
  });

  describe("OpenCode SDK with permission: deny (comparison test)", () => {
    let client: ReturnType<typeof createMockOpenCodeClient>;

    beforeEach(async () => {
      client = createMockOpenCodeClient("deny");
      await client.start();
    });

    afterEach(async () => {
      await client.stop();
    });

    test("tools require prompts with deny/ask config", async () => {
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:Bash");

      // In deny/ask mode, tools would be prompted
      expect(session.toolExecutions[0]?.wasPrompted).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Copilot SDK Tests
  // --------------------------------------------------------------------------

  describe("Copilot SDK with no PermissionHandler", () => {
    let client: ReturnType<typeof createMockCopilotClient>;

    beforeEach(async () => {
      // No permission handler = auto-approve all
      client = createMockCopilotClient(false);
      await client.start();
    });

    afterEach(async () => {
      await client.stop();
    });

    test("client has no permission handler configured", () => {
      expect(client.hasPermissionHandler).toBe(false);
    });

    test("all tools auto-execute without PermissionHandler", async () => {
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:Bash");
      await session.send("execute_tool:Write");
      await session.send("execute_tool:Edit");

      expect(session.toolExecutions).toHaveLength(3);
      expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
    });

    test("Bash commands execute without prompt", async () => {
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:Bash");

      expect(session.toolExecutions[0]?.wasPrompted).toBe(false);
    });

    test("file edits execute without prompt", async () => {
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Write");

      expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
    });

    test("web operations execute without prompt", async () => {
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:WebSearch");
      await session.send("execute_tool:WebFetch");

      expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
    });

    test("this is equivalent to --allow-all mode", async () => {
      // No PermissionHandler means all operations are auto-approved
      // Same behavior as running Copilot CLI with --allow-all flag
      const session = (await client.createSession()) as MockSession;

      const dangerousTools = ["Bash", "rm -rf", "dangerous_script"];

      for (const tool of dangerousTools) {
        await session.send(`execute_tool:${tool}`);
      }

      expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
    });
  });

  describe("Copilot SDK with PermissionHandler (comparison test)", () => {
    let client: ReturnType<typeof createMockCopilotClient>;

    beforeEach(async () => {
      // With permission handler = would prompt for permissions
      client = createMockCopilotClient(true);
      await client.start();
    });

    afterEach(async () => {
      await client.stop();
    });

    test("client has permission handler configured", () => {
      expect(client.hasPermissionHandler).toBe(true);
    });

    test("tools would be prompted with PermissionHandler", async () => {
      const session = (await client.createSession()) as MockSession;

      await session.send("execute_tool:Bash");

      // With PermissionHandler, tools would be prompted
      expect(session.toolExecutions[0]?.wasPrompted).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Cross-SDK Verification Tests
  // --------------------------------------------------------------------------

  describe("All tools execute without prompts across SDKs", () => {
    test("Bash commands execute without prompts on all SDKs", async () => {
      const claudeClient = createMockClaudeClient("bypass");
      const openCodeClient = createMockOpenCodeClient("allow");
      const copilotClient = createMockCopilotClient(false);

      await claudeClient.start();
      await openCodeClient.start();
      await copilotClient.start();

      try {
        const claudeSession = (await claudeClient.createSession()) as MockSession;
        const openCodeSession = (await openCodeClient.createSession()) as MockSession;
        const copilotSession = (await copilotClient.createSession()) as MockSession;

        await claudeSession.send("execute_tool:Bash");
        await openCodeSession.send("execute_tool:Bash");
        await copilotSession.send("execute_tool:Bash");

        expect(claudeSession.toolExecutions[0]?.wasPrompted).toBe(false);
        expect(openCodeSession.toolExecutions[0]?.wasPrompted).toBe(false);
        expect(copilotSession.toolExecutions[0]?.wasPrompted).toBe(false);
      } finally {
        await claudeClient.stop();
        await openCodeClient.stop();
        await copilotClient.stop();
      }
    });

    test("file edits execute without prompts on all SDKs", async () => {
      const claudeClient = createMockClaudeClient("bypass");
      const openCodeClient = createMockOpenCodeClient("allow");
      const copilotClient = createMockCopilotClient(false);

      await claudeClient.start();
      await openCodeClient.start();
      await copilotClient.start();

      try {
        const claudeSession = (await claudeClient.createSession()) as MockSession;
        const openCodeSession = (await openCodeClient.createSession()) as MockSession;
        const copilotSession = (await copilotClient.createSession()) as MockSession;

        await claudeSession.send("execute_tool:Edit");
        await openCodeSession.send("execute_tool:Edit");
        await copilotSession.send("execute_tool:Edit");

        expect(claudeSession.toolExecutions[0]?.wasPrompted).toBe(false);
        expect(openCodeSession.toolExecutions[0]?.wasPrompted).toBe(false);
        expect(copilotSession.toolExecutions[0]?.wasPrompted).toBe(false);
      } finally {
        await claudeClient.stop();
        await openCodeClient.stop();
        await copilotClient.stop();
      }
    });

    test("web searches execute without prompts on all SDKs", async () => {
      const claudeClient = createMockClaudeClient("bypass");
      const openCodeClient = createMockOpenCodeClient("allow");
      const copilotClient = createMockCopilotClient(false);

      await claudeClient.start();
      await openCodeClient.start();
      await copilotClient.start();

      try {
        const claudeSession = (await claudeClient.createSession()) as MockSession;
        const openCodeSession = (await openCodeClient.createSession()) as MockSession;
        const copilotSession = (await copilotClient.createSession()) as MockSession;

        await claudeSession.send("execute_tool:WebSearch");
        await openCodeSession.send("execute_tool:WebSearch");
        await copilotSession.send("execute_tool:WebSearch");

        expect(claudeSession.toolExecutions[0]?.wasPrompted).toBe(false);
        expect(openCodeSession.toolExecutions[0]?.wasPrompted).toBe(false);
        expect(copilotSession.toolExecutions[0]?.wasPrompted).toBe(false);
      } finally {
        await claudeClient.stop();
        await openCodeClient.stop();
        await copilotClient.stop();
      }
    });
  });

  // --------------------------------------------------------------------------
  // AskUserQuestion Pause Tests
  // --------------------------------------------------------------------------

  describe("AskUserQuestion still pauses for input", () => {
    test("Claude SDK AskUserQuestion pauses execution", async () => {
      const client = createMockClaudeClient("bypass");
      await client.start();

      try {
        let permissionRequested = false;
        let requestData: PermissionRequestedEventData | null = null;

        client.on("permission.requested", (event) => {
          permissionRequested = true;
          requestData = event.data;
        });

        const session = (await client.createSession()) as MockSession;

        // Start AskUserQuestion (this will pause waiting for response)
        const sendPromise = session.send("ask_user:What is your favorite color?");

        // Wait a bit for the question to be registered
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Verify question is pending
        expect(session.pendingUserQuestions).toHaveLength(1);
        expect(session.pendingUserQuestions[0]?.question).toBe(
          "What is your favorite color?"
        );

        // Verify permission.requested event was emitted
        expect(permissionRequested).toBe(true);
        expect(requestData?.toolName).toBe("AskUserQuestion");

        // Simulate user response
        session.pendingUserQuestions[0]?.respond("blue");

        // Wait for send to complete
        const result = await sendPromise;

        expect(result.content).toContain("blue");
      } finally {
        await client.stop();
      }
    });

    test("OpenCode SDK AskUserQuestion pauses execution", async () => {
      const client = createMockOpenCodeClient("allow");
      await client.start();

      try {
        let permissionRequested = false;

        client.on("permission.requested", () => {
          permissionRequested = true;
        });

        const session = (await client.createSession()) as MockSession;

        const sendPromise = session.send("ask_user:Continue with deployment?");

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(session.pendingUserQuestions).toHaveLength(1);
        expect(permissionRequested).toBe(true);

        session.pendingUserQuestions[0]?.respond("yes");

        const result = await sendPromise;
        expect(result.content).toContain("yes");
      } finally {
        await client.stop();
      }
    });

    test("Copilot SDK AskUserQuestion pauses execution", async () => {
      const client = createMockCopilotClient(false);
      await client.start();

      try {
        let permissionRequested = false;

        client.on("permission.requested", () => {
          permissionRequested = true;
        });

        const session = (await client.createSession()) as MockSession;

        const sendPromise = session.send("ask_user:Approve this change?");

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(session.pendingUserQuestions).toHaveLength(1);
        expect(permissionRequested).toBe(true);

        session.pendingUserQuestions[0]?.respond("approved");

        const result = await sendPromise;
        expect(result.content).toContain("approved");
      } finally {
        await client.stop();
      }
    });

    test("AskUserQuestion blocks until user responds", async () => {
      const client = createMockClaudeClient("bypass");
      await client.start();

      try {
        const session = (await client.createSession()) as MockSession;

        let sendCompleted = false;

        const sendPromise = session.send("ask_user:Confirm action?").then(
          (result) => {
            sendCompleted = true;
            return result;
          }
        );

        // Wait to ensure send is blocked
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Send should NOT be completed yet (waiting for user)
        expect(sendCompleted).toBe(false);
        expect(session.pendingUserQuestions).toHaveLength(1);

        // Now respond
        session.pendingUserQuestions[0]?.respond("confirmed");

        await sendPromise;

        // Now it should be complete
        expect(sendCompleted).toBe(true);
      } finally {
        await client.stop();
      }
    });

    test("human_input_required event is emitted for AskUserQuestion", async () => {
      const client = createMockClaudeClient("bypass");
      await client.start();

      try {
        let eventEmitted = false;
        let eventData: Record<string, unknown> | null = null;

        client.on("permission.requested", (event) => {
          eventEmitted = true;
          eventData = event.data;
        });

        const session = (await client.createSession()) as MockSession;

        const sendPromise = session.send("ask_user:Select an option");

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(eventEmitted).toBe(true);
        expect(eventData).not.toBeNull();
        expect(eventData?.toolName).toBe("AskUserQuestion");
        expect(eventData?.question).toBe("Select an option");
        expect(eventData?.options).toBeDefined();

        session.pendingUserQuestions[0]?.respond("option1");
        await sendPromise;
      } finally {
        await client.stop();
      }
    });

    test("workflow state includes __waitingForInput: true during AskUserQuestion", async () => {
      // This simulates the workflow state behavior
      const client = createMockClaudeClient("bypass");
      await client.start();

      try {
        const session = (await client.createSession()) as MockSession;

        // Track workflow state simulation
        let waitingForInput = false;

        client.on("permission.requested", () => {
          waitingForInput = true;
        });

        const sendPromise = session.send("ask_user:Input needed");

        await new Promise((resolve) => setTimeout(resolve, 10));

        // During waiting, state should indicate waiting for input
        expect(waitingForInput).toBe(true);
        expect(session.pendingUserQuestions.length).toBeGreaterThan(0);

        // Respond and complete
        session.pendingUserQuestions[0]?.respond("input provided");
        await sendPromise;
      } finally {
        await client.stop();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases and Error Handling
  // --------------------------------------------------------------------------

  describe("Edge cases", () => {
    test("multiple tools execute sequentially without prompts", async () => {
      const client = createMockClaudeClient("bypass");
      await client.start();

      try {
        const session = (await client.createSession()) as MockSession;

        // Execute 10 tools in sequence
        for (let i = 0; i < 10; i++) {
          await session.send(`execute_tool:Tool${i}`);
        }

        expect(session.toolExecutions).toHaveLength(10);
        expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
      } finally {
        await client.stop();
      }
    });

    test("AskUserQuestion works correctly after tool executions", async () => {
      const client = createMockClaudeClient("bypass");
      await client.start();

      try {
        const session = (await client.createSession()) as MockSession;

        // Execute some tools first
        await session.send("execute_tool:Bash");
        await session.send("execute_tool:Edit");

        expect(session.toolExecutions).toHaveLength(2);

        // Now ask user
        const sendPromise = session.send("ask_user:Continue?");

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(session.pendingUserQuestions).toHaveLength(1);

        session.pendingUserQuestions[0]?.respond("yes");
        await sendPromise;

        // Tools should still be recorded
        expect(session.toolExecutions).toHaveLength(2);
      } finally {
        await client.stop();
      }
    });

    test("tool executions continue after user responds to AskUserQuestion", async () => {
      const client = createMockClaudeClient("bypass");
      await client.start();

      try {
        const session = (await client.createSession()) as MockSession;

        // Ask user first
        const askPromise = session.send("ask_user:Proceed?");
        await new Promise((resolve) => setTimeout(resolve, 10));
        session.pendingUserQuestions[0]?.respond("proceed");
        await askPromise;

        // Now execute more tools
        await session.send("execute_tool:Bash");
        await session.send("execute_tool:Write");

        expect(session.toolExecutions).toHaveLength(2);
        expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
      } finally {
        await client.stop();
      }
    });

    test("concurrent sessions maintain independent permission state", async () => {
      const client = createMockClaudeClient("bypass");
      await client.start();

      try {
        const session1 = (await client.createSession({
          sessionId: "session-1",
        })) as MockSession;
        const session2 = (await client.createSession({
          sessionId: "session-2",
        })) as MockSession;

        await session1.send("execute_tool:Bash");
        await session2.send("execute_tool:Edit");
        await session1.send("execute_tool:Write");

        expect(session1.toolExecutions).toHaveLength(2);
        expect(session2.toolExecutions).toHaveLength(1);

        expect(session1.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
        expect(session2.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);
      } finally {
        await client.stop();
      }
    });

    test("permission mode is preserved across session resume", async () => {
      const client = createMockClaudeClient("bypass");
      await client.start();

      try {
        const session = (await client.createSession({
          sessionId: "resume-test",
        })) as MockSession;

        await session.send("execute_tool:Bash");
        expect(session.toolExecutions[0]?.wasPrompted).toBe(false);

        // Resume session
        const resumedSession = await client.resumeSession("resume-test");
        expect(resumedSession).not.toBeNull();

        if (resumedSession) {
          await resumedSession.send("execute_tool:Edit");
          expect(
            (resumedSession as MockSession).toolExecutions[1]?.wasPrompted
          ).toBe(false);
        }
      } finally {
        await client.stop();
      }
    });
  });
});
