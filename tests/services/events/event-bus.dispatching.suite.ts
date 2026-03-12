import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe("publish() - event dispatching", () => {
    it("should dispatch to both typed and wildcard handlers", () => {
      const typedHandler = mock();
      const wildcardHandler = mock();

      bus.on("stream.text.delta", typedHandler);
      bus.onAll(wildcardHandler);

      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      bus.publish(event);

      expect(typedHandler).toHaveBeenCalledTimes(1);
      expect(wildcardHandler).toHaveBeenCalledTimes(1);
    });

    it("should isolate handler errors and continue dispatching", () => {
      const errorHandler = mock(() => {
        throw new Error("Handler error");
      });
      const successHandler = mock();
      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

      bus.on("stream.text.delta", errorHandler);
      bus.on("stream.text.delta", successHandler);

      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      expect(() => bus.publish(event)).not.toThrow();
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[EventBus] Error in handler for stream.text.delta"),
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it("should isolate wildcard handler errors", () => {
      const errorWildcardHandler = mock(() => {
        throw new Error("Wildcard error");
      });
      const successWildcardHandler = mock();
      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

      bus.onAll(errorWildcardHandler);
      bus.onAll(successWildcardHandler);

      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      expect(() => bus.publish(event)).not.toThrow();
      expect(errorWildcardHandler).toHaveBeenCalledTimes(1);
      expect(successWildcardHandler).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[EventBus] Error in wildcard handler"),
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });

    it("should handle publishing when no handlers are registered", () => {
      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      expect(() => bus.publish(event)).not.toThrow();
    });
  });

  describe("publish() - Zod schema validation", () => {
    it("should skip schema validation when no subscribers are registered", () => {
      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

      const invalidEvent = {
        type: "stream.text.delta" as const,
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: 123, messageId: "msg1" },
      };

      expect(() => bus.publish(invalidEvent as never)).not.toThrow();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should reject event with invalid payload type (delta should be string)", () => {
      const handler = mock();
      bus.on("stream.text.delta", handler);

      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
      const invalidEvent = {
        type: "stream.text.delta" as const,
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: 123, messageId: "msg1" },
      };

      bus.publish(invalidEvent as never);
      expect(handler).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[EventBus] Schema validation failed for stream.text.delta"),
        expect.anything(),
      );

      consoleErrorSpy.mockRestore();
    });

    it("should reject event with missing required fields", () => {
      const handler = mock();
      bus.on("stream.text.delta", handler);

      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
      const invalidEvent = {
        type: "stream.text.delta" as const,
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hello" },
      };

      bus.publish(invalidEvent as never);
      expect(handler).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should reject event with wrong nested types", () => {
      const handler = mock();
      bus.on("stream.tool.start", handler);

      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
      const invalidEvent = {
        type: "stream.tool.start" as const,
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { toolId: "t1", toolName: "bash", toolInput: "not-an-object" },
      };

      bus.publish(invalidEvent as never);
      expect(handler).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should accept valid events and dispatch to handlers", () => {
      const handler = mock();
      bus.on("stream.text.delta", handler);

      const validEvent: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hello", messageId: "msg1" },
      };

      bus.publish(validEvent);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should not dispatch to wildcard handlers on validation failure", () => {
      const wildcardHandler = mock();
      bus.onAll(wildcardHandler);

      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
      const invalidEvent = {
        type: "stream.thinking.complete" as const,
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { sourceKey: "k1", durationMs: "not-a-number" },
      };

      bus.publish(invalidEvent as never);
      expect(wildcardHandler).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
