/**
 * Unit tests for CorrelationService
 *
 * Tests the enrichment and correlation logic for tracking tool-agent relationships
 * and enriching BusEvents with resolved metadata.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { CorrelationService } from "./correlation-service.ts";
import type { BusEvent } from "../bus-events.ts";

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
    // Start an agent first to set mainAgentId
    const agentEvent: BusEvent<"stream.agent.start"> = {
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_001",
        agentType: "general-purpose",
        task: "Test task",
        isBackground: false,
      },
    };
    service.enrich(agentEvent);

    const toolStartEvent: BusEvent<"stream.tool.start"> = {
      type: "stream.tool.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool_123",
        toolName: "test_tool",
        toolInput: { param: "value" },
      },
    };

    const enriched = service.enrich(toolStartEvent);

    expect(enriched.resolvedToolId).toBe("tool_123");
    expect(enriched.resolvedAgentId).toBe("agent_001");
  });

  test("stream.tool.complete correlates with registered agent", () => {
    // Register the tool
    service.registerTool("tool_456", "agent_002", false);

    const toolCompleteEvent: BusEvent<"stream.tool.complete"> = {
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
    };

    const enriched = service.enrich(toolCompleteEvent);

    expect(enriched.resolvedToolId).toBe("tool_456");
    expect(enriched.resolvedAgentId).toBe("agent_002");
    expect(enriched.isSubagentTool).toBe(false);
  });

  test("registerTool() maps tool to agent", () => {
    service.registerTool("tool_999", "agent_888", false);

    const toolCompleteEvent: BusEvent<"stream.tool.complete"> = {
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
    };

    const enriched = service.enrich(toolCompleteEvent);

    expect(enriched.resolvedAgentId).toBe("agent_888");
    expect(enriched.isSubagentTool).toBe(false);
  });

  test("registerTool() with isSubagent=true marks sub-agent tools", () => {
    service.registerTool("tool_sub", "agent_sub", true);

    const toolCompleteEvent: BusEvent<"stream.tool.complete"> = {
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
    };

    const enriched = service.enrich(toolCompleteEvent);

    expect(enriched.resolvedAgentId).toBe("agent_sub");
    expect(enriched.isSubagentTool).toBe(true);
  });

  test("stream.text.delta resolves to main agent", () => {
    // Set up main agent
    const agentEvent: BusEvent<"stream.agent.start"> = {
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_main",
        agentType: "general-purpose",
        task: "Main task",
        isBackground: false,
      },
    };
    service.enrich(agentEvent);

    const textEvent: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        delta: "Hello world",
        messageId: "msg_001",
      },
    };

    const enriched = service.enrich(textEvent);

    expect(enriched.resolvedAgentId).toBe("agent_main");
  });

  test("reset() clears all state", () => {
    // Set up state
    const agentEvent: BusEvent<"stream.agent.start"> = {
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_123",
        agentType: "general-purpose",
        task: "Test",
        isBackground: false,
      },
    };
    service.enrich(agentEvent);
    service.registerTool("tool_abc", "agent_xyz", true);

    // Reset
    service.reset();

    // Check that mainAgentId is cleared
    const textEvent: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        delta: "Text",
        messageId: "msg_001",
      },
    };
    const enriched = service.enrich(textEvent);
    expect(enriched.resolvedAgentId).toBeUndefined();

    // Check that tool mapping is cleared
    const toolEvent: BusEvent<"stream.tool.complete"> = {
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
    };
    const enrichedTool = service.enrich(toolEvent);
    expect(enrichedTool.resolvedAgentId).toBeUndefined();
    expect(enrichedTool.isSubagentTool).toBe(false);
  });

  test("Multiple agents — second agent doesn't overwrite mainAgentId", () => {
    // First agent
    const agent1Event: BusEvent<"stream.agent.start"> = {
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_001",
        agentType: "general-purpose",
        task: "Main task",
        isBackground: false,
      },
    };
    service.enrich(agent1Event);

    // Second agent (should not become mainAgentId)
    const agent2Event: BusEvent<"stream.agent.start"> = {
      type: "stream.agent.start",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_002",
        agentType: "explore",
        task: "Sub task",
        isBackground: true,
      },
    };
    service.enrich(agent2Event);

    // Text event should still resolve to first agent
    const textEvent: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        delta: "Text",
        messageId: "msg_001",
      },
    };
    const enriched = service.enrich(textEvent);

    expect(enriched.resolvedAgentId).toBe("agent_001");
  });

  test("Unknown event types get default enrichment", () => {
    const event: BusEvent<"stream.usage"> = {
      type: "stream.usage",
      sessionId: "session_123",
      runId: 1,
      timestamp: Date.now(),
      data: {
        inputTokens: 100,
        outputTokens: 50,
        model: "gpt-4",
      },
    };

    const enriched = service.enrich(event);

    expect(enriched.type).toBe("stream.usage");
    expect(enriched.resolvedToolId).toBeUndefined();
    expect(enriched.resolvedAgentId).toBeUndefined();
    expect(enriched.isSubagentTool).toBe(false);
    expect(enriched.suppressFromMainChat).toBe(false);
  });

  test("startRun() sets activeRunId and ownedSessionIds", () => {
    service.startRun(42, "session-abc");
    expect(service.activeRunId).toBe(42);
  });

  test("startRun() resets previous state", () => {
    // Set up some state
    service.registerTool("tool-1", "agent-1");
    service.startRun(1, "session-1");
    
    // After startRun, the previous tool registration should be cleared
    const toolEvent: BusEvent<"stream.tool.complete"> = {
      type: "stream.tool.complete",
      sessionId: "session-1",
      runId: 1,
      timestamp: Date.now(),
      data: { toolId: "tool-1", toolName: "test", toolResult: "", success: true },
    };
    const enriched = service.enrich(toolEvent);
    expect(enriched.resolvedAgentId).toBeUndefined();
  });

  test("isOwnedEvent() returns true for matching runId", () => {
    service.startRun(5, "session-x");
    const event: BusEvent = {
      type: "stream.text.delta",
      sessionId: "session-other",
      runId: 5,
      timestamp: Date.now(),
      data: { delta: "hi", messageId: "m1" },
    };
    expect(service.isOwnedEvent(event)).toBe(true);
  });

  test("isOwnedEvent() returns true for owned sessionId", () => {
    service.startRun(5, "session-x");
    const event: BusEvent = {
      type: "stream.text.delta",
      sessionId: "session-x",
      runId: 999,
      timestamp: Date.now(),
      data: { delta: "hi", messageId: "m1" },
    };
    expect(service.isOwnedEvent(event)).toBe(true);
  });

  test("isOwnedEvent() returns false for unrelated event", () => {
    service.startRun(5, "session-x");
    const event: BusEvent = {
      type: "stream.text.delta",
      sessionId: "session-other",
      runId: 99,
      timestamp: Date.now(),
      data: { delta: "hi", messageId: "m1" },
    };
    expect(service.isOwnedEvent(event)).toBe(false);
  });

  test("activeRunId is null initially", () => {
    expect(service.activeRunId).toBeNull();
  });

  test("processBatch() enriches all events", () => {
    const events: BusEvent[] = [
      { type: "stream.text.delta", sessionId: "s1", runId: 1, timestamp: Date.now(), data: { delta: "a", messageId: "m1" } },
      { type: "stream.text.delta", sessionId: "s1", runId: 1, timestamp: Date.now(), data: { delta: "b", messageId: "m1" } },
    ];
    const enriched = service.processBatch(events);
    expect(enriched.length).toBe(2);
    expect(enriched[0]).toHaveProperty("resolvedToolId");
    expect(enriched[1]).toHaveProperty("isSubagentTool");
  });

  test("reset() clears run ownership state", () => {
    service.startRun(10, "session-owned");
    service.reset();
    expect(service.activeRunId).toBeNull();
    const event: BusEvent = {
      type: "stream.text.delta",
      sessionId: "session-owned",
      runId: 10,
      timestamp: Date.now(),
      data: { delta: "hi", messageId: "m1" },
    };
    expect(service.isOwnedEvent(event)).toBe(false);
  });
});
