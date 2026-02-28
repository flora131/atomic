/**
 * SubagentStreamAdapter Tests
 *
 * Unit tests for the sub-agent stream adapter that bridges SDK session
 * streams to the shared event bus. Tests verify:
 * 1. Text deltas are published and accumulated correctly
 * 2. Thinking deltas and completion events are published
 * 3. Tool use/result events are published with correct IDs
 * 4. Token usage is tracked and published
 * 5. stream.text.complete is published on stream end
 * 6. Abort signal stops stream consumption
 * 7. Stream errors are caught and published
 * 8. SubagentStreamResult is returned with correct metadata
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { EventBus } from "../event-bus.ts";
import { SubagentStreamAdapter } from "./subagent-adapter.ts";
import type { BusEvent, BusEventType } from "../bus-events.ts";
import type { AgentMessage } from "../../sdk/types.ts";

// ============================================================================
// Mock Utilities
// ============================================================================

/**
 * Create an async iterable from an array of AgentMessages.
 */
async function* mockStream(
  chunks: AgentMessage[],
): AsyncGenerator<AgentMessage> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/**
 * Create an async iterable that throws after yielding some chunks.
 */
async function* errorStream(
  chunks: AgentMessage[],
  error: Error,
): AsyncGenerator<AgentMessage> {
  for (const chunk of chunks) {
    yield chunk;
  }
  throw error;
}

/**
 * Collect all events published to the bus.
 */
function collectEvents(bus: EventBus): BusEvent[] {
  const events: BusEvent[] = [];
  bus.onAll((event) => events.push(event));
  return events;
}

/**
 * Filter events by type.
 */
function filterByType<T extends BusEventType>(
  events: BusEvent[],
  type: T,
): BusEvent<T>[] {
  return events.filter((e) => e.type === type) as BusEvent<T>[];
}

// ============================================================================
// Tests
// ============================================================================

