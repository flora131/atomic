import { beforeEach, describe, expect, test } from "bun:test";
import { CorrelationService } from "@/services/events/consumers/correlation-service.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("CorrelationService", () => {
  let service: CorrelationService;

  beforeEach(() => {
    service = new CorrelationService();
  });

  describe("sub-agent text-complete suppression", () => {
    test("stream.text.complete with subagent- messageId is suppressed", () => {
      service.registerSubagent("worker-1", {
        parentAgentId: "main-agent",
        workflowRunId: "run-1",
      });

      const enriched = service.enrich({
        type: "stream.text.complete",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: { messageId: "subagent-worker-1", fullText: "done" },
      } satisfies BusEvent<"stream.text.complete">);

      expect(enriched.suppressFromMainChat).toBe(true);
      expect(enriched.resolvedAgentId).toBe("worker-1");
      expect(enriched.parentAgentId).toBe("main-agent");
    });

    test("stream.text.complete without subagent- prefix is NOT suppressed", () => {
      service.enrich({
        type: "stream.agent.start",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "main-agent",
          toolCallId: "main-agent",
          agentType: "chat",
          task: "test",
          isBackground: false,
        },
      } satisfies BusEvent<"stream.agent.start">);

      const enriched = service.enrich({
        type: "stream.text.complete",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: { messageId: "msg-123", fullText: "done" },
      } satisfies BusEvent<"stream.text.complete">);

      expect(enriched.suppressFromMainChat).toBe(false);
      expect(enriched.resolvedAgentId).toBe("main-agent");
    });
  });

  describe("sub-agent tool ID registration on stream.tool.start", () => {
    test("registers tool in toolToAgent so stream.tool.complete resolves agent", () => {
      service.registerSubagent("worker-1", {
        parentAgentId: "main-agent",
        workflowRunId: "run-1",
      });

      service.enrich({
        type: "stream.tool.start",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-abc",
          toolName: "grep",
          toolInput: {},
          parentAgentId: "worker-1",
        },
      } satisfies BusEvent<"stream.tool.start">);

      const enriched = service.enrich({
        type: "stream.tool.complete",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-abc",
          toolName: "grep",
          toolResult: "found",
          success: true,
        },
      } satisfies BusEvent<"stream.tool.complete">);
      expect(enriched.resolvedAgentId).toBe("worker-1");
      expect(enriched.isSubagentTool).toBe(true);
      expect(enriched.parentAgentId).toBe("main-agent");
    });

    test("registers fallback-attributed tool so stream.tool.complete inherits resolvedAgentId", () => {
      service.enrich({
        type: "stream.agent.start",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "background-agent-1",
          toolCallId: "spawn-tool-1",
          agentType: "codebase-online-researcher",
          task: "Research task",
          isBackground: true,
        },
      } satisfies BusEvent<"stream.agent.start">);

      const startEnriched = service.enrich({
        type: "stream.tool.start",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-bg-1",
          toolName: "WebSearch",
          toolInput: { query: "test" },
        },
      } satisfies BusEvent<"stream.tool.start">);
      expect(startEnriched.resolvedAgentId).toBe("background-agent-1");

      const completeEnriched = service.enrich({
        type: "stream.tool.complete",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-bg-1",
          toolName: "WebSearch",
          toolResult: "done",
          success: true,
        },
      } satisfies BusEvent<"stream.tool.complete">);
      expect(completeEnriched.resolvedAgentId).toBe("background-agent-1");
    });
  });
});
