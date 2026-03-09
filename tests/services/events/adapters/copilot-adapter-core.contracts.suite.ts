// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import type {
  AgentEvent,
  CodingAgentClient,
  EventType,
} from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("CopilotStreamAdapter completion and strict contracts", () => {
  let bus: EventBus;
  let client: CodingAgentClient;
  let adapter: CopilotStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    client = createMockClient();
    adapter = new CopilotStreamAdapter(bus, client);
  });

  test("complete events are published at stream end", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "test" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { delta: "Hello", contentType: "text" },
    } as AgentEvent<"message.delta">);
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { message: "Hello" },
    } as AgentEvent<"message.complete">);
    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reason: "idle" },
    } as AgentEvent<"session.idle">);

    await streamPromise;

    expect(
      events.filter((event) => event.type === "stream.session.idle").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      events.filter((event) => event.type === "stream.text.complete").length,
    ).toBe(1);
  });

  test("strict runtime contract keeps synthetic turn id stable in Copilot", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-turn-strict",
      runtimeFeatureFlags: { strictTaskContract: true },
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

    const turnStartEvents = events.filter((event) => event.type === "stream.turn.start");
    const turnEndEvents = events.filter((event) => event.type === "stream.turn.end");
    expect(turnStartEvents).toHaveLength(1);
    expect(turnEndEvents).toHaveLength(1);
    expect(turnStartEvents[0].data.turnId).toMatch(/^turn_/);
    expect(turnEndEvents[0].data.turnId).toBe(turnStartEvents[0].data.turnId);
    expect(turnEndEvents[0].data.finishReason).toBe("max-tokens");
    expect(turnEndEvents[0].data.rawFinishReason).toBe("length");
  });

  test("strict runtime contract falls back subagent task to agent type in Copilot", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 200,
      messageId: "msg-task-strict",
      runtimeFeatureFlags: { strictTaskContract: true },
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

    const agentStartEvents = events.filter((event) => event.type === "stream.agent.start");
    expect(agentStartEvents).toHaveLength(1);
    expect(agentStartEvents[0].data.task).toBe("general-purpose");
    expect(agentStartEvents[0].data.isBackground).toBe(false);
  });

  test("publishes thinking delta events from message.delta with thinking content", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

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
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { message: "" },
    } as AgentEvent<"message.complete">);

    await streamPromise;

    const thinkingDeltaEvents = events.filter(
      (event) => event.type === "stream.thinking.delta",
    );
    expect(thinkingDeltaEvents).toHaveLength(2);
    expect(thinkingDeltaEvents[0].data.delta).toBe("Thinking about this...");
    expect(thinkingDeltaEvents[0].data.sourceKey).toBe("reason-1");
    expect(thinkingDeltaEvents[1].data.delta).toBe("conclusion reached");

    const thinkingCompleteEvents = events.filter(
      (event) => event.type === "stream.thinking.complete",
    );
    expect(thinkingCompleteEvents).toHaveLength(1);
    expect(thinkingCompleteEvents[0].data.sourceKey).toBe("reason-1");
  });
});
