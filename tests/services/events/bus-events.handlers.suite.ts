import { describe, expect, it } from "bun:test";
import type { BusEvent, BusHandler, WildcardHandler } from "@/services/events/bus-events.ts";

describe("BusEvent Type Definitions", () => {
  it("should support typed event handlers", () => {
    const handler: BusHandler<"stream.text.delta"> = (event) => {
      expect(typeof event.data.delta).toBe("string");
      expect(typeof event.data.messageId).toBe("string");
    };

    const testEvent: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "test", messageId: "msg-1" },
    };

    handler(testEvent);
  });

  it("should support wildcard handlers", () => {
    const wildcardHandler: WildcardHandler = (event) => {
      expect(event.type).toBeDefined();
      expect(event.sessionId).toBeDefined();
    };

    const textEvent: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "test", messageId: "msg-1" },
    };
    const toolEvent: BusEvent<"stream.tool.start"> = {
      type: "stream.tool.start",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool-1",
        toolName: "bash",
        toolInput: {},
      },
    };

    wildcardHandler(textEvent);
    wildcardHandler(toolEvent);
  });
});
