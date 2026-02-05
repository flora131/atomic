/**
 * Unit Tests for Subagent Event Wiring in subscribeToToolEvents()
 *
 * Tests cover:
 * - subagent.start event creates a new ParallelAgent with 'running' status
 * - subagent.complete event updates ParallelAgent to 'completed' status
 * - subagent.complete with success=false updates ParallelAgent to 'error' status
 * - Unsubscribe functions clean up subagent event handlers
 * - Events without parallelAgentHandler registered are safely ignored
 * - Events with missing subagentId are safely ignored
 *
 * Reference: Feature 2 - Wire subagent.start and subagent.complete event subscriptions
 */

import { describe, test, expect, beforeEach } from "bun:test";
import type { ParallelAgent } from "../components/parallel-agents-tree.tsx";
import type {
  CodingAgentClient,
  EventType,
  EventHandler,
  AgentEvent,
  Session,
  SessionConfig,
  AgentMessage,
  ToolDefinition,
  ModelDisplayInfo,
} from "../../sdk/types.ts";

// ============================================================================
// MOCK CLIENT
// ============================================================================

/**
 * Mock CodingAgentClient that captures event handler registrations
 * and allows manual event emission for testing.
 */
function createMockClient(): CodingAgentClient & {
  emit: <T extends EventType>(eventType: T, event: AgentEvent<T>) => void;
  getHandlers: (eventType: EventType) => Array<EventHandler<EventType>>;
} {
  const handlers = new Map<EventType, Array<EventHandler<EventType>>>();

  return {
    agentType: "claude" as const,

    async createSession(_config?: SessionConfig): Promise<Session> {
      return {
        id: "mock-session",
        async send(_msg: string): Promise<AgentMessage> {
          return { type: "text", content: "mock", role: "assistant" };
        },
        async *stream(_msg: string): AsyncIterable<AgentMessage> {
          yield { type: "text", content: "mock", role: "assistant" };
        },
        async summarize(): Promise<void> {},
        async getContextUsage() {
          return { inputTokens: 0, outputTokens: 0, maxTokens: 100000, usagePercentage: 0 };
        },
        async destroy(): Promise<void> {},
      };
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
 * Simulates the subscribeToToolEvents() wiring logic from src/ui/index.ts
 * for the subagent events only, to test in isolation.
 */
function wireSubagentEvents(
  client: ReturnType<typeof createMockClient>,
  parallelAgentHandler: ((agents: ParallelAgent[]) => void) | null
): {
  unsubscribe: () => void;
  getAgents: () => ParallelAgent[];
} {
  let agents: ParallelAgent[] = [];

  const unsubSubagentStart = client.on("subagent.start", (event) => {
    const data = event.data as {
      subagentId?: string;
      subagentType?: string;
      task?: string;
    };

    if (parallelAgentHandler && data.subagentId) {
      const newAgent: ParallelAgent = {
        id: data.subagentId,
        name: data.subagentType ?? "agent",
        task: data.task ?? "",
        status: "running",
        startedAt: event.timestamp ?? new Date().toISOString(),
      };
      agents = [...agents, newAgent];
      parallelAgentHandler(agents);
    }
  });

  const unsubSubagentComplete = client.on("subagent.complete", (event) => {
    const data = event.data as {
      subagentId?: string;
      success?: boolean;
      result?: unknown;
    };

    if (parallelAgentHandler && data.subagentId) {
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
      parallelAgentHandler(agents);
    }
  });

  return {
    unsubscribe: () => {
      unsubSubagentStart();
      unsubSubagentComplete();
    },
    getAgents: () => agents,
  };
}

/**
 * Helper to safely access an agent from the array, throwing if index is out of bounds.
 * Avoids TS2532 "Object is possibly undefined" while providing clear error messages.
 */
function agentAt(agents: ParallelAgent[], index: number): ParallelAgent {
  const agent = agents[index];
  if (!agent) {
    throw new Error(`Expected agent at index ${index} but array has length ${agents.length}`);
  }
  return agent;
}

// ============================================================================
// TESTS
// ============================================================================

describe("Subagent Event Wiring", () => {
  let client: ReturnType<typeof createMockClient>;
  let receivedAgents: ParallelAgent[];
  let parallelAgentHandler: (agents: ParallelAgent[]) => void;

  beforeEach(() => {
    client = createMockClient();
    receivedAgents = [];
    parallelAgentHandler = (agents: ParallelAgent[]) => {
      receivedAgents = agents;
    };
  });

  describe("subagent.start event", () => {
    test("creates a new ParallelAgent with 'running' status", () => {
      wireSubagentEvents(client, parallelAgentHandler);

      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: "2026-02-05T12:00:00.000Z",
        data: {
          subagentId: "agent-1",
          subagentType: "Explore",
          task: "Search the codebase for API endpoints",
        },
      });

      expect(receivedAgents).toHaveLength(1);
      expect(agentAt(receivedAgents, 0).id).toBe("agent-1");
      expect(agentAt(receivedAgents, 0).name).toBe("Explore");
      expect(agentAt(receivedAgents, 0).task).toBe("Search the codebase for API endpoints");
      expect(agentAt(receivedAgents, 0).status).toBe("running");
      expect(agentAt(receivedAgents, 0).startedAt).toBe("2026-02-05T12:00:00.000Z");
    });

    test("uses defaults for missing optional fields", () => {
      wireSubagentEvents(client, parallelAgentHandler);

      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: "2026-02-05T12:00:00.000Z",
        data: {
          subagentId: "agent-2",
        },
      });

      expect(receivedAgents).toHaveLength(1);
      expect(agentAt(receivedAgents, 0).name).toBe("agent");
      expect(agentAt(receivedAgents, 0).task).toBe("");
    });

    test("accumulates multiple agents", () => {
      wireSubagentEvents(client, parallelAgentHandler);

      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: "2026-02-05T12:00:00.000Z",
        data: { subagentId: "agent-1", subagentType: "Explore" },
      });

      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: "2026-02-05T12:00:01.000Z",
        data: { subagentId: "agent-2", subagentType: "Plan" },
      });

      expect(receivedAgents).toHaveLength(2);
      expect(agentAt(receivedAgents, 0).id).toBe("agent-1");
      expect(agentAt(receivedAgents, 1).id).toBe("agent-2");
    });

    test("ignores events without subagentId", () => {
      wireSubagentEvents(client, parallelAgentHandler);

      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: "2026-02-05T12:00:00.000Z",
        data: {} as { subagentId: string },
      });

      expect(receivedAgents).toHaveLength(0);
    });
  });

  describe("subagent.complete event", () => {
    test("updates existing agent to 'completed' status on success", () => {
      wireSubagentEvents(client, parallelAgentHandler);

      // Start the agent first
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-1", subagentType: "Explore" },
      });

      expect(agentAt(receivedAgents, 0).status).toBe("running");

      // Complete the agent
      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: {
          subagentId: "agent-1",
          success: true,
          result: "Found 5 API endpoints",
        },
      });

      expect(receivedAgents).toHaveLength(1);
      expect(agentAt(receivedAgents, 0).status).toBe("completed");
      expect(agentAt(receivedAgents, 0).result).toBe("Found 5 API endpoints");
      expect(agentAt(receivedAgents, 0).durationMs).toBeDefined();
      expect(agentAt(receivedAgents, 0).durationMs).toBeGreaterThanOrEqual(0);
    });

    test("updates existing agent to 'error' status on failure", () => {
      wireSubagentEvents(client, parallelAgentHandler);

      // Start the agent first
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-1", subagentType: "Bash" },
      });

      // Fail the agent
      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: {
          subagentId: "agent-1",
          success: false,
        },
      });

      expect(receivedAgents).toHaveLength(1);
      expect(agentAt(receivedAgents, 0).status).toBe("error");
    });

    test("only updates the matching agent, leaves others unchanged", () => {
      wireSubagentEvents(client, parallelAgentHandler);

      // Start two agents
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-1", subagentType: "Explore" },
      });
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-2", subagentType: "Plan" },
      });

      // Complete only agent-1
      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-1", success: true },
      });

      expect(receivedAgents).toHaveLength(2);
      expect(agentAt(receivedAgents, 0).status).toBe("completed");
      expect(agentAt(receivedAgents, 1).status).toBe("running");
    });

    test("ignores events without subagentId", () => {
      wireSubagentEvents(client, parallelAgentHandler);

      // Start an agent
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-1" },
      });

      // Try to complete without subagentId
      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { success: true } as { subagentId: string; success: boolean },
      });

      // Agent should still be running
      expect(receivedAgents).toHaveLength(1);
      expect(agentAt(receivedAgents, 0).status).toBe("running");
    });

    test("stringifies non-string results", () => {
      wireSubagentEvents(client, parallelAgentHandler);

      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-1" },
      });

      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: {
          subagentId: "agent-1",
          success: true,
          result: { files: ["a.ts", "b.ts"] },
        },
      });

      expect(agentAt(receivedAgents, 0).result).toBe("[object Object]");
    });
  });

  describe("handler registration", () => {
    test("events are ignored when parallelAgentHandler is null", () => {
      wireSubagentEvents(client, null);

      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-1" },
      });

      // No handler registered, so receivedAgents should remain empty
      expect(receivedAgents).toHaveLength(0);
    });
  });

  describe("unsubscribe", () => {
    test("unsubscribe stops receiving subagent events", () => {
      const { unsubscribe } = wireSubagentEvents(client, parallelAgentHandler);

      // Emit before unsubscribe - should work
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-1" },
      });
      expect(receivedAgents).toHaveLength(1);

      // Unsubscribe
      unsubscribe();

      // Emit after unsubscribe - should not work
      client.emit("subagent.start", {
        type: "subagent.start",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-2" },
      });
      expect(receivedAgents).toHaveLength(1); // Still 1, not 2
    });

    test("unsubscribe cleans up both start and complete handlers", () => {
      const { unsubscribe } = wireSubagentEvents(client, parallelAgentHandler);

      // Verify handlers are registered
      expect(client.getHandlers("subagent.start")).toHaveLength(1);
      expect(client.getHandlers("subagent.complete")).toHaveLength(1);

      // Unsubscribe
      unsubscribe();

      // Verify handlers are removed
      expect(client.getHandlers("subagent.start")).toHaveLength(0);
      expect(client.getHandlers("subagent.complete")).toHaveLength(0);
    });
  });

  describe("full lifecycle", () => {
    test("handles start → complete flow for multiple agents", () => {
      wireSubagentEvents(client, parallelAgentHandler);

      // Start 3 agents
      for (let i = 1; i <= 3; i++) {
        client.emit("subagent.start", {
          type: "subagent.start",
          sessionId: "session-1",
          timestamp: new Date().toISOString(),
          data: { subagentId: `agent-${i}`, subagentType: "Explore", task: `Task ${i}` },
        });
      }

      expect(receivedAgents).toHaveLength(3);
      expect(receivedAgents.every((a) => a.status === "running")).toBe(true);

      // Complete agent-2 with success
      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-2", success: true, result: "Done" },
      });

      // Complete agent-3 with failure
      client.emit("subagent.complete", {
        type: "subagent.complete",
        sessionId: "session-1",
        timestamp: new Date().toISOString(),
        data: { subagentId: "agent-3", success: false },
      });

      expect(receivedAgents).toHaveLength(3);
      expect(agentAt(receivedAgents, 0).status).toBe("running");   // agent-1 still running
      expect(agentAt(receivedAgents, 1).status).toBe("completed");  // agent-2 completed
      expect(agentAt(receivedAgents, 1).result).toBe("Done");
      expect(agentAt(receivedAgents, 2).status).toBe("error");      // agent-3 failed
    });
  });
});
