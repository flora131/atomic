// @ts-nocheck
/**
 * SDK Stream Adapter Tests
 *
 * Comprehensive unit tests for all three SDK stream adapters:
 * - OpenCodeStreamAdapter (AsyncIterable + EventEmitter)
 * - ClaudeStreamAdapter (AsyncIterable)
 * - CopilotStreamAdapter (EventEmitter)
 *
 * Tests verify that each adapter correctly:
 * 1. Maps SDK events to BusEvents
 * 2. Publishes events to the event bus with correct runId
 * 3. Handles text, tool, thinking, and error events
 * 4. Supports cancellation via dispose()
 * 5. Ignores unmapped/unknown event types
 * 6. Publishes complete events at stream end
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import { WorkflowEventAdapter } from "@/services/events/adapters/workflow-adapter.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";
import type {
  Session,
  AgentMessage,
  AgentEvent,
  EventType,
  CodingAgentClient,
} from "@/services/agents/types.ts";

// ============================================================================
// Mock Utilities
// ============================================================================

/**
 * Mock async generator for OpenCode/Claude streams
 */
async function* mockAsyncStream(
  chunks: AgentMessage[],
): AsyncGenerator<AgentMessage> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/**
 * Create a mock Session for testing
 */
function createMockSession(
  stream: AsyncGenerator<AgentMessage>,
  client?: Partial<CodingAgentClient>,
): Session {
  const session = {
    id: "test-session-123",
    stream: mock(() => stream),
    __client: client ?? createMockClient(),
  } as unknown as Session;
  return session;
}

/**
 * Create a mock CodingAgentClient with EventEmitter-like behavior
 */
function createMockClient(): CodingAgentClient {
  const handlers = new Map<EventType, Set<(event: AgentEvent) => void>>();
  const providerHandlers = new Set<(event: AgentEvent & { provider: string }) => void>();

  const client = {
    on: mock((type: EventType, handler: (event: AgentEvent) => void) => {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    }),
    onProviderEvent: mock((handler: (event: AgentEvent & { provider: string }) => void) => {
      providerHandlers.add(handler);
      return () => {
        providerHandlers.delete(handler);
      };
    }),
    emit: (type: EventType, event: AgentEvent) => {
      const set = handlers.get(type);
      if (set) {
        for (const handler of set) {
          handler(event);
        }
      }

      const providerEvent = {
        provider: "mock",
        ...event,
        type,
      };
      for (const handler of providerHandlers) {
        handler(providerEvent);
      }
    },
  } as unknown as CodingAgentClient;

  return client;
}

/**
 * Helper to collect published events from the event bus
 */
function collectEvents(bus: EventBus): BusEvent[] {
  const events: BusEvent[] = [];
  bus.onAll((event) => {
    events.push(event);
  });
  return events;
}

// ============================================================================
// OpenCodeStreamAdapter Tests
// ============================================================================

