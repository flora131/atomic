// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import type { AgentEvent, AgentMessage, CodingAgentClient, EventType } from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
} from "./adapter-test-support.ts";

describe("CopilotStreamAdapter synthetic foreground ownership", () => {
  let bus: EventBus;
  let client: CodingAgentClient;
  let adapter: CopilotStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    client = createMockClient();
    adapter = new CopilotStreamAdapter(bus, client);
  });

  test("agent-only Copilot streams attribute early message thinking to a synthetic foreground agent", async () => {
    const events = collectEvents(bus);

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay());
    const streamPromise = adapter.startStreaming(session, "Explain the BM25 algorithm", {
      runId: 200,
      messageId: "msg-copilot-agent-only-thinking",
      agent: "codebase-online-researcher",
    });

    client.emit("message.delta" as EventType, {
      type: "message.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Need to delegate this to the research agent first",
        contentType: "thinking",
        thinkingSourceKey: "copilot-agent-only-thinking-1",
      },
    } as AgentEvent<"message.delta">);
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { message: "" },
    } as AgentEvent<"message.complete">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-subagent-early-thinking-1",
        subagentType: "codebase-online-researcher",
        task: "Explain the BM25 algorithm",
        toolCallId: "copilot-task-call-early-thinking-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    expect(
      events.find(
        (event) =>
          event.type === "stream.agent.start"
          && event.data.agentId === "agent-only-msg-copilot-agent-only-thinking",
      ),
    ).toBeDefined();
    expect(
      events.find(
        (event) =>
          event.type === "stream.thinking.delta"
          && event.data.sourceKey === "copilot-agent-only-thinking-1",
      )?.data.agentId,
    ).toBe("agent-only-msg-copilot-agent-only-thinking");
    expect(
      events.find(
        (event) =>
          event.type === "stream.thinking.complete"
          && event.data.sourceKey === "copilot-agent-only-thinking-1",
      )?.data.agentId,
    ).toBe("agent-only-msg-copilot-agent-only-thinking");
  });

  test("agent-only Copilot streams attribute early reasoning to a synthetic foreground agent", async () => {
    const events = collectEvents(bus);

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay());
    const streamPromise = adapter.startStreaming(session, "Explain the BM25 algorithm", {
      runId: 200,
      messageId: "msg-copilot-agent-only-reasoning",
      agent: "codebase-online-researcher",
    });

    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "Need to invoke the research agent first",
        reasoningId: "copilot-agent-only-reasoning-1",
      },
    } as AgentEvent<"reasoning.delta">);
    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        reasoningId: "copilot-agent-only-reasoning-1",
        content: "Need to invoke the research agent first",
      },
    } as AgentEvent<"reasoning.complete">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-subagent-early-reasoning-1",
        subagentType: "codebase-online-researcher",
        task: "Explain the BM25 algorithm",
        toolCallId: "copilot-task-call-early-reasoning-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    expect(
      events.find(
        (event) =>
          event.type === "stream.agent.start"
          && event.data.agentId === "agent-only-msg-copilot-agent-only-reasoning",
      ),
    ).toBeDefined();
    expect(
      events.find(
        (event) =>
          event.type === "stream.thinking.delta"
          && event.data.sourceKey === "copilot-agent-only-reasoning-1",
      )?.data.agentId,
    ).toBe("agent-only-msg-copilot-agent-only-reasoning");
    expect(
      events.find(
        (event) =>
          event.type === "stream.thinking.complete"
          && event.data.sourceKey === "copilot-agent-only-reasoning-1",
      )?.data.agentId,
    ).toBe("agent-only-msg-copilot-agent-only-reasoning");
  });

  test("agent-only Copilot streams keep early tools inside the agent tree after native subagent promotion", async () => {
    const events = collectEvents(bus);

    async function* streamWithDelay(): AsyncGenerator<AgentMessage> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield { type: "text", content: "done" };
    }

    const session = createMockSession(streamWithDelay());
    const streamPromise = adapter.startStreaming(session, "Explain the BM25 algorithm", {
      runId: 200,
      messageId: "msg-copilot-agent-tool-tree",
      agent: "codebase-online-researcher",
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "copilot-agent-tool-1",
            name: "report_intent",
            arguments: { intent: "Researching BM25" },
          },
        ],
      },
    } as AgentEvent<"message.complete">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-real-agent-1",
        subagentType: "codebase-online-researcher",
        task: "Explain the BM25 algorithm",
        toolCallId: "copilot-task-call-agent-tool-tree",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "report_intent",
        toolCallId: "copilot-agent-tool-1",
        toolResult: "ok",
        success: true,
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;

    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.start"
          && event.data.toolId === "copilot-agent-tool-1",
      )?.data.parentAgentId,
    ).toBe("agent-only-msg-copilot-agent-tool-tree");
    expect(
      events.find(
        (event) =>
          event.type === "stream.tool.complete"
          && event.data.toolId === "copilot-agent-tool-1",
      )?.data.parentAgentId,
    ).toBe("copilot-real-agent-1");
  });
});
