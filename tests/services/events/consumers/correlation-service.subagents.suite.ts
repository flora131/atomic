import { beforeEach, describe, expect, test } from "bun:test";
import {
  CorrelationService,
  type SubagentContext,
} from "@/services/events/consumers/correlation-service.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";

describe("CorrelationService", () => {
  let service: CorrelationService;

  beforeEach(() => {
    service = new CorrelationService();
  });

  describe("registerSubagent / unregisterSubagent", () => {
    const subagentContext: SubagentContext = {
      parentAgentId: "parent_001",
      workflowRunId: "wf_run_1",
      nodeId: "planner",
    };

    test("registerSubagent stores context for enrichment", () => {
      service.registerSubagent("sub_agent_1", subagentContext);

      const enriched = service.enrich({
        type: "stream.agent.start",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "sub_agent_1",
          toolCallId: "sub_agent_1",
          agentType: "task",
          task: "Analyze code",
          isBackground: false,
        },
      } satisfies BusEvent<"stream.agent.start">);

      expect(enriched.resolvedAgentId).toBe("sub_agent_1");
      expect(enriched.parentAgentId).toBe("parent_001");
      expect(enriched.suppressFromMainChat).toBe(false);
    });

    test("unregisterSubagent removes context so enrichment no longer applies", () => {
      service.registerSubagent("sub_agent_2", subagentContext);
      service.unregisterSubagent("sub_agent_2");

      const enriched = service.enrich({
        type: "stream.agent.start",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "sub_agent_2",
          toolCallId: "sub_agent_2",
          agentType: "task",
          task: "Write tests",
          isBackground: false,
        },
      } satisfies BusEvent<"stream.agent.start">);

      expect(enriched.resolvedAgentId).toBe("sub_agent_2");
      expect(enriched.parentAgentId).toBeUndefined();
    });

    test("unregisterSubagent is safe for non-existent agentId", () => {
      service.unregisterSubagent("nonexistent_agent");
    });
  });

  describe("sub-agent enrichment for agent lifecycle events", () => {
    const subagentContext: SubagentContext = {
      parentAgentId: "workflow_main",
      workflowRunId: "wf_42",
    };

    test("stream.agent.start enriches with parentAgentId for registered sub-agent", () => {
      service.registerSubagent("worker_1", subagentContext);

      const enriched = service.enrich({
        type: "stream.agent.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "worker_1",
          toolCallId: "worker_1",
          agentType: "explore",
          task: "Research docs",
          isBackground: true,
        },
      } satisfies BusEvent<"stream.agent.start">);

      expect(enriched.resolvedAgentId).toBe("worker_1");
      expect(enriched.parentAgentId).toBe("workflow_main");
      expect(enriched.suppressFromMainChat).toBe(false);
    });

    test("stream.agent.update enriches with parentAgentId for registered sub-agent", () => {
      service.registerSubagent("worker_2", subagentContext);

      const enriched = service.enrich({
        type: "stream.agent.update",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "worker_2",
          currentTool: "read_file",
          toolUses: 3,
        },
      } satisfies BusEvent<"stream.agent.update">);

      expect(enriched.resolvedAgentId).toBe("worker_2");
      expect(enriched.parentAgentId).toBe("workflow_main");
      expect(enriched.suppressFromMainChat).toBe(false);
    });

    test("stream.agent.complete enriches with parentAgentId for registered sub-agent", () => {
      service.registerSubagent("worker_3", subagentContext);

      const enriched = service.enrich({
        type: "stream.agent.complete",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "worker_3",
          success: true,
          result: "Done",
        },
      } satisfies BusEvent<"stream.agent.complete">);

      expect(enriched.resolvedAgentId).toBe("worker_3");
      expect(enriched.parentAgentId).toBe("workflow_main");
      expect(enriched.suppressFromMainChat).toBe(false);
    });

    test("agent events for non-registered agents have no parentAgentId", () => {
      const enriched = service.enrich({
        type: "stream.agent.update",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "unregistered_agent",
          currentTool: "bash",
        },
      } satisfies BusEvent<"stream.agent.update">);

      expect(enriched.resolvedAgentId).toBe("unregistered_agent");
      expect(enriched.parentAgentId).toBeUndefined();
    });
  });

  describe("sub-agent enrichment for tool events", () => {
    const subagentContext: SubagentContext = {
      parentAgentId: "workflow_main",
      workflowRunId: "wf_99",
      nodeId: "coder",
    };

    test("stream.tool.start with parentAgentId matching registered sub-agent sets isSubagentTool", () => {
      service.registerSubagent("sub_coder", subagentContext);

      const enriched = service.enrich({
        type: "stream.tool.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool_abc",
          toolName: "edit_file",
          toolInput: { path: "src/main.ts" },
          parentAgentId: "sub_coder",
        },
      } satisfies BusEvent<"stream.tool.start">);

      expect(enriched.resolvedToolId).toBe("tool_abc");
      expect(enriched.resolvedAgentId).toBe("sub_coder");
      expect(enriched.parentAgentId).toBe("workflow_main");
      expect(enriched.isSubagentTool).toBe(true);
      expect(enriched.suppressFromMainChat).toBe(false);
    });

    test("stream.tool.start with explicit parentAgentId still marks sub-agent scope before registry hydration", () => {
      const enriched = service.enrich({
        type: "stream.tool.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool_pre_registered",
          toolName: "WebSearch",
          toolInput: { query: "status" },
          parentAgentId: "sub_unregistered",
        },
      } satisfies BusEvent<"stream.tool.start">);

      expect(enriched.resolvedAgentId).toBe("sub_unregistered");
      expect(enriched.parentAgentId).toBeUndefined();
      expect(enriched.isSubagentTool).toBe(true);
    });

    test("stream.tool.start without parentAgentId falls back to mainAgentId", () => {
      service.enrich({
        type: "stream.agent.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "main_agent",
          toolCallId: "main_agent",
          agentType: "general-purpose",
          task: "Main task",
          isBackground: false,
        },
      } satisfies BusEvent<"stream.agent.start">);

      const enriched = service.enrich({
        type: "stream.tool.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool_def",
          toolName: "bash",
          toolInput: { command: "ls" },
        },
      } satisfies BusEvent<"stream.tool.start">);

      expect(enriched.resolvedAgentId).toBe("main_agent");
      expect(enriched.parentAgentId).toBeUndefined();
      expect(enriched.isSubagentTool).toBe(false);
    });

    test("stream.tool.complete for tool owned by registered sub-agent sets parentAgentId", () => {
      service.registerSubagent("sub_writer", {
        parentAgentId: "workflow_main",
        workflowRunId: "wf_77",
      });
      service.registerTool("tool_write_1", "sub_writer", false);

      const enriched = service.enrich({
        type: "stream.tool.complete",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool_write_1",
          toolName: "write_file",
          toolResult: "Written",
          success: true,
        },
      } satisfies BusEvent<"stream.tool.complete">);

      expect(enriched.resolvedToolId).toBe("tool_write_1");
      expect(enriched.resolvedAgentId).toBe("sub_writer");
      expect(enriched.parentAgentId).toBe("workflow_main");
      expect(enriched.isSubagentTool).toBe(true);
      expect(enriched.suppressFromMainChat).toBe(false);
    });
  });

  describe("sub-agent registry cleanup", () => {
    test("reset() clears the subagent registry", () => {
      service.registerSubagent("sub_1", {
        parentAgentId: "parent_1",
        workflowRunId: "wf_1",
      });
      service.registerSubagent("sub_2", {
        parentAgentId: "parent_1",
        workflowRunId: "wf_1",
      });

      service.reset();

      const enriched = service.enrich({
        type: "stream.agent.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "sub_1",
          toolCallId: "sub_1",
          agentType: "task",
          task: "Test",
          isBackground: false,
        },
      } satisfies BusEvent<"stream.agent.start">);
      expect(enriched.parentAgentId).toBeUndefined();
    });

    test("startRun() clears the subagent registry via reset()", () => {
      service.registerSubagent("sub_old", {
        parentAgentId: "old_parent",
        workflowRunId: "wf_old",
      });

      service.startRun(100, "new_session");

      const enriched = service.enrich({
        type: "stream.agent.update",
        sessionId: "new_session",
        runId: 100,
        timestamp: Date.now(),
        data: {
          agentId: "sub_old",
          currentTool: "bash",
        },
      } satisfies BusEvent<"stream.agent.update">);
      expect(enriched.parentAgentId).toBeUndefined();
    });
  });

  describe("sub-agent registry does not break existing behavior", () => {
    test("non-sub-agent events still enrich correctly with no registry entries", () => {
      const agentEnriched = service.enrich({
        type: "stream.agent.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "main_agent",
          toolCallId: "main_agent",
          agentType: "general-purpose",
          task: "Chat",
          isBackground: false,
        },
      } satisfies BusEvent<"stream.agent.start">);
      expect(agentEnriched.resolvedAgentId).toBe("main_agent");
      expect(agentEnriched.parentAgentId).toBeUndefined();

      service.registerTool("tool_1", "main_agent", false);
      const toolEnriched = service.enrich({
        type: "stream.tool.complete",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool_1",
          toolName: "read",
          toolResult: "content",
          success: true,
        },
      } satisfies BusEvent<"stream.tool.complete">);
      expect(toolEnriched.resolvedAgentId).toBe("main_agent");
      expect(toolEnriched.isSubagentTool).toBe(false);
      expect(toolEnriched.parentAgentId).toBeUndefined();

      const textEnriched = service.enrich({
        type: "stream.text.delta",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg_1" },
      } satisfies BusEvent<"stream.text.delta">);
      expect(textEnriched.resolvedAgentId).toBe("main_agent");
      expect(textEnriched.parentAgentId).toBeUndefined();
    });

    test("multiple sub-agents can be registered simultaneously", () => {
      service.registerSubagent("worker_a", {
        parentAgentId: "orchestrator",
        workflowRunId: "wf_multi",
        nodeId: "step_1",
      });
      service.registerSubagent("worker_b", {
        parentAgentId: "orchestrator",
        workflowRunId: "wf_multi",
        nodeId: "step_2",
      });

      const enrichedA = service.enrich({
        type: "stream.agent.start",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "worker_a",
          toolCallId: "worker_a",
          agentType: "task",
          task: "A",
          isBackground: false,
        },
      } satisfies BusEvent<"stream.agent.start">);
      const enrichedB = service.enrich({
        type: "stream.agent.start",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "worker_b",
          toolCallId: "worker_b",
          agentType: "task",
          task: "B",
          isBackground: false,
        },
      } satisfies BusEvent<"stream.agent.start">);

      expect(enrichedA.parentAgentId).toBe("orchestrator");
      expect(enrichedB.parentAgentId).toBe("orchestrator");
      expect(enrichedA.resolvedAgentId).toBe("worker_a");
      expect(enrichedB.resolvedAgentId).toBe("worker_b");
    });
  });
});
