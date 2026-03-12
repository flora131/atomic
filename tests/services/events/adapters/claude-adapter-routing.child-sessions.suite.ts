// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import type { AgentEvent, AgentMessage, EventType } from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("ClaudeStreamAdapter", () => {
  let bus: EventBus;
  let adapter: ClaudeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123");
  });

  test("accepts child-session tool events when parentAgent correlation is present", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-session-1",
        subagentType: "debugger",
        task: "Investigate child session event routing",
        toolUseID: "tool-use-child-parent-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-1",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo ok" },
        toolCallId: "child-tool-1",
        parentId: "agent-child-session-1",
      },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const toolStart = events.find(
      (e) => e.type === "stream.tool.start" && e.data.toolId === "child-tool-1",
    );
    expect(toolStart).toBeDefined();
    expect(toolStart?.data.parentAgentId).toBe("tool-use-child-parent-1");
  });

  test("routes nested child-session tool and streaming updates to the correct subagent", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);

    const streamPromise = adapter.startStreaming(session, "spawn nested researchers", {
      runId: 100,
      messageId: "msg-nested-child-session",
      agent: "codebase-online-researcher",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Agent", toolInput: { description: "child A" }, toolUseId: "task-tool-a" },
    } as AgentEvent<"tool.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Agent", toolInput: { description: "child B" }, toolUseId: "task-tool-b" },
    } as AgentEvent<"tool.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Agent", toolInput: { description: "child C" }, toolUseId: "task-tool-c" },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-a",
        subagentType: "researcher",
        task: "child A",
        toolCallId: "task-tool-a",
        subagentSessionId: "child-session-a",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-b",
        subagentType: "researcher",
        task: "child B",
        toolCallId: "task-tool-b",
        subagentSessionId: "child-session-b",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-child-c",
        subagentType: "researcher",
        task: "child C",
        toolCallId: "task-tool-c",
        subagentSessionId: "child-session-c",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-b",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolInput: { query: "nested subagent tree" },
        toolUseId: "child-b-tool-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.partial_result" as EventType, {
      type: "tool.partial_result",
      sessionId: "child-session-b",
      timestamp: Date.now(),
      data: { toolCallId: "child-b-tool-1", partialOutput: "streaming..." },
    } as AgentEvent<"tool.partial_result">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "child-session-b",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "child-b-tool-1",
        toolResult: { ok: true },
        success: true,
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    expect(
      events.find((e) => e.type === "stream.tool.start" && e.data.toolId === "child-b-tool-1")?.data.parentAgentId,
    ).toBe("task-tool-b");
    expect(
      events.find((e) => e.type === "stream.tool.partial_result" && e.data.toolCallId === "child-b-tool-1")?.data.parentAgentId,
    ).toBe("task-tool-b");
    expect(
      events.find((e) => e.type === "stream.tool.complete" && e.data.toolId === "child-b-tool-1")?.data.parentAgentId,
    ).toBe("task-tool-b");
  });

  test("attributes child-session tools via background fallback when parent correlation is unresolved", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 102,
      messageId: "msg-child-session-bg-fallback",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Background A", run_in_background: true },
        toolUseId: "task-tool-bg-a",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Background B", run_in_background: true },
        toolUseId: "task-tool-bg-b",
      },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-bg-a",
        subagentType: "research",
        task: "Background A",
        toolUseID: "task-tool-bg-a",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-bg-b",
        subagentType: "research",
        task: "Background B",
        toolUseID: "task-tool-bg-b",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "child-session-unknown",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "child-bg-tool-1",
        toolInput: { query: "tree sync leakage" },
        parentToolUseId: "missing-parent-correlation",
      },
    } as AgentEvent<"tool.start">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "child-session-unknown",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "child-bg-tool-1",
        toolResult: { ok: true },
        success: true,
        parentToolUseId: "missing-parent-correlation",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    expect(
      events.find((e) => e.type === "stream.tool.start" && e.data.toolId === "child-bg-tool-1")?.data.parentAgentId,
    ).toBe("task-tool-bg-a");
    expect(
      events.find((e) => e.type === "stream.tool.complete" && e.data.toolId === "child-bg-tool-1")?.data.parentAgentId,
    ).toBe("task-tool-bg-a");
  });
});
