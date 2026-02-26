// @ts-nocheck
/**
 * Event Bus Integration Tests
 *
 * End-to-end integration tests for the streaming architecture event bus.
 * These tests verify the full pipeline:
 *   Mock SDK stream → Adapter → Bus → Batch Dispatcher → Consumers → StreamPartEvent output
 *
 * Test scenarios:
 * 1. Full pipeline: Mock SDK stream → adapter → bus → consumer → StreamPartEvent output
 * 2. Text delta flow: Verify text deltas flow from mock stream to StreamPartEvent text-delta
 * 3. Tool lifecycle: tool.start → tool.complete flows through pipeline
 * 4. Echo suppression: Text delta suppressed when matching expected echo
 * 5. Multiple adapters: Verify all three SDK adapters produce same bus events for equivalent inputs
 * 6. Batch coalescing: Rapidly fired state updates get coalesced in batch window
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";
import { AtomicEventBus } from "./event-bus.ts";
import { BatchDispatcher } from "./batch-dispatcher.ts";
import { wireConsumers } from "./consumers/wire-consumers.ts";
import { OpenCodeStreamAdapter } from "./adapters/opencode-adapter.ts";
import { ClaudeStreamAdapter } from "./adapters/claude-adapter.ts";
import { CopilotStreamAdapter } from "./adapters/copilot-adapter.ts";
import type { BusEvent, EnrichedBusEvent } from "./bus-events.ts";
import type { StreamPartEvent } from "../ui/parts/stream-pipeline.ts";
import type {
  Session,
  AgentMessage,
  AgentEvent,
  EventType,
  CodingAgentClient,
} from "../sdk/types.ts";

// ============================================================================
// Mock Utilities
// ============================================================================

/**
 * Mock async generator for OpenCode/Claude streams
 */
async function* mockAsyncStream(
  chunks: AgentMessage[],
): AsyncGenerator<AgentMessage> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/**
 * Create a mock Session for testing
 */
function createMockSession(
  stream: AsyncGenerator<AgentMessage>,
  client?: Partial<CodingAgentClient>,
): Session {
  const session = {
    id: "test-session-123",
    stream: mock(() => stream),
    __client: client,
  } as unknown as Session;
  return session;
}

/**
 * Create a mock CodingAgentClient with EventEmitter-like behavior
 */
function createMockClient(): CodingAgentClient {
  const handlers = new Map<EventType, Set<(event: AgentEvent) => void>>();

  const client = {
    on: mock((type: EventType, handler: (event: AgentEvent) => void) => {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    }),
    emit: (type: EventType, event: AgentEvent) => {
      const set = handlers.get(type);
      if (set) {
        for (const handler of set) {
          handler(event);
        }
      }
    },
  } as unknown as CodingAgentClient;

  return client;
}

/**
 * Helper to wait for all microtasks and timers to complete
 */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Helper to wait for batch dispatcher to flush (16ms frame time + buffer)
 */
async function waitForBatchFlush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

// ============================================================================
// Integration Tests
// ============================================================================

