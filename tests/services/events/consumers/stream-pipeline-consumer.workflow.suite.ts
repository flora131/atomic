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
            { id: "t1", title: "Plan", status: "completed", blockedBy: [] },
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
        { id: "t1", title: "Plan", status: "completed", blockedBy: [] },
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

  it("should map workflow.task.statusChange to task-list-update event", () => {
    consumer.processBatch([
      {
        type: "workflow.task.statusChange",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: {
          workflowId: "wf1",
          taskIds: ["t1", "t2"],
          newStatus: "in_progress",
          tasks: [
            { id: "t1", title: "Plan", status: "completed" },
            { id: "t2", title: "Implement", status: "in_progress", blockedBy: ["t1"] },
          ],
        },
      },
    ]);

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual({
      type: "task-list-update",
      runId: 1,
      tasks: [
        { id: "t1", title: "Plan", status: "completed" },
        { id: "t2", title: "Implement", status: "in_progress", blockedBy: ["t1"] },
      ],
    });
  });

  it("should map workflow.task.statusChange with task results to task-result-upsert events", () => {
    consumer.processBatch([
      {
        type: "workflow.task.statusChange",
        sessionId: "test",
        runId: 1,
        timestamp: Date.now(),
        data: {
          workflowId: "wf1",
          taskIds: ["t1"],
          newStatus: "completed",
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
      tasks: [{ id: "t1", title: "Plan", status: "completed" }],
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
      },
    });
  });

  it("should produce no stream parts for lifecycle events consumed by direct bus subscriptions", () => {
    const base = { sessionId: "test", runId: 1, timestamp: Date.now() };

    const lifecycleEvents: EnrichedBusEvent[] = [
      { ...base, type: "stream.session.start", data: {} },
      { ...base, type: "stream.session.idle", data: {} },
      { ...base, type: "stream.session.partial-idle", data: { completionReason: "done", activeBackgroundAgentCount: 0 } },
      { ...base, type: "stream.session.error", data: { error: "fail" } },
      { ...base, type: "stream.session.retry", data: { attempt: 1, delay: 1000, message: "retry", nextRetryAt: Date.now() + 1000 } },
      { ...base, type: "stream.session.info", data: { infoType: "test", message: "info" } },
      { ...base, type: "stream.session.warning", data: { warningType: "test", message: "warn" } },
      { ...base, type: "stream.session.title_changed", data: { title: "new title" } },
      { ...base, type: "stream.session.truncation", data: { tokenLimit: 100, tokensRemoved: 50, messagesRemoved: 2 } },
      { ...base, type: "stream.session.compaction", data: { phase: "start" } },
      { ...base, type: "stream.turn.start", data: { turnId: "t1" } },
      { ...base, type: "stream.turn.end", data: { turnId: "t1" } },
      { ...base, type: "stream.agent.start", data: { agentId: "a1", toolCallId: "tc1", agentType: "task", task: "do it", isBackground: false } },
      { ...base, type: "stream.agent.update", data: { agentId: "a1" } },
      { ...base, type: "stream.thinking.complete", data: { sourceKey: "sk1", durationMs: 100 } },
      { ...base, type: "stream.permission.requested", data: { requestId: "r1", toolName: "bash", question: "allow?", options: [{ label: "Yes", value: "yes" }] } },
      { ...base, type: "stream.human_input_required", data: { requestId: "r1", question: "input?", nodeId: "n1" } },
      { ...base, type: "stream.usage", data: { inputTokens: 100, outputTokens: 50 } },
      { ...base, type: "stream.skill.invoked", data: { skillName: "test-skill" } },
    ];

    for (const evt of lifecycleEvents) {
      consumer.processBatch([evt]);
    }

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
