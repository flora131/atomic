// @ts-nocheck

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import type {
  Session,
  AgentMessage,
  AgentEvent,
  EventType,
  CodingAgentClient,
} from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

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

});
