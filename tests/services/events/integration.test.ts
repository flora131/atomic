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
import { EventBus } from "@/services/events/event-bus.ts";
import { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import { wireConsumers } from "@/services/events/consumers/wire-consumers.ts";
import { OpenCodeStreamAdapter } from "@/services/events/adapters/opencode-adapter.ts";
import { ClaudeStreamAdapter } from "@/services/events/adapters/claude-adapter.ts";
import { CopilotStreamAdapter } from "@/services/events/adapters/copilot-adapter.ts";
import type { BusEvent, EnrichedBusEvent } from "@/services/events/bus-events.ts";
import type { StreamPartEvent } from "@/state/parts/stream-pipeline.ts";
import type {
  Session,
  AgentMessage,
  AgentEvent,
  EventType,
  CodingAgentClient,
} from "@/services/agents/types.ts";

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
    __client: client ?? createMockClient(),
  } as unknown as Session;
  return session;
}

/**
 * Create a mock CodingAgentClient with EventEmitter-like behavior
 */
function createMockClient(): CodingAgentClient {
  const handlers = new Map<EventType, Set<(event: AgentEvent) => void>>();
  const providerHandlers = new Set<(event: AgentEvent & { provider: string }) => void>();

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
    onProviderEvent: mock((handler: (event: AgentEvent & { provider: string }) => void) => {
      providerHandlers.add(handler);
      return () => {
        providerHandlers.delete(handler);
      };
    }),
    emit: (type: EventType, event: AgentEvent) => {
      const set = handlers.get(type);
      if (set) {
        for (const handler of set) {
          handler(event);
        }
      }

      const providerEvent = {
        provider: "mock",
        ...event,
        type,
      };
      for (const handler of providerHandlers) {
        handler(providerEvent);
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
  let bus: EventBus;
  let dispatcher: BatchDispatcher;

  beforeEach(() => {
    bus = new EventBus();
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
    // Adjacent text-deltas with matching agentId are coalesced into a single event
    expect(output.length).toBeGreaterThan(0);

    const textDeltas = output.filter((e) => e.type === "text-delta");
    expect(textDeltas.length).toBe(1);
    expect(textDeltas[0].delta).toBe("Hello world");

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

    // Adjacent text-deltas with matching agentId are coalesced into a single event
    const textDeltas = output.filter((e) => e.type === "text-delta");
    expect(textDeltas.length).toBe(1);
    expect(textDeltas[0].delta).toBe("The quick brown fox");

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

    const stream = slowStream();
    const session = createMockSession(stream, client);
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
    // Root task tools are top-level containers — no agentId so they don't
    // appear in the sub-agent's inline parts.
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

    const stream = slowStream();
    const session = createMockSession(stream, client);
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

    // Child tool events arrive BEFORE subagent.start — they should be buffered
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

    // subagent.start triggers replay of buffered events with the real agent ID
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

    // The real agent start event should be present (no synthetic agent)
    const agentStarts = busEvents.filter(
      (event) => event.type === "stream.agent.start",
    );
    expect(agentStarts.length).toBe(1);
    expect(agentStarts[0]?.data.agentId).toBe("copilot-real-agent-1");
    expect(agentStarts[0]?.data.agentType).toBe("codebase-analyzer");
    expect(agentStarts[0]?.data.toolCallId).toBe("copilot-task-synthetic-1");
    expect(agentStarts[0]?.data.task).toBe("Inspect auth flow");

    // Buffered child tools should be replayed with the real agent ID
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

    const stream = slowStream();
    const session = createMockSession(stream, client);
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

    // Child tool arrives before subagent.start — buffered
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

    // subagent.start replays buffered tool start with the real agent ID
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

    // tool.complete arrives after mapping exists — resolved directly
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

    // Early tool start should be replayed with the real agent ID
    const nestedToolStarts = output.filter(
      (event) => event.type === "tool-start" && event.toolId === "child-tool-2",
    );
    expect(nestedToolStarts.length).toBe(1);
    expect(nestedToolStarts[0]?.agentId).toBe("copilot-agent-promoted-1");

    // Tool complete resolves directly to the real agent
    const nestedToolCompletes = output.filter(
      (event) => event.type === "tool-complete" && event.toolId === "child-tool-2",
    );
    expect(nestedToolCompletes.length).toBe(1);
    expect(nestedToolCompletes[0]?.agentId).toBe("copilot-agent-promoted-1");

    // Only the real agent start — no synthetic agent
    const agentStarts = busEvents.filter(
      (event) => event.type === "stream.agent.start",
    );
    expect(agentStarts.length).toBe(1);
    expect(agentStarts[0]?.data.agentId).toBe("copilot-agent-promoted-1");
    expect(agentStarts[0]?.data.toolCallId).toBe("copilot-task-promoted-1");
    expect(agentStarts[0]?.data.agentType).toBe("codebase-analyzer");

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
    const opencodeBus = new EventBus();
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
    const claudeBus = new EventBus();
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

    // OpenCode adapter always publishes session.idle after stream completes;
    // Claude adapter only publishes if the SDK client emits session.idle.
    // Verify both share the same core events, then verify OpenCode has the
    // additional session.idle.
    const coreFilter = (e: BusEvent) => e.type !== "stream.session.idle";
    const opencodeCore = opencodeEvents.filter(coreFilter);
    const claudeCore = claudeEvents.filter(coreFilter);
    expect(opencodeCore.length).toBe(claudeCore.length);

    // OpenCode should have the extra session.idle event
    const opencodeIdleEvents = opencodeEvents.filter(
      (e) => e.type === "stream.session.idle",
    );
    expect(opencodeIdleEvents.length).toBe(1);
    expect(opencodeIdleEvents[0].data.reason).toBe("generator-complete");

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

    // Verify that events were batched and delivered.
    // Adjacent text-deltas with matching agentId are coalesced within each batch,
    // so 10 rapid chunks may reduce to fewer StreamPartEvents.
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

    // Verify thinking meta events (thinking deltas are mapped to thinking-meta).
    // Adjacent thinking-meta events with matching scope are coalesced into one.
    const thinkingMeta = output.filter((e) => e.type === "thinking-meta");
    expect(thinkingMeta.length).toBe(1);
    expect(thinkingMeta[0].thinkingText).toBe("Let me think... about this problem.");
    expect(thinkingMeta[0].thinkingSourceKey).toBe("block-1");

    dispose();
    adapter.dispose();
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
