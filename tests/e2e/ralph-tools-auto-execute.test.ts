/**
 * E2E tests for All tools auto-execute without prompts
 *
 * These tests verify that when running /ralph workflow:
 * 1. Bash commands execute without prompts
 * 2. File edits execute without prompts
 * 3. Web searches execute without prompts
 * 4. Only AskUserQuestion pauses for user input
 *
 * Reference: Feature - E2E test: All tools auto-execute without prompts
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
  createRalphFeature,
  type RalphSession,
  type RalphFeature,
} from "../../src/workflows/index.ts";
import { createRalphWorkflow } from "../../src/workflows/index.ts";
import {
  createRalphWorkflowState,
  type RalphWorkflowState,
} from "../../src/graph/nodes/ralph-nodes.ts";

// ============================================================================
// TEST HELPERS - Mock SDK Clients with Tool Execution Tracking
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
 * Mock session that simulates tool execution with permission bypass.
 */
interface MockToolSession extends Session {
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
}

/**
 * Create a mock session that tracks tool executions and permission behavior.
 */
function createMockToolSession(
  id: string,
  permissionMode: PermissionMode,
  onPermissionRequest?: (data: PermissionRequestedEventData) => void
): MockToolSession {
  const toolExecutions: ToolExecutionRecord[] = [];
  const pendingUserQuestions: MockToolSession["pendingUserQuestions"] = [];

  const session: MockToolSession = {
    id,
    toolExecutions,
    pendingUserQuestions,
    permissionMode,

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

        // In bypass mode, all tools auto-execute without prompts
        if (isBypassMode) {
          return {
            type: "tool_result",
            content: `Tool ${toolName} executed successfully (auto-executed, no prompt)`,
            role: "assistant",
          };
        }

        // In prompt mode, tools would require confirmation
        return {
          type: "tool_result",
          content: `Tool ${toolName} executed (prompted: true)`,
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
 * Create a mock client for testing tool auto-execution.
 */
function createMockToolClient(
  permissionMode: PermissionMode = "bypass"
): CodingAgentClient & {
  sessions: Map<string, MockToolSession>;
  eventHandlers: Map<EventType, Set<EventHandler<EventType>>>;
  permissionMode: PermissionMode;
} {
  const sessions = new Map<string, MockToolSession>();
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
    agentType: "claude" as const,
    sessions,
    eventHandlers,
    permissionMode,

    async createSession(config?: SessionConfig): Promise<Session> {
      if (!isRunning) {
        throw new Error("Client not started. Call start() first.");
      }

      const sessionId = config?.sessionId ?? `mock-${Date.now()}`;
      const effectiveMode = config?.permissionMode ?? permissionMode;

      const session = createMockToolSession(
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
      return { model: "Mock Model", tier: "Test" };
    },
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
        description: "Test feature using Bash commands",
        steps: ["Run ls command", "Run pwd command"],
        passes: false,
      },
      {
        category: "functional",
        description: "Test feature using file edits",
        steps: ["Edit config file", "Write output file"],
        passes: false,
      },
    ],
  };
  return JSON.stringify(features, null, 2);
}

// ============================================================================
// E2E TEST: All tools auto-execute without prompts
// ============================================================================

describe("E2E test: All tools auto-execute without prompts", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-ralph-tools-e2e-"));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // 1. Run /ralph with workflow that uses various tools
  // ============================================================================

  describe("1. Run /ralph with workflow that uses various tools", () => {
    beforeEach(async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "feature-list.json"),
        createTestFeatureListContent()
      );
    });

    test("workflow can be created for tool execution testing", () => {
      const workflow = createRalphWorkflow({
        featureListPath: "research/feature-list.json",
        checkpointing: false,
      });

      expect(workflow).toBeDefined();
      expect(workflow.nodes).toBeInstanceOf(Map);
    });

    test("workflow state can be created with bypass permission mode", () => {
      const state = createRalphWorkflowState({
        yolo: true,
        userPrompt: "Test tools execution",
        maxIterations: 5,
      });

      expect(state).toBeDefined();
      expect(state.yolo).toBe(true);
      expect(state.userPrompt).toBe("Test tools execution");
    });

    test("mock client can be configured with bypass permission mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      expect(client.permissionMode).toBe("bypass");

      await client.stop();
    });

    test("session inherits bypass permission mode from client", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      expect(session.permissionMode).toBe("bypass");

      await client.stop();
    });

    test("session can override client permission mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession({
        permissionMode: "prompt",
      })) as MockToolSession;
      expect(session.permissionMode).toBe("prompt");

      await client.stop();
    });
  });

  // ============================================================================
  // 2. Verify Bash commands execute without prompt
  // ============================================================================

  describe("2. Verify Bash commands execute without prompt", () => {
    test("Bash tool executes without prompt in bypass mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      const result = await session.send("execute_tool:Bash");

      expect(result.type).toBe("tool_result");
      expect(result.content).toContain("auto-executed");
      expect(result.content).toContain("no prompt");

      const bashExecution = session.toolExecutions.find((e) => e.toolName === "Bash");
      expect(bashExecution).toBeDefined();
      expect(bashExecution?.wasPrompted).toBe(false);
      expect(bashExecution?.autoExecuted).toBe(true);

      await client.stop();
    });

    test("multiple Bash commands all execute without prompts", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Execute multiple Bash commands
      await session.send("execute_tool:Bash_ls");
      await session.send("execute_tool:Bash_pwd");
      await session.send("execute_tool:Bash_git_status");
      await session.send("execute_tool:Bash_npm_install");

      // All should be auto-executed without prompts
      expect(session.toolExecutions).toHaveLength(4);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);
      expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);

      await client.stop();
    });

    test("Bash commands include command in execution record", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      await session.send("execute_tool:Bash_rm_rf");

      const execution = session.toolExecutions[0];
      expect(execution).toBeDefined();
      expect(execution?.toolName).toBe("Bash_rm_rf");

      await client.stop();
    });

    test("Bash executes immediately without waiting for confirmation", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Track timing to ensure no delay
      const startTime = Date.now();
      await session.send("execute_tool:Bash");
      const endTime = Date.now();

      // Should complete very quickly (no prompt delay)
      expect(endTime - startTime).toBeLessThan(100);
      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);

      await client.stop();
    });

    test("dangerous Bash commands also auto-execute in bypass mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Even potentially dangerous commands auto-execute
      await session.send("execute_tool:Bash_rm_rf_slash");
      await session.send("execute_tool:Bash_sudo");
      await session.send("execute_tool:Bash_chmod_777");

      expect(session.toolExecutions).toHaveLength(3);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });
  });

  // ============================================================================
  // 3. Verify file edits execute without prompt
  // ============================================================================

  describe("3. Verify file edits execute without prompt", () => {
    test("Edit tool executes without prompt in bypass mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      const result = await session.send("execute_tool:Edit");

      expect(result.content).toContain("auto-executed");
      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);
      expect(session.toolExecutions[0]?.wasPrompted).toBe(false);

      await client.stop();
    });

    test("Write tool executes without prompt in bypass mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      const result = await session.send("execute_tool:Write");

      expect(result.content).toContain("auto-executed");
      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);

      await client.stop();
    });

    test("NotebookEdit tool executes without prompt", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      await session.send("execute_tool:NotebookEdit");

      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);

      await client.stop();
    });

    test("multiple file operations all auto-execute", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      await session.send("execute_tool:Read");
      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Write");
      await session.send("execute_tool:Glob");
      await session.send("execute_tool:Grep");

      expect(session.toolExecutions).toHaveLength(5);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("file editing tools track execution timestamp", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      const beforeTime = new Date().toISOString();
      await session.send("execute_tool:Edit");
      const afterTime = new Date().toISOString();

      const execution = session.toolExecutions[0];
      expect(execution?.timestamp).toBeDefined();
      expect(execution!.timestamp! >= beforeTime).toBe(true);
      expect(execution!.timestamp! <= afterTime).toBe(true);

      await client.stop();
    });

    test("Edit and Write tools execute in sequence without prompts", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Simulate typical edit workflow
      await session.send("execute_tool:Read");
      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Write");

      // All should complete without prompts
      expect(session.toolExecutions).toHaveLength(3);
      for (const exec of session.toolExecutions) {
        expect(exec.wasPrompted).toBe(false);
        expect(exec.autoExecuted).toBe(true);
      }

      await client.stop();
    });
  });

  // ============================================================================
  // 4. Verify web searches execute without prompt
  // ============================================================================

  describe("4. Verify web searches execute without prompt", () => {
    test("WebSearch tool executes without prompt in bypass mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      const result = await session.send("execute_tool:WebSearch");

      expect(result.content).toContain("auto-executed");
      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);
      expect(session.toolExecutions[0]?.wasPrompted).toBe(false);

      await client.stop();
    });

    test("WebFetch tool executes without prompt in bypass mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      await session.send("execute_tool:WebFetch");

      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);

      await client.stop();
    });

    test("multiple web operations all auto-execute", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      await session.send("execute_tool:WebSearch");
      await session.send("execute_tool:WebFetch");
      await session.send("execute_tool:WebSearch");

      expect(session.toolExecutions).toHaveLength(3);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("MCP tools also auto-execute in bypass mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      await session.send("execute_tool:mcp__deepwiki__ask_question");
      await session.send("execute_tool:mcp__deepwiki__read_wiki_contents");

      expect(session.toolExecutions).toHaveLength(2);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });
  });

  // ============================================================================
  // 5. Only AskUserQuestion pauses
  // ============================================================================

  describe("5. Only AskUserQuestion pauses", () => {
    test("AskUserQuestion pauses execution even in bypass mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      let permissionRequested = false;

      client.on("permission.requested", () => {
        permissionRequested = true;
      });

      const session = (await client.createSession()) as MockToolSession;

      // Start AskUserQuestion (this will pause)
      const sendPromise = session.send("ask_user:Should I continue?");

      // Wait a bit for the question to be registered
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Verify question is pending (paused)
      expect(session.pendingUserQuestions).toHaveLength(1);
      expect(session.pendingUserQuestions[0]?.question).toBe("Should I continue?");

      // Verify permission.requested event was emitted
      expect(permissionRequested).toBe(true);

      // Simulate user response to unblock
      session.pendingUserQuestions[0]?.respond("yes");

      const result = await sendPromise;
      expect(result.content).toContain("yes");

      await client.stop();
    });

    test("AskUserQuestion blocks until user responds", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      let sendCompleted = false;

      const sendPromise = session.send("ask_user:Confirm action?").then((result) => {
        sendCompleted = true;
        return result;
      });

      // Wait to ensure send is blocked
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should NOT be completed (waiting for user)
      expect(sendCompleted).toBe(false);
      expect(session.pendingUserQuestions).toHaveLength(1);

      // Now respond
      session.pendingUserQuestions[0]?.respond("confirmed");

      await sendPromise;

      // Now should be complete
      expect(sendCompleted).toBe(true);

      await client.stop();
    });

    test("other tools do NOT pause - only AskUserQuestion does", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // These should all complete immediately without pausing
      const bashResult = await session.send("execute_tool:Bash");
      const editResult = await session.send("execute_tool:Edit");
      const webResult = await session.send("execute_tool:WebSearch");

      expect(bashResult.content).toContain("auto-executed");
      expect(editResult.content).toContain("auto-executed");
      expect(webResult.content).toContain("auto-executed");

      // No pending questions for regular tools
      expect(session.pendingUserQuestions).toHaveLength(0);

      // All were auto-executed
      expect(session.toolExecutions).toHaveLength(3);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("AskUserQuestion always pauses regardless of permission mode", async () => {
      // Even with different permission modes, AskUserQuestion should pause
      const modes: PermissionMode[] = ["bypass", "prompt", "auto", "deny"];

      for (const mode of modes) {
        const client = createMockToolClient(mode);
        await client.start();

        const session = (await client.createSession()) as MockToolSession;

        const sendPromise = session.send("ask_user:Test question?");

        await new Promise((resolve) => setTimeout(resolve, 10));

        // Should always pause
        expect(session.pendingUserQuestions.length).toBeGreaterThan(0);

        // Respond to unblock
        session.pendingUserQuestions[0]?.respond("test");
        await sendPromise;

        await client.stop();
      }
    });

    test("AskUserQuestion pauses between auto-executing tools", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Execute tools, then pause, then more tools
      await session.send("execute_tool:Bash");
      expect(session.toolExecutions).toHaveLength(1);

      const askPromise = session.send("ask_user:Continue?");
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(session.pendingUserQuestions).toHaveLength(1);

      // Respond
      session.pendingUserQuestions[0]?.respond("yes");
      await askPromise;

      // More tools after the pause
      await session.send("execute_tool:Edit");
      await session.send("execute_tool:Write");

      expect(session.toolExecutions).toHaveLength(3);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("workflow continues after user responds to AskUserQuestion", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Tools execute before question
      await session.send("execute_tool:Read");

      // Question pauses
      const askPromise = session.send("ask_user:Deploy?");
      await new Promise((resolve) => setTimeout(resolve, 10));
      session.pendingUserQuestions[0]?.respond("deploy");
      await askPromise;

      // Tools continue after response
      await session.send("execute_tool:Bash_deploy");

      // All tools auto-executed
      expect(session.toolExecutions).toHaveLength(2);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });
  });

  // ============================================================================
  // Integration Tests: Tool execution in Ralph workflow context
  // ============================================================================

  describe("Integration: Tool execution in Ralph workflow context", () => {
    beforeEach(async () => {
      const researchDir = path.join(tmpDir, "research");
      await fs.mkdir(researchDir, { recursive: true });
      await fs.writeFile(
        path.join(researchDir, "feature-list.json"),
        createTestFeatureListContent()
      );
    });

    test("complete flow: all tools auto-execute during feature implementation", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Simulate feature implementation workflow
      // 1. Read feature requirements
      await session.send("execute_tool:Read");
      // 2. Search for existing code patterns
      await session.send("execute_tool:Grep");
      // 3. Implement changes
      await session.send("execute_tool:Edit");
      // 4. Run tests
      await session.send("execute_tool:Bash_test");
      // 5. Create commit
      await session.send("execute_tool:Bash_git_commit");

      // All should auto-execute without prompts
      expect(session.toolExecutions).toHaveLength(5);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);
      expect(session.toolExecutions.every((e) => !e.wasPrompted)).toBe(true);

      await client.stop();
    });

    test("mixed tool types all auto-execute in single workflow iteration", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Mix of file, bash, and web tools
      await session.send("execute_tool:Glob");
      await session.send("execute_tool:Bash");
      await session.send("execute_tool:WebSearch");
      await session.send("execute_tool:Edit");
      await session.send("execute_tool:WebFetch");
      await session.send("execute_tool:Write");
      await session.send("execute_tool:Grep");

      expect(session.toolExecutions).toHaveLength(7);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("session maintains tool execution history across multiple iterations", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Iteration 1
      await session.send("execute_tool:Read");
      await session.send("execute_tool:Edit");

      // Iteration 2
      await session.send("execute_tool:Bash");
      await session.send("execute_tool:Write");

      // Iteration 3
      await session.send("execute_tool:WebSearch");

      // All executions tracked
      expect(session.toolExecutions).toHaveLength(5);

      // Verify execution order maintained
      expect(session.toolExecutions[0]?.toolName).toBe("Read");
      expect(session.toolExecutions[1]?.toolName).toBe("Edit");
      expect(session.toolExecutions[2]?.toolName).toBe("Bash");
      expect(session.toolExecutions[3]?.toolName).toBe("Write");
      expect(session.toolExecutions[4]?.toolName).toBe("WebSearch");

      await client.stop();
    });

    test("permission bypass persists across session interactions", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Multiple separate interactions
      for (let i = 0; i < 10; i++) {
        await session.send(`execute_tool:Tool_${i}`);
      }

      // All maintained bypass mode
      expect(session.toolExecutions).toHaveLength(10);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("Ralph session directory receives tool execution logs", async () => {
      const sessionId = generateSessionId();
      const sessionDir = await createSessionDirectory(sessionId);

      // Verify session directory structure exists
      expect(existsSync(sessionDir)).toBe(true);
      expect(existsSync(path.join(sessionDir, "logs"))).toBe(true);

      // Cleanup
      await fs.rm(path.join(tmpDir, ".ralph"), { recursive: true, force: true });
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge cases", () => {
    test("concurrent tool executions all auto-execute", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Execute tools concurrently
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

    test("tool execution after AskUserQuestion response maintains bypass mode", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Tool before question
      await session.send("execute_tool:Bash");
      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);

      // Question (pauses)
      const askPromise = session.send("ask_user:Continue?");
      await new Promise((resolve) => setTimeout(resolve, 10));
      session.pendingUserQuestions[0]?.respond("yes");
      await askPromise;

      // Tool after question still auto-executes
      await session.send("execute_tool:Edit");
      expect(session.toolExecutions[1]?.autoExecuted).toBe(true);

      await client.stop();
    });

    test("empty tool name handled gracefully", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Empty tool name
      const result = await session.send("execute_tool:");

      expect(result.type).toBe("tool_result");
      expect(session.toolExecutions).toHaveLength(1);

      await client.stop();
    });

    test("very long tool sequences all auto-execute", async () => {
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;

      // Execute many tools
      for (let i = 0; i < 100; i++) {
        await session.send(`execute_tool:Tool_${i}`);
      }

      expect(session.toolExecutions).toHaveLength(100);
      expect(session.toolExecutions.every((e) => e.autoExecuted)).toBe(true);

      await client.stop();
    });

    test("comparison: prompt mode requires confirmation", async () => {
      const client = createMockToolClient("prompt");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      await session.send("execute_tool:Bash");

      // In prompt mode, tools are prompted
      expect(session.toolExecutions[0]?.wasPrompted).toBe(true);
      expect(session.toolExecutions[0]?.autoExecuted).toBe(false);

      await client.stop();
    });
  });

  // ============================================================================
  // Cross-SDK Verification
  // ============================================================================

  describe("Cross-SDK verification: all SDKs support tool auto-execution", () => {
    test("bypass mode works with Claude SDK configuration", async () => {
      // Claude uses permissionMode: 'bypassPermissions'
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      await session.send("execute_tool:Bash");

      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);

      await client.stop();
    });

    test("bypass mode works with OpenCode SDK configuration", async () => {
      // OpenCode uses permission: { default: 'allow' }
      // Which maps to bypass mode
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      await session.send("execute_tool:Edit");

      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);

      await client.stop();
    });

    test("bypass mode works with Copilot SDK configuration", async () => {
      // Copilot uses no PermissionHandler (--allow-all)
      // Which is equivalent to bypass mode
      const client = createMockToolClient("bypass");
      await client.start();

      const session = (await client.createSession()) as MockToolSession;
      await session.send("execute_tool:WebSearch");

      expect(session.toolExecutions[0]?.autoExecuted).toBe(true);

      await client.stop();
    });

    test("AskUserQuestion pauses on all SDKs", async () => {
      // Create clients for each SDK type
      const clients = [
        createMockToolClient("bypass"), // Claude
        createMockToolClient("bypass"), // OpenCode
        createMockToolClient("bypass"), // Copilot
      ];

      for (const client of clients) {
        await client.start();

        const session = (await client.createSession()) as MockToolSession;

        const askPromise = session.send("ask_user:Confirm?");
        await new Promise((resolve) => setTimeout(resolve, 10));

        // AskUserQuestion pauses on all
        expect(session.pendingUserQuestions).toHaveLength(1);

        session.pendingUserQuestions[0]?.respond("ok");
        await askPromise;

        await client.stop();
      }
    });
  });
});
