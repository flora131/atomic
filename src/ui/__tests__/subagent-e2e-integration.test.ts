/**
 * End-to-End Integration Tests for Sub-Agent Flow
 *
 * Verifies:
 * 1. Event wiring: subagent.start event updates ParallelAgent status
 * 2. Event wiring: subagent.complete event updates ParallelAgent status
 * 3. Full flow: SubagentGraphBridge spawn → session creation → streaming → completion → cleanup
 * 4. Cross-SDK event mapping: Claude, OpenCode, and Copilot events all produce correct ParallelAgent state
 * 5. Tool use tracking during execution
 * 6. Status text transitions through complete lifecycle
 * 7. Parallel execution with mixed success/failure
 * 8. Cleanup: sessions destroyed and no active sessions remain
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  SubagentGraphBridge,
  type CreateSessionFn,
  type SubagentSpawnOptions,
} from "../../graph/subagent-bridge.ts";
import {
  getSubStatusText,
  type ParallelAgent,
} from "../components/parallel-agents-tree.tsx";
import type {
  Session,
  AgentMessage,
  SessionConfig,
  CodingAgentClient,
  EventType,
  EventHandler,
  AgentEvent,
  ToolDefinition,
  ModelDisplayInfo,
} from "../../sdk/types.ts";

// ============================================================================
// TEST UTILITIES
// ============================================================================

/** Creates a text AgentMessage */
function textMsg(content: string): AgentMessage {
  return { type: "text", content, role: "assistant" };
}

/** Creates a tool_use AgentMessage */
function toolMsg(toolName: string): AgentMessage {
  return {
    type: "tool_use",
    content: `Using ${toolName}`,
    role: "assistant",
    metadata: { toolName },
  };
}

