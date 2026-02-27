/**
 * Unit tests for CorrelationService
 *
 * Tests the enrichment and correlation logic for tracking tool-agent relationships
 * and enriching BusEvents with resolved metadata.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { CorrelationService } from "./correlation-service.ts";
import type { SubagentContext } from "./correlation-service.ts";
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

  // --- Sub-agent Registry Tests ---

  describe("registerSubagent / unregisterSubagent", () => {
    const subagentContext: SubagentContext = {
      parentAgentId: "parent_001",
      workflowRunId: "wf_run_1",
      nodeId: "planner",
    };

    test("registerSubagent stores context for enrichment", () => {
      service.registerSubagent("sub_agent_1", subagentContext);

      const event: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "sub_agent_1",
          agentType: "task",
          task: "Analyze code",
          isBackground: false,
        },
      };

      const enriched = service.enrich(event);

      expect(enriched.resolvedAgentId).toBe("sub_agent_1");
      expect(enriched.parentAgentId).toBe("parent_001");
      expect(enriched.suppressFromMainChat).toBe(false);
    });

    test("unregisterSubagent removes context so enrichment no longer applies", () => {
      service.registerSubagent("sub_agent_2", subagentContext);
      service.unregisterSubagent("sub_agent_2");

      const event: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "sub_agent_2",
          agentType: "task",
          task: "Write tests",
          isBackground: false,
        },
      };

      const enriched = service.enrich(event);

      expect(enriched.resolvedAgentId).toBe("sub_agent_2");
      expect(enriched.parentAgentId).toBeUndefined();
    });

    test("unregisterSubagent is safe for non-existent agentId", () => {
      // Should not throw
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

      const event: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "worker_1",
          agentType: "explore",
          task: "Research docs",
          isBackground: true,
        },
      };

      const enriched = service.enrich(event);

      expect(enriched.resolvedAgentId).toBe("worker_1");
      expect(enriched.parentAgentId).toBe("workflow_main");
      expect(enriched.suppressFromMainChat).toBe(false);
    });

    test("stream.agent.update enriches with parentAgentId for registered sub-agent", () => {
      service.registerSubagent("worker_2", subagentContext);

      const event: BusEvent<"stream.agent.update"> = {
        type: "stream.agent.update",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "worker_2",
          currentTool: "read_file",
          toolUses: 3,
        },
      };

      const enriched = service.enrich(event);

      expect(enriched.resolvedAgentId).toBe("worker_2");
      expect(enriched.parentAgentId).toBe("workflow_main");
      expect(enriched.suppressFromMainChat).toBe(false);
    });

    test("stream.agent.complete enriches with parentAgentId for registered sub-agent", () => {
      service.registerSubagent("worker_3", subagentContext);

      const event: BusEvent<"stream.agent.complete"> = {
        type: "stream.agent.complete",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "worker_3",
          success: true,
          result: "Done",
        },
      };

      const enriched = service.enrich(event);

      expect(enriched.resolvedAgentId).toBe("worker_3");
      expect(enriched.parentAgentId).toBe("workflow_main");
      expect(enriched.suppressFromMainChat).toBe(false);
    });

    test("agent events for non-registered agents have no parentAgentId", () => {
      const event: BusEvent<"stream.agent.update"> = {
        type: "stream.agent.update",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "unregistered_agent",
          currentTool: "bash",
        },
      };

      const enriched = service.enrich(event);

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

      const event: BusEvent<"stream.tool.start"> = {
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
      };

      const enriched = service.enrich(event);

      expect(enriched.resolvedToolId).toBe("tool_abc");
      expect(enriched.resolvedAgentId).toBe("sub_coder");
      expect(enriched.parentAgentId).toBe("workflow_main");
      expect(enriched.isSubagentTool).toBe(true);
      expect(enriched.suppressFromMainChat).toBe(false);
    });

    test("stream.tool.start without parentAgentId falls back to mainAgentId", () => {
      // Set up main agent
      const agentEvent: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "main_agent",
          agentType: "general-purpose",
          task: "Main task",
          isBackground: false,
        },
      };
      service.enrich(agentEvent);

      const event: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool_def",
          toolName: "bash",
          toolInput: { command: "ls" },
        },
      };

      const enriched = service.enrich(event);

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

      const event: BusEvent<"stream.tool.complete"> = {
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
      };

      const enriched = service.enrich(event);

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

      // After reset, registered sub-agents should no longer enrich events
      const event: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "sub_1",
          agentType: "task",
          task: "Test",
          isBackground: false,
        },
      };

      const enriched = service.enrich(event);
      expect(enriched.parentAgentId).toBeUndefined();
    });

    test("startRun() clears the subagent registry via reset()", () => {
      service.registerSubagent("sub_old", {
        parentAgentId: "old_parent",
        workflowRunId: "wf_old",
      });

      service.startRun(100, "new_session");

      const event: BusEvent<"stream.agent.update"> = {
        type: "stream.agent.update",
        sessionId: "new_session",
        runId: 100,
        timestamp: Date.now(),
        data: {
          agentId: "sub_old",
          currentTool: "bash",
        },
      };

      const enriched = service.enrich(event);
      expect(enriched.parentAgentId).toBeUndefined();
    });
  });

  describe("sub-agent registry does not break existing behavior", () => {
    test("non-sub-agent events still enrich correctly with no registry entries", () => {
      // Main agent start
      const agentEvent: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "main_agent",
          agentType: "general-purpose",
          task: "Chat",
          isBackground: false,
        },
      };
      const agentEnriched = service.enrich(agentEvent);
      expect(agentEnriched.resolvedAgentId).toBe("main_agent");
      expect(agentEnriched.parentAgentId).toBeUndefined();

      // Tool registration and completion
      service.registerTool("tool_1", "main_agent", false);
      const toolEvent: BusEvent<"stream.tool.complete"> = {
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
      };
      const toolEnriched = service.enrich(toolEvent);
      expect(toolEnriched.resolvedAgentId).toBe("main_agent");
      expect(toolEnriched.isSubagentTool).toBe(false);
      expect(toolEnriched.parentAgentId).toBeUndefined();

      // Text delta
      const textEvent: BusEvent<"stream.text.delta"> = {
        type: "stream.text.delta",
        sessionId: "session_1",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello", messageId: "msg_1" },
      };
      const textEnriched = service.enrich(textEvent);
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

      const eventA: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { agentId: "worker_a", agentType: "task", task: "A", isBackground: false },
      };
      const eventB: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "s1",
        runId: 1,
        timestamp: Date.now(),
        data: { agentId: "worker_b", agentType: "task", task: "B", isBackground: false },
      };

      const enrichedA = service.enrich(eventA);
      const enrichedB = service.enrich(eventB);

      expect(enrichedA.parentAgentId).toBe("orchestrator");
      expect(enrichedB.parentAgentId).toBe("orchestrator");
      expect(enrichedA.resolvedAgentId).toBe("worker_a");
      expect(enrichedB.resolvedAgentId).toBe("worker_b");
    });
  });

  // --------------------------------------------------------------------------
  // Sub-agent text-complete suppression
  // --------------------------------------------------------------------------

  describe("sub-agent text-complete suppression", () => {
    test("stream.text.complete with subagent- messageId is suppressed", () => {
      service.registerSubagent("worker-1", { parentAgentId: "main-agent" });

      const event: BusEvent<"stream.text.complete"> = {
        type: "stream.text.complete",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: { messageId: "subagent-worker-1", fullText: "done" },
      };

      const enriched = service.enrich(event);
      expect(enriched.suppressFromMainChat).toBe(true);
      expect(enriched.resolvedAgentId).toBe("worker-1");
      expect(enriched.parentAgentId).toBe("main-agent");
    });

    test("stream.text.complete without subagent- prefix is NOT suppressed", () => {
      const agentStartEvent: BusEvent<"stream.agent.start"> = {
        type: "stream.agent.start",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: { agentId: "main-agent", agentType: "chat", task: "test" },
      };
      service.enrich(agentStartEvent);

      const event: BusEvent<"stream.text.complete"> = {
        type: "stream.text.complete",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: { messageId: "msg-123", fullText: "done" },
      };

      const enriched = service.enrich(event);
      expect(enriched.suppressFromMainChat).toBe(false);
      expect(enriched.resolvedAgentId).toBe("main-agent");
    });
  });

  // --------------------------------------------------------------------------
  // Sub-agent tool registration in toolToAgent map
  // --------------------------------------------------------------------------

  describe("sub-agent tool ID registration on stream.tool.start", () => {
    test("registers tool in toolToAgent so stream.tool.complete resolves agent", () => {
      service.registerSubagent("worker-1", { parentAgentId: "main-agent" });

      const toolStartEvent: BusEvent<"stream.tool.start"> = {
        type: "stream.tool.start",
        sessionId: "session_123",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "tool-abc",
          toolName: "grep",
          parentAgentId: "worker-1",
        },
      };
      service.enrich(toolStartEvent);

      // Now stream.tool.complete should resolve the agent
      const toolCompleteEvent: BusEvent<"stream.tool.complete"> = {
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
      };
      const enriched = service.enrich(toolCompleteEvent);
      expect(enriched.resolvedAgentId).toBe("worker-1");
      expect(enriched.isSubagentTool).toBe(true);
      expect(enriched.parentAgentId).toBe("main-agent");
    });
  });
});
