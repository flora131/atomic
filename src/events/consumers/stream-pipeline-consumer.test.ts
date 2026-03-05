/**
 * Tests for StreamPipelineConsumer
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { StreamPipelineConsumer } from "./stream-pipeline-consumer.ts";
import { CorrelationService } from "./correlation-service.ts";
import { EchoSuppressor } from "./echo-suppressor.ts";
import type { EnrichedBusEvent } from "../bus-events.ts";
import type { StreamPartEvent } from "../../ui/parts/stream-pipeline.ts";

describe("StreamPipelineConsumer", () => {
  let correlation: CorrelationService;
  let echoSuppressor: EchoSuppressor;
  let consumer: StreamPipelineConsumer;
  let receivedEvents: StreamPartEvent[] = [];

  beforeEach(() => {
    correlation = new CorrelationService();
    echoSuppressor = new EchoSuppressor();
    consumer = new StreamPipelineConsumer(correlation, echoSuppressor);
    receivedEvents = [];
    consumer.onStreamParts((events) => {
      receivedEvents.push(...events);
    });
  });

  it("should map stream.text.delta to text-delta event", () => {
    const event: EnrichedBusEvent = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello ", messageId: "msg1" },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "text-delta",
      runId: 1,
      delta: "Hello ",
    });
  });

  it("should filter text deltas through echo suppressor", () => {
    // Register an expected echo
    echoSuppressor.expectEcho("Hello World");

    const event: EnrichedBusEvent = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Hello ", messageId: "msg1" },
    };

    consumer.processBatch([event]);

    // Should be suppressed (empty)
    expect(receivedEvents).toHaveLength(0);
  });

  it("does not suppress agent-scoped text deltas", () => {
    echoSuppressor.expectEcho("agent text");

    const event: EnrichedBusEvent = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "agent text", messageId: "msg1", agentId: "agent_1" },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "text-delta",
      runId: 1,
      delta: "agent text",
      agentId: "agent_1",
    });
  });

  it("should map stream.thinking.delta to thinking-meta event", () => {
    const event: EnrichedBusEvent = {
      type: "stream.thinking.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Thinking...", sourceKey: "block1", messageId: "msg1" },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({
      type: "thinking-meta",
      thinkingSourceKey: "block1",
      targetMessageId: "msg1",
      thinkingText: "Thinking...",
    });
  });

  it("coalesces adjacent thinking deltas with same source", () => {
    const events: EnrichedBusEvent[] = [
      {
        type: "stream.thinking.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Thinking", sourceKey: "block1", messageId: "msg1" },
      },
      {
        type: "stream.thinking.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "...", sourceKey: "block1", messageId: "msg1" },
      },
    ];

    consumer.processBatch(events);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({
      type: "thinking-meta",
      thinkingSourceKey: "block1",
      targetMessageId: "msg1",
      thinkingText: "Thinking...",
    });
  });

  it("should map stream.thinking.delta agentId to thinking-meta agentId", () => {
    const event: EnrichedBusEvent = {
      type: "stream.thinking.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Thinking...", sourceKey: "block1", messageId: "msg1", agentId: "agent_1" },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({
      type: "thinking-meta",
      thinkingSourceKey: "block1",
      targetMessageId: "msg1",
      thinkingText: "Thinking...",
      agentId: "agent_1",
    });
  });

  it("should map stream.tool.start to tool-start event", () => {
    const event: EnrichedBusEvent = {
      type: "stream.tool.start",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { toolId: "tool1", toolName: "bash", toolInput: { command: "ls" } },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-start",
      runId: 1,
      toolId: "tool1",
      toolName: "bash",
      input: { command: "ls" },
    });
  });

  it("uses resolvedAgentId for stream.tool.start when event is sub-agent scoped", () => {
    const event: EnrichedBusEvent = {
      type: "stream.tool.start",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      resolvedAgentId: "subagent_1",
      isSubagentTool: true,
      data: { toolId: "tool1", toolName: "bash", toolInput: { command: "ls" } },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-start",
      runId: 1,
      toolId: "tool1",
      toolName: "bash",
      input: { command: "ls" },
      agentId: "subagent_1",
    });
  });

  it("does not use resolvedAgentId for stream.tool.start when event is not sub-agent scoped", () => {
    const event: EnrichedBusEvent = {
      type: "stream.tool.start",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      resolvedAgentId: "agent_misfire",
      isSubagentTool: false,
      data: { toolId: "tool1", toolName: "TaskOutput", toolInput: { task_id: "abc" } },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-start",
      runId: 1,
      toolId: "tool1",
      toolName: "TaskOutput",
      input: { task_id: "abc" },
    });
  });

  it("should map stream.tool.complete to tool-complete event", () => {
    const event: EnrichedBusEvent = {
      type: "stream.tool.complete",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolId: "tool1",
        toolName: "bash",
        toolResult: "file1.txt\nfile2.txt",
        success: true,
      },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-complete",
      runId: 1,
      toolId: "tool1",
      toolName: "bash",
      output: "file1.txt\nfile2.txt",
      success: true,
      error: undefined,
    });
  });

  it("uses resolvedAgentId for stream.tool.complete when event is sub-agent scoped", () => {
    const event: EnrichedBusEvent = {
      type: "stream.tool.complete",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      resolvedAgentId: "subagent_1",
      isSubagentTool: true,
      data: {
        toolId: "tool1",
        toolName: "bash",
        toolResult: "ok",
        success: true,
      },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-complete",
      runId: 1,
      toolId: "tool1",
      toolName: "bash",
      output: "ok",
      success: true,
      error: undefined,
      agentId: "subagent_1",
    });
  });

  it("does not use resolvedAgentId for stream.tool.complete when event is not sub-agent scoped", () => {
    const event: EnrichedBusEvent = {
      type: "stream.tool.complete",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      resolvedAgentId: "agent_misfire",
      isSubagentTool: false,
      data: {
        toolId: "tool1",
        toolName: "TaskOutput",
        toolResult: { retrieval_status: "running" },
        success: true,
      },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-complete",
      runId: 1,
      toolId: "tool1",
      toolName: "TaskOutput",
      output: { retrieval_status: "running" },
      success: true,
      error: undefined,
    });
  });

  it("does not suppress main-stream text after TaskOutput completion", () => {
    const events: EnrichedBusEvent[] = [
      {
        type: "stream.tool.complete",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolId: "taskoutput-1",
          toolName: "TaskOutput",
          toolResult: { result: "sub-agent final output" },
          success: true,
        },
      },
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: {
          delta: "sub-agent final output",
          messageId: "msg1",
        },
      },
    ];

    consumer.processBatch(events);

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0]).toEqual({
      type: "tool-complete",
      runId: 1,
      toolId: "taskoutput-1",
      toolName: "TaskOutput",
      output: { result: "sub-agent final output" },
      success: true,
      error: undefined,
    });
    expect(receivedEvents[1]).toEqual({
      type: "text-delta",
      runId: 1,
      delta: "sub-agent final output",
    });
  });

  it("coalesces adjacent text deltas within a batch", () => {
    const events: EnrichedBusEvent[] = [
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello ", messageId: "msg1" },
      },
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "World", messageId: "msg1" },
      },
    ];

    consumer.processBatch(events);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]?.type).toBe("text-delta");
    if (receivedEvents[0]?.type === "text-delta") {
      expect(receivedEvents[0].delta).toBe("Hello World");
    }
  });

  it("does not coalesce text deltas across different runs", () => {
    const events: EnrichedBusEvent[] = [
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "old ", messageId: "msg1" },
      },
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 2,
        timestamp: Date.now(),
        data: { delta: "new", messageId: "msg2" },
      },
    ];

    consumer.processBatch(events);

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0]).toMatchObject({ type: "text-delta", runId: 1, delta: "old " });
    expect(receivedEvents[1]).toMatchObject({ type: "text-delta", runId: 2, delta: "new" });
  });

  it("does not coalesce text deltas across non-text boundaries", () => {
    const events: EnrichedBusEvent[] = [
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Hello ", messageId: "msg1" },
      },
      {
        type: "stream.tool.start",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { toolId: "tool1", toolName: "bash", toolInput: { command: "ls" } },
      },
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "World", messageId: "msg1" },
      },
    ];

    consumer.processBatch(events);

    expect(receivedEvents).toHaveLength(3);
    expect(receivedEvents[0]?.type).toBe("text-delta");
    expect(receivedEvents[1]?.type).toBe("tool-start");
    expect(receivedEvents[2]?.type).toBe("text-delta");
  });

  it("should map stream.text.complete to text-complete event", () => {
    const event: EnrichedBusEvent = {
      type: "stream.text.complete",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { messageId: "msg1", fullText: "Hello World" },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "text-complete",
      runId: 1,
      fullText: "Hello World",
      messageId: "msg1",
    });
  });

  it("should map stream.agent.complete to agent-terminal event", () => {
    const event: EnrichedBusEvent = {
      type: "stream.agent.complete",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: {
        agentId: "agent_1",
        success: true,
        result: "done",
      },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({
      type: "agent-terminal",
      runId: 1,
      agentId: "agent_1",
      status: "completed",
      result: "done",
    });
  });

  it("should map workflow.step.start to workflow-step-start event", () => {
    const event: EnrichedBusEvent = {
      type: "workflow.step.start",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { workflowId: "wf1", nodeId: "node1", nodeName: "Planner" },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "workflow-step-start",
      runId: 1,
      workflowId: "wf1",
      nodeId: "node1",
      nodeName: "Planner",
      startedAt: new Date(event.timestamp).toISOString(),
    });
  });

  it("should map workflow.step.complete to workflow-step-complete event", () => {
    const event: EnrichedBusEvent = {
      type: "workflow.step.complete",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { workflowId: "wf1", nodeId: "node1", nodeName: "Planner", status: "success" },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "workflow-step-complete",
      runId: 1,
      workflowId: "wf1",
      nodeId: "node1",
      nodeName: "Planner",
      status: "success",
      completedAt: new Date(event.timestamp).toISOString(),
    });
  });

  it("should map workflow.task.update to task-list-update event", () => {
    const event: EnrichedBusEvent = {
      type: "workflow.task.update",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: {
        workflowId: "wf1",
        tasks: [
          { id: "t1", title: "Plan", status: "complete", blockedBy: [] },
          { id: "t2", title: "Implement", status: "pending" },
        ],
      },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "task-list-update",
      runId: 1,
      tasks: [
        { id: "t1", title: "Plan", status: "complete", blockedBy: [] },
        { id: "t2", title: "Implement", status: "pending" },
      ],
    });
  });

  it("should map workflow task result envelopes to task-result-upsert events", () => {
    const event: EnrichedBusEvent = {
      type: "workflow.task.update",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: {
        workflowId: "wf1",
        tasks: [
          {
            id: "t1",
            title: "Plan",
            status: "completed",
            taskResult: {
              task_id: "#1",
              tool_name: "task",
              title: "Plan",
              status: "completed",
              output_text: "done",
              envelope_text: "task_id: #1",
              metadata: {
                sessionId: "session-1",
              },
            },
          },
        ],
      },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(2);
    expect(receivedEvents[0]).toEqual({
      type: "task-list-update",
      runId: 1,
      tasks: [
        {
          id: "t1",
          title: "Plan",
          status: "completed",
        },
      ],
    });
    expect(receivedEvents[1]).toEqual({
      type: "task-result-upsert",
      runId: 1,
      envelope: {
        task_id: "#1",
        tool_name: "task",
        title: "Plan",
        status: "completed",
        output_text: "done",
        envelope_text: "task_id: #1",
        metadata: {
          sessionId: "session-1",
        },
      },
    });
  });

  it("should map stream.tool.partial_result to tool-partial-result event", () => {
    const event: EnrichedBusEvent = {
      type: "stream.tool.partial_result",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { toolCallId: "tool1", partialOutput: "partial output line\n" },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-partial-result",
      runId: 1,
      toolId: "tool1",
      partialOutput: "partial output line\n",
    });
  });

  it("maps stream.tool.partial_result agent attribution when parentAgentId is present", () => {
    const event: EnrichedBusEvent = {
      type: "stream.tool.partial_result",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: {
        toolCallId: "tool1",
        partialOutput: "line\n",
        parentAgentId: "subagent_1",
      },
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-partial-result",
      runId: 1,
      toolId: "tool1",
      partialOutput: "line\n",
      agentId: "subagent_1",
    });
  });

  it("should ignore unmapped event types", () => {
    const event: EnrichedBusEvent = {
      type: "stream.session.start",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: {},
    };

    consumer.processBatch([event]);

    expect(receivedEvents).toHaveLength(0);
  });

  it("should support callback unsubscribe", () => {
    const unsubscribe = consumer.onStreamParts((events) => {
      receivedEvents.push(...events);
    });

    unsubscribe();

    const event: EnrichedBusEvent = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Test", messageId: "msg1" },
    };

    consumer.processBatch([event]);

    // Should not receive events after unsubscribe
    expect(receivedEvents).toHaveLength(0);
  });

  it("should reset state on reset()", () => {
    // Setup some state
    const event: EnrichedBusEvent = {
      type: "stream.text.delta",
      sessionId: "test",
      runId: 1,
      timestamp: Date.now(),
      data: { delta: "Test", messageId: "msg1" },
    };

    consumer.processBatch([event]);
    expect(receivedEvents).toHaveLength(1);

    // Reset
    consumer.reset();

    // Echo suppressor and correlation should be reset (tested in their own tests)
    // This test just verifies reset() doesn't throw
    expect(() => consumer.reset()).not.toThrow();
  });
});
