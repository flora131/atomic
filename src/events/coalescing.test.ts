/**
 * Unit tests for coalescingKey()
 *
 * Tests the event coalescing key generation function to ensure:
 * - Text deltas and thinking deltas return undefined (additive, never coalesced)
 * - Tool events return unique key per toolId
 * - Agent events return unique key per agentId
 * - Session events return unique key per sessionId
 * - Workflow events return unique key per workflowId
 * - Unknown/unmapped events return undefined
 */

import { describe, it, expect } from "bun:test";
import { coalescingKey } from "./coalescing.ts";
import type { BusEvent } from "./bus-events.ts";

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

      const key = coalescingKey(event);
      expect(key).toBeUndefined();
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

      const key = coalescingKey(event);
      expect(key).toBeUndefined();
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

      const key = coalescingKey(event);
      expect(key).toBe("tool.start:tool-123");
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

      const key = coalescingKey(event);
      expect(key).toBe("tool.complete:tool-456");
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

      const key1 = coalescingKey(event1);
      const key2 = coalescingKey(event2);

      expect(key1).toBe("tool.start:tool-123");
      expect(key2).toBe("tool.start:tool-456");
      expect(key1).not.toBe(key2);
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

      const key = coalescingKey(event);
      expect(key).toBe("agent.update:agent-789");
    });

    it("should return agent.start:${agentId} for stream.agent.start", () => {
      const event: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "agent-999",
          agentType: "explore",
          task: "Find files",
          isBackground: false,
        },
      };

      const key = coalescingKey(event);
      expect(key).toBe("agent.start:agent-999");
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

      const key1 = coalescingKey(event1);
      const key2 = coalescingKey(event2);

      expect(key1).toBe("agent.update:agent-111");
      expect(key2).toBe("agent.update:agent-222");
      expect(key1).not.toBe(key2);
    });
  });

  describe("session events (each type gets unique key)", () => {
    it("should return session.start:${sessionId} for stream.session.start", () => {
      const event: BusEvent<"stream.session.start"> = {
        type: "stream.session.start",
        sessionId: "session-abc",
        runId: 1,
        timestamp: Date.now(),
        data: {
          config: { model: "gpt-4" },
        },
      };

      const key = coalescingKey(event);
      expect(key).toBe("session.start:session-abc");
    });

    it("should return session.idle:${sessionId} for stream.session.idle", () => {
      const event: BusEvent<"stream.session.idle"> = {
        type: "stream.session.idle",
        sessionId: "session-xyz",
        runId: 1,
        timestamp: Date.now(),
        data: {
          reason: "waiting for input",
        },
      };

      const key = coalescingKey(event);
      expect(key).toBe("session.idle:session-xyz");
    });

    it("should return session.error:${sessionId} for stream.session.error", () => {
      const event: BusEvent<"stream.session.error"> = {
        type: "stream.session.error",
        sessionId: "session-err",
        runId: 1,
        timestamp: Date.now(),
        data: {
          error: "Connection failed",
          code: "ECONNREFUSED",
        },
      };

      const key = coalescingKey(event);
      expect(key).toBe("session.error:session-err");
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

      const key1 = coalescingKey(event1);
      const key2 = coalescingKey(event2);

      expect(key1).toBe("session.start:session-1");
      expect(key2).toBe("session.start:session-2");
      expect(key1).not.toBe(key2);
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

      const key = coalescingKey(event);
      expect(key).toBe("workflow.tasks:workflow-abc");
    });

    it("should generate different keys for different workflowIds", () => {
      const event1: BusEvent<"workflow.task.update"> = {
        type: "workflow.task.update",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          workflowId: "workflow-1",
          tasks: [],
        },
      };

      const event2: BusEvent<"workflow.task.update"> = {
        type: "workflow.task.update",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          workflowId: "workflow-2",
          tasks: [],
        },
      };

      const key1 = coalescingKey(event1);
      const key2 = coalescingKey(event2);

      expect(key1).toBe("workflow.tasks:workflow-1");
      expect(key2).toBe("workflow.tasks:workflow-2");
      expect(key1).not.toBe(key2);
    });
  });

  describe("usage events (return usage:{sessionId})", () => {
    it("should return usage:${sessionId} for stream.usage", () => {
      const event: BusEvent<"stream.usage"> = {
        type: "stream.usage",
        sessionId: "session-usage",
        runId: 1,
        timestamp: Date.now(),
        data: {
          inputTokens: 100,
          outputTokens: 50,
          model: "gpt-4",
        },
      };

      const key = coalescingKey(event);
      expect(key).toBe("usage:session-usage");
    });

    it("should use different sessionIds for different sessions", () => {
      const event1: BusEvent<"stream.usage"> = {
        type: "stream.usage",
        sessionId: "session-1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          inputTokens: 100,
          outputTokens: 50,
        },
      };

      const event2: BusEvent<"stream.usage"> = {
        type: "stream.usage",
        sessionId: "session-2",
        runId: 1,
        timestamp: Date.now(),
        data: {
          inputTokens: 200,
          outputTokens: 100,
        },
      };

      const key1 = coalescingKey(event1);
      const key2 = coalescingKey(event2);

      expect(key1).toBe("usage:session-1");
      expect(key2).toBe("usage:session-2");
      expect(key1).not.toBe(key2);
    });
  });

  describe("text completion events (coalesce by messageId)", () => {
    it("should return text.complete:${messageId} for stream.text.complete", () => {
      const event: BusEvent<"stream.text.complete"> = {
        type: "stream.text.complete",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          messageId: "msg1",
          fullText: "Complete message",
        },
      };

      const key = coalescingKey(event);
      expect(key).toBe("text.complete:msg1");
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

      const key1 = coalescingKey(event1);
      const key2 = coalescingKey(event2);

      expect(key1).toBe("text.complete:msg1");
      expect(key2).toBe("text.complete:msg2");
      expect(key1).not.toBe(key2);
    });
  });

  describe("unknown/unmapped events (return undefined)", () => {
    it("should return undefined for stream.thinking.complete", () => {
      const event: BusEvent<"stream.thinking.complete"> = {
        type: "stream.thinking.complete",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          sourceKey: "thinking-block-1",
          durationMs: 1000,
        },
      };

      const key = coalescingKey(event);
      expect(key).toBeUndefined();
    });

    it("should return undefined for stream.agent.complete", () => {
      const event: BusEvent<"stream.agent.complete"> = {
        type: "stream.agent.complete",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "agent-123",
          success: true,
          result: "Task completed",
        },
      };

      const key = coalescingKey(event);
      expect(key).toBeUndefined();
    });

    it("should return undefined for workflow.step.start", () => {
      const event: BusEvent<"workflow.step.start"> = {
        type: "workflow.step.start",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          workflowId: "workflow-123",
          nodeId: "node-1",
          nodeName: "Step 1",
        },
      };

      const key = coalescingKey(event);
      expect(key).toBeUndefined();
    });

    it("should return undefined for workflow.step.complete", () => {
      const event: BusEvent<"workflow.step.complete"> = {
        type: "workflow.step.complete",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          workflowId: "workflow-123",
          nodeId: "node-1",
          status: "success",
          result: "Step completed",
        },
      };

      const key = coalescingKey(event);
      expect(key).toBeUndefined();
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

      const key = coalescingKey(event);
      expect(key).toBeUndefined();
    });

    it("should return undefined for stream.human_input_required", () => {
      const event: BusEvent<"stream.human_input_required"> = {
        type: "stream.human_input_required",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          requestId: "req-456",
          question: "What should we do next?",
          nodeId: "node-1",
        },
      };

      const key = coalescingKey(event);
      expect(key).toBeUndefined();
    });

    it("should return undefined for stream.skill.invoked", () => {
      const event: BusEvent<"stream.skill.invoked"> = {
        type: "stream.skill.invoked",
        sessionId: "test-session",
        runId: 1,
        timestamp: Date.now(),
        data: {
          skillName: "custom_skill",
          skillPath: "/path/to/skill.sh",
        },
      };

      const key = coalescingKey(event);
      expect(key).toBeUndefined();
    });
  });
});
