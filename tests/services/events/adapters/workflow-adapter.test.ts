// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { WorkflowEventAdapter } from "@/services/events/adapters/workflow-adapter.ts";
import { collectEvents } from "./adapter-test-support.ts";

describe("WorkflowEventAdapter", () => {
  let bus: EventBus;
  let adapter: WorkflowEventAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new WorkflowEventAdapter(bus, "workflow-session-1", 1);
  });

  test("publishStepStart() publishes workflow.step.start event", () => {
    const events = collectEvents(bus);

    adapter.publishStepStart("wf-001", "analyze-code", "node-1");

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("workflow.step.start");
    expect(events[0].sessionId).toBe("workflow-session-1");
    expect(events[0].runId).toBe(1);
    expect(events[0].data.workflowId).toBe("wf-001");
    expect(events[0].data.nodeId).toBe("node-1");
    expect(events[0].data.nodeName).toBe("analyze-code");
  });

  test("publishStepComplete() publishes workflow.step.complete with status", () => {
    const events = collectEvents(bus);

    adapter.publishStepComplete("wf-001", "analyze-code", "node-1", "success", { output: "done" });

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("workflow.step.complete");
    expect(events[0].data.workflowId).toBe("wf-001");
    expect(events[0].data.nodeId).toBe("node-1");
    expect(events[0].data.nodeName).toBe("analyze-code");
    expect(events[0].data.status).toBe("success");
    expect(events[0].data.result).toEqual({ output: "done" });
    expect(events[0].runId).toBe(1);
  });

  test("publishStepComplete() defaults to success status", () => {
    const events = collectEvents(bus);

    adapter.publishStepComplete("wf-001", "step", "node-1");

    expect(events[0].data.nodeName).toBe("step");
    expect(events[0].data.status).toBe("success");
  });

  test("publishTaskUpdate() publishes workflow.task.update with tasks", () => {
    const events = collectEvents(bus);

    const tasks = [
      { id: "t1", title: "First task", status: "complete" },
      { id: "t2", title: "Second task", status: "in_progress" },
      { id: "t3", title: "Third task", status: "pending" },
    ];

    adapter.publishTaskUpdate("wf-001", tasks);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("workflow.task.update");
    expect(events[0].data.workflowId).toBe("wf-001");
    expect(events[0].data.tasks).toEqual(tasks);
    expect(events[0].data.tasks.length).toBe(3);
  });

  test("publishAgentStart() publishes stream.agent.start event", () => {
    const events = collectEvents(bus);

    adapter.publishAgentStart("agent-001", "explore", "Find relevant files", false);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("stream.agent.start");
    expect(events[0].data.agentId).toBe("agent-001");
    expect(events[0].data.agentType).toBe("explore");
    expect(events[0].data.task).toBe("Find relevant files");
    expect(events[0].data.isBackground).toBe(false);
    expect(events[0].runId).toBe(1);
  });

  test("publishAgentStart() defaults isBackground to false", () => {
    const events = collectEvents(bus);

    adapter.publishAgentStart("agent-001", "task", "Run tests");

    expect(events[0].data.isBackground).toBe(false);
  });

  test("publishAgentUpdate() publishes stream.agent.update event", () => {
    const events = collectEvents(bus);

    adapter.publishAgentUpdate("agent-001", "bash", 5);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("stream.agent.update");
    expect(events[0].data.agentId).toBe("agent-001");
    expect(events[0].data.currentTool).toBe("bash");
    expect(events[0].data.toolUses).toBe(5);
  });

  test("publishAgentComplete() publishes stream.agent.complete event", () => {
    const events = collectEvents(bus);

    adapter.publishAgentComplete("agent-001", true, "Found 3 files");

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("stream.agent.complete");
    expect(events[0].data.agentId).toBe("agent-001");
    expect(events[0].data.success).toBe(true);
    expect(events[0].data.result).toBe("Found 3 files");
    expect(events[0].data.error).toBeUndefined();
  });

  test("publishAgentComplete() with error", () => {
    const events = collectEvents(bus);

    adapter.publishAgentComplete("agent-001", false, undefined, "Agent timeout");

    expect(events[0].data.success).toBe(false);
    expect(events[0].data.error).toBe("Agent timeout");
    expect(events[0].data.result).toBeUndefined();
  });

  test("all events use correct sessionId and runId", () => {
    const events = collectEvents(bus);

    adapter.publishStepStart("wf", "step", "n1");
    adapter.publishAgentStart("a1", "task", "do stuff");
    adapter.publishAgentUpdate("a1", "bash");
    adapter.publishAgentComplete("a1", true);
    adapter.publishStepComplete("wf", "step", "n1");
    adapter.publishTaskUpdate("wf", [{ id: "t1", title: "T", status: "done" }]);

    expect(events.length).toBe(6);
    for (const event of events) {
      expect(event.sessionId).toBe("workflow-session-1");
      expect(event.runId).toBe(1);
    }
  });
});
