import { beforeEach } from "bun:test";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { ChatMessage } from "@/types/chat.ts";
import { _resetPartCounter, createPartId } from "@/state/parts/id.ts";

export type { ChatMessage, ParallelAgent };
export { createPartId };

export function registerStreamPipelineHooks() {
  beforeEach(() => {
    _resetPartCounter();
  });
}

export function createAssistantMessage(): ChatMessage {
  return {
    id: "msg-test",
    role: "assistant",
    content: "",
    timestamp: new Date().toISOString(),
    streaming: true,
    parts: [],
  };
}

export function findReasoningPartBySource(message: ChatMessage, sourceKey: string) {
  return (message.parts ?? []).find(
    (part) => part.type === "reasoning" && part.thinkingSourceKey === sourceKey,
  );
}
