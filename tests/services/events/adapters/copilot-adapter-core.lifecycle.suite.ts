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
});
