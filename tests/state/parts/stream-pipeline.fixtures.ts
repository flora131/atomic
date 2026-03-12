import { beforeEach } from "bun:test";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import type { ChatMessage } from "@/screens/chat-screen.tsx";
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
    toolCalls: [],
  };
}

export function findReasoningPartBySource(message: ChatMessage, sourceKey: string) {
  return (message.parts ?? []).find(
    (part) => part.type === "reasoning" && part.thinkingSourceKey === sourceKey,
  );
}
