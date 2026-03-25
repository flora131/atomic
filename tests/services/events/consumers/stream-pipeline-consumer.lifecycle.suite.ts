/**
 * Tests for StreamPipelineConsumer lifecycle, edge cases, and callback management.
 *
 * Covers:
 * - onStreamParts() callback registration and unsubscribe
 * - reset() method clears echo suppressor state
 * - Empty batch processing
 * - No callback registered behavior
 * - Batch with only null-mapped events
 * - Callback replacement behavior
 * - Mixed event types in a single batch
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { EchoSuppressor } from "@/services/events/consumers/echo-suppressor.ts";
import { StreamPipelineConsumer } from "@/services/events/consumers/stream-pipeline-consumer.ts";
import type { StreamPartEvent } from "@/state/parts/stream-pipeline.ts";

describe("StreamPipelineConsumer - lifecycle", () => {
  let echoSuppressor: EchoSuppressor;
  let consumer: StreamPipelineConsumer;

  beforeEach(() => {
    echoSuppressor = new EchoSuppressor();
    consumer = new StreamPipelineConsumer(echoSuppressor);
  });

  describe("onStreamParts()", () => {
    it("should return an unsubscribe function", () => {
      const receivedBefore: StreamPartEvent[] = [];

      const unsub = consumer.onStreamParts((events) => {
        receivedBefore.push(...events);
      });

      consumer.processBatch([{
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "before", messageId: "m1" },
      }]);

      expect(receivedBefore).toHaveLength(1);

      unsub();

      consumer.processBatch([{
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "after", messageId: "m1" },
      }]);

      // Should still be 1 because callback was removed
      expect(receivedBefore).toHaveLength(1);
    });

    it("should replace previous callback when called again", () => {
      const first: StreamPartEvent[] = [];
      const second: StreamPartEvent[] = [];

      consumer.onStreamParts((events) => first.push(...events));
      consumer.onStreamParts((events) => second.push(...events));

      consumer.processBatch([{
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "test", messageId: "m1" },
      }]);

      // Only the second (latest) callback should receive events
      expect(first).toHaveLength(0);
      expect(second).toHaveLength(1);
    });
  });

  describe("processBatch() edge cases", () => {
    it("should not throw when no callback is registered", () => {
      expect(() =>
        consumer.processBatch([{
          type: "stream.text.delta",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "orphan", messageId: "m1" },
        }]),
      ).not.toThrow();
    });

    it("should not invoke callback for empty batch", () => {
      const received: StreamPartEvent[] = [];
      consumer.onStreamParts((events) => received.push(...events));

      consumer.processBatch([]);

      expect(received).toHaveLength(0);
    });

    it("should not invoke callback when all events map to null", () => {
      const received: StreamPartEvent[] = [];
      consumer.onStreamParts((events) => received.push(...events));

      // Session events map to null (toStreamPart: () => null)
      consumer.processBatch([
        {
          type: "stream.session.start",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: {},
        },
        {
          type: "stream.session.idle",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: {},
        },
      ]);

      // Callback should NOT have been called because no parts were generated
      expect(received).toHaveLength(0);
    });

    it("should handle batch with events that have no registered mapper", () => {
      const received: StreamPartEvent[] = [];
      consumer.onStreamParts((events) => received.push(...events));

      // Stream session info events have no stream part mapper (returns null)
      consumer.processBatch([
        {
          type: "stream.session.info",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: { infoType: "general", message: "info" },
        },
      ]);

      expect(received).toHaveLength(0);
    });

    it("should process mixed event types in single batch", () => {
      const received: StreamPartEvent[] = [];
      consumer.onStreamParts((events) => received.push(...events));

      consumer.processBatch([
        {
          type: "stream.text.delta",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "text", messageId: "m1" },
        },
        {
          type: "stream.session.start",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: {},
        },
        {
          type: "stream.tool.start",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: { toolId: "t1", toolName: "bash", toolInput: { cmd: "ls" } },
        },
        {
          type: "stream.thinking.delta",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "hmm", sourceKey: "sk1", messageId: "m1" },
        },
      ]);

      // session.start maps to null, so 3 events should come through
      expect(received).toHaveLength(3);
      expect(received[0]!.type).toBe("text-delta");
      expect(received[1]!.type).toBe("tool-start");
      expect(received[2]!.type).toBe("thinking-meta");
    });
  });

  describe("reset()", () => {
    it("should clear echo suppressor state", () => {
      const received: StreamPartEvent[] = [];
      consumer.onStreamParts((events) => received.push(...events));

      // Register an echo target
      echoSuppressor.expectEcho("Hello World");
      expect(echoSuppressor.hasPendingTargets).toBe(true);

      // Reset should clear it
      consumer.reset();
      expect(echoSuppressor.hasPendingTargets).toBe(false);

      // Text delta should now pass through (no active targets)
      consumer.processBatch([{
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello World", messageId: "m1" },
      }]);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "text-delta",
        delta: "Hello World",
      });
    });
  });

  describe("coalescing within batch", () => {
    it("should coalesce adjacent text deltas with same agentId", () => {
      const received: StreamPartEvent[] = [];
      consumer.onStreamParts((events) => received.push(...events));

      consumer.processBatch([
        {
          type: "stream.text.delta",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "Hello ", messageId: "m1", agentId: "a1" },
        },
        {
          type: "stream.text.delta",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "World", messageId: "m1", agentId: "a1" },
        },
      ]);

      // Should be coalesced into 1 event
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        type: "text-delta",
        delta: "Hello World",
        agentId: "a1",
      });
    });

    it("should not coalesce text deltas with different agentId", () => {
      const received: StreamPartEvent[] = [];
      consumer.onStreamParts((events) => received.push(...events));

      consumer.processBatch([
        {
          type: "stream.text.delta",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "Hello ", messageId: "m1", agentId: "a1" },
        },
        {
          type: "stream.text.delta",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "World", messageId: "m1", agentId: "a2" },
        },
      ]);

      expect(received).toHaveLength(2);
    });

    it("should handle single event batch without coalescing", () => {
      const received: StreamPartEvent[] = [];
      consumer.onStreamParts((events) => received.push(...events));

      consumer.processBatch([{
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "only one", messageId: "m1" },
      }]);

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ type: "text-delta", delta: "only one" });
    });
  });
});
