// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import type { AgentEvent, EventType } from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("ClaudeStreamAdapter partial-idle behavior", () => {
  let bus: EventBus;
  let adapter: ClaudeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123");
  });

  test("emits stream.session.partial-idle when background agents are active at stream end", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-1",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    // Register a background agent that stays active through stream completion
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-1",
        subagentType: "research",
        task: "background research",
        toolInput: {
          prompt: "Analyze data",
          run_in_background: true,
        },
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const partialIdleEvents = events.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(partialIdleEvents).toHaveLength(1);
    expect(partialIdleEvents[0].data.completionReason).toBe("generator-complete");
    expect(partialIdleEvents[0].data.activeBackgroundAgentCount).toBe(1);
    expect(partialIdleEvents[0].runId).toBe(100);

    // Should NOT emit stream.session.idle
    const idleEvents = events.filter(
      (event) => event.type === "stream.session.idle",
    );
    expect(idleEvents).toHaveLength(0);
  });

  test("emits stream.session.idle when no background agents are active", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    await adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-2",
    });

    const idleEvents = events.filter(
      (event) => event.type === "stream.session.idle",
    );
    expect(idleEvents).toHaveLength(1);
    expect(idleEvents[0].data.reason).toBe("generator-complete");
    expect(idleEvents[0].runId).toBe(200);

    // Should NOT emit stream.session.partial-idle
    const partialIdleEvents = events.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(partialIdleEvents).toHaveLength(0);
  });

  test("reports correct count with multiple background agents", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 300,
      messageId: "msg-3",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    // Register two background agents
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-a",
        subagentType: "research",
        task: "task A",
        toolInput: { prompt: "A", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-b",
        subagentType: "research",
        task: "task B",
        toolInput: { prompt: "B", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const partialIdleEvents = events.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(partialIdleEvents).toHaveLength(1);
    expect(partialIdleEvents[0].data.activeBackgroundAgentCount).toBe(2);
  });

  test("emits idle (not partial-idle) when background agents complete before stream ends", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 15));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 400,
      messageId: "msg-4",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    // Start and complete a background agent before stream ends
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-done",
        subagentType: "research",
        task: "quick task",
        toolInput: { prompt: "fast", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-done",
        success: true,
        result: "completed",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    const idleEvents = events.filter(
      (event) => event.type === "stream.session.idle",
    );
    expect(idleEvents).toHaveLength(1);
    expect(idleEvents[0].data.reason).toBe("generator-complete");

    const partialIdleEvents = events.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(partialIdleEvents).toHaveLength(0);
  });

  test("preserves provider subscriptions when background agents are active", async () => {
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 500,
      messageId: "msg-5",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-persist",
        subagentType: "research",
        task: "persist task",
        toolInput: { prompt: "persist", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    // After the stream ends with active background agents,
    // provider events should still be handled (subscriptions preserved).
    // Verify by emitting a subagent.complete event after the stream ends
    // and checking that it produces the corresponding bus event.
    const postStreamEvents = collectEvents(bus);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-persist",
        success: true,
        result: "done",
      },
    } as AgentEvent<"subagent.complete">);

    const agentCompleteEvents = postStreamEvents.filter(
      (event) => event.type === "stream.agent.complete",
    );
    expect(agentCompleteEvents).toHaveLength(1);
  });

  test("cleans up subscriptions on next stream start even after partial-idle", async () => {
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "first" };
    }

    const session1 = createMockSession(streamWithDelay(), client);

    const firstStreamPromise = adapter.startStreaming(session1, "first", {
      runId: 600,
      messageId: "msg-6",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-cleanup",
        subagentType: "research",
        task: "cleanup task",
        toolInput: { prompt: "cleanup", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    await firstStreamPromise;

    // Start a second stream — old subscriptions from the first stream
    // should be cleaned up at the start of the new stream (line 71 in
    // streaming-runtime.ts). Provider events from the first stream's
    // handler should no longer produce bus events after the second
    // stream starts.
    const secondStreamEvents = collectEvents(bus);

    const session2 = createMockSession(
      mockAsyncStream([{ type: "text", content: "second" }]),
      client,
    );

    await adapter.startStreaming(session2, "second", {
      runId: 601,
      messageId: "msg-7",
    });

    // The second stream should emit its own idle event
    const idleEvents = secondStreamEvents.filter(
      (event) => event.type === "stream.session.idle",
    );
    expect(idleEvents).toHaveLength(1);
    expect(idleEvents[0].runId).toBe(601);
  });

  test("emits partial-idle with 'error' reason when stream errors with active background agents", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* errorStream(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "before-error" };
      throw new Error("Stream connection failed");
    }

    const session = createMockSession(errorStream(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 700,
      messageId: "msg-err-bg",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-err",
        subagentType: "research",
        task: "background during error",
        toolInput: { prompt: "analyze", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const partialIdleEvents = events.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(partialIdleEvents).toHaveLength(1);
    expect(partialIdleEvents[0].data.completionReason).toBe("error");
    expect(partialIdleEvents[0].data.activeBackgroundAgentCount).toBe(1);

    const errorEvents = events.filter(
      (event) => event.type === "stream.session.error",
    );
    expect(errorEvents).toHaveLength(1);

    const idleEvents = events.filter(
      (event) => event.type === "stream.session.idle",
    );
    expect(idleEvents).toHaveLength(0);
  });

  test("emits partial-idle with 'aborted' reason when stream is aborted with active background agents", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const abortController = new AbortController();

    async function* streamForAbort(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "before-abort" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "after-abort" };
    }

    const session = createMockSession(streamForAbort(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 800,
      messageId: "msg-abort-bg",
      abortSignal: abortController.signal,
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-abort",
        subagentType: "research",
        task: "background during abort",
        toolInput: { prompt: "analyze", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    abortController.abort();

    await streamPromise;

    const partialIdleEvents = events.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(partialIdleEvents).toHaveLength(1);
    expect(partialIdleEvents[0].data.completionReason).toBe("aborted");
    expect(partialIdleEvents[0].data.activeBackgroundAgentCount).toBe(1);

    const idleEvents = events.filter(
      (event) => event.type === "stream.session.idle",
    );
    expect(idleEvents).toHaveLength(0);
  });

  test("emits idle with 'aborted' reason when stream is aborted without background agents", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const abortController = new AbortController();

    async function* streamForAbort(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "before-abort" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "after-abort" };
    }

    const session = createMockSession(streamForAbort(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 900,
      messageId: "msg-abort-no-bg",
      abortSignal: abortController.signal,
    });

    abortController.abort();

    await streamPromise;

    const idleEvents = events.filter(
      (event) => event.type === "stream.session.idle",
    );
    expect(idleEvents).toHaveLength(1);
    expect(idleEvents[0].data.reason).toBe("aborted");

    const partialIdleEvents = events.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(partialIdleEvents).toHaveLength(0);
  });

  test("delivers completion events for multiple background agents after partial-idle", async () => {
    const allEvents = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 1000,
      messageId: "msg-lifecycle",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-lifecycle-1",
        subagentType: "research",
        task: "lifecycle task 1",
        toolInput: { prompt: "task 1", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-lifecycle-2",
        subagentType: "research",
        task: "lifecycle task 2",
        toolInput: { prompt: "task 2", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const partialIdleEvents = allEvents.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(partialIdleEvents).toHaveLength(1);
    expect(partialIdleEvents[0].data.activeBackgroundAgentCount).toBe(2);

    // Complete background agents one by one through preserved subscriptions
    const postIdleEvents = collectEvents(bus);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-lifecycle-1",
        success: true,
        result: "first done",
      },
    } as AgentEvent<"subagent.complete">);

    const firstCompleteEvents = postIdleEvents.filter(
      (event) => event.type === "stream.agent.complete",
    );
    expect(firstCompleteEvents).toHaveLength(1);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-lifecycle-2",
        success: false,
        result: "second failed",
      },
    } as AgentEvent<"subagent.complete">);

    const allCompleteEvents = postIdleEvents.filter(
      (event) => event.type === "stream.agent.complete",
    );
    expect(allCompleteEvents).toHaveLength(2);
  });

  test("counts only background agents for partial-idle, not foreground agents", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 1100,
      messageId: "msg-mixed",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    // Register a foreground agent (no run_in_background)
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "fg-agent",
        subagentType: "task",
        task: "foreground task",
        toolInput: { prompt: "foreground work" },
      },
    } as AgentEvent<"subagent.start">);

    // Register a background agent
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-mixed",
        subagentType: "research",
        task: "background task",
        toolInput: { prompt: "background work", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const partialIdleEvents = events.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(partialIdleEvents).toHaveLength(1);
    expect(partialIdleEvents[0].data.activeBackgroundAgentCount).toBe(1);

    const idleEvents = events.filter(
      (event) => event.type === "stream.session.idle",
    );
    expect(idleEvents).toHaveLength(0);
  });

  test("handles sequential streams that both trigger partial-idle", async () => {
    const client = createMockClient();

    // First stream with active background agent
    const firstEvents = collectEvents(bus);

    async function* stream1(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "first" };
    }

    const session1 = createMockSession(stream1(), client);

    const firstPromise = adapter.startStreaming(session1, "first message", {
      runId: 1200,
      messageId: "msg-seq-1",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-seq-1",
        subagentType: "research",
        task: "sequential task 1",
        toolInput: { prompt: "seq 1", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    await firstPromise;

    const firstPartialIdle = firstEvents.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(firstPartialIdle).toHaveLength(1);
    expect(firstPartialIdle[0].runId).toBe(1200);

    // Second stream also with active background agent
    const secondEvents = collectEvents(bus);

    async function* stream2(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "second" };
    }

    const session2 = createMockSession(stream2(), client);

    const secondPromise = adapter.startStreaming(session2, "second message", {
      runId: 1201,
      messageId: "msg-seq-2",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "bg-seq-2",
        subagentType: "research",
        task: "sequential task 2",
        toolInput: { prompt: "seq 2", run_in_background: true },
      },
    } as AgentEvent<"subagent.start">);

    await secondPromise;

    const secondPartialIdle = secondEvents.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    expect(secondPartialIdle).toHaveLength(1);
    expect(secondPartialIdle[0].runId).toBe(1201);
  });
});
