import { beforeEach, describe, expect, it } from "bun:test";
import { CorrelationService } from "@/services/events/consumers/correlation-service.ts";
import { EchoSuppressor } from "@/services/events/consumers/echo-suppressor.ts";
import { StreamPipelineConsumer } from "@/services/events/consumers/stream-pipeline-consumer.ts";
import type { EnrichedBusEvent } from "@/services/events/bus-events.ts";
import type { StreamPartEvent } from "@/state/parts/stream-pipeline.ts";

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

  it("should map stream.tool.start to tool-start event", () => {
    consumer.processBatch([
      {
        type: "stream.tool.start",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { toolId: "tool1", toolName: "bash", toolInput: { command: "ls" } },
      },
    ]);

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
    consumer.processBatch([
      {
        type: "stream.tool.start",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        resolvedAgentId: "subagent_1",
        isSubagentTool: true,
        data: { toolId: "tool1", toolName: "bash", toolInput: { command: "ls" } },
      },
    ]);

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
    consumer.processBatch([
      {
        type: "stream.tool.start",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        resolvedAgentId: "agent_misfire",
        isSubagentTool: false,
        data: { toolId: "tool1", toolName: "TaskOutput", toolInput: { task_id: "abc" } },
      },
    ]);

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
    consumer.processBatch([
      {
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
      },
    ]);

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
    consumer.processBatch([
      {
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
      },
    ]);

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
    consumer.processBatch([
      {
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
      },
    ]);

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

  it("should map stream.tool.partial_result to tool-partial-result event", () => {
    consumer.processBatch([
      {
        type: "stream.tool.partial_result",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { toolCallId: "tool1", partialOutput: "partial output line\n" },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-partial-result",
      runId: 1,
      toolId: "tool1",
      partialOutput: "partial output line\n",
    });
  });

  it("maps stream.tool.partial_result agent attribution when parentAgentId is present", () => {
    consumer.processBatch([
      {
        type: "stream.tool.partial_result",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: {
          toolCallId: "tool1",
          partialOutput: "line\n",
          parentAgentId: "subagent_1",
        },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "tool-partial-result",
      runId: 1,
      toolId: "tool1",
      partialOutput: "line\n",
      agentId: "subagent_1",
    });
  });

  it("should map stream.agent.complete to agent-terminal event", () => {
    consumer.processBatch([
      {
        type: "stream.agent.complete",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: {
          agentId: "agent_1",
          success: true,
          result: "done",
        },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toMatchObject({
      type: "agent-terminal",
      runId: 1,
      agentId: "agent_1",
      status: "completed",
      result: "done",
    });
  });
});
