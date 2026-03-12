import { beforeEach, describe, expect, test } from "bun:test";
import type { AgentMessage } from "@/services/agents/types.ts";
import {
  createHarness,
  errorStream,
  filterByType,
  mockStream,
} from "./subagent-adapter.test-support.ts";

describe("SubagentStreamAdapter", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  describe("abort handling", () => {
    test("stops consuming stream when abort signal fires", async () => {
      const abortController = new AbortController();
      const adapter = harness.createAdapter();

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
      expect(result.output).toContain("first");
    });

    test("publishes stream.text.complete on abort", async () => {
      const abortController = new AbortController();
      abortController.abort();

      const adapter = harness.createAdapter();
      const stream = mockStream([{ type: "text", content: "test" }]);

      await adapter.consumeStream(stream, abortController.signal);

      const completes = filterByType(harness.events, "stream.text.complete");
      expect(completes).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    test("catches stream errors and returns failure result", async () => {
      const adapter = harness.createAdapter();
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
      const adapter = harness.createAdapter();
      const stream = errorStream([], new Error("Connection lost"));

      await adapter.consumeStream(stream);

      const errors = filterByType(harness.events, "stream.session.error");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.data.error).toBe("Connection lost");
    });

    test("publishes stream.text.complete after error", async () => {
      const adapter = harness.createAdapter();
      const stream = errorStream(
        [{ type: "text", content: "some text" }],
        new Error("fail"),
      );

      await adapter.consumeStream(stream);

      const completes = filterByType(harness.events, "stream.text.complete");
      expect(completes).toHaveLength(1);
      expect(completes[0]!.data.fullText).toBe("some text");
    });

    test("handles non-Error thrown values", async () => {
      const adapter = harness.createAdapter();

      async function* throwingStream(): AsyncGenerator<AgentMessage> {
        if (Date.now() < 0) {
          yield { type: "text", content: "" };
        }
        throw "string error";
      }

      const result = await adapter.consumeStream(throwingStream());

      expect(result.success).toBe(false);
      expect(result.error).toBe("string error");
    });
  });
});
