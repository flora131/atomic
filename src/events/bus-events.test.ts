/**
 * Type tests for bus-events.ts
 *
 * These tests verify that the type definitions work correctly and provide
 * proper type safety and inference.
 */

import { describe, it, expect } from "bun:test";
import type {
  BusEventType,
  BusEventDataMap,
  BusEvent,
  BusHandler,
  WildcardHandler,
  EnrichedBusEvent,
} from "./bus-events";

describe("BusEvent Type Definitions", () => {
  it("should create a valid text delta event", () => {
    const event: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
        delta: "Hello",
        messageId: "msg-1",
      },
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
      data: {
        inputTokens: 100,
        outputTokens: 50,
        model: "claude-3-sonnet",
      },
    };

    expect(event.data.inputTokens).toBe(100);
    expect(event.data.outputTokens).toBe(50);
  });

  it("should support typed event handlers", () => {
    const handler: BusHandler<"stream.text.delta"> = (event) => {
      // TypeScript should infer the correct data type
      expect(typeof event.data.delta).toBe("string");
      expect(typeof event.data.messageId).toBe("string");
    };

    const testEvent: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "test", messageId: "msg-1" },
    };

    handler(testEvent);
  });

  it("should support wildcard handlers", () => {
    const wildcardHandler: WildcardHandler = (event) => {
      // Should accept any event type
      expect(event.type).toBeDefined();
      expect(event.sessionId).toBeDefined();
    };

    const textEvent: BusEvent<"stream.text.delta"> = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "test", messageId: "msg-1" },
    };

    const toolEvent: BusEvent<"stream.tool.start"> = {
      type: "stream.tool.start",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool-1",
        toolName: "bash",
        toolInput: {},
      },
    };

    wildcardHandler(textEvent);
    wildcardHandler(toolEvent);
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
    // This is a compile-time check - if any event type is missing from
    // BusEventDataMap, TypeScript will error
    const eventTypes: BusEventType[] = [
      "stream.text.delta",
      "stream.text.complete",
      "stream.thinking.delta",
      "stream.thinking.complete",
      "stream.tool.start",
      "stream.tool.complete",
      "stream.agent.start",
      "stream.agent.update",
      "stream.agent.complete",
      "stream.session.start",
      "stream.session.idle",
      "stream.session.error",
      "workflow.step.start",
      "workflow.step.complete",
      "workflow.task.update",
      "workflow.task.statusChange",
      "stream.permission.requested",
      "stream.human_input_required",
      "stream.skill.invoked",
      "stream.usage",
    ];

    // Verify we have data map entries for all event types
    eventTypes.forEach((type) => {
      // This is a type-level check - the key must exist in BusEventDataMap
      const _check: keyof BusEventDataMap = type;
      expect(type).toBeDefined();
    });
  });

  it("should create a valid workflow.task.statusChange event", () => {
    const event: BusEvent<"workflow.task.statusChange"> = {
      type: "workflow.task.statusChange",
      sessionId: "test-session",
      runId: 1,
      timestamp: Date.now(),
      data: {
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