describe("OpenCodeStreamAdapter", () => {
  let bus: EventBus;
  let adapter: OpenCodeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new OpenCodeStreamAdapter(bus, "test-session-123");
  });

  test("publishes text delta events from stream", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      { type: "text", content: "Hello " },
      { type: "text", content: "world" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, createMockClient());

    await adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    // Should have session.start + 2 delta events + 1 complete event + 1 session.idle
    expect(events.length).toBe(5);

    const deltaEvents = events.filter((e) => e.type === "stream.text.delta");
    expect(deltaEvents.length).toBe(2);
    expect(deltaEvents[0].data.delta).toBe("Hello ");
    expect(deltaEvents[0].data.messageId).toBe("msg-1");
    expect(deltaEvents[0].runId).toBe(42);
    expect(deltaEvents[1].data.delta).toBe("world");

    const completeEvent = events.find((e) => e.type === "stream.text.complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.data.fullText).toBe("Hello world");
    expect(completeEvent?.data.messageId).toBe("msg-1");
    expect(completeEvent?.runId).toBe(42);

    // OpenCode adapter always publishes session.idle after the for-await loop
    const idleEvent = events.find((e) => e.type === "stream.session.idle");
    expect(idleEvent).toBeDefined();
    expect(idleEvent?.data.reason).toBe("generator-complete");
  });

  test("publishes tool start events from SDK client", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    // Start streaming in background
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    // Emit tool.start event
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo hello" },
        toolUseId: "tool-123",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const toolStartEvents = events.filter(
      (e) => e.type === "stream.tool.start",
    );
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.toolName).toBe("bash");
    expect(toolStartEvents[0].data.toolInput).toEqual({ command: "echo hello" });
    expect(toolStartEvents[0].data.toolId).toBe("tool-123");
    expect(toolStartEvents[0].data.sdkCorrelationId).toBe("tool-123");
    expect(toolStartEvents[0].runId).toBe(42);
  });

  test("suppresses empty OpenCode task placeholders and deduplicates hydrated task starts", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {},
        toolUseId: "task-tool-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research TUI UX practices",
          subagent_type: "codebase-online-researcher",
        },
        toolUseId: "task-tool-1",
      },
    } as AgentEvent<"tool.start">);

    // Duplicate hydrated event (same tool ID + same payload) should be ignored.
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research TUI UX practices",
          subagent_type: "codebase-online-researcher",
        },
        toolUseId: "task-tool-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const taskStartEvents = events.filter(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "task-tool-1",
    );
    expect(taskStartEvents.length).toBe(1);
    expect(taskStartEvents[0].data.toolInput).toEqual({
      description: "Research TUI UX practices",
      subagent_type: "codebase-online-researcher",
    });
  });

  test("publishes tool complete events from SDK client", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    // Emit tool.complete event
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolResult: "hello",
        success: true,
        toolUseId: "tool-123",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const toolCompleteEvents = events.filter(
      (e) => e.type === "stream.tool.complete",
    );
    expect(toolCompleteEvents.length).toBe(1);
    expect(toolCompleteEvents[0].data.toolName).toBe("bash");
    expect(toolCompleteEvents[0].data.toolResult).toBe("hello");
    expect(toolCompleteEvents[0].data.success).toBe(true);
    expect(toolCompleteEvents[0].data.toolId).toBe("tool-123");
    expect(toolCompleteEvents[0].runId).toBe(42);
  });

  test("does not publish synthetic subagent lifecycle when a task tool completes without subagent.complete", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-synthetic-complete",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Task",
        toolInput: {
          description: "Locate TUI code",
          subagent_type: "codebase-locator",
        },
        toolUseId: "task-tool-complete-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Task",
        toolUseId: "task-tool-complete-1",
        toolResult: "Completed task output",
        success: true,
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    expect(
      events.some((e) => e.type === "stream.agent.start"),
    ).toBe(false);
    expect(
      events.some((e) => e.type === "stream.agent.complete"),
    ).toBe(false);
  });

  test("streams child-session tool events for registered subagents", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-1",
        subagentType: "general-purpose",
        toolCallId: "task-tool-1",
        subagentSessionId: "child-session-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-1",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo hello" },
        toolUseId: "child-tool-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "child-session-1",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolResult: "ok",
        success: true,
        toolUseId: "child-tool-1",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const toolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-1",
    );
    expect(toolStart).toBeDefined();
    expect(toolStart?.data.parentAgentId).toBe("agent-child-1");

    const toolComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "child-tool-1",
    );
    expect(toolComplete).toBeDefined();
    expect(toolComplete?.data.parentAgentId).toBe("agent-child-1");

    const updates = events.filter(
      (e) => e.type === "stream.agent.update" && e.data.agentId === "agent-child-1",
    );
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.some((e) => e.data.currentTool === "bash" && e.data.toolUses === 1)).toBe(true);
    expect(updates.some((e) => e.data.currentTool === undefined && e.data.toolUses === 1)).toBe(true);
  });

  test("drops unknown child-session tool events without a real OpenCode mapping", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-only-1",
        subagentType: "researcher",
        task: "Investigate UI state",
        toolCallId: "task-call-only-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-unknown",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolInput: { query: "tui patterns" },
        toolUseId: "child-tool-unknown-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    expect(
      events.some(
        (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-unknown-1",
      ),
    ).toBe(false);
  });

  test("accepts subagent.update from unknown child session when subagent is already known", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-subagent-update-child-session",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-known-1",
        subagentType: "codebase-locator",
        toolCallId: "task-call-known-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.update" as EventType, {
      type: "subagent.update",
      sessionId: "child-session-unowned-1",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-known-1",
        currentTool: "glob",
        toolUses: 1,
      },
    } as AgentEvent<"subagent.update">);

    await streamPromise;

    expect(
      events.some(
        (e) => e.type === "stream.agent.update"
          && e.data.agentId === "agent-known-1"
          && e.data.currentTool === "glob"
          && e.data.toolUses === 1,
      ),
    ).toBe(true);
  });

  test("drops OpenCode child-session message deltas from the visible parent transcript", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-child-session-delta",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-text-1",
        subagentType: "researcher",
        task: "Inspect event routing",
        toolCallId: "task-call-child-text-1",
        subagentSessionId: "child-session-text-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: "child-session-text-1",
      timestamp: Date.now(),
      data: {
        delta: "child session text",
        contentType: "text",
      },
    } as AgentEvent<"message.delta">);

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: "child-session-text-1",
      timestamp: Date.now(),
      data: {},
    } as AgentEvent<"message.complete">);

    await streamPromise;

    expect(
      events.some(
        (e) => e.type === "stream.text.delta"
          && e.data.delta === "child session text",
      ),
    ).toBe(false);

    const childTextComplete = events.find(
      (e) => e.type === "stream.text.complete" && e.data.fullText === "child session text",
    );
    expect(childTextComplete).toBeUndefined();
  });

  test("drops child-session tools when task metadata does not identify the child session", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research TUI UX practices",
          subagent_type: "codebase-online-researcher",
        },
        toolUseId: "task-tool-synth-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-unknown",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolInput: { query: "tui patterns" },
        toolUseId: "child-tool-synth-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const taskToolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "task-tool-synth-1",
    );
    expect(taskToolStart).toBeDefined();
    expect(taskToolStart?.data.parentAgentId).toBeUndefined();

    expect(
      events.some(
        (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-synth-1",
      ),
    ).toBe(false);
    expect(
      events.some((e) => e.type === "stream.agent.start" || e.type === "stream.agent.update"),
    ).toBe(false);
  });

  test("attributes parallel child-session tools via task metadata session ids before subagent.start", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Locate TUI code",
          subagent_type: "codebase-locator",
        },
        toolMetadata: {
          sessionId: "child-session-a",
        },
        toolUseId: "task-tool-a",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Find UI patterns",
          subagent_type: "codebase-pattern-finder",
        },
        toolMetadata: {
          sessionId: "child-session-b",
        },
        toolUseId: "task-tool-b",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-a",
      timestamp: Date.now(),
      data: {
        toolName: "Read",
        toolInput: { filePath: "src/screens/chat-screen.tsx" },
        toolUseId: "child-tool-a",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-b",
      timestamp: Date.now(),
      data: {
        toolName: "Glob",
        toolInput: { path: "src/**/*.ts" },
        toolUseId: "child-tool-b",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const childToolA = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-a",
    );
    const childToolB = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-b",
    );
    expect(childToolA?.data.parentAgentId).toBe("task-tool-a");
    expect(childToolB?.data.parentAgentId).toBe("task-tool-b");
  });

  test("hydrates OpenCode child-session tools from synced parent task parts when streamed task metadata omits the child session id", async () => {
    const events = collectEvents(bus);
    const client = createMockClient() as CodingAgentClient & {
      getSessionMessagesWithParts: ReturnType<typeof mock>;
    };
    const adapterWithClient = new OpenCodeStreamAdapter(bus, "test-session-123", client);
    client.getSessionMessagesWithParts = mock(async (sessionId: string) => {
      if (sessionId === "test-session-123") {
        return [
          {
            info: {
              id: "parent-message-1",
              sessionID: "test-session-123",
              role: "assistant",
            },
            parts: [
              {
                type: "tool",
                id: "task-tool-history-1",
                tool: "task",
                state: {
                  status: "completed",
                  metadata: {
                    sessionId: "child-session-history-1",
                  },
                },
              },
            ],
          },
        ];
      }

      if (sessionId === "child-session-history-1") {
        return [
          {
            info: {
              id: "child-message-1",
              sessionID: "child-session-history-1",
              role: "assistant",
            },
            parts: [
              {
                type: "tool",
                id: "child-tool-history-1",
                tool: "Read",
                state: {
                  status: "completed",
                  input: { filePath: "src/services/agents/clients/opencode.ts" },
                  output: "ok",
                },
              },
            ],
          },
        ];
      }

      return [];
    });

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapterWithClient.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-history-hydration",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research BM25 explanation",
          subagent_type: "codebase-online-researcher",
        },
        toolUseId: "task-tool-history-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-history-1",
        subagentType: "codebase-online-researcher",
        task: "Research BM25 explanation",
        toolUseId: "task-tool-history-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research BM25 explanation",
          subagent_type: "codebase-online-researcher",
        },
        toolResult: "task_id: child-session-history-1\n\n<task_result>done</task_result>",
        success: true,
        toolUseId: "task-tool-history-1",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getSessionMessagesWithParts).toHaveBeenCalledWith("test-session-123");
    expect(client.getSessionMessagesWithParts).toHaveBeenCalledWith("child-session-history-1");

    const childToolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-history-1",
    );
    const childToolComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "child-tool-history-1",
    );

    expect(childToolStart?.data.parentAgentId).toBe("agent-history-1");
    expect(childToolComplete?.data.parentAgentId).toBe("agent-history-1");
  });

  test("keeps syncing OpenCode child-session tools from task metadata session id until they appear", async () => {
    const events = collectEvents(bus);
    const client = createMockClient() as CodingAgentClient & {
      getSessionMessagesWithParts: ReturnType<typeof mock>;
    };
    const adapterWithClient = new OpenCodeStreamAdapter(bus, "test-session-123", client);
    const childToolsAvailableAt = Date.now() + 1300;
    let childFetchCount = 0;

    client.getSessionMessagesWithParts = mock(async (sessionId: string) => {
      if (sessionId !== "child-session-early-1") {
        return [];
      }

      childFetchCount += 1;
      if (Date.now() < childToolsAvailableAt) {
        return [];
      }

      return [
        {
          info: {
            id: "child-message-early-1",
            sessionID: "child-session-early-1",
            role: "assistant",
          },
          parts: [
            {
              type: "tool",
              id: "child-tool-early-1",
              tool: "WebSearch",
              state: {
                status: "completed",
                input: { query: "bm25 explanation" },
                output: "ok",
              },
            },
          ],
        },
      ];
    });

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapterWithClient.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-early-child-hydration",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research BM25 explanation",
          subagent_type: "codebase-online-researcher",
        },
        toolMetadata: {
          sessionId: "child-session-early-1",
        },
        toolUseId: "task-tool-early-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;
    await new Promise((resolve) => setTimeout(resolve, 1800));

    expect(client.getSessionMessagesWithParts).toHaveBeenCalledWith("child-session-early-1");
    expect(childFetchCount).toBeGreaterThanOrEqual(4);

    const childToolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-early-1",
    );
    const childToolComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "child-tool-early-1",
    );

    expect(childToolStart?.data.parentAgentId).toBe("task-tool-early-1");
    expect(childToolComplete?.data.parentAgentId).toBe("task-tool-early-1");

    adapterWithClient.dispose();
  });

  test("drops OpenCode child-session text even when task metadata identifies the child session before subagent.start", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-task-session-text",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research TUI UX practices",
          subagent_type: "codebase-online-researcher",
        },
        toolMetadata: {
          sessionId: "child-session-text-prestart",
        },
        toolUseId: "task-tool-text-prestart",
      },
    } as AgentEvent<"tool.start">);

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: "child-session-text-prestart",
      timestamp: Date.now(),
      data: {
        delta: "child task response",
        contentType: "text",
      },
    } as AgentEvent<"message.delta">);

    await streamPromise;

    expect(
      events.some(
        (e) => e.type === "stream.text.delta"
          && e.data.delta === "child task response",
      ),
    ).toBe(false);
  });

  test("does not emit synthetic task-agent progress updates when child telemetry is missing", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Locate TUI code",
          subagent_type: "codebase-locator",
        },
        toolUseId: "task-tool-fallback-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolResult: "done",
        success: true,
        toolUseId: "task-tool-fallback-1",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    expect(
      events.some((e) => e.type === "stream.agent.start" || e.type === "stream.agent.update"),
    ).toBe(false);
  });

  test("buffers early tool events before subagent.start and replays tool usage updates", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "glob",
        toolInput: { pattern: "**/*.ts" },
        toolUseId: "early-tool-open-1",
        parentId: "agent-early-open-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-early-open-1",
        subagentType: "explore",
        task: "Find TypeScript files",
        toolCallId: "task-call-early-open-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const updates = events.filter(
      (e) => e.type === "stream.agent.update" && e.data.agentId === "agent-early-open-1",
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates.some((e) => e.data.currentTool === "glob" && e.data.toolUses === 1)).toBe(true);
  });

  test("does not double-count subagent tool usage for repeated tool.start lifecycle updates", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-repeat-start-1",
        subagentType: "debugger",
        task: "Investigate repeated tool starts",
        toolCallId: "task-repeat-start-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo pending", state: "pending" },
        toolCallId: "inner-repeat-start-1",
        parentId: "agent-repeat-start-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo running", state: "running" },
        toolCallId: "inner-repeat-start-1",
        parentId: "agent-repeat-start-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolResult: "ok",
        success: true,
        toolCallId: "inner-repeat-start-1",
        parentId: "agent-repeat-start-1",
      },
    } as AgentEvent<"tool.complete">);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-repeat-start-1",
        success: true,
        result: "done",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    const toolStartEvents = events.filter(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "inner-repeat-start-1",
    );
    expect(toolStartEvents.length).toBe(2);

    const agentUpdateEvents = events.filter(
      (e) => e.type === "stream.agent.update" && e.data.agentId === "agent-repeat-start-1",
    );
    expect(
      agentUpdateEvents.filter((e) => e.data.currentTool === "bash").length,
    ).toBe(1);
    expect(
      agentUpdateEvents.some((e) => e.data.currentTool === undefined && e.data.toolUses === 1),
    ).toBe(true);
    expect(Math.max(...agentUpdateEvents.map((e) => e.data.toolUses ?? 0))).toBe(1);
  });

  test("publishes subagent progress updates on tool.partial_result", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-partial-1",
        subagentType: "debugger",
        task: "Track live tool progress",
        toolCallId: "task-partial-1",
        subagentSessionId: "child-session-partial-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-partial-1",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "tail -f logs" },
        toolCallId: "inner-partial-1",
        parentId: "agent-partial-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.partial_result" as EventType, {
      type: "tool.partial_result",
      sessionId: "child-session-partial-1",
      timestamp: Date.now(),
      data: {
        toolCallId: "inner-partial-1",
        partialOutput: "line 1",
      },
    } as AgentEvent<"tool.partial_result">);

    await streamPromise;

    const progressUpdates = events.filter(
      (e) =>
        e.type === "stream.agent.update"
        && e.data.agentId === "agent-partial-1"
        && e.data.currentTool === "bash",
    );
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    expect(progressUpdates.some((e) => e.data.toolUses === 1)).toBe(true);
  });

  test("publishes session truncation and compaction events from SDK client", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("session.truncation" as EventType, {
      type: "session.truncation",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { tokenLimit: 1000, tokensRemoved: 250, messagesRemoved: 3 },
    } as AgentEvent<"session.truncation">);

    client.emit("session.compaction" as EventType, {
      type: "session.compaction",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { phase: "complete", success: false, error: "summarize failed" },
    } as AgentEvent<"session.compaction">);

    await streamPromise;

    const truncationEvent = events.find(
      (event) => event.type === "stream.session.truncation",
    );
    expect(truncationEvent).toBeDefined();
    expect(truncationEvent?.runId).toBe(42);
    expect(truncationEvent?.data).toEqual({
      tokenLimit: 1000,
      tokensRemoved: 250,
      messagesRemoved: 3,
    });

    const compactionEvent = events.find(
      (event) => event.type === "stream.session.compaction",
    );
    expect(compactionEvent).toBeDefined();
    expect(compactionEvent?.runId).toBe(42);
    expect(compactionEvent?.data).toEqual({
      phase: "complete",
      success: false,
      error: "summarize failed",
    });
  });

  test("resolves sendAsync completionPromise immediately on external abort", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([]), client) as Session & {
      sendAsync: ReturnType<typeof mock>;
    };
    session.sendAsync = mock(async () => {});

    const externalAbort = new AbortController();
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
      abortSignal: externalAbort.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    externalAbort.abort();

    const completion = await Promise.race([
      streamPromise.then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 50)),
    ]);

    expect(completion).toBe("resolved");

    const idleEvents = events.filter((e) => e.type === "stream.session.idle");
    expect(idleEvents.length).toBe(1);
    expect(idleEvents[0].data.reason).toBe("aborted");
  });

  test("publishes orphaned tool.complete before session.idle on aborted sendAsync runs", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([]), client) as Session & {
      sendAsync: ReturnType<typeof mock>;
    };
    session.sendAsync = mock(async () => {
      client.emit("tool.start" as EventType, {
        type: "tool.start",
        sessionId: "test-session-123",
        timestamp: Date.now(),
        data: {
          toolName: "task",
          toolInput: { description: "Research TUI UX practices" },
          toolUseId: "tool-abort-order-1",
        },
      } as AgentEvent<"tool.start">);
    });

    const externalAbort = new AbortController();
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
      abortSignal: externalAbort.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    externalAbort.abort();
    await streamPromise;

    const completeIdx = events.findIndex(
      (event) =>
        event.type === "stream.tool.complete"
        && event.data.toolId === "tool-abort-order-1"
        && event.data.error === "Tool execution aborted",
    );
    const idleIdx = events.findIndex(
      (event) =>
        event.type === "stream.session.idle"
        && event.data.reason === "aborted",
    );

    expect(completeIdx).toBeGreaterThan(-1);
    expect(idleIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeLessThan(idleIdx);
  });

  test("passes abortSignal to sendAsync and exits stalled dispatch on external abort", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([]), client) as Session & {
      sendAsync: ReturnType<typeof mock>;
    };
    session.sendAsync = mock(
      async (
        _message: string,
        options?: { agent?: string; abortSignal?: AbortSignal },
      ) => {
        await new Promise<void>((_resolve, reject) => {
          if (options?.abortSignal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          options?.abortSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );

    const externalAbort = new AbortController();
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
      abortSignal: externalAbort.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    externalAbort.abort();

    const completion = await Promise.race([
      streamPromise.then(() => "resolved"),
      new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 100)),
    ]);

    expect(completion).toBe("resolved");
    expect(session.sendAsync).toHaveBeenCalledTimes(1);
    expect(session.sendAsync.mock.calls[0][1]?.abortSignal).toBeDefined();

    const idleEvents = events.filter((e) => e.type === "stream.session.idle");
    expect(idleEvents.length).toBe(1);
    expect(idleEvents[0].data.reason).toBe("aborted");

    const errorEvents = events.filter((e) => e.type === "stream.session.error");
    expect(errorEvents.length).toBe(0);
  });

  test("publishes session error on stream error", async () => {
    const events = collectEvents(bus);

    // Create a stream that throws an error
    async function* errorStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      throw new Error("Stream error");
    }

    const session = createMockSession(errorStream());

    await adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    const errorEvents = events.filter(
      (e) => e.type === "stream.session.error",
    );
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].data.error).toBe("Stream error");
    expect(errorEvents[0].runId).toBe(42);
  });

  test("dispose() stops processing via AbortController", async () => {
    const events = collectEvents(bus);

    async function* controlledStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "chunk1" };
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "chunk2" };
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "chunk3" };
    }

    const session = createMockSession(controlledStream());

    adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 2));
    adapter.dispose();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const deltaEvents = events.filter((e) => e.type === "stream.text.delta");
    expect(deltaEvents.length).toBeLessThanOrEqual(2);
  });

  test("events include correct runId from options", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "test" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, createMockClient());

    await adapter.startStreaming(session, "test message", {
      runId: 999,
      messageId: "msg-1",
    });

    // All events should have runId 999
    expect(events.every((e) => e.runId === 999)).toBe(true);
  });

  test("publishes thinking delta events", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      {
        type: "thinking",
        content: "Let me think...",
        metadata: { thinkingSourceKey: "block-1" },
      },
      {
        type: "thinking",
        content: "about this problem",
        metadata: { thinkingSourceKey: "block-1" },
      },
      {
        type: "thinking",
        content: "",
        metadata: {
          thinkingSourceKey: "block-1",
          streamingStats: { thinkingMs: 1234 },
        },
      },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, createMockClient());

    await adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    const thinkingDeltaEvents = events.filter(
      (e) => e.type === "stream.thinking.delta",
    );
    expect(thinkingDeltaEvents.length).toBe(2);
    expect(thinkingDeltaEvents[0].data.delta).toBe("Let me think...");
    expect(thinkingDeltaEvents[0].data.sourceKey).toBe("block-1");
    expect(thinkingDeltaEvents[1].data.delta).toBe("about this problem");

    const thinkingCompleteEvents = events.filter(
      (e) => e.type === "stream.thinking.complete",
    );
    expect(thinkingCompleteEvents.length).toBe(1);
    expect(thinkingCompleteEvents[0].data.sourceKey).toBe("block-1");
    expect(thinkingCompleteEvents[0].data.durationMs).toBe(1234);
  });

  test("agent-only OpenCode streams keep root-session reasoning unscoped", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "Explain BM25", {
      runId: 43,
      messageId: "msg-opencode-agent-only",
      agent: "codebase-online-researcher",
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Need to construct the research task first",
        reasoningId: "opencode-agent-only-reasoning",
      },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        reasoningId: "opencode-agent-only-reasoning",
        content: "Need to construct the research task first",
      },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    const thinkingDelta = events.find(
      (e) => e.type === "stream.thinking.delta" && e.data.sourceKey === "opencode-agent-only-reasoning",
    );
    expect(thinkingDelta).toBeDefined();
    expect(thinkingDelta?.data.agentId).toBeUndefined();

    const thinkingComplete = events.find(
      (e) => e.type === "stream.thinking.complete" && e.data.sourceKey === "opencode-agent-only-reasoning",
    );
    expect(thinkingComplete).toBeDefined();
    expect(thinkingComplete?.data.agentId).toBeUndefined();
    expect(events.some((e) => e.type === "stream.agent.start")).toBe(false);
  });

  test("agent-only OpenCode streams do not promote root-session tools into a subagent tree", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "Explain the BM25 algorithm", {
      runId: 43,
      messageId: "msg-opencode-agent-tool-tree",
      agent: "codebase-online-researcher",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "report_intent",
        toolInput: { intent: "Researching BM25" },
        toolUseId: "opencode-agent-tool-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "opencode-real-agent-1",
        subagentType: "codebase-online-researcher",
        task: "Explain the BM25 algorithm",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "report_intent",
        toolUseId: "opencode-agent-tool-1",
        toolResult: "ok",
        success: true,
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const earlyToolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "opencode-agent-tool-1",
    );
    expect(earlyToolStart).toBeDefined();
    expect(earlyToolStart?.data.parentAgentId).toBeUndefined();

    const promotedToolComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "opencode-agent-tool-1",
    );
    expect(promotedToolComplete).toBeDefined();
    expect(promotedToolComplete?.data.parentAgentId).toBeUndefined();
  });

  test("unmapped event types are ignored", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "test" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    // Emit an unmapped event type
    client.emit("unknown.event" as EventType, {
      type: "unknown.event",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {},
    } as AgentEvent);

    await streamPromise;

    // Should only have session.start, text delta, text complete, and session.idle events
    expect(events.length).toBe(4);
    expect(events.some((e) => e.type === "stream.text.delta")).toBe(true);
    expect(events.some((e) => e.type === "stream.text.complete")).toBe(true);
    expect(events.some((e) => e.type === "stream.session.idle")).toBe(true);
  });

  test("complete events are published at stream end", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      { type: "text", content: "Hello" },
      { type: "text", content: " world" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, createMockClient());

    await adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    // Text complete event should precede the session.idle event
    const completeIdx = events.findIndex((e) => e.type === "stream.text.complete");
    const idleIdx = events.findIndex((e) => e.type === "stream.session.idle");
    expect(completeIdx).toBeGreaterThan(-1);
    expect(idleIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeLessThan(idleIdx);

    // Session.idle is always the final event
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe("stream.session.idle");

    // Text complete event should still contain the full text
    const completeEvent = events.find((e) => e.type === "stream.text.complete");
    expect(completeEvent?.data.fullText).toBe("Hello world");
  });

  test("strict runtime contract normalizes OpenCode subagent task metadata", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
      runtimeFeatureFlags: {
        strictTaskContract: true,
      },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-oc-1",
        subagentType: "explore",
        task: "   ",
        toolInput: {
          description: "Inspect auth paths",
          mode: "background",
        },
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.task).toBe("Inspect auth paths");
    expect(agentStartEvents[0].data.isBackground).toBe(true);
  });

  test("strict runtime contract keeps synthetic turn id stable in OpenCode", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
      runtimeFeatureFlags: {
        strictTaskContract: true,
      },
    });

    client.emit("turn.start" as EventType, {
      type: "turn.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {},
    } as AgentEvent<"turn.start">);

    client.emit("turn.end" as EventType, {
      type: "turn.end",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { stop_reason: "tool_use" },
    } as AgentEvent<"turn.end">);

    await streamPromise;

    const turnStartEvents = events.filter((e) => e.type === "stream.turn.start");
    const turnEndEvents = events.filter((e) => e.type === "stream.turn.end");
    expect(turnStartEvents.length).toBe(1);
    expect(turnEndEvents.length).toBe(1);
    expect(turnStartEvents[0].data.turnId).toMatch(/^turn_/);
    expect(turnEndEvents[0].data.turnId).toBe(turnStartEvents[0].data.turnId);
    expect(turnEndEvents[0].data.finishReason).toBe("tool-calls");
    expect(turnEndEvents[0].data.rawFinishReason).toBe("tool_use");
  });

  test("maps reasoning events from SDK client to thinking events", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        reasoningId: "reasoning-1",
        delta: "thinking...",
      },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        reasoningId: "reasoning-1",
        content: "done",
      },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    expect(events.some((e) => e.type === "stream.thinking.delta" && e.data.sourceKey === "reasoning-1")).toBe(true);
    expect(events.some((e) => e.type === "stream.thinking.complete" && e.data.sourceKey === "reasoning-1")).toBe(true);
  });

  test("treats message.delta contentType=reasoning as thinking", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const adapterWithClient = new OpenCodeStreamAdapter(bus, "test-session-123", client);

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapterWithClient.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-reasoning-content-type",
    });

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        delta: "reasoning via content type",
        contentType: "reasoning",
        thinkingSourceKey: "reasoning-content-type-1",
      },
    } as AgentEvent<"message.delta">);

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        message: "",
      },
    } as AgentEvent<"message.complete">);

    await streamPromise;

    expect(
      events.some(
        (event) => event.type === "stream.thinking.delta"
          && event.data.sourceKey === "reasoning-content-type-1"
          && event.data.delta === "reasoning via content type",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) => event.type === "stream.text.delta"
          && event.data.delta === "reasoning via content type",
      ),
    ).toBe(false);
  });

  test("bridges callId-first subagent.start to later Task toolUseId and preserves a single canonical correlation", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-call-first",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-call-first",
        subagentType: "debugger",
        task: "Sub-agent task",
        toolCallId: "call-only-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Task",
        toolInput: { description: "Investigate OpenCode parity" },
        toolUseId: "tool-use-1",
      },
    } as AgentEvent<"tool.start">);

    // Replay event from SDK with newly-populated subagentSessionId but missing call IDs.
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-call-first",
        subagentType: "debugger",
        task: "Sub-agent task",
        subagentSessionId: "child-session-oc-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const toolStartEvents = events.filter((e) => e.type === "stream.tool.start");
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.toolId).toBe("tool-use-1");
    expect(toolStartEvents[0].data.sdkCorrelationId).toBe("tool-use-1");

    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && e.data.agentId === "agent-call-first",
    );
    expect(agentStartEvents.length).toBe(2);
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("call-only-1");
    expect(agentStartEvents[1].data.sdkCorrelationId).toBe("tool-use-1");
    expect(agentStartEvents[1].data.task).toBe("Investigate OpenCode parity");
  });

  test("maps subagent.start callId-only events onto pending Task toolUseId metadata", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-pending-fallback",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Find orphaned sub-agent branches" },
        toolUseId: "tool-use-task-2",
      },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-pending-link",
        subagentType: "explore",
        task: "sub-agent task",
        toolCallId: "call-only-2",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && e.data.agentId === "agent-pending-link",
    );
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("tool-use-task-2");
    expect(agentStartEvents[0].data.task).toBe("Find orphaned sub-agent branches");
  });

  test("tags OpenCode subagent skill invocations so the top-level skill UI can ignore them", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const adapterWithClient = new OpenCodeStreamAdapter(bus, "test-session-123", client);

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapterWithClient.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-skill-agent",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-opencode-skill-1",
        subagentType: "explore",
        task: "Investigate",
        toolUseId: "tool-opencode-skill-1",
        subagentSessionId: "child-session-opencode-skill-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("skill.invoked" as EventType, {
      type: "skill.invoked",
      sessionId: "child-session-opencode-skill-1",
      timestamp: Date.now(),
      data: {
        skillName: "frontend-design",
        skillPath: "skills/frontend-design/SKILL.md",
      },
    } as AgentEvent<"skill.invoked">);

    await streamPromise;

    const skillEvent = events.find((e) => e.type === "stream.skill.invoked");
    expect(skillEvent).toBeDefined();
    expect(skillEvent?.data.skillName).toBe("frontend-design");
    expect(skillEvent?.data.agentId).toBe("agent-opencode-skill-1");
  });
});