describe("SubagentStreamAdapter", () => {
  let bus: EventBus;
  let events: BusEvent[];

  const SESSION_ID = "parent-session-123";
  const AGENT_ID = "worker-1";
  const RUN_ID = 42;

  beforeEach(() => {
    bus = new EventBus();
    events = collectEvents(bus);
  });

  function createAdapter(overrides?: {
    parentAgentId?: string;
  }): SubagentStreamAdapter {
    return new SubagentStreamAdapter({
      bus,
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
      runId: RUN_ID,
      parentAgentId: overrides?.parentAgentId,
    });
  }

  // --------------------------------------------------------------------------
  // Text Events
  // --------------------------------------------------------------------------

  describe("text events", () => {
    test("publishes stream.text.delta for text chunks", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        { type: "text", content: "Hello " },
        { type: "text", content: "world" },
      ]);

      await adapter.consumeStream(stream);

      const deltas = filterByType(events, "stream.text.delta");
      expect(deltas).toHaveLength(2);
      expect(deltas[0]!.data.delta).toBe("Hello ");
      expect(deltas[1]!.data.delta).toBe("world");
      expect(deltas[0]!.sessionId).toBe(SESSION_ID);
      expect(deltas[0]!.runId).toBe(RUN_ID);
      expect(deltas[0]!.data.messageId).toBe(`subagent-${AGENT_ID}`);
    });

    test("accumulates full text in SubagentStreamResult", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        { type: "text", content: "Hello " },
        { type: "text", content: "world" },
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.output).toBe("Hello world");
      expect(result.success).toBe(true);
      expect(result.agentId).toBe(AGENT_ID);
    });

    test("publishes stream.text.complete on stream end", async () => {
      const adapter = createAdapter();
      const stream = mockStream([{ type: "text", content: "done" }]);

      await adapter.consumeStream(stream);

      const completes = filterByType(events, "stream.text.complete");
      expect(completes).toHaveLength(1);
      expect(completes[0]!.data.fullText).toBe("done");
      expect(completes[0]!.data.messageId).toBe(`subagent-${AGENT_ID}`);
    });

    test("ignores non-string text content", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        { type: "text", content: { structured: true } as unknown as string },
        { type: "text", content: "actual text" },
      ]);

      const result = await adapter.consumeStream(stream);

      const deltas = filterByType(events, "stream.text.delta");
      expect(deltas).toHaveLength(1);
      expect(result.output).toBe("actual text");
    });
  });

  // --------------------------------------------------------------------------
  // Thinking Events
  // --------------------------------------------------------------------------

  describe("thinking events", () => {
    test("publishes stream.thinking.delta for thinking chunks", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "thinking",
          content: "Let me think...",
          metadata: { thinkingSourceKey: "source-1" },
        },
      ]);

      await adapter.consumeStream(stream);

      const deltas = filterByType(events, "stream.thinking.delta");
      expect(deltas).toHaveLength(1);
      expect(deltas[0]!.data.delta).toBe("Let me think...");
      expect(deltas[0]!.data.sourceKey).toBe("source-1");
      expect(deltas[0]!.sessionId).toBe(SESSION_ID);
    });

    test("uses 'default' sourceKey when not specified", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        { type: "thinking", content: "thinking..." },
      ]);

      await adapter.consumeStream(stream);

      const deltas = filterByType(events, "stream.thinking.delta");
      expect(deltas).toHaveLength(1);
      expect(deltas[0]!.data.sourceKey).toBe("default");
    });

    test("publishes stream.thinking.complete with duration", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "thinking",
          content: "thinking...",
          metadata: { thinkingSourceKey: "src-1" },
        },
        {
          type: "thinking",
          content: "",
          metadata: {
            thinkingSourceKey: "src-1",
            streamingStats: { thinkingMs: 1500 },
          },
        },
      ]);

      await adapter.consumeStream(stream);

      const completes = filterByType(events, "stream.thinking.complete");
      expect(completes).toHaveLength(1);
      expect(completes[0]!.data.sourceKey).toBe("src-1");
      expect(completes[0]!.data.durationMs).toBe(1500);
    });

    test("tracks thinking duration in result", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "thinking",
          content: "thinking...",
          metadata: { thinkingSourceKey: "src-1" },
        },
        {
          type: "thinking",
          content: "",
          metadata: {
            thinkingSourceKey: "src-1",
            streamingStats: { thinkingMs: 1200 },
          },
        },
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.thinkingDurationMs).toBe(1200);
    });
  });

  // --------------------------------------------------------------------------
  // Tool Events
  // --------------------------------------------------------------------------

  describe("tool events", () => {
    test("publishes stream.tool.start for tool_use chunks", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "tool-abc",
            input: { command: "ls" },
          } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const starts = filterByType(events, "stream.tool.start");
      expect(starts).toHaveLength(1);
      expect(starts[0]!.data.toolName).toBe("bash");
      expect(starts[0]!.data.toolId).toBe("tool-abc");
      expect(starts[0]!.data.toolInput).toEqual({ command: "ls" });
    });

    test("publishes stream.tool.complete for tool_result chunks", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "tool-abc",
            input: {},
          } as unknown as string,
        },
        {
          type: "tool_result",
          content: "file.txt" as string,
          tool_use_id: "tool-abc",
          toolName: "bash",
        } as unknown as AgentMessage,
      ]);

      await adapter.consumeStream(stream);

      const completes = filterByType(events, "stream.tool.complete");
      expect(completes).toHaveLength(1);
      expect(completes[0]!.data.toolId).toBe("tool-abc");
      expect(completes[0]!.data.toolName).toBe("bash");
      expect(completes[0]!.data.success).toBe(true);
    });

    test("increments toolUses count", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "t1",
            input: {},
          } as unknown as string,
        },
        {
          type: "tool_use",
          content: {
            name: "edit",
            toolUseId: "t2",
            input: {},
          } as unknown as string,
        },
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.toolUses).toBe(2);
    });

    test("records tool details with duration", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "t1",
            input: {},
          } as unknown as string,
        },
        {
          type: "tool_result",
          content: "ok",
          tool_use_id: "t1",
          toolName: "bash",
        } as unknown as AgentMessage,
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.toolDetails).toBeDefined();
      expect(result.toolDetails).toHaveLength(1);
      expect(result.toolDetails![0]!.toolId).toBe("t1");
      expect(result.toolDetails![0]!.toolName).toBe("bash");
      expect(result.toolDetails![0]!.success).toBe(true);
      expect(result.toolDetails![0]!.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("tracks tool errors in details", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "t1",
            input: {},
          } as unknown as string,
        },
        {
          type: "tool_result",
          content: { error: "command not found" },
          tool_use_id: "t1",
          toolName: "bash",
          is_error: true,
        } as unknown as AgentMessage,
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.toolDetails![0]!.success).toBe(false);

      const completes = filterByType(events, "stream.tool.complete");
      expect(completes[0]!.data.success).toBe(false);
      expect(completes[0]!.data.error).toBe("command not found");
    });

    test("generates synthetic tool IDs when not provided", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "bash", input: {} } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const starts = filterByType(events, "stream.tool.start");
      expect(starts[0]!.data.toolId).toContain(`tool_${AGENT_ID}_bash_`);
    });

    test("sets parentAgentId on tool start events", async () => {
      const adapter = createAdapter({ parentAgentId: "parent-agent-1" });
      const stream = mockStream([
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "t1",
            input: {},
          } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const starts = filterByType(events, "stream.tool.start");
      expect(starts[0]!.data.parentAgentId).toBe("worker-1");
    });
  });

  // --------------------------------------------------------------------------
  // Token Usage Events
  // --------------------------------------------------------------------------

  describe("token usage", () => {
    test("publishes stream.usage from chunk metadata", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "text",
          content: "hello",
          metadata: {
            tokenUsage: { inputTokens: 100, outputTokens: 50 },
            model: "claude-sonnet-4-5-20250514",
          },
        },
      ]);

      await adapter.consumeStream(stream);

      const usages = filterByType(events, "stream.usage");
      expect(usages).toHaveLength(1);
      expect(usages[0]!.data.inputTokens).toBe(100);
      expect(usages[0]!.data.outputTokens).toBe(50);
      expect(usages[0]!.data.model).toBe("claude-sonnet-4-5-20250514");
    });

    test("accumulates token usage across chunks", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "text",
          content: "a",
          metadata: {
            tokenUsage: { inputTokens: 100, outputTokens: 50 },
          },
        },
        {
          type: "text",
          content: "b",
          metadata: {
            tokenUsage: { inputTokens: 200, outputTokens: 75 },
          },
        },
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.tokenUsage).toEqual({
        inputTokens: 300,
        outputTokens: 125,
      });

      const usages = filterByType(events, "stream.usage");
      expect(usages).toHaveLength(2);
      // Second event should have accumulated totals
      expect(usages[1]!.data.inputTokens).toBe(300);
      expect(usages[1]!.data.outputTokens).toBe(125);
    });

    test("ignores zero token usage", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "text",
          content: "hello",
          metadata: {
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
          },
        },
      ]);

      await adapter.consumeStream(stream);

      const usages = filterByType(events, "stream.usage");
      expect(usages).toHaveLength(0);
    });

    test("includes tokenUsage in result when present", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "text",
          content: "hi",
          metadata: {
            tokenUsage: { inputTokens: 50, outputTokens: 25 },
          },
        },
      ]);

      const result = await adapter.consumeStream(stream);

      expect(result.tokenUsage).toBeDefined();
      expect(result.tokenUsage!.inputTokens).toBe(50);
    });

    test("omits tokenUsage from result when no tokens used", async () => {
      const adapter = createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      const result = await adapter.consumeStream(stream);

      expect(result.tokenUsage).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Abort Handling
  // --------------------------------------------------------------------------

  describe("abort handling", () => {
    test("stops consuming stream when abort signal fires", async () => {
      const abortController = new AbortController();
      const adapter = createAdapter();

      // Create a stream that yields chunks with a delay
      async function* slowStream(): AsyncGenerator<AgentMessage> {
        yield { type: "text", content: "first " };
        abortController.abort();
        yield { type: "text", content: "second " };
        yield { type: "text", content: "third" };
      }

      const result = await adapter.consumeStream(
        slowStream(),
        abortController.signal,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Sub-agent was aborted");
      // Should have at least the first chunk
      expect(result.output).toContain("first");
    });

    test("publishes stream.text.complete on abort", async () => {
      const abortController = new AbortController();
      abortController.abort(); // pre-abort

      const adapter = createAdapter();
      const stream = mockStream([{ type: "text", content: "test" }]);

      await adapter.consumeStream(stream, abortController.signal);

      const completes = filterByType(events, "stream.text.complete");
      expect(completes).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Error Handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    test("catches stream errors and returns failure result", async () => {
      const adapter = createAdapter();
      const stream = errorStream(
        [{ type: "text", content: "partial " }],
        new Error("Stream broke"),
      );

      const result = await adapter.consumeStream(stream);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Stream broke");
      expect(result.output).toBe("partial ");
    });

    test("publishes stream.session.error on stream error", async () => {
      const adapter = createAdapter();
      const stream = errorStream([], new Error("Connection lost"));

      await adapter.consumeStream(stream);

      const errors = filterByType(events, "stream.session.error");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.data.error).toBe("Connection lost");
    });

    test("publishes stream.text.complete after error", async () => {
      const adapter = createAdapter();
      const stream = errorStream(
        [{ type: "text", content: "some text" }],
        new Error("fail"),
      );

      await adapter.consumeStream(stream);

      const completes = filterByType(events, "stream.text.complete");
      expect(completes).toHaveLength(1);
      expect(completes[0]!.data.fullText).toBe("some text");
    });

    test("handles non-Error thrown values", async () => {
      const adapter = createAdapter();

      async function* throwingStream(): AsyncGenerator<AgentMessage> {
        throw "string error";
      }

      const result = await adapter.consumeStream(throwingStream());

      expect(result.success).toBe(false);
      expect(result.error).toBe("string error");
    });
  });

  // --------------------------------------------------------------------------
  // Result Metadata
  // --------------------------------------------------------------------------

  describe("result metadata", () => {
    test("includes durationMs in result", async () => {
      const adapter = createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      const result = await adapter.consumeStream(stream);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("omits thinkingDurationMs when no thinking occurred", async () => {
      const adapter = createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      const result = await adapter.consumeStream(stream);

      expect(result.thinkingDurationMs).toBeUndefined();
    });

    test("omits toolDetails when no tools used", async () => {
      const adapter = createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      const result = await adapter.consumeStream(stream);

      expect(result.toolDetails).toBeUndefined();
    });

    test("returns empty string output when no text chunks", async () => {
      const adapter = createAdapter();
      const stream = mockStream([]);

      const result = await adapter.consumeStream(stream);

      expect(result.output).toBe("");
      expect(result.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Event Envelope
  // --------------------------------------------------------------------------

  describe("event envelope", () => {
    test("all events use parent sessionId", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        { type: "text", content: "hi" },
        {
          type: "tool_use",
          content: {
            name: "bash",
            toolUseId: "t1",
            input: {},
          } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      for (const event of events) {
        expect(event.sessionId).toBe(SESSION_ID);
      }
    });

    test("all events use correct runId", async () => {
      const adapter = createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      await adapter.consumeStream(stream);

      for (const event of events) {
        expect(event.runId).toBe(RUN_ID);
      }
    });

    test("all events have timestamps", async () => {
      const adapter = createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      await adapter.consumeStream(stream);

      for (const event of events) {
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Multiple Consumptions
  // --------------------------------------------------------------------------

  describe("reuse", () => {
    test("resets state between consumeStream calls", async () => {
      const adapter = createAdapter();

      const stream1 = mockStream([{ type: "text", content: "first" }]);
      const result1 = await adapter.consumeStream(stream1);
      expect(result1.output).toBe("first");

      const stream2 = mockStream([{ type: "text", content: "second" }]);
      const result2 = await adapter.consumeStream(stream2);
      expect(result2.output).toBe("second");
      // Should not accumulate from previous call
      expect(result2.output).not.toContain("first");
    });
  });

  // --------------------------------------------------------------------------
  // SubagentToolTracker Integration
  // --------------------------------------------------------------------------

  describe("tool tracker integration (stream.agent.update)", () => {
    test("publishes stream.agent.update on tool_use with tool name and count", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "grep", toolUseId: "t1", input: {} } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const updates = filterByType(events, "stream.agent.update");
      expect(updates.length).toBeGreaterThanOrEqual(1);
      // First update should be from tool start
      const startUpdate = updates[0]!;
      expect(startUpdate.data.agentId).toBe(AGENT_ID);
      expect(startUpdate.data.currentTool).toBe("grep");
      expect(startUpdate.data.toolUses).toBe(1);
    });

    test("publishes stream.agent.update on tool_result clearing current tool", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "grep", toolUseId: "t1", input: {} } as unknown as string,
        },
        {
          type: "tool_result",
          content: "found it",
          metadata: { toolId: "t1" },
        } as unknown as AgentMessage,
      ]);

      await adapter.consumeStream(stream);

      const updates = filterByType(events, "stream.agent.update");
      // Should have at least 2 updates: tool start + tool complete
      expect(updates.length).toBeGreaterThanOrEqual(2);
      const completeUpdate = updates[updates.length - 1]!;
      expect(completeUpdate.data.agentId).toBe(AGENT_ID);
      expect(completeUpdate.data.currentTool).toBeUndefined();
      expect(completeUpdate.data.toolUses).toBe(1);
    });

    test("increments tool count across multiple tool invocations", async () => {
      const adapter = createAdapter();
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "grep", toolUseId: "t1", input: {} } as unknown as string,
        },
        {
          type: "tool_result",
          content: "result1",
          metadata: { toolId: "t1" },
        } as unknown as AgentMessage,
        {
          type: "tool_use",
          content: { name: "view", toolUseId: "t2", input: {} } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const updates = filterByType(events, "stream.agent.update");
      // Last start update should show count=2
      const lastStartUpdate = updates.filter((u) => u.data.currentTool !== undefined).pop()!;
      expect(lastStartUpdate.data.toolUses).toBe(2);
      expect(lastStartUpdate.data.currentTool).toBe("view");
    });
  });

  // --------------------------------------------------------------------------
  // parentAgentId uses sub-agent ID (not parent session)
  // --------------------------------------------------------------------------

  describe("tool event agent attribution", () => {
    test("tool start parentAgentId is the sub-agent agentId, not the parent session", async () => {
      const adapter = createAdapter({ parentAgentId: "parent-session-456" });
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "bash", toolUseId: "t1", input: {} } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const starts = filterByType(events, "stream.tool.start");
      // Should be the sub-agent's own ID for CorrelationService lookup
      expect(starts[0]!.data.parentAgentId).toBe(AGENT_ID);
    });
  });

  // --------------------------------------------------------------------------
  // text-complete messageId prefix for sub-agent detection
  // --------------------------------------------------------------------------

  describe("text-complete sub-agent detection", () => {
    test("stream.text.complete has messageId prefixed with 'subagent-'", async () => {
      const adapter = createAdapter();
      const stream = mockStream([{ type: "text", content: "hello" }]);

      await adapter.consumeStream(stream);

      const completes = filterByType(events, "stream.text.complete");
      expect(completes.length).toBe(1);
      expect(completes[0]!.data.messageId).toBe(`subagent-${AGENT_ID}`);
      expect(completes[0]!.data.messageId.startsWith("subagent-")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // stream.agent.start before tool events (Fix 1A)
  // --------------------------------------------------------------------------

  describe("agent registration before tool events (Fix 1A)", () => {
    function createAdapterWithAgentType(overrides?: {
      parentAgentId?: string;
      agentType?: string;
      task?: string;
      isBackground?: boolean;
    }): SubagentStreamAdapter {
      return new SubagentStreamAdapter({
        bus,
        sessionId: SESSION_ID,
        agentId: AGENT_ID,
        runId: RUN_ID,
        parentAgentId: overrides?.parentAgentId,
        agentType: overrides?.agentType,
        task: overrides?.task,
        isBackground: overrides?.isBackground,
      });
    }

    test("publishes stream.agent.start synchronously in constructor when agentType is provided", () => {
      // Verify that creating the adapter immediately publishes stream.agent.start
      // (before consumeStream is ever called)
      createAdapterWithAgentType({
        agentType: "explore",
        task: "Search the codebase",
      });

      const agentStarts = filterByType(events, "stream.agent.start");
      expect(agentStarts).toHaveLength(1);
      expect(agentStarts[0]!.data.agentId).toBe(AGENT_ID);
      expect(agentStarts[0]!.data.agentType).toBe("explore");
      expect(agentStarts[0]!.data.task).toBe("Search the codebase");
    });

    test("publishes stream.agent.start before any tool events", async () => {
      const adapter = createAdapterWithAgentType({
        agentType: "explore",
        task: "Search the codebase",
      });
      const stream = mockStream([
        {
          type: "tool_use",
          content: { name: "grep", toolUseId: "t1", input: {} } as unknown as string,
        },
      ]);

      await adapter.consumeStream(stream);

      const agentStarts = filterByType(events, "stream.agent.start");
      const toolStarts = filterByType(events, "stream.tool.start");
      expect(agentStarts).toHaveLength(1);
      expect(toolStarts).toHaveLength(1);

      // stream.agent.start must precede stream.tool.start in event ordering
      const agentStartIdx = events.indexOf(agentStarts[0]!);
      const toolStartIdx = events.indexOf(toolStarts[0]!);
      expect(agentStartIdx).toBeLessThan(toolStartIdx);
    });

    test("stream.agent.start has correct event envelope", async () => {
      const adapter = createAdapterWithAgentType({
        agentType: "task",
        task: "Run tests",
        isBackground: true,
      });
      const stream = mockStream([{ type: "text", content: "hi" }]);

      await adapter.consumeStream(stream);

      const agentStarts = filterByType(events, "stream.agent.start");
      expect(agentStarts).toHaveLength(1);
      expect(agentStarts[0]!.data.agentId).toBe(AGENT_ID);
      expect(agentStarts[0]!.data.agentType).toBe("task");
      expect(agentStarts[0]!.data.task).toBe("Run tests");
      expect(agentStarts[0]!.data.isBackground).toBe(true);
      expect(agentStarts[0]!.sessionId).toBe(SESSION_ID);
      expect(agentStarts[0]!.runId).toBe(RUN_ID);
    });

    test("does not publish stream.agent.start when agentType is not provided", async () => {
      const adapter = createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      await adapter.consumeStream(stream);

      const agentStarts = filterByType(events, "stream.agent.start");
      expect(agentStarts).toHaveLength(0);
    });

    test("uses agentType as fallback task when task is not provided", () => {
      createAdapterWithAgentType({
        agentType: "explore",
      });

      const agentStarts = filterByType(events, "stream.agent.start");
      expect(agentStarts).toHaveLength(1);
      expect(agentStarts[0]!.data.task).toBe("explore");
    });

    test("defaults isBackground to false", () => {
      createAdapterWithAgentType({
        agentType: "explore",
      });

      const agentStarts = filterByType(events, "stream.agent.start");
      expect(agentStarts[0]!.data.isBackground).toBe(false);
    });

    test("idempotent guard prevents duplicate on first consumeStream call", async () => {
      const adapter = createAdapterWithAgentType({
        agentType: "task",
        task: "Build project",
      });

      // Constructor already published 1 event
      expect(filterByType(events, "stream.agent.start")).toHaveLength(1);

      // consumeStream should NOT publish a second one (idempotent guard)
      await adapter.consumeStream(mockStream([{ type: "text", content: "done" }]));

      expect(filterByType(events, "stream.agent.start")).toHaveLength(1);
    });

    test("re-publishes stream.agent.start on adapter reuse (multiple consumeStream calls)", async () => {
      const adapter = createAdapterWithAgentType({
        agentType: "task",
        task: "Build project",
      });

      // Constructor: 1 event
      await adapter.consumeStream(mockStream([{ type: "text", content: "first" }]));
      // buildResult clears flag, so next consumeStream re-publishes
      await adapter.consumeStream(mockStream([{ type: "text", content: "second" }]));

      const agentStarts = filterByType(events, "stream.agent.start");
      // 1 from constructor + 1 from second consumeStream (first was no-op)
      expect(agentStarts).toHaveLength(2);
    });
  });
});
