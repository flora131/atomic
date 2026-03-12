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

describe("OpenCodeStreamAdapter child-session progress and buffering", () => {
  let bus: EventBus;
  let adapter: OpenCodeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new OpenCodeStreamAdapter(bus, "test-session-123");
  });

  test("drops OpenCode child-session text even when task metadata identifies the child session before subagent.start", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-task-session-text",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Research TUI UX practices",
          subagent_type: "codebase-online-researcher",
        },
        toolMetadata: { sessionId: "child-session-text-prestart" },
        toolUseId: "task-tool-text-prestart",
      },
    } as AgentEvent<"tool.start">);
    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: "child-session-text-prestart",
      timestamp: Date.now(),
      data: { delta: "child task response", contentType: "text" },
    } as AgentEvent<"message.delta">);

    await streamPromise;

    expect(
      events.some(
        (event) =>
          event.type === "stream.text.delta"
          && event.data.delta === "child task response",
      ),
    ).toBe(false);
  });

  test("does not emit synthetic task-agent progress updates when child telemetry is missing", async () => {
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

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolInput: {
          description: "Locate TUI code",
          subagent_type: "codebase-locator",
        },
        toolUseId: "task-tool-fallback-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "task",
        toolResult: "done",
        success: true,
        toolUseId: "task-tool-fallback-1",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    expect(
      events.some(
        (event) =>
          event.type === "stream.agent.start" || event.type === "stream.agent.update",
      ),
    ).toBe(false);
  });

  test("buffers early tool events before subagent.start and replays tool usage updates", async () => {
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

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "glob",
        toolInput: { pattern: "**/*.ts" },
        toolUseId: "early-tool-open-1",
        parentId: "agent-early-open-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-early-open-1",
        subagentType: "explore",
        task: "Find TypeScript files",
        toolCallId: "task-call-early-open-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const updates = events.filter(
      (event) =>
        event.type === "stream.agent.update"
        && event.data.agentId === "agent-early-open-1",
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(
      updates.some(
        (event) => event.data.currentTool === "glob" && event.data.toolUses === 1,
      ),
    ).toBe(true);
  });

  test("does not double-count subagent tool usage for repeated tool.start lifecycle updates", async () => {
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
        subagentId: "agent-repeat-start-1",
        subagentType: "debugger",
        task: "Investigate repeated tool starts",
        toolCallId: "task-repeat-start-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo pending", state: "pending" },
        toolCallId: "inner-repeat-start-1",
        parentId: "agent-repeat-start-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo running", state: "running" },
        toolCallId: "inner-repeat-start-1",
        parentId: "agent-repeat-start-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolResult: "ok",
        success: true,
        toolCallId: "inner-repeat-start-1",
        parentId: "agent-repeat-start-1",
      },
    } as AgentEvent<"tool.complete">);
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { subagentId: "agent-repeat-start-1", success: true, result: "done" },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    expect(
      events.filter(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "inner-repeat-start-1",
      ),
    ).toHaveLength(2);

    const agentUpdateEvents = events.filter(
      (event) =>
        event.type === "stream.agent.update"
        && event.data.agentId === "agent-repeat-start-1",
    );
    expect(
      agentUpdateEvents.filter((event) => event.data.currentTool === "bash").length,
    ).toBe(1);
    expect(
      agentUpdateEvents.some(
        (event) =>
          event.data.currentTool === undefined && event.data.toolUses === 1,
      ),
    ).toBe(true);
    expect(
      Math.max(...agentUpdateEvents.map((event) => event.data.toolUses ?? 0)),
    ).toBe(1);
  });

  test("publishes subagent progress updates on tool.partial_result", async () => {
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
        subagentId: "agent-partial-1",
        subagentType: "debugger",
        task: "Track live tool progress",
        toolCallId: "task-partial-1",
        subagentSessionId: "child-session-partial-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-partial-1",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "tail -f logs" },
        toolCallId: "inner-partial-1",
        parentId: "agent-partial-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.partial_result" as EventType, {
      type: "tool.partial_result",
      sessionId: "child-session-partial-1",
      timestamp: Date.now(),
      data: { toolCallId: "inner-partial-1", partialOutput: "line 1" },
    } as AgentEvent<"tool.partial_result">);

    await streamPromise;

    const progressUpdates = events.filter(
      (event) =>
        event.type === "stream.agent.update"
        && event.data.agentId === "agent-partial-1"
        && event.data.currentTool === "bash",
    );
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    expect(progressUpdates.some((event) => event.data.toolUses === 1)).toBe(true);
  });
});
