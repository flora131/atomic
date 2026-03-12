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

describe("ClaudeStreamAdapter skill events and runtime contracts", () => {
  let bus: EventBus;
  let adapter: ClaudeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new ClaudeStreamAdapter(bus, "test-session-123");
  });

  test("tags Claude subagent skill invocations so the top-level skill UI can ignore them", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 105,
      messageId: "msg-claude-skill-agent",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "agent-claude-skill-1",
        subagentType: "debugger",
        task: "Investigate",
        toolUseID: "task-call-claude-skill-1",
        subagentSessionId: "child-session-claude-skill-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("skill.invoked" as EventType, {
      type: "skill.invoked",
      sessionId: "child-session-claude-skill-1",
      timestamp: Date.now(),
      data: {
        skillName: "frontend-design",
        skillPath: "skills/frontend-design/SKILL.md",
        parentToolCallId: "task-call-claude-skill-1",
      },
    } as AgentEvent<"skill.invoked">);

    await streamPromise;

    const skillEvent = events.find((event) => event.type === "stream.skill.invoked");
    expect(skillEvent?.data.skillName).toBe("frontend-design");
    expect(skillEvent?.data.agentId).toBe("task-call-claude-skill-1");
  });

  test("ignores raw Claude Skill tool chunks so skill loads render only through stream.skill.invoked", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithSkillChunks(): AsyncGenerator<AgentMessage> {
      yield {
        type: "tool_use",
        content: {
          name: "Skill",
          input: { name: "frontend-design" },
          toolUseId: "skill-tool-1",
        },
      };
      yield {
        type: "tool_result",
        content: { ok: true },
        metadata: { toolName: "Skill", toolUseId: "skill-tool-1" },
      };
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithSkillChunks(), client);
    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 106,
      messageId: "msg-claude-raw-skill-chunks",
    });

    client.emit("skill.invoked" as EventType, {
      type: "skill.invoked",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        skillName: "frontend-design",
        skillPath: "skills/frontend-design/SKILL.md",
      },
    } as AgentEvent<"skill.invoked">);

    await streamPromise;

    expect(
      events.some(
        (event) =>
          event.type === "stream.tool.start" && event.data.toolId === "skill-tool-1",
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "stream.tool.complete" && event.data.toolId === "skill-tool-1",
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "stream.skill.invoked"
          && event.data.skillName === "frontend-design",
      ),
    ).toBe(true);
  });

  test("publishes agent complete events from subagent.complete hook", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
    });

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: "test-session-123",
      timestamp: new Date().toISOString(),
      data: { subagentId: "agent-001", success: true, result: "Found 3 files" },
    } as AgentEvent);

    await streamPromise;

    const agentCompleteEvents = events.filter(
      (event) => event.type === "stream.agent.complete",
    );
    expect(agentCompleteEvents).toHaveLength(1);
    expect(agentCompleteEvents[0].data.agentId).toBe("agent-001");
    expect(agentCompleteEvents[0].data.success).toBe(true);
    expect(agentCompleteEvents[0].data.result).toBe("Found 3 files");
    expect(agentCompleteEvents[0].runId).toBe(100);
  });

  test("strict runtime contract normalizes Claude subagent task metadata", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-cl-1",
        subagentType: "research",
        task: "   ",
        toolInput: {
          prompt: "Review deploy logs",
          run_in_background: true,
        },
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (event) => event.type === "stream.agent.start",
    );
    expect(agentStartEvents).toHaveLength(1);
    expect(agentStartEvents[0].data.task).toBe("Review deploy logs");
    expect(agentStartEvents[0].data.isBackground).toBe(true);
  });

  test("maps extended Claude client events to canonical stream events", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "done" }]),
      client,
    );

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 100,
      messageId: "msg-2",
      runtimeFeatureFlags: { strictTaskContract: true },
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { reasoningId: "r-1", delta: "trace" },
    } as AgentEvent<"reasoning.delta">);
    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { reasoningId: "r-1", content: "trace complete" },
    } as AgentEvent<"reasoning.complete">);
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
      data: { finish_reason: "end_turn" },
    } as AgentEvent<"turn.end">);
    client.emit("tool.partial_result" as EventType, {
      type: "tool.partial_result",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { toolCallId: "tool-1", partialOutput: "half" },
    } as AgentEvent<"tool.partial_result">);
    client.emit("session.info" as EventType, {
      type: "session.info",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { infoType: "general", message: "hello" },
    } as AgentEvent<"session.info">);
    client.emit("session.warning" as EventType, {
      type: "session.warning",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { warningType: "general", message: "careful" },
    } as AgentEvent<"session.warning">);
    client.emit("session.title_changed" as EventType, {
      type: "session.title_changed",
      sessionId: "test-session-123",
      timestamp: Date.now(),
      data: { title: "New title" },
    } as AgentEvent<"session.title_changed">);

    await streamPromise;

    expect(events.some((event) => event.type === "stream.thinking.delta")).toBe(true);
    expect(events.some((event) => event.type === "stream.thinking.complete")).toBe(true);
    expect(events.some((event) => event.type === "stream.turn.start")).toBe(true);
    expect(events.some((event) => event.type === "stream.turn.end")).toBe(true);
    expect(events.some((event) => event.type === "stream.tool.partial_result")).toBe(true);
    expect(events.some((event) => event.type === "stream.session.info")).toBe(true);
    expect(events.some((event) => event.type === "stream.session.warning")).toBe(true);
    expect(events.some((event) => event.type === "stream.session.title_changed")).toBe(true);
  });
});
