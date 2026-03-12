// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import type { AgentEvent, AgentMessage, EventType } from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("ClaudeStreamAdapter usage and thinking", () => {
  let bus: EventBus;
  let adapter: ClaudeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123");
  });

  test("real usage events publish stream.usage with accumulated tokens", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

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

    const usageEvents = events.filter((event) => event.type === "stream.usage");
    expect(usageEvents).toHaveLength(2);
    expect(usageEvents[0].data.inputTokens).toBe(100);
    expect(usageEvents[0].data.outputTokens).toBe(50);
    expect(usageEvents[0].data.model).toBe("claude-sonnet-4-20250514");
    expect(usageEvents[1].data.inputTokens).toBe(200);
    expect(usageEvents[1].data.outputTokens).toBe(125);
  });

  test("zero-valued diagnostics markers are filtered", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

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

    expect(
      events.filter((event) => event.type === "stream.usage"),
    ).toHaveLength(0);
  });

  test("thinking chunks emit stream.thinking.complete but not stream.usage", async () => {
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
      data: { delta: "Let me think...", reasoningId: "block-1" },
    } as AgentEvent<"reasoning.delta">);
    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reasoningId: "block-1", content: "Let me think..." },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    const thinkingCompleteEvents = events.filter(
      (event) => event.type === "stream.thinking.complete",
    );
    expect(thinkingCompleteEvents).toHaveLength(1);
    expect(thinkingCompleteEvents[0].data.durationMs).toBeGreaterThanOrEqual(0);
    expect(
      events.filter((event) => event.type === "stream.usage"),
    ).toHaveLength(0);
  });

  test("routes Claude child-session reasoning into agent-scoped thinking events", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

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

    expect(
      events.find(
        (event) =>
          event.type === "stream.thinking.delta"
          && event.data.sourceKey === "reasoning-child-1",
      )?.data.agentId,
    ).toBe("task-call-claude-reasoning-1");
    expect(
      events.find(
        (event) =>
          event.type === "stream.thinking.complete"
          && event.data.sourceKey === "reasoning-child-1",
      )?.data.agentId,
    ).toBe("task-call-claude-reasoning-1");
  });
});
