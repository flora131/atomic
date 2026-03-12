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

  test("enrich() returns enriched event with default metadata", () => {
    const event: BusEvent = {
      type: "stream.session.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {},
    };

    const enriched = service.enrich(event);

    expect(enriched).toBeDefined();
    expect(enriched.type).toBe("stream.session.start");
    expect(enriched.resolvedToolId).toBeUndefined();
    expect(enriched.resolvedAgentId).toBeUndefined();
    expect(enriched.isSubagentTool).toBe(false);
    expect(enriched.suppressFromMainChat).toBe(false);
  });

  test("stream.agent.start sets mainAgentId on first call", () => {
    const event: BusEvent<"stream.agent.start"> = {
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_001",
        toolCallId: "agent_001",
        agentType: "general-purpose",
        task: "Test task",
        isBackground: false,
      },
    };

    const enriched = service.enrich(event);

    expect(enriched.resolvedAgentId).toBe("agent_001");
    expect(enriched.isSubagentTool).toBe(false);
  });

  test("stream.tool.start resolves tool ID", () => {
    service.enrich({
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_001",
        toolCallId: "agent_001",
        agentType: "general-purpose",
        task: "Test task",
        isBackground: false,
      },
    } satisfies BusEvent<"stream.agent.start">);

    const enriched = service.enrich({
      type: "stream.tool.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool_123",
        toolName: "test_tool",
        toolInput: { param: "value" },
      },
    } satisfies BusEvent<"stream.tool.start">);

    expect(enriched.resolvedToolId).toBe("tool_123");
    expect(enriched.resolvedAgentId).toBe("agent_001");
  });

  test("stream.tool.complete correlates with registered agent", () => {
    service.registerTool("tool_456", "agent_002", false);

    const enriched = service.enrich({
      type: "stream.tool.complete",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool_456",
        toolName: "test_tool",
        toolResult: "Success",
        success: true,
      },
    } satisfies BusEvent<"stream.tool.complete">);

    expect(enriched.resolvedToolId).toBe("tool_456");
    expect(enriched.resolvedAgentId).toBe("agent_002");
    expect(enriched.isSubagentTool).toBe(false);
  });

  test("stream.tool.partial_result correlates with previously registered sub-agent tool", () => {
    const parentContext: SubagentContext = {
      parentAgentId: "agent_main",
      workflowRunId: "workflow_1",
    };
    service.registerSubagent("agent_sub", parentContext);
    service.registerTool("tool_partial", "agent_sub", true);

    const enriched = service.enrich({
      type: "stream.tool.partial_result",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolCallId: "tool_partial",
        partialOutput: "line 1\n",
      },
    } satisfies BusEvent<"stream.tool.partial_result">);

    expect(enriched.resolvedToolId).toBe("tool_partial");
    expect(enriched.resolvedAgentId).toBe("agent_sub");
    expect(enriched.parentAgentId).toBe("agent_main");
    expect(enriched.isSubagentTool).toBe(true);
  });

  test("registerTool() maps tool to agent", () => {
    service.registerTool("tool_999", "agent_888", false);

    const enriched = service.enrich({
      type: "stream.tool.complete",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool_999",
        toolName: "test_tool",
        toolResult: "Done",
        success: true,
      },
    } satisfies BusEvent<"stream.tool.complete">);

    expect(enriched.resolvedAgentId).toBe("agent_888");
    expect(enriched.isSubagentTool).toBe(false);
  });

  test("registerTool() with isSubagent=true marks sub-agent tools", () => {
    service.registerTool("tool_sub", "agent_sub", true);

    const enriched = service.enrich({
      type: "stream.tool.complete",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool_sub",
        toolName: "sub_tool",
        toolResult: "Done",
        success: true,
      },
    } satisfies BusEvent<"stream.tool.complete">);

    expect(enriched.resolvedAgentId).toBe("agent_sub");
    expect(enriched.isSubagentTool).toBe(true);
  });

  test("stream.text.delta resolves to main agent", () => {
    service.enrich({
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_main",
        toolCallId: "agent_main",
        agentType: "general-purpose",
        task: "Main task",
        isBackground: false,
      },
    } satisfies BusEvent<"stream.agent.start">);

    const enriched = service.enrich({
      type: "stream.text.delta",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        delta: "Hello world",
        messageId: "msg_001",
      },
    } satisfies BusEvent<"stream.text.delta">);

    expect(enriched.resolvedAgentId).toBe("agent_main");
  });

  test("reset() clears all state", () => {
    service.enrich({
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_123",
        toolCallId: "agent_123",
        agentType: "general-purpose",
        task: "Test",
        isBackground: false,
      },
    } satisfies BusEvent<"stream.agent.start">);
    service.registerTool("tool_abc", "agent_xyz", true);

    service.reset();

    const enrichedText = service.enrich({
      type: "stream.text.delta",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        delta: "Text",
        messageId: "msg_001",
      },
    } satisfies BusEvent<"stream.text.delta">);
    expect(enrichedText.resolvedAgentId).toBeUndefined();

    const enrichedTool = service.enrich({
      type: "stream.tool.complete",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool_abc",
        toolName: "test_tool",
        toolResult: "Result",
        success: true,
      },
    } satisfies BusEvent<"stream.tool.complete">);
    expect(enrichedTool.resolvedAgentId).toBeUndefined();
    expect(enrichedTool.isSubagentTool).toBe(false);
  });

  test("Multiple agents — second agent doesn't overwrite mainAgentId", () => {
    service.enrich({
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_001",
        toolCallId: "agent_001",
        agentType: "general-purpose",
        task: "Main task",
        isBackground: false,
      },
    } satisfies BusEvent<"stream.agent.start">);
    service.enrich({
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_002",
        toolCallId: "agent_002",
        agentType: "explore",
        task: "Sub task",
        isBackground: true,
      },
    } satisfies BusEvent<"stream.agent.start">);

    const enriched = service.enrich({
      type: "stream.text.delta",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Text", messageId: "msg_001" },
    } satisfies BusEvent<"stream.text.delta">);

    expect(enriched.resolvedAgentId).toBe("agent_001");
  });

  test("Unknown event types get default enrichment", () => {
    const enriched = service.enrich({
      type: "stream.usage",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: { inputTokens: 100, outputTokens: 50, model: "gpt-4" },
    } satisfies BusEvent<"stream.usage">);

    expect(enriched.type).toBe("stream.usage");
    expect(enriched.resolvedToolId).toBeUndefined();
    expect(enriched.resolvedAgentId).toBeUndefined();
    expect(enriched.isSubagentTool).toBe(false);
    expect(enriched.suppressFromMainChat).toBe(false);
  });

  test("processBatch() enriches all events", () => {
    const events: BusEvent[] = [
      {
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "a", messageId: "m1" },
      },
      {
        type: "stream.text.delta",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "b", messageId: "m1" },
      },
    ];

    const enriched = service.processBatch(events);
    expect(enriched.length).toBe(2);
    expect(enriched[0]).toHaveProperty("resolvedToolId");
    expect(enriched[1]).toHaveProperty("isSubagentTool");
  });
});