// ============================================================================
// ClaudeStreamAdapter Tests
// ============================================================================

describe("ClaudeStreamAdapter", () => {
  let bus: EventBus;
  let adapter: ClaudeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123");
  });

  test("publishes text delta events from mock stream", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      { type: "text", content: "Hello " },
      { type: "text", content: "Claude" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, {});

    await adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    // Should have session.start + 2 delta events + 1 complete event + 1 idle
    expect(events.length).toBe(5);

    const deltaEvents = events.filter((e) => e.type === "stream.text.delta");
    expect(deltaEvents.length).toBe(2);
    expect(deltaEvents[0].data.delta).toBe("Hello ");
    expect(deltaEvents[0].data.messageId).toBe("msg-2");
    expect(deltaEvents[0].runId).toBe(100);
    expect(deltaEvents[1].data.delta).toBe("Claude");

    const completeEvent = events.find((e) => e.type === "stream.text.complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.data.fullText).toBe("Hello Claude");
    expect(completeEvent?.runId).toBe(100);
  });

  test("publishes thinking delta and complete events", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Reasoning step 1",
        reasoningId: "reasoning-1",
      },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Reasoning step 2",
        reasoningId: "reasoning-1",
      },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        reasoningId: "reasoning-1",
        content: "Reasoning step 1Reasoning step 2",
      },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    const thinkingDeltaEvents = events.filter(
      (e) => e.type === "stream.thinking.delta",
    );
    expect(thinkingDeltaEvents.length).toBe(2);
    expect(thinkingDeltaEvents[0].data.delta).toBe("Reasoning step 1");
    expect(thinkingDeltaEvents[0].data.sourceKey).toBe("reasoning-1");
    expect(thinkingDeltaEvents[1].data.delta).toBe("Reasoning step 2");

    const thinkingCompleteEvents = events.filter(
      (e) => e.type === "stream.thinking.complete",
    );
    expect(thinkingCompleteEvents.length).toBe(1);
    expect(thinkingCompleteEvents[0].data.sourceKey).toBe("reasoning-1");
    expect(thinkingCompleteEvents[0].data.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("publishes session idle from stream completion and ignores client idle events", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    // Client-level idle events are ignored for Claude to prevent stale
    // previous-run idle markers from being reassigned to the active run.
    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: "other-session",
      timestamp: Date.now(),
      data: { reason: "ignored" },
    } as AgentEvent<"session.idle">);

    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { reason: "completed" },
    } as AgentEvent<"session.idle">);

    await streamPromise;

    const idleEvents = events.filter((e) => e.type === "stream.session.idle");
    expect(idleEvents.length).toBe(1);
    expect(idleEvents[0].data.reason).toBe("generator-complete");
    expect(idleEvents[0].runId).toBe(100);
  });

  test("ignores stale client idle emitted after an interrupted run", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const streams: Array<AsyncGenerator<AgentMessage>> = [
      (async function* interruptedRun(): AsyncGenerator<AgentMessage> {
        yield { type: "text", content: "partial" };
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield { type: "text", content: "late" };
      })(),
      (async function* nextRun(): AsyncGenerator<AgentMessage> {
        yield { type: "text", content: "second-run" };
      })(),
    ];

    const session = {
      id: "test-session-123",
      stream: mock(() => streams.shift()!),
      __client: client,
    } as unknown as Session;

    const firstAbort = new AbortController();
    const firstRun = adapter.startStreaming(session, "first", {
      runId: 200,
      messageId: "msg-first",
      abortSignal: firstAbort.signal,
    });
    firstAbort.abort();
    await firstRun;

    const secondRun = adapter.startStreaming(session, "second", {
      runId: 201,
      messageId: "msg-second",
    });

    // Simulate a late idle signal from the interrupted first run arriving
    // while the second run is active.
    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { reason: "completed" },
    } as AgentEvent<"session.idle">);

    await secondRun;

    const secondRunEvents = events.filter((event) => event.runId === 201);
    const secondRunDelta = secondRunEvents.filter((event) => event.type === "stream.text.delta");
    expect(secondRunDelta.length).toBe(1);
    expect(secondRunDelta[0].data.delta).toBe("second-run");

    const secondRunComplete = secondRunEvents.find((event) => event.type === "stream.text.complete");
    expect(secondRunComplete).toBeDefined();
    expect(secondRunComplete?.data.fullText).toBe("second-run");

    const secondRunIdle = secondRunEvents.filter((event) => event.type === "stream.session.idle");
    expect(secondRunIdle.length).toBe(1);
    expect(secondRunIdle[0].data.reason).toBe("generator-complete");
  });

  test("publishes session error on stream error", async () => {
    const events = collectEvents(bus);

    async function* errorStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      throw new Error("Claude API error");
    }

    const session = createMockSession(errorStream());

    await adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    const errorEvents = events.filter(
      (e) => e.type === "stream.session.error",
    );
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].data.error).toBe("Claude API error");
    expect(errorEvents[0].runId).toBe(100);
  });

  test("ignores malformed session.error events with no message or code", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("session.error" as EventType, {
      type: "session.error",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {},
    } as AgentEvent<"session.error">);

    await streamPromise;

    const errorEvents = events.filter((e) => e.type === "stream.session.error");
    expect(errorEvents.length).toBe(0);
  });

  test("dispose() stops processing via AbortController", async () => {
    const events = collectEvents(bus);

    async function* controlledStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "chunk1" };
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "chunk2" };
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "chunk3" };
    }

    const session = createMockSession(controlledStream());

    adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    await new Promise((resolve) => setTimeout(resolve, 2));
    adapter.dispose();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const deltaEvents = events.filter((e) => e.type === "stream.text.delta");
    expect(deltaEvents.length).toBeLessThanOrEqual(2);
  });

  test("events include correct runId from options", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "test" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, {});

    await adapter.startStreaming(session, "test message", {
      runId: 777,
      messageId: "msg-2",
    });

    // All events should have runId 777
    expect(events.every((e) => e.runId === 777)).toBe(true);
  });

  test("unmapped event types are ignored (stream only has text/thinking)", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      { type: "text", content: "test" },
      // Unknown types are ignored by the adapter
      { type: "unknown" as any, content: "ignored" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    await adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    // Should only have session.start, text delta, text.complete, and session.idle events
    expect(events.length).toBe(4);
    expect(events.some((e) => e.type === "stream.text.delta")).toBe(true);
    expect(events.some((e) => e.type === "stream.text.complete")).toBe(true);
  });

  test("complete events are published at stream end", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      { type: "text", content: "First" },
      { type: "text", content: " Second" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    await adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    // Session idle should be the last event after text completion
    const lastEvent = events[events.length - 1];
    const completeEvent = events.find((e) => e.type === "stream.text.complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.data.fullText).toBe("First Second");
    expect(lastEvent.type).toBe("stream.session.idle");
    expect(lastEvent.data.reason).toBe("generator-complete");
  });

  test("publishes tool start events from stream (tool_use)", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      {
        type: "tool_use" as any,
        content: "",
        id: "tool-abc",
        name: "bash",
        input: { command: "ls" },
      } as any,
      { type: "text", content: "done" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, {});

    await adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    const toolStartEvents = events.filter((e) => e.type === "stream.tool.start");
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.toolName).toBe("bash");
    expect(toolStartEvents[0].data.toolId).toBe("tool-abc");
    expect(toolStartEvents[0].data.toolInput).toEqual({ command: "ls" });
    expect(toolStartEvents[0].runId).toBe(100);
  });

  test("publishes tool complete events from stream (tool_result)", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      {
        type: "tool_result" as any,
        content: "file1.txt\nfile2.txt",
        tool_use_id: "tool-abc",
        toolName: "bash",
        is_error: false,
      } as any,
      { type: "text", content: "done" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, {});

    await adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    const toolCompleteEvents = events.filter((e) => e.type === "stream.tool.complete");
    expect(toolCompleteEvents.length).toBe(1);
    expect(toolCompleteEvents[0].data.toolName).toBe("bash");
    expect(toolCompleteEvents[0].data.toolId).toBe("tool-abc");
    expect(toolCompleteEvents[0].data.toolResult).toBe("file1.txt\nfile2.txt");
    expect(toolCompleteEvents[0].data.success).toBe(true);
    expect(toolCompleteEvents[0].runId).toBe(100);
  });

  test("prefers client hook tool events over stream chunk tool events to avoid duplicate unscoped tools", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [
      {
        type: "tool_use",
        content: {
          name: "WebSearch",
          input: { query: "query" },
          toolUseId: "tool-dup-1",
        },
      } as unknown as AgentMessage,
      {
        type: "tool_result",
        content: "ok",
        tool_use_id: "tool-dup-1",
        toolName: "WebSearch",
      } as unknown as AgentMessage,
      { type: "text", content: "done" },
    ];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolInput: { query: "query" },
        toolUseId: "tool-dup-1",
        parentAgentId: "agent-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "tool-dup-1",
        toolResult: "ok",
        success: true,
        parentAgentId: "agent-1",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const toolStartEvents = events.filter((e) => e.type === "stream.tool.start" && e.data.toolId === "tool-dup-1");
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.parentAgentId).toBe("agent-1");

    const toolCompleteEvents = events.filter((e) => e.type === "stream.tool.complete" && e.data.toolId === "tool-dup-1");
    expect(toolCompleteEvents.length).toBe(1);
    expect(toolCompleteEvents[0].data.parentAgentId).toBe("agent-1");
  });

  test("publishes agent start events from subagent.start hook", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    // Simulate subagent.start hook event from the SDK
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: new Date().toISOString(),
      data: {
        subagentId: "agent-001",
        subagentType: "explore",
        task: "Find files",
        toolUseID: "tool_use_123",
      },
    } as AgentEvent);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.agentId).toBe("agent-001");
    expect(agentStartEvents[0].data.agentType).toBe("explore");
    expect(agentStartEvents[0].data.task).toBe("Find files");
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("tool_use_123");
    expect(agentStartEvents[0].runId).toBe(100);
  });

  test("prefers Task description over subagent name on subagent.start", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-claude-task-description",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-description-priority-1",
        subagentType: "codebase-locator",
        task: "codebase-locator",
        description: "Locate sub-agent tree label derivation",
        toolUseID: "tool-use-description-priority-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvent = events.find(
      (e) => e.type === "stream.agent.start" && e.data.agentId === "agent-description-priority-1",
    );
    expect(agentStartEvent?.data.task).toBe("Locate sub-agent tree label derivation");
  });

  test("publishes subagent progress updates on tool.partial_result", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-partial-claude-1",
        subagentType: "explore",
        task: "Watch streaming tool output",
        toolUseID: "tool-use-parent-claude-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "tail -f logs" },
        toolCallId: "inner-partial-claude-1",
        parentId: "agent-partial-claude-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.partial_result" as EventType, {
      type: "tool.partial_result",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolCallId: "inner-partial-claude-1",
        partialOutput: "line 1",
      },
    } as AgentEvent<"tool.partial_result">);

    await streamPromise;

    const progressUpdates = events.filter(
      (e) =>
        e.type === "stream.agent.update"
        && e.data.agentId === "agent-partial-claude-1"
        && e.data.currentTool === "bash",
    );
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    expect(progressUpdates.some((e) => e.data.toolUses === 1)).toBe(true);
  });

  test("accepts child-session tool events when parentAgent correlation is present", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-session-1",
        subagentType: "debugger",
        task: "Investigate child session event routing",
        toolUseID: "tool-use-child-parent-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-1",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo ok" },
        toolCallId: "child-tool-1",
        parentId: "agent-child-session-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const toolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-1",
    );
    expect(toolStart).toBeDefined();
    expect(toolStart?.data.parentAgentId).toBe("agent-child-session-1");

    const progressUpdates = events.filter(
      (e) =>
        e.type === "stream.agent.update"
        && e.data.agentId === "agent-child-session-1"
        && e.data.currentTool === "bash"
        && e.data.toolUses === 1,
    );
    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
  });

  test("routes nested child-session tool and streaming updates to the correct subagent", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "spawn nested researchers", {
      runId: 100,
      messageId: "msg-nested-child-session",
      agent: "codebase-online-researcher",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "child A" },
        toolUseId: "task-tool-a",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "child B" },
        toolUseId: "task-tool-b",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "child C" },
        toolUseId: "task-tool-c",
      },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-a",
        subagentType: "researcher",
        task: "child A",
        toolCallId: "task-tool-a",
        subagentSessionId: "child-session-a",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-b",
        subagentType: "researcher",
        task: "child B",
        toolCallId: "task-tool-b",
        subagentSessionId: "child-session-b",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-c",
        subagentType: "researcher",
        task: "child C",
        toolCallId: "task-tool-c",
        subagentSessionId: "child-session-c",
      },
    } as AgentEvent<"subagent.start">);

    // Nested child stream: no direct parent metadata, only child session identity.
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-b",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolInput: { query: "nested subagent tree" },
        toolUseId: "child-b-tool-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.partial_result" as EventType, {
      type: "tool.partial_result",
      sessionId: "child-session-b",
      timestamp: Date.now(),
      data: {
        toolCallId: "child-b-tool-1",
        partialOutput: "streaming...",
      },
    } as AgentEvent<"tool.partial_result">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "child-session-b",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "child-b-tool-1",
        toolResult: { ok: true },
        success: true,
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const nestedToolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-b-tool-1",
    );
    expect(nestedToolStart).toBeDefined();
    expect(nestedToolStart?.data.parentAgentId).toBe("agent-child-b");

    const nestedPartial = events.find(
      (e) => e.type === "stream.tool.partial_result" && e.data.toolCallId === "child-b-tool-1",
    );
    expect(nestedPartial).toBeDefined();
    expect(nestedPartial?.data.parentAgentId).toBe("agent-child-b");

    const nestedToolComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "child-b-tool-1",
    );
    expect(nestedToolComplete).toBeDefined();
    expect(nestedToolComplete?.data.parentAgentId).toBe("agent-child-b");

    const nestedUpdates = events.filter(
      (e) => e.type === "stream.agent.update" && e.data.agentId === "agent-child-b",
    );
    expect(nestedUpdates.some((e) => e.data.currentTool === "WebSearch" && e.data.toolUses === 1)).toBe(true);
    expect(nestedUpdates.some((e) => e.data.currentTool === undefined && e.data.toolUses === 1)).toBe(true);
  });

  test("attributes unscoped main-session tool events to the sole active subagent", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-unscoped-1",
        subagentType: "Explore",
        task: "Explore repository",
        toolUseID: "tool-parent-unscoped-1",
      },
    } as AgentEvent<"subagent.start">);

    // Mirrors the failing log pattern: tool events on the parent session with
    // no parentId/parentToolUseId metadata.
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Bash",
        toolInput: { command: "ls -la" },
        toolUseId: "tool-unscoped-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const toolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "tool-unscoped-1",
    );
    expect(toolStart).toBeDefined();
    expect(toolStart?.data.parentAgentId).toBe("agent-unscoped-1");

    const progressUpdates = events.filter(
      (e) =>
        e.type === "stream.agent.update"
        && e.data.agentId === "agent-unscoped-1"
        && e.data.currentTool === "Bash"
        && e.data.toolUses === 1,
    );
    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
  });

  test("attributes parallel unscoped tool events via TaskOutput task_id and active tool context", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 101,
      messageId: "msg-parallel-taskoutput",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-parallel-a",
        subagentType: "research",
        task: "Research A",
        toolUseID: "task-tool-a",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-parallel-b",
        subagentType: "research",
        task: "Research B",
        toolUseID: "task-tool-b",
      },
    } as AgentEvent<"subagent.start">);

    // SDK can omit parent metadata in parallel mode; TaskOutput carries task_id.
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "TaskOutput",
        toolUseId: "task-output-1",
        toolInput: { task_id: "agent-parallel-a", block: true },
      },
    } as AgentEvent<"tool.start">);

    // Follow-up tools may also be unscoped; attribute using active sub-agent tool context.
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "websearch-1",
        toolInput: { query: "parallel attribution fallback" },
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "websearch-1",
        toolResult: "ok",
        success: true,
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const taskOutputStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "task-output-1",
    );
    expect(taskOutputStart).toBeDefined();
    expect(taskOutputStart?.data.parentAgentId).toBe("agent-parallel-a");

    const webSearchStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "websearch-1",
    );
    expect(webSearchStart).toBeDefined();
    expect(webSearchStart?.data.parentAgentId).toBe("agent-parallel-a");

    const webSearchComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "websearch-1",
    );
    expect(webSearchComplete).toBeDefined();
    expect(webSearchComplete?.data.parentAgentId).toBe("agent-parallel-a");
  });

  test("attributes pre-TaskOutput unscoped tools to active background subagent fallback", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 102,
      messageId: "msg-parallel-pre-taskoutput",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Background A", run_in_background: true },
        toolUseId: "task-tool-bg-a",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Background B", run_in_background: true },
        toolUseId: "task-tool-bg-b",
      },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-bg-a",
        subagentType: "research",
        task: "Background A",
        toolUseID: "task-tool-bg-a",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-bg-b",
        subagentType: "research",
        task: "Background B",
        toolUseID: "task-tool-bg-b",
      },
    } as AgentEvent<"subagent.start">);

    // This mirrors leaked events before first TaskOutput arrives.
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Read",
        toolUseId: "pre-taskoutput-read-1",
        toolInput: { file_path: "README.md" },
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const readStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "pre-taskoutput-read-1",
    );
    expect(readStart).toBeDefined();
    expect(readStart?.data.parentAgentId).toBe("agent-bg-a");
  });

  test("attributes child-session tools via background fallback when parent correlation is unresolved", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 102,
      messageId: "msg-child-session-bg-fallback",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Background A", run_in_background: true },
        toolUseId: "task-tool-bg-a",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Background B", run_in_background: true },
        toolUseId: "task-tool-bg-b",
      },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-bg-a",
        subagentType: "research",
        task: "Background A",
        toolUseID: "task-tool-bg-a",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-bg-b",
        subagentType: "research",
        task: "Background B",
        toolUseID: "task-tool-bg-b",
      },
    } as AgentEvent<"subagent.start">);

    // Child-session event that carries a parentToolUseId we cannot resolve.
    // Adapter should still attribute this to active background context.
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-unknown",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "child-bg-tool-1",
        toolInput: { query: "tree sync leakage" },
        parentToolUseId: "missing-parent-correlation",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "child-session-unknown",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "child-bg-tool-1",
        toolResult: { ok: true },
        success: true,
        parentToolUseId: "missing-parent-correlation",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const toolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-bg-tool-1",
    );
    expect(toolStart).toBeDefined();
    expect(toolStart?.data.parentAgentId).toBe("agent-bg-a");

    const toolComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "child-bg-tool-1",
    );
    expect(toolComplete).toBeDefined();
    expect(toolComplete?.data.parentAgentId).toBe("agent-bg-a");
  });

  test("preserves parentAgentId on orphaned tool completions during cleanup", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 103,
      messageId: "msg-orphan-parent-preservation",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-orphan-1",
        subagentType: "Explore",
        task: "Explore repository",
        toolUseID: "tool-parent-orphan-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Bash",
        toolInput: { command: "ls -la" },
        toolUseId: "tool-orphan-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const orphanedComplete = events.find(
      (e) =>
        e.type === "stream.tool.complete"
        && e.data.toolId === "tool-orphan-1"
        && e.data.error === "Tool execution aborted",
    );
    expect(orphanedComplete).toBeDefined();
    expect(orphanedComplete?.data.parentAgentId).toBe("agent-orphan-1");
  });

  test("normalizes OpenCode subagent correlation IDs to the canonical tool ID", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    // Tool emits both IDs. Adapter canonicalizes to toolUseId as toolId,
    // while preserving an alias so subagent.start with toolCallId still maps.
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: new Date().toISOString(),
      data: {
        toolName: "Task",
        toolInput: { description: "Investigate" },
        toolUseId: "tool-use-123",
        toolCallId: "call-456",
      },
    } as AgentEvent);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: new Date().toISOString(),
      data: {
        subagentId: "agent-001",
        subagentType: "explore",
        task: "Find files",
        toolCallId: "call-456",
      },
    } as AgentEvent);

    await streamPromise;

    // Task tools are suppressed from the stream (represented by agent tree instead)
    const toolStartEvents = events.filter((e) => e.type === "stream.tool.start");
    expect(toolStartEvents.length).toBe(0);

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("tool-use-123");
  });

  test("agent-only streams publish synthetic foreground agent lifecycle with tool progress", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "Investigate auth retries", {
      runId: 101,
      messageId: "msg-agent-only",
      agent: "debugger",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "rg auth" },
        toolUseId: "tool-agent-only-1",
      },
    } as AgentEvent);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolUseId: "tool-agent-only-1",
        toolResult: "ok",
        success: true,
      },
    } as AgentEvent);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.agentType).toBe("debugger");
    expect(agentStartEvents[0].data.task).toBe("Investigate auth retries");

    const syntheticAgentId = agentStartEvents[0].data.agentId;
    const agentUpdateEvents = events.filter(
      (e) => e.type === "stream.agent.update" && e.data.agentId === syntheticAgentId,
    );
    expect(agentUpdateEvents.some((e) => e.data.currentTool === "bash" && e.data.toolUses === 1)).toBe(true);
    expect(agentUpdateEvents.some((e) => e.data.currentTool === undefined && e.data.toolUses === 1)).toBe(true);

    const agentCompleteEvents = events.filter(
      (e) => e.type === "stream.agent.complete" && e.data.agentId === syntheticAgentId,
    );
    expect(agentCompleteEvents.length).toBe(1);
    expect(agentCompleteEvents[0].data.success).toBe(true);
  });

  test("agent-only streams attribute early reasoning to the synthetic foreground agent", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "Explain BM25", {
      runId: 102,
      messageId: "msg-agent-only-reasoning",
      agent: "codebase-online-researcher",
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Need to invoke the research agent first",
        reasoningId: "reasoning-agent-only-1",
      },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        reasoningId: "reasoning-agent-only-1",
        content: "Need to invoke the research agent first",
      },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    const syntheticAgentStart = events.find(
      (e) => e.type === "stream.agent.start" && e.data.agentType === "codebase-online-researcher",
    );
    expect(syntheticAgentStart).toBeDefined();

    const syntheticAgentId = syntheticAgentStart?.data.agentId;
    const thinkingDelta = events.find(
      (e) => e.type === "stream.thinking.delta" && e.data.sourceKey === "reasoning-agent-only-1",
    );
    expect(thinkingDelta).toBeDefined();
    expect(thinkingDelta?.data.agentId).toBe(syntheticAgentId);

    const thinkingComplete = events.find(
      (e) => e.type === "stream.thinking.complete" && e.data.sourceKey === "reasoning-agent-only-1",
    );
    expect(thinkingComplete).toBeDefined();
    expect(thinkingComplete?.data.agentId).toBe(syntheticAgentId);
  });

  test("uses parent_tool_use_id fallback to hydrate subagent task metadata", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 102,
      messageId: "msg-parent-fallback",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Locate sub-agent tree rendering" },
        toolUseId: "tool-parent-1",
      },
    } as AgentEvent);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-parent-fallback",
        subagentType: "codebase-locator",
        task: "codebase-locator",
        toolCallId: "uuid-1",
        parent_tool_use_id: "tool-parent-1",
      },
    } as AgentEvent);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.task).toBe("Locate sub-agent tree rendering");
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("tool-parent-1");
  });

  test("attributes child tool events via parent_tool_call_id correlation", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 102,
      messageId: "msg-parent-call-correlation",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Correlate by parent call id" },
        toolUseId: "tool-parent-call-1",
      },
    } as AgentEvent);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-parent-call-1",
        subagentType: "codebase-locator",
        task: "codebase-locator",
        toolCallId: "subagent-call-1",
        parent_tool_call_id: "tool-parent-call-1",
      },
    } as AgentEvent);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolInput: { query: "sync parallel agents" },
        toolUseId: "inner-tool-1",
        parent_tool_call_id: "tool-parent-call-1",
      },
    } as AgentEvent);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "inner-tool-1",
        toolResult: "ok",
        success: true,
        parent_tool_call_id: "tool-parent-call-1",
      },
    } as AgentEvent);

    await streamPromise;

    const innerStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "inner-tool-1",
    );
    expect(innerStart).toBeDefined();
    expect(innerStart?.data.parentAgentId).toBe("agent-parent-call-1");

    const innerComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "inner-tool-1",
    );
    expect(innerComplete).toBeDefined();
    expect(innerComplete?.data.parentAgentId).toBe("agent-parent-call-1");
  });

  test("falls back to pending task tool ordering when subagent.start lacks parent correlation", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 103,
      messageId: "msg-pending-fallback",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Find missing sub-agent metadata wiring" },
        toolUseId: "tool-pending-1",
      },
    } as AgentEvent);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-pending-fallback",
        subagentType: "debugger",
        task: "debugger",
        toolCallId: "unmapped-call-id",
      },
    } as AgentEvent);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.task).toBe("Find missing sub-agent metadata wiring");
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("tool-pending-1");
  });

  test("real usage events publish stream.usage with accumulated tokens", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    // Emit first usage event (e.g., first API turn)
    client.emit("usage" as EventType, {
      type: "usage",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        inputTokens: 100,
        outputTokens: 50,
        model: "claude-sonnet-4-20250514",
      },
    } as AgentEvent);

    // Emit second usage event (e.g., second API turn after tool use)
    client.emit("usage" as EventType, {
      type: "usage",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        inputTokens: 200,
        outputTokens: 75,
        model: "claude-sonnet-4-20250514",
      },
    } as AgentEvent);

    await streamPromise;

    const usageEvents = events.filter((e) => e.type === "stream.usage");
    expect(usageEvents.length).toBe(2);
    // First event: accumulated outputTokens = 50
    expect(usageEvents[0].data.inputTokens).toBe(100);
    expect(usageEvents[0].data.outputTokens).toBe(50);
    expect(usageEvents[0].data.model).toBe("claude-sonnet-4-20250514");
    // Second event: accumulated outputTokens = 50 + 75 = 125
    expect(usageEvents[1].data.inputTokens).toBe(200);
    expect(usageEvents[1].data.outputTokens).toBe(125);
  });

  test("zero-valued diagnostics markers are filtered (no stream.usage emitted)", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    // Emit a diagnostics marker with no real token data
    client.emit("usage" as EventType, {
      type: "usage",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        provider: "claude",
        marker: "claude.stream.integrity",
      },
    } as AgentEvent);

    await streamPromise;

    const usageEvents = events.filter((e) => e.type === "stream.usage");
    expect(usageEvents.length).toBe(0);
  });

  test("thinking chunks emit stream.thinking.complete but NOT stream.usage", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Let me think...",
        reasoningId: "block-1",
      },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        reasoningId: "block-1",
        content: "Let me think...",
      },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    // Should have thinking.complete
    const thinkingCompleteEvents = events.filter(
      (e) => e.type === "stream.thinking.complete",
    );
    expect(thinkingCompleteEvents.length).toBe(1);
    expect(thinkingCompleteEvents[0].data.durationMs).toBeGreaterThanOrEqual(0);

    // Should NOT have stream.usage from thinking chunks
    const usageEvents = events.filter((e) => e.type === "stream.usage");
    expect(usageEvents.length).toBe(0);
  });

  test("routes Claude child-session reasoning into agent-scoped thinking events", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 104,
      messageId: "msg-claude-child-reasoning",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-claude-reasoning-1",
        subagentType: "debugger",
        task: "Investigate reasoning routing",
        toolUseID: "task-call-claude-reasoning-1",
        subagentSessionId: "child-session-claude-reasoning-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: "child-session-claude-reasoning-1",
      timestamp: Date.now(),
      data: {
        delta: "Inspecting agent-scoped reasoning",
        reasoningId: "reasoning-child-1",
        parentToolCallId: "task-call-claude-reasoning-1",
      },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: "child-session-claude-reasoning-1",
      timestamp: Date.now(),
      data: {
        reasoningId: "reasoning-child-1",
        content: "Inspecting agent-scoped reasoning",
        parentToolCallId: "task-call-claude-reasoning-1",
      },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    const thinkingDelta = events.find(
      (e) => e.type === "stream.thinking.delta" && e.data.sourceKey === "reasoning-child-1",
    );
    expect(thinkingDelta).toBeDefined();
    expect(thinkingDelta?.data.agentId).toBe("agent-claude-reasoning-1");

    const thinkingComplete = events.find(
      (e) => e.type === "stream.thinking.complete" && e.data.sourceKey === "reasoning-child-1",
    );
    expect(thinkingComplete).toBeDefined();
    expect(thinkingComplete?.data.agentId).toBe("agent-claude-reasoning-1");
  });

  test("routes Claude child-session provider message deltas into agent-scoped text", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123", client);

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 104,
      messageId: "msg-claude-child-text",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-claude-text-1",
        subagentType: "debugger",
        task: "Investigate text routing",
        toolUseID: "task-call-claude-text-1",
        subagentSessionId: "child-session-claude-text-1",
      },
    } as AgentEvent<"subagent.start">);

    (client as ReturnType<typeof createMockClient>).emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "child text chunk",
        contentType: "text",
        nativeSessionId: "child-session-claude-text-1",
      },
      nativeSessionId: "child-session-claude-text-1",
    } as AgentEvent<"message.delta"> & { nativeSessionId: string });

    await streamPromise;

    expect(
      events.some(
        (e) => e.type === "stream.text.delta"
          && e.data.delta === "child text chunk"
          && e.data.agentId === "agent-claude-text-1",
      ),
    ).toBe(true);
  });

  test("routes Claude provider tool events by native child session id", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123", client);

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 104,
      messageId: "msg-claude-provider-tool-child",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-claude-tool-1",
        subagentType: "debugger",
        task: "Investigate tool routing",
        toolUseID: "task-call-claude-tool-1",
        subagentSessionId: "child-session-claude-tool-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo child tool" },
        toolUseId: "child-claude-tool-1",
      },
      nativeSessionId: "child-session-claude-tool-1",
    } as AgentEvent<"tool.start"> & { nativeSessionId: string });

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolResult: "ok",
        success: true,
        toolUseId: "child-claude-tool-1",
      },
      nativeSessionId: "child-session-claude-tool-1",
    } as AgentEvent<"tool.complete"> & { nativeSessionId: string });

    await streamPromise;

    const toolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-claude-tool-1",
    );
    expect(toolStart?.data.parentAgentId).toBe("agent-claude-tool-1");

    const toolComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "child-claude-tool-1",
    );
    expect(toolComplete?.data.parentAgentId).toBe("agent-claude-tool-1");
  });

  test("tags Claude subagent skill invocations so the top-level skill UI can ignore them", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 105,
      messageId: "msg-claude-skill-agent",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-claude-skill-1",
        subagentType: "debugger",
        task: "Investigate",
        toolUseID: "task-call-claude-skill-1",
        subagentSessionId: "child-session-claude-skill-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("skill.invoked" as EventType, {
      type: "skill.invoked",
      sessionId: "child-session-claude-skill-1",
      timestamp: Date.now(),
      data: {
        skillName: "frontend-design",
        skillPath: "skills/frontend-design/SKILL.md",
        parentToolCallId: "task-call-claude-skill-1",
      },
    } as AgentEvent<"skill.invoked">);

    await streamPromise;

    const skillEvent = events.find((e) => e.type === "stream.skill.invoked");
    expect(skillEvent).toBeDefined();
    expect(skillEvent?.data.skillName).toBe("frontend-design");
    expect(skillEvent?.data.agentId).toBe("agent-claude-skill-1");
  });

  test("ignores raw Claude Skill tool chunks so skill loads render only through stream.skill.invoked", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithSkillChunks(): AsyncGenerator<AgentMessage> {
      yield {
        type: "tool_use",
        content: {
          name: "Skill",
          input: {
            name: "frontend-design",
          },
          toolUseId: "skill-tool-1",
        },
      };
      yield {
        type: "tool_result",
        content: { ok: true },
        metadata: {
          toolName: "Skill",
          toolUseId: "skill-tool-1",
        },
      };
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithSkillChunks(), client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 106,
      messageId: "msg-claude-raw-skill-chunks",
    });

    client.emit("skill.invoked" as EventType, {
      type: "skill.invoked",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        skillName: "frontend-design",
        skillPath: "skills/frontend-design/SKILL.md",
      },
    } as AgentEvent<"skill.invoked">);

    await streamPromise;

    expect(
      events.some(
        (e) => e.type === "stream.tool.start" && e.data.toolId === "skill-tool-1",
      ),
    ).toBe(false);
    expect(
      events.some(
        (e) => e.type === "stream.tool.complete" && e.data.toolId === "skill-tool-1",
      ),
    ).toBe(false);
    expect(
      events.some(
        (e) => e.type === "stream.skill.invoked" && e.data.skillName === "frontend-design",
      ),
    ).toBe(true);
  });

  test("publishes agent complete events from subagent.complete hook", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    // Simulate subagent.complete hook event from the SDK
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: "test-session-123",
      timestamp: new Date().toISOString(),
      data: {
        subagentId: "agent-001",
        success: true,
        result: "Found 3 files",
      },
    } as AgentEvent);

    await streamPromise;

    const agentCompleteEvents = events.filter((e) => e.type === "stream.agent.complete");
    expect(agentCompleteEvents.length).toBe(1);
    expect(agentCompleteEvents[0].data.agentId).toBe("agent-001");
    expect(agentCompleteEvents[0].data.success).toBe(true);
    expect(agentCompleteEvents[0].data.result).toBe("Found 3 files");
    expect(agentCompleteEvents[0].runId).toBe(100);
  });

  test("strict runtime contract normalizes Claude subagent task metadata", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
      runtimeFeatureFlags: {
        strictTaskContract: true,
      },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-cl-1",
        subagentType: "research",
        task: "   ",
        toolInput: {
          prompt: "Review deploy logs",
          run_in_background: true,
        },
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.task).toBe("Review deploy logs");
    expect(agentStartEvents[0].data.isBackground).toBe(true);
  });

  test("maps extended Claude client events to canonical stream events", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);
    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { reasoningId: "r-1", delta: "trace" },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { reasoningId: "r-1", content: "trace complete" },
    } as AgentEvent<"reasoning.complete">);

    client.emit("turn.start" as EventType, {
      type: "turn.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {},
    } as AgentEvent<"turn.start">);

    client.emit("turn.end" as EventType, {
      type: "turn.end",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { finish_reason: "end_turn" },
    } as AgentEvent<"turn.end">);

    client.emit("tool.partial_result" as EventType, {
      type: "tool.partial_result",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolCallId: "tool-1", partialOutput: "half" },
    } as AgentEvent<"tool.partial_result">);

    client.emit("session.info" as EventType, {
      type: "session.info",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { infoType: "general", message: "hello" },
    } as AgentEvent<"session.info">);

    client.emit("session.warning" as EventType, {
      type: "session.warning",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { warningType: "general", message: "careful" },
    } as AgentEvent<"session.warning">);

    client.emit("session.title_changed" as EventType, {
      type: "session.title_changed",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { title: "new title" },
    } as AgentEvent<"session.title_changed">);

    client.emit("session.truncation" as EventType, {
      type: "session.truncation",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { tokenLimit: 1000, tokensRemoved: 50, messagesRemoved: 1 },
    } as AgentEvent<"session.truncation">);

    client.emit("session.compaction" as EventType, {
      type: "session.compaction",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { phase: "start" },
    } as AgentEvent<"session.compaction">);

    client.emit("skill.invoked" as EventType, {
      type: "skill.invoked",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { skillName: "frontend-design", skillPath: "skills/front.md" },
    } as AgentEvent<"skill.invoked">);

    client.emit("human_input_required" as EventType, {
      type: "human_input_required",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        requestId: "req-1",
        question: "Proceed?",
        nodeId: "n1",
      },
    } as AgentEvent<"human_input_required">);

    await streamPromise;

    expect(events.some((e) => e.type === "stream.thinking.delta" && e.data.sourceKey === "r-1")).toBe(true);
    expect(events.some((e) => e.type === "stream.thinking.complete" && e.data.sourceKey === "r-1")).toBe(true);
    expect(events.some((e) => e.type === "stream.turn.start")).toBe(true);
    expect(events.some((e) => e.type === "stream.turn.end")).toBe(true);
    const turnEnd = events.find((e) => e.type === "stream.turn.end");
    expect(turnEnd?.data.finishReason).toBe("stop");
    expect(turnEnd?.data.rawFinishReason).toBe("end_turn");
    expect(events.some((e) => e.type === "stream.tool.partial_result")).toBe(true);
    expect(events.some((e) => e.type === "stream.session.info")).toBe(true);
    expect(events.some((e) => e.type === "stream.session.warning")).toBe(true);
    expect(events.some((e) => e.type === "stream.session.title_changed")).toBe(true);
    expect(events.some((e) => e.type === "stream.session.truncation")).toBe(true);
    expect(events.some((e) => e.type === "stream.session.compaction")).toBe(true);
    expect(events.some((e) => e.type === "stream.skill.invoked")).toBe(true);
    expect(events.some((e) => e.type === "stream.human_input_required")).toBe(true);
  });
});

