/**
 * Tests for EventBus internal error handling.
 *
 * Covers:
 * - onInternalError() subscription and unsubscribe
 * - Error emission on handler exceptions
 * - Error emission on wildcard handler exceptions
 * - Schema validation errors
 * - reportError() for external contract violations
 * - Error isolation in internal error handlers (swallow to avoid recursion)
 */

import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { EventBus, type InternalBusError } from "@/services/events/event-bus.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe("onInternalError() - internal error subscriptions", () => {
    it("should receive handler_error when a typed handler throws", () => {
      const errors: InternalBusError[] = [];
      bus.onInternalError((err) => errors.push(err));

      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

      bus.on("stream.text.delta", () => {
        throw new Error("handler boom");
      });

      bus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });

      expect(errors).toHaveLength(1);
      expect(errors[0]!.kind).toBe("handler_error");
      expect(errors[0]!.eventType).toBe("stream.text.delta");
      expect(errors[0]!.error).toBeInstanceOf(Error);

      consoleSpy.mockRestore();
    });

    it("should receive wildcard_handler_error when a wildcard handler throws", () => {
      const errors: InternalBusError[] = [];
      bus.onInternalError((err) => errors.push(err));

      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

      bus.onAll(() => {
        throw new Error("wildcard boom");
      });

      bus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });

      expect(errors).toHaveLength(1);
      expect(errors[0]!.kind).toBe("wildcard_handler_error");
      expect(errors[0]!.eventType).toBe("stream.text.delta");

      consoleSpy.mockRestore();
    });

    it("should receive schema_validation error when schema validation fails", () => {
      const errors: InternalBusError[] = [];
      bus.onInternalError((err) => errors.push(err));

      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

      // Need a handler so the event is not short-circuited
      bus.on("stream.text.delta", () => {});

      bus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: 42, messageId: "m1" },
      } as never);

      expect(errors).toHaveLength(1);
      expect(errors[0]!.kind).toBe("schema_validation");
      expect(errors[0]!.eventType).toBe("stream.text.delta");
      expect(errors[0]!.eventData).toBeDefined();

      consoleSpy.mockRestore();
    });

    it("should support multiple internal error handlers", () => {
      const errors1: InternalBusError[] = [];
      const errors2: InternalBusError[] = [];
      bus.onInternalError((err) => errors1.push(err));
      bus.onInternalError((err) => errors2.push(err));

      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

      bus.on("stream.text.delta", () => {
        throw new Error("boom");
      });

      bus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });

      expect(errors1).toHaveLength(1);
      expect(errors2).toHaveLength(1);

      consoleSpy.mockRestore();
    });

    it("should return unsubscribe function that removes the internal error handler", () => {
      const errors: InternalBusError[] = [];
      const unsub = bus.onInternalError((err) => errors.push(err));

      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

      bus.on("stream.text.delta", () => {
        throw new Error("first");
      });

      bus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "a", messageId: "m1" },
      });

      expect(errors).toHaveLength(1);

      unsub();

      bus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "b", messageId: "m1" },
      });

      // Should still be 1 because we unsubscribed
      expect(errors).toHaveLength(1);

      consoleSpy.mockRestore();
    });

    it("should swallow exceptions thrown by internal error handlers", () => {
      bus.onInternalError(() => {
        throw new Error("infinite recursion guard");
      });

      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

      bus.on("stream.text.delta", () => {
        throw new Error("trigger");
      });

      // Should not throw
      expect(() =>
        bus.publish({
          type: "stream.text.delta",
          sessionId: "s1",
          runId: 1,
          timestamp: Date.now(),
          data: { delta: "hi", messageId: "m1" },
        }),
      ).not.toThrow();

      consoleSpy.mockRestore();
    });
  });

  describe("reportError() - external error reporting", () => {
    it("should emit the error to internal error handlers", () => {
      const errors: InternalBusError[] = [];
      bus.onInternalError((err) => errors.push(err));

      const customError: InternalBusError = {
        kind: "contract_violation",
        eventType: "stream.text.delta",
        error: new Error("contract broken"),
      };

      bus.reportError(customError);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe(customError);
    });

    it("should not throw when no internal error handlers are registered", () => {
      expect(() =>
        bus.reportError({
          kind: "contract_violation",
          eventType: "stream.text.delta",
          error: "no handler for this",
        }),
      ).not.toThrow();
    });
  });

  describe("EventBusOptions - validatePayloads", () => {
    it("should skip schema validation when validatePayloads is false", () => {
      const noValidationBus = new EventBus({ validatePayloads: false });
      const handler = mock();
      noValidationBus.on("stream.text.delta", handler);

      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

      // This has invalid data (delta is a number instead of string)
      noValidationBus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: 42, messageId: "m1" },
      } as never);

      // Should still dispatch because validation is disabled
      expect(handler).toHaveBeenCalledTimes(1);
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should enable schema validation by default", () => {
      const defaultBus = new EventBus();
      const handler = mock();
      defaultBus.on("stream.text.delta", handler);

      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});

      defaultBus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: 42, messageId: "m1" },
      } as never);

      // Should NOT dispatch because validation is enabled by default
      expect(handler).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe("publish() - event ordering guarantees", () => {
    it("should dispatch to typed handlers before wildcard handlers", () => {
      const order: string[] = [];

      bus.on("stream.text.delta", () => order.push("typed"));
      bus.onAll(() => order.push("wildcard"));

      bus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });

      expect(order).toEqual(["typed", "wildcard"]);
    });

    it("should dispatch to all typed handlers even if one throws", () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const order: string[] = [];

      bus.on("stream.text.delta", () => {
        order.push("first");
        throw new Error("fail");
      });
      bus.on("stream.text.delta", () => order.push("second"));
      bus.on("stream.text.delta", () => order.push("third"));

      bus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });

      expect(order).toEqual(["first", "second", "third"]);

      consoleSpy.mockRestore();
    });

    it("should dispatch to all wildcard handlers even if one throws", () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const order: string[] = [];

      bus.onAll(() => {
        order.push("wc1");
        throw new Error("fail");
      });
      bus.onAll(() => order.push("wc2"));

      bus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });

      expect(order).toEqual(["wc1", "wc2"]);

      consoleSpy.mockRestore();
    });

    it("should still dispatch to wildcard handlers if all typed handlers throw", () => {
      const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
      const wildcardHandler = mock();

      bus.on("stream.text.delta", () => {
        throw new Error("typed fail");
      });
      bus.onAll(wildcardHandler);

      bus.publish({
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "hi", messageId: "m1" },
      });

      expect(wildcardHandler).toHaveBeenCalledTimes(1);

      consoleSpy.mockRestore();
    });
  });
});
