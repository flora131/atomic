import { beforeEach, describe, expect, it, mock } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe("on() - typed subscriptions", () => {
    it("should subscribe and receive events for specific type", () => {
      const handler = mock();
      bus.on("stream.text.delta", handler);

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
    });

    it("should support multiple handlers for same event type", () => {
      const handler1 = mock();
      const handler2 = mock();

      bus.on("stream.text.delta", handler1);
      bus.on("stream.text.delta", handler2);

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
    });

    it("should only notify handlers for matching event type", () => {
      const textHandler = mock();
      const toolHandler = mock();

      bus.on("stream.text.delta", textHandler);
      bus.on("stream.tool.start", toolHandler);

      const textEvent: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      bus.publish(textEvent);

      expect(textHandler).toHaveBeenCalledTimes(1);
      expect(toolHandler).not.toHaveBeenCalled();
    });

    it("should return unsubscribe function that removes handler", () => {
      const handler = mock();
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

      unsubscribe();
      bus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should handle unsubscribe being called multiple times", () => {
      const handler = mock();
      const unsubscribe = bus.on("stream.text.delta", handler);

      unsubscribe();
      unsubscribe();

      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe("onAll() - wildcard subscriptions", () => {
    it("should receive all event types", () => {
      const wildcardHandler = mock();
      bus.onAll(wildcardHandler);

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
          toolName: "bash",
          toolInput: { command: "ls" },
        },
      };

      bus.publish(textEvent);
      bus.publish(toolEvent);

      expect(wildcardHandler).toHaveBeenCalledTimes(2);
      expect(wildcardHandler).toHaveBeenCalledWith(textEvent);
      expect(wildcardHandler).toHaveBeenCalledWith(toolEvent);
    });

    it("should support multiple wildcard handlers", () => {
      const handler1 = mock();
      const handler2 = mock();

      bus.onAll(handler1);
      bus.onAll(handler2);

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
    });

    it("should return unsubscribe function for wildcard handlers", () => {
      const handler = mock();
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

      unsubscribe();

      bus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
