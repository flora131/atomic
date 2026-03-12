import { describe, expect, test } from "bun:test";
import {
  applyStreamPartEvent,
  finalizeStreamingReasoningInMessage,
  finalizeStreamingReasoningParts,
} from "@/state/parts/stream-pipeline.ts";
import { createAssistantMessage, registerStreamPipelineHooks } from "./stream-pipeline.fixtures.ts";

registerStreamPipelineHooks();

describe("reasoning streaming finalizers", () => {
  test("finalizeStreamingReasoningParts marks only streaming reasoning parts complete", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 300,
      thinkingText: "inspect",
      includeReasoningPart: true,
    });
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "answer" });

    const finalized = finalizeStreamingReasoningParts(msg.parts ?? []);

    expect(finalized[0]?.type).toBe("reasoning");
    if (finalized[0]?.type === "reasoning") {
      expect(finalized[0].isStreaming).toBe(false);
    }

    expect(finalized[1]?.type).toBe("text");
    if (finalized[1]?.type === "text") {
      expect(finalized[1].isStreaming).toBe(true);
    }
  });

  test("finalizeStreamingReasoningInMessage returns updated message parts", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 450,
      thinkingText: "plan",
      includeReasoningPart: true,
    });

    const finalized = finalizeStreamingReasoningInMessage(msg);

    expect(finalized).not.toBe(msg);
    expect(finalized.parts?.[0]?.type).toBe("reasoning");
    if (finalized.parts?.[0]?.type === "reasoning") {
      expect(finalized.parts[0].isStreaming).toBe(false);
    }
  });

  test("normal completion path finalizes reasoning part streaming state", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 600,
      thinkingText: "analyzing",
      includeReasoningPart: true,
    });
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "final answer" });

    const completed = {
      ...finalizeStreamingReasoningInMessage(msg),
      streaming: false,
    };

    expect(completed.streaming).toBe(false);
    const reasoning = completed.parts?.find((part) => part.type === "reasoning");
    expect(reasoning?.type).toBe("reasoning");
    if (reasoning?.type === "reasoning") {
      expect(reasoning.isStreaming).toBe(false);
    }
  });

  test("interrupted completion path finalizes reasoning part streaming state", () => {
    let msg = createAssistantMessage();
    msg = applyStreamPartEvent(msg, {
      type: "thinking-meta",
      thinkingSourceKey: "source:test",
      targetMessageId: "msg-test",
      streamGeneration: 1,
      thinkingMs: 700,
      thinkingText: "checking constraints",
      includeReasoningPart: true,
    });
    msg = applyStreamPartEvent(msg, { type: "text-delta", delta: "working..." });
    msg = applyStreamPartEvent(msg, {
      type: "tool-start",
      toolId: "tool_1",
      toolName: "Read",
      input: { filePath: "README.md" },
    });

    const interrupted = {
      ...finalizeStreamingReasoningInMessage(msg),
      streaming: false,
      toolCalls: (msg.toolCalls ?? []).map((toolCall) =>
        toolCall.status === "running" ? { ...toolCall, status: "interrupted" as const } : toolCall,
      ),
    };

    expect(interrupted.streaming).toBe(false);
    const reasoning = interrupted.parts?.find((part) => part.type === "reasoning");
    expect(reasoning?.type).toBe("reasoning");
    if (reasoning?.type === "reasoning") {
      expect(reasoning.isStreaming).toBe(false);
    }
    expect(interrupted.toolCalls?.[0]?.status).toBe("interrupted");
  });
});
