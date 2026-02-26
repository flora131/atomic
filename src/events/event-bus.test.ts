/**
 * Unit tests for AtomicEventBus
 *
 * Tests the core event bus functionality including:
 * - Type-safe event subscription and publishing
 * - Wildcard subscriptions
 * - Error isolation
 * - Handler management and cleanup
 */

import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test";
import { AtomicEventBus } from "./event-bus.ts";
import type { BusEvent } from "./bus-events.ts";

describe("AtomicEventBus", () => {
  let bus: AtomicEventBus;

  beforeEach(() => {
    bus = new AtomicEventBus();
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

      // Unsubscribe
      unsubscribe();

      // Publish again - handler should not be called
      bus.publish(event);
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it("should handle unsubscribe being called multiple times", () => {
      const handler = mock();
      const unsubscribe = bus.on("stream.text.delta", handler);

      unsubscribe();
      unsubscribe(); // Should not throw

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
      expect(handler).toHaveBeenCalledTimes(1); // Still 1
    });
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

      // Spy on console.error to verify error logging
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

      // Should not throw
      expect(() => bus.publish(event)).not.toThrow();

      // Both handlers should have been called
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);

      // Error should be logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[EventBus] Error in handler for stream.text.delta"),
        expect.any(Error)
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
        expect.any(Error)
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

      // Should not throw
      expect(() => bus.publish(event)).not.toThrow();
    });
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

  describe("publish() - Zod schema validation", () => {
    it("should reject event with invalid payload type (delta should be string)", () => {
      const handler = mock();
      bus.on("stream.text.delta", handler);

      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

      // delta should be string, not number
      const invalidEvent = {
        type: "stream.text.delta" as const,
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: 123, messageId: "msg1" },
      };

      bus.publish(invalidEvent as any);
      expect(handler).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[EventBus] Schema validation failed for stream.text.delta"),
        expect.anything()
      );

      consoleErrorSpy.mockRestore();
    });

    it("should reject event with missing required fields", () => {
      const handler = mock();
      bus.on("stream.text.delta", handler);

      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

      // Missing messageId field
      const invalidEvent = {
        type: "stream.text.delta" as const,
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hello" },
      };

      bus.publish(invalidEvent as any);
      expect(handler).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it("should reject event with wrong nested types", () => {
      const handler = mock();
      bus.on("stream.tool.start", handler);

      const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

      // toolInput should be Record<string, unknown>, not string
      const invalidEvent = {
        type: "stream.tool.start" as const,
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { toolId: "t1", toolName: "bash", toolInput: "not-an-object" },
      };

      bus.publish(invalidEvent as any);
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
        data: { sourceKey: "k1", durationMs: "not-a-number" }, // should be number
      };

      bus.publish(invalidEvent as any);
      expect(wildcardHandler).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
