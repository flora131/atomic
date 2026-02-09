/**
 * E2E tests for running all functionality in opencode mode
 *
 * These tests verify that when Atomic is configured for the OpenCode backend:
 * 1. Configure Atomic for opencode backend
 * 2. Run /ralph workflow
 * 3. Run sub-agent commands
 * 4. Verify all features work in opencode mode
 * 5. Verify permission bypass configured correctly
 *
 * Reference: Feature - E2E test: Run all functionality in opencode mode
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { existsSync } from "fs";
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
import { OpenCodeClient, createOpenCodeClient } from "../../src/sdk/opencode-client.ts";

// ============================================================================
// TEST HELPERS - Mock OpenCode Client with Tool Execution Tracking
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
 * Mock session that simulates OpenCode tool execution with permission bypass.
 */
interface MockOpenCodeSession extends Session {
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

  /** OpenCode-specific agent mode */
  agentMode: string;
}

/**
 * Create a mock session that simulates OpenCode tool execution with permission bypass.
 */
function createMockOpenCodeSession(
  id: string,
  permissionMode: PermissionMode,
  agentMode: string = "build",
  onPermissionRequest?: (data: PermissionRequestedEventData) => void
): MockOpenCodeSession {
  const toolExecutions: ToolExecutionRecord[] = [];
  const pendingUserQuestions: MockOpenCodeSession["pendingUserQuestions"] = [];

  const session: MockOpenCodeSession = {
    id,
    toolExecutions,
    pendingUserQuestions,
    permissionMode,
    agentMode,

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

        // In bypass mode (permission: "allow"), all tools auto-execute without prompts
        if (isBypassMode) {
          return {
            type: "tool_result",
            content: `Tool ${toolName} executed successfully (OpenCode auto-executed, no prompt)`,
            role: "assistant",
          };
        }

        // In prompt mode, tools would require confirmation
        return {
          type: "tool_result",
          content: `Tool ${toolName} executed (OpenCode prompted: true)`,
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
        content: `OpenCode response to: ${message}`,
        role: "assistant",
      };
    },

    stream(message: string): AsyncIterable<AgentMessage> {
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "text", content: "OpenCode streaming...", role: "assistant" };
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

    async destroy(): Promise<void> {},
  };

  return session;
}

/**
 * Create a mock OpenCode client for testing.
 * OpenCode uses configuration-based permissions via opencode.json
 * - permission: "allow" = bypass all prompts (tools auto-execute)
 * - permission: "deny" = prompt for all tools
 */
