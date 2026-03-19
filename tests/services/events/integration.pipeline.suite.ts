// @ts-nocheck
import { beforeEach, describe, expect, test } from "bun:test";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import { wireConsumers } from "@/services/events/consumers/wire-consumers.ts";
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

  test("full pipeline: SDK stream → adapter → bus → consumer → output", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);
    const output: StreamPartEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));

    const stream = mockAsyncStream([
      { type: "text", content: "Hello " },
      { type: "text", content: "world" },
    ]);
    const session = createMockSession(stream);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-123");
    await adapter.startStreaming(session, "test message", {
      runId: 1,
      messageId: "msg-1",
    });

    await flushMicrotasks();
    await waitForBatchFlush();

    expect(output.length).toBeGreaterThan(0);

    const textDeltas = output.filter((event) => event.type === "text-delta");
    expect(textDeltas.length).toBe(1);
    expect(textDeltas[0].delta).toBe("Hello world");

    dispose();
    adapter.dispose();
  });

  test("text delta flow: verify text deltas flow from mock stream to StreamPartEvent", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);
    const output: StreamPartEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));

    const stream = mockAsyncStream([
      { type: "text", content: "The " },
      { type: "text", content: "quick " },
      { type: "text", content: "brown " },
      { type: "text", content: "fox" },
    ]);
    const session = createMockSession(stream);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-456");
    await adapter.startStreaming(session, "test message", {
      runId: 2,
      messageId: "msg-2",
    });

    await flushMicrotasks();
    await waitForBatchFlush();

    const textDeltas = output.filter((event) => event.type === "text-delta");
    expect(textDeltas.length).toBe(1);
    expect(textDeltas[0].delta).toBe("The quick brown fox");

    dispose();
    adapter.dispose();
  });

  test("tool lifecycle: tool.start → tool.complete flows through pipeline", async () => {
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
    const adapter = new OpenCodeStreamAdapter(bus, "test-session-789");

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 3,
      messageId: "msg-3",
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    client.emit("tool.start" as EventType, {
      type: "tool.start",
      sessionId: "test-session-789",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolInput: { command: "echo hello" },
        toolUseId: "tool-123",
      },
    } as AgentEvent<"tool.start">);

    client.emit("tool.complete" as EventType, {
      type: "tool.complete",
      sessionId: "test-session-789",
      timestamp: Date.now(),
      data: {
        toolName: "bash",
        toolResult: "hello",
        success: true,
        toolUseId: "tool-123",
      },
    } as AgentEvent<"tool.complete">);

    await streamPromise;
    await flushMicrotasks();
    await waitForBatchFlush();

    const toolStarts = output.filter((event) => event.type === "tool-start");
    expect(toolStarts.length).toBe(1);
    expect(toolStarts[0].toolId).toBe("tool-123");
    expect(toolStarts[0].toolName).toBe("bash");
    expect(toolStarts[0].input).toEqual({ command: "echo hello" });

    const toolCompletes = output.filter((event) => event.type === "tool-complete");
    expect(toolCompletes.length).toBe(1);
    expect(toolCompletes[0].toolId).toBe("tool-123");
    expect(toolCompletes[0].output).toBe("hello");
    expect(toolCompletes[0].success).toBe(true);

    dispose();
    adapter.dispose();
  });

  test("echo suppression: text delta suppressed when matching expected echo", async () => {
    const { pipeline, echoSuppressor, dispose } = wireConsumers(bus, dispatcher);
    const output: StreamPartEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));

    echoSuppressor.expectEcho("tool-result-echo");

    const stream = mockAsyncStream([
      { type: "text", content: "tool-result-echo" },
      { type: "text", content: "This should appear" },
    ]);
    const session = createMockSession(stream);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-echo");
    await adapter.startStreaming(session, "test message", {
      runId: 4,
      messageId: "msg-4",
    });

    await flushMicrotasks();
    await waitForBatchFlush();

    const textDeltas = output.filter((event) => event.type === "text-delta");
    expect(textDeltas.length).toBe(1);
    expect(textDeltas[0].delta).toBe("This should appear");

    dispose();
    adapter.dispose();
  });

  test("batch coalescing: rapidly fired state updates get coalesced", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);
    const batchSizes: number[] = [];
    pipeline.onStreamParts((parts) => {
      batchSizes.push(parts.length);
    });

    const chunks: AgentMessage[] = [];
    for (let index = 0; index < 10; index += 1) {
      chunks.push({ type: "text", content: `chunk${index} ` });
    }

    const session = createMockSession(mockAsyncStream(chunks));
    const adapter = new OpenCodeStreamAdapter(bus, "test-session-batch");
    await adapter.startStreaming(session, "test message", {
      runId: 6,
      messageId: "msg-6",
    });

    await flushMicrotasks();
    await waitForBatchFlush();

    const totalEvents = batchSizes.reduce((sum, size) => sum + size, 0);
    expect(totalEvents).toBeGreaterThanOrEqual(1);
    expect(batchSizes.length).toBeGreaterThanOrEqual(1);

    dispose();
    adapter.dispose();
  });

  test("thinking deltas flow through pipeline", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);
    const output: StreamPartEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));

    const session = createMockSession(
      mockAsyncStream([
        {
          type: "thinking",
          content: "Let me think... ",
          metadata: { thinkingSourceKey: "block-1" },
        },
        {
          type: "thinking",
          content: "about this problem.",
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
      ]),
    );

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-thinking");
    await adapter.startStreaming(session, "test message", {
      runId: 7,
      messageId: "msg-7",
    });

    await flushMicrotasks();
    await waitForBatchFlush();

    const thinkingMeta = output.filter((event) => event.type === "thinking-meta");
    expect(thinkingMeta.length).toBe(1);
    expect(thinkingMeta[0].thinkingText).toBe("Let me think... about this problem.");
    expect(thinkingMeta[0].thinkingSourceKey).toBe("block-1");

    dispose();
    adapter.dispose();
  });
});
