// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import type { AgentEvent, EventType } from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("OpenCodeStreamAdapter child-session core routing", () => {
  let bus: EventBus;
  let adapter: OpenCodeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new OpenCodeStreamAdapter(bus, "test-session-123");
  });

  test("streams child-session tool events for registered subagents", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-1",
        subagentType: "general-purpose",
        toolCallId: "task-tool-1",
        subagentSessionId: "child-session-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-1",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo hello" },
        toolUseId: "child-tool-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "child-session-1",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolResult: "ok",
        success: true,
        toolUseId: "child-tool-1",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const childAgentStart = events.find(
      (event) => event.type === "stream.agent.start" && event.data.agentId === "agent-child-1",
    );
    const childToolStart = events.find(
      (event) => event.type === "stream.tool.start" && event.data.toolId === "child-tool-1",
    );
    const childToolComplete = events.find(
      (event) => event.type === "stream.tool.complete" && event.data.toolId === "child-tool-1",
    );

    expect(childAgentStart?.resolvedAgentId).toBe("agent-child-1");
    expect(childToolStart?.resolvedAgentId).toBe("agent-child-1");
    expect(childToolStart?.isSubagentTool).toBe(true);
    expect(childToolComplete?.resolvedAgentId).toBe("agent-child-1");
    expect(childToolComplete?.isSubagentTool).toBe(true);

    expect(
      childToolStart?.data.parentAgentId,
    ).toBe("agent-child-1");
    expect(
      childToolComplete?.data.parentAgentId,
    ).toBe("agent-child-1");

    const updates = events.filter(
      (event) =>
        event.type === "stream.agent.update" && event.data.agentId === "agent-child-1",
    );
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.every((event) => event.resolvedAgentId === "agent-child-1")).toBe(true);
    expect(
      updates.some(
        (event) => event.data.currentTool === "bash" && event.data.toolUses === 1,
      ),
    ).toBe(true);
    expect(
      updates.some(
        (event) =>
          event.data.currentTool === undefined && event.data.toolUses === 1,
      ),
    ).toBe(true);
  });

  test("drops unknown child-session tool events without a real OpenCode mapping", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-only-1",
        subagentType: "researcher",
        task: "Investigate UI state",
        toolCallId: "task-call-only-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-unknown",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolInput: { query: "tui patterns" },
        toolUseId: "child-tool-unknown-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    expect(
      events.some(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "child-tool-unknown-1",
      ),
    ).toBe(false);
  });

  test("accepts subagent.update from unknown child session when subagent is already known", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-subagent-update-child-session",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-known-1",
        subagentType: "codebase-locator",
        toolCallId: "task-call-known-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("subagent.update" as EventType, {
      type: "subagent.update",
      sessionId: "child-session-unowned-1",
      timestamp: Date.now(),
      data: { subagentId: "agent-known-1", currentTool: "glob", toolUses: 1 },
    } as AgentEvent<"subagent.update">);

    await streamPromise;

    expect(
      events.some(
        (event) =>
          event.type === "stream.agent.update"
          && event.data.agentId === "agent-known-1"
          && event.data.currentTool === "glob"
          && event.data.toolUses === 1,
      ),
    ).toBe(true);
  });

  test("drops OpenCode child-session message deltas from the visible parent transcript", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-child-session-delta",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-text-1",
        subagentType: "researcher",
        task: "Inspect event routing",
        toolCallId: "task-call-child-text-1",
        subagentSessionId: "child-session-text-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: "child-session-text-1",
      timestamp: Date.now(),
      data: { delta: "child session text", contentType: "text" },
    } as AgentEvent<"message.delta">);
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: "child-session-text-1",
      timestamp: Date.now(),
      data: {},
    } as AgentEvent<"message.complete">);

    await streamPromise;

    expect(
      events.some(
        (event) =>
          event.type === "stream.text.delta"
          && event.data.delta === "child session text",
      ),
    ).toBe(false);
    expect(
      events.find(
        (event) =>
          event.type === "stream.text.complete"
          && event.data.fullText === "child session text",
      ),
    ).toBeUndefined();
  });
});
