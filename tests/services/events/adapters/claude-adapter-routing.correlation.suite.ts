// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import type { AgentEvent, AgentMessage, EventType } from "@/services/agents/types.ts";
import { collectEvents, createMockClient, createMockSession, mockAsyncStream } from "./adapter-test-support.ts";

describe("ClaudeStreamAdapter", () => {
  let bus: EventBus;
  let adapter: ClaudeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123");
  });

  test("normalizes OpenCode subagent correlation IDs to the canonical tool ID", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);
    const streamPromise = adapter.startStreaming(session, "test", { runId: 100, messageId: "msg-2" });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: new Date().toISOString(),
      data: { toolName: "Task", toolInput: { description: "Investigate" }, toolUseId: "tool-use-123", toolCallId: "call-456" },
    } as AgentEvent);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-001", subagentType: "explore", task: "Find files", toolCallId: "call-456" },
    } as AgentEvent);

    await streamPromise;

    expect(events.filter((e) => e.type === "stream.agent.start")[0].data.sdkCorrelationId).toBe("tool-use-123");
  });

  test("agent-only streams publish synthetic foreground agent lifecycle with tool progress", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);
    const streamPromise = adapter.startStreaming(session, "Investigate auth retries", {
      runId: 101,
      messageId: "msg-agent-only",
      agent: "debugger",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "bash", toolInput: { command: "rg auth" }, toolUseId: "tool-agent-only-1" },
    } as AgentEvent);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "bash", toolUseId: "tool-agent-only-1", toolResult: "ok", success: true },
    } as AgentEvent);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents[0].data.agentType).toBe("debugger");
    expect(agentStartEvents[0].data.task).toBe("Investigate auth retries");
  });

  test("agent-only streams attribute early reasoning to the synthetic foreground agent", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);
    const streamPromise = adapter.startStreaming(session, "Explain BM25", {
      runId: 102,
      messageId: "msg-agent-only-reasoning",
      agent: "codebase-online-researcher",
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { delta: "Need to invoke the research agent first", reasoningId: "reasoning-agent-only-1" },
    } as AgentEvent<"reasoning.delta">);
    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { reasoningId: "reasoning-agent-only-1", content: "Need to invoke the research agent first" },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    const syntheticAgentStart = events.find(
      (e) => e.type === "stream.agent.start" && e.data.agentType === "codebase-online-researcher",
    );
    const syntheticAgentId = syntheticAgentStart?.data.agentId;
    expect(events.find((e) => e.type === "stream.thinking.delta" && e.data.sourceKey === "reasoning-agent-only-1")?.data.agentId).toBe(syntheticAgentId);
    expect(events.find((e) => e.type === "stream.thinking.complete" && e.data.sourceKey === "reasoning-agent-only-1")?.data.agentId).toBe(syntheticAgentId);
  });

  test("uses parent_tool_use_id fallback to hydrate subagent task metadata", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);
    const streamPromise = adapter.startStreaming(session, "test", { runId: 102, messageId: "msg-parent-fallback" });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Agent", toolInput: { description: "Locate sub-agent tree rendering" }, toolUseId: "tool-parent-1" },
    } as AgentEvent);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-parent-fallback",
        subagentType: "codebase-locator",
        task: "codebase-locator",
        toolCallId: "uuid-1",
        parent_tool_use_id: "tool-parent-1",
      },
    } as AgentEvent);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents[0].data.task).toBe("Locate sub-agent tree rendering");
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("tool-parent-1");
  });

  test("attributes child tool events via parent_tool_call_id correlation", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);
    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 102,
      messageId: "msg-parent-call-correlation",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Agent", toolInput: { description: "Correlate by parent call id" }, toolUseId: "tool-parent-call-1" },
    } as AgentEvent);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-parent-call-1",
        subagentType: "codebase-locator",
        task: "codebase-locator",
        toolCallId: "subagent-call-1",
        parent_tool_call_id: "tool-parent-call-1",
      },
    } as AgentEvent);
    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "WebSearch",
        toolInput: { query: "sync parallel agents" },
        toolUseId: "inner-tool-1",
        parent_tool_call_id: "tool-parent-call-1",
      },
    } as AgentEvent);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "WebSearch", toolUseId: "inner-tool-1", toolResult: "ok", success: true, parent_tool_call_id: "tool-parent-call-1" },
    } as AgentEvent);

    await streamPromise;

    expect(events.find((e) => e.type === "stream.tool.start" && e.data.toolId === "inner-tool-1")?.data.parentAgentId).toBe("tool-parent-call-1");
    expect(events.find((e) => e.type === "stream.tool.complete" && e.data.toolId === "inner-tool-1")?.data.parentAgentId).toBe("tool-parent-call-1");
  });

  test("falls back to pending task tool ordering when subagent.start lacks parent correlation", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]), client);
    const streamPromise = adapter.startStreaming(session, "test", { runId: 103, messageId: "msg-pending-fallback" });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolName: "Agent", toolInput: { description: "Find missing sub-agent metadata wiring" }, toolUseId: "tool-pending-1" },
    } as AgentEvent);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { subagentId: "agent-pending-fallback", subagentType: "debugger", task: "debugger", toolCallId: "unmapped-call-id" },
    } as AgentEvent);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents[0].data.task).toBe("Find missing sub-agent metadata wiring");
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("tool-pending-1");
  });
});
