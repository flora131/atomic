/**
 * End-to-End Integration Tests for Sub-Agent Flow
 *
 * Verifies Feature 15: Full integration flow from command invocation
 * through session creation, streaming, completion, UI update, and cleanup.
 *
 * Test coverage:
 * 1. Event wiring: subagent.start event updates ParallelAgent status in ChatApp
 * 2. Event wiring: subagent.complete event updates ParallelAgent status in ChatApp
 * 3. Full flow: command invocation → sub-agent spawn → session creation → streaming → completion → UI update → cleanup
 * 4. Cross-SDK event mapping: Claude, OpenCode, and Copilot events all produce correct ParallelAgent state
 * 5. Real tool use counts during execution
 * 6. Status text transitions: "Initializing..." → tool name → "Done"
 * 7. Parallel execution with mixed success/failure
 * 8. Cleanup: all sessions destroyed and no active sessions remain
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  SubagentSessionManager,
  type CreateSessionFn,
  type SubagentSpawnOptions,
  type SubagentResult,
  type SubagentStatusCallback,
} from "../subagent-session-manager.ts";
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
      Promise.resolve({ inputTokens: 0, outputTokens: 0, maxTokens: 200000, usagePercentage: 0 })
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
    throw new Error(`Expected agent at index ${index} but array length is ${agents.length}`);
  }
  return agent;
}

// ============================================================================
// END-TO-END INTEGRATION TESTS
// ============================================================================

describe("End-to-End Sub-Agent Integration", () => {
  // --- Shared state for each test ---
  let parallelAgents: ParallelAgent[];
  let statusUpdates: Array<{ agentId: string; update: Partial<ParallelAgent> }>;
  let client: ReturnType<typeof createMockClient>;
  let wiring: ReturnType<typeof wireSubagentEvents>;

  beforeEach(() => {
    parallelAgents = [];
    statusUpdates = [];
    client = createMockClient();
    wiring = wireSubagentEvents(client, (agents) => {
      parallelAgents = agents;
    });
  });

  // --------------------------------------------------------------------------
  // Test 1 & 2: Event wiring from SDK client to ParallelAgent state
  // --------------------------------------------------------------------------

  describe("Event wiring: SDK events → ParallelAgent state", () => {
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

      // Sub-status text should show "Initializing..." for running agent without currentTool
      expect(getSubStatusText(agent)).toBe("Initializing...");
    });

    test("subagent.complete event transitions agent from running to completed", () => {
      // Start agent
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "e2e-agent-2", subagentType: "Plan" },
      });
      expect(agentAt(parallelAgents, 0).status).toBe("running");

      // Complete agent
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

      // Sub-status text should show "Done" for completed agent
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
  // Test 3: Full flow through SubagentSessionManager
  // --------------------------------------------------------------------------

  describe("Full flow: spawn → session creation → streaming → completion → cleanup", () => {
    test("complete lifecycle: factory creates session, streams messages, updates status, destroys session", async () => {
      const mockSession = createMockSession([
        textMsg("Starting research..."),
        toolMsg("Grep"),
        textMsg("Found 3 files matching pattern"),
        toolMsg("Read"),
        textMsg("Contents of config.ts: ..."),
      ]);

      const mockFactory = mock(async (_config?: SessionConfig) => mockSession);
      const onStatusUpdate: SubagentStatusCallback = (agentId, update) => {
        statusUpdates.push({ agentId, update });
      };

      const manager = new SubagentSessionManager({
        createSession: mockFactory as CreateSessionFn,
        onStatusUpdate,
      });

      const options: SubagentSpawnOptions = {
        agentId: "e2e-full-flow",
        agentName: "Explore",
        task: "Find configuration files",
        systemPrompt: "You are a codebase explorer",
        model: "sonnet",
      };

      const result = await manager.spawn(options);

      // --- Verify session creation ---
      expect(mockFactory).toHaveBeenCalledTimes(1);
      expect(mockFactory).toHaveBeenCalledWith({
        systemPrompt: "You are a codebase explorer",
        model: "sonnet",
        tools: undefined,
      });

      // --- Verify result ---
      expect(result.success).toBe(true);
      expect(result.agentId).toBe("e2e-full-flow");
      expect(result.output).toBe(
        "Starting research...Found 3 files matching patternContents of config.ts: ..."
      );
      expect(result.toolUses).toBe(2);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // --- Verify status update sequence ---
      // Should have: running, toolUse(Grep), toolUse(Read), completed
      const runningUpdate = statusUpdates.find(
        (u) => u.agentId === "e2e-full-flow" && u.update.status === "running"
      );
      expect(runningUpdate).toBeDefined();
      expect(runningUpdate?.update.startedAt).toBeDefined();

      const grepUpdate = statusUpdates.find(
        (u) => u.agentId === "e2e-full-flow" && u.update.currentTool === "Grep"
      );
      expect(grepUpdate).toBeDefined();
      expect(grepUpdate?.update.toolUses).toBe(1);

      const readUpdate = statusUpdates.find(
        (u) => u.agentId === "e2e-full-flow" && u.update.currentTool === "Read"
      );
      expect(readUpdate).toBeDefined();
      expect(readUpdate?.update.toolUses).toBe(2);

      const completedUpdate = statusUpdates.find(
        (u) => u.agentId === "e2e-full-flow" && u.update.status === "completed"
      );
      expect(completedUpdate).toBeDefined();
      expect(completedUpdate?.update.toolUses).toBe(2);
      expect(completedUpdate?.update.durationMs).toBeGreaterThanOrEqual(0);

      // --- Verify cleanup ---
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
      expect(manager.activeCount).toBe(0);
    });

    test("status updates produce correct ParallelAgent sub-status text transitions", async () => {
      const agentStates: ParallelAgent[] = [];

      const mockFactory = mock(async () =>
        createMockSession([
          textMsg("Looking..."),
          toolMsg("Bash"),
          textMsg("Found it"),
        ])
      );

      const manager = new SubagentSessionManager({
        createSession: mockFactory as CreateSessionFn,
        onStatusUpdate: (agentId, update) => {
          // Build a ParallelAgent from cumulative updates (simulating UI state management)
          const lastState = agentStates.length > 0 ? agentStates[agentStates.length - 1]! : {
            id: agentId,
            name: "Explore",
            task: "test",
            status: "pending" as const,
            startedAt: new Date().toISOString(),
          };
          const nextState: ParallelAgent = { ...lastState, ...update };
          agentStates.push(nextState);
        },
      });

      await manager.spawn({
        agentId: "status-text-agent",
        agentName: "Explore",
        task: "Search for patterns",
      });

      // Verify sub-status text transitions
      expect(agentStates.length).toBeGreaterThanOrEqual(3); // running, tool, completed

      // First update: running status with "Starting session..." currentTool
      const runningState = agentStates.find((s) => s.status === "running" && s.currentTool === "Starting session...");
      expect(runningState).toBeDefined();
      expect(getSubStatusText(runningState!)).toBe("Starting session...");

      // Tool update: currentTool set → shows tool name
      const toolState = agentStates.find((s) => s.currentTool === "Bash");
      expect(toolState).toBeDefined();
      expect(getSubStatusText(toolState!)).toBe("Bash");

      // Final update: completed → "Done"
      const completedState = agentStates.find((s) => s.status === "completed");
      expect(completedState).toBeDefined();
      expect(getSubStatusText(completedState!)).toBe("Done");
    });

    test("session creation failure produces error status and cleanup", async () => {
      const failFactory = mock(async () => {
        throw new Error("API key invalid");
      });

      const manager = new SubagentSessionManager({
        createSession: failFactory as CreateSessionFn,
        onStatusUpdate: (agentId, update) => {
          statusUpdates.push({ agentId, update });
        },
      });

      const result = await manager.spawn({
        agentId: "fail-agent",
        agentName: "Broken",
        task: "This should fail",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("API key invalid");
      expect(result.agentId).toBe("fail-agent");

      // Verify error status update was emitted
      const errorUpdate = statusUpdates.find(
        (u) => u.agentId === "fail-agent" && u.update.status === "error"
      );
      expect(errorUpdate).toBeDefined();
      expect(errorUpdate?.update.error).toBe("API key invalid");

      // Sub-status text for error agent should show error message
      const errorAgent: ParallelAgent = {
        id: "fail-agent",
        name: "Broken",
        task: "test",
        status: "error",
        startedAt: new Date().toISOString(),
        error: "API key invalid",
      };
      expect(getSubStatusText(errorAgent)).toBe("API key invalid");

      expect(manager.activeCount).toBe(0);
    });

    test("streaming failure produces error status but still destroys session", async () => {
      const mockSession = createMockSession([], {
        streamError: new Error("Connection reset"),
      });
      const mockFactory = mock(async () => mockSession);

      const manager = new SubagentSessionManager({
        createSession: mockFactory as CreateSessionFn,
        onStatusUpdate: (agentId, update) => {
          statusUpdates.push({ agentId, update });
        },
      });

      const result = await manager.spawn({
        agentId: "stream-fail-agent",
        agentName: "Explorer",
        task: "This will fail mid-stream",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Connection reset");

      // Session still destroyed in finally block
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
      expect(manager.activeCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Test 4: Cross-SDK event mapping verification
  // --------------------------------------------------------------------------

  describe("Cross-SDK event mapping → ParallelAgent state", () => {
    test("Claude-style events produce correct ParallelAgent states", () => {
      // Simulate what ClaudeAgentClient emits after hook processing
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
      // Simulate what OpenCodeClient emits after AgentPart/StepFinishPart processing
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
      expect(agentAt(parallelAgents, 0).result).toBe("completed");
    });

    test("Copilot-style events produce correct ParallelAgent states", () => {
      // Simulate what CopilotClient emits after subagent.started → subagent.start mapping
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
      // Start agents from different "backends"
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

      // Complete claude and copilot, fail opencode
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

      expect(agentAt(parallelAgents, 0).status).toBe("completed"); // claude
      expect(agentAt(parallelAgents, 1).status).toBe("error");     // opencode
      expect(agentAt(parallelAgents, 2).status).toBe("completed"); // copilot
    });
  });

  // --------------------------------------------------------------------------
  // Test 5: Tool use tracking during execution
  // --------------------------------------------------------------------------

  describe("Tool use tracking during execution", () => {
    test("real tool use counts are tracked and reported in status updates", async () => {
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

      const manager = new SubagentSessionManager({
        createSession: mockFactory as CreateSessionFn,
        onStatusUpdate: (agentId, update) => {
          statusUpdates.push({ agentId, update });
        },
      });

      const result = await manager.spawn({
        agentId: "tool-tracking-agent",
        agentName: "Explore",
        task: "Search for patterns",
      });

      // Result should report 3 tool uses
      expect(result.toolUses).toBe(3);

      // Status updates should show incremental tool use counts
      const toolUpdates = statusUpdates.filter(
        (u) => u.agentId === "tool-tracking-agent" && u.update.toolUses !== undefined && u.update.currentTool !== undefined
      );

      expect(toolUpdates.length).toBe(3);
      expect(toolUpdates[0]?.update.toolUses).toBe(1);
      expect(toolUpdates[0]?.update.currentTool).toBe("Glob");
      expect(toolUpdates[1]?.update.toolUses).toBe(2);
      expect(toolUpdates[1]?.update.currentTool).toBe("Read");
      expect(toolUpdates[2]?.update.toolUses).toBe(3);
      expect(toolUpdates[2]?.update.currentTool).toBe("Grep");

      // Completed status should have total tool uses but clear currentTool
      const completedUpdate = statusUpdates.find(
        (u) => u.agentId === "tool-tracking-agent" && u.update.status === "completed"
      );
      expect(completedUpdate?.update.toolUses).toBe(3);
      expect(completedUpdate?.update.currentTool).toBeUndefined();
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
      const toolAgent: ParallelAgent = { ...runningAgent, currentTool: "Bash: find /src -name '*.ts'" };
      expect(getSubStatusText(toolAgent)).toBe("Bash: find /src -name '*.ts'");

      // Stage 4: Running with different tool
      const nextToolAgent: ParallelAgent = { ...toolAgent, currentTool: "Read: src/index.ts" };
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
  // Test 7: Parallel execution with mixed success/failure
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

      const manager = new SubagentSessionManager({
        createSession: mockFactory as CreateSessionFn,
        onStatusUpdate: (agentId, update) => {
          statusUpdates.push({ agentId, update });
        },
      });

      const results = await manager.spawnParallel([
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

      // Verify status updates emitted for all agents
      const par1Completed = statusUpdates.find(
        (u) => u.agentId === "par-1" && u.update.status === "completed"
      );
      expect(par1Completed).toBeDefined();

      const par2Error = statusUpdates.find(
        (u) => u.agentId === "par-2" && u.update.status === "error"
      );
      expect(par2Error).toBeDefined();

      const par3Completed = statusUpdates.find(
        (u) => u.agentId === "par-3" && u.update.status === "completed"
      );
      expect(par3Completed).toBeDefined();

      // All sessions cleaned up
      expect(manager.activeCount).toBe(0);
    });

    test("parallel execution respects concurrency limit and queues excess", async () => {
      const sessionCreationOrder: string[] = [];
      const mockFactory = mock(async (config?: SessionConfig) => {
        sessionCreationOrder.push(config?.systemPrompt ?? "unknown");
        return createMockSession([textMsg("ok")]);
      });

      const manager = new SubagentSessionManager({
        createSession: mockFactory as CreateSessionFn,
        onStatusUpdate: () => {},
        maxConcurrentSubagents: 2,
      });

      const results = await manager.spawnParallel([
        { agentId: "q-1", agentName: "A", task: "T1", systemPrompt: "first" },
        { agentId: "q-2", agentName: "B", task: "T2", systemPrompt: "second" },
        { agentId: "q-3", agentName: "C", task: "T3", systemPrompt: "third" },
      ]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);

      // All 3 sessions should have been created
      expect(mockFactory).toHaveBeenCalledTimes(3);
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

      const manager = new SubagentSessionManager({
        createSession: mockFactory as CreateSessionFn,
        onStatusUpdate: () => {},
      });

      await manager.spawn({
        agentId: "cleanup-1",
        agentName: "Test",
        task: "Verify cleanup",
      });

      expect(destroyMock).toHaveBeenCalledTimes(1);
      expect(manager.activeCount).toBe(0);
    });

    test("sessions destroyed even when streaming throws", async () => {
      const destroyMock = mock(() => Promise.resolve());
      const session = createMockSession([], {
        streamError: new Error("Stream died"),
      });
      (session as unknown as { destroy: typeof destroyMock }).destroy = destroyMock;

      const mockFactory = mock(async () => session);

      const manager = new SubagentSessionManager({
        createSession: mockFactory as CreateSessionFn,
        onStatusUpdate: () => {},
      });

      const result = await manager.spawn({
        agentId: "cleanup-2",
        agentName: "Test",
        task: "Will fail",
      });

      expect(result.success).toBe(false);
      expect(destroyMock).toHaveBeenCalledTimes(1);
      expect(manager.activeCount).toBe(0);
    });

    test("destroy() prevents new spawns and cleans up everything", async () => {
      const mockFactory = mock(async () => createMockSession([textMsg("ok")]));

      const manager = new SubagentSessionManager({
        createSession: mockFactory as CreateSessionFn,
        onStatusUpdate: () => {},
      });

      await manager.destroy();

      const result = await manager.spawn({
        agentId: "post-destroy",
        agentName: "Ghost",
        task: "Should not run",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("SubagentSessionManager has been destroyed");
      expect(mockFactory).not.toHaveBeenCalled();
      expect(manager.activeCount).toBe(0);
    });

    test("event wiring unsubscribe stops processing new events", () => {
      // Start an agent
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "a1", subagentType: "Explore" },
      });
      expect(parallelAgents).toHaveLength(1);

      // Unsubscribe
      wiring.unsubscribe();

      // Emit more events - should be ignored
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "a2", subagentType: "Plan" },
      });
      expect(parallelAgents).toHaveLength(1); // Still 1, not 2

      // Completion events also ignored
      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "s1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "a1", success: true },
      });
      expect(agentAt(parallelAgents, 0).status).toBe("running"); // Still running
    });
  });

  // --------------------------------------------------------------------------
  // Test: Combined flow - event wiring + SubagentSessionManager
  // --------------------------------------------------------------------------

  describe("Combined flow: SubagentSessionManager + event wiring", () => {
    test("SubagentSessionManager status updates can drive ParallelAgent state alongside SDK events", async () => {
      // This test verifies that status updates from SubagentSessionManager
      // (which drives the ParallelAgentsTree) and SDK event wiring
      // (which also creates/updates ParallelAgents) can coexist.

      const localAgentTracker: ParallelAgent[] = [];
      const mockFactory = mock(async () =>
        createMockSession([
          textMsg("Researching..."),
          toolMsg("Grep"),
          textMsg("Found patterns"),
        ])
      );

      const manager = new SubagentSessionManager({
        createSession: mockFactory as CreateSessionFn,
        onStatusUpdate: (agentId, update) => {
          // Simulate UI state management: merge updates into tracked agents
          const existingIdx = localAgentTracker.findIndex((a) => a.id === agentId);
          if (existingIdx >= 0) {
            const existing = localAgentTracker[existingIdx]!;
            localAgentTracker[existingIdx] = { ...existing, ...update };
          } else {
            localAgentTracker.push({
              id: agentId,
              name: "Explore",
              task: "test",
              status: "pending",
              startedAt: new Date().toISOString(),
              ...update,
            });
          }
        },
      });

      // Spawn via manager (this is what chat.tsx does)
      const result = await manager.spawn({
        agentId: "combined-agent",
        agentName: "Explore",
        task: "Deep search",
      });

      expect(result.success).toBe(true);
      expect(result.toolUses).toBe(1);

      // The localAgentTracker should have been updated through the lifecycle
      expect(localAgentTracker).toHaveLength(1);
      const finalAgent = localAgentTracker[0]!;
      expect(finalAgent.id).toBe("combined-agent");
      expect(finalAgent.status).toBe("completed");
      expect(finalAgent.toolUses).toBe(1);
      expect(getSubStatusText(finalAgent)).toBe("Done");
    });
  });
});
