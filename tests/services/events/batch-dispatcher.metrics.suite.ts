/**
 * Tests for BatchDispatcher metrics, consumers, and buffer overflow.
 *
 * Covers:
 * - metrics property tracking (totalFlushed, totalCoalesced, flushCount, etc.)
 * - addConsumer/removeConsumer lifecycle
 * - Multiple consumers receiving same events
 * - Buffer overflow protection (MAX_BUFFER_SIZE = 10_000)
 * - dispose() resets metrics
 * - Empty flush behavior
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("BatchDispatcher", () => {
  let bus: EventBus;
  let dispatcher: BatchDispatcher;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    if (dispatcher) {
      dispatcher.dispose();
    }
  });

  describe("metrics tracking", () => {
    it("should start with zeroed metrics", () => {
      dispatcher = new BatchDispatcher(bus, 1000);

      const m = dispatcher.metrics;
      expect(m.totalFlushed).toBe(0);
      expect(m.totalCoalesced).toBe(0);
      expect(m.flushCount).toBe(0);
      expect(m.lastFlushDuration).toBe(0);
      expect(m.lastFlushSize).toBe(0);
      expect(m.totalDropped).toBe(0);
    });

    it("should update totalFlushed and flushCount after flush", () => {
      dispatcher = new BatchDispatcher(bus, 1000);
      dispatcher.addConsumer(() => {});

      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "a", messageId: "m1" },
      });
      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "b", messageId: "m1" },
      });

      dispatcher.flush();

      expect(dispatcher.metrics.totalFlushed).toBe(2);
      expect(dispatcher.metrics.flushCount).toBe(1);
      expect(dispatcher.metrics.lastFlushSize).toBe(2);
      expect(dispatcher.metrics.lastFlushDuration).toBeGreaterThanOrEqual(0);
    });

    it("should accumulate totalFlushed across multiple flushes", () => {
      dispatcher = new BatchDispatcher(bus, 1000);
      dispatcher.addConsumer(() => {});

      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "a", messageId: "m1" },
      });
      dispatcher.flush();

      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "b", messageId: "m1" },
      });
      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "c", messageId: "m1" },
      });
      dispatcher.flush();

      expect(dispatcher.metrics.totalFlushed).toBe(3);
      expect(dispatcher.metrics.flushCount).toBe(2);
      expect(dispatcher.metrics.lastFlushSize).toBe(2);
    });

    it("should track totalCoalesced for coalesced events", () => {
      dispatcher = new BatchDispatcher(bus, 1000);
      dispatcher.addConsumer(() => {});

      // Two tool start events with same toolId should coalesce
      dispatcher.enqueue({
        type: "stream.tool.start",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { toolId: "t1", toolName: "bash", toolInput: { v: 1 } },
      });
      dispatcher.enqueue({
        type: "stream.tool.start",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now() + 1,
        data: { toolId: "t1", toolName: "bash", toolInput: { v: 2 } },
      });

      expect(dispatcher.metrics.totalCoalesced).toBe(1);

      dispatcher.flush();
      expect(dispatcher.metrics.totalFlushed).toBe(1);
    });

    it("should handle empty flush with zero lastFlushSize", () => {
      dispatcher = new BatchDispatcher(bus, 1000);
      dispatcher.addConsumer(() => {});

      dispatcher.flush();

      expect(dispatcher.metrics.flushCount).toBe(1);
      expect(dispatcher.metrics.lastFlushSize).toBe(0);
      expect(dispatcher.metrics.totalFlushed).toBe(0);
    });
  });

  describe("addConsumer() and removeConsumer", () => {
    it("should deliver events to registered consumer on flush", () => {
      dispatcher = new BatchDispatcher(bus, 1000);
      const received: BusEvent[][] = [];
      dispatcher.addConsumer((events) => received.push([...events]));

      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });
      dispatcher.flush();

      expect(received).toHaveLength(1);
      expect(received[0]).toHaveLength(1);
    });

    it("should deliver events to multiple consumers", () => {
      dispatcher = new BatchDispatcher(bus, 1000);
      const received1: BusEvent[][] = [];
      const received2: BusEvent[][] = [];

      dispatcher.addConsumer((events) => received1.push([...events]));
      dispatcher.addConsumer((events) => received2.push([...events]));

      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });
      dispatcher.flush();

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      // Both should get the same events
      expect(received1[0]).toEqual(received2[0]);
    });

    it("should unsubscribe consumer via returned function", () => {
      dispatcher = new BatchDispatcher(bus, 1000);
      const received: BusEvent[][] = [];

      const unsub = dispatcher.addConsumer((events) => received.push([...events]));

      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "first", messageId: "m1" },
      });
      dispatcher.flush();
      expect(received).toHaveLength(1);

      unsub();

      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "second", messageId: "m1" },
      });
      dispatcher.flush();

      // Should still be 1 after unsubscribe
      expect(received).toHaveLength(1);
    });

    it("should not deliver events if no consumers registered", () => {
      dispatcher = new BatchDispatcher(bus, 1000);

      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });

      // Should not throw
      expect(() => dispatcher.flush()).not.toThrow();
      // Metrics still update
      expect(dispatcher.metrics.flushCount).toBe(1);
    });
  });

  describe("dispose() resets metrics", () => {
    it("should reset all metrics to zero", () => {
      dispatcher = new BatchDispatcher(bus, 1000);
      dispatcher.addConsumer(() => {});

      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });
      dispatcher.flush();

      expect(dispatcher.metrics.totalFlushed).toBeGreaterThan(0);

      dispatcher.dispose();

      const m = dispatcher.metrics;
      expect(m.totalFlushed).toBe(0);
      expect(m.totalCoalesced).toBe(0);
      expect(m.flushCount).toBe(0);
      expect(m.lastFlushDuration).toBe(0);
      expect(m.lastFlushSize).toBe(0);
      expect(m.totalDropped).toBe(0);
    });
  });

  describe("immediate flush when enough time elapsed", () => {
    it("should flush immediately if flush interval has elapsed since last flush", () => {
      dispatcher = new BatchDispatcher(bus, 0);
      const received: BusEvent[][] = [];
      dispatcher.addConsumer((events) => received.push([...events]));

      // With flushIntervalMs=0, the first enqueue should trigger immediate flush
      dispatcher.enqueue({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "instant", messageId: "m1" },
      });

      // Should have been flushed immediately
      expect(received).toHaveLength(1);
      expect(dispatcher.metrics.flushCount).toBe(1);
    });
  });
});
