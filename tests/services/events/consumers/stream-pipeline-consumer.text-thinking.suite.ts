import { beforeEach, describe, expect, it } from "bun:test";
import { CorrelationService } from "@/services/events/consumers/correlation-service.ts";
import { EchoSuppressor } from "@/services/events/consumers/echo-suppressor.ts";
import { StreamPipelineConsumer } from "@/services/events/consumers/stream-pipeline-consumer.ts";
import type { EnrichedBusEvent } from "@/services/events/bus-events.ts";
import type { StreamPartEvent } from "@/state/parts/stream-pipeline.ts";

describe("StreamPipelineConsumer", () => {
  let correlation: CorrelationService;
  let echoSuppressor: EchoSuppressor;
  let consumer: StreamPipelineConsumer;
  let receivedEvents: StreamPartEvent[] = [];

  beforeEach(() => {
    correlation = new CorrelationService();
    echoSuppressor = new EchoSuppressor();
    consumer = new StreamPipelineConsumer(correlation, echoSuppressor);
    receivedEvents = [];
    consumer.onStreamParts((events) => {
      receivedEvents.push(...events);
    });
  });

  it("should map stream.text.delta to text-delta event", () => {
    consumer.processBatch([
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello ", messageId: "msg1" },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "text-delta",
      runId: 1,
      delta: "Hello ",
    });
  });

  it("should filter text deltas through echo suppressor", () => {
    echoSuppressor.expectEcho("Hello World");

    consumer.processBatch([
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello ", messageId: "msg1" },
      },
    ]);

    expect(receivedEvents).toHaveLength(0);
  });

  it("does not suppress agent-scoped text deltas", () => {
    echoSuppressor.expectEcho("agent text");

    consumer.processBatch([
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "agent text", messageId: "msg1", agentId: "agent_1" },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "text-delta",
      runId: 1,
      delta: "agent text",
      agentId: "agent_1",
    });
  });

  it("should map stream.thinking.delta to thinking-meta event", () => {
    consumer.processBatch([
      {
        type: "stream.thinking.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Thinking...", sourceKey: "block1", messageId: "msg1" },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({
      type: "thinking-meta",
      thinkingSourceKey: "block1",
      targetMessageId: "msg1",
      thinkingText: "Thinking...",
    });
  });

  it("coalesces adjacent thinking deltas with same source", () => {
    const events: EnrichedBusEvent[] = [
      {
        type: "stream.thinking.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Thinking", sourceKey: "block1", messageId: "msg1" },
      },
      {
        type: "stream.thinking.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "...", sourceKey: "block1", messageId: "msg1" },
      },
    ];

    consumer.processBatch(events);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({
      type: "thinking-meta",
      thinkingSourceKey: "block1",
      targetMessageId: "msg1",
      thinkingText: "Thinking...",
    });
  });

  it("emits thinking-complete event on stream.thinking.complete", () => {
    consumer.processBatch([
      {
        type: "stream.thinking.complete",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { sourceKey: "0", durationMs: 500 },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({
      type: "thinking-complete",
      runId: 1,
      sourceKey: "0",
      durationMs: 500,
    });
  });

  it("should map stream.thinking.delta agentId to thinking-meta agentId", () => {
    consumer.processBatch([
      {
        type: "stream.thinking.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: {
          delta: "Thinking...",
          sourceKey: "block1",
          messageId: "msg1",
          agentId: "agent_1",
        },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({
      type: "thinking-meta",
      thinkingSourceKey: "block1",
      targetMessageId: "msg1",
      thinkingText: "Thinking...",
      agentId: "agent_1",
    });
  });

  it("coalesces adjacent text deltas within a batch", () => {
    const events: EnrichedBusEvent[] = [
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello ", messageId: "msg1" },
      },
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "World", messageId: "msg1" },
      },
    ];

    consumer.processBatch(events);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]?.type).toBe("text-delta");
    if (receivedEvents[0]?.type === "text-delta") {
      expect(receivedEvents[0].delta).toBe("Hello World");
    }
  });

  it("does not coalesce text deltas across different runs", () => {
    const events: EnrichedBusEvent[] = [
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "old ", messageId: "msg1" },
      },
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 2,
        timestamp: Date.now(),
        data: { delta: "new", messageId: "msg2" },
      },
    ];

    consumer.processBatch(events);

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0]).toMatchObject({ type: "text-delta", runId: 1, delta: "old " });
    expect(receivedEvents[1]).toMatchObject({ type: "text-delta", runId: 2, delta: "new" });
  });

  it("does not coalesce text deltas across non-text boundaries", () => {
    const events: EnrichedBusEvent[] = [
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello ", messageId: "msg1" },
      },
      {
        type: "stream.tool.start",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { toolId: "tool1", toolName: "bash", toolInput: { command: "ls" } },
      },
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "World", messageId: "msg1" },
      },
    ];

    consumer.processBatch(events);

    expect(receivedEvents).toHaveLength(3);
    expect(receivedEvents[0]?.type).toBe("text-delta");
    expect(receivedEvents[1]?.type).toBe("tool-start");
    expect(receivedEvents[2]?.type).toBe("text-delta");
  });

  it("should map stream.text.complete to text-complete event", () => {
    consumer.processBatch([
      {
        type: "stream.text.complete",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { messageId: "msg1", fullText: "Hello World" },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "text-complete",
      runId: 1,
      fullText: "Hello World",
      messageId: "msg1",
    });
  });
});
