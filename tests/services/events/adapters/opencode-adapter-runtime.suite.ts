// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import type {
  AgentMessage,
  AgentEvent,
  EventType,
} from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("OpenCodeStreamAdapter", () => {
  let bus: EventBus;
  let adapter: OpenCodeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new OpenCodeStreamAdapter(bus, "test-session-123");
  });
  test("strict runtime contract normalizes OpenCode subagent task metadata", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
      runtimeFeatureFlags: {
        strictTaskContract: true,
      },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-oc-1",
        subagentType: "explore",
        task: "   ",
        toolInput: {
          description: "Inspect auth paths",
          mode: "background",
        },
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter((e) => e.type === "stream.agent.start");
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.task).toBe("Inspect auth paths");
    expect(agentStartEvents[0].data.isBackground).toBe(true);
  });

  test("strict runtime contract keeps synthetic turn id stable in OpenCode", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const chunks: AgentMessage[] = [{ type: "text", content: "done" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
      runtimeFeatureFlags: {
        strictTaskContract: true,
      },
    });

    client.emit("turn.start" as EventType, {
      type: "turn.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {},
    } as AgentEvent<"turn.start">);

    client.emit("turn.end" as EventType, {
      type: "turn.end",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { stop_reason: "tool_use" },
    } as AgentEvent<"turn.end">);

    await streamPromise;

    const turnStartEvents = events.filter((e) => e.type === "stream.turn.start");
    const turnEndEvents = events.filter((e) => e.type === "stream.turn.end");
    expect(turnStartEvents.length).toBe(1);
    expect(turnEndEvents.length).toBe(1);
    expect(turnStartEvents[0].data.turnId).toMatch(/^turn_/);
    expect(turnEndEvents[0].data.turnId).toBe(turnStartEvents[0].data.turnId);
    expect(turnEndEvents[0].data.finishReason).toBe("tool-calls");
    expect(turnEndEvents[0].data.rawFinishReason).toBe("tool_use");
  });

  test("maps reasoning events from SDK client to thinking events", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        reasoningId: "reasoning-1",
        delta: "thinking...",
      },
    } as AgentEvent<"reasoning.delta">);

    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        reasoningId: "reasoning-1",
        content: "done",
      },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    expect(events.some((e) => e.type === "stream.thinking.delta" && e.data.sourceKey === "reasoning-1")).toBe(true);
    expect(events.some((e) => e.type === "stream.thinking.complete" && e.data.sourceKey === "reasoning-1")).toBe(true);
  });

  test("treats message.delta contentType=reasoning as thinking", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const adapterWithClient = new OpenCodeStreamAdapter(bus, "test-session-123", client);

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapterWithClient.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-reasoning-content-type",
    });

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        delta: "reasoning via content type",
        contentType: "reasoning",
        thinkingSourceKey: "reasoning-content-type-1",
      },
    } as AgentEvent<"message.delta">);

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        message: "",
      },
    } as AgentEvent<"message.complete">);

    await streamPromise;

    expect(
      events.some(
        (event) => event.type === "stream.thinking.delta"
          && event.data.sourceKey === "reasoning-content-type-1"
          && event.data.delta === "reasoning via content type",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) => event.type === "stream.text.delta"
          && event.data.delta === "reasoning via content type",
      ),
    ).toBe(false);
  });

  test("bridges callId-first subagent.start to later Task toolUseId and preserves a single canonical correlation", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-call-first",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-call-first",
        subagentType: "debugger",
        task: "Sub-agent task",
        toolCallId: "call-only-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Task",
        toolInput: { description: "Investigate OpenCode parity" },
        toolUseId: "tool-use-1",
      },
    } as AgentEvent<"tool.start">);

    // Replay event from SDK with newly-populated subagentSessionId but missing call IDs.
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-call-first",
        subagentType: "debugger",
        task: "Sub-agent task",
        subagentSessionId: "child-session-oc-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const toolStartEvents = events.filter((e) => e.type === "stream.tool.start");
    expect(toolStartEvents.length).toBe(1);
    expect(toolStartEvents[0].data.toolId).toBe("tool-use-1");
    expect(toolStartEvents[0].data.sdkCorrelationId).toBe("tool-use-1");

    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && e.data.agentId === "agent-call-first",
    );
    expect(agentStartEvents.length).toBe(2);
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("call-only-1");
    expect(agentStartEvents[1].data.sdkCorrelationId).toBe("tool-use-1");
    expect(agentStartEvents[1].data.task).toBe("Investigate OpenCode parity");
  });

  test("maps subagent.start callId-only events onto pending Task toolUseId metadata", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-pending-fallback",
    });

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        toolName: "Agent",
        toolInput: { description: "Find orphaned sub-agent branches" },
        toolUseId: "tool-use-task-2",
      },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-pending-link",
        subagentType: "explore",
        task: "sub-agent task",
        toolCallId: "call-only-2",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (e) => e.type === "stream.agent.start" && e.data.agentId === "agent-pending-link",
    );
    expect(agentStartEvents.length).toBe(1);
    expect(agentStartEvents[0].data.sdkCorrelationId).toBe("tool-use-task-2");
    expect(agentStartEvents[0].data.task).toBe("Find orphaned sub-agent branches");
  });

  test("tags OpenCode subagent skill invocations so the top-level skill UI can ignore them", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const adapterWithClient = new OpenCodeStreamAdapter(bus, "test-session-123", client);

    const stream = mockAsyncStream([{ type: "text", content: "done" }]);
    const session = createMockSession(stream, client);

    const streamPromise = adapterWithClient.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-opencode-skill-agent",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-opencode-skill-1",
        subagentType: "explore",
        task: "Investigate",
        toolUseId: "tool-opencode-skill-1",
        subagentSessionId: "child-session-opencode-skill-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("skill.invoked" as EventType, {
      type: "skill.invoked",
      sessionId: "child-session-opencode-skill-1",
      timestamp: Date.now(),
      data: {
        skillName: "frontend-design",
        skillPath: "skills/frontend-design/SKILL.md",
      },
    } as AgentEvent<"skill.invoked">);

    await streamPromise;

    const skillEvent = events.find((e) => e.type === "stream.skill.invoked");
    expect(skillEvent).toBeDefined();
    expect(skillEvent?.data.skillName).toBe("frontend-design");
    expect(skillEvent?.data.agentId).toBe("agent-opencode-skill-1");
  });

});
