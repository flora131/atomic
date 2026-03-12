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

describe("CopilotStreamAdapter nested routing", () => {
  let bus: EventBus;
  let client: CodingAgentClient;
  let adapter: CopilotStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    client = createMockClient();
    adapter = new CopilotStreamAdapter(bus, client);
  });

  test("sub-agent message.complete with parentToolCallId emits inner tool rows", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 504,
      messageId: "msg-skip-child",
      knownAgentNames: ["general-purpose"],
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "parent-task-1",
        subagentType: "general-purpose",
        toolCallId: "parent-task-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        parentToolCallId: "parent-task-1",
        toolRequests: [
          {
            toolCallId: "child-tool-1",
            name: "Read",
            arguments: { file_path: "test.ts" },
          },
        ],
      },
    } as AgentEvent<"message.complete">);
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {},
    } as AgentEvent<"message.complete">);

    await streamPromise;

    const childToolStart = events.find(
      (event) =>
        event.type === "stream.tool.start" && event.data.toolId === "child-tool-1",
    );
    expect(childToolStart?.data.parentAgentId).toBe("parent-task-1");
    expect(
      events.filter((event) => event.type === "stream.text.complete"),
    ).toHaveLength(0);
  });

  test("replays child tool rows when Claude message.complete arrives before subagent.start", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 511,
      messageId: "msg-early-child-tool",
      knownAgentNames: ["codebase-online-researcher"],
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        parentToolCallId: "parent-task-early-1",
        toolRequests: [
          {
            toolCallId: "child-tool-early-1",
            name: "Read",
            arguments: { file_path: "docs/claude-agent-sdk.md" },
          },
        ],
      },
    } as AgentEvent<"message.complete">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "parent-task-early-1",
        subagentType: "codebase-online-researcher",
        toolCallId: "parent-task-early-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const childToolStart = events.find(
      (event) =>
        event.type === "stream.tool.start"
        && event.data.toolId === "child-tool-early-1",
    );
    expect(childToolStart?.data.parentAgentId).toBe("parent-task-early-1");

    const agentUpdateEvents = events.filter(
      (event) =>
        event.type === "stream.agent.update"
        && event.data.agentId === "parent-task-early-1",
    );
    expect(agentUpdateEvents.some((event) => event.data.toolUses === 1)).toBe(true);
  });

  test("maps subagent.update events and sub-agent message deltas", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 510,
      messageId: "msg-subagent-delta",
      knownAgentNames: ["codebase-analyzer"],
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-sub-1",
        subagentType: "codebase-analyzer",
        toolCallId: "tool-call-agent-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("subagent.update" as EventType, {
      type: "subagent.update",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-sub-1",
        currentTool: "grep",
        toolUses: 2,
      },
    } as AgentEvent<"subagent.update">);
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "child chunk",
        contentType: "text",
        parentToolCallId: "tool-call-agent-1",
      },
    } as AgentEvent<"message.delta">);

    await streamPromise;

    expect(
      events.some(
        (event) =>
          event.type === "stream.agent.update"
          && event.data.agentId === "agent-sub-1",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "stream.text.delta"
          && event.data.delta === "child chunk"
          && event.data.agentId === "agent-sub-1",
      ),
    ).toBe(true);
  });
});
