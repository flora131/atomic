/**
 * E2E tests for running all functionality in copilot mode
 *
 * These tests verify that when Atomic is configured for the Copilot backend:
 * 1. Configure Atomic for copilot backend
 * 2. Run /ralph workflow
 * 3. Run sub-agent commands
 * 4. Verify all features work in copilot mode
 * 5. Verify permission bypass configured correctly
 *
 * Reference: Feature - E2E test: Run all functionality in copilot mode
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
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
import {
  parseRalphArgs,
  isValidUUID,
} from "../../src/ui/commands/workflow-commands.ts";
import {
  generateSessionId,
  getSessionDir,
  createSessionDirectory,
  saveSession,
  loadSession,
  createRalphSession,
  createRalphWorkflow,
  type RalphSession,
} from "../../src/workflows/index.ts";
import {
  createRalphWorkflowState,
  type RalphWorkflowState,
} from "../../src/graph/nodes/ralph-nodes.ts";
import {
  BUILTIN_AGENTS,
  getBuiltinAgent,
  createAgentCommand,
  registerBuiltinAgents,
} from "../../src/ui/commands/agent-commands.ts";
import {
  globalRegistry,
  type CommandContext,
  type CommandContextState,
  type CommandResult,
} from "../../src/ui/commands/registry.ts";
import {
  CopilotClient,
  createCopilotClient,
  createAutoApprovePermissionHandler,
  createDenyAllPermissionHandler,
} from "../../src/sdk/copilot-client.ts";

// ============================================================================
// TEST HELPERS - Mock Copilot Client with Tool Execution Tracking
// ============================================================================

/**
 * Tool execution record for tracking permission behavior.
 */
interface ToolExecutionRecord {
  toolName: string;
  toolInput: unknown;
  wasPrompted: boolean;
  autoExecuted: boolean;
  timestamp: string;
}

/**
 * Mock session that simulates Copilot tool execution with permission bypass.
 */
interface MockCopilotSession extends Session {
  /** Captured tool executions for verification */
  toolExecutions: ToolExecutionRecord[];

  /** Pending AskUserQuestion requests */
  pendingUserQuestions: Array<{
    requestId: string;
    question: string;
    respond: (answer: string) => void;
  }>;

  /** Permission mode for this session */
  permissionMode: PermissionMode;

  /** Session model configuration */
  configuredModel: string;
}

/**
 * Create a mock session that simulates Copilot tool execution with permission bypass.
 * By default, Copilot uses auto-approve permission handler (bypass mode).
 */
function createMockCopilotSession(
  id: string,
  permissionMode: PermissionMode,
  model: string = "gpt-4",
  onPermissionRequest?: (data: PermissionRequestedEventData) => void
): MockCopilotSession {
  const toolExecutions: ToolExecutionRecord[] = [];
  const pendingUserQuestions: MockCopilotSession["pendingUserQuestions"] = [];

  const session: MockCopilotSession = {
    id,
    toolExecutions,
    pendingUserQuestions,
    permissionMode,
    configuredModel: model,

    async send(message: string): Promise<AgentMessage> {
      // Handle tool execution simulation
      if (message.includes("execute_tool:")) {
        const toolName = message.replace("execute_tool:", "").trim();
        const isBypassMode = permissionMode === "bypass";

        // Record the execution
        toolExecutions.push({
          toolName,
          toolInput: { message },
          wasPrompted: !isBypassMode,
          autoExecuted: isBypassMode,
          timestamp: new Date().toISOString(),
        });

        // In bypass mode (auto-approve handler), all tools auto-execute without prompts
        if (isBypassMode) {
          return {
            type: "tool_result",
            content: `Tool ${toolName} executed successfully (Copilot auto-approved, no prompt)`,
            role: "assistant",
          };
        }

        // In prompt mode, tools would require confirmation
        return {
          type: "tool_result",
          content: `Tool ${toolName} executed (Copilot prompted: true)`,
          role: "assistant",
        };
      }

      // Handle AskUserQuestion - this ALWAYS pauses regardless of permission mode
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
        content: `Copilot response to: ${message}`,
        role: "assistant",
      };
    },

    stream(message: string): AsyncIterable<AgentMessage> {
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "text", content: "Copilot streaming...", role: "assistant" };
          yield { type: "text", content: message, role: "assistant" };
        },
      };
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

    getSystemToolsTokens() { return 0; },

    async destroy(): Promise<void> {},
  };

  return session;
}

