// @ts-nocheck
import { beforeEach, describe, expect, test } from "bun:test";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import { wireConsumers } from "@/services/events/consumers/wire-consumers.ts";
import type { BusEvent } from "@/services/events/bus-events.ts";
import type { AgentEvent, AgentMessage, EventType } from "@/services/agents/types.ts";
import type { StreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import {
  createIntegrationBusHarness,
  createMockClient,
  createMockSession,
  flushMicrotasks,
  waitForBatchFlush,
} from "./integration.helpers.ts";

describe("Event Bus Integration", () => {
  let bus: ReturnType<typeof createIntegrationBusHarness>["bus"];
  let dispatcher: ReturnType<typeof createIntegrationBusHarness>["dispatcher"];

  beforeEach(() => {
    ({ bus, dispatcher } = createIntegrationBusHarness());
  });

  test("Copilot subagent completion finalizes the parent task tool in the pipeline", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);
    const output: StreamPartEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));

    const client = createMockClient();

    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }

    const session = createMockSession(slowStream(), client);
    const adapter = new CopilotStreamAdapter(bus, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 11,
      messageId: "msg-copilot-task",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "copilot-task-1",
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
        subagentId: "copilot-agent-1",
        subagentType: "codebase-analyzer",
        task: "Inspect auth flow",
        toolCallId: "copilot-task-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-agent-1",
        success: true,
        result: "done",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;
    await flushMicrotasks();
    await waitForBatchFlush();

    const toolStarts = output.filter((event) => event.type === "tool-start");
    expect(toolStarts.length).toBe(1);
    expect(toolStarts[0]?.toolId).toBe("copilot-task-1");
    expect(toolStarts[0]?.toolName).toBe("Task");
    expect(toolStarts[0]?.agentId).toBeUndefined();

    const toolCompletes = output.filter((event) => event.type === "tool-complete");
    expect(toolCompletes.length).toBe(1);
    expect(toolCompletes[0]?.toolId).toBe("copilot-task-1");
    expect(toolCompletes[0]?.toolName).toBe("Task");
    expect(toolCompletes[0]?.output).toBe("done");
    expect(toolCompletes[0]?.success).toBe(true);
    expect(toolCompletes[0]?.agentId).toBeUndefined();

    dispose();
    adapter.dispose();
  });

  test("Copilot buffers early child tool events and replays them when subagent.start arrives", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);
    const output: StreamPartEvent[] = [];
    const busEvents: BusEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));
    bus.onAll((event) => busEvents.push(event));

    const client = createMockClient();

    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }

    const session = createMockSession(slowStream(), client);
    const adapter = new CopilotStreamAdapter(bus, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 12,
      messageId: "msg-copilot-synthetic-subagent",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "copilot-task-synthetic-1",
            name: "Task",
            arguments: {
              description: "Inspect auth flow",
              subagent_type: "codebase-analyzer",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "rg",
        toolInput: { pattern: "auth" },
        toolCallId: "child-tool-1",
        parentToolCallId: "copilot-task-synthetic-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "rg",
        toolResult: "src/auth.ts",
        success: true,
        toolCallId: "child-tool-1",
        parentToolCallId: "copilot-task-synthetic-1",
      },
    } as AgentEvent<"tool.complete">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-real-agent-1",
        subagentType: "codebase-analyzer",
        task: "Inspect auth flow",
        toolCallId: "copilot-task-synthetic-1",
      },
    } as AgentEvent<"subagent.start">);

    await streamPromise;
    await flushMicrotasks();
    await waitForBatchFlush();

    const agentStarts = busEvents.filter((event) => event.type === "stream.agent.start");
    expect(agentStarts.length).toBe(1);
    expect(agentStarts[0]?.data.agentId).toBe("copilot-real-agent-1");
    expect(agentStarts[0]?.data.agentType).toBe("codebase-analyzer");
    expect(agentStarts[0]?.data.toolCallId).toBe("copilot-task-synthetic-1");
    expect(agentStarts[0]?.data.task).toBe("Inspect auth flow");

    const nestedToolStarts = output.filter(
      (event) => event.type === "tool-start" && event.toolId === "child-tool-1",
    );
    expect(nestedToolStarts.length).toBe(1);
    expect(nestedToolStarts[0]?.agentId).toBe("copilot-real-agent-1");

    const nestedToolCompletes = output.filter(
      (event) => event.type === "tool-complete" && event.toolId === "child-tool-1",
    );
    expect(nestedToolCompletes.length).toBe(1);
    expect(nestedToolCompletes[0]?.agentId).toBe("copilot-real-agent-1");

    dispose();
    adapter.dispose();
  });

  test("Copilot replays early child tool start with real agent ID after subagent.start", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);
    const output: StreamPartEvent[] = [];
    const busEvents: BusEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));
    bus.onAll((event) => busEvents.push(event));

    const client = createMockClient();

    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }

    const session = createMockSession(slowStream(), client);
    const adapter = new CopilotStreamAdapter(bus, client);

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 13,
      messageId: "msg-copilot-promoted-subagent",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    client.emit("message.complete" as EventType, {
      type: "message.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolRequests: [
          {
            toolCallId: "copilot-task-promoted-1",
            name: "Task",
            arguments: {
              description: "Inspect auth flow",
              subagent_type: "codebase-analyzer",
            },
          },
        ],
      },
    } as AgentEvent<"message.complete">);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "view",
        toolInput: { path: "src/auth.ts" },
        toolCallId: "child-tool-2",
        parentToolCallId: "copilot-task-promoted-1",
      },
    } as AgentEvent<"tool.start">);

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        subagentId: "copilot-agent-promoted-1",
        subagentType: "codebase-analyzer",
        task: "Inspect auth flow",
        toolCallId: "copilot-task-promoted-1",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: session.id,
      timestamp: Date.now(),
      data: {
        toolName: "view",
        toolResult: "file contents",
        success: true,
        toolCallId: "child-tool-2",
        parentToolCallId: "copilot-task-promoted-1",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;
    await flushMicrotasks();
    await waitForBatchFlush();

    const nestedToolStarts = output.filter(
      (event) => event.type === "tool-start" && event.toolId === "child-tool-2",
    );
    expect(nestedToolStarts.length).toBe(1);
    expect(nestedToolStarts[0]?.agentId).toBe("copilot-agent-promoted-1");

    const nestedToolCompletes = output.filter(
      (event) => event.type === "tool-complete" && event.toolId === "child-tool-2",
    );
    expect(nestedToolCompletes.length).toBe(1);
    expect(nestedToolCompletes[0]?.agentId).toBe("copilot-agent-promoted-1");

    const agentStarts = busEvents.filter((event) => event.type === "stream.agent.start");
    expect(agentStarts.length).toBe(1);
    expect(agentStarts[0]?.data.agentId).toBe("copilot-agent-promoted-1");
    expect(agentStarts[0]?.data.toolCallId).toBe("copilot-task-promoted-1");
    expect(agentStarts[0]?.data.agentType).toBe("codebase-analyzer");

    dispose();
    adapter.dispose();
  });
});
