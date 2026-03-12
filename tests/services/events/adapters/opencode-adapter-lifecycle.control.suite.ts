// @ts-nocheck

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import type {
  AgentEvent,
  AgentMessage,
  EventType,
  Session,
} from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("OpenCodeStreamAdapter lifecycle control", () => {
  let bus: EventBus;
  let adapter: OpenCodeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new OpenCodeStreamAdapter(bus, "test-session-123");
  });

  test("publishes session truncation and compaction events from SDK client", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

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
    expect(truncationEvent?.runId).toBe(42);
    expect(truncationEvent?.data).toEqual({
      tokenLimit: 1000,
      tokensRemoved: 250,
      messagesRemoved: 3,
    });

    const compactionEvent = events.find(
      (event) => event.type === "stream.session.compaction",
    );
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

    const idleEvents = events.filter((event) => event.type === "stream.session.idle");
    expect(idleEvents).toHaveLength(1);
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
    session.sendAsync = mock(async (_message: string, options?: { abortSignal?: AbortSignal }) => {
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
    });

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
    expect(
      events.filter((event) => event.type === "stream.session.idle"),
    ).toHaveLength(1);
    expect(events.filter((event) => event.type === "stream.session.error")).toHaveLength(0);
  });

  test("publishes session error on stream error", async () => {
    const events = collectEvents(bus);

    async function* errorStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      throw new Error("Stream error");
    }

    await adapter.startStreaming(createMockSession(errorStream()), "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    const errorEvents = events.filter(
      (event) => event.type === "stream.session.error",
    );
    expect(errorEvents).toHaveLength(1);
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

    adapter.startStreaming(createMockSession(controlledStream()), "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    await new Promise((resolve) => setTimeout(resolve, 2));
    adapter.dispose();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(
      events.filter((event) => event.type === "stream.text.delta").length,
    ).toBeLessThanOrEqual(2);
  });

  test("events include correct runId from options", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "test" }]),
      createMockClient(),
    );

    await adapter.startStreaming(session, "test message", {
      runId: 999,
      messageId: "msg-1",
    });

    expect(events.every((event) => event.runId === 999)).toBe(true);
  });

  test("unmapped event types are ignored", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "test" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("unknown.event" as EventType, {
      type: "unknown.event",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {},
    } as AgentEvent);

    await streamPromise;

    expect(events).toHaveLength(4);
    expect(events.some((event) => event.type === "stream.text.delta")).toBe(true);
    expect(events.some((event) => event.type === "stream.text.complete")).toBe(true);
    expect(events.some((event) => event.type === "stream.session.idle")).toBe(true);
  });

  test("complete events are published at stream end", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(
      mockAsyncStream([
        { type: "text", content: "Hello" },
        { type: "text", content: " world" },
      ]),
      createMockClient(),
    );

    await adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    const completeIdx = events.findIndex(
      (event) => event.type === "stream.text.complete",
    );
    const idleIdx = events.findIndex(
      (event) => event.type === "stream.session.idle",
    );
    expect(completeIdx).toBeGreaterThan(-1);
    expect(idleIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeLessThan(idleIdx);
    expect(events[events.length - 1].type).toBe("stream.session.idle");
    expect(
      events.find((event) => event.type === "stream.text.complete")?.data.fullText,
    ).toBe("Hello world");
  });
});