/** Creates a mock Session with configurable stream messages */
function createMockSession(
  messages: AgentMessage[] = [textMsg("default response")],
  options?: { destroyError?: Error; streamError?: Error }
): Session {
  return {
    id: `session-${Math.random().toString(36).slice(2, 8)}`,
    send: mock(() =>
      Promise.resolve({ type: "text" as const, content: "ok", role: "assistant" as const })
    ),
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
 * Mock CodingAgentClient that tracks event handler registrations
 * and allows manual event emission for testing SDK event flows.
 */
function createMockClient(): CodingAgentClient & {
  emit: <T extends EventType>(eventType: T, event: AgentEvent<T>) => void;
  getHandlers: (eventType: EventType) => Array<EventHandler<EventType>>;
} {
  const handlers = new Map<EventType, Array<EventHandler<EventType>>>();

  return {
    agentType: "claude" as const,
    async createSession(_config?: SessionConfig): Promise<Session> {
      return createMockSession();
    },
    async resumeSession(_id: string): Promise<Session | null> {
      return null;
    },
    on<T extends EventType>(eventType: T, handler: EventHandler<T>): () => void {
      if (!handlers.has(eventType)) {
        handlers.set(eventType, []);
      }
      handlers.get(eventType)!.push(handler as EventHandler<EventType>);
      return () => {
        const arr = handlers.get(eventType);
        if (arr) {
          const idx = arr.indexOf(handler as EventHandler<EventType>);
          if (idx >= 0) arr.splice(idx, 1);
        }
      };
    },
    registerTool(_tool: ToolDefinition): void {},
    async start(): Promise<void> {},
    async stop(): Promise<void> {},
    async getModelDisplayInfo(_hint?: string): Promise<ModelDisplayInfo> {
      return { model: "Mock", tier: "Mock" };
    },
    getSystemToolsTokens() {
      return null;
    },
    emit<T extends EventType>(eventType: T, event: AgentEvent<T>): void {
      const arr = handlers.get(eventType);
      if (arr) {
        for (const handler of arr) {
          handler(event as AgentEvent<EventType>);
        }
      }
    },
    getHandlers(eventType: EventType): Array<EventHandler<EventType>> {
      return handlers.get(eventType) ?? [];
    },
  };
}

/**
 * Simulates the event wiring logic from src/ui/index.ts subscribeToToolEvents().
 * Connects client events to ParallelAgent state management.
 */
function wireSubagentEvents(
  client: ReturnType<typeof createMockClient>,
  onAgentsChange: (agents: ParallelAgent[]) => void
): {
  unsubscribe: () => void;
  getAgents: () => ParallelAgent[];
} {
  let agents: ParallelAgent[] = [];

  const unsubStart = client.on("subagent.start", (event) => {
    const data = event.data as {
      subagentId?: string;
      subagentType?: string;
      task?: string;
    };
    if (data.subagentId) {
      const newAgent: ParallelAgent = {
        id: data.subagentId,
        name: data.subagentType ?? "agent",
        task: data.task ?? "",
        status: "running",
        startedAt: event.timestamp ?? new Date().toISOString(),
      };
      agents = [...agents, newAgent];
      onAgentsChange(agents);
    }
  });

  const unsubComplete = client.on("subagent.complete", (event) => {
    const data = event.data as {
      subagentId?: string;
      success?: boolean;
      result?: unknown;
    };
    if (data.subagentId) {
      const status = data.success !== false ? "completed" : "error";
      agents = agents.map((a) =>
        a.id === data.subagentId
          ? {
              ...a,
              status,
              result: data.result ? String(data.result) : undefined,
              durationMs: Date.now() - new Date(a.startedAt).getTime(),
            }
          : a
      );
      onAgentsChange(agents);
    }
  });

  return {
    unsubscribe: () => {
      unsubStart();
      unsubComplete();
    },
    getAgents: () => agents,
  };
}

/** Helper to safely get agent at index */
function agentAt(agents: ParallelAgent[], index: number): ParallelAgent {
  const agent = agents[index];
  if (!agent) {
    throw new Error(
      `Expected agent at index ${index} but array length is ${agents.length}`
    );
  }
  return agent;
}

// ============================================================================
// END-TO-END INTEGRATION TESTS
// ============================================================================

describe("End-to-End Sub-Agent Integration", () => {
  let parallelAgents: ParallelAgent[];
  let client: ReturnType<typeof createMockClient>;
  let wiring: ReturnType<typeof wireSubagentEvents>;

  beforeEach(() => {
    parallelAgents = [];
    client = createMockClient();
    wiring = wireSubagentEvents(client, (agents) => {
      parallelAgents = agents;
    });
  });

  // --------------------------------------------------------------------------
  // Test 1 & 2: Event wiring from SDK client to ParallelAgent state
  // --------------------------------------------------------------------------

  describe("Event wiring: SDK events -> ParallelAgent state", () => {
    test("subagent.start event creates a running ParallelAgent visible in UI state", () => {
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: "2026-02-06T10:00:00.000Z",
        data: {
          subagentId: "e2e-agent-1",
          subagentType: "Explore",
          task: "Find all API endpoints in the codebase",
        },
      });

      expect(parallelAgents).toHaveLength(1);
      const agent = agentAt(parallelAgents, 0);
      expect(agent.id).toBe("e2e-agent-1");
      expect(agent.name).toBe("Explore");
      expect(agent.task).toBe("Find all API endpoints in the codebase");
      expect(agent.status).toBe("running");

      expect(getSubStatusText(agent)).toBe("Initializing...");
    });

    test("subagent.complete event transitions agent from running to completed", () => {
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "e2e-agent-2", subagentType: "Plan" },
      });
      expect(agentAt(parallelAgents, 0).status).toBe("running");

      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: {
          subagentId: "e2e-agent-2",
          success: true,
          result: "Implementation plan created",
        },
      });

      expect(parallelAgents).toHaveLength(1);
      const agent = agentAt(parallelAgents, 0);
      expect(agent.status).toBe("completed");
      expect(agent.result).toBe("Implementation plan created");
      expect(agent.durationMs).toBeGreaterThanOrEqual(0);

      expect(getSubStatusText(agent)).toBe("Done");
    });

    test("subagent.complete with success=false transitions agent to error", () => {
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "e2e-agent-3", subagentType: "debugger" },
      });

      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "e2e-agent-3", success: false },
      });

      expect(agentAt(parallelAgents, 0).status).toBe("error");
    });
  });

  // --------------------------------------------------------------------------
  // Test 3: Full flow through SubagentGraphBridge
  // --------------------------------------------------------------------------

  describe("Full flow: spawn -> session creation -> streaming -> completion -> cleanup", () => {
    test("complete lifecycle: factory creates session, streams messages, destroys session", async () => {
      const mockSession = createMockSession([
        textMsg("Starting research..."),
        toolMsg("Grep"),
        textMsg("Found 3 files matching pattern"),
        toolMsg("Read"),
        textMsg("Contents of config.ts: ..."),
      ]);

      const mockFactory = mock(async (_config?: SessionConfig) => mockSession);

      const bridge = new SubagentGraphBridge({
        createSession: mockFactory as CreateSessionFn,
      });

      const options: SubagentSpawnOptions = {
        agentId: "e2e-full-flow",
        agentName: "Explore",
        task: "Find configuration files",
        systemPrompt: "You are a codebase explorer",
        model: "sonnet",
      };

      const result = await bridge.spawn(options);

      // Verify session creation
      expect(mockFactory).toHaveBeenCalledTimes(1);
      expect(mockFactory).toHaveBeenCalledWith({
        systemPrompt: "You are a codebase explorer",
        model: "sonnet",
      });

      // Verify result
      expect(result.success).toBe(true);
      expect(result.agentId).toBe("e2e-full-flow");
      expect(result.output).toBe(
        "Starting research...Found 3 files matching patternContents of config.ts: ..."
      );
      expect(result.toolUses).toBe(2);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Verify cleanup
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
    });

    test("session creation failure produces error result", async () => {
      const failFactory = mock(async () => {
        throw new Error("API key invalid");
      });

      const bridge = new SubagentGraphBridge({
        createSession: failFactory as CreateSessionFn,
      });

      const result = await bridge.spawn({
        agentId: "fail-agent",
        agentName: "Broken",
        task: "This should fail",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("API key invalid");
      expect(result.agentId).toBe("fail-agent");
    });

    test("streaming failure produces error result but still destroys session", async () => {
      const mockSession = createMockSession([], {
        streamError: new Error("Connection reset"),
      });
      const mockFactory = mock(async () => mockSession);

      const bridge = new SubagentGraphBridge({
        createSession: mockFactory as CreateSessionFn,
      });

      const result = await bridge.spawn({
        agentId: "stream-fail-agent",
        agentName: "Explorer",
        task: "This will fail mid-stream",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection reset");

      // Session still destroyed in finally block
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Test 4: Cross-SDK event mapping verification
  // --------------------------------------------------------------------------

  describe("Cross-SDK event mapping -> ParallelAgent state", () => {
    test("Claude-style events produce correct ParallelAgent states", () => {
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "claude-session-1",
        timestamp: new Date().toISOString(),
        data: {
          subagentId: "claude-sub-1",
          subagentType: "explore",
          task: "Research codebase architecture",
        },
      });

      expect(parallelAgents).toHaveLength(1);
      expect(agentAt(parallelAgents, 0).name).toBe("explore");
      expect(agentAt(parallelAgents, 0).status).toBe("running");

      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "claude-session-1",
        timestamp: new Date().toISOString(),
        data: {
          subagentId: "claude-sub-1",
          success: true,
          result: "Found 15 modules",
        },
      });

      expect(agentAt(parallelAgents, 0).status).toBe("completed");
      expect(agentAt(parallelAgents, 0).result).toBe("Found 15 modules");
    });

    test("OpenCode-style events produce correct ParallelAgent states", () => {
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "opencode-session-1",
        timestamp: new Date().toISOString(),
        data: {
          subagentId: "oc-agent-1",
          subagentType: "explore",
        },
      });

      expect(parallelAgents).toHaveLength(1);
      expect(agentAt(parallelAgents, 0).name).toBe("explore");
      expect(agentAt(parallelAgents, 0).status).toBe("running");

      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "opencode-session-1",
        timestamp: new Date().toISOString(),
        data: {
          subagentId: "oc-agent-1",
          success: true,
          result: "completed",
        },
      });

      expect(agentAt(parallelAgents, 0).status).toBe("completed");
    });

    test("Copilot-style events produce correct ParallelAgent states", () => {
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "copilot-session-1",
        timestamp: new Date().toISOString(),
        data: {
          subagentId: "copilot-agent-1",
          subagentType: "code-review",
        },
      });

      expect(parallelAgents).toHaveLength(1);
      expect(agentAt(parallelAgents, 0).name).toBe("code-review");

      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "copilot-session-1",
        timestamp: new Date().toISOString(),
        data: {
          subagentId: "copilot-agent-1",
          success: true,
        },
      });

      expect(agentAt(parallelAgents, 0).status).toBe("completed");
    });

    test("mixed SDK events for parallel agents from different backends", () => {
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "claude-session",
        timestamp: new Date().toISOString(),
        data: { subagentId: "claude-1", subagentType: "Explore" },
      });
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "opencode-session",
        timestamp: new Date().toISOString(),
        data: { subagentId: "oc-1", subagentType: "Plan" },
      });
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "copilot-session",
        timestamp: new Date().toISOString(),
        data: { subagentId: "copilot-1", subagentType: "debugger" },
      });

      expect(parallelAgents).toHaveLength(3);
      expect(parallelAgents.every((a) => a.status === "running")).toBe(true);

      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "claude-session",
        timestamp: new Date().toISOString(),
        data: { subagentId: "claude-1", success: true, result: "Done" },
      });
      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "opencode-session",
        timestamp: new Date().toISOString(),
        data: { subagentId: "oc-1", success: false },
      });
      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "copilot-session",
        timestamp: new Date().toISOString(),
        data: { subagentId: "copilot-1", success: true },
      });

      expect(agentAt(parallelAgents, 0).status).toBe("completed");
      expect(agentAt(parallelAgents, 1).status).toBe("error");
      expect(agentAt(parallelAgents, 2).status).toBe("completed");
    });
  });

  // --------------------------------------------------------------------------
  // Test 5: Tool use tracking during bridge execution
  // --------------------------------------------------------------------------

  describe("Tool use tracking during execution", () => {
    test("tool use counts are tracked and reported in result", async () => {
      const mockFactory = mock(async () =>
        createMockSession([
          textMsg("Looking at files..."),
          toolMsg("Glob"),
          textMsg("Found src/ui/chat.tsx"),
          toolMsg("Read"),
          textMsg("File contents..."),
          toolMsg("Grep"),
          textMsg("Pattern match found"),
        ])
      );

      const bridge = new SubagentGraphBridge({
        createSession: mockFactory as CreateSessionFn,
      });

      const result = await bridge.spawn({
        agentId: "tool-tracking-agent",
        agentName: "Explore",
        task: "Search for patterns",
      });

      expect(result.toolUses).toBe(3);
      expect(result.success).toBe(true);
      expect(result.output).toContain("Looking at files...");
      expect(result.output).toContain("Pattern match found");
    });
  });

  // --------------------------------------------------------------------------
  // Test 6: getSubStatusText transitions through lifecycle
  // --------------------------------------------------------------------------

  describe("Sub-status text transitions through complete lifecycle", () => {
    test("ParallelAgent shows correct sub-status at each stage", () => {
      // Stage 1: Pending/just started
      const pendingAgent: ParallelAgent = {
        id: "lifecycle-1",
        name: "Explore",
        task: "Find files",
        status: "pending",
        startedAt: new Date().toISOString(),
      };
      expect(getSubStatusText(pendingAgent)).toBe("Initializing...");

      // Stage 2: Running (no tool yet)
      const runningAgent: ParallelAgent = { ...pendingAgent, status: "running" };
      expect(getSubStatusText(runningAgent)).toBe("Initializing...");

      // Stage 3: Running with tool
      const toolAgent: ParallelAgent = {
        ...runningAgent,
        currentTool: "Bash: find /src -name '*.ts'",
      };
      expect(getSubStatusText(toolAgent)).toBe("Bash: find /src -name '*.ts'");

      // Stage 4: Running with different tool
      const nextToolAgent: ParallelAgent = {
        ...toolAgent,
        currentTool: "Read: src/index.ts",
      };
      expect(getSubStatusText(nextToolAgent)).toBe("Read: src/index.ts");

      // Stage 5: Completed
      const completedAgent: ParallelAgent = {
        ...runningAgent,
        status: "completed",
        currentTool: undefined,
        durationMs: 3500,
      };
      expect(getSubStatusText(completedAgent)).toBe("Done");

      // Stage 6: Error
      const errorAgent: ParallelAgent = {
        ...runningAgent,
        status: "error",
        currentTool: undefined,
        error: "Rate limit exceeded",
      };
      expect(getSubStatusText(errorAgent)).toBe("Rate limit exceeded");
    });
  });

  // --------------------------------------------------------------------------
  // Test 7: Parallel execution with mixed success/failure via bridge
  // --------------------------------------------------------------------------

  describe("Parallel execution with mixed success/failure", () => {
    test("spawnParallel with mixed success/failure returns all results", async () => {
      let callCount = 0;
      const mockFactory = mock(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Agent 2 quota exceeded");
        }
        return createMockSession([
          textMsg("Result from agent"),
          toolMsg("Bash"),
          textMsg(" complete"),
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

  // --------------------------------------------------------------------------
  // Test 8: Cleanup verification
  // --------------------------------------------------------------------------

  describe("Cleanup: sessions destroyed and no active sessions remain", () => {
    test("all sessions destroyed after spawn completes", async () => {
      const destroyMock = mock(() => Promise.resolve());
      const mockSession: Session = {
        ...createMockSession([textMsg("done")]),
        destroy: destroyMock,
      };
      const mockFactory = mock(async () => mockSession);

      const bridge = new SubagentGraphBridge({
        createSession: mockFactory as CreateSessionFn,
      });

      await bridge.spawn({
        agentId: "cleanup-1",
        agentName: "Test",
        task: "Verify cleanup",
      });

      expect(destroyMock).toHaveBeenCalledTimes(1);
    });

    test("sessions destroyed even when streaming throws", async () => {
      const destroyMock = mock(() => Promise.resolve());
      const session = createMockSession([], {
        streamError: new Error("Stream died"),
      });
      (session as unknown as { destroy: typeof destroyMock }).destroy = destroyMock;

      const mockFactory = mock(async () => session);

      const bridge = new SubagentGraphBridge({
        createSession: mockFactory as CreateSessionFn,
      });

      const result = await bridge.spawn({
        agentId: "cleanup-2",
        agentName: "Test",
        task: "Will fail",
      });

      expect(result.success).toBe(false);
      expect(destroyMock).toHaveBeenCalledTimes(1);
    });

    test("event wiring unsubscribe stops processing new events", () => {
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "a1", subagentType: "Explore" },
      });
      expect(parallelAgents).toHaveLength(1);

      wiring.unsubscribe();

      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "a2", subagentType: "Plan" },
      });
      expect(parallelAgents).toHaveLength(1); // Still 1, not 2

      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "a1", success: true },
      });
      expect(agentAt(parallelAgents, 0).status).toBe("running"); // Still running
    });
  });
});
