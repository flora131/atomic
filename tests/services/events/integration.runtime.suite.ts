// @ts-nocheck
import { beforeEach, describe, expect, test } from "bun:test";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import { wireConsumers } from "@/services/events/consumers/wire-consumers.ts";
import type { BusEvent, EnrichedBusEvent } from "@/services/events/bus-events.ts";
import type { AgentEvent, AgentMessage, EventType } from "@/services/agents/types.ts";
import type { StreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import {
  createIntegrationBusHarness,
  createMockClient,
  createMockSession,
  flushMicrotasks,
  mockAsyncStream,
  waitForBatchFlush,
} from "./integration.helpers.ts";

describe("Event Bus Integration", () => {
  let bus: ReturnType<typeof createIntegrationBusHarness>["bus"];
  let dispatcher: ReturnType<typeof createIntegrationBusHarness>["dispatcher"];

  beforeEach(() => {
    ({ bus, dispatcher } = createIntegrationBusHarness());
  });

  test("multiple adapters: verify all three SDK adapters produce same bus events", async () => {
    const opencodeBus = createIntegrationBusHarness().bus;
    const opencodeEvents: BusEvent[] = [];
    opencodeBus.onAll((event) => opencodeEvents.push(event));

    const opencodeAdapter = new OpenCodeStreamAdapter(opencodeBus, "session-1");
    await opencodeAdapter.startStreaming(
      createMockSession(mockAsyncStream([{ type: "text", content: "Hello" }])),
      "test",
      { runId: 5, messageId: "msg-5" },
    );

    const claudeBus = createIntegrationBusHarness().bus;
    const claudeEvents: BusEvent[] = [];
    claudeBus.onAll((event) => claudeEvents.push(event));

    const claudeAdapter = new ClaudeStreamAdapter(claudeBus, "session-1");
    await claudeAdapter.startStreaming(
      createMockSession(mockAsyncStream([{ type: "text", content: "Hello" }])),
      "test",
      { runId: 5, messageId: "msg-5" },
    );

    const coreFilter = (event: BusEvent) => event.type !== "stream.session.idle";
    const opencodeCore = opencodeEvents.filter(coreFilter);
    const claudeCore = claudeEvents.filter(coreFilter);
    expect(opencodeCore.length).toBe(claudeCore.length);

    const opencodeIdleEvents = opencodeEvents.filter((event) => event.type === "stream.session.idle");
    expect(opencodeIdleEvents.length).toBe(1);
    expect(opencodeIdleEvents[0].data.reason).toBe("generator-complete");

    const opencodeTextDeltas = opencodeEvents.filter((event) => event.type === "stream.text.delta");
    const claudeTextDeltas = claudeEvents.filter((event) => event.type === "stream.text.delta");
    expect(opencodeTextDeltas.length).toBe(1);
    expect(claudeTextDeltas.length).toBe(1);
    expect(opencodeTextDeltas[0].data.delta).toBe("Hello");
    expect(claudeTextDeltas[0].data.delta).toBe("Hello");
    expect(opencodeTextDeltas[0].runId).toBe(claudeTextDeltas[0].runId);

    const opencodeTextComplete = opencodeEvents.filter((event) => event.type === "stream.text.complete");
    const claudeTextComplete = claudeEvents.filter((event) => event.type === "stream.text.complete");
    expect(opencodeTextComplete.length).toBe(1);
    expect(claudeTextComplete.length).toBe(1);
    expect(opencodeTextComplete[0].data.fullText).toBe("Hello");
    expect(claudeTextComplete[0].data.fullText).toBe("Hello");

    opencodeAdapter.dispose();
    claudeAdapter.dispose();
  });

  test("runtime envelope chat flow: workflow events map to runtime envelope parts", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);
    const output: StreamPartEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));

    dispatcher.enqueue({
      type: "stream.session.start",
      sessionId: "runtime-session",
      runId: 11,
      timestamp: Date.now(),
      data: {},
    });
    dispatcher.enqueue({
      type: "workflow.step.start",
      sessionId: "runtime-session",
      runId: 11,
      timestamp: Date.now(),
      data: {
        workflowId: "wf-runtime",
        nodeId: "planner",
        nodeName: "Planner",
      },
    });
    dispatcher.enqueue({
      type: "workflow.task.update",
      sessionId: "runtime-session",
      runId: 11,
      timestamp: Date.now(),
      data: {
        workflowId: "wf-runtime",
        tasks: [
          {
            id: "#1",
            title: "Plan rollout",
            status: "completed",
            taskResult: {
              task_id: "#1",
              tool_name: "task",
              title: "Plan rollout",
              status: "completed",
              output_text: "done",
            },
          },
        ],
      },
    });
    dispatcher.enqueue({
      type: "workflow.step.complete",
      sessionId: "runtime-session",
      runId: 11,
      timestamp: Date.now(),
      data: {
        workflowId: "wf-runtime",
        nodeId: "planner",
        nodeName: "Planner",
        status: "success",
      },
    });

    await flushMicrotasks();
    await waitForBatchFlush();

    expect(output.some((event) => event.type === "workflow-step-start")).toBe(true);
    expect(output.some((event) => event.type === "task-list-update")).toBe(true);
    expect(output.some((event) => event.type === "task-result-upsert")).toBe(true);
    expect(output.some((event) => event.type === "workflow-step-complete")).toBe(true);

    const taskResult = output.find((event) => event.type === "task-result-upsert");
    expect(taskResult?.type).toBe("task-result-upsert");
    if (taskResult?.type === "task-result-upsert") {
      expect(taskResult.envelope.task_id).toBe("#1");
      expect(taskResult.envelope.output_text).toBe("done");
    }

    dispose();
  });

  test("sub-agent lifecycle events published to bus", async () => {
    const busEvents: BusEvent[] = [];
    bus.onAll((event) => busEvents.push(event));

    const client = createMockClient();

    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }

    const session = createMockSession(slowStream(), client);
    const adapter = new OpenCodeStreamAdapter(bus, "test-session-agent");
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 8,
      messageId: "msg-8",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    client.emit("subagent.start" as EventType, {
      type: "subagent.start",
      sessionId: "test-session-agent",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-123",
        subagentType: "explore",
        task: "Find all TypeScript files",
        toolCallId: "tool-456",
      },
    } as AgentEvent<"subagent.start">);

    client.emit("subagent.complete" as EventType, {
      type: "subagent.complete",
      sessionId: "test-session-agent",
      timestamp: Date.now(),
      data: {
        subagentId: "agent-123",
        success: true,
        result: "Found 42 TypeScript files",
      },
    } as AgentEvent<"subagent.complete">);

    await streamPromise;
    await flushMicrotasks();
    await waitForBatchFlush();

    const agentStarts = busEvents.filter((event) => event.type === "stream.agent.start");
    expect(agentStarts.length).toBe(1);
    expect(agentStarts[0].data.agentId).toBe("agent-123");
    expect(agentStarts[0].data.agentType).toBe("explore");
    expect(agentStarts[0].data.task).toBe("Find all TypeScript files");

    const agentCompletes = busEvents.filter((event) => event.type === "stream.agent.complete");
    expect(agentCompletes.length).toBe(1);
    expect(agentCompletes[0].data.agentId).toBe("agent-123");
    expect(agentCompletes[0].data.success).toBe(true);
    expect(agentCompletes[0].data.result).toBe("Found 42 TypeScript files");

    adapter.dispose();
  });

  test("session error events published to bus", async () => {
    const busEvents: BusEvent[] = [];
    bus.onAll((event) => busEvents.push(event));

    const client = createMockClient();
    const session = createMockSession(
      mockAsyncStream([{ type: "text", content: "start" }]),
      client,
    );
    const adapter = new OpenCodeStreamAdapter(bus, "test-session-error");

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 9,
      messageId: "msg-9",
    });

    client.emit("session.error" as EventType, {
      type: "session.error",
      sessionId: "test-session-error",
      timestamp: Date.now(),
      data: {
        error: "Network timeout",
        code: "TIMEOUT",
      },
    } as AgentEvent<"session.error">);

    await streamPromise;
    await flushMicrotasks();
    await waitForBatchFlush();

    const errorEvents = busEvents.filter((event) => event.type === "stream.session.error");
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].data.error).toBe("Network timeout");
    expect(errorEvents[0].data.code).toBe("TIMEOUT");

    adapter.dispose();
  });

  test("correlation enriches tool events with agent metadata", async () => {
    const { correlation, dispose } = wireConsumers(bus, dispatcher);
    const enrichedEvents: EnrichedBusEvent[] = [];
    bus.onAll((event) => {
      enrichedEvents.push(correlation.enrich(event));
    });

    const client = createMockClient();

    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }

    const session = createMockSession(slowStream(), client);
    const adapter = new OpenCodeStreamAdapter(bus, "test-session-corr");
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 10,
      messageId: "msg-10",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    correlation.registerTool("tool-789", "agent-parent", true);

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-corr",
      timestamp: Date.now(),
      data: {
        toolName: "view",
        toolInput: { path: "/test.ts" },
        toolUseId: "tool-789",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-corr",
      timestamp: Date.now(),
      data: {
        toolName: "view",
        toolResult: "file contents",
        success: true,
        toolUseId: "tool-789",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;
    await flushMicrotasks();
    await waitForBatchFlush();

    const toolCompletes = enrichedEvents.filter((event) => event.type === "stream.tool.complete");
    expect(toolCompletes.length).toBeGreaterThan(0);
    const toolComplete = toolCompletes[0];
    expect(toolComplete.resolvedAgentId).toBe("agent-parent");
    expect(toolComplete.isSubagentTool).toBe(true);

    dispose();
    adapter.dispose();
  });
});
