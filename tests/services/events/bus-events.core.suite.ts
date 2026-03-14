import { describe, expect, it } from "bun:test";
import { BusEventSchemas } from "@/services/events/bus-events.ts";
import type { BusEvent, BusEventDataMap, BusEventType, EnrichedBusEvent } from "@/services/events/bus-events.ts";

describe("BusEvent Type Definitions", () => {
  it("should create a valid text delta event", () => {
    const event: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello", messageId: "msg-1" },
    };

    expect(event.type).toBe("stream.text.delta");
    expect(event.data.delta).toBe("Hello");
  });

  it("should create a valid tool start event", () => {
    const event: BusEvent<"stream.tool.start"> = {
      type: "stream.tool.start",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool-1",
        toolName: "bash",
        toolInput: { command: "ls -la" },
        sdkCorrelationId: "sdk-123",
      },
    };

    expect(event.type).toBe("stream.tool.start");
    expect(event.data.toolName).toBe("bash");
  });

  it("should create a valid agent start event", () => {
    const event: BusEvent<"stream.agent.start"> = {
      type: "stream.agent.start",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent-1",
        toolCallId: "agent-1",
        agentType: "explore",
        task: "Find all TypeScript files",
        isBackground: false,
      },
    };

    expect(event.type).toBe("stream.agent.start");
    expect(event.data.agentType).toBe("explore");
  });

  it("should create a valid workflow step start event", () => {
    const event: BusEvent<"workflow.step.start"> = {
      type: "workflow.step.start",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeName: "Initialize",
      },
    };

    expect(event.type).toBe("workflow.step.start");
    expect(event.data.nodeName).toBe("Initialize");
  });

  it("should create a valid permission requested event", () => {
    const event: BusEvent<"stream.permission.requested"> = {
      type: "stream.permission.requested",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
        requestId: "req-1",
        toolName: "file_delete",
        question: "Delete this file?",
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
        ],
      },
    };

    expect(event.type).toBe("stream.permission.requested");
    expect(event.data.options).toHaveLength(2);
  });

  it("should create a valid usage event", () => {
    const event: BusEvent<"stream.usage"> = {
      type: "stream.usage",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: { inputTokens: 100, outputTokens: 50, model: "claude-3-sonnet" },
    };

    expect(event.data.inputTokens).toBe(100);
    expect(event.data.outputTokens).toBe(50);
  });

  it("should create a valid partial-idle event", () => {
    const event: BusEvent<"stream.session.partial-idle"> = {
      type: "stream.session.partial-idle",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
        completionReason: "foreground_stream_ended",
        activeBackgroundAgentCount: 2,
      },
    };

    expect(event.type).toBe("stream.session.partial-idle");
    expect(event.data.completionReason).toBe("foreground_stream_ended");
    expect(event.data.activeBackgroundAgentCount).toBe(2);
  });

  it("should create enriched events with correlation data", () => {
    const enrichedEvent: EnrichedBusEvent = {
      type: "stream.tool.start",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool-1",
        toolName: "bash",
        toolInput: {},
        parentAgentId: "agent-1",
      },
      resolvedToolId: "resolved-tool-1",
      resolvedAgentId: "agent-1",
      isSubagentTool: true,
      suppressFromMainChat: true,
    };

    expect(enrichedEvent.isSubagentTool).toBe(true);
    expect(enrichedEvent.suppressFromMainChat).toBe(true);
  });

  it("should ensure all event types are covered in BusEventDataMap", () => {
    const eventTypes = Object.keys(BusEventSchemas) as BusEventType[];

    eventTypes.forEach((type) => {
      const check: keyof BusEventDataMap = type;
      expect(check).toBeDefined();
    });
  });

  it("should parse workflow.task.statusChange payloads with workflowId", () => {
    const parsed = BusEventSchemas["workflow.task.statusChange"].parse({
      workflowId: "workflow-1",
      taskIds: ["task-1"],
      newStatus: "completed",
      tasks: [{ id: "task-1", title: "First task", status: "completed" }],
    });

    expect(parsed.workflowId).toBe("workflow-1");
    expect(parsed.newStatus).toBe("completed");
    expect(parsed.tasks[0]?.status).toBe("completed");
  });

  it("should create a valid workflow.task.statusChange event", () => {
    const event: BusEvent<"workflow.task.statusChange"> = {
      type: "workflow.task.statusChange",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
        workflowId: "workflow-1",
        taskIds: ["task-1", "task-2"],
        newStatus: "in_progress",
        tasks: [
          { id: "task-1", title: "First task", status: "in_progress" },
          { id: "task-2", title: "Second task", status: "in_progress" },
          { id: "task-3", title: "Third task", status: "pending" },
        ],
      },
    };

    expect(event.type).toBe("workflow.task.statusChange");
    expect(event.data.taskIds).toEqual(["task-1", "task-2"]);
    expect(event.data.newStatus).toBe("in_progress");
    expect(event.data.tasks).toHaveLength(3);
    expect(event.data.tasks[0]!.status).toBe("in_progress");
  });
});