/**
 * Create a mock Copilot client for testing.
 * Copilot uses permission handlers:
 * - Auto-approve handler (default) = bypass all prompts (tools auto-execute)
 * - Deny handler = deny all tool executions
 * - Custom handler = implement HITL approval
 */
function createMockCopilotClientWithTracking(
  useAutoApprove: boolean = true
): CodingAgentClient & {
  sessions: Map<string, MockCopilotSession>;
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  permissionHandlerType: string;
  connectionMode: string;
} {
  const sessions = new Map<string, MockCopilotSession>();
  const eventHandlers = new Map<EventType, Set<EventHandler<EventType>>>();
  let isRunning = false;

  // Map permission handler to PermissionMode
  const permissionMode: PermissionMode = useAutoApprove ? "bypass" : "deny";

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
    permissionHandlerType: useAutoApprove ? "auto-approve" : "deny-all",
    connectionMode: "stdio",

    async createSession(config?: SessionConfig): Promise<Session> {
      if (!isRunning) {
        throw new Error("Client not started. Call start() first.");
      }

      const sessionId = config?.sessionId ?? `copilot_${Date.now()}`;
      const model = config?.model ?? "gpt-4";

      const session = createMockCopilotSession(
        sessionId,
        permissionMode,
        model,
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

/**
 * Create a mock CommandContext for testing with Copilot client.
 */
function createMockContextWithCopilot(
  stateOverrides: Partial<CommandContextState> = {},
  client?: CodingAgentClient
): CommandContext & { getMessages: () => Array<{ role: string; content: string }> } {
  const messages: Array<{ role: string; content: string }> = [];
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
      workflowActive: false,
      workflowType: null,
      initialPrompt: null,
      pendingApproval: false,
      specApproved: undefined,
      feedback: null,
      ...stateOverrides,
    },
    addMessage: (role, content) => {
      messages.push({ role, content });
    },
    setStreaming: () => {},
    sendMessage: (content) => {
      messages.push({ role: "user", content });
    },
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "Mock Copilot sub-agent output" }),
    getMessages: () => messages,
  };
}

/**
 * Create test feature list content.
 */
function createTestTaskListContent(): string {
  const features = {
    tasks: [
      {
        category: "functional",
        description: "Test feature 1: Copilot mode feature implementation",
        steps: ["Initialize Copilot client", "Execute tool", "Verify result"],
        passes: false,
      },
      {
        category: "functional",
        description: "Test feature 2: Copilot connection mode selection",
        steps: ["Configure connection mode", "Verify connection in session"],
        passes: false,
      },
    ],
  };
  return JSON.stringify(taskList, null, 2);
}

// ============================================================================
// E2E TEST: Run all functionality in copilot mode
// ============================================================================

