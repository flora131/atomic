// @ts-nocheck

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import type { Session, AgentMessage, AgentEvent, EventType } from "@/services/agents/types.ts";
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
  test("publishes tool start events from stream (tool_use)", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      {
        type: "tool_use" as any,
        content: "",
        id: "tool-abc",
        name: "bash",
        input: { command: "ls" },
      } as any,
      { type: "text", content: "done" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, {});

    await adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    const toolStartEvents = events.filter((e) => e.type === "stream.tool.start");
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.toolName).toBe("bash");
    expect(toolStartEvents[0].data.toolId).toBe("tool-abc");
    expect(toolStartEvents[0].data.toolInput).toEqual({ command: "ls" });
    expect(toolStartEvents[0].runId).toBe(100);
  });

  test("publishes tool complete events from stream (tool_result)", async () => {
    const events = collectEvents(bus);

    const chunks: AgentMessage[] = [
      {
        type: "tool_result" as any,
        content: "file1.txt\nfile2.txt",
        tool_use_id: "tool-abc",
        toolName: "bash",
        is_error: false,
      } as any,
      { type: "text", content: "done" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, {});

    await adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    const toolCompleteEvents = events.filter((e) => e.type === "stream.tool.complete");
    expect(toolCompleteEvents.length).toBe(1);
    expect(toolCompleteEvents[0].data.toolName).toBe("bash");
    expect(toolCompleteEvents[0].data.toolId).toBe("tool-abc");
    expect(toolCompleteEvents[0].data.toolResult).toBe("file1.txt\nfile2.txt");
    expect(toolCompleteEvents[0].data.success).toBe(true);
    expect(toolCompleteEvents[0].runId).toBe(100);
  });

  test("prefers client hook tool events over stream chunk tool events to avoid duplicate unscoped tools", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [
      {
        type: "tool_use",
        content: {
          name: "WebSearch",
          input: { query: "query" },
          toolUseId: "tool-dup-1",
        },
      } as unknown as AgentMessage,
      {
        type: "tool_result",
        content: "ok",
        tool_use_id: "tool-dup-1",
        toolName: "WebSearch",
      } as unknown as AgentMessage,
      { type: "text", content: "done" },
    ];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolInput: { query: "query" },
        toolUseId: "tool-dup-1",
        parentAgentId: "agent-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolUseId: "tool-dup-1",
        toolResult: "ok",
        success: true,
        parentAgentId: "agent-1",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const toolStartEvents = events.filter((e) => e.type === "stream.tool.start" && e.data.toolId === "tool-dup-1");
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.parentAgentId).toBe("agent-1");

    const toolCompleteEvents = events.filter((e) => e.type === "stream.tool.complete" && e.data.toolId === "tool-dup-1");
    expect(toolCompleteEvents.length).toBe(1);
    expect(toolCompleteEvents[0].data.parentAgentId).toBe("agent-1");
  });

  test("publishes agent start events from subagent.start hook", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    // Simulate subagent.start hook event from the SDK
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: new Date().toISOString(),
      data: {
        subagentId: "agent-001",
        subagentType: "explore",
        task: "Find files",
        toolUseID: "tool_use_123",
      },
    } as AgentEvent);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.agentId).toBe("tool_use_123");
    expect(agentStartEvents[0].data.agentType).toBe("explore");
    expect(agentStartEvents[0].data.task).toBe("Find files");
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("tool_use_123");
    expect(agentStartEvents[0].runId).toBe(100);
  });

  test("prefers Task description over subagent name on subagent.start", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-claude-task-description",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-description-priority-1",
        subagentType: "codebase-locator",
        task: "codebase-locator",
        description: "Locate sub-agent tree label derivation",
        toolUseID: "tool-use-description-priority-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvent = events.find(
      (e) => e.type === "stream.agent.start" && e.data.agentId === "tool-use-description-priority-1",
    );
    expect(agentStartEvent?.data.task).toBe("Locate sub-agent tree label derivation");
  });

  test("publishes subagent progress updates on tool.partial_result", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-partial-claude-1",
        subagentType: "explore",
        task: "Watch streaming tool output",
        toolUseID: "tool-use-parent-claude-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "tail -f logs" },
        toolCallId: "inner-partial-claude-1",
        parentId: "agent-partial-claude-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.partial_result" as EventType, {
      type: "tool.partial_result",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolCallId: "inner-partial-claude-1",
        partialOutput: "line 1",
      },
    } as AgentEvent<"tool.partial_result">);

    await streamPromise;

    const progressUpdates = events.filter(
      (e) =>
        e.type === "stream.agent.update"
        && e.data.agentId === "tool-use-parent-claude-1"
        && e.data.currentTool === "bash",
    );
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    expect(progressUpdates.some((e) => e.data.toolUses === 1)).toBe(true);
  });

});