// ============================================================================
// CopilotStreamAdapter Tests
// ============================================================================

describe("CopilotStreamAdapter", () => {
  let bus: EventBus;
  let client: CodingAgentClient;
  let adapter: CopilotStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    client = createMockClient();
    adapter = new CopilotStreamAdapter(bus, client);
  });

  test("publishes text delta events from EventEmitter", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      { type: "text", content: "Hello " },
      { type: "text", content: "Copilot" },
    ];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Emit message.delta events through the client
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Hello ",
        contentType: "text",
      },
    } as AgentEvent<"message.delta">);

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Copilot",
        contentType: "text",
      },
    } as AgentEvent<"message.delta">);

    // Emit message.complete
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        message: "Hello Copilot",
      },
    } as AgentEvent<"message.complete">);

    await streamPromise;

    const deltaEvents = events.filter((e) => e.type === "stream.text.delta");
    expect(deltaEvents.length).toBe(2);
    expect(deltaEvents[0].data.delta).toBe("Hello ");
    expect(deltaEvents[0].data.messageId).toBe("msg-3");
    expect(deltaEvents[0].runId).toBe(200);
    expect(deltaEvents[1].data.delta).toBe("Copilot");

    const completeEvents = events.filter(
      (e) => e.type === "stream.text.complete",
    );
    expect(completeEvents.length).toBe(1);
    expect(completeEvents[0].data.fullText).toBe("Hello Copilot");
    expect(completeEvents[0].runId).toBe(200);
  });

  test("publishes tool start events", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Emit tool.start event
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "view",
        toolInput: { path: "/test" },
        toolCallId: "tool-456",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const toolStartEvents = events.filter(
      (e) => e.type === "stream.tool.start",
    );
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.toolName).toBe("view");
    expect(toolStartEvents[0].data.toolInput).toEqual({ path: "/test" });
    expect(toolStartEvents[0].data.toolId).toBe("tool-456");
    expect(toolStartEvents[0].runId).toBe(200);
  });

  test("normalizes non-object tool input for tool start events", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: "ls -la",
        toolCallId: "tool-raw-input",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const toolStartEvents = events.filter(
      (e) => e.type === "stream.tool.start",
    );
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.toolId).toBe("tool-raw-input");
    expect(toolStartEvents[0].data.toolInput).toEqual({ value: "ls -la" });
  });

  test("publishes tool complete events", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Emit tool.complete event
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "view",
        toolResult: "file contents",
        success: true,
        toolCallId: "tool-456",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const toolCompleteEvents = events.filter(
      (e) => e.type === "stream.tool.complete",
    );
    expect(toolCompleteEvents.length).toBe(1);
    expect(toolCompleteEvents[0].data.toolName).toBe("view");
    expect(toolCompleteEvents[0].data.toolResult).toBe("file contents");
    expect(toolCompleteEvents[0].data.success).toBe(true);
    expect(toolCompleteEvents[0].runId).toBe(200);
  });

  test("publishes session error on stream error", async () => {
    const events = collectEvents(bus);

    async function* errorStream(): AsyncGenerator<AgentMessage> {
      throw new Error("Copilot connection error");
    }

    const session = createMockSession(errorStream());

    await adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    const errorEvents = events.filter(
      (e) => e.type === "stream.session.error",
    );
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].data.error).toBe("Copilot connection error");
    expect(errorEvents[0].runId).toBe(200);
  });

  test("dispose() stops processing", async () => {
    const events = collectEvents(bus);

    async function* longStream(): AsyncGenerator<AgentMessage> {
      for (let i = 0; i < 100; i++) {
        yield { type: "text", content: `chunk${i}` };
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    const session = createMockSession(longStream());

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Dispose immediately
    adapter.dispose();

    await streamPromise;

    // Should have no events or very few events due to early disposal
    // The isActive flag should prevent event emission
    expect(events.length).toBeLessThan(10);
  });

  test("events include correct runId from options", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "test" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 888,
      messageId: "msg-3",
    });

    // Emit an event
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "test",
        contentType: "text",
      },
    } as AgentEvent<"message.delta">);

    await streamPromise;

    // All events should have runId 888
    expect(events.every((e) => e.runId === 888)).toBe(true);
  });

  test("unmapped event types are ignored", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "test" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Emit an unmapped event type
    client.emit("unknown.event" as EventType, {
      type: "unknown.event",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {},
    } as AgentEvent);

    // Emit a mapped event
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "test",
        contentType: "text",
      },
    } as AgentEvent<"message.delta">);

    await streamPromise;

    // Should only have events from mapped types
    const deltaEvents = events.filter((e) => e.type === "stream.text.delta");
    expect(deltaEvents.length).toBe(1);

    // No unknown events should be published
    expect(events.every((e) => e.type.startsWith("stream."))).toBe(true);
  });

  test("complete events are published at stream end", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "test" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Emit message deltas
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Hello",
        contentType: "text",
      },
    } as AgentEvent<"message.delta">);

    // Emit message.complete
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        message: "Hello",
      },
    } as AgentEvent<"message.complete">);

    // Emit session.idle — mirrors the real Copilot SDK, which dispatches
    // session.idle through the client-level event system after all
    // agentic processing completes.
    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reason: "idle" },
    } as AgentEvent<"session.idle">);

    await streamPromise;

    // Should have idle event from the client-level session.idle subscription
    const idleEvents = events.filter((e) => e.type === "stream.session.idle");
    expect(idleEvents.length).toBeGreaterThanOrEqual(1);

    // Should have complete event
    const completeEvents = events.filter(
      (e) => e.type === "stream.text.complete",
    );
    expect(completeEvents.length).toBe(1);
  });

  test("strict runtime contract keeps synthetic turn id stable in Copilot", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-turn-strict",
      runtimeFeatureFlags: {
        strictTaskContract: true,
      },
    });

    client.emit("turn.start" as EventType, {
      type: "turn.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {},
    } as AgentEvent<"turn.start">);

    client.emit("turn.end" as EventType, {
      type: "turn.end",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { finishReason: "length" },
    } as AgentEvent<"turn.end">);

    await streamPromise;

    const turnStartEvents = events.filter((e) => e.type === "stream.turn.start");
    const turnEndEvents = events.filter((e) => e.type === "stream.turn.end");
    expect(turnStartEvents.length).toBe(1);
    expect(turnEndEvents.length).toBe(1);
    expect(turnStartEvents[0].data.turnId).toMatch(/^turn_/);
    expect(turnEndEvents[0].data.turnId).toBe(turnStartEvents[0].data.turnId);
    expect(turnEndEvents[0].data.finishReason).toBe("max-tokens");
    expect(turnEndEvents[0].data.rawFinishReason).toBe("length");
  });

  test("strict runtime contract falls back subagent task to agent type in Copilot", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 200,
      messageId: "msg-task-strict",
      runtimeFeatureFlags: {
        strictTaskContract: true,
      },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-strict-1",
        subagentType: "general-purpose",
        task: "   ",
        toolCallId: "strict-task-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.task).toBe("general-purpose");
    expect(agentStartEvents[0].data.isBackground).toBe(false);
  });

  test("publishes thinking delta events from message.delta with thinking content", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Emit thinking deltas
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Thinking about this...",
        contentType: "thinking",
        thinkingSourceKey: "reason-1",
      },
    } as AgentEvent<"message.delta">);

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "conclusion reached",
        contentType: "thinking",
        thinkingSourceKey: "reason-1",
      },
    } as AgentEvent<"message.delta">);

    // Emit message.complete to trigger thinking complete
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        message: "",
      },
    } as AgentEvent<"message.complete">);

    await streamPromise;

    const thinkingDeltaEvents = events.filter(
      (e) => e.type === "stream.thinking.delta",
    );
    expect(thinkingDeltaEvents.length).toBe(2);
    expect(thinkingDeltaEvents[0].data.delta).toBe("Thinking about this...");
    expect(thinkingDeltaEvents[0].data.sourceKey).toBe("reason-1");
    expect(thinkingDeltaEvents[1].data.delta).toBe("conclusion reached");

    const thinkingCompleteEvents = events.filter(
      (e) => e.type === "stream.thinking.complete",
    );
    expect(thinkingCompleteEvents.length).toBe(1);
    expect(thinkingCompleteEvents[0].data.sourceKey).toBe("reason-1");
  });

  test("agent-only Copilot streams attribute early message thinking to a synthetic foreground agent", async () => {
    const events = collectEvents(bus);

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay());

    const streamPromise = adapter.startStreaming(session, "Explain the BM25 algorithm", {
      runId: 200,
      messageId: "msg-copilot-agent-only-thinking",
      agent: "codebase-online-researcher",
    });

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Need to delegate this to the research agent first",
        contentType: "thinking",
        thinkingSourceKey: "copilot-agent-only-thinking-1",
      },
    } as AgentEvent<"message.delta">);

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        message: "",
      },
    } as AgentEvent<"message.complete">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-subagent-early-thinking-1",
        subagentType: "codebase-online-researcher",
        task: "Explain the BM25 algorithm",
        toolCallId: "copilot-task-call-early-thinking-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const syntheticAgentStart = events.find(
      (e) => e.type === "stream.agent.start" && e.data.agentId === "agent-only-msg-copilot-agent-only-thinking",
    );
    expect(syntheticAgentStart).toBeDefined();

    const thinkingDelta = events.find(
      (e) => e.type === "stream.thinking.delta" && e.data.sourceKey === "copilot-agent-only-thinking-1",
    );
    expect(thinkingDelta).toBeDefined();
    expect(thinkingDelta?.data.agentId).toBe("agent-only-msg-copilot-agent-only-thinking");

    const thinkingComplete = events.find(
      (e) => e.type === "stream.thinking.complete" && e.data.sourceKey === "copilot-agent-only-thinking-1",
    );
    expect(thinkingComplete).toBeDefined();
    expect(thinkingComplete?.data.agentId).toBe("agent-only-msg-copilot-agent-only-thinking");
  });

  test("agent-only Copilot streams attribute early reasoning to a synthetic foreground agent", async () => {
    const events = collectEvents(bus);

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay());

    const streamPromise = adapter.startStreaming(session, "Explain the BM25 algorithm", {
      runId: 200,
      messageId: "msg-copilot-agent-only-reasoning",
      agent: "codebase-online-researcher",
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Need to invoke the research agent first",
        reasoningId: "copilot-agent-only-reasoning-1",
      },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        reasoningId: "copilot-agent-only-reasoning-1",
        content: "Need to invoke the research agent first",
      },
    } as AgentEvent<"reasoning.complete">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-subagent-early-reasoning-1",
        subagentType: "codebase-online-researcher",
        task: "Explain the BM25 algorithm",
        toolCallId: "copilot-task-call-early-reasoning-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const syntheticAgentStart = events.find(
      (e) => e.type === "stream.agent.start" && e.data.agentId === "agent-only-msg-copilot-agent-only-reasoning",
    );
    expect(syntheticAgentStart).toBeDefined();

    const thinkingDelta = events.find(
      (e) => e.type === "stream.thinking.delta" && e.data.sourceKey === "copilot-agent-only-reasoning-1",
    );
    expect(thinkingDelta).toBeDefined();
    expect(thinkingDelta?.data.agentId).toBe("agent-only-msg-copilot-agent-only-reasoning");

    const thinkingComplete = events.find(
      (e) => e.type === "stream.thinking.complete" && e.data.sourceKey === "copilot-agent-only-reasoning-1",
    );
    expect(thinkingComplete).toBeDefined();
    expect(thinkingComplete?.data.agentId).toBe("agent-only-msg-copilot-agent-only-reasoning");
  });

  test("agent-only Copilot streams keep early tools inside the agent tree after native subagent promotion", async () => {
    const events = collectEvents(bus);

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay());

    const streamPromise = adapter.startStreaming(session, "Explain the BM25 algorithm", {
      runId: 200,
      messageId: "msg-copilot-agent-tool-tree",
      agent: "codebase-online-researcher",
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "copilot-agent-tool-1",
            name: "report_intent",
            arguments: {
              intent: "Researching BM25",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-real-agent-1",
        subagentType: "codebase-online-researcher",
        task: "Explain the BM25 algorithm",
        toolCallId: "copilot-task-call-agent-tool-tree",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "report_intent",
        toolCallId: "copilot-agent-tool-1",
        toolResult: "ok",
        success: true,
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const earlyToolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "copilot-agent-tool-1",
    );
    expect(earlyToolStart).toBeDefined();
    expect(earlyToolStart?.data.parentAgentId).toBe("agent-only-msg-copilot-agent-tool-tree");

    const promotedToolComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "copilot-agent-tool-1",
    );
    expect(promotedToolComplete).toBeDefined();
    expect(promotedToolComplete?.data.parentAgentId).toBe("copilot-real-agent-1");
  });

  test("buffers Copilot task tool requests under a synthetic task-agent id until subagent.start binds the real agent", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "Explain the BM25 algorithm", {
      runId: 201,
      messageId: "msg-copilot-task-buffer",
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "copilot-task-buffer-1",
            name: "Task",
            arguments: {
              description: "Research BM25 explanation",
              prompt: "Explain the BM25 algorithm",
              subagent_type: "codebase-online-researcher",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-real-task-agent-1",
        subagentType: "codebase-online-researcher",
        task: "Research BM25 explanation",
        toolCallId: "copilot-task-buffer-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-real-task-agent-1",
        success: true,
        result: "BM25 explanation",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    const taskToolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "copilot-task-buffer-1",
    );
    expect(taskToolStart).toBeDefined();
    // Root task tools are top-level containers — no parentAgentId so they
    // don't appear inside the sub-agent's inline parts.
    expect(taskToolStart?.data.parentAgentId).toBeUndefined();

    const taskToolCompletes = events.filter(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "copilot-task-buffer-1",
    );
    expect(taskToolCompletes.length).toBeGreaterThan(0);
    const promotedTaskToolComplete = taskToolCompletes[taskToolCompletes.length - 1];
    expect(promotedTaskToolComplete?.data.parentAgentId).toBeUndefined();
  });

  test("detects background sub-agents from task tool arguments", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Emit message.complete with a task tool request containing mode: "background"
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "task-call-1",
            name: "Task",
            arguments: {
              description: "Search for auth patterns",
              mode: "background",
              subagent_type: "Explore",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    // Emit subagent.start with matching toolCallId
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-1",
        subagentType: "Explore",
        task: "Fast agent for exploring codebases",
        toolCallId: "task-call-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && !e.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.isBackground).toBe(true);
    expect(agentStartEvents[0].data.task).toBe("Search for auth patterns");
  });

  test("completes task tool rows when Copilot sub-agents finish", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-task-complete",
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "task-call-2",
            name: "Task",
            arguments: {
              description: "Inspect auth flow",
              subagent_type: "codebase-analyzer",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "subagent-2",
        subagentType: "codebase-analyzer",
        task: "Analyze auth flow",
        toolCallId: "task-call-2",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "subagent-2",
        success: true,
        result: "done",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    const toolStartEvents = events.filter((e) => e.type === "stream.tool.start");
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.toolId).toBe("task-call-2");
    expect(toolStartEvents[0].data.toolName).toBe("Task");
    // Root task tools stay top-level (no parentAgentId) so they serve as
    // the visual anchor for the sub-agent tree, not an inline part.
    expect(toolStartEvents[0].data.parentAgentId).toBeUndefined();

    const toolCompleteEvents = events.filter((e) => e.type === "stream.tool.complete");
    expect(toolCompleteEvents.length).toBe(1);
    expect(toolCompleteEvents[0].data.toolId).toBe("task-call-2");
    expect(toolCompleteEvents[0].data.toolName).toBe("Task");
    expect(toolCompleteEvents[0].data.toolResult).toBe("done");
    expect(toolCompleteEvents[0].data.success).toBe(true);
    expect(toolCompleteEvents[0].data.parentAgentId).toBeUndefined();
  });

  test("extracts task description from task tool arguments over agent type description", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Emit message.complete with a task tool request
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "task-call-2",
            name: "launch_agent",
            arguments: {
              description: "Find auth code",
              subagent_type: "codebase-locator",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    // Emit subagent.start — task field has the agent type description
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-2",
        subagentType: "codebase-locator",
        task: "Locates files and components",
        toolCallId: "task-call-2",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && !e.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.task).toBe("Find auth code");
  });

  test("buffers early tool events before subagent.started and replays them", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Emit tool.start with parentToolCallId BEFORE subagent.start (race condition)
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "glob",
        toolInput: { pattern: "**/*.ts" },
        toolCallId: "early-tool-1",
        parentToolCallId: "task-call-3",
      },
    } as AgentEvent<"tool.start">);

    // Now emit the subagent.start — should replay the buffered tool event
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-3",
        subagentType: "Explore",
        task: "Find TypeScript files",
        toolCallId: "task-call-3",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    // The early tool event should have been replayed, triggering stream.agent.update
    const updateEvents = events.filter((e) => e.type === "stream.agent.update");
    expect(updateEvents.length).toBeGreaterThanOrEqual(1);
    expect(updateEvents[0].data.agentId).toBe("sub-3");
    expect(updateEvents[0].data.toolUses).toBe(1);
    expect(updateEvents[0].data.currentTool).toBe("glob");
  });

  test("replays parentToolCallId tool lifecycle into the subagent tree", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-parent-tool-call-replay",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "glob",
        toolInput: { pattern: "**/*.ts" },
        toolCallId: "early-child-tool-1",
        parentToolCallId: "task-call-parent-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "glob",
        toolResult: ["src/app.ts"],
        success: true,
        toolCallId: "early-child-tool-1",
        parentToolCallId: "task-call-parent-1",
      },
    } as AgentEvent<"tool.complete">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-parent-tool-call-1",
        subagentType: "Explore",
        task: "Find TypeScript files",
        toolCallId: "task-call-parent-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const replayedStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "early-child-tool-1",
    );
    expect(replayedStart).toBeDefined();
    expect(replayedStart?.data.parentAgentId).toBe("sub-parent-tool-call-1");

    const replayedComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "early-child-tool-1",
    );
    expect(replayedComplete).toBeDefined();
    expect(replayedComplete?.data.parentAgentId).toBe("sub-parent-tool-call-1");

    const leakedTopLevelStarts = events.filter(
      (e) => e.type === "stream.tool.start"
        && e.data.toolId === "early-child-tool-1"
        && e.data.parentAgentId === undefined,
    );
    expect(leakedTopLevelStarts.length).toBe(0);
  });

  test("publishes subagent progress updates on tool.partial_result", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-partial-1",
        subagentType: "Explore",
        task: "Watch streaming tool output",
        toolCallId: "task-call-partial-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "tail -f logs" },
        toolCallId: "inner-tool-partial-1",
        parentToolCallId: "task-call-partial-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.partial_result" as EventType, {
      type: "tool.partial_result",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolCallId: "inner-tool-partial-1",
        partialOutput: "line 1",
      },
    } as AgentEvent<"tool.partial_result">);

    await streamPromise;

    const progressUpdates = events.filter(
      (e) =>
        e.type === "stream.agent.update"
        && e.data.agentId === "sub-partial-1"
        && e.data.currentTool === "bash",
    );
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    expect(progressUpdates.some((e) => e.data.toolUses === 1)).toBe(true);
  });

  test("defaults to foreground when task tool has no mode field", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    // Emit message.complete with a task tool request without mode
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "task-call-4",
            name: "Task",
            arguments: {
              description: "Analyze dependencies",
              subagent_type: "general-purpose",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    // Emit subagent.start
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-4",
        subagentType: "general-purpose",
        task: "General-purpose agent",
        toolCallId: "task-call-4",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && !e.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.isBackground).toBe(false);
    expect(agentStartEvents[0].data.task).toBe("Analyze dependencies");
  });

  test("recognizes Copilot agent names as task tools via knownAgentNames", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 500,
      messageId: "msg-agent-name",
      knownAgentNames: ["codebase-analyzer", "General-Purpose"],
    });

    // Emit message.complete with agent-named tool request
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "agent-tool-1",
            name: "codebase-analyzer",
            arguments: {
              prompt: "Analyze the auth module",
              subagent_type: "codebase-analyzer",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    // Emit subagent.start
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-agent-1",
        subagentType: "codebase-analyzer",
        task: "Generic analyzer agent",
        toolCallId: "agent-tool-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && !e.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents.length).toBe(1);
    // Task description from prompt argument should be used
    expect(agentStartEvents[0].data.task).toBe("Analyze the auth module");
  });

  test("extracts description from prompt argument (Copilot pattern)", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 501,
      messageId: "msg-prompt",
      knownAgentNames: ["general-purpose"],
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "prompt-tool-1",
            name: "general-purpose",
            arguments: {
              prompt: "Research the dependency graph",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-prompt-1",
        subagentType: "general-purpose",
        task: "General purpose agent",
        toolCallId: "prompt-tool-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && !e.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.task).toBe("Research the dependency graph");
  });

  test("tags Copilot subagent skill invocations so the top-level skill UI can ignore them", async () => {
    const events = collectEvents(bus);

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 501,
      messageId: "msg-copilot-skill-agent",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-copilot-skill-1",
        subagentType: "general-purpose",
        task: "Investigate",
        toolCallId: "task-call-skill-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("skill.invoked" as EventType, {
      type: "skill.invoked",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        skillName: "frontend-design",
        skillPath: "skills/frontend-design/SKILL.md",
        parentToolCallId: "task-call-skill-1",
      },
    } as AgentEvent<"skill.invoked">);

    await streamPromise;

    const skillEvent = events.find((e) => e.type === "stream.skill.invoked");
    expect(skillEvent).toBeDefined();
    expect(skillEvent?.data.skillName).toBe("frontend-design");
    expect(skillEvent?.data.agentId).toBe("sub-copilot-skill-1");
  });

  test("extracts isBackground from run_in_background argument", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 502,
      messageId: "msg-bg",
      knownAgentNames: ["general-purpose"],
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "bg-tool-1",
            name: "general-purpose",
            arguments: {
              prompt: "Background research task",
              run_in_background: true,
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-bg-1",
        subagentType: "general-purpose",
        task: "General purpose agent",
        toolCallId: "bg-tool-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && !e.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.isBackground).toBe(true);
    expect(agentStartEvents[0].data.task).toBe("Background research task");
  });

  test("full sub-agent lifecycle with agent-named tool", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 503,
      messageId: "msg-lifecycle",
      knownAgentNames: ["codebase-analyzer"],
    });

    // 1. Parent message.complete with agent-named tool request
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "lifecycle-tool-1",
            name: "codebase-analyzer",
            arguments: {
              prompt: "Check types",
              subagent_type: "codebase-analyzer",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    // 2. subagent.start
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "lifecycle-tool-1",
        subagentType: "codebase-analyzer",
        task: "Codebase analyzer agent",
        toolCallId: "lifecycle-tool-1",
      },
    } as AgentEvent<"subagent.start">);

    // 3. Sub-agent's inner message.complete with tool requests
    //    (carries parentToolCallId — adapter must skip this)
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        parentToolCallId: "lifecycle-tool-1",
        toolRequests: [
          {
            toolCallId: "inner-tool-1",
            name: "Grep",
            arguments: { pattern: "interface" },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    // 4. tool.start inside sub-agent (has parentId = subagentId)
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "Grep",
        toolInput: { pattern: "interface" },
        toolCallId: "inner-tool-1",
        parentId: "lifecycle-tool-1",
      },
    } as AgentEvent<"tool.start">);

    // 5. tool.complete inside sub-agent
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "Grep",
        toolResult: "found 5 matches",
        success: true,
        toolCallId: "inner-tool-1",
        parentId: "lifecycle-tool-1",
      },
    } as AgentEvent<"tool.complete">);

    // 6. subagent.complete
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "lifecycle-tool-1",
        success: true,
        result: "Types look good",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    // Verify tool.start was emitted: 1 for codebase-analyzer (parent) + 1 for Grep (inner)
    const toolStartEvents = events.filter((e) => e.type === "stream.tool.start");
    expect(toolStartEvents.length).toBe(2);

    // The inner Grep tool start should have parentAgentId set
    const grepToolStart = toolStartEvents.find((e) => e.data.toolName === "Grep");
    expect(grepToolStart).toBeDefined();
    expect(grepToolStart!.data.parentAgentId).toBe("lifecycle-tool-1");

    // Verify agent lifecycle
    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && !e.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.task).toBe("Check types");

    // Verify tool count propagated via stream.agent.update
    const agentUpdateEvents = events.filter((e) => e.type === "stream.agent.update");
    expect(agentUpdateEvents.length).toBeGreaterThanOrEqual(1);
    // After onToolStart, toolUses should be 1
    const lastUpdate = agentUpdateEvents[agentUpdateEvents.length - 1];
    expect(lastUpdate.data.toolUses).toBeGreaterThanOrEqual(1);

    const agentCompleteEvents = events.filter((e) => e.type === "stream.agent.complete");
    expect(agentCompleteEvents.length).toBe(1);
    expect(agentCompleteEvents[0].data.success).toBe(true);
  });

  test("nested sub-agent (spawned by another sub-agent) is suppressed from tree", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 505,
      messageId: "msg-nested",
      knownAgentNames: ["codebase-analyzer"],
    });

    // 1. Parent message.complete spawns codebase-analyzer
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "tc-outer",
            name: "codebase-analyzer",
            arguments: { prompt: "Analyze repo" },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    // 2. subagent.start for codebase-analyzer (top-level)
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "tc-outer",
        subagentType: "codebase-analyzer",
        task: "Analyze repo",
        toolCallId: "tc-outer",
      },
    } as AgentEvent<"subagent.start">);

    // 3. codebase-analyzer calls Task tool (inner tool.start with parentToolCallId)
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: { prompt: "Explore codebase" },
        toolCallId: "tc-inner",
        parentToolCallId: "tc-outer",
      },
    } as AgentEvent<"tool.start">);

    // 4. subagent.start for explore (NESTED — spawned by codebase-analyzer)
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "tc-inner",
        subagentType: "explore",
        task: "Fast codebase exploration",
        toolCallId: "tc-inner",
      },
    } as AgentEvent<"subagent.start">);

    // 5. nested lifecycle events should also be suppressed
    client.emit("subagent.update" as EventType, {
      type: "subagent.update",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "tc-inner",
        currentTool: "grep",
        toolUses: 1,
      },
    } as AgentEvent<"subagent.update">);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "tc-inner",
        success: true,
        result: "nested done",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    // Only the top-level agent (codebase-analyzer) should appear (excluding synthetic placeholder)
    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && !e.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.agentType).toBe("codebase-analyzer");

    // The nested explore agent should NOT appear
    const exploreEvents = agentStartEvents.filter((e) => e.data.agentType === "explore");
    expect(exploreEvents.length).toBe(0);

    const nestedAgentUpdates = events.filter(
      (e) => e.type === "stream.agent.update" && e.data.agentId === "tc-inner",
    );
    expect(nestedAgentUpdates.length).toBe(0);

    const nestedAgentCompletes = events.filter(
      (e) => e.type === "stream.agent.complete" && e.data.agentId === "tc-inner",
    );
    expect(nestedAgentCompletes.length).toBe(0);
  });

  test("sub-agent message.complete with parentToolCallId emits inner tool rows", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 504,
      messageId: "msg-skip-child",
      knownAgentNames: ["general-purpose"],
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "parent-task-1",
        subagentType: "general-purpose",
        toolCallId: "parent-task-1",
      },
    } as AgentEvent<"subagent.start">);

    // Sub-agent message.complete with parentToolCallId should create inner tool rows
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        parentToolCallId: "parent-task-1",
        toolRequests: [
          {
            toolCallId: "child-tool-1",
            name: "Read",
            arguments: { file_path: "test.ts" },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    // This message.complete without parentToolCallId (parent agent) should be processed
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {},
    } as AgentEvent<"message.complete">);

    await streamPromise;

    const childToolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-1",
    );
    expect(childToolStart).toBeDefined();
    expect(childToolStart?.data.parentAgentId).toBe("parent-task-1");

    // The parent message.complete should NOT have emitted stream.text.complete
    // because no text was accumulated (no message.delta events were sent)
    const textCompletes = events.filter((e) => e.type === "stream.text.complete");
    expect(textCompletes.length).toBe(0);
  });

  test("replays child tool rows when Claude message.complete arrives before subagent.start", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 511,
      messageId: "msg-early-child-tool",
      knownAgentNames: ["codebase-online-researcher"],
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        parentToolCallId: "parent-task-early-1",
        toolRequests: [
          {
            toolCallId: "child-tool-early-1",
            name: "Read",
            arguments: { file_path: "docs/claude-agent-sdk.md" },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "parent-task-early-1",
        subagentType: "codebase-online-researcher",
        toolCallId: "parent-task-early-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const childToolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-early-1",
    );
    expect(childToolStart).toBeDefined();
    expect(childToolStart?.data.parentAgentId).toBe("parent-task-early-1");

    const agentUpdateEvents = events.filter(
      (e) => e.type === "stream.agent.update" && e.data.agentId === "parent-task-early-1",
    );
    expect(agentUpdateEvents.some((event) => event.data.toolUses === 1)).toBe(true);
  });

  test("maps subagent.update events and sub-agent message deltas", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 510,
      messageId: "msg-subagent-delta",
      knownAgentNames: ["codebase-analyzer"],
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-sub-1",
        subagentType: "codebase-analyzer",
        toolCallId: "tool-call-agent-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.update" as EventType, {
      type: "subagent.update",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-sub-1",
        currentTool: "grep",
        toolUses: 2,
      },
    } as AgentEvent<"subagent.update">);

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "child chunk",
        contentType: "text",
        parentToolCallId: "tool-call-agent-1",
      },
    } as AgentEvent<"message.delta">);

    await streamPromise;

    expect(events.some((e) => e.type === "stream.agent.update" && e.data.agentId === "agent-sub-1")).toBe(true);
    expect(
      events.some(
        (e) => e.type === "stream.text.delta"
          && e.data.delta === "child chunk"
          && e.data.agentId === "agent-sub-1",
      ),
    ).toBe(true);
  });

  test("maps sub-agent reasoning through parentToolCallId ownership", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 511,
      messageId: "msg-subagent-reasoning",
      knownAgentNames: ["codebase-analyzer"],
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "tool-call-agent-2",
        subagentType: "codebase-analyzer",
        toolCallId: "tool-call-agent-2",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "child reasoning",
        reasoningId: "copilot-child-reasoning-1",
        parentToolCallId: "tool-call-agent-2",
      },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        reasoningId: "copilot-child-reasoning-1",
        parentToolCallId: "tool-call-agent-2",
      },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    expect(
      events.some(
        (e) => e.type === "stream.thinking.delta"
          && e.data.sourceKey === "copilot-child-reasoning-1"
          && e.data.agentId === "tool-call-agent-2",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "stream.thinking.complete"
          && e.data.sourceKey === "copilot-child-reasoning-1"
          && e.data.agentId === "tool-call-agent-2",
      ),
    ).toBe(true);
  });

});

