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
import { EventBus } from "../event-bus.ts";
import { OpenCodeStreamAdapter } from "./opencode-adapter.ts";
import { ClaudeStreamAdapter } from "./claude-adapter.ts";
import { CopilotStreamAdapter } from "./copilot-adapter.ts";
import { WorkflowEventAdapter } from "./workflow-adapter.ts";
import type { BusEvent } from "../bus-events.ts";
import type {
  Session,
  AgentMessage,
  AgentEvent,
  EventType,
  CodingAgentClient,
} from "../../sdk/types.ts";

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
    __client: client,
  } as unknown as Session;
  return session;
}

/**
 * Create a mock CodingAgentClient with EventEmitter-like behavior
 */
function createMockClient(): CodingAgentClient {
  const handlers = new Map<EventType, Set<(event: AgentEvent) => void>>();

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
    emit: (type: EventType, event: AgentEvent) => {
      const set = handlers.get(type);
      if (set) {
        for (const handler of set) {
          handler(event);
        }
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
    const session = createMockSession(stream);

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
    const session = createMockSession(stream);

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
    const session = createMockSession(stream);

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
    const session = createMockSession(stream);

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
    const session = createMockSession(stream);

    await adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    // Should have session.start + 2 delta events + 1 complete event
    expect(events.length).toBe(4);

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

    const chunks: AgentMessage[] = [
      {
        type: "thinking",
        content: "Reasoning step 1",
        metadata: { thinkingSourceKey: "reasoning-1" },
      },
      {
        type: "thinking",
        content: "Reasoning step 2",
        metadata: { thinkingSourceKey: "reasoning-1" },
      },
      {
        type: "thinking",
        content: "",
        metadata: {
          thinkingSourceKey: "reasoning-1",
          streamingStats: { thinkingMs: 500 },
        },
      },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    await adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

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
    expect(thinkingCompleteEvents[0].data.durationMs).toBe(500);
  });

  test("publishes session idle events from SDK client", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    // Ignore events from other sessions.
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
    expect(idleEvents[0].data.reason).toBe("completed");
    expect(idleEvents[0].runId).toBe(100);
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
    const session = createMockSession(stream);

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

    // Should only have session.start, text delta, and text complete events
    expect(events.length).toBe(3);
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

    // Complete event should be the last event
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe("stream.text.complete");
    expect(lastEvent.data.fullText).toBe("First Second");
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
    const session = createMockSession(stream);

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
    const session = createMockSession(stream);

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

    const toolStartEvents = events.filter((e) => e.type === "stream.tool.start");
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.toolId).toBe("tool-use-123");

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("tool-use-123");
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

    const chunks: AgentMessage[] = [
      {
        type: "thinking",
        content: "Let me think...",
        metadata: { thinkingSourceKey: "block-1" },
      },
      {
        type: "thinking",
        content: "",
        metadata: {
          thinkingSourceKey: "block-1",
          streamingStats: { thinkingMs: 2000, outputTokens: 150 },
        },
      },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    await adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    // Should have thinking.complete
    const thinkingCompleteEvents = events.filter(
      (e) => e.type === "stream.thinking.complete",
    );
    expect(thinkingCompleteEvents.length).toBe(1);
    expect(thinkingCompleteEvents[0].data.durationMs).toBe(2000);

    // Should NOT have stream.usage from thinking chunks
    const usageEvents = events.filter((e) => e.type === "stream.usage");
    expect(usageEvents.length).toBe(0);
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

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.isBackground).toBe(true);
    expect(agentStartEvents[0].data.task).toBe("Search for auth patterns");
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

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
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

    // Emit tool.start with parentId BEFORE subagent.start (race condition)
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "glob",
        toolInput: { pattern: "**/*.ts" },
        toolCallId: "early-tool-1",
        parentId: "sub-3",
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

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
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

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
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

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.task).toBe("Research the dependency graph");
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

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
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
    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
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

    // 3. codebase-analyzer calls Task tool (inner tool.start with parentId)
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: { prompt: "Explore codebase" },
        toolCallId: "tc-inner",
        parentId: "tc-outer",
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

    await streamPromise;

    // Only the top-level agent (codebase-analyzer) should appear
    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.agentType).toBe("codebase-analyzer");

    // The nested explore agent should NOT appear
    const exploreEvents = agentStartEvents.filter((e) => e.data.agentType === "explore");
    expect(exploreEvents.length).toBe(0);
  });

  test("sub-agent message.complete with parentToolCallId is skipped", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 504,
      messageId: "msg-skip-child",
      knownAgentNames: ["general-purpose"],
    });

    // Sub-agent message.complete with parentToolCallId should be skipped
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

    // The child message.complete's tool request should NOT have been emitted
    const toolStarts = events.filter((e) => e.type === "stream.tool.start");
    expect(toolStarts.length).toBe(0);

    // The parent message.complete should NOT have emitted stream.text.complete
    // because no text was accumulated (no message.delta events were sent)
    const textCompletes = events.filter((e) => e.type === "stream.text.complete");
    expect(textCompletes.length).toBe(0);
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
    expect(events[0].data.status).toBe("success");
    expect(events[0].data.result).toEqual({ output: "done" });
    expect(events[0].runId).toBe(1);
  });

  test("publishStepComplete() defaults to success status", () => {
    const events = collectEvents(bus);

    adapter.publishStepComplete("wf-001", "step", "node-1");

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