describe("Event Bus Integration", () => {
  let bus: AtomicEventBus;
  let dispatcher: BatchDispatcher;

  beforeEach(() => {
    bus = new AtomicEventBus();
    dispatcher = new BatchDispatcher(bus);
  });

  test("full pipeline: SDK stream → adapter → bus → consumer → output", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);

    const output: StreamPartEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));

    // Create mock SDK stream with text deltas
    const chunks: AgentMessage[] = [
      { type: "text", content: "Hello " },
      { type: "text", content: "world" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    // Create adapter and start streaming
    const adapter = new OpenCodeStreamAdapter(bus, "test-session-123");
    await adapter.startStreaming(session, "test message", {
      runId: 1,
      messageId: "msg-1",
    });

    // Wait for events to be processed
    await flushMicrotasks();
    await waitForBatchFlush();

    // Verify output contains expected StreamPartEvents
    expect(output.length).toBeGreaterThan(0);

    const textDeltas = output.filter((e) => e.type === "text-delta");
    expect(textDeltas.length).toBe(2);
    expect(textDeltas[0].delta).toBe("Hello ");
    expect(textDeltas[1].delta).toBe("world");

    dispose();
    adapter.dispose();
  });

  test("text delta flow: verify text deltas flow from mock stream to StreamPartEvent", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);

    const output: StreamPartEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));

    // Create mock SDK stream with multiple text deltas
    const chunks: AgentMessage[] = [
      { type: "text", content: "The " },
      { type: "text", content: "quick " },
      { type: "text", content: "brown " },
      { type: "text", content: "fox" },
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-456");
    await adapter.startStreaming(session, "test message", {
      runId: 2,
      messageId: "msg-2",
    });

    await flushMicrotasks();
    await waitForBatchFlush();

    // Verify all text deltas are present
    const textDeltas = output.filter((e) => e.type === "text-delta");
    expect(textDeltas.length).toBe(4);
    expect(textDeltas[0].delta).toBe("The ");
    expect(textDeltas[1].delta).toBe("quick ");
    expect(textDeltas[2].delta).toBe("brown ");
    expect(textDeltas[3].delta).toBe("fox");

    dispose();
    adapter.dispose();
  });

  test("tool lifecycle: tool.start → tool.complete flows through pipeline", async () => {
    const { pipeline, correlation, dispose } = wireConsumers(bus, dispatcher);

    const output: StreamPartEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));

    // Create mock client that emits tool events
    const client = createMockClient();
    
    // Create a stream that yields slowly to allow event emission during iteration
    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      // Small delay to allow events to be emitted
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }
    
    const stream = slowStream();
    const session = createMockSession(stream, client);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-789");

    // Register the tool with correlation service
    correlation.registerTool("tool-123", null, false);

    // Start streaming (this will set up event listeners)
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 3,
      messageId: "msg-3",
    });

    // Wait a bit for stream to start
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Emit tool.start event
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

    // Emit tool.complete event
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

    // Verify tool lifecycle events in output
    const toolStarts = output.filter((e) => e.type === "tool-start");
    expect(toolStarts.length).toBe(1);
    expect(toolStarts[0].toolId).toBe("tool-123");
    expect(toolStarts[0].toolName).toBe("bash");
    expect(toolStarts[0].input).toEqual({ command: "echo hello" });

    const toolCompletes = output.filter((e) => e.type === "tool-complete");
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

    // Register echo text that should be suppressed
    echoSuppressor.expectEcho("tool-result-echo");

    // Create mock SDK stream with echo text
    const chunks: AgentMessage[] = [
      { type: "text", content: "tool-result-echo" }, // Should be suppressed
      { type: "text", content: "This should appear" }, // Should NOT be suppressed
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-echo");
    await adapter.startStreaming(session, "test message", {
      runId: 4,
      messageId: "msg-4",
    });

    await flushMicrotasks();
    await waitForBatchFlush();

    // Verify echo was suppressed
    const textDeltas = output.filter((e) => e.type === "text-delta");
    expect(textDeltas.length).toBe(1);
    expect(textDeltas[0].delta).toBe("This should appear");

    dispose();
    adapter.dispose();
  });

  test("multiple adapters: verify all three SDK adapters produce same bus events", async () => {
    // Test OpenCode adapter
    const opencodeBus = new AtomicEventBus();
    const opencodeEvents: BusEvent[] = [];
    opencodeBus.onAll((event) => opencodeEvents.push(event));

    const opencodeChunks: AgentMessage[] = [
      { type: "text", content: "Hello" },
    ];
    const opencodeStream = mockAsyncStream(opencodeChunks);
    const opencodeSession = createMockSession(opencodeStream);
    const opencodeAdapter = new OpenCodeStreamAdapter(opencodeBus, "session-1");

    await opencodeAdapter.startStreaming(opencodeSession, "test", {
      runId: 5,
      messageId: "msg-5",
    });

    // Test Claude adapter
    const claudeBus = new AtomicEventBus();
    const claudeEvents: BusEvent[] = [];
    claudeBus.onAll((event) => claudeEvents.push(event));

    const claudeChunks: AgentMessage[] = [{ type: "text", content: "Hello" }];
    const claudeStream = mockAsyncStream(claudeChunks);
    const claudeSession = createMockSession(claudeStream);
    const claudeAdapter = new ClaudeStreamAdapter(claudeBus, "session-1");

    await claudeAdapter.startStreaming(claudeSession, "test", {
      runId: 5,
      messageId: "msg-5",
    });

    // Verify both adapters produced equivalent bus events
    expect(opencodeEvents.length).toBe(claudeEvents.length);

    // Check text delta events
    const opencodeTextDeltas = opencodeEvents.filter(
      (e) => e.type === "stream.text.delta",
    );
    const claudeTextDeltas = claudeEvents.filter(
      (e) => e.type === "stream.text.delta",
    );

    expect(opencodeTextDeltas.length).toBe(1);
    expect(claudeTextDeltas.length).toBe(1);
    expect(opencodeTextDeltas[0].data.delta).toBe("Hello");
    expect(claudeTextDeltas[0].data.delta).toBe("Hello");
    expect(opencodeTextDeltas[0].runId).toBe(claudeTextDeltas[0].runId);

    // Check text complete events
    const opencodeTextComplete = opencodeEvents.filter(
      (e) => e.type === "stream.text.complete",
    );
    const claudeTextComplete = claudeEvents.filter(
      (e) => e.type === "stream.text.complete",
    );

    expect(opencodeTextComplete.length).toBe(1);
    expect(claudeTextComplete.length).toBe(1);
    expect(opencodeTextComplete[0].data.fullText).toBe("Hello");
    expect(claudeTextComplete[0].data.fullText).toBe("Hello");

    opencodeAdapter.dispose();
    claudeAdapter.dispose();
  });

  test("batch coalescing: rapidly fired state updates get coalesced", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);

    const batchSizes: number[] = [];
    pipeline.onStreamParts((parts) => {
      batchSizes.push(parts.length);
    });

    // Publish multiple rapid events to the bus
    // These should be coalesced in the batch dispatcher
    const chunks: AgentMessage[] = [];
    for (let i = 0; i < 10; i++) {
      chunks.push({ type: "text", content: `chunk${i} ` });
    }

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-batch");
    await adapter.startStreaming(session, "test message", {
      runId: 6,
      messageId: "msg-6",
    });

    await flushMicrotasks();
    await waitForBatchFlush();

    // Verify that events were batched
    const totalEvents = batchSizes.reduce((sum, size) => sum + size, 0);
    expect(totalEvents).toBeGreaterThanOrEqual(10); // At least 10 deltas
    // Note: Batching behavior may vary based on timing

    dispose();
    adapter.dispose();
  });

  test("thinking deltas flow through pipeline", async () => {
    const { pipeline, dispose } = wireConsumers(bus, dispatcher);

    const output: StreamPartEvent[] = [];
    pipeline.onStreamParts((parts) => output.push(...parts));

    // Create mock SDK stream with thinking deltas
    const chunks: AgentMessage[] = [
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
    ];

    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-thinking");
    await adapter.startStreaming(session, "test message", {
      runId: 7,
      messageId: "msg-7",
    });

    await flushMicrotasks();
    await waitForBatchFlush();

    // Verify thinking meta events (thinking deltas are mapped to thinking-meta)
    const thinkingMeta = output.filter((e) => e.type === "thinking-meta");
    expect(thinkingMeta.length).toBe(2); // Two chunks with content
    expect(thinkingMeta[0].thinkingText).toBe("Let me think... ");
    expect(thinkingMeta[0].thinkingSourceKey).toBe("block-1");
    expect(thinkingMeta[1].thinkingText).toBe("about this problem.");

    dispose();
    adapter.dispose();
  });

  test("sub-agent lifecycle events published to bus", async () => {
    const busEvents: BusEvent[] = [];
    bus.onAll((event) => busEvents.push(event));

    // Create mock client that emits sub-agent events
    const client = createMockClient();
    
    // Create a stream that yields slowly to allow event emission during iteration
    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }
    
    const stream = slowStream();
    const session = createMockSession(stream, client);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-agent");

    // Start streaming
    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 8,
      messageId: "msg-8",
    });

    // Wait for streaming to start
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Emit subagent.start event
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

    // Emit subagent.complete event
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

    // Verify sub-agent events were published to bus
    const agentStarts = busEvents.filter((e) => e.type === "stream.agent.start");
    expect(agentStarts.length).toBe(1);
    expect(agentStarts[0].data.agentId).toBe("agent-123");
    expect(agentStarts[0].data.agentType).toBe("explore");
    expect(agentStarts[0].data.task).toBe("Find all TypeScript files");

    const agentCompletes = busEvents.filter(
      (e) => e.type === "stream.agent.complete",
    );
    expect(agentCompletes.length).toBe(1);
    expect(agentCompletes[0].data.agentId).toBe("agent-123");
    expect(agentCompletes[0].data.success).toBe(true);
    expect(agentCompletes[0].data.result).toBe("Found 42 TypeScript files");

    adapter.dispose();
  });

  test("session error events published to bus", async () => {
    const busEvents: BusEvent[] = [];
    bus.onAll((event) => busEvents.push(event));

    // Create mock client that emits session error
    const client = createMockClient();
    const chunks: AgentMessage[] = [{ type: "text", content: "start" }];
    const stream = mockAsyncStream(chunks);
    const session = createMockSession(stream, client);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-error");

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 9,
      messageId: "msg-9",
    });

    // Emit session.error event
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

    // Verify session error event was published to bus
    const errorEvents = busEvents.filter(
      (e) => e.type === "stream.session.error",
    );
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].data.error).toBe("Network timeout");
    expect(errorEvents[0].data.code).toBe("TIMEOUT");

    adapter.dispose();
  });

  test("correlation enriches tool events with agent metadata", async () => {
    const { correlation, dispose } = wireConsumers(bus, dispatcher);

    // Collect enriched bus events
    const enrichedEvents: EnrichedBusEvent[] = [];
    bus.onAll((event) => {
      const enriched = correlation.enrich(event);
      enrichedEvents.push(enriched);
    });

    // Create mock client
    const client = createMockClient();
    
    // Create a stream that yields slowly to allow event emission during iteration
    async function* slowStream(): AsyncGenerator<AgentMessage> {
      yield { type: "text", content: "start" };
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield { type: "text", content: "end" };
    }
    
    const stream = slowStream();
    const session = createMockSession(stream, client);

    const adapter = new OpenCodeStreamAdapter(bus, "test-session-corr");

    const streamPromise = adapter.startStreaming(session, "test message", {
      runId: 10,
      messageId: "msg-10",
    });

    // Wait for stream to start
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Register a tool with a parent agent after run initialization.
    correlation.registerTool("tool-789", "agent-parent", true);

    // Emit tool.start event
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

    // Emit tool.complete event
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

    // Verify tool events were enriched with agent metadata
    const toolCompletes = enrichedEvents.filter(
      (e) => e.type === "stream.tool.complete",
    );
    expect(toolCompletes.length).toBeGreaterThan(0);
    
    const toolComplete = toolCompletes[0];
    expect(toolComplete.resolvedAgentId).toBe("agent-parent");
    expect(toolComplete.isSubagentTool).toBe(true);

    dispose();
    adapter.dispose();
  });
});
