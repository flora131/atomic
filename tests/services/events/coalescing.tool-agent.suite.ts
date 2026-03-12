import { describe, expect, it } from "bun:test";
import { coalescingKey } from "@/services/events/coalescing.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("coalescingKey()", () => {
  describe("additive events (return undefined - never coalesced)", () => {
    it("should return undefined for stream.text.delta", () => {
      const event: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg1" },
      };

      expect(coalescingKey(event)).toBeUndefined();
    });

    it("should return undefined for stream.thinking.delta", () => {
      const event: BusEvent<"stream.thinking.delta"> = {
        type: "stream.thinking.delta",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          delta: "Let me think...",
          sourceKey: "thinking-block-1",
          messageId: "msg1",
        },
      };

      expect(coalescingKey(event)).toBeUndefined();
    });
  });

  describe("tool events", () => {
    it("should return tool.start:${toolId} for stream.tool.start", () => {
      const event: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-123",
          toolName: "test_tool",
          toolInput: { param: "value" },
        },
      };

      expect(coalescingKey(event)).toBe("tool.start:tool-123");
    });

    it("should return tool.complete:${toolId} for stream.tool.complete", () => {
      const event: BusEvent<"stream.tool.complete"> = {
        type: "stream.tool.complete",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-456",
          toolName: "test_tool",
          toolResult: "success",
          success: true,
        },
      };

      expect(coalescingKey(event)).toBe("tool.complete:tool-456");
    });

    it("should generate different keys for different toolIds", () => {
      const event1: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-123",
          toolName: "test_tool",
          toolInput: {},
        },
      };
      const event2: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-456",
          toolName: "test_tool",
          toolInput: {},
        },
      };

      expect(coalescingKey(event1)).toBe("tool.start:tool-123");
      expect(coalescingKey(event2)).toBe("tool.start:tool-456");
      expect(coalescingKey(event1)).not.toBe(coalescingKey(event2));
    });
  });

  describe("agent events", () => {
    it("should return agent.update:${agentId} for stream.agent.update", () => {
      const event: BusEvent<"stream.agent.update"> = {
        type: "stream.agent.update",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "agent-789",
          currentTool: "bash",
          toolUses: 5,
        },
      };

      expect(coalescingKey(event)).toBe("agent.update:agent-789");
    });

    it("should return agent.start:${agentId} for stream.agent.start", () => {
      const event: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "agent-999",
          toolCallId: "agent-999",
          agentType: "explore",
          task: "Find files",
          isBackground: false,
        },
      };

      expect(coalescingKey(event)).toBe("agent.start:agent-999");
    });

    it("should generate different keys for different agentIds", () => {
      const event1: BusEvent<"stream.agent.update"> = {
        type: "stream.agent.update",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "agent-111",
          currentTool: "bash",
        },
      };
      const event2: BusEvent<"stream.agent.update"> = {
        type: "stream.agent.update",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "agent-222",
          currentTool: "view",
        },
      };

      expect(coalescingKey(event1)).toBe("agent.update:agent-111");
      expect(coalescingKey(event2)).toBe("agent.update:agent-222");
      expect(coalescingKey(event1)).not.toBe(coalescingKey(event2));
    });
  });
});
