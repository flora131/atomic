import { beforeEach, describe, expect, it } from "bun:test";
import { CorrelationService } from "@/services/events/consumers/correlation-service.ts";
import { EchoSuppressor } from "@/services/events/consumers/echo-suppressor.ts";
import { StreamPipelineConsumer } from "@/services/events/consumers/stream-pipeline-consumer.ts";
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

  it("should map workflow.step.start to workflow-step-start event", () => {
    const timestamp = Date.now();
    consumer.processBatch([
      {
        type: "workflow.step.start",
        sessionId: "test",
        runId: 1,
        timestamp,
        data: { workflowId: "wf1", nodeId: "node1", nodeName: "Planner" },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "workflow-step-start",
      runId: 1,
      workflowId: "wf1",
      nodeId: "node1",
      nodeName: "Planner",
      startedAt: new Date(timestamp).toISOString(),
    });
  });

  it("should map workflow.step.complete to workflow-step-complete event", () => {
    const timestamp = Date.now();
    consumer.processBatch([
      {
        type: "workflow.step.complete",
        sessionId: "test",
        runId: 1,
        timestamp,
        data: { workflowId: "wf1", nodeId: "node1", nodeName: "Planner", status: "success" },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "workflow-step-complete",
      runId: 1,
      workflowId: "wf1",
      nodeId: "node1",
      nodeName: "Planner",
      status: "success",
      completedAt: new Date(timestamp).toISOString(),
    });
  });

  it("should map workflow.task.update to task-list-update event", () => {
    consumer.processBatch([
      {
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
      },
    ]);

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
    consumer.processBatch([
      {
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
      },
    ]);

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

  it("should ignore unmapped event types", () => {
    consumer.processBatch([
      {
        type: "stream.session.start",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: {},
      },
    ]);

    expect(receivedEvents).toHaveLength(0);
  });

  it("should support callback unsubscribe", () => {
    const unsubscribe = consumer.onStreamParts((events) => {
      receivedEvents.push(...events);
    });

    unsubscribe();

    consumer.processBatch([
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Test", messageId: "msg1" },
      },
    ]);

    expect(receivedEvents).toHaveLength(0);
  });

  it("should reset state on reset()", () => {
    consumer.processBatch([
      {
        type: "stream.text.delta",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: { delta: "Test", messageId: "msg1" },
      },
    ]);
    expect(receivedEvents).toHaveLength(1);

    consumer.reset();
    expect(() => consumer.reset()).not.toThrow();
  });
});
