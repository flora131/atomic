import { describe, expect, it } from "bun:test";
import { coalescingKey } from "@/services/events/coalescing.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("coalescingKey()", () => {
  describe("session events (each type gets unique key)", () => {
    it("should return session.start:${sessionId} for stream.session.start", () => {
      const event: BusEvent<"stream.session.start"> = {
        type: "stream.session.start",
        sessionId: "session-abc",
        runId: 1,
        timestamp: Date.now(),
        data: { config: { model: "gpt-4" } },
      };

      expect(coalescingKey(event)).toBe("session.start:session-abc");
    });

    it("should return session.idle:${sessionId} for stream.session.idle", () => {
      const event: BusEvent<"stream.session.idle"> = {
        type: "stream.session.idle",
        sessionId: "session-xyz",
        runId: 1,
        timestamp: Date.now(),
        data: { reason: "waiting for input" },
      };

      expect(coalescingKey(event)).toBe("session.idle:session-xyz");
    });

    it("should return session.error:${sessionId} for stream.session.error", () => {
      const event: BusEvent<"stream.session.error"> = {
        type: "stream.session.error",
        sessionId: "session-err",
        runId: 1,
        timestamp: Date.now(),
        data: { error: "Connection failed", code: "ECONNREFUSED" },
      };

      expect(coalescingKey(event)).toBe("session.error:session-err");
    });

    it("should use different sessionIds for different sessions", () => {
      const event1: BusEvent<"stream.session.start"> = {
        type: "stream.session.start",
        sessionId: "session-1",
        runId: 1,
        timestamp: Date.now(),
        data: {},
      };
      const event2: BusEvent<"stream.session.start"> = {
        type: "stream.session.start",
        sessionId: "session-2",
        runId: 1,
        timestamp: Date.now(),
        data: {},
      };

      expect(coalescingKey(event1)).toBe("session.start:session-1");
      expect(coalescingKey(event2)).toBe("session.start:session-2");
      expect(coalescingKey(event1)).not.toBe(coalescingKey(event2));
    });

    it("should NOT coalesce session.start with session.idle", () => {
      const start: BusEvent<"stream.session.start"> = {
        type: "stream.session.start",
        sessionId: "session-1",
        runId: 1,
        timestamp: Date.now(),
        data: {},
      };
      const idle: BusEvent<"stream.session.idle"> = {
        type: "stream.session.idle",
        sessionId: "session-1",
        runId: 1,
        timestamp: Date.now(),
        data: {},
      };

      expect(coalescingKey(start)).not.toBe(coalescingKey(idle));
    });
  });

  describe("workflow events (return workflow.tasks:{workflowId})", () => {
    it("should return workflow.tasks:${workflowId} for workflow.task.update", () => {
      const event: BusEvent<"workflow.task.update"> = {
        type: "workflow.task.update",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          workflowId: "workflow-abc",
          tasks: [
            { id: "task-1", title: "First task", status: "pending" },
            { id: "task-2", title: "Second task", status: "in_progress" },
          ],
        },
      };

      expect(coalescingKey(event)).toBe("workflow.tasks:workflow-abc");
    });

    it("should generate different keys for different workflowIds", () => {
      const event1: BusEvent<"workflow.task.update"> = {
        type: "workflow.task.update",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { workflowId: "workflow-1", tasks: [] },
      };
      const event2: BusEvent<"workflow.task.update"> = {
        type: "workflow.task.update",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: { workflowId: "workflow-2", tasks: [] },
      };

      expect(coalescingKey(event1)).toBe("workflow.tasks:workflow-1");
      expect(coalescingKey(event2)).toBe("workflow.tasks:workflow-2");
      expect(coalescingKey(event1)).not.toBe(coalescingKey(event2));
    });
  });

  describe("usage events (return usage:{sessionId})", () => {
    it("should return usage:${sessionId} for stream.usage", () => {
      const event: BusEvent<"stream.usage"> = {
        type: "stream.usage",
        sessionId: "session-usage",
        runId: 1,
        timestamp: Date.now(),
        data: { inputTokens: 100, outputTokens: 50, model: "gpt-4" },
      };

      expect(coalescingKey(event)).toBe("usage:session-usage");
    });

    it("should use different sessionIds for different sessions", () => {
      const event1: BusEvent<"stream.usage"> = {
        type: "stream.usage",
        sessionId: "session-1",
        runId: 1,
        timestamp: Date.now(),
        data: { inputTokens: 100, outputTokens: 50 },
      };
      const event2: BusEvent<"stream.usage"> = {
        type: "stream.usage",
        sessionId: "session-2",
        runId: 1,
        timestamp: Date.now(),
        data: { inputTokens: 200, outputTokens: 100 },
      };

      expect(coalescingKey(event1)).toBe("usage:session-1");
      expect(coalescingKey(event2)).toBe("usage:session-2");
      expect(coalescingKey(event1)).not.toBe(coalescingKey(event2));
    });
  });
});
