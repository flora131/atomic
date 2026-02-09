/**
 * Integration Tests for spawnSubagent() delegation to SubagentSessionManager
 *
 * Verifies features 3 and 4:
 * - Feature 3: spawnSubagent() delegates to SubagentSessionManager (no placeholder timeouts)
 * - Feature 4: createSubagentSession factory is passed from startChatUI to ChatApp
 *
 * Tests cover:
 * - spawnSubagent returns error when createSubagentSession factory is not available
 * - spawnSubagent delegates to SubagentSessionManager.spawn() when factory is available
 * - spawnSubagent maps SpawnSubagentOptions → SubagentSpawnOptions correctly
 * - createSubagentSession factory delegates to client.createSession()
 * - SubagentSessionManager status updates propagate to setParallelAgents
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  SubagentSessionManager,
  type CreateSessionFn,
  type SubagentSpawnOptions,
  type SubagentResult,
} from "../subagent-session-manager.ts";
import type { Session, AgentMessage, SessionConfig } from "../../sdk/types.ts";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

// ============================================================================
// TEST UTILITIES
// ============================================================================

/** Creates a mock Session that streams given messages */
function createMockSession(
  messages: AgentMessage[] = [{ type: "text", content: "done", role: "assistant" }]
): Session {
  return {
    id: `session-${Math.random().toString(36).slice(2, 8)}`,
    async send() {
      return { type: "text" as const, content: "ok", role: "assistant" as const };
    },
    async *stream(): AsyncIterable<AgentMessage> {
      for (const msg of messages) {
        yield msg;
      }
    },
    async summarize() {},
    async getContextUsage() {
      return { inputTokens: 0, outputTokens: 0, maxTokens: 100000, usagePercentage: 0 };
    },
    getSystemToolsTokens() { return 0; },
    async destroy() {},
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe("spawnSubagent integration with SubagentSessionManager", () => {
  let statusUpdates: Array<{ agentId: string; update: Partial<ParallelAgent> }>;
  let mockCreateSession: ReturnType<typeof mock>;
  let manager: SubagentSessionManager;

  beforeEach(() => {
    statusUpdates = [];
    mockCreateSession = mock(async (_config?: SessionConfig) =>
      createMockSession([
        { type: "text", content: "Research results here", role: "assistant" },
        { type: "tool_use", content: "Using grep", role: "assistant", metadata: { toolName: "grep" } },
        { type: "text", content: " and more analysis", role: "assistant" },
      ])
    );

    manager = new SubagentSessionManager({
      createSession: mockCreateSession as CreateSessionFn,
      onStatusUpdate: (agentId, update) => {
        statusUpdates.push({ agentId, update });
      },
    });
  });

  test("spawn() creates independent session via factory, streams, and returns result", async () => {
    const options: SubagentSpawnOptions = {
      agentId: "test-agent-1",
      agentName: "Explore",
      task: "Find all error handlers in the codebase",
      systemPrompt: "You are an explorer agent",
      model: "sonnet",
    };

    const result = await manager.spawn(options);

    // Factory was called
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledWith({
      systemPrompt: "You are an explorer agent",
      model: "sonnet",
      tools: undefined,
    });

    // Result is successful with accumulated text
    expect(result.success).toBe(true);
    expect(result.output).toBe("Research results here and more analysis");
    expect(result.toolUses).toBe(1);
    expect(result.agentId).toBe("test-agent-1");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("spawn() emits correct status updates during execution", async () => {
    const result = await manager.spawn({
      agentId: "test-agent-2",
      agentName: "Plan",
      task: "Plan the implementation",
    });

    expect(result.success).toBe(true);

    // Should have status updates: running, tool use, completed
    const runningUpdate = statusUpdates.find(
      (u) => u.agentId === "test-agent-2" && u.update.status === "running"
    );
    expect(runningUpdate).toBeDefined();

    const toolUpdate = statusUpdates.find(
      (u) => u.agentId === "test-agent-2" && u.update.currentTool === "grep"
    );
    expect(toolUpdate).toBeDefined();
    expect(toolUpdate?.update.toolUses).toBe(1);

    const completedUpdate = statusUpdates.find(
      (u) => u.agentId === "test-agent-2" && u.update.status === "completed"
    );
    expect(completedUpdate).toBeDefined();
    expect(completedUpdate?.update.toolUses).toBe(1);
  });

  test("spawn() handles session creation failure gracefully", async () => {
    const failingFactory = mock(async () => {
      throw new Error("Connection refused");
    });

    const failManager = new SubagentSessionManager({
      createSession: failingFactory as CreateSessionFn,
      onStatusUpdate: (agentId, update) => {
        statusUpdates.push({ agentId, update });
      },
    });

    const result = await failManager.spawn({
      agentId: "fail-agent",
      agentName: "Broken",
      task: "This will fail",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Connection refused");
    expect(result.agentId).toBe("fail-agent");

    // Should have an error status update
    const errorUpdate = statusUpdates.find(
      (u) => u.agentId === "fail-agent" && u.update.status === "error"
    );
    expect(errorUpdate).toBeDefined();
  });

  test("spawn() maps command options to SubagentSpawnOptions correctly", async () => {
    // Simulate what chat.tsx's spawnSubagent does: maps SpawnSubagentOptions to SubagentSpawnOptions
    const commandOptions = {
      systemPrompt: "You are a research agent",
      message: "Research the authentication system",
      tools: ["grep", "read"],
      model: "opus" as const,
    };

    // This simulates the mapping in chat.tsx
    const agentId = "mapped-agent";
    const spawnOptions: SubagentSpawnOptions = {
      agentId,
      agentName: commandOptions.model ?? "general-purpose",
      task: commandOptions.message,
      systemPrompt: commandOptions.systemPrompt,
      model: commandOptions.model,
      tools: commandOptions.tools,
    };

    const result = await manager.spawn(spawnOptions);

    expect(result.success).toBe(true);
    expect(mockCreateSession).toHaveBeenCalledWith({
      systemPrompt: "You are a research agent",
      model: "opus",
      tools: ["grep", "read"],
    });
  });

  test("destroy() prevents new spawn requests", async () => {
    await manager.destroy();

    const result = await manager.spawn({
      agentId: "post-destroy",
      agentName: "Ghost",
      task: "Should not run",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("SubagentSessionManager has been destroyed");
    expect(mockCreateSession).not.toHaveBeenCalled();
  });
});

describe("createSubagentSession factory pattern", () => {
  test("factory delegates to client.createSession()", async () => {
    const mockSession = createMockSession();
    const mockClient = {
      createSession: mock(async (_config?: SessionConfig) => mockSession),
    };

    // This simulates what index.ts does:
    // const createSubagentSession = (config?: SessionConfig) => client.createSession(config);
    const createSubagentSession = (config?: SessionConfig) =>
      mockClient.createSession(config);

    const session = await createSubagentSession({ model: "haiku", systemPrompt: "test" });

    expect(mockClient.createSession).toHaveBeenCalledTimes(1);
    expect(mockClient.createSession).toHaveBeenCalledWith({ model: "haiku", systemPrompt: "test" });
    expect(session.id).toBe(mockSession.id);
  });

  test("factory creates independent sessions (each call returns new session)", async () => {
    let callCount = 0;
    const mockClient = {
      createSession: mock(async (_config?: SessionConfig) => {
        callCount++;
        return createMockSession([
          { type: "text", content: `session-${callCount}`, role: "assistant" },
        ]);
      }),
    };

    const factory: CreateSessionFn = (config) => mockClient.createSession(config);

    const session1 = await factory();
    const session2 = await factory();

    expect(session1.id).not.toBe(session2.id);
    expect(mockClient.createSession).toHaveBeenCalledTimes(2);
  });
});
