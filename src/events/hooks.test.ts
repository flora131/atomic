/**
 * Unit tests for React Event Bus Hooks
 *
 * Note: These tests focus on the event bus integration logic.
 * Full React hook lifecycle testing would require a React testing library,
 * but the core logic (subscriptions, cleanup, handler refs) is tested here.
 */

import { describe, test, expect, mock } from "bun:test";
import { AtomicEventBus } from "./event-bus.ts";
import { BatchDispatcher } from "./batch-dispatcher.ts";
import type { BusEvent } from "./bus-events.ts";

// ============================================================================
// Tests: Event Bus Integration
// ============================================================================

describe("Event Bus Hook Integration", () => {
  test("bus.on() subscribes to specific event type", () => {
    const bus = new AtomicEventBus();
    const handler = mock(() => {});

    const unsubscribe = bus.on("stream.text.delta", handler);

    const event: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello", messageId: "msg1" },
    };

    bus.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);

    // Cleanup
    unsubscribe();
  });

  test("unsubscribe function removes handler", () => {
    const bus = new AtomicEventBus();
    const handler = mock(() => {});

    const unsubscribe = bus.on("stream.text.delta", handler);

    const event: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello", messageId: "msg1" },
    };

    bus.publish(event);
    expect(handler).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsubscribe();

    // Publish again - should not be called
    bus.publish(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("bus.onAll() subscribes to all event types", () => {
    const bus = new AtomicEventBus();
    const handler = mock(() => {});

    const unsubscribe = bus.onAll(handler);

    const textEvent: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello", messageId: "msg1" },
    };

    const toolEvent: BusEvent<"stream.tool.start"> = {
      type: "stream.tool.start",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool1",
        toolName: "test-tool",
        toolInput: {},
      },
    };

    bus.publish(textEvent);
    bus.publish(toolEvent);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledWith(textEvent);
    expect(handler).toHaveBeenCalledWith(toolEvent);

    // Cleanup
    unsubscribe();
  });

  test("onAll unsubscribe function removes handler", () => {
    const bus = new AtomicEventBus();
    const handler = mock(() => {});

    const unsubscribe = bus.onAll(handler);

    const event: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello", messageId: "msg1" },
    };

    bus.publish(event);
    expect(handler).toHaveBeenCalledTimes(1);

    // Unsubscribe
    unsubscribe();

    // Publish again - should not be called
    bus.publish(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("multiple subscriptions to same event type work independently", () => {
    const bus = new AtomicEventBus();
    const handler1 = mock(() => {});
    const handler2 = mock(() => {});

    const unsubscribe1 = bus.on("stream.text.delta", handler1);
    const unsubscribe2 = bus.on("stream.text.delta", handler2);

    const event: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello", messageId: "msg1" },
    };

    bus.publish(event);

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);

    // Unsubscribe first handler
    unsubscribe1();

    bus.publish(event);

    // Only second handler should be called
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(2);

    // Cleanup
    unsubscribe2();
  });

  test("typed subscription only receives correct event type", () => {
    const bus = new AtomicEventBus();
    const handler = mock(() => {});

    const unsubscribe = bus.on("stream.text.delta", handler);

    // Publish wrong type
    const wrongEvent: BusEvent<"stream.tool.start"> = {
      type: "stream.tool.start",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool1",
        toolName: "test-tool",
        toolInput: {},
      },
    };

    bus.publish(wrongEvent);
    expect(handler).not.toHaveBeenCalled();

    // Publish correct type
    const correctEvent: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello", messageId: "msg1" },
    };

    bus.publish(correctEvent);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(correctEvent);

    // Cleanup
    unsubscribe();
  });

  test("dispatcher enqueues events to bus", async () => {
    const bus = new AtomicEventBus();
    const dispatcher = new BatchDispatcher(bus, 10); // 10ms flush interval
    const handler = mock(() => {});

    bus.on("stream.text.delta", handler);

    const event: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello", messageId: "msg1" },
    };

    dispatcher.enqueue(event);

    // Event not immediately published
    expect(handler).not.toHaveBeenCalled();

    // Wait for flush interval
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Event should be published now
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);

    // Cleanup
    dispatcher.dispose();
  });
});
