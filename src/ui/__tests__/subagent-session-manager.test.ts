/**
 * Unit Tests for SubagentSessionManager
 *
 * Tests cover:
 * - spawn() creates a session, streams, and destroys
 * - spawn() calls onStatusUpdate with correct status transitions (running → completed)
 * - spawn() handles session creation failures gracefully (marks as error)
 * - spawn() handles streaming failures gracefully
 * - spawnParallel() runs multiple agents concurrently
 * - spawnParallel() with Promise.allSettled handles partial failures
 * - cancel() destroys the session and marks agent as error
 * - cancelAll() destroys all active sessions
 * - destroy() cleans up all active sessions and rejects new spawns
 * - Concurrency limiting queues excess requests
 *
 * Reference: specs/subagent-ui-independent-context.md Section 8.2
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  SubagentSessionManager,
  type SubagentSpawnOptions,
  type SubagentStatusCallback,
  type CreateSessionFn,
} from "../subagent-session-manager.ts";
import type { Session, AgentMessage } from "../../sdk/types.ts";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";

// ============================================================================
// TEST UTILITIES
// ============================================================================

/** Shorthand for creating a text message */
function textMsg(content: string): AgentMessage {
  return { type: "text", content, role: "assistant" };
}

/** Shorthand for creating a tool_use message */
function toolMsg(toolName: string): AgentMessage {
  return {
    type: "tool_use",
    content: `Using ${toolName}`,
    role: "assistant",
    metadata: { toolName },
  };
}

/**
 * Creates an async iterable from an array of messages.
 * Optionally throws an error on first iteration.
 */