// ============================================================================
// WorkflowEventAdapter Tests
// ============================================================================

describe("WorkflowEventAdapter", () => {
  let bus: EventBus;
  let adapter: WorkflowEventAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new WorkflowEventAdapter(bus, "workflow-session-1", 1);
  });

  test("publishStepStart() publishes workflow.step.start event", () => {
    const events = collectEvents(bus);

    adapter.publishStepStart("wf-001", "analyze-code", "node-1");

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("workflow.step.start");
    expect(events[0].sessionId).toBe("workflow-session-1");
    expect(events[0].runId).toBe(1);
    expect(events[0].data.workflowId).toBe("wf-001");
    expect(events[0].data.nodeId).toBe("node-1");
    expect(events[0].data.nodeName).toBe("analyze-code");
  });

  test("publishStepComplete() publishes workflow.step.complete with status", () => {
    const events = collectEvents(bus);

    adapter.publishStepComplete("wf-001", "analyze-code", "node-1", "success", { output: "done" });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("workflow.step.complete");
    expect(events[0].data.workflowId).toBe("wf-001");
    expect(events[0].data.nodeId).toBe("node-1");
    expect(events[0].data.nodeName).toBe("analyze-code");
    expect(events[0].data.status).toBe("success");
    expect(events[0].data.result).toEqual({ output: "done" });
    expect(events[0].runId).toBe(1);
  });

  test("publishStepComplete() defaults to success status", () => {
    const events = collectEvents(bus);

    adapter.publishStepComplete("wf-001", "step", "node-1");

    expect(events[0].data.nodeName).toBe("step");
    expect(events[0].data.status).toBe("success");
  });

  test("publishTaskUpdate() publishes workflow.task.update with tasks", () => {
    const events = collectEvents(bus);

    const tasks = [
      { id: "t1", title: "First task", status: "complete" },
      { id: "t2", title: "Second task", status: "in_progress" },
      { id: "t3", title: "Third task", status: "pending" },
    ];

    adapter.publishTaskUpdate("wf-001", tasks);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("workflow.task.update");
    expect(events[0].data.workflowId).toBe("wf-001");
    expect(events[0].data.tasks).toEqual(tasks);
    expect(events[0].data.tasks.length).toBe(3);
  });

  test("publishAgentStart() publishes stream.agent.start event", () => {
    const events = collectEvents(bus);

    adapter.publishAgentStart("agent-001", "explore", "Find relevant files", false);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("stream.agent.start");
    expect(events[0].data.agentId).toBe("agent-001");
    expect(events[0].data.agentType).toBe("explore");
    expect(events[0].data.task).toBe("Find relevant files");
    expect(events[0].data.isBackground).toBe(false);
    expect(events[0].runId).toBe(1);
  });

  test("publishAgentStart() defaults isBackground to false", () => {
    const events = collectEvents(bus);

    adapter.publishAgentStart("agent-001", "task", "Run tests");

    expect(events[0].data.isBackground).toBe(false);
  });

  test("publishAgentUpdate() publishes stream.agent.update event", () => {
    const events = collectEvents(bus);

    adapter.publishAgentUpdate("agent-001", "bash", 5);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("stream.agent.update");
    expect(events[0].data.agentId).toBe("agent-001");
    expect(events[0].data.currentTool).toBe("bash");
    expect(events[0].data.toolUses).toBe(5);
  });

  test("publishAgentComplete() publishes stream.agent.complete event", () => {
    const events = collectEvents(bus);

    adapter.publishAgentComplete("agent-001", true, "Found 3 files");

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("stream.agent.complete");
    expect(events[0].data.agentId).toBe("agent-001");
    expect(events[0].data.success).toBe(true);
    expect(events[0].data.result).toBe("Found 3 files");
    expect(events[0].data.error).toBeUndefined();
  });

  test("publishAgentComplete() with error", () => {
    const events = collectEvents(bus);

    adapter.publishAgentComplete("agent-001", false, undefined, "Agent timeout");

    expect(events[0].data.success).toBe(false);
    expect(events[0].data.error).toBe("Agent timeout");
    expect(events[0].data.result).toBeUndefined();
  });

  test("all events use correct sessionId and runId", () => {
    const events = collectEvents(bus);

    adapter.publishStepStart("wf", "step", "n1");
    adapter.publishAgentStart("a1", "task", "do stuff");
    adapter.publishAgentUpdate("a1", "bash");
    adapter.publishAgentComplete("a1", true);
    adapter.publishStepComplete("wf", "step", "n1");
    adapter.publishTaskUpdate("wf", [{ id: "t1", title: "T", status: "done" }]);

    expect(events.length).toBe(6);
    for (const event of events) {
      expect(event.sessionId).toBe("workflow-session-1");
      expect(event.runId).toBe(1);
    }
  });
});
