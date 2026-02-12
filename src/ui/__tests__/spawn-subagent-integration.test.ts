/**
 * Integration Tests for SubagentGraphBridge
 *
 * Verifies:
 * - Bridge creates sessions via factory, streams, and returns results
 * - Bridge handles session creation failure gracefully
 * - Bridge destroys sessions in finally block
 * - setSubagentBridge/getSubagentBridge singleton pattern
 * - spawnParallel with mixed success/failure
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  SubagentGraphBridge,
  setSubagentBridge,
  getSubagentBridge,
  type CreateSessionFn,
  type SubagentSpawnOptions,
} from "../../graph/subagent-bridge.ts";
import type { Session, AgentMessage, SessionConfig } from "../../sdk/types.ts";

// ============================================================================
// TEST UTILITIES
// ============================================================================

/** Creates a mock Session that streams given messages */
function createMockSession(
  messages: AgentMessage[] = [{ type: "text", content: "done", role: "assistant" }],
  options?: { destroyError?: Error; streamError?: Error }
): Session {
  return {
    id: `session-${Math.random().toString(36).slice(2, 8)}`,
    async send() {
      return { type: "text" as const, content: "ok", role: "assistant" as const };
    },
    stream(_message: string): AsyncIterable<AgentMessage> {
      const msgs = messages;
      const err = options?.streamError;
      return {
        [Symbol.asyncIterator]() {
          let index = 0;
          let errorThrown = false;
          return {
            async next(): Promise<IteratorResult<AgentMessage>> {
              if (err && !errorThrown) {
                errorThrown = true;
                throw err;
              }
              if (index < msgs.length) {
                const value = msgs[index++]!;
                return { done: false, value };
              }
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    async summarize() {},
    async getContextUsage() {
      return { inputTokens: 0, outputTokens: 0, maxTokens: 100000, usagePercentage: 0 };
    },
    getSystemToolsTokens() {
      return 0;
    },
    destroy: options?.destroyError
      ? mock(() => Promise.reject(options.destroyError))
      : mock(() => Promise.resolve()),
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe("SubagentGraphBridge.spawn()", () => {
  let mockCreateSession: ReturnType<typeof mock>;
  let bridge: SubagentGraphBridge;

  beforeEach(() => {
    mockCreateSession = mock(async (_config?: SessionConfig) =>
      createMockSession([
        { type: "text", content: "Research results here", role: "assistant" },
        {
          type: "tool_use",
          content: "Using grep",
          role: "assistant",
          metadata: { toolName: "grep" },
        },
        { type: "text", content: " and more analysis", role: "assistant" },
      ])
    );

    bridge = new SubagentGraphBridge({
      createSession: mockCreateSession as CreateSessionFn,
    });
  });

  test("creates session via factory, streams, and returns result", async () => {
    const options: SubagentSpawnOptions = {
      agentId: "test-agent-1",
      agentName: "Explore",
      task: "Find all error handlers in the codebase",
      systemPrompt: "You are an explorer agent",
      model: "sonnet",
    };

    const result = await bridge.spawn(options);

    // Factory was called
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledWith({
      systemPrompt: "You are an explorer agent",
      model: "sonnet",
    });

    // Result is successful with accumulated text
    expect(result.success).toBe(true);
    expect(result.output).toBe("Research results here and more analysis");
    expect(result.toolUses).toBe(1);
    expect(result.agentId).toBe("test-agent-1");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("handles session creation failure gracefully", async () => {
    const failingFactory = mock(async () => {
      throw new Error("Connection refused");
    });

    const failBridge = new SubagentGraphBridge({
      createSession: failingFactory as CreateSessionFn,
    });

    const result = await failBridge.spawn({
      agentId: "fail-agent",
      agentName: "Broken",
      task: "This will fail",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Connection refused");
    expect(result.agentId).toBe("fail-agent");
  });

  test("maps spawn options to session config correctly", async () => {
    const options: SubagentSpawnOptions = {
      agentId: "mapped-agent",
      agentName: "Plan",
      task: "Plan the implementation",
      systemPrompt: "You are a research agent",
      model: "opus",
      tools: ["grep", "read"],
    };

    const result = await bridge.spawn(options);

    expect(result.success).toBe(true);
    expect(mockCreateSession).toHaveBeenCalledWith({
      systemPrompt: "You are a research agent",
      model: "opus",
      tools: ["grep", "read"],
    });
  });

  test("destroys session after streaming completes", async () => {
    const destroyMock = mock(() => Promise.resolve());
    const mockSession: Session = {
      ...createMockSession([
        { type: "text", content: "done", role: "assistant" },
      ]),
      destroy: destroyMock,
    };
    const factory = mock(async () => mockSession);

    const testBridge = new SubagentGraphBridge({
      createSession: factory as CreateSessionFn,
    });

    await testBridge.spawn({
      agentId: "cleanup-1",
      agentName: "Test",
      task: "Verify cleanup",
    });

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  test("destroys session even when streaming throws", async () => {
    const destroyMock = mock(() => Promise.resolve());
    const session = createMockSession([], {
      streamError: new Error("Connection reset"),
    });
    (session as unknown as { destroy: typeof destroyMock }).destroy = destroyMock;

    const factory = mock(async () => session);
    const testBridge = new SubagentGraphBridge({
      createSession: factory as CreateSessionFn,
    });

    const result = await testBridge.spawn({
      agentId: "stream-fail",
      agentName: "Explorer",
      task: "This will fail mid-stream",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Connection reset");
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});

describe("SubagentGraphBridge.spawnParallel()", () => {
  test("returns results for all agents including mixed success/failure", async () => {
    let callCount = 0;
    const mockFactory = mock(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error("Agent 2 quota exceeded");
      }
      return createMockSession([
        { type: "text", content: "Result from agent", role: "assistant" },
        {
          type: "tool_use",
          content: "Using Bash",
          role: "assistant",
          metadata: { toolName: "Bash" },
        },
        { type: "text", content: " complete", role: "assistant" },
      ]);
    });

    const bridge = new SubagentGraphBridge({
      createSession: mockFactory as CreateSessionFn,
    });

    const results = await bridge.spawnParallel([
      { agentId: "par-1", agentName: "Explore", task: "Task 1" },
      { agentId: "par-2", agentName: "Plan", task: "Task 2" },
      { agentId: "par-3", agentName: "debugger", task: "Task 3" },
    ]);

    expect(results).toHaveLength(3);

    // Agent 1: success
    expect(results[0]?.success).toBe(true);
    expect(results[0]?.output).toBe("Result from agent complete");
    expect(results[0]?.toolUses).toBe(1);

    // Agent 2: failure
    expect(results[1]?.success).toBe(false);
    expect(results[1]?.error).toBe("Agent 2 quota exceeded");

    // Agent 3: success
    expect(results[2]?.success).toBe(true);
    expect(results[2]?.output).toBe("Result from agent complete");
  });
});

describe("SubagentGraphBridge singleton", () => {
  test("setSubagentBridge makes bridge available globally", async () => {
    const mockSession = createMockSession([
      { type: "text", content: "Analysis complete", role: "assistant" },
    ]);
    const createSession: CreateSessionFn = mock(async () => mockSession);

    const bridge = new SubagentGraphBridge({ createSession });

    setSubagentBridge(bridge);
    expect(getSubagentBridge()).toBe(bridge);

    const result = await bridge.spawn({
      agentId: "test-agent",
      agentName: "explore",
      task: "Find files",
    });

    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();

    // Cleanup
    setSubagentBridge(null);
    expect(getSubagentBridge()).toBeNull();
  });

  test("setSubagentBridge(null) clears the global bridge", () => {
    const mockSession = createMockSession();
    const createSession: CreateSessionFn = mock(async () => mockSession);
    const bridge = new SubagentGraphBridge({ createSession });

    setSubagentBridge(bridge);
    expect(getSubagentBridge()).toBe(bridge);

    setSubagentBridge(null);
    expect(getSubagentBridge()).toBeNull();
  });
});

describe("createSubagentSession factory pattern", () => {
  test("factory delegates to client.createSession()", async () => {
    const mockSession = createMockSession();
    const mockClient = {
      createSession: mock(async (_config?: SessionConfig) => mockSession),
    };

    const createSubagentSession = (config?: SessionConfig) =>
      mockClient.createSession(config);

    const session = await createSubagentSession({
      model: "haiku",
      systemPrompt: "test",
    });

    expect(mockClient.createSession).toHaveBeenCalledTimes(1);
    expect(mockClient.createSession).toHaveBeenCalledWith({
      model: "haiku",
      systemPrompt: "test",
    });
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
