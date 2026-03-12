// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import type {
  AgentEvent,
  CodingAgentClient,
  EventType,
} from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("CopilotStreamAdapter nested lifecycle", () => {
  let bus: EventBus;
  let client: CodingAgentClient;
  let adapter: CopilotStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    client = createMockClient();
    adapter = new CopilotStreamAdapter(bus, client);
  });

  test("full sub-agent lifecycle with agent-named tool", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 503,
      messageId: "msg-lifecycle",
      knownAgentNames: ["codebase-analyzer"],
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "lifecycle-tool-1",
            name: "codebase-analyzer",
            arguments: {
              prompt: "Check types",
              subagent_type: "codebase-analyzer",
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
        subagentId: "lifecycle-tool-1",
        subagentType: "codebase-analyzer",
        task: "Codebase analyzer agent",
        toolCallId: "lifecycle-tool-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        parentToolCallId: "lifecycle-tool-1",
        toolRequests: [
          {
            toolCallId: "inner-tool-1",
            name: "Grep",
            arguments: { pattern: "interface" },
          },
        ],
      },
    } as AgentEvent<"message.complete">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "Grep",
        toolInput: { pattern: "interface" },
        toolCallId: "inner-tool-1",
        parentId: "lifecycle-tool-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "Grep",
        toolResult: "found 5 matches",
        success: true,
        toolCallId: "inner-tool-1",
        parentId: "lifecycle-tool-1",
      },
    } as AgentEvent<"tool.complete">);
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "lifecycle-tool-1",
        success: true,
        result: "Types look good",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    const toolStartEvents = events.filter((event) => event.type === "stream.tool.start");
    expect(toolStartEvents).toHaveLength(2);

    const grepToolStart = toolStartEvents.find(
      (event) => event.data.toolName === "Grep",
    );
    expect(grepToolStart?.data.parentAgentId).toBe("lifecycle-tool-1");

    const agentStartEvents = events.filter(
      (event) =>
        event.type === "stream.agent.start"
        && !event.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents).toHaveLength(1);
    expect(agentStartEvents[0].data.task).toBe("Check types");

    const agentUpdateEvents = events.filter(
      (event) => event.type === "stream.agent.update",
    );
    expect(agentUpdateEvents.length).toBeGreaterThanOrEqual(1);
    expect(agentUpdateEvents[agentUpdateEvents.length - 1].data.toolUses).toBeGreaterThanOrEqual(1);

    const agentCompleteEvents = events.filter(
      (event) => event.type === "stream.agent.complete",
    );
    expect(agentCompleteEvents).toHaveLength(1);
    expect(agentCompleteEvents[0].data.success).toBe(true);
  });

  test("nested sub-agent spawned by another sub-agent is suppressed from tree", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 505,
      messageId: "msg-nested",
      knownAgentNames: ["codebase-analyzer"],
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "tc-outer",
            name: "codebase-analyzer",
            arguments: { prompt: "Analyze repo" },
          },
        ],
      },
    } as AgentEvent<"message.complete">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "tc-outer",
        subagentType: "codebase-analyzer",
        task: "Analyze repo",
        toolCallId: "tc-outer",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: { prompt: "Explore codebase" },
        toolCallId: "tc-inner",
        parentToolCallId: "tc-outer",
      },
    } as AgentEvent<"tool.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "tc-inner",
        subagentType: "explore",
        task: "Fast codebase exploration",
        toolCallId: "tc-inner",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("subagent.update" as EventType, {
      type: "subagent.update",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "tc-inner",
        currentTool: "grep",
        toolUses: 1,
      },
    } as AgentEvent<"subagent.update">);
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "tc-inner",
        success: true,
        result: "nested done",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (event) =>
        event.type === "stream.agent.start"
        && !event.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents).toHaveLength(1);
    expect(agentStartEvents[0].data.agentType).toBe("codebase-analyzer");
    expect(
      agentStartEvents.filter((event) => event.data.agentType === "explore"),
    ).toHaveLength(0);

    expect(
      events.filter(
        (event) =>
          event.type === "stream.agent.update" && event.data.agentId === "tc-inner",
      ),
    ).toHaveLength(0);
    expect(
      events.filter(
        (event) =>
          event.type === "stream.agent.complete" && event.data.agentId === "tc-inner",
      ),
    ).toHaveLength(0);
  });
});
