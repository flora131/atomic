import { normalizeSkillTrackingKey } from "@/state/chat/shared/helpers/skill-load-tracking.ts";
import type { ChatMessage, MessageRole, MessageSkillLoad } from "@/state/chat/shared/types/index.ts";
import type { Part, SkillLoadPart, ToolPart } from "@/state/parts/index.ts";
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

  // Search backward to find the last assistant message (not just the very last message).
  // System messages (info/warning/error) may have been appended after the assistant message
  // during streaming, so we need to look past them.
  let assistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") {
      assistantIdx = i;
      break;
    }
  }

  if (assistantIdx >= 0) {
    const assistantMsg = messages[assistantIdx]!;
    const existingLoads = assistantMsg.skillLoads ?? [];
    const hasExistingSkill = existingLoads.some(
      (existingLoad) => normalizeSkillTrackingKey(existingLoad.skillName) === normalizedSkillKey,
    );
    if (hasExistingSkill) {
      return messages;
    }

    const nextSkillLoads = [...existingLoads, skillLoad];
    const nextParts = upsertSkillLoadPart(assistantMsg.parts ?? [], nextSkillLoads);

    return [
      ...messages.slice(0, assistantIdx),
      {
        ...assistantMsg,
        skillLoads: nextSkillLoads,
        parts: nextParts,
      },
      ...messages.slice(assistantIdx + 1),
    ];
  }

  const msg = createMessage("assistant", "");
  msg.skillLoads = [skillLoad];
  msg.parts = upsertSkillLoadPart(msg.parts ?? [], [skillLoad]);
  return [...messages, msg];
}

function upsertSkillLoadPart(parts: Part[], skills: MessageSkillLoad[]): Part[] {
  const nextParts = [...parts];
  const existingIdx = nextParts.findIndex((part) => part.type === "skill-load");
  const skillPart: SkillLoadPart = {
    id: existingIdx >= 0 ? nextParts[existingIdx]!.id : createPartId(),
    type: "skill-load",
    skills,
    createdAt: existingIdx >= 0
      ? nextParts[existingIdx]!.createdAt
      : new Date().toISOString(),
  };
  if (existingIdx >= 0) {
    nextParts[existingIdx] = skillPart;
  } else {
    // Insert at the position of the first "skill" tool call so the skill-load
    // indicator renders in chronological order (the tool call itself gets hidden
    // by shouldHideSkillToolIndicator in getRenderableAssistantParts).
    const skillToolIdx = nextParts.findIndex(
      (part) => part.type === "tool" && (part as ToolPart).toolName.trim().toLowerCase() === "skill",
    );
    if (skillToolIdx >= 0) {
      nextParts.splice(skillToolIdx, 0, skillPart);
    } else {
      nextParts.push(skillPart);
    }
  }
  return nextParts;
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
