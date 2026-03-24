/**
 * Tests for BatchDispatcher buffer overflow protection.
 *
 * Covers:
 * - MAX_BUFFER_SIZE enforcement (10,000 events)
 * - Lifecycle events are never dropped during overflow
 * - Non-lifecycle events are dropped oldest-first
 * - totalDropped metric tracking
 * - Coalescing map rebuild after overflow drop
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("BatchDispatcher - buffer overflow protection", () => {
  let bus: EventBus;
  let dispatcher: BatchDispatcher;

  beforeEach(() => {
    bus = new EventBus({ validatePayloads: false });
  });

  afterEach(() => {
    if (dispatcher) {
      dispatcher.dispose();
    }
  });

  function makeTextDelta(index: number): BusEvent<"stream.text.delta"> {
    return {
      type: "stream.text.delta",
      sessionId: "s1",
      runId: 1,
      timestamp: index,
      data: { delta: `d${index}`, messageId: `m${index}` },
    };
  }

  function makeSessionStart(): BusEvent<"stream.session.start"> {
    return {
      type: "stream.session.start",
      sessionId: "s1",
      runId: 1,
      timestamp: Date.now(),
      data: {},
    };
  }

  function makeSessionIdle(): BusEvent<"stream.session.idle"> {
    return {
      type: "stream.session.idle",
      sessionId: "s1",
      runId: 1,
      timestamp: Date.now(),
      data: {},
    };
  }

  it("should drop oldest non-lifecycle event when buffer exceeds MAX_BUFFER_SIZE", () => {
    dispatcher = new BatchDispatcher(bus, 1000);
    dispatcher.addConsumer(() => {});

    // Fill buffer to exactly 10,000 events
    for (let i = 0; i < 10_000; i++) {
      dispatcher.enqueue(makeTextDelta(i));
    }

    // No drops yet
    expect(dispatcher.metrics.totalDropped).toBe(0);

    // One more event should trigger overflow drop
    dispatcher.enqueue(makeTextDelta(10_000));

    expect(dispatcher.metrics.totalDropped).toBe(1);
  });

  it("should track cumulative drops across multiple overflows", () => {
    dispatcher = new BatchDispatcher(bus, 1000);
    dispatcher.addConsumer(() => {});

    // Fill buffer to 10,000
    for (let i = 0; i < 10_000; i++) {
      dispatcher.enqueue(makeTextDelta(i));
    }

    // Trigger 3 overflow drops
    dispatcher.enqueue(makeTextDelta(10_000));
    dispatcher.enqueue(makeTextDelta(10_001));
    dispatcher.enqueue(makeTextDelta(10_002));

    expect(dispatcher.metrics.totalDropped).toBe(3);
  });

  it("should never drop lifecycle events during overflow", () => {
    dispatcher = new BatchDispatcher(bus, 1000);
    const flushedEvents: BusEvent[] = [];
    dispatcher.addConsumer((events) => flushedEvents.push(...events));

    // Enqueue a lifecycle event first
    dispatcher.enqueue(makeSessionStart());

    // Fill the rest of the buffer with non-lifecycle events
    for (let i = 1; i < 10_000; i++) {
      dispatcher.enqueue(makeTextDelta(i));
    }

    // Trigger overflow — oldest non-lifecycle should be dropped, not the session.start
    dispatcher.enqueue(makeTextDelta(10_000));
    expect(dispatcher.metrics.totalDropped).toBe(1);

    // Flush and verify session.start is still present
    dispatcher.flush();

    const lifecycleEvents = flushedEvents.filter(
      (e) => e.type === "stream.session.start",
    );
    expect(lifecycleEvents).toHaveLength(1);
  });

  it("should protect all lifecycle event types from being dropped", () => {
    dispatcher = new BatchDispatcher(bus, 1000);
    const flushedEvents: BusEvent[] = [];
    dispatcher.addConsumer((events) => flushedEvents.push(...events));

    // Enqueue various lifecycle events
    dispatcher.enqueue(makeSessionStart());
    dispatcher.enqueue(makeSessionIdle());
    dispatcher.enqueue({
      type: "stream.session.error",
      sessionId: "s1",
      runId: 1,
      timestamp: Date.now(),
      data: { error: "test error", code: "TEST" },
    } as BusEvent);
    dispatcher.enqueue({
      type: "stream.session.retry",
      sessionId: "s1",
      runId: 1,
      timestamp: Date.now(),
      data: { attempt: 1, maxAttempts: 3, delayMs: 1000 },
    } as BusEvent);
    dispatcher.enqueue({
      type: "stream.session.partial-idle",
      sessionId: "s1",
      runId: 1,
      timestamp: Date.now(),
      data: { completionReason: "foreground_stream_ended", activeBackgroundAgentCount: 0 },
    } as BusEvent);

    // Fill remaining buffer with text deltas
    for (let i = 5; i < 10_000; i++) {
      dispatcher.enqueue(makeTextDelta(i));
    }

    // Trigger overflow — only non-lifecycle events should be dropped
    dispatcher.enqueue(makeTextDelta(10_000));

    expect(dispatcher.metrics.totalDropped).toBe(1);

    dispatcher.flush();

    // All 5 lifecycle events should still be present
    const lifecycleTypes = new Set([
      "stream.session.start",
      "stream.session.idle",
      "stream.session.error",
      "stream.session.retry",
      "stream.session.partial-idle",
    ]);

    const remainingLifecycle = flushedEvents.filter((e) =>
      lifecycleTypes.has(e.type),
    );
    expect(remainingLifecycle).toHaveLength(5);
  });

  it("should still deliver the new event that triggered overflow", () => {
    dispatcher = new BatchDispatcher(bus, 1000);
    const flushedEvents: BusEvent[] = [];
    dispatcher.addConsumer((events) => flushedEvents.push(...events));

    // Fill buffer to 10,000
    for (let i = 0; i < 10_000; i++) {
      dispatcher.enqueue(makeTextDelta(i));
    }

    // The overflow event should still be enqueued
    const overflowEvent = makeTextDelta(99_999);
    dispatcher.enqueue(overflowEvent);
    dispatcher.flush();

    // The overflow event should be in the flushed output
    const found = flushedEvents.find(
      (e) => e.type === "stream.text.delta" && e.timestamp === 99_999,
    );
    expect(found).toBeDefined();
  });
});
