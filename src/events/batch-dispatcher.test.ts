/**
 * Unit tests for BatchDispatcher
 *
 * Tests the batch dispatcher functionality including:
 * - Event enqueueing and buffering
 * - Frame-aligned automatic flushing
 * - Double-buffer swap pattern
 * - Key-based coalescing for state updates
 * - Text delta accumulation (never coalesced)
 * - Timer lifecycle management
 * - Disposal and cleanup
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { BatchDispatcher } from "./batch-dispatcher.ts";
import { AtomicEventBus } from "./event-bus.ts";
import type { BusEvent } from "./bus-events.ts";

describe("BatchDispatcher", () => {
  let bus: AtomicEventBus;
  let dispatcher: BatchDispatcher;
  let publishedEvents: BusEvent[];

  /** Create dispatcher and register a consumer that collects flushed events. */
  function createDispatcher(flushIntervalMs = 1000): BatchDispatcher {
    dispatcher = new BatchDispatcher(bus, flushIntervalMs);
    dispatcher.addConsumer((events) => {
      publishedEvents.push(...events);
    });
    return dispatcher;
  }

  beforeEach(() => {
    bus = new AtomicEventBus();
    publishedEvents = [];
  });

  afterEach(() => {
    // Clean up dispatcher to prevent timer leaks
    if (dispatcher) {
      dispatcher.dispose();
    }
  });

  describe("enqueue()", () => {
    it("should add events to buffer", () => {
      createDispatcher(1000);

      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      dispatcher.enqueue(event);

      // Event should not be published yet
      expect(publishedEvents.length).toBe(0);
    });

    it("should accumulate multiple events in buffer", () => {
      createDispatcher(1000);

      const event1: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      const event2: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: " world", messageId: "msg1" },
      };

      dispatcher.enqueue(event1);
      dispatcher.enqueue(event2);

      // Events should not be published yet
      expect(publishedEvents.length).toBe(0);
    });
  });

  describe("flush()", () => {
    it("should publish all events to bus", () => {
      createDispatcher(1000);

      const event1: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      const event2: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: " world", messageId: "msg1" },
      };

      dispatcher.enqueue(event1);
      dispatcher.enqueue(event2);
      dispatcher.flush();

      expect(publishedEvents.length).toBe(2);
      expect(publishedEvents[0]).toEqual(event1);
      expect(publishedEvents[1]).toEqual(event2);
    });

    it("should use double-buffer swap (old write becomes new read)", () => {
      createDispatcher(1000);

      const event1: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "First", messageId: "msg1" },
      };

      dispatcher.enqueue(event1);
      dispatcher.flush();

      expect(publishedEvents.length).toBe(1);
      expect(publishedEvents[0]).toEqual(event1);

      // Clear published events
      publishedEvents.length = 0;

      // Enqueue new event after flush
      const event2: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Second", messageId: "msg1" },
      };

      dispatcher.enqueue(event2);
      dispatcher.flush();

      expect(publishedEvents.length).toBe(1);
      expect(publishedEvents[0]).toEqual(event2);
    });

    it("should preserve flush order for non-coalesced events", () => {
      createDispatcher(1000);

      const events: BusEvent[] = [
        {
          type: "stream.text.delta",
          sessionId: "test-session",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "First", messageId: "msg1" },
        },
        {
          type: "stream.text.delta",
          sessionId: "test-session",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "Second", messageId: "msg1" },
        },
        {
          type: "stream.text.delta",
          sessionId: "test-session",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "Third", messageId: "msg1" },
        },
      ];

      events.forEach((event) => dispatcher.enqueue(event));
      dispatcher.flush();

      expect(publishedEvents.length).toBe(3);
      expect(publishedEvents[0]).toEqual(events[0]);
      expect(publishedEvents[1]).toEqual(events[1]);
      expect(publishedEvents[2]).toEqual(events[2]);
    });
  });

  describe("coalescing behavior", () => {
    it("should coalesce events with same key (only latest retained)", () => {
      createDispatcher(1000);

      const event1: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-123",
          toolName: "test_tool",
          toolInput: { param: "value1" },
        },
      };

      const event2: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now() + 1,
        data: {
          toolId: "tool-123",
          toolName: "test_tool",
          toolInput: { param: "value2" },
        },
      };

      dispatcher.enqueue(event1);
      dispatcher.enqueue(event2);
      dispatcher.flush();

      // Should only have the latest event
      expect(publishedEvents.length).toBe(1);
      expect(publishedEvents[0]).toEqual(event2);
    });

    it("should never coalesce text deltas (all accumulate)", () => {
      createDispatcher(1000);

      const event1: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      const event2: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: " world", messageId: "msg1" },
      };

      const event3: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "!", messageId: "msg1" },
      };

      dispatcher.enqueue(event1);
      dispatcher.enqueue(event2);
      dispatcher.enqueue(event3);
      dispatcher.flush();

      // All text deltas should be present
      expect(publishedEvents.length).toBe(3);
      expect(publishedEvents[0]).toEqual(event1);
      expect(publishedEvents[1]).toEqual(event2);
      expect(publishedEvents[2]).toEqual(event3);
    });

    it("should handle mixed coalescable and non-coalescable events", () => {
      createDispatcher(1000);

      const textDelta1: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      const toolEvent1: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-123",
          toolName: "test_tool",
          toolInput: { version: 1 },
        },
      };

      const textDelta2: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: " world", messageId: "msg1" },
      };

      const toolEvent2: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now() + 1,
        data: {
          toolId: "tool-123",
          toolName: "test_tool",
          toolInput: { version: 2 },
        },
      };

      dispatcher.enqueue(textDelta1);
      dispatcher.enqueue(toolEvent1);
      dispatcher.enqueue(textDelta2);
      dispatcher.enqueue(toolEvent2);
      dispatcher.flush();

      // Should have both text deltas (not coalesced) and only the latest tool event (coalesced)
      expect(publishedEvents.length).toBe(3);
      expect(publishedEvents[0]).toEqual(textDelta1);
      expect(publishedEvents[1]).toEqual(toolEvent2); // Replaced toolEvent1
      expect(publishedEvents[2]).toEqual(textDelta2);
    });

    it("should coalesce multiple different tools independently", () => {
      createDispatcher(1000);

      const tool1Event1: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-123",
          toolName: "tool_a",
          toolInput: { version: 1 },
        },
      };

      const tool2Event1: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-456",
          toolName: "tool_b",
          toolInput: { version: 1 },
        },
      };

      const tool1Event2: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now() + 1,
        data: {
          toolId: "tool-123",
          toolName: "tool_a",
          toolInput: { version: 2 },
        },
      };

      dispatcher.enqueue(tool1Event1);
      dispatcher.enqueue(tool2Event1);
      dispatcher.enqueue(tool1Event2);
      dispatcher.flush();

      // Should have latest version of tool-123 and tool-456
      expect(publishedEvents.length).toBe(2);
      expect(publishedEvents[0]).toEqual(tool1Event2); // tool-123 updated
      expect(publishedEvents[1]).toEqual(tool2Event1); // tool-456 unchanged
    });
  });

  describe("timer lifecycle", () => {
    it("should auto-start timer on first enqueue", async () => {
      createDispatcher(50);

      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      dispatcher.enqueue(event);

      // Wait for timer to fire
      await Bun.sleep(100);

      // Event should be published automatically
      expect(publishedEvents.length).toBe(1);
      expect(publishedEvents[0]).toEqual(event);
    });

    it("should auto-stop timer when buffer empty after flush", async () => {
      createDispatcher(50);

      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      dispatcher.enqueue(event);

      // Wait for auto-flush
      await Bun.sleep(100);

      expect(publishedEvents.length).toBe(1);

      // Clear published events
      publishedEvents.length = 0;

      // Wait longer to ensure timer stopped (no additional flushes)
      await Bun.sleep(150);

      // Should still be 0 (timer stopped)
      expect(publishedEvents.length).toBe(0);
    });

    it("should continue timer while events are being enqueued", async () => {
      createDispatcher(50);

      const event1: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "First", messageId: "msg1" },
      };

      const event2: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Second", messageId: "msg1" },
      };

      dispatcher.enqueue(event1);

      // Wait for first flush
      await Bun.sleep(75);
      expect(publishedEvents.length).toBe(1);

      // Enqueue second event
      dispatcher.enqueue(event2);

      // Wait for second flush
      await Bun.sleep(75);
      expect(publishedEvents.length).toBe(2);
    });
  });

  describe("dispose()", () => {
    it("should clear timer and buffers", () => {
      createDispatcher(1000);

      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      dispatcher.enqueue(event);
      dispatcher.dispose();

      // Events should be cleared without being flushed
      expect(publishedEvents.length).toBe(0);
    });

    it("should prevent auto-flush after dispose", async () => {
      createDispatcher(50);

      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      dispatcher.enqueue(event);
      dispatcher.dispose();

      // Wait longer than flush interval
      await Bun.sleep(100);

      // Should not have been flushed
      expect(publishedEvents.length).toBe(0);
    });
  });
});
