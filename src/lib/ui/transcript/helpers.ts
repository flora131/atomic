import type { ChatMessage } from "@/state/chat/shared/types/message.ts";
import { formatTimestamp as formatTimestampFull } from "@/lib/ui/format.ts";
import type { TranscriptLine, TranscriptLineType } from "@/lib/ui/transcript/types.ts";

export function formatTranscriptTimestamp(iso: string): string {
  return formatTimestampFull(iso).text;
}

export function transcriptLine(
  type: TranscriptLineType,
  content: string,
  indent = 0,
): TranscriptLine {
  return { type, content, indent };
}

export function getThinkingBlocks(
  message: ChatMessage,
  liveThinkingText?: string,
): string[] {
  const reasoningBlocks = (message.parts ?? [])
    .flatMap((part) => {
      if (part.type !== "reasoning") {
        return [];
      }

      return part.content.trim().length > 0 ? [part.content] : [];
    });

  if (reasoningBlocks.length > 0) {
    return reasoningBlocks;
  }

  const fallbackThinkingContent =
    message.thinkingText || (!message.streaming ? undefined : liveThinkingText);
  if (!fallbackThinkingContent) {
    return [];
  }

  return [fallbackThinkingContent];
}
