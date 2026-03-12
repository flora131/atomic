// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import type { AgentEvent, EventType } from "@/services/agents/types.ts";
import { collectEvents, createMockClient, createMockSession, mockAsyncStream } from "./adapter-test-support.ts";

describe("ClaudeStreamAdapter", () => {
  let bus: EventBus;
  let adapter: ClaudeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123");
  });

  test("attributes unscoped main-session tool events to the sole active subagent", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);
    const streamPromise = adapter.startStreaming(session, "test", { runId: 100, messageId: "msg-2" });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-unscoped-1",
        subagentType: "Explore",
        task: "Explore repository",
        toolUseID: "tool-parent-unscoped-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Bash", toolInput: { command: "ls -la" }, toolUseId: "tool-unscoped-1" },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    expect(
      events.find((e) => e.type === "stream.tool.start" && e.data.toolId === "tool-unscoped-1")?.data.parentAgentId,
    ).toBe("tool-parent-unscoped-1");
  });

  test("attributes parallel unscoped tool events via TaskOutput task_id and active tool context", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);
    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 101,
      messageId: "msg-parallel-taskoutput",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { subagentId: "agent-parallel-a", subagentType: "research", task: "Research A", toolUseID: "task-tool-a" },
    } as AgentEvent<"subagent.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { subagentId: "agent-parallel-b", subagentType: "research", task: "Research B", toolUseID: "task-tool-b" },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "TaskOutput", toolUseId: "task-output-1", toolInput: { task_id: "agent-parallel-a", block: true } },
    } as AgentEvent<"tool.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "WebSearch", toolUseId: "websearch-1", toolInput: { query: "parallel attribution fallback" } },
    } as AgentEvent<"tool.start">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "WebSearch", toolUseId: "websearch-1", toolResult: "ok", success: true },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    expect(events.find((e) => e.type === "stream.tool.start" && e.data.toolId === "task-output-1")?.data.parentAgentId).toBe("task-tool-a");
    expect(events.find((e) => e.type === "stream.tool.start" && e.data.toolId === "websearch-1")?.data.parentAgentId).toBe("task-tool-a");
    expect(events.find((e) => e.type === "stream.tool.complete" && e.data.toolId === "websearch-1")?.data.parentAgentId).toBe("task-tool-a");
  });

  test("attributes pre-TaskOutput unscoped tools to active background subagent fallback", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);
    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 102,
      messageId: "msg-parallel-pre-taskoutput",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Agent", toolInput: { description: "Background A", run_in_background: true }, toolUseId: "task-tool-bg-a" },
    } as AgentEvent<"tool.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Agent", toolInput: { description: "Background B", run_in_background: true }, toolUseId: "task-tool-bg-b" },
    } as AgentEvent<"tool.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { subagentId: "agent-bg-a", subagentType: "research", task: "Background A", toolUseID: "task-tool-bg-a" },
    } as AgentEvent<"subagent.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { subagentId: "agent-bg-b", subagentType: "research", task: "Background B", toolUseID: "task-tool-bg-b" },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Read", toolUseId: "pre-taskoutput-read-1", toolInput: { file_path: "README.md" } },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    expect(events.find((e) => e.type === "stream.tool.start" && e.data.toolId === "pre-taskoutput-read-1")?.data.parentAgentId).toBe("task-tool-bg-a");
  });

  test("preserves parentAgentId on orphaned tool completions during cleanup", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);
    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 103,
      messageId: "msg-orphan-parent-preservation",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { subagentId: "agent-orphan-1", subagentType: "Explore", task: "Explore repository", toolUseID: "tool-parent-orphan-1" },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Bash", toolInput: { command: "ls -la" }, toolUseId: "tool-orphan-1" },
    } as AgentEvent<"tool.start">);

    await streamPromise;

    const orphanedComplete = events.find(
      (e) => e.type === "stream.tool.complete" && e.data.toolId === "tool-orphan-1" && e.data.error === "Tool execution aborted",
    );
    expect(orphanedComplete?.data.parentAgentId).toBe("tool-parent-orphan-1");
  });
});