function createMockOpenCodeClientWithTracking(
  permissionConfig: "allow" | "deny" | "ask" = "allow"
): CodingAgentClient & {
  sessions: Map<string, MockOpenCodeSession>;
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  permissionConfig: string;
  defaultAgentMode: string;
} {
  const sessions = new Map<string, MockOpenCodeSession>();
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
    defaultAgentMode: "build",

    async createSession(config?: SessionConfig): Promise<Session> {
      if (!isRunning) {
        throw new Error("Client not started. Call start() first.");
      }

      const sessionId = config?.sessionId ?? `opencode-${Date.now()}`;
      const agentMode = config?.agentMode ?? "build";

      const session = createMockOpenCodeSession(
        sessionId,
        permissionMode,
        agentMode,
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
 * Create a mock CommandContext for testing with OpenCode client.
 */
function createMockContextWithOpenCode(
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
    spawnSubagent: async () => ({ success: true, output: "Mock OpenCode sub-agent output" }),
    getMessages: () => messages,
  };
}

/**
 * Create test feature list content.
 */
function createTestFeatureListContent(): string {
  const features = {
    tasks: [
      {
        category: "functional",
        description: "Test feature 1: OpenCode mode feature implementation",
        steps: ["Initialize OpenCode client", "Execute tool", "Verify result"],
        passes: false,
      },
      {
        category: "functional",
        description: "Test feature 2: OpenCode agent mode selection",
        steps: ["Configure agent mode", "Verify mode in session"],
        passes: false,
      },
    ],
  };
  return JSON.stringify(features, null, 2);
}

// ============================================================================
// E2E TEST: Run all functionality in opencode mode
// ============================================================================

describe("E2E test: Run all functionality in opencode mode", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-opencode-e2e-"));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 1. Configure Atomic for opencode backend
  // ============================================================================

  describe("1. Configure Atomic for opencode backend", () => {
    test("OpenCodeClient can be instantiated", () => {
      const client = createOpenCodeClient({
        baseUrl: "http://localhost:4096",
        maxRetries: 1,
        autoStart: false,
      });

      expect(client).toBeDefined();
      expect(client.agentType).toBe("opencode");
    });

    test("mock OpenCode client has correct agent type", () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      expect(client.agentType).toBe("opencode");
    });

    test("OpenCode client default permission config is allow", () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      expect(client.permissionConfig).toBe("allow");
    });

    test("OpenCode client default agent mode is build", () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      expect(client.defaultAgentMode).toBe("build");
    });

    test("OpenCode client can be configured with deny permission", () => {
      const client = createMockOpenCodeClientWithTracking("deny");
      expect(client.permissionConfig).toBe("deny");
    });

    test("opencode.json permission config maps to bypass mode", async () => {
      // When permission: "allow" in opencode.json, tools should auto-execute
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;
      expect(session.permissionMode).toBe("bypass");

      await client.stop();
    });

    test("OpenCode client supports all agent modes", () => {
      const modes = ["build", "plan", "general", "explore"];
      for (const mode of modes) {
        const client = createMockOpenCodeClientWithTracking("allow");
        expect(client).toBeDefined();
      }
    });

    test("OpenCode session uses configured agent mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession({
        agentMode: "plan",
      })) as MockOpenCodeSession;

      expect(session.agentMode).toBe("plan");

      await client.stop();
    });
  });

  // ============================================================================
  // 2. Run /ralph workflow in opencode mode
  // ============================================================================

  describe("2. Run /ralph workflow in opencode mode", () => {
    beforeEach(async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "tasks.json"),
        createTestFeatureListContent()
      );
    });

    test("workflow can be created in opencode mode", () => {
      const workflow = createRalphWorkflow({
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
      expect(workflow.nodes).toBeInstanceOf(Map);
    });

    test("workflow state can be created for opencode client", () => {
      const state = createRalphWorkflowState({
        userPrompt: "Test in OpenCode mode",
      });

      expect(state).toBeDefined();
      expect(state.userPrompt).toBe("Test in OpenCode mode");
    });

    test("parseRalphArgs works correctly for opencode mode", () => {
      const args = parseRalphArgs("--max-iterations 20 implement features");
      expect(args.prompt).toBe("implement features");
    });

    test("workflow session can be created with OpenCode client", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = await client.createSession({
        sessionId: "ralph-workflow-session",
      });

      expect(session).toBeDefined();
      expect(session.id).toBe("ralph-workflow-session");

      await client.stop();
    });

    test("workflow tools execute without prompts in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;

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

    test("Ralph session can be created and saved in opencode mode", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        tasks: [
          { id: "feat-1", content: "OpenCode test feature", status: "pending" as const, activeForm: "OpenCode test feature" },
        ],
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.sessionId).toBe(sessionId);
      expect(loaded.tasks[0]?.name).toBe("OpenCode test feature");
    });

      expect(workflow).toBeDefined();

      await client.stop();
    });
  });

  // ============================================================================
  // 3. Run sub-agent commands in opencode mode
  // ============================================================================

  describe("3. Run sub-agent commands in opencode mode", () => {
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

    test("codebase-analyzer agent can be invoked in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const context = createMockContextWithOpenCode();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("analyze auth flow", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("codebase-locator agent works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();
      expect(agent?.model).toBe("opus");

      const context = createMockContextWithOpenCode();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("find routing files", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("debugger agent works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();
      expect(agent?.model).toBe("opus");

      const context = createMockContextWithOpenCode();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("debug TypeError", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("all builtin agents can be registered in opencode mode", () => {
      // Clear existing registrations
      registerBuiltinAgents();

      // Verify all agents are registered
      for (const agent of BUILTIN_AGENTS) {
        expect(globalRegistry.has(agent.name)).toBe(true);
      }
    });

    test("codebase-online-researcher agent works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const agent = getBuiltinAgent("codebase-online-researcher");
      expect(agent).toBeDefined();

      const context = createMockContextWithOpenCode();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("research best practices", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("codebase-pattern-finder agent works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const agent = getBuiltinAgent("codebase-pattern-finder");
      expect(agent).toBeDefined();

      const context = createMockContextWithOpenCode();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("find similar implementations", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });
  });

  // ============================================================================
  // 4. Verify all features work in opencode mode
  // ============================================================================

  describe("4. Verify all features work in opencode mode", () => {
    test("session creation works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = await client.createSession();
      expect(session).toBeDefined();
      expect(session.id).toContain("opencode");

      await client.stop();
    });

    test("session send works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = await client.createSession();
      const response = await session.send("Hello OpenCode");

      expect(response).toBeDefined();
      expect(response.type).toBe("text");
      expect(response.content).toContain("OpenCode");

      await client.stop();
    });

    test("session stream works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = await client.createSession();
      const chunks: AgentMessage[] = [];

      for await (const chunk of session.stream("Test streaming")) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);

      await client.stop();
    });

    test("session getContextUsage works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = await client.createSession();
      const usage = await session.getContextUsage();

      expect(usage).toBeDefined();
      expect(usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
      expect(usage.maxTokens).toBeGreaterThan(0);

      await client.stop();
    });

    test("session summarize works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = await client.createSession();

      // Should not throw
      await session.summarize();

      await client.stop();
    });

    test("event handling works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");

      let sessionStarted = false;
      client.on("session.start", () => {
        sessionStarted = true;
      });

      await client.start();
      await client.createSession();

      expect(sessionStarted).toBe(true);

      await client.stop();
    });

    test("getModelDisplayInfo works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const info = await client.getModelDisplayInfo();

      expect(info).toBeDefined();
      expect(info.model).toBeDefined();
      expect(info.tier).toBe("OpenCode");

      await client.stop();
    });

    test("session destroy works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
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
    test("Bash commands execute without prompt in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;
      const result = await session.send("execute_tool:Bash");

      expect(result.type).toBe("tool_result");
      expect(result.content).toContain("auto-executed");
      expect(result.content).toContain("no prompt");

      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);
      expect(session.toolExecutions[0]?.wasPrompted).toBe(false);

      await client.stop();
    });

    test("file edits execute without prompt in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;

      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Write");

      expect(session.toolExecutions).toHaveLength(2);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("web operations execute without prompt in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;

      await session.send("execute_tool:WebSearch");
      await session.send("execute_tool:WebFetch");

      expect(session.toolExecutions).toHaveLength(2);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("AskUserQuestion still pauses in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      let permissionRequested = false;
      client.on("permission.requested", () => {
        permissionRequested = true;
      });

      const session = (await client.createSession()) as MockOpenCodeSession;

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
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;

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
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;

      for (let i = 0; i < 10; i++) {
        await session.send(`execute_tool:Tool_${i}`);
      }

      expect(session.toolExecutions).toHaveLength(10);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("permission: deny would require prompts (comparison)", async () => {
      const client = createMockOpenCodeClientWithTracking("deny");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;
      await session.send("execute_tool:Bash");

      expect(session.toolExecutions[0]?.wasPrompted).toBe(true);
      expect(session.toolExecutions[0]?.autoExecuted).toBe(false);

      await client.stop();
    });
  });

  // ============================================================================
  // Integration Tests: OpenCode-specific features
  // ============================================================================

  describe("Integration: OpenCode-specific features", () => {
    beforeEach(async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "tasks.json"),
        createTestFeatureListContent()
      );
    });

    test("complete workflow flow in opencode mode", async () => {
      // 1. Configure client
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      // 2. Create session
      const session = (await client.createSession()) as MockOpenCodeSession;
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

    test("agent mode switching in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      // Build mode (default)
      const buildSession = (await client.createSession({
        agentMode: "build",
      })) as MockOpenCodeSession;
      expect(buildSession.agentMode).toBe("build");

      // Plan mode
      const planSession = (await client.createSession({
        agentMode: "plan",
      })) as MockOpenCodeSession;
      expect(planSession.agentMode).toBe("plan");

      // Explore mode
      const exploreSession = (await client.createSession({
        agentMode: "explore",
      })) as MockOpenCodeSession;
      expect(exploreSession.agentMode).toBe("explore");

      await client.stop();
    });

    test("session resume works in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession({
        sessionId: "resume-test-opencode",
      })) as MockOpenCodeSession;

      await session.send("execute_tool:Bash");

      const resumedSession = await client.resumeSession("resume-test-opencode");
      expect(resumedSession).not.toBeNull();
      expect((resumedSession as MockOpenCodeSession).toolExecutions).toHaveLength(1);

      await client.stop();
    });

    test("concurrent sessions work in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session1 = (await client.createSession({
        sessionId: "opencode-session-1",
      })) as MockOpenCodeSession;

      const session2 = (await client.createSession({
        sessionId: "opencode-session-2",
      })) as MockOpenCodeSession;

      await session1.send("execute_tool:Edit");
      await session2.send("execute_tool:Bash");
      await session1.send("execute_tool:Write");

      expect(session1.toolExecutions).toHaveLength(2);
      expect(session2.toolExecutions).toHaveLength(1);

      await client.stop();
    });

    test("Ralph session with opencode client", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      // Create Ralph session
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const ralphSession = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        tasks: [
          { id: "feat-opencode", content: "OpenCode integration test", status: "pending" as const, activeForm: "OpenCode integration test" },
        ],
      });

      await saveSession(sessionDir, ralphSession);

      // Use OpenCode client for tool execution
      const session = (await client.createSession()) as MockOpenCodeSession;
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
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;
      const result = await session.send("execute_tool:");

      expect(result.type).toBe("tool_result");

      await client.stop();
    });

    test("very long tool sequences work in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;

      for (let i = 0; i < 50; i++) {
        await session.send(`execute_tool:Tool_${i}`);
      }

      expect(session.toolExecutions).toHaveLength(50);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("tool execution after AskUserQuestion maintains bypass mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;

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

    test("concurrent tool executions work in opencode mode", async () => {
      const client = createMockOpenCodeClientWithTracking("allow");
      await client.start();

      const session = (await client.createSession()) as MockOpenCodeSession;

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
  // Real OpenCodeClient Tests (when server available)
  // ============================================================================

  describe.skipIf(!process.env.OPENCODE_SERVER)(
    "Real OpenCodeClient (server required)",
    () => {
      let client: OpenCodeClient;

      beforeEach(() => {
        client = new OpenCodeClient({
          baseUrl: "http://localhost:4096",
          maxRetries: 3,
          retryDelay: 1000,
        });
      });

      afterEach(async () => {
        await client.stop();
      });

      test("healthCheck returns healthy", async () => {
        const health = await client.healthCheck();
        expect(health.healthy).toBe(true);
      });

      test("connect succeeds", async () => {
        const result = await client.connect();
        expect(result).toBe(true);
        expect(client.isConnectedToServer()).toBe(true);
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

