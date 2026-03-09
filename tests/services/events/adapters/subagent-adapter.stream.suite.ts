import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@/services/agents/types.ts";
import {
  AGENT_ID,
  RUN_ID,
  SESSION_ID,
  createHarness,
  filterByType,
  mockStream,
} from "./subagent-adapter.test-support.ts";

describe("SubagentStreamAdapter", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  describe("text events", () => {
    test("publishes stream.text.delta for text chunks", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        { type: "text", content: "Hello " },
        { type: "text", content: "world" },
      ]);

      await adapter.consumeStream(stream);

      const deltas = filterByType(harness.events, "stream.text.delta");
      expect(deltas).toHaveLength(2);
      expect(deltas[0]!.data.delta).toBe("Hello ");
      expect(deltas[1]!.data.delta).toBe("world");
      expect(deltas[0]!.sessionId).toBe(SESSION_ID);
      expect(deltas[0]!.runId).toBe(RUN_ID);
      expect(deltas[0]!.data.messageId).toBe(`subagent-${AGENT_ID}`);
    });

    test("accumulates full text in SubagentStreamResult", async () => {
      const adapter = harness.createAdapter();
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
      const adapter = harness.createAdapter();
      const stream = mockStream([{ type: "text", content: "done" }]);

      await adapter.consumeStream(stream);

      const completes = filterByType(harness.events, "stream.text.complete");
      expect(completes).toHaveLength(1);
      expect(completes[0]!.data.fullText).toBe("done");
      expect(completes[0]!.data.messageId).toBe(`subagent-${AGENT_ID}`);
    });

    test("ignores non-string text content", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        { type: "text", content: { structured: true } as unknown as string },
        { type: "text", content: "actual text" },
      ]);

      const result = await adapter.consumeStream(stream);

      const deltas = filterByType(harness.events, "stream.text.delta");
      expect(deltas).toHaveLength(1);
      expect(result.output).toBe("actual text");
    });
  });

  describe("thinking events", () => {
    test("publishes stream.thinking.delta for thinking chunks", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        {
          type: "thinking",
          content: "Let me think...",
          metadata: { thinkingSourceKey: "source-1" },
        },
      ]);

      await adapter.consumeStream(stream);

      const deltas = filterByType(harness.events, "stream.thinking.delta");
      expect(deltas).toHaveLength(1);
      expect(deltas[0]!.data.delta).toBe("Let me think...");
      expect(deltas[0]!.data.sourceKey).toBe("source-1");
      expect(deltas[0]!.sessionId).toBe(SESSION_ID);
    });

    test("uses 'default' sourceKey when not specified", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([
        { type: "thinking", content: "thinking..." },
      ]);

      await adapter.consumeStream(stream);

      const deltas = filterByType(harness.events, "stream.thinking.delta");
      expect(deltas).toHaveLength(1);
      expect(deltas[0]!.data.sourceKey).toBe("default");
    });

    test("publishes stream.thinking.complete with duration", async () => {
      const adapter = harness.createAdapter();
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

      const completes = filterByType(harness.events, "stream.thinking.complete");
      expect(completes).toHaveLength(1);
      expect(completes[0]!.data.sourceKey).toBe("src-1");
      expect(completes[0]!.data.durationMs).toBe(1500);
    });

    test("tracks thinking duration in result", async () => {
      const adapter = harness.createAdapter();
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

  describe("result metadata", () => {
    test("includes durationMs in result", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      const result = await adapter.consumeStream(stream);

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("omits thinkingDurationMs when no thinking occurred", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      const result = await adapter.consumeStream(stream);

      expect(result.thinkingDurationMs).toBeUndefined();
    });

    test("omits toolDetails when no tools used", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      const result = await adapter.consumeStream(stream);

      expect(result.toolDetails).toBeUndefined();
    });

    test("returns empty string output when no text chunks", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([]);

      const result = await adapter.consumeStream(stream);

      expect(result.output).toBe("");
      expect(result.success).toBe(true);
    });
  });

  describe("event envelope", () => {
    test("all events use parent sessionId", async () => {
      const adapter = harness.createAdapter();
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

      for (const event of harness.events) {
        expect(event.sessionId).toBe(SESSION_ID);
      }
    });

    test("all events use correct runId", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      await adapter.consumeStream(stream);

      for (const event of harness.events) {
        expect(event.runId).toBe(RUN_ID);
      }
    });

    test("all events have timestamps", async () => {
      const adapter = harness.createAdapter();
      const stream = mockStream([{ type: "text", content: "hi" }]);

      await adapter.consumeStream(stream);

      for (const event of harness.events) {
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });
  });

  describe("reuse", () => {
    test("resets state between consumeStream calls", async () => {
      const adapter = harness.createAdapter();

      const stream1 = mockStream([{ type: "text", content: "first" }]);
      const result1 = await adapter.consumeStream(stream1);
      expect(result1.output).toBe("first");

      const stream2 = mockStream([{ type: "text", content: "second" }]);
      const result2 = await adapter.consumeStream(stream2);
      expect(result2.output).toBe("second");
      expect(result2.output).not.toContain("first");
    });
  });
});
