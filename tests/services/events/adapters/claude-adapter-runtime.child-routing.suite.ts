// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import type { AgentEvent, EventType } from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("ClaudeStreamAdapter child-session routing", () => {
  let bus: EventBus;
  let adapter: ClaudeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123");
  });

  test("routes Claude child-session provider message deltas into agent-scoped text", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123", client);
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 104,
      messageId: "msg-claude-child-text",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-claude-text-1",
        subagentType: "debugger",
        task: "Investigate text routing",
        toolUseID: "task-call-claude-text-1",
        subagentSessionId: "child-session-claude-text-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "child text chunk",
        contentType: "text",
        nativeSessionId: "child-session-claude-text-1",
      },
      nativeSessionId: "child-session-claude-text-1",
    } as AgentEvent<"message.delta"> & { nativeSessionId: string });

    await streamPromise;

    expect(
      events.some(
        (event) =>
          event.type === "stream.text.delta"
          && event.data.delta === "child text chunk"
          && event.data.agentId === "task-call-claude-text-1",
      ),
    ).toBe(true);
  });

  test("routes Claude provider tool events by native child session id", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123", client);
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 104,
      messageId: "msg-claude-provider-tool-child",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-claude-tool-1",
        subagentType: "debugger",
        task: "Investigate tool routing",
        toolUseID: "task-call-claude-tool-1",
        subagentSessionId: "child-session-claude-tool-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo child tool" },
        toolUseId: "child-claude-tool-1",
      },
      nativeSessionId: "child-session-claude-tool-1",
    } as AgentEvent<"tool.start"> & { nativeSessionId: string });
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolResult: "ok",
        success: true,
        toolUseId: "child-claude-tool-1",
      },
      nativeSessionId: "child-session-claude-tool-1",
    } as AgentEvent<"tool.complete"> & { nativeSessionId: string });

    await streamPromise;

    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "child-claude-tool-1",
      )?.data.parentAgentId,
    ).toBe("task-call-claude-tool-1");
    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.complete"
          && event.data.toolId === "child-claude-tool-1",
      )?.data.parentAgentId,
    ).toBe("task-call-claude-tool-1");
    expect(
      events.filter(
        (event) =>
          event.type === "stream.agent.update"
          && event.data.agentId === "task-call-claude-tool-1",
      ).every((event) => event.resolvedAgentId === "task-call-claude-tool-1"),
    ).toBe(true);
  });

  test("routes Claude child-session tool requests to the parent tool id before subagent.start", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123", client);
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 104,
      messageId: "msg-claude-synthetic-tool-child",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: {
          description: "Investigate streaming tree",
          subagent_type: "debugger",
        },
        toolUseId: "task-call-claude-synthetic-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        parentToolCallId: "task-call-claude-synthetic-1",
        toolRequests: [
          {
            toolCallId: "child-claude-tool-synthetic-1",
            name: "bash",
            arguments: { command: "pwd" },
          },
        ],
      },
      nativeSessionId: "child-session-claude-synthetic-1",
    } as AgentEvent<"message.complete"> & { nativeSessionId: string });

    await streamPromise;

    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "child-claude-tool-synthetic-1",
      )?.data.parentAgentId,
    ).toBe("task-call-claude-synthetic-1");
  });
});
