import { describe, expect, it } from "bun:test";
import { coalescingKey } from "@/services/events/coalescing.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("coalescingKey()", () => {
  describe("text completion events (coalesce by messageId)", () => {
    it("should return text.complete:${messageId} for stream.text.complete", () => {
      const event: BusEvent<"stream.text.complete"> = {
        type: "stream.text.complete",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { messageId: "msg1", fullText: "Complete message" },
      };

      expect(coalescingKey(event)).toBe("text.complete:msg1");
    });

    it("should generate different keys for different messageIds", () => {
      const event1: BusEvent<"stream.text.complete"> = {
        type: "stream.text.complete",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { messageId: "msg1", fullText: "First" },
      };
      const event2: BusEvent<"stream.text.complete"> = {
        type: "stream.text.complete",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { messageId: "msg2", fullText: "Second" },
      };

      expect(coalescingKey(event1)).toBe("text.complete:msg1");
      expect(coalescingKey(event2)).toBe("text.complete:msg2");
      expect(coalescingKey(event1)).not.toBe(coalescingKey(event2));
    });
  });

  describe("unknown/unmapped events (return undefined)", () => {
    it("should return undefined for stream.thinking.complete", () => {
      const event: BusEvent<"stream.thinking.complete"> = {
        type: "stream.thinking.complete",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { sourceKey: "thinking-block-1", durationMs: 1000 },
      };

      expect(coalescingKey(event)).toBeUndefined();
    });

    it("should return agent.complete:${agentId} for stream.agent.complete", () => {
      const event: BusEvent<"stream.agent.complete"> = {
        type: "stream.agent.complete",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { agentId: "agent-123", success: true, result: "Task completed" },
      };

      expect(coalescingKey(event)).toBe("agent.complete:agent-123");
    });

    it("should return undefined for stream.permission.requested", () => {
      const event: BusEvent<"stream.permission.requested"> = {
        type: "stream.permission.requested",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          requestId: "req-123",
          toolName: "bash",
          question: "Allow command execution?",
          options: [
            { label: "Allow", value: "allow" },
            { label: "Deny", value: "deny" },
          ],
        },
      };

      expect(coalescingKey(event)).toBeUndefined();
    });

    it("should return undefined for stream.human_input_required", () => {
      const event: BusEvent<"stream.human_input_required"> = {
        type: "stream.human_input_required",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { requestId: "req-456", question: "What should we do next?", nodeId: "node-1" },
      };

      expect(coalescingKey(event)).toBeUndefined();
    });

    it("should return undefined for stream.skill.invoked", () => {
      const event: BusEvent<"stream.skill.invoked"> = {
        type: "stream.skill.invoked",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { skillName: "custom_skill", skillPath: "/path/to/skill.sh" },
      };

      expect(coalescingKey(event)).toBeUndefined();
    });
  });
});