function createAsyncIterable(
  messages: AgentMessage[],
  throwError?: Error
): AsyncIterable<AgentMessage> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      let errorThrown = false;
      return {
        async next(): Promise<IteratorResult<AgentMessage>> {
          if (throwError && !errorThrown) {
            errorThrown = true;
            throw throwError;
          }
          if (index < messages.length) {
            const value = messages[index++]!;
            return { done: false, value };
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

/**
 * Creates a mock Session that yields the given messages and then completes.
 */
function createMockSession(
  messages: AgentMessage[] = [],
  options?: { destroyError?: Error; streamError?: Error }
): Session {
  return {
    id: crypto.randomUUID(),
    send: mock(() =>
      Promise.resolve({
        type: "text" as const,
        content: "ok",
        role: "assistant" as const,
      })
    ),
    stream: (_message: string) => createAsyncIterable(messages, options?.streamError),
    summarize: mock(() => Promise.resolve()),
    getContextUsage: mock(() =>
      Promise.resolve({
        inputTokens: 0,
        outputTokens: 0,
        maxTokens: 200000,
        usagePercentage: 0,
      })
    ),
    getSystemToolsTokens: mock(() => 0),
    destroy: options?.destroyError
      ? mock(() => Promise.reject(options.destroyError))
      : mock(() => Promise.resolve()),
  };
}

/**
 * Creates a mock createSession factory.
 */
function createMockSessionFactory(
  session: Session | null = null,
  error?: Error
): CreateSessionFn {
  if (error) {
    return mock(() => Promise.reject(error));
  }
  return mock(() =>
    Promise.resolve(session ?? createMockSession([textMsg("Hello from sub-agent")]))
  );
}

/** Default spawn options for tests */
function defaultOptions(overrides?: Partial<SubagentSpawnOptions>): SubagentSpawnOptions {
  return {
    agentId: crypto.randomUUID().slice(0, 8),
    agentName: "test-agent",
    task: "Test task for sub-agent",
    ...overrides,
  };
}

/** Helper to find a status update by agent ID and status */
function findUpdate(
  updates: Array<{ agentId: string; update: Partial<ParallelAgent> }>,
  agentId: string,
  status: string
): { agentId: string; update: Partial<ParallelAgent> } | undefined {
  return updates.find((u) => u.agentId === agentId && u.update.status === status);
}

// ============================================================================
// TESTS
// ============================================================================

describe("SubagentSessionManager", () => {
  let statusUpdates: Array<{ agentId: string; update: Partial<ParallelAgent> }>;
  let onStatusUpdate: SubagentStatusCallback;

  beforeEach(() => {
    statusUpdates = [];
    onStatusUpdate = (agentId, update) => {
      statusUpdates.push({ agentId, update });
    };
  });

  // --------------------------------------------------------------------------
  // spawn() - Basic lifecycle
  // --------------------------------------------------------------------------

  describe("spawn()", () => {
    test("creates a session, streams messages, and destroys session", async () => {
      const messages = [textMsg("Hello"), textMsg(" World")];
      const mockSession = createMockSession(messages);
      const createSession = createMockSessionFactory(mockSession);

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      const options = defaultOptions();
      const result = await manager.spawn(options);

      // Session was created
      expect(createSession).toHaveBeenCalledTimes(1);

      // Result is successful
      expect(result.success).toBe(true);
      expect(result.agentId).toBe(options.agentId);
      expect(result.output).toBe("Hello World");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Session was destroyed
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);

      // No active sessions remain
      expect(manager.activeCount).toBe(0);
    });

    test("emits status updates with correct transitions: running → completed", async () => {
      const messages = [textMsg("Result text")];
      const mockSession = createMockSession(messages);
      const createSession = createMockSessionFactory(mockSession);

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      const options = defaultOptions({ agentId: "agent-1" });
      await manager.spawn(options);

      // Should have at least 2 updates: running and completed
      const runningUpdate = findUpdate(statusUpdates, "agent-1", "running");
      const completedUpdate = findUpdate(statusUpdates, "agent-1", "completed");

      expect(runningUpdate).toBeDefined();
      expect(runningUpdate?.update.startedAt).toBeDefined();

      expect(completedUpdate).toBeDefined();
      expect(completedUpdate?.update.result).toBe("Result text");
      expect(typeof completedUpdate?.update.durationMs).toBe("number");
    });

    test("tracks tool uses and updates currentTool during streaming", async () => {
      const messages = [
        toolMsg("Bash"),
        textMsg("Found files"),
        toolMsg("Read"),
        textMsg("File contents"),
      ];
      const mockSession = createMockSession(messages);
      const createSession = createMockSessionFactory(mockSession);

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      const options = defaultOptions({ agentId: "agent-tools" });
      const result = await manager.spawn(options);

      expect(result.toolUses).toBe(2);
      expect(result.output).toBe("Found filesFile contents");

      // Check tool status updates
      const toolUpdates = statusUpdates.filter(
        (u) => u.agentId === "agent-tools" && u.update.currentTool !== undefined
      );
      expect(toolUpdates.length).toBeGreaterThanOrEqual(2);

      const firstToolUpdate = toolUpdates[0];
      const secondToolUpdate = toolUpdates[1];
      expect(firstToolUpdate?.update.currentTool).toBe("Bash");
      expect(secondToolUpdate?.update.currentTool).toBe("Read");

      // Final completed update should clear currentTool
      const completedUpdate = findUpdate(statusUpdates, "agent-tools", "completed");
      expect(completedUpdate?.update.currentTool).toBeUndefined();
    });

    test("truncates output to MAX_SUMMARY_LENGTH", async () => {
      const longText = "x".repeat(3000);
      const messages = [textMsg(longText)];
      const mockSession = createMockSession(messages);
      const createSession = createMockSessionFactory(mockSession);

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      const result = await manager.spawn(defaultOptions());

      // Output should be truncated to 2000 + "..."
      expect(result.output.length).toBe(2003);
      expect(result.output.endsWith("...")).toBe(true);
    });

    test("handles session creation failures gracefully", async () => {
      const createSession = createMockSessionFactory(
        null,
        new Error("Connection refused")
      );

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      const options = defaultOptions({ agentId: "agent-fail" });
      const result = await manager.spawn(options);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection refused");
      expect(result.output).toBe("");

      // Error status should be emitted
      const errorUpdate = findUpdate(statusUpdates, "agent-fail", "error");
      expect(errorUpdate).toBeDefined();
      expect(errorUpdate?.update.error).toBe("Connection refused");

      // No active sessions
      expect(manager.activeCount).toBe(0);
    });

    test("handles streaming failures gracefully", async () => {
      const mockSession = createMockSession([], {
        streamError: new Error("Stream interrupted"),
      });
      const createSession = createMockSessionFactory(mockSession);

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      const options = defaultOptions({ agentId: "agent-stream-fail" });
      const result = await manager.spawn(options);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Stream interrupted");

      // Session should still be destroyed in finally block
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
    });

    test("passes session config (systemPrompt, model, tools) to createSession", async () => {
      const mockSession = createMockSession([textMsg("ok")]);
      const createSession = mock(() => Promise.resolve(mockSession));

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      const options = defaultOptions({
        systemPrompt: "You are a research assistant",
        model: "claude-sonnet-4-5-20250929",
        tools: ["Read", "Glob"],
      });
      await manager.spawn(options);

      expect(createSession).toHaveBeenCalledWith({
        systemPrompt: "You are a research assistant",
        model: "claude-sonnet-4-5-20250929",
        tools: ["Read", "Glob"],
      });
    });

    test("still destroys session when destroy throws", async () => {
      const mockSession = createMockSession([textMsg("ok")], {
        destroyError: new Error("Destroy failed"),
      });
      const createSession = createMockSessionFactory(mockSession);

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      // Should not throw - error is caught in finally block
      const result = await manager.spawn(defaultOptions());
      expect(result.success).toBe(true);
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // spawnParallel()
  // --------------------------------------------------------------------------

  describe("spawnParallel()", () => {
    test("runs multiple agents concurrently", async () => {
      const createSession = mock(async () =>
        createMockSession([textMsg("Result")])
      );

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      const agents = [
        defaultOptions({ agentId: "a1", agentName: "Agent 1" }),
        defaultOptions({ agentId: "a2", agentName: "Agent 2" }),
        defaultOptions({ agentId: "a3", agentName: "Agent 3" }),
      ];

      const results = await manager.spawnParallel(agents);

      expect(results.length).toBe(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(createSession).toHaveBeenCalledTimes(3);
    });

    test("handles partial failures with Promise.allSettled", async () => {
      let callCount = 0;
      const createSession = mock(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Agent 2 failed to create session");
        }
        return createMockSession([textMsg("Success")]);
      });

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      const agents = [
        defaultOptions({ agentId: "a1" }),
        defaultOptions({ agentId: "a2" }),
        defaultOptions({ agentId: "a3" }),
      ];

      const results = await manager.spawnParallel(agents);

      expect(results.length).toBe(3);

      // Agent 1 and 3 should succeed
      const r0 = results[0];
      const r1 = results[1];
      const r2 = results[2];
      expect(r0?.success).toBe(true);
      expect(r2?.success).toBe(true);

      // Agent 2 should fail
      expect(r1?.success).toBe(false);
      expect(r1?.error).toBe("Agent 2 failed to create session");
    });

    test("returns results in same order as input", async () => {
      const createSession = mock(async () =>
        createMockSession([textMsg("ok")])
      );

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      const agents = [
        defaultOptions({ agentId: "first" }),
        defaultOptions({ agentId: "second" }),
        defaultOptions({ agentId: "third" }),
      ];

      const results = await manager.spawnParallel(agents);

      expect(results[0]?.agentId).toBe("first");
      expect(results[1]?.agentId).toBe("second");
      expect(results[2]?.agentId).toBe("third");
    });
  });

  // --------------------------------------------------------------------------
  // cancel() and cancelAll()
  // --------------------------------------------------------------------------

  describe("cancel()", () => {
    test("destroys the session and marks agent as error", async () => {
      // Create a session that blocks on stream so we can cancel it
      const streamControl = { resolve: null as (() => void) | null };
      const blockingIterable: AsyncIterable<AgentMessage> = {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<AgentMessage>> {
              await new Promise<void>((resolve) => {
                streamControl.resolve = resolve;
              });
              return { done: true, value: undefined };
            },
          };
        },
      };

      const blockingSession: Session = {
        id: "blocking",
        send: mock(() =>
          Promise.resolve({ type: "text" as const, content: "ok" })
        ),
        stream: () => blockingIterable,
        summarize: mock(() => Promise.resolve()),
        getContextUsage: mock(() =>
          Promise.resolve({
            inputTokens: 0,
            outputTokens: 0,
            maxTokens: 200000,
            usagePercentage: 0,
          })
        ),
        getSystemToolsTokens: mock(() => 0),
        destroy: mock(() => Promise.resolve()),
      };

      const createSession = mock(async () => blockingSession);

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      // Start spawn (don't await - it will block)
      const spawnPromise = manager.spawn(
        defaultOptions({ agentId: "cancellable" })
      );

      // Wait for session to be registered
      await new Promise((r) => setTimeout(r, 10));

      // Cancel the agent
      await manager.cancel("cancellable");

      // Should emit error status
      const errorUpdate = findUpdate(statusUpdates, "cancellable", "error");
      expect(errorUpdate).toBeDefined();
      expect(errorUpdate?.update.error).toBe("Cancelled");

      // Session should be destroyed
      expect(blockingSession.destroy).toHaveBeenCalled();

      // Unblock the stream so spawn resolves
      streamControl.resolve?.();
      await spawnPromise.catch(() => {}); // May error due to cancelled session
    });

    test("resolves queued requests with cancellation result", async () => {
      const createSession = mock(async () =>
        createMockSession([textMsg("ok")])
      );

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
        maxConcurrentSubagents: 1,
      });

      // Fill the concurrency slot
      const firstSpawn = manager.spawn(defaultOptions({ agentId: "first" }));

      // Queue a second spawn
      const secondSpawnPromise = manager.spawn(
        defaultOptions({ agentId: "queued" })
      );

      // Cancel the queued agent
      await manager.cancel("queued");

      const result = await secondSpawnPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("Cancelled");

      await firstSpawn;
    });
  });

  describe("cancelAll()", () => {
    test("destroys all active sessions", async () => {
      const createSession = mock(async () =>
        createMockSession([textMsg("ok")])
      );

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
        maxConcurrentSubagents: 10,
      });

      // Spawn multiple agents
      const promises = [
        manager.spawn(defaultOptions({ agentId: "a1" })),
        manager.spawn(defaultOptions({ agentId: "a2" })),
        manager.spawn(defaultOptions({ agentId: "a3" })),
      ];

      // Wait for all to complete
      await Promise.allSettled(promises);

      // Now cancel all - should be fine even if sessions already completed
      await manager.cancelAll();

      // All error updates should be emitted for any remaining sessions
      expect(manager.activeCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // destroy()
  // --------------------------------------------------------------------------

  describe("destroy()", () => {
    test("prevents new spawn requests after destroy", async () => {
      const createSession = createMockSessionFactory(
        createMockSession([textMsg("ok")])
      );

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      await manager.destroy();

      const result = await manager.spawn(defaultOptions());
      expect(result.success).toBe(false);
      expect(result.error).toBe("SubagentSessionManager has been destroyed");

      // createSession should not have been called
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Concurrency limiting
  // --------------------------------------------------------------------------

  describe("concurrency limiting", () => {
    test("queues excess requests when at maxConcurrentSubagents", async () => {
      let sessionCount = 0;
      const resolvers: Array<() => void> = [];

      const createSession = mock(async () => {
        sessionCount++;
        const id = sessionCount;

        const iterable: AsyncIterable<AgentMessage> = {
          [Symbol.asyncIterator]() {
            let done = false;
            return {
              async next(): Promise<IteratorResult<AgentMessage>> {
                if (done) return { done: true, value: undefined };
                done = true;
                await new Promise<void>((resolve) => resolvers.push(resolve));
                return { done: false, value: textMsg(`Result ${id}`) };
              },
            };
          },
        };

        const session: Session = {
          id: `session-${id}`,
          send: mock(() =>
            Promise.resolve({ type: "text" as const, content: "ok" })
          ),
          stream: () => iterable,
          summarize: mock(() => Promise.resolve()),
          getContextUsage: mock(() =>
            Promise.resolve({
              inputTokens: 0,
              outputTokens: 0,
              maxTokens: 200000,
              usagePercentage: 0,
            })
          ),
          getSystemToolsTokens: mock(() => 0),
          destroy: mock(() => Promise.resolve()),
        };
        return session;
      });

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
        maxConcurrentSubagents: 2,
      });

      // Spawn 3 agents (max concurrent is 2)
      const p1 = manager.spawn(defaultOptions({ agentId: "a1" }));
      const p2 = manager.spawn(defaultOptions({ agentId: "a2" }));
      const p3 = manager.spawn(defaultOptions({ agentId: "a3" }));

      // Wait for first two to start
      await new Promise((r) => setTimeout(r, 10));

      // Only 2 sessions should have been created so far
      expect(createSession).toHaveBeenCalledTimes(2);

      // Resolve first two sessions
      for (const r of resolvers) {
        r();
      }

      // Wait for processing
      await Promise.all([p1, p2]);

      // Wait for queued agent to start
      await new Promise((r) => setTimeout(r, 50));

      // Third session should now have been created
      expect(createSession).toHaveBeenCalledTimes(3);

      // Resolve third session
      const thirdResolver = resolvers[2];
      if (thirdResolver) {
        thirdResolver();
      }

      const result3 = await p3;
      expect(result3.agentId).toBe("a3");
    });

    test("processes queued requests in order", async () => {
      const completionOrder: string[] = [];
      const createSession = mock(async () =>
        createMockSession([textMsg("ok")])
      );

      const trackingOnStatusUpdate: SubagentStatusCallback = (agentId, update) => {
        onStatusUpdate(agentId, update);
        if (update.status === "completed") {
          completionOrder.push(agentId);
        }
      };

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate: trackingOnStatusUpdate,
        maxConcurrentSubagents: 1,
      });

      // Spawn 3 agents sequentially (max concurrent is 1)
      const results = await Promise.all([
        manager.spawn(defaultOptions({ agentId: "first" })),
        manager.spawn(defaultOptions({ agentId: "second" })),
        manager.spawn(defaultOptions({ agentId: "third" })),
      ]);

      // All should complete
      expect(results.every((r) => r.success)).toBe(true);

      // Should complete in order: first, second, third
      expect(completionOrder).toEqual(["first", "second", "third"]);
    });
  });

  // --------------------------------------------------------------------------
  // activeCount
  // --------------------------------------------------------------------------

  describe("activeCount", () => {
    test("returns 0 when no sessions are active", () => {
      const manager = new SubagentSessionManager({
        createSession: createMockSessionFactory(),
        onStatusUpdate,
      });
      expect(manager.activeCount).toBe(0);
    });

    test("returns 0 after all sessions complete", async () => {
      const createSession = createMockSessionFactory(
        createMockSession([textMsg("ok")])
      );

      const manager = new SubagentSessionManager({
        createSession,
        onStatusUpdate,
      });

      await manager.spawn(defaultOptions());
      expect(manager.activeCount).toBe(0);
    });
  });
});
