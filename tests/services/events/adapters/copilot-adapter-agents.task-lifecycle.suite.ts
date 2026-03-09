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

describe("CopilotStreamAdapter task lifecycle", () => {
  let bus: EventBus;
  let client: CodingAgentClient;
  let adapter: CopilotStreamAdapter;

  beforeEach(() => {
    bus = new EventBus();
    client = createMockClient();
    adapter = new CopilotStreamAdapter(bus, client);
  });

  test("buffers Copilot task tool requests under a synthetic task-agent id until subagent.start binds the real agent", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "Explain the BM25 algorithm", {
      runId: 201,
      messageId: "msg-copilot-task-buffer",
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "copilot-task-buffer-1",
            name: "Task",
            arguments: {
              description: "Research BM25 explanation",
              prompt: "Explain the BM25 algorithm",
              subagent_type: "codebase-online-researcher",
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
        subagentId: "copilot-real-task-agent-1",
        subagentType: "codebase-online-researcher",
        task: "Research BM25 explanation",
        toolCallId: "copilot-task-buffer-1",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-real-task-agent-1",
        success: true,
        result: "BM25 explanation",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    const taskToolStart = events.find(
      (event) =>
        event.type === "stream.tool.start" && event.data.toolId === "copilot-task-buffer-1",
    );
    expect(taskToolStart?.data.parentAgentId).toBeUndefined();

    const taskToolCompletes = events.filter(
      (event) =>
        event.type === "stream.tool.complete"
        && event.data.toolId === "copilot-task-buffer-1",
    );
    expect(taskToolCompletes.length).toBeGreaterThan(0);
    expect(taskToolCompletes[taskToolCompletes.length - 1]?.data.parentAgentId).toBeUndefined();
  });

  test("detects background sub-agents from task tool arguments", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "task-call-1",
            name: "Task",
            arguments: {
              description: "Search for auth patterns",
              mode: "background",
              subagent_type: "Explore",
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
        subagentId: "sub-1",
        subagentType: "Explore",
        task: "Fast agent for exploring codebases",
        toolCallId: "task-call-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (event) =>
        event.type === "stream.agent.start"
        && !event.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents).toHaveLength(1);
    expect(agentStartEvents[0].data.isBackground).toBe(true);
    expect(agentStartEvents[0].data.task).toBe("Search for auth patterns");
  });

  test("completes task tool rows when Copilot sub-agents finish", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-task-complete",
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "task-call-2",
            name: "Task",
            arguments: {
              description: "Inspect auth flow",
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
        subagentId: "subagent-2",
        subagentType: "codebase-analyzer",
        task: "Analyze auth flow",
        toolCallId: "task-call-2",
      },
    } as AgentEvent<"subagent.start">);
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: { subagentId: "subagent-2", success: true, result: "done" },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    const toolStartEvents = events.filter((event) => event.type === "stream.tool.start");
    expect(toolStartEvents).toHaveLength(1);
    expect(toolStartEvents[0].data.toolId).toBe("task-call-2");
    expect(toolStartEvents[0].data.parentAgentId).toBeUndefined();

    const toolCompleteEvents = events.filter(
      (event) => event.type === "stream.tool.complete",
    );
    expect(toolCompleteEvents).toHaveLength(1);
    expect(toolCompleteEvents[0].data.toolId).toBe("task-call-2");
    expect(toolCompleteEvents[0].data.toolResult).toBe("done");
    expect(toolCompleteEvents[0].data.success).toBe(true);
    expect(toolCompleteEvents[0].data.parentAgentId).toBeUndefined();
  });

  test("extracts task description from task tool arguments over agent type description", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 200,
      messageId: "msg-3",
    });

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "task-call-2",
            name: "launch_agent",
            arguments: {
              description: "Find auth code",
              subagent_type: "codebase-locator",
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
        subagentId: "sub-2",
        subagentType: "codebase-locator",
        task: "Locates files and components",
        toolCallId: "task-call-2",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;

    const agentStartEvents = events.filter(
      (event) =>
        event.type === "stream.agent.start"
        && !event.data.agentId.startsWith("synthetic-task-agent:"),
    );
    expect(agentStartEvents).toHaveLength(1);
    expect(agentStartEvents[0].data.task).toBe("Find auth code");
  });
});