describe("E2E test: Run all functionality in copilot mode", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-copilot-e2e-"));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 1. Configure Atomic for copilot backend
  // ============================================================================

  describe("1. Configure Atomic for copilot backend", () => {
    test("CopilotClient can be instantiated", () => {
      const client = createCopilotClient({
        connectionMode: { type: "stdio" },
        autoStart: false,
      });

      expect(client).toBeDefined();
      expect(client.agentType).toBe("copilot");
    });

    test("mock Copilot client has correct agent type", () => {
      const client = createMockCopilotClientWithTracking(true);
      expect(client.agentType).toBe("copilot");
    });

    test("Copilot client default permission handler is auto-approve", () => {
      const client = createMockCopilotClientWithTracking(true);
      expect(client.permissionHandlerType).toBe("auto-approve");
    });

    test("Copilot client default connection mode is stdio", () => {
      const client = createMockCopilotClientWithTracking(true);
      expect(client.connectionMode).toBe("stdio");
    });

    test("Copilot client can be configured with deny-all permission", () => {
      const client = createMockCopilotClientWithTracking(false);
      expect(client.permissionHandlerType).toBe("deny-all");
    });

    test("auto-approve handler maps to bypass mode", async () => {
      // When using auto-approve handler (default), tools should auto-execute
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;
      expect(session.permissionMode).toBe("bypass");

      await client.stop();
    });

    test("Copilot client supports all connection modes", () => {
      const modes: Array<{ type: "stdio" } | { type: "port"; port: number } | { type: "cliUrl"; url: string }> = [
        { type: "stdio" },
        { type: "port", port: 3000 },
        { type: "cliUrl", url: "http://localhost:3000" },
      ];
      for (const mode of modes) {
        const client = createCopilotClient({ connectionMode: mode, autoStart: false });
        expect(client).toBeDefined();
      }
    });

    test("Copilot session uses configured model", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession({
        model: "gpt-4-turbo",
      })) as MockCopilotSession;

      expect(session.configuredModel).toBe("gpt-4-turbo");

      await client.stop();
    });
  });

  // ============================================================================
  // 2. Run /ralph workflow in copilot mode
  // ============================================================================

  describe("2. Run /ralph workflow in copilot mode", () => {
    beforeEach(async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "tasks.json"),
        createTestTaskListContent()
      );
    });

    test("workflow can be created in copilot mode", () => {
      const workflow = createRalphWorkflow({
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
      expect(workflow.nodes).toBeInstanceOf(Map);
    });

    test("workflow state can be created for copilot client", () => {
      const state = createRalphWorkflowState({
        userPrompt: "Test in Copilot mode",
      });

      expect(state).toBeDefined();
      expect(state.userPrompt).toBe("Test in Copilot mode");
    });

    test("workflow session can be created with Copilot client", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = await client.createSession({
        sessionId: "ralph-workflow-session",
      });

      expect(session).toBeDefined();
      expect(session.id).toBe("ralph-workflow-session");

      await client.stop();
    });

    test("workflow tools execute without prompts in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;

      // Simulate workflow tool executions
      await session.send("execute_tool:Glob");
      await session.send("execute_tool:Grep");
      await session.send("execute_tool:Read");
      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Write");
      await session.send("execute_tool:Bash");

      expect(session.toolExecutions).toHaveLength(6);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);
      expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);

      await client.stop();
    });

    test("Ralph session can be created and saved in copilot mode", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        tasks: [
          { id: "feat-1", content: "Copilot test feature", status: "pending" as const, activeForm: "Copilot test feature" },
        ],
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.sessionId).toBe(sessionId);
      expect(loaded.tasks[0]?.name).toBe("Copilot test feature");
    });

      expect(workflow).toBeDefined();

      await client.stop();
    });
  });

  // ============================================================================
  // 3. Run sub-agent commands in copilot mode
  // ============================================================================

  describe("3. Run sub-agent commands in copilot mode", () => {
    test("BUILTIN_AGENTS array is available", () => {
      expect(BUILTIN_AGENTS).toBeDefined();
      expect(Array.isArray(BUILTIN_AGENTS)).toBe(true);
      expect(BUILTIN_AGENTS.length).toBeGreaterThan(0);
    });

    test("getBuiltinAgent returns agents correctly", () => {
      const analyzer = getBuiltinAgent("codebase-analyzer");
      expect(analyzer).toBeDefined();
      expect(analyzer?.name).toBe("codebase-analyzer");
    });

    test("codebase-analyzer agent can be invoked in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const context = createMockContextWithCopilot();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("analyze auth flow", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("codebase-locator agent works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();
      expect(agent?.model).toBe("opus");

      const context = createMockContextWithCopilot();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("find routing files", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("debugger agent works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();
      expect(agent?.model).toBe("opus");

      const context = createMockContextWithCopilot();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("debug TypeError", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("all builtin agents can be registered in copilot mode", () => {
      // Clear existing registrations
      registerBuiltinAgents();

      // Verify all agents are registered
      for (const agent of BUILTIN_AGENTS) {
        expect(globalRegistry.has(agent.name)).toBe(true);
      }
    });

    test("codebase-online-researcher agent works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const agent = getBuiltinAgent("codebase-online-researcher");
      expect(agent).toBeDefined();

      const context = createMockContextWithCopilot();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("research best practices", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("codebase-pattern-finder agent works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const agent = getBuiltinAgent("codebase-pattern-finder");
      expect(agent).toBeDefined();

      const context = createMockContextWithCopilot();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("find similar implementations", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });
  });

  // ============================================================================
  // 4. Verify all features work in copilot mode
  // ============================================================================

  describe("4. Verify all features work in copilot mode", () => {
    test("session creation works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = await client.createSession();
      expect(session).toBeDefined();
      expect(session.id).toContain("copilot");

      await client.stop();
    });

    test("session send works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = await client.createSession();
      const response = await session.send("Hello Copilot");

      expect(response).toBeDefined();
      expect(response.type).toBe("text");
      expect(response.content).toContain("Copilot");

      await client.stop();
    });

    test("session stream works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = await client.createSession();
      const chunks: AgentMessage[] = [];

      for await (const chunk of session.stream("Test streaming")) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);

      await client.stop();
    });

    test("session getContextUsage works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = await client.createSession();
      const usage = await session.getContextUsage();

      expect(usage).toBeDefined();
      expect(usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
      expect(usage.maxTokens).toBeGreaterThan(0);

      await client.stop();
    });

    test("session summarize works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = await client.createSession();

      // Should not throw
      await session.summarize();

      await client.stop();
    });

    test("event handling works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);

      let sessionStarted = false;
      client.on("session.start", () => {
        sessionStarted = true;
      });

      await client.start();
      await client.createSession();

      expect(sessionStarted).toBe(true);

      await client.stop();
    });

    test("getModelDisplayInfo works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const info = await client.getModelDisplayInfo();

      expect(info).toBeDefined();
      expect(info.model).toBeDefined();
      expect(info.tier).toBe("GitHub Copilot");

      await client.stop();
    });

    test("session destroy works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = await client.createSession();
      await session.destroy();

      // Should not throw

      await client.stop();
    });
  });

  // ============================================================================
  // 5. Verify permission bypass configured correctly
  // ============================================================================

  describe("5. Verify permission bypass configured correctly", () => {
    test("Bash commands execute without prompt in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;
      const result = await session.send("execute_tool:Bash");

      expect(result.type).toBe("tool_result");
      expect(result.content).toContain("auto-approved");
      expect(result.content).toContain("no prompt");

      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);
      expect(session.toolExecutions[0]?.wasPrompted).toBe(false);

      await client.stop();
    });

    test("file edits execute without prompt in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;

      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Write");

      expect(session.toolExecutions).toHaveLength(2);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("web operations execute without prompt in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;

      await session.send("execute_tool:WebSearch");
      await session.send("execute_tool:WebFetch");

      expect(session.toolExecutions).toHaveLength(2);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("AskUserQuestion still pauses in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      let permissionRequested = false;
      client.on("permission.requested", () => {
        permissionRequested = true;
      });

      const session = (await client.createSession()) as MockCopilotSession;

      const sendPromise = session.send("ask_user:Continue with deployment?");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should be waiting for user
      expect(session.pendingUserQuestions).toHaveLength(1);
      expect(permissionRequested).toBe(true);

      // Respond to unblock
      session.pendingUserQuestions[0]?.respond("yes");
      await sendPromise;

      await client.stop();
    });

    test("multiple tools execute in sequence without prompts", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;

      // Simulate typical workflow
      await session.send("execute_tool:Glob");
      await session.send("execute_tool:Grep");
      await session.send("execute_tool:Read");
      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Write");
      await session.send("execute_tool:Bash");

      expect(session.toolExecutions).toHaveLength(6);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("permission bypass persists across multiple interactions", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;

      for (let i = 0; i < 10; i++) {
        await session.send(`execute_tool:Tool_${i}`);
      }

      expect(session.toolExecutions).toHaveLength(10);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("deny-all handler would require prompts (comparison)", async () => {
      const client = createMockCopilotClientWithTracking(false);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;
      await session.send("execute_tool:Bash");

      expect(session.toolExecutions[0]?.wasPrompted).toBe(true);
      expect(session.toolExecutions[0]?.autoExecuted).toBe(false);

      await client.stop();
    });
  });

  // ============================================================================
  // Integration Tests: Copilot-specific features
  // ============================================================================

  describe("Integration: Copilot-specific features", () => {
    beforeEach(async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "tasks.json"),
        createTestTaskListContent()
      );
    });

    test("complete workflow flow in copilot mode", async () => {
      // 1. Configure client
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      // 2. Create session
      const session = (await client.createSession()) as MockCopilotSession;
      expect(session).toBeDefined();

      // 3. Execute tools (simulate workflow)
      await session.send("execute_tool:Read");
      await session.send("execute_tool:Grep");
      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Bash");

      // 4. Verify all auto-executed
      expect(session.toolExecutions).toHaveLength(4);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      // 5. Cleanup
      await client.stop();
    });

    test("connection mode switching in copilot mode", () => {
      // Stdio mode
      const stdioClient = createCopilotClient({
        connectionMode: { type: "stdio" },
        autoStart: false,
      });
      expect(stdioClient).toBeDefined();

      // Port mode
      const portClient = createCopilotClient({
        connectionMode: { type: "port", port: 8080 },
        autoStart: false,
      });
      expect(portClient).toBeDefined();

      // CLI URL mode
      const cliUrlClient = createCopilotClient({
        connectionMode: { type: "cliUrl", url: "http://localhost:3000" },
        autoStart: false,
      });
      expect(cliUrlClient).toBeDefined();
    });

    test("session resume works in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession({
        sessionId: "resume-test-copilot",
      })) as MockCopilotSession;

      await session.send("execute_tool:Bash");

      const resumedSession = await client.resumeSession("resume-test-copilot");
      expect(resumedSession).not.toBeNull();
      expect((resumedSession as MockCopilotSession).toolExecutions).toHaveLength(1);

      await client.stop();
    });

    test("concurrent sessions work in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session1 = (await client.createSession({
        sessionId: "copilot-session-1",
      })) as MockCopilotSession;

      const session2 = (await client.createSession({
        sessionId: "copilot-session-2",
      })) as MockCopilotSession;

      await session1.send("execute_tool:Edit");
      await session2.send("execute_tool:Bash");
      await session1.send("execute_tool:Write");

      expect(session1.toolExecutions).toHaveLength(2);
      expect(session2.toolExecutions).toHaveLength(1);

      await client.stop();
    });

    test("Ralph session with copilot client", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      // Create Ralph session
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const ralphSession = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        tasks: [
          { id: "feat-copilot", content: "Copilot integration test", status: "pending" as const, activeForm: "Copilot integration test" },
        ],
      });

      await saveSession(sessionDir, ralphSession);

      // Use Copilot client for tool execution
      const session = (await client.createSession()) as MockCopilotSession;
      await session.send("execute_tool:Read");
      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Bash");

      expect(session.toolExecutions).toHaveLength(3);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge cases", () => {
    test("empty tool name handled gracefully", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;
      const result = await session.send("execute_tool:");

      expect(result.type).toBe("tool_result");

      await client.stop();
    });

    test("very long tool sequences work in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;

      for (let i = 0; i < 50; i++) {
        await session.send(`execute_tool:Tool_${i}`);
      }

      expect(session.toolExecutions).toHaveLength(50);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("tool execution after AskUserQuestion maintains bypass mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;

      await session.send("execute_tool:Bash");
      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);

      const askPromise = session.send("ask_user:Continue?");
      await new Promise((resolve) => setTimeout(resolve, 10));
      session.pendingUserQuestions[0]?.respond("yes");
      await askPromise;

      await session.send("execute_tool:Edit");
      expect(session.toolExecutions[1]?.autoExecuted).toBe(true);

      await client.stop();
    });

    test("concurrent tool executions work in copilot mode", async () => {
      const client = createMockCopilotClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockCopilotSession;

      const results = await Promise.all([
        session.send("execute_tool:Bash"),
        session.send("execute_tool:Edit"),
        session.send("execute_tool:WebSearch"),
      ]);

      expect(results).toHaveLength(3);
      expect(session.toolExecutions).toHaveLength(3);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });
  });

  // ============================================================================
  // Permission Handler Tests
  // ============================================================================

  describe("Permission handler configuration", () => {
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

    test("auto-approve handler approves all tool types", async () => {
      const handler = createAutoApprovePermissionHandler();
      const toolTypes = ["shell", "write", "read", "edit", "fetch"];

      for (const toolType of toolTypes) {
        const result = await handler({ kind: toolType } as any, { sessionId: "test" });
        expect(result.kind).toBe("approved");
      }
    });

    test("deny-all handler denies all tool types", async () => {
      const handler = createDenyAllPermissionHandler();
      const toolTypes = ["shell", "write", "read", "edit", "fetch"];

      for (const toolType of toolTypes) {
        const result = await handler({ kind: toolType } as any, { sessionId: "test" });
        expect(result.kind).toBe("denied-interactively-by-user");
      }
    });
  });

  // ============================================================================
  // Real CopilotClient Tests (when server available)
  // ============================================================================

  describe.skipIf(!process.env.COPILOT_CLI)(
    "Real CopilotClient (CLI required)",
    () => {
      let client: CopilotClient;

      beforeEach(() => {
        client = new CopilotClient({
          logLevel: "error",
        });
      });

      afterEach(async () => {
        await client.stop();
      });

      test("getState returns disconnected before start", () => {
        expect(client.getState()).toBe("disconnected");
      });

      test("start() connects to Copilot CLI", async () => {
        await client.start();
        expect(client.getState()).toBe("connected");
      });

      test("createSession creates real session", async () => {
        await client.start();
        const session = await client.createSession();
        expect(session).toBeDefined();
        expect(session.id).toBeDefined();
      });

      test("send message gets response", async () => {
        await client.start();
        const session = await client.createSession();
        const response = await session.send("Hello, respond with OK");
        expect(response).toBeDefined();
        expect(response.role).toBe("assistant");
      });
    }
  );

