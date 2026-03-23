// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import type {
  AgentEvent,
  AgentMessage,
  CodingAgentClient,
  EventType,
} from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("CopilotStreamAdapter lifecycle behavior", () => {
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
    const session = createMockSession(
      mockAsyncStream([
        { type: "text", content: "Hello " },
        { type: "text", content: "Copilot" },
      ]),
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { delta: "Hello ", contentType: "text" },
    } as AgentEvent<"message.delta">);
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { delta: "Copilot", contentType: "text" },
    } as AgentEvent<"message.delta">);
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { message: "Hello Copilot" },
    } as AgentEvent<"message.complete">);

    await streamPromise;

    const deltaEvents = events.filter((event) => event.type === "stream.text.delta");
    expect(deltaEvents).toHaveLength(2);
    expect(deltaEvents[0].data.delta).toBe("Hello ");
    expect(deltaEvents[0].data.messageId).toBe("msg-3");
    expect(deltaEvents[0].runId).toBe(200);
    expect(deltaEvents[1].data.delta).toBe("Copilot");

    const completeEvents = events.filter(
      (event) => event.type === "stream.text.complete",
    );
    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0].data.fullText).toBe("Hello Copilot");
    expect(completeEvents[0].runId).toBe(200);
  });

  test("publishes tool start events", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { toolName: "view", toolInput: { path: "/test" }, toolCallId: "tool-456" },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const toolStartEvents = events.filter(
      (event) => event.type === "stream.tool.start",
    );
    expect(toolStartEvents).toHaveLength(1);
    expect(toolStartEvents[0].data.toolName).toBe("view");
    expect(toolStartEvents[0].data.toolInput).toEqual({ path: "/test" });
    expect(toolStartEvents[0].data.toolId).toBe("tool-456");
    expect(toolStartEvents[0].runId).toBe(200);
  });

  test("normalizes non-object tool input for tool start events", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

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
      (event) => event.type === "stream.tool.start",
    );
    expect(toolStartEvents).toHaveLength(1);
    expect(toolStartEvents[0].data.toolId).toBe("tool-raw-input");
    expect(toolStartEvents[0].data.toolInput).toEqual({ value: "ls -la" });
  });

  test("publishes tool complete events", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

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
      (event) => event.type === "stream.tool.complete",
    );
    expect(toolCompleteEvents).toHaveLength(1);
    expect(toolCompleteEvents[0].data.toolName).toBe("view");
    expect(toolCompleteEvents[0].data.toolResult).toBe("file contents");
    expect(toolCompleteEvents[0].data.success).toBe(true);
    expect(toolCompleteEvents[0].runId).toBe(200);
  });

  test("defers session idle until late tool completions are published", async () => {
    const events = collectEvents(bus);

    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }

    const session = createMockSession(slowStream());
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 201,
      messageId: "msg-late-tool-after-idle",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reason: "idle" },
    } as AgentEvent<"session.idle">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "write",
        toolResult: { filePath: "src/example.ts" },
        success: true,
        toolCallId: "tool-late-write",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const toolCompleteIndex = events.findIndex(
      (event) =>
        event.type === "stream.tool.complete"
        && event.data.toolId === "tool-late-write",
    );
    const idleIndex = events.findIndex(
      (event) =>
        event.type === "stream.session.idle"
        && event.runId === 201,
    );

    expect(toolCompleteIndex).toBeGreaterThan(-1);
    expect(idleIndex).toBeGreaterThan(-1);
    expect(toolCompleteIndex).toBeLessThan(idleIndex);
  });

  test("publishes session error on stream error", async () => {
    const events = collectEvents(bus);
    const errorStream: AsyncIterable<AgentMessage> = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw new Error("Copilot connection error");
          },
        };
      },
    };

    await adapter.startStreaming(createMockSession(errorStream), "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    const errorEvents = events.filter(
      (event) => event.type === "stream.session.error",
    );
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].data.error).toBe("Copilot connection error");
    expect(errorEvents[0].runId).toBe(200);
  });

  test("dispose() stops processing", async () => {
    const events = collectEvents(bus);

    async function* longStream(): AsyncGenerator<AgentMessage> {
      for (let index = 0; index < 100; index += 1) {
        yield { type: "text", content: `chunk${index}` };
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    const streamPromise = adapter.startStreaming(
      createMockSession(longStream()),
      "test message",
      {
        runId: 200,
        messageId: "msg-3",
      },
    );

    adapter.dispose();
    await streamPromise;

    expect(events.length).toBeLessThan(10);
  });

  test("events include correct runId from options", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "test" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 888,
      messageId: "msg-3",
    });

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { delta: "test", contentType: "text" },
    } as AgentEvent<"message.delta">);

    await streamPromise;

    expect(events.every((event) => event.runId === 888)).toBe(true);
  });

  test("unmapped event types are ignored", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "test" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("unknown.event" as EventType, {
      type: "unknown.event",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {},
    } as AgentEvent);
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { delta: "test", contentType: "text" },
    } as AgentEvent<"message.delta">);

    await streamPromise;

    const deltaEvents = events.filter((event) => event.type === "stream.text.delta");
    expect(deltaEvents).toHaveLength(1);
    expect(events.every((event) => event.type.startsWith("stream."))).toBe(true);
  });

  test("emits partial-idle and keeps isActive when background agents exist", async () => {
    const events = collectEvents(bus);

    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }

    const session = createMockSession(slowStream());
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 300,
      messageId: "msg-partial-idle",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const state = (adapter as any).state;
    state.subagentTracker.registerAgent("bg-agent-1", { isBackground: true });

    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reason: "idle" },
    } as AgentEvent<"session.idle">);

    // Wait for stream iteration to complete (generator takes ~10ms)
    await new Promise((resolve) => setTimeout(resolve, 20));

    const partialIdleEvents = events.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    const idleEvents = events.filter(
      (event) => event.type === "stream.session.idle",
    );

    expect(partialIdleEvents).toHaveLength(1);
    expect(partialIdleEvents[0].data.completionReason).toBe("idle");
    expect(partialIdleEvents[0].data.activeBackgroundAgentCount).toBe(1);
    expect(partialIdleEvents[0].runId).toBe(300);
    expect(idleEvents).toHaveLength(0);
    expect(state.isActive).toBe(true);
    expect(state.isBackgroundOnly).toBe(true);

    // Unblock the background-completion promise so streamPromise resolves
    state.backgroundCompletionResolve?.();
    await streamPromise;
  });

  test("emits idle and resets isActive when no background agents exist", async () => {
    const events = collectEvents(bus);

    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }

    const session = createMockSession(slowStream());
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 301,
      messageId: "msg-full-idle",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reason: "idle" },
    } as AgentEvent<"session.idle">);

    await streamPromise;

    const idleEvents = events.filter(
      (event) => event.type === "stream.session.idle",
    );
    const partialIdleEvents = events.filter(
      (event) => event.type === "stream.session.partial-idle",
    );
    const state = (adapter as any).state;

    expect(idleEvents).toHaveLength(1);
    expect(idleEvents[0].data.reason).toBe("idle");
    expect(idleEvents[0].runId).toBe(301);
    expect(partialIdleEvents).toHaveLength(0);
    expect(state.isActive).toBe(false);
    expect(state.isBackgroundOnly).toBe(false);
  });

  test("routes background events after partial-idle transition", async () => {
    const events = collectEvents(bus);

    async function* shortStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "done" };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const session = createMockSession(shortStream());
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 400,
      messageId: "msg-bg-route",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const state = (adapter as any).state;
    state.subagentTracker.registerAgent("bg-agent-route", { isBackground: true });

    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reason: "idle" },
    } as AgentEvent<"session.idle">);

    // Wait for stream iteration to complete (generator takes ~10ms)
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(state.isBackgroundOnly).toBe(true);
    expect(state.isActive).toBe(true);

    const eventsBeforeSubagent = events.length;

    client.emit("subagent.update" as EventType, {
      type: "subagent.update",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "bg-agent-route",
        update: "working on background task",
      },
    } as AgentEvent<"subagent.update">);

    const updateEvents = events
      .slice(eventsBeforeSubagent)
      .filter((event) => event.type === "stream.agent.update");
    expect(updateEvents).toHaveLength(1);

    // Unblock the background-completion promise so streamPromise resolves
    state.backgroundCompletionResolve?.();
    await streamPromise;
  });

  test("filters foreground events after partial-idle transition", async () => {
    const events = collectEvents(bus);

    async function* shortStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "done" };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const session = createMockSession(shortStream());
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 401,
      messageId: "msg-fg-filter",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const state = (adapter as any).state;
    state.subagentTracker.registerAgent("bg-agent-filter", { isBackground: true });

    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reason: "idle" },
    } as AgentEvent<"session.idle">);

    // Wait for stream iteration to complete (generator takes ~10ms)
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(state.isBackgroundOnly).toBe(true);

    const eventsAfterIdle = events.length;

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { delta: "stale text", contentType: "text" },
    } as AgentEvent<"message.delta">);

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { delta: "stale reasoning" },
    } as AgentEvent<"reasoning.delta">);

    const foregroundEventsAfterIdle = events
      .slice(eventsAfterIdle)
      .filter(
        (event) =>
          event.type === "stream.text.delta" ||
          event.type === "stream.thinking.delta",
      );
    expect(foregroundEventsAfterIdle).toHaveLength(0);

    // Unblock the background-completion promise so streamPromise resolves
    state.backgroundCompletionResolve?.();
    await streamPromise;
  });

  test("allows events when isBackgroundOnly is true and isActive is false", async () => {
    const events = collectEvents(bus);

    async function* shortStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "done" };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const session = createMockSession(shortStream());
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 402,
      messageId: "msg-bg-fallback",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const state = (adapter as any).state;
    state.subagentTracker.registerAgent("bg-agent-fallback", { isBackground: true });

    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reason: "idle" },
    } as AgentEvent<"session.idle">);

    // Wait for stream iteration to complete (generator takes ~10ms)
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Force isActive=false to test the isBackgroundOnly fallback
    state.isActive = false;
    expect(state.isBackgroundOnly).toBe(true);
    expect(state.isActive).toBe(false);

    const eventsBeforeEmit = events.length;

    client.emit("usage" as EventType, {
      type: "usage",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { inputTokens: 10, outputTokens: 20 },
    } as AgentEvent<"usage">);

    const usageEvents = events
      .slice(eventsBeforeEmit)
      .filter((event) => event.type === "stream.usage");
    expect(usageEvents).toHaveLength(1);

    // Unblock the background-completion promise so streamPromise resolves
    state.backgroundCompletionResolve?.();
    await streamPromise;
  });

  test("emits idle and resets state when last background agent completes in isBackgroundOnly mode", async () => {
    const events = collectEvents(bus);

    async function* shortStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "done" };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const session = createMockSession(shortStream());
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 500,
      messageId: "msg-bg-finalize",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const state = (adapter as any).state;
    state.subagentTracker.registerAgent("bg-final-1", { isBackground: true });

    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reason: "idle" },
    } as AgentEvent<"session.idle">);

    // Wait for stream iteration to complete (generator takes ~10ms)
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(state.isBackgroundOnly).toBe(true);
    expect(state.isActive).toBe(true);

    const eventsBeforeComplete = events.length;

    // Completing the last bg agent resolves backgroundCompletionResolve
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "bg-final-1",
        success: true,
        result: "background work done",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    const newEvents = events.slice(eventsBeforeComplete);
    const agentComplete = newEvents.find((e) => e.type === "stream.agent.complete");
    const idleEvent = newEvents.find((e) => e.type === "stream.session.idle");

    expect(agentComplete).toBeDefined();
    expect(agentComplete.data.agentId).toBe("bg-final-1");
    expect(idleEvent).toBeDefined();
    expect(idleEvent.data.reason).toBe("background-complete");
    expect(idleEvent.runId).toBe(500);
    expect(state.isBackgroundOnly).toBe(false);
    expect(state.isActive).toBe(false);
  });

  test("does not emit idle when non-last background agent completes in isBackgroundOnly mode", async () => {
    const events = collectEvents(bus);

    async function* shortStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "done" };
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const session = createMockSession(shortStream());
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 501,
      messageId: "msg-bg-partial",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const state = (adapter as any).state;
    state.subagentTracker.registerAgent("bg-partial-1", { isBackground: true });
    state.subagentTracker.registerAgent("bg-partial-2", { isBackground: true });

    client.emit("session.idle" as EventType, {
      type: "session.idle",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reason: "idle" },
    } as AgentEvent<"session.idle">);

    // Wait for stream iteration to complete (generator takes ~10ms)
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(state.isBackgroundOnly).toBe(true);

    const eventsBeforeComplete = events.length;

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "bg-partial-1",
        success: true,
        result: "first bg done",
      },
    } as AgentEvent<"subagent.complete">);

    const newEvents = events.slice(eventsBeforeComplete);
    const idleEvents = newEvents.filter((e) => e.type === "stream.session.idle");

    expect(idleEvents).toHaveLength(0);
    expect(state.isBackgroundOnly).toBe(true);
    expect(state.isActive).toBe(true);

    // Complete the remaining bg agent to unblock streamPromise
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "bg-partial-2",
        success: true,
        result: "second bg done",
      },
    } as AgentEvent<"subagent.complete">);
    await streamPromise;
  });

  test("does not emit idle on subagent complete when not in isBackgroundOnly mode", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 502,
      messageId: "msg-normal-complete",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "normal-agent-1",
        subagentType: "explore",
        task: "search code",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "normal-agent-1",
        success: true,
        result: "found it",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    const bgIdleEvents = events.filter(
      (e) => e.type === "stream.session.idle" && e.data.reason === "background-complete",
    );
    expect(bgIdleEvents).toHaveLength(0);
  });
});
