import { normalizeSkillTrackingKey } from "@/lib/ui/skill-load-tracking.ts";
import type { ChatMessage, MessageRole, MessageSkillLoad } from "@/state/chat/shared/types/index.ts";
import type { Part } from "@/state/parts/index.ts";
import {
  createPartId,
  finalizeStreamingReasoningInMessage,
} from "@/state/parts/index.ts";

export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createMessage(
  role: MessageRole,
  content: string,
  streaming?: boolean,
): ChatMessage {
  const parts: Part[] | undefined = role === "assistant"
    ? (
      content
        ? [{
          id: createPartId(),
          type: "text" as const,
          content,
          isStreaming: Boolean(streaming),
          createdAt: new Date().toISOString(),
        }]
        : []
    )
    : undefined;

  return {
    id: generateMessageId(),
    role,
    content,
    timestamp: new Date().toISOString(),
    streaming,
    parts,
  };
}

export function appendSkillLoadToLatestAssistantMessage(
  messages: ChatMessage[],
  skillLoad: MessageSkillLoad,
): ChatMessage[] {
  const normalizedSkillKey = normalizeSkillTrackingKey(skillLoad.skillName);
  if (normalizedSkillKey.length === 0) {
    return messages;
  }

  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.role === "assistant") {
    const existingLoads = lastMsg.skillLoads ?? [];
    const hasExistingSkill = existingLoads.some(
      (existingLoad) => normalizeSkillTrackingKey(existingLoad.skillName) === normalizedSkillKey,
    );
    if (hasExistingSkill) {
      return messages;
    }

    return [
      ...messages.slice(0, -1),
      {
        ...lastMsg,
        skillLoads: [...existingLoads, skillLoad],
      },
    ];
  }

  const msg = createMessage("assistant", "");
  msg.skillLoads = [skillLoad];
  return [...messages, msg];
}

export function appendUniqueMessagesById(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return existing;

  const seenIds = new Set(existing.map((message) => message.id));
  const newMessages = incoming.filter((message) => !seenIds.has(message.id));
  return newMessages.length === 0 ? existing : [...existing, ...newMessages];
}

export function reconcilePreviousStreamingPlaceholder(
  messages: ChatMessage[],
  previousStreamingId: string | null,
): ChatMessage[] {
  if (!previousStreamingId) return messages;

  return messages
    .map((message) =>
      message.id === previousStreamingId && message.streaming
        ? { ...finalizeStreamingReasoningInMessage(message), streaming: false }
        : message,
    )
    .filter((message) => !(message.id === previousStreamingId && !message.content.trim()));
}

export function shouldHideStaleSubagentToolPlaceholder(
  message: ChatMessage,
  activeMessageIds: ReadonlySet<string>,
): boolean {
  void message;
  void activeMessageIds;
  return false;
}

export function getSpinnerVerbForCommand(commandName: string): string | undefined {
  return commandName === "compact" ? "Compacting" : undefined;
}
