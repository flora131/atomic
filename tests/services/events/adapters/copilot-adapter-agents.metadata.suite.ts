// @ts-nocheck

import { beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "@/services/events/event-bus.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import type { AgentEvent, CodingAgentClient, EventType } from "@/services/agents/types.ts";
import {
  collectEvents,
  createMockClient,
  createMockSession,
  mockAsyncStream,
} from "./adapter-test-support.ts";

describe("CopilotStreamAdapter task metadata extraction", () => {
  let bus: EventBus;
  let client: CodingAgentClient;
  let adapter: CopilotStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    client = createMockClient();
    adapter = new CopilotStreamAdapter(bus, client);
  });

  test("recognizes Copilot agent names as task tools via knownAgentNames", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 500,
      messageId: "msg-agent-name",
      knownAgentNames: ["codebase-analyzer", "General-Purpose"],
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "agent-tool-1",
            name: "codebase-analyzer",
            arguments: {
              prompt: "Analyze the auth module",
              subagent_type: "codebase-analyzer",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-agent-1",
        subagentType: "codebase-analyzer",
        task: "Generic analyzer agent",
        toolCallId: "agent-tool-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (event) =>
        event.type === "stream.agent.start"
        && !event.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents).toHaveLength(1);
    expect(agentStartEvents[0].data.task).toBe("Analyze the auth module");
  });

  test("extracts description from prompt argument", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 501,
      messageId: "msg-prompt",
      knownAgentNames: ["general-purpose"],
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "prompt-tool-1",
            name: "general-purpose",
            arguments: { prompt: "Research the dependency graph" },
          },
        ],
      },
    } as AgentEvent<"message.complete">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-prompt-1",
        subagentType: "general-purpose",
        task: "General purpose agent",
        toolCallId: "prompt-tool-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (event) =>
        event.type === "stream.agent.start"
        && !event.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents).toHaveLength(1);
    expect(agentStartEvents[0].data.task).toBe("Research the dependency graph");
  });

  test("tags Copilot subagent skill invocations so the top-level skill UI can ignore them", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 501,
      messageId: "msg-copilot-skill-agent",
    });

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-copilot-skill-1",
        subagentType: "general-purpose",
        task: "Investigate",
        toolCallId: "task-call-skill-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("skill.invoked" as EventType, {
      type: "skill.invoked",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        skillName: "frontend-design",
        skillPath: "skills/frontend-design/SKILL.md",
        parentToolCallId: "task-call-skill-1",
      },
    } as AgentEvent<"skill.invoked">);

    await streamPromise;

    const skillEvent = events.find((event) => event.type === "stream.skill.invoked");
    expect(skillEvent?.data.skillName).toBe("frontend-design");
    expect(skillEvent?.data.agentId).toBe("sub-copilot-skill-1");
  });

  test("extracts isBackground from run_in_background argument", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test", {
      runId: 502,
      messageId: "msg-bg",
      knownAgentNames: ["general-purpose"],
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "bg-tool-1",
            name: "general-purpose",
            arguments: {
              prompt: "Background research task",
              run_in_background: true,
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "sub-bg-1",
        subagentType: "general-purpose",
        task: "General purpose agent",
        toolCallId: "bg-tool-1",
      },
    } as AgentEvent<"subagent.start">);

    // Wait for stream iteration to complete
    await new Promise((resolve) => setTimeout(resolve, 20));

    const agentStartEvents = events.filter(
      (event) =>
        event.type === "stream.agent.start"
        && !event.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents).toHaveLength(1);
    expect(agentStartEvents[0].data.isBackground).toBe(true);
    expect(agentStartEvents[0].data.task).toBe("Background research task");

    // Unblock the background-completion promise so streamPromise resolves
    const state = (adapter as any).state;
    state.backgroundCompletionResolve?.();
    await streamPromise;
  });
});
