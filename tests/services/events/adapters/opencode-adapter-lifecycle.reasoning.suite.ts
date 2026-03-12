// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import type {
  AgentEvent,
  AgentMessage,
  EventType,
} from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
} from "./adapter-test-support.ts";

describe("OpenCodeStreamAdapter reasoning ownership", () => {
  let bus: EventBus;
  let adapter: OpenCodeStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    adapter = new OpenCodeStreamAdapter(bus, "test-session-123");
  });

  test("publishes thinking delta events", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(
      [
        {
          type: "thinking",
          content: "Let me think...",
          metadata: { thinkingSourceKey: "block-1" },
        },
        {
          type: "thinking",
          content: "about this problem",
          metadata: { thinkingSourceKey: "block-1" },
        },
        {
          type: "thinking",
          content: "",
          metadata: {
            thinkingSourceKey: "block-1",
            streamingStats: { thinkingMs: 1234 },
          },
        },
      ] as AgentMessage[],
      createMockClient(),
    );

    await adapter.startStreaming(session, "test message", {
      runId: 42,
      messageId: "msg-1",
    });

    const thinkingDeltaEvents = events.filter(
      (event) => event.type === "stream.thinking.delta",
    );
    expect(thinkingDeltaEvents).toHaveLength(2);
    expect(thinkingDeltaEvents[0].data.delta).toBe("Let me think...");
    expect(thinkingDeltaEvents[0].data.sourceKey).toBe("block-1");
    expect(thinkingDeltaEvents[1].data.delta).toBe("about this problem");

    const thinkingCompleteEvents = events.filter(
      (event) => event.type === "stream.thinking.complete",
    );
    expect(thinkingCompleteEvents).toHaveLength(1);
    expect(thinkingCompleteEvents[0].data.sourceKey).toBe("block-1");
    expect(thinkingCompleteEvents[0].data.durationMs).toBe(1234);
  });

  test("agent-only OpenCode streams keep root-session reasoning unscoped", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(session, "Explain BM25", {
      runId: 43,
      messageId: "msg-opencode-agent-only",
      agent: "codebase-online-researcher",
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Need to construct the research task first",
        reasoningId: "opencode-agent-only-reasoning",
      },
    } as AgentEvent<"reasoning.delta">);
    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        reasoningId: "opencode-agent-only-reasoning",
        content: "Need to construct the research task first",
      },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    const thinkingDelta = events.find(
      (event) =>
        event.type === "stream.thinking.delta"
        && event.data.sourceKey === "opencode-agent-only-reasoning",
    );
    expect(thinkingDelta?.data.agentId).toBeUndefined();

    const thinkingComplete = events.find(
      (event) =>
        event.type === "stream.thinking.complete"
        && event.data.sourceKey === "opencode-agent-only-reasoning",
    );
    expect(thinkingComplete?.data.agentId).toBeUndefined();
    expect(events.some((event) => event.type === "stream.agent.start")).toBe(false);
  });

  test("agent-only OpenCode streams do not promote root-session tools into a subagent tree", async () => {
    const events = collectEvents(bus);
    const client = createMockClient();

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay(), client);

    const streamPromise = adapter.startStreaming(
      session,
      "Explain the BM25 algorithm",
      {
        runId: 43,
        messageId: "msg-opencode-agent-tool-tree",
        agent: "codebase-online-researcher",
      },
    );

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "report_intent",
        toolInput: { intent: "Researching BM25" },
        toolUseId: "opencode-agent-tool-1",
      },
    } as AgentEvent<"tool.start">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "opencode-real-agent-1",
        subagentType: "codebase-online-researcher",
        task: "Explain the BM25 algorithm",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "report_intent",
        toolUseId: "opencode-agent-tool-1",
        toolResult: "ok",
        success: true,
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    const toolStart = events.find(
      (event) =>
        event.type === "stream.tool.start"
        && event.data.toolId === "opencode-agent-tool-1",
    );
    expect(toolStart?.data.parentAgentId).toBeUndefined();

    const toolComplete = events.find(
      (event) =>
        event.type === "stream.tool.complete"
        && event.data.toolId === "opencode-agent-tool-1",
    );
    expect(toolComplete?.data.parentAgentId).toBeUndefined();
  });
});
