import { beforeEach, describe, expect, it, mock } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe("clear() - cleanup", () => {
    it("should remove all handlers", () => {
      const typedHandler = mock();
      const wildcardHandler = mock();

      bus.on("stream.text.delta", typedHandler);
      bus.onAll(wildcardHandler);

      expect(bus.handlerCount).toBe(2);

      bus.clear();
      expect(bus.handlerCount).toBe(0);

      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      bus.publish(event);
      expect(typedHandler).not.toHaveBeenCalled();
      expect(wildcardHandler).not.toHaveBeenCalled();
    });

    it("should allow new subscriptions after clear", () => {
      const handler = mock();
      bus.on("stream.text.delta", handler);
      bus.clear();

      const newHandler = mock();
      bus.on("stream.text.delta", newHandler);

      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      bus.publish(event);

      expect(handler).not.toHaveBeenCalled();
      expect(newHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("hasHandlers() - introspection", () => {
    it("should return true when handlers exist for event type", () => {
      bus.on("stream.text.delta", () => {});
      expect(bus.hasHandlers("stream.text.delta")).toBe(true);
    });

    it("should return false when no handlers exist for event type", () => {
      expect(bus.hasHandlers("stream.text.delta")).toBe(false);
    });

    it("should return false after all handlers are unsubscribed", () => {
      const unsubscribe = bus.on("stream.text.delta", () => {});
      expect(bus.hasHandlers("stream.text.delta")).toBe(true);
      unsubscribe();
      expect(bus.hasHandlers("stream.text.delta")).toBe(false);
    });

    it("should not count wildcard handlers", () => {
      bus.onAll(() => {});
      expect(bus.hasHandlers("stream.text.delta")).toBe(false);
    });
  });

  describe("handlerCount - introspection", () => {
    it("should count typed handlers", () => {
      expect(bus.handlerCount).toBe(0);

      bus.on("stream.text.delta", () => {});
      expect(bus.handlerCount).toBe(1);

      bus.on("stream.text.delta", () => {});
      expect(bus.handlerCount).toBe(2);

      bus.on("stream.tool.start", () => {});
      expect(bus.handlerCount).toBe(3);
    });

    it("should count wildcard handlers", () => {
      bus.onAll(() => {});
      expect(bus.handlerCount).toBe(1);

      bus.onAll(() => {});
      expect(bus.handlerCount).toBe(2);
    });

    it("should count both typed and wildcard handlers", () => {
      bus.on("stream.text.delta", () => {});
      bus.onAll(() => {});

      expect(bus.handlerCount).toBe(2);
    });

    it("should decrease count after unsubscribe", () => {
      const unsubscribe1 = bus.on("stream.text.delta", () => {});
      const unsubscribe2 = bus.onAll(() => {});

      expect(bus.handlerCount).toBe(2);

      unsubscribe1();
      expect(bus.handlerCount).toBe(1);

      unsubscribe2();
      expect(bus.handlerCount).toBe(0);
    });
  });
});
