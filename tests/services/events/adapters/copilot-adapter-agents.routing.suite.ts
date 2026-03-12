// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import type { AgentEvent, CodingAgentClient, EventType } from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("CopilotStreamAdapter subagent routing", () => {
  let bus: EventBus;
  let client: CodingAgentClient;
  let adapter: CopilotStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    client = createMockClient();
    adapter = new CopilotStreamAdapter(bus, client);
  });

  test("buffers early tool events before subagent.started and replays them", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "glob",
        toolInput: { pattern: "**/*.ts" },
        toolCallId: "early-tool-1",
        parentToolCallId: "task-call-3",
      },
    } as AgentEvent<"tool.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-3",
        subagentType: "Explore",
        task: "Find TypeScript files",
        toolCallId: "task-call-3",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const updateEvents = events.filter(
      (event) => event.type === "stream.agent.update",
    );
    expect(updateEvents.length).toBeGreaterThanOrEqual(1);
    expect(updateEvents[0].data.agentId).toBe("sub-3");
    expect(updateEvents[0].data.toolUses).toBe(1);
    expect(updateEvents[0].data.currentTool).toBe("glob");
  });

  test("replays parentToolCallId tool lifecycle into the subagent tree", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-parent-tool-call-replay",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "glob",
        toolInput: { pattern: "**/*.ts" },
        toolCallId: "early-child-tool-1",
        parentToolCallId: "task-call-parent-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "glob",
        toolResult: ["src/app.ts"],
        success: true,
        toolCallId: "early-child-tool-1",
        parentToolCallId: "task-call-parent-1",
      },
    } as AgentEvent<"tool.complete">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-parent-tool-call-1",
        subagentType: "Explore",
        task: "Find TypeScript files",
        toolCallId: "task-call-parent-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "early-child-tool-1",
      )?.data.parentAgentId,
    ).toBe("sub-parent-tool-call-1");
    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.complete"
          && event.data.toolId === "early-child-tool-1",
      )?.data.parentAgentId,
    ).toBe("sub-parent-tool-call-1");
    expect(
      events.filter(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "early-child-tool-1"
          && event.data.parentAgentId === undefined,
      ),
    ).toHaveLength(0);
  });

  test("publishes subagent progress updates on tool.partial_result", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-partial-1",
        subagentType: "Explore",
        task: "Watch streaming tool output",
        toolCallId: "task-call-partial-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "tail -f logs" },
        toolCallId: "inner-tool-partial-1",
        parentToolCallId: "task-call-partial-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.partial_result" as EventType, {
      type: "tool.partial_result",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { toolCallId: "inner-tool-partial-1", partialOutput: "line 1" },
    } as AgentEvent<"tool.partial_result">);

    await streamPromise;

    const progressUpdates = events.filter(
      (event) =>
        event.type === "stream.agent.update"
        && event.data.agentId === "sub-partial-1"
        && event.data.currentTool === "bash",
    );
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    expect(progressUpdates.some((event) => event.data.toolUses === 1)).toBe(true);
  });

  test("defaults to foreground when task tool has no mode field", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "task-call-4",
            name: "Task",
            arguments: {
              description: "Analyze dependencies",
              subagent_type: "general-purpose",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-4",
        subagentType: "general-purpose",
        task: "General-purpose agent",
        toolCallId: "task-call-4",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (event) =>
        event.type === "stream.agent.start"
        && !event.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents).toHaveLength(1);
    expect(agentStartEvents[0].data.isBackground).toBe(false);
    expect(agentStartEvents[0].data.task).toBe("Analyze dependencies");
  });
});
