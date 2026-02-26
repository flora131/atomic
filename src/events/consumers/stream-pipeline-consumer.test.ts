/**
 * Tests for StreamPipelineConsumer
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { StreamPipelineConsumer } from "./stream-pipeline-consumer.ts";
import { CorrelationService } from "./correlation-service.ts";
import { EchoSuppressor } from "./echo-suppressor.ts";
import type { EnrichedBusEvent } from "../bus-events.ts";
import type { StreamPartEvent } from "../../ui/parts/stream-pipeline.ts";

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
    const event: EnrichedBusEvent = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello ", messageId: "msg1" },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "text-delta",
      delta: "Hello ",
    });
  });

  it("should filter text deltas through echo suppressor", () => {
    // Register an expected echo
    echoSuppressor.expectEcho("Hello World");

    const event: EnrichedBusEvent = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello ", messageId: "msg1" },
    };

    consumer.processBatch([event]);

    // Should be suppressed (empty)
    expect(receivedEvents).toHaveLength(0);
  });

  it("should map stream.thinking.delta to thinking-meta event", () => {
    const event: EnrichedBusEvent = {
      type: "stream.thinking.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Thinking...", sourceKey: "block1", messageId: "msg1" },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({
      type: "thinking-meta",
      thinkingSourceKey: "block1",
      targetMessageId: "msg1",
      thinkingText: "Thinking...",
    });
  });

  it("should map stream.tool.start to tool-start event", () => {
    const event: EnrichedBusEvent = {
      type: "stream.tool.start",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { toolId: "tool1", toolName: "bash", toolInput: { command: "ls" } },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-start",
      toolId: "tool1",
      toolName: "bash",
      input: { command: "ls" },
    });
  });

  it("should map stream.tool.complete to tool-complete event", () => {
    const event: EnrichedBusEvent = {
      type: "stream.tool.complete",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool1",
        toolName: "bash",
        toolResult: "file1.txt\nfile2.txt",
        success: true,
      },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-complete",
      toolId: "tool1",
      output: "file1.txt\nfile2.txt",
      success: true,
      error: undefined,
    });
  });

  it("should batch multiple events", () => {
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

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0]?.type).toBe("text-delta");
    expect(receivedEvents[1]?.type).toBe("text-delta");
    if (receivedEvents[0]?.type === "text-delta") {
      expect(receivedEvents[0].delta).toBe("Hello ");
    }
    if (receivedEvents[1]?.type === "text-delta") {
      expect(receivedEvents[1].delta).toBe("World");
    }
  });

  it("should ignore unmapped event types", () => {
    const event: EnrichedBusEvent = {
      type: "stream.session.start",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: {},
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(0);
  });

  it("should support callback unsubscribe", () => {
    const unsubscribe = consumer.onStreamParts((events) => {
      receivedEvents.push(...events);
    });

    unsubscribe();

    const event: EnrichedBusEvent = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Test", messageId: "msg1" },
    };

    consumer.processBatch([event]);

    // Should not receive events after unsubscribe
    expect(receivedEvents).toHaveLength(0);
  });

  it("should reset state on reset()", () => {
    // Setup some state
    const event: EnrichedBusEvent = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Test", messageId: "msg1" },
    };

    consumer.processBatch([event]);
    expect(receivedEvents).toHaveLength(1);

    // Reset
    consumer.reset();

    // Echo suppressor and correlation should be reset (tested in their own tests)
    // This test just verifies reset() doesn't throw
    expect(() => consumer.reset()).not.toThrow();
  });
});
