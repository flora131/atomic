import { finalizeStreamingReasoningInMessage } from "@/state/parts/index.ts";
import type { ParallelAgent } from "@/components/parallel-agents-tree.tsx";
import type { ChatMessage } from "@/state/chat/exports.ts";

export function createAgent(overrides: Partial<ParallelAgent>): ParallelAgent {
  return {
    id: "agent-1",
    name: "Test Agent",
    task: "Test task",
    status: "running",
    startedAt: new Date(Date.now() - 2000).toISOString(),
    background: false,
    ...overrides,
  };
}

export function createMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "msg-1",
    role: "assistant" as const,
    content: "Hello",
    streaming: true,
    ...overrides,
  } as ChatMessage;
}

export function computeFinalizedAgents(
  messageAgents: ParallelAgent[] | undefined,
  currentAgents: ParallelAgent[],
): ParallelAgent[] | undefined {
  const existingAgentIds = new Set<string>();
  if (messageAgents) {
    for (const agent of messageAgents) {
      existingAgentIds.add(agent.id);
    }
  }

  return currentAgents.length > 0
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
}

export function appendBackgroundMessageInOrder(
  prev: ChatMessage[],
  message: ChatMessage,
  refs: {
    backgroundAgentMessageId: string | null;
    streamingMessageId: string | null;
    lastStreamedMessageId: string | null;
  },
): ChatMessage[] {
  refs.backgroundAgentMessageId = message.id;
  return [...prev, message];
}

export function finalizeActiveStreamingMessage(
  prev: ChatMessage[],
  activeStreamingMessageId: string | null,
): ChatMessage[] {
  if (!activeStreamingMessageId) {
    return prev;
  }

  return prev.map((msg) =>
    msg.id === activeStreamingMessageId && msg.role === "assistant" && msg.streaming
      ? {
          ...finalizeStreamingReasoningInMessage(msg),
          streaming: false,
          completedAt: new Date(),
        }
      : msg,
  );
}
