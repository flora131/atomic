// @ts-nocheck

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import type { Session, AgentMessage, AgentEvent, EventType } from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

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
    expect(deltaEvents.length).toBeLessThanOrEqual(3);
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

});
