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

  test("suppresses SDK tool.execution_complete for root task tools to prevent premature agent finalization", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "Analyze the codebase", {
      runId: 300,
      messageId: "msg-task-suppress",
    });

    // 1. Task tool starts (message.complete with toolRequests)
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "task-suppress-1",
            name: "Task",
            arguments: {
              description: "Analyze rendering pipeline",
              subagent_type: "codebase-analyzer",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    // 2. Sub-agent starts
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "real-agent-suppress-1",
        subagentType: "codebase-analyzer",
        task: "Analyze rendering pipeline",
        toolCallId: "task-suppress-1",
      },
    } as AgentEvent<"subagent.start">);

    // 3. SDK fires tool.execution_complete for the task tool BEFORE subagent.completed
    //    (this is the Copilot SDK's actual event ordering)
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolCallId: "task-suppress-1",
        toolName: "Task",
        success: true,
        toolResult: "Analysis complete",
      },
    } as AgentEvent<"tool.complete">);

    // Collect events BEFORE subagent.complete to verify no premature tool complete
    const toolCompletesBeforeSubagentDone = events.filter(
      (event) =>
        event.type === "stream.tool.complete"
        && event.data.toolId === "task-suppress-1",
    );
    // The SDK's tool.execution_complete should be suppressed for root task tools
    expect(toolCompletesBeforeSubagentDone).toHaveLength(0);

    // No stream.agent.complete should have been published yet
    const agentCompletesBeforeSubagentDone = events.filter(
      (event) =>
        event.type === "stream.agent.complete"
        && event.data.agentId === "real-agent-suppress-1",
    );
    expect(agentCompletesBeforeSubagentDone).toHaveLength(0);

    // 4. Sub-agent completes (this is when the agent should actually transition)
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "real-agent-suppress-1",
        success: true,
        result: "Analysis complete",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    // After subagent.complete, exactly one tool complete and one agent complete should exist
    const allToolCompletes = events.filter(
      (event) =>
        event.type === "stream.tool.complete"
        && event.data.toolId === "task-suppress-1",
    );
    expect(allToolCompletes).toHaveLength(1);
    expect(allToolCompletes[0].data.success).toBe(true);

    const allAgentCompletes = events.filter(
      (event) =>
        event.type === "stream.agent.complete"
        && event.data.agentId === "real-agent-suppress-1",
    );
    expect(allAgentCompletes).toHaveLength(1);
    expect(allAgentCompletes[0].data.success).toBe(true);
  });

  test("agent remains in running state between tool.execution_complete and subagent.completed", async () => {
    const events = collectEvents(bus);
    const session = createMockSession(mockAsyncStream([{ type: "text", content: "done" }]));

    const streamPromise = adapter.startStreaming(session, "Debug the issue", {
      runId: 301,
      messageId: "msg-running-check",
    });

    // Task tool starts
    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "task-running-1",
            name: "Agent",
            arguments: {
              description: "Debug spinner bug",
              subagent_type: "debugger",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    // Sub-agent starts -> should emit stream.agent.start with running status
    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "debugger-agent-1",
        subagentType: "debugger",
        task: "Debug spinner bug",
        toolCallId: "task-running-1",
      },
    } as AgentEvent<"subagent.start">);

    // SDK fires tool.execution_complete BEFORE subagent.completed
    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolCallId: "task-running-1",
        toolName: "Agent",
        success: true,
        toolResult: "Fixed",
      },
    } as AgentEvent<"tool.complete">);

    // After SDK tool.execution_complete, there should be NO agent.complete yet
    const agentCompletesBefore = events.filter(
      (event) =>
        event.type === "stream.agent.complete"
        && event.data.agentId === "debugger-agent-1",
    );
    expect(agentCompletesBefore).toHaveLength(0);

    // The stream.agent.start should have been published (agent is "running")
    const agentStarts = events.filter(
      (event) =>
        event.type === "stream.agent.start"
        && event.data.agentId === "debugger-agent-1",
    );
    expect(agentStarts).toHaveLength(1);

    // Now subagent.completed fires
    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "debugger-agent-1",
        success: true,
        result: "Fixed",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;

    // NOW the agent should be complete
    const agentCompletesAfter = events.filter(
      (event) =>
        event.type === "stream.agent.complete"
        && event.data.agentId === "debugger-agent-1",
    );
    expect(agentCompletesAfter).toHaveLength(1);
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
