import { describe, expect, test } from "bun:test";
import { bindCopilotHandleSdkEvent, createRunningCopilotClient } from "./copilot.mapping.test-support.ts";

describe("CopilotClient subagent event mapping", () => {
  test("maps subagent.started to subagent.start with enriched data", async () => {
    const client = createRunningCopilotClient();
    const events: Array<{ type: string; sessionId: string; data: Record<string, unknown> }> = [];
    client.on("subagent.start", (event) => {
      events.push({ type: "subagent.start", sessionId: event.sessionId, data: event.data });
    });

    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "subagent.started",
      data: {
        toolCallId: "tc-123",
        agentName: "worker",
        agentDisplayName: "Worker",
        agentDescription: "Fix bug",
      },
    });

    expect(events).toEqual([
      {
        type: "subagent.start",
        sessionId: "test-session",
        data: {
          subagentId: "tc-123",
          subagentType: "worker",
          toolCallId: "tc-123",
          task: "Fix bug",
        },
      },
    ]);
  });

  test("maps subagent.started with empty task when agentDescription is missing", async () => {
    const client = createRunningCopilotClient();
    const events: Array<Record<string, unknown>> = [];
    client.on("subagent.start", (event) => {
      events.push(event.data);
    });

    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "subagent.started",
      data: {
        toolCallId: "tc-456",
        agentName: "debugger",
        agentDisplayName: "Debugger",
        agentDescription: "",
      },
    });

    expect(events).toEqual([
      {
        subagentId: "tc-456",
        subagentType: "debugger",
        toolCallId: "tc-456",
        task: "",
      },
    ]);
  });

  test("maps subagent.started with agentDescription when available, empty when not", async () => {
    const client = createRunningCopilotClient();
    const events: Array<Record<string, unknown>> = [];
    client.on("subagent.start", (event) => {
      events.push(event.data);
    });

    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "subagent.started",
      data: {
        toolCallId: "tc-789",
        agentName: "explorer",
        agentDisplayName: "Explorer",
        agentDescription: "",
      },
    });

    expect(events).toEqual([
      {
        subagentId: "tc-789",
        subagentType: "explorer",
        toolCallId: "tc-789",
        task: "",
      },
    ]);
  });

  test("maps subagent.completed to subagent.complete with success: true", async () => {
    const client = createRunningCopilotClient();
    const events: Array<{ type: string; sessionId: string; data: Record<string, unknown> }> = [];
    client.on("subagent.complete", (event) => {
      events.push({ type: "subagent.complete", sessionId: event.sessionId, data: event.data });
    });

    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "subagent.completed",
      data: { toolCallId: "tc-123" },
    });

    expect(events).toEqual([
      {
        type: "subagent.complete",
        sessionId: "test-session",
        data: {
          subagentId: "tc-123",
          success: true,
        },
      },
    ]);
  });

  test("maps subagent.failed to subagent.complete with success: false and error", async () => {
    const client = createRunningCopilotClient();
    const events: Array<{ type: string; sessionId: string; data: Record<string, unknown> }> = [];
    client.on("subagent.complete", (event) => {
      events.push({ type: "subagent.complete", sessionId: event.sessionId, data: event.data });
    });

    bindCopilotHandleSdkEvent(client)("test-session", {
      type: "subagent.failed",
      data: {
        toolCallId: "tc-456",
        error: "Task execution failed",
      },
    });

    expect(events).toEqual([
      {
        type: "subagent.complete",
        sessionId: "test-session",
        data: {
          subagentId: "tc-456",
          success: false,
          error: "Task execution failed",
        },
      },
    ]);
  });
});
