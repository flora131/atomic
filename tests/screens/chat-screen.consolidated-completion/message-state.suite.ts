import { describe, expect, test } from "bun:test";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import { finalizeStreamingReasoningInMessage } from "@/state/parts/index.ts";
import {
  appendBackgroundMessageInOrder,
  createAgent,
  createMessage,
  finalizeActiveStreamingMessage,
} from "./support.ts";

describe("Consolidated completion state updates (Fix 5C)", () => {
  describe("Message finalization state", () => {
    test("finalizeStreamingReasoningInMessage preserves message identity", () => {
      const msg = createMessage({
        id: "msg-1",
        content: "test",
        parts: [],
      });

      const result = finalizeStreamingReasoningInMessage(msg);

      expect(result.id).toBe("msg-1");
      expect(result.content).toBe("test");
    });

    test("combined agent filtering and message update operates on same prev state", () => {
      const messageId = "msg-1";
      const bakedAgents = [createAgent({ id: "a1" }), createAgent({ id: "a2" })];
      const currentAgents = [
        createAgent({ id: "a1", status: "running" }),
        createAgent({ id: "a2", status: "running" }),
        createAgent({ id: "orphan", status: "running" }),
      ];

      const messages = [
        createMessage({
          id: messageId,
          parallelAgents: bakedAgents,
          streaming: true,
        }),
        createMessage({ id: "msg-other", content: "other" }),
      ];

      const updatedMessages = (() => {
        const existingAgentIds = new Set<string>();
        const targetMsg = messages.find((m) => m.id === messageId);
        if (targetMsg?.parallelAgents) {
          for (const agent of targetMsg.parallelAgents) {
            existingAgentIds.add(agent.id);
          }
        }

        const finalizedAgents =
          currentAgents.length > 0
            ? currentAgents
                .filter((a) => existingAgentIds.has(a.id))
                .map((a) => {
                  if (a.background) return a;
                  return a.status === "running" || a.status === "pending"
                    ? {
                        ...a,
                        status: "completed" as const,
                        currentTool: undefined,
                        durationMs: Date.now() - new Date(a.startedAt).getTime(),
                      }
                    : a;
                })
            : undefined;

        return messages.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                streaming: false,
                parallelAgents: finalizedAgents,
              }
            : msg,
        );
      })();

      const finalMsg = updatedMessages.find((m) => m.id === messageId);
      expect(finalMsg).toBeDefined();
      expect(finalMsg!.streaming).toBe(false);
      expect(finalMsg!.parallelAgents).toBeDefined();
      expect(finalMsg!.parallelAgents!.length).toBe(2);
      expect(
        finalMsg!.parallelAgents!.every((a: ParallelAgent) => a.status === "completed"),
      ).toBe(true);

      const otherMsg = updatedMessages.find((m) => m.id === "msg-other");
      expect(otherMsg).toBeDefined();
      expect(otherMsg!.content).toBe("other");
    });

    test("background updates insert after anchor message and chain in order", () => {
      const start = createMessage({
        id: "start",
        content: "Starting workflow",
        streaming: true,
      });
      const bg1 = createMessage({
        id: "bg1",
        content: "Background update 1",
        streaming: false,
      });
      const bg2 = createMessage({
        id: "bg2",
        content: "Background update 2",
        streaming: false,
      });
      const refs = {
        backgroundAgentMessageId: null as string | null,
        streamingMessageId: "start",
        lastStreamedMessageId: null as string | null,
      };

      const afterBg1 = appendBackgroundMessageInOrder([start], bg1, refs);
      const afterBg2 = appendBackgroundMessageInOrder(afterBg1, bg2, refs);

      expect(afterBg1.map((m) => m.id)).toEqual(["start", "bg1"]);
      expect(afterBg2.map((m) => m.id)).toEqual(["start", "bg1", "bg2"]);
      expect(refs.backgroundAgentMessageId).toBe("bg2");
    });

    test("finalizes the active streaming message even when it is not last", () => {
      const start = createMessage({
        id: "start",
        content: "Starting workflow",
        streaming: true,
      });
      const bg1 = createMessage({
        id: "bg1",
        content: "Background update 1",
        streaming: false,
      });

      const result = finalizeActiveStreamingMessage([start, bg1], "start");

      expect(result.map((m) => m.id)).toEqual(["start", "bg1"]);
      expect(result[0]!.streaming).toBe(false);
      expect(result[1]!.streaming).toBe(false);
      expect(result[1]!.content).toBe("Background update 1");
    });
  });
});
