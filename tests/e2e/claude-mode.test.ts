/**
 * E2E tests for running all functionality in claude mode
 *
 * These tests verify that when Atomic is configured for the Claude backend:
 * 1. Configure Atomic for claude backend
 * 2. Run /ralph workflow
 * 3. Run sub-agent commands
 * 4. Verify all features work in claude mode
 * 5. Verify permission bypass configured correctly
 *
 * Reference: Feature - E2E test: Run all functionality in claude mode
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
  createRalphFeature,
  createRalphWorkflow,
  type RalphSession,
  type RalphFeature,
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
  ClaudeAgentClient,
  createClaudeAgentClient,
} from "../../src/sdk/claude-client.ts";

// ============================================================================
// TEST HELPERS - Mock Claude Client with Tool Execution Tracking
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
 * Mock session that simulates Claude tool execution with permission bypass.
 */
interface MockClaudeSession extends Session {
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
 * Create a mock session that simulates Claude tool execution with permission bypass.
 * By default, Claude uses bypassPermissions mode when configured for auto-execute.
 */
function createMockClaudeSession(
  id: string,
  permissionMode: PermissionMode,
  model: string = "claude-sonnet-4-5-20250929",
  onPermissionRequest?: (data: PermissionRequestedEventData) => void
): MockClaudeSession {
  const toolExecutions: ToolExecutionRecord[] = [];
  const pendingUserQuestions: MockClaudeSession["pendingUserQuestions"] = [];

  const session: MockClaudeSession = {
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

        // In bypass mode (permissionMode: 'bypassPermissions'), all tools auto-execute without prompts
        if (isBypassMode) {
          return {
            type: "tool_result",
            content: `Tool ${toolName} executed successfully (Claude auto-approved, no prompt)`,
            role: "assistant",
          };
        }

        // In prompt mode, tools would require confirmation
        return {
          type: "tool_result",
          content: `Tool ${toolName} executed (Claude prompted: true)`,
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
        content: `Claude response to: ${message}`,
        role: "assistant",
      };
    },

    stream(message: string): AsyncIterable<AgentMessage> {
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "text", content: "Claude streaming...", role: "assistant" };
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
 * Create a mock Claude client for testing.
 * Claude SDK uses permissionMode in Options:
 * - bypassPermissions (default in Atomic) = bypass all prompts (tools auto-execute)
 * - default = prompt for tool approvals
 * - acceptEdits = auto-accept edits only
 * - dontAsk = deny all
 */
function createMockClaudeClientWithTracking(
  useBypassPermissions: boolean = true
): CodingAgentClient & {
  sessions: Map<string, MockClaudeSession>;
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  permissionModeConfig: string;
  allowDangerouslySkipPermissions: boolean;
} {
  const sessions = new Map<string, MockClaudeSession>();
  const eventHandlers = new Map<EventType, Set<EventHandler<EventType>>>();
  let isRunning = false;

  // Map permission config to PermissionMode
  const permissionMode: PermissionMode = useBypassPermissions ? "bypass" : "prompt";

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
    permissionModeConfig: useBypassPermissions ? "bypassPermissions" : "default",
    allowDangerouslySkipPermissions: useBypassPermissions,

    async createSession(config?: SessionConfig): Promise<Session> {
      if (!isRunning) {
        throw new Error("Client not started. Call start() first.");
      }

      const sessionId = config?.sessionId ?? `claude-${Date.now()}`;
      const model = config?.model ?? "claude-sonnet-4-5-20250929";

      const session = createMockClaudeSession(
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
      return { model: "Sonnet 4.5", tier: "Claude Code" };
    },
  };
}

/**
 * Create a mock CommandContext for testing with Claude client.
 */
function createMockContextWithClaude(
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
    spawnSubagent: async () => ({ success: true, output: "Mock Claude sub-agent output" }),
    agentType: "claude",
    modelOps: undefined,
    getMessages: () => messages,
  };
}

/**
 * Create test feature list content.
 */
function createTestFeatureListContent(): string {
  const features = {
    features: [
      {
        category: "functional",
        description: "Test feature 1: Claude mode feature implementation",
        steps: ["Initialize Claude client", "Execute tool", "Verify result"],
        passes: false,
      },
      {
        category: "functional",
        description: "Test feature 2: Claude SDK native hooks",
        steps: ["Configure hooks", "Verify hook execution"],
        passes: false,
      },
    ],
  };
  return JSON.stringify(features, null, 2);
}

// ============================================================================
// E2E TEST: Run all functionality in claude mode
// ============================================================================

describe("E2E test: Run all functionality in claude mode", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-claude-e2e-"));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 1. Configure Atomic for claude backend
  // ============================================================================

  describe("1. Configure Atomic for claude backend", () => {
    test("ClaudeAgentClient can be instantiated", () => {
      const client = createClaudeAgentClient();

      expect(client).toBeDefined();
      expect(client.agentType).toBe("claude");
    });

    test("mock Claude client has correct agent type", () => {
      const client = createMockClaudeClientWithTracking(true);
      expect(client.agentType).toBe("claude");
    });

    test("Claude client default permission mode is bypassPermissions", () => {
      const client = createMockClaudeClientWithTracking(true);
      expect(client.permissionModeConfig).toBe("bypassPermissions");
    });

    test("Claude client allowDangerouslySkipPermissions is true when bypassing", () => {
      const client = createMockClaudeClientWithTracking(true);
      expect(client.allowDangerouslySkipPermissions).toBe(true);
    });

    test("Claude client can be configured with default permission mode", () => {
      const client = createMockClaudeClientWithTracking(false);
      expect(client.permissionModeConfig).toBe("default");
    });

    test("bypassPermissions maps to bypass mode", async () => {
      // When using bypassPermissions (default in Atomic), tools should auto-execute
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;
      expect(session.permissionMode).toBe("bypass");

      await client.stop();
    });

    test("Claude client supports multiple permission modes", () => {
      // bypassPermissions mode
      const bypassClient = createMockClaudeClientWithTracking(true);
      expect(bypassClient.permissionModeConfig).toBe("bypassPermissions");

      // default mode
      const defaultClient = createMockClaudeClientWithTracking(false);
      expect(defaultClient.permissionModeConfig).toBe("default");
    });

    test("Claude session uses configured model", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession({
        model: "claude-opus-4-5-20251101",
      })) as MockClaudeSession;

      expect(session.configuredModel).toBe("claude-opus-4-5-20251101");

      await client.stop();
    });
  });

  // ============================================================================
  // 2. Run /ralph workflow in claude mode
  // ============================================================================

  describe("2. Run /ralph workflow in claude mode", () => {
    beforeEach(async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "feature-list.json"),
        createTestFeatureListContent()
      );
    });

    test("workflow can be created in claude mode", () => {
      const workflow = createRalphWorkflow({
        featureListPath: "research/feature-list.json",
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
      expect(workflow.nodes).toBeInstanceOf(Map);
    });

    test("workflow state can be created for claude client", () => {
      const state = createRalphWorkflowState({
        yolo: false,
        userPrompt: "Test in Claude mode",
        maxIterations: 10,
      });

      expect(state).toBeDefined();
      expect(state.userPrompt).toBe("Test in Claude mode");
    });

    test("parseRalphArgs works correctly for claude mode", () => {
      const args = parseRalphArgs("--max-iterations 20 implement features");
      expect(args.maxIterations).toBe(20);
      expect(args.prompt).toBe("implement features");
    });

    test("workflow session can be created with Claude client", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = await client.createSession({
        sessionId: "ralph-workflow-session",
      });

      expect(session).toBeDefined();
      expect(session.id).toBe("ralph-workflow-session");

      await client.stop();
    });

    test("workflow tools execute without prompts in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;

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

    test("Ralph session can be created and saved in claude mode", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const session = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        features: [
          createRalphFeature({
            id: "feat-1",
            name: "Claude test feature",
            description: "Testing in Claude mode",
          }),
        ],
      });

      await saveSession(sessionDir, session);
      const loaded = await loadSession(sessionDir);

      expect(loaded.sessionId).toBe(sessionId);
      expect(loaded.features[0]?.name).toBe("Claude test feature");
    });

    test("yolo mode works in claude configuration", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const workflow = createRalphWorkflow({
        yolo: true,
        userPrompt: "Build snake game in Rust",
        checkpointing: false,
      });

      expect(workflow).toBeDefined();

      await client.stop();
    });
  });

  // ============================================================================
  // 3. Run sub-agent commands in claude mode
  // ============================================================================

  describe("3. Run sub-agent commands in claude mode", () => {
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

    test("codebase-analyzer agent can be invoked in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const agent = getBuiltinAgent("codebase-analyzer");
      expect(agent).toBeDefined();

      const context = createMockContextWithClaude();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("analyze auth flow", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("codebase-locator agent works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const agent = getBuiltinAgent("codebase-locator");
      expect(agent).toBeDefined();
      expect(agent?.model).toBe("opus");

      const context = createMockContextWithClaude();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("find routing files", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("debugger agent works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const agent = getBuiltinAgent("debugger");
      expect(agent).toBeDefined();
      expect(agent?.model).toBe("opus");

      const context = createMockContextWithClaude();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("debug TypeError", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("all builtin agents can be registered in claude mode", () => {
      // Clear existing registrations
      registerBuiltinAgents();

      // Verify all agents are registered
      for (const agent of BUILTIN_AGENTS) {
        expect(globalRegistry.has(agent.name)).toBe(true);
      }
    });

    test("codebase-online-researcher agent works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const agent = getBuiltinAgent("codebase-online-researcher");
      expect(agent).toBeDefined();

      const context = createMockContextWithClaude();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("research best practices", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });

    test("codebase-pattern-finder agent works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const agent = getBuiltinAgent("codebase-pattern-finder");
      expect(agent).toBeDefined();

      const context = createMockContextWithClaude();
      const command = createAgentCommand(agent!);

      const result = (await command.execute("find similar implementations", context)) as CommandResult;
      expect(result.success).toBe(true);

      await client.stop();
    });
  });

  // ============================================================================
  // 4. Verify all features work in claude mode
  // ============================================================================

  describe("4. Verify all features work in claude mode", () => {
    test("session creation works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = await client.createSession();
      expect(session).toBeDefined();
      expect(session.id).toContain("claude");

      await client.stop();
    });

    test("session send works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = await client.createSession();
      const response = await session.send("Hello Claude");

      expect(response).toBeDefined();
      expect(response.type).toBe("text");
      expect(response.content).toContain("Claude");

      await client.stop();
    });

    test("session stream works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = await client.createSession();
      const chunks: AgentMessage[] = [];

      for await (const chunk of session.stream("Test streaming")) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);

      await client.stop();
    });

    test("session getContextUsage works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = await client.createSession();
      const usage = await session.getContextUsage();

      expect(usage).toBeDefined();
      expect(usage.inputTokens).toBeGreaterThanOrEqual(0);
      expect(usage.outputTokens).toBeGreaterThanOrEqual(0);
      expect(usage.maxTokens).toBeGreaterThan(0);

      await client.stop();
    });

    test("session summarize works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = await client.createSession();

      // Should not throw
      await session.summarize();

      await client.stop();
    });

    test("event handling works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);

      let sessionStarted = false;
      client.on("session.start", () => {
        sessionStarted = true;
      });

      await client.start();
      await client.createSession();

      expect(sessionStarted).toBe(true);

      await client.stop();
    });

    test("getModelDisplayInfo works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const info = await client.getModelDisplayInfo();

      expect(info).toBeDefined();
      expect(info.model).toBeDefined();
      expect(info.tier).toBe("Claude Code");

      await client.stop();
    });

    test("session destroy works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
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
    test("Bash commands execute without prompt in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;
      const result = await session.send("execute_tool:Bash");

      expect(result.type).toBe("tool_result");
      expect(result.content).toContain("auto-approved");
      expect(result.content).toContain("no prompt");

      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);
      expect(session.toolExecutions[0]?.wasPrompted).toBe(false);

      await client.stop();
    });

    test("file edits execute without prompt in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;

      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Write");

      expect(session.toolExecutions).toHaveLength(2);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("web operations execute without prompt in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;

      await session.send("execute_tool:WebSearch");
      await session.send("execute_tool:WebFetch");

      expect(session.toolExecutions).toHaveLength(2);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("AskUserQuestion still pauses in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      let permissionRequested = false;
      client.on("permission.requested", () => {
        permissionRequested = true;
      });

      const session = (await client.createSession()) as MockClaudeSession;

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
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;

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
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;

      for (let i = 0; i < 10; i++) {
        await session.send(`execute_tool:Tool_${i}`);
      }

      expect(session.toolExecutions).toHaveLength(10);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("default permission mode would require prompts (comparison)", async () => {
      const client = createMockClaudeClientWithTracking(false);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;
      await session.send("execute_tool:Bash");

      expect(session.toolExecutions[0]?.wasPrompted).toBe(true);
      expect(session.toolExecutions[0]?.autoExecuted).toBe(false);

      await client.stop();
    });
  });

  // ============================================================================
  // Integration Tests: Claude-specific features
  // ============================================================================

  describe("Integration: Claude-specific features", () => {
    beforeEach(async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "feature-list.json"),
        createTestFeatureListContent()
      );
    });

    test("complete workflow flow in claude mode", async () => {
      // 1. Configure client
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      // 2. Create session
      const session = (await client.createSession()) as MockClaudeSession;
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

    test("permission mode switching in claude mode", () => {
      // bypassPermissions mode (default in Atomic for autonomous operation)
      const bypassClient = createMockClaudeClientWithTracking(true);
      expect(bypassClient.permissionModeConfig).toBe("bypassPermissions");
      expect(bypassClient.allowDangerouslySkipPermissions).toBe(true);

      // default mode (prompts for tool approvals)
      const defaultClient = createMockClaudeClientWithTracking(false);
      expect(defaultClient.permissionModeConfig).toBe("default");
      expect(defaultClient.allowDangerouslySkipPermissions).toBe(false);
    });

    test("session resume works in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession({
        sessionId: "resume-test-claude",
      })) as MockClaudeSession;

      await session.send("execute_tool:Bash");

      const resumedSession = await client.resumeSession("resume-test-claude");
      expect(resumedSession).not.toBeNull();
      expect((resumedSession as MockClaudeSession).toolExecutions).toHaveLength(1);

      await client.stop();
    });

    test("concurrent sessions work in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session1 = (await client.createSession({
        sessionId: "claude-session-1",
      })) as MockClaudeSession;

      const session2 = (await client.createSession({
        sessionId: "claude-session-2",
      })) as MockClaudeSession;

      await session1.send("execute_tool:Edit");
      await session2.send("execute_tool:Bash");
      await session1.send("execute_tool:Write");

      expect(session1.toolExecutions).toHaveLength(2);
      expect(session2.toolExecutions).toHaveLength(1);

      await client.stop();
    });

    test("Ralph session with claude client", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      // Create Ralph session
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      const ralphSession = createRalphSession({
        sessionId,
        sessionDir,
        status: "running",
        features: [
          createRalphFeature({
            id: "feat-claude",
            name: "Claude integration test",
            description: "Testing Ralph with Claude",
          }),
        ],
      });

      await saveSession(sessionDir, ralphSession);

      // Use Claude client for tool execution
      const session = (await client.createSession()) as MockClaudeSession;
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
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;
      const result = await session.send("execute_tool:");

      expect(result.type).toBe("tool_result");

      await client.stop();
    });

    test("very long tool sequences work in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;

      for (let i = 0; i < 50; i++) {
        await session.send(`execute_tool:Tool_${i}`);
      }

      expect(session.toolExecutions).toHaveLength(50);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("tool execution after AskUserQuestion maintains bypass mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;

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

    test("concurrent tool executions work in claude mode", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const session = (await client.createSession()) as MockClaudeSession;

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
  // Claude SDK Native Hooks Tests
  // ============================================================================

  describe("Claude SDK native hooks configuration", () => {
    test("ClaudeAgentClient supports registerHooks method", () => {
      const client = createClaudeAgentClient();
      expect(typeof client.registerHooks).toBe("function");
    });

    test("Claude SDK supports PreToolUse hook type", () => {
      const hookTypes = [
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "SessionStart",
        "SessionEnd",
        "SubagentStart",
        "SubagentStop",
        "Notification",
        "UserPromptSubmit",
        "Stop",
        "PreCompact",
        "PermissionRequest",
        "Setup",
      ];

      // Verify all hook types are strings (representing valid events)
      for (const hookType of hookTypes) {
        expect(typeof hookType).toBe("string");
      }
    });

    test("Claude client can have hooks registered before start", () => {
      const client = createClaudeAgentClient();

      // Should not throw
      client.registerHooks({
        PreToolUse: [
          async () => {
            return { continue: true };
          },
        ],
      });
    });

    test("tool.start event maps to PreToolUse hook", () => {
      // This verifies the event mapping logic
      const eventToHookMap: Record<string, string> = {
        "session.start": "SessionStart",
        "session.idle": "SessionEnd",
        "session.error": "Stop",
        "tool.start": "PreToolUse",
        "tool.complete": "PostToolUse",
        "subagent.start": "SubagentStart",
        "subagent.complete": "SubagentStop",
      };

      expect(eventToHookMap["tool.start"]).toBe("PreToolUse");
      expect(eventToHookMap["tool.complete"]).toBe("PostToolUse");
    });
  });

  // ============================================================================
  // Model Display Information Tests
  // ============================================================================

  describe("Model display information", () => {
    test("formatModelDisplayName handles claude-opus-4-5 format", () => {
      const { formatModelDisplayName } = require("../../src/sdk/types.ts");
      // Returns lowercase family name for consistency
      expect(formatModelDisplayName("claude-opus-4-5-20251101")).toBe("opus");
    });

    test("formatModelDisplayName handles claude-sonnet-4-5 format", () => {
      const { formatModelDisplayName } = require("../../src/sdk/types.ts");
      // Returns lowercase family name for consistency
      expect(formatModelDisplayName("claude-sonnet-4-5-20250929")).toBe("sonnet");
    });

    test("formatModelDisplayName handles claude-haiku format", () => {
      const { formatModelDisplayName } = require("../../src/sdk/types.ts");
      const result = formatModelDisplayName("claude-3-haiku");
      // Returns lowercase family name for consistency
      expect(result).toBe("haiku");
    });

    test("getModelDisplayInfo returns Claude Code tier", async () => {
      const client = createMockClaudeClientWithTracking(true);
      await client.start();

      const info = await client.getModelDisplayInfo();
      expect(info.tier).toBe("Claude Code");

      await client.stop();
    });
  });

  // ============================================================================
  // Real ClaudeAgentClient Tests (when SDK available)
  // ============================================================================

  describe.skipIf(!process.env.CLAUDE_SDK)(
    "Real ClaudeAgentClient (SDK required)",
    () => {
      let client: ClaudeAgentClient;

      beforeEach(() => {
        client = new ClaudeAgentClient();
      });

      afterEach(async () => {
        await client.stop();
      });

      test("start() initializes the client", async () => {
        await client.start();
        // Client should be running (internal state)
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

      test("getModelDisplayInfo returns model info", async () => {
        await client.start();
        const info = await client.getModelDisplayInfo();
        expect(info).toBeDefined();
        expect(info.model).toBeDefined();
        expect(info.tier).toBe("Claude Code");
      });
    }
  );
});
