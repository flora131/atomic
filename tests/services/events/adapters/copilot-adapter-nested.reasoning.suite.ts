// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import type {
  AgentEvent,
  CodingAgentClient,
  EventType,
} from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("CopilotStreamAdapter nested reasoning ownership", () => {
  let bus: EventBus;
  let client: CodingAgentClient;
  let adapter: CopilotStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    client = createMockClient();
    adapter = new CopilotStreamAdapter(bus, client);
  });

  test("maps sub-agent reasoning through parentToolCallId ownership", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 511,
      messageId: "msg-subagent-reasoning",
      knownAgentNames: ["codebase-analyzer"],
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "tool-call-agent-2",
        subagentType: "codebase-analyzer",
        toolCallId: "tool-call-agent-2",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("reasoning.delta" as EventType, {
      type: "reasoning.delta",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        delta: "child reasoning",
        reasoningId: "copilot-child-reasoning-1",
        parentToolCallId: "tool-call-agent-2",
      },
    } as AgentEvent<"reasoning.delta">);
    client.emit("reasoning.complete" as EventType, {
      type: "reasoning.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        reasoningId: "copilot-child-reasoning-1",
        parentToolCallId: "tool-call-agent-2",
      },
    } as AgentEvent<"reasoning.complete">);

    await streamPromise;

    expect(
      events.some(
        (event) =>
          event.type === "stream.thinking.delta"
          && event.data.sourceKey === "copilot-child-reasoning-1"
          && event.data.agentId === "tool-call-agent-2",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "stream.thinking.complete"
          && event.data.sourceKey === "copilot-child-reasoning-1"
          && event.data.agentId === "tool-call-agent-2",
      ),
    ).toBe(true);
  });
});
