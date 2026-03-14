import { formatDuration } from "@/components/parallel-agents-tree.tsx";
import { getHitlResponseRecord } from "@/lib/ui/hitl-response.ts";
import {
  getThinkingBlocks,
  formatTranscriptTimestamp,
  transcriptLine,
} from "@/lib/ui/transcript/helpers.ts";
import { formatToolInput, formatToolTitle } from "@/lib/ui/transcript/tool-formatters.ts";
import type { TranscriptLine } from "@/lib/ui/transcript/types.ts";
import type { ChatMessage, StreamingMeta } from "@/state/chat/shared/types/message.ts";
import { MISC, PROMPT, SEPARATOR, SPINNER_COMPLETE, SPINNER_FRAMES, STATUS } from "@/theme/icons.ts";

export interface FormatTranscriptOptions {
  messages: ChatMessage[];
  liveThinkingText?: string;
  streamingMeta?: StreamingMeta | null;
  isStreaming: boolean;
  modelId?: string;
}

export function formatTranscript(options: FormatTranscriptOptions): TranscriptLine[] {
  const { messages, liveThinkingText, streamingMeta, isStreaming, modelId } = options;
  const lines: TranscriptLine[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      lines.push(transcriptLine("user-prompt", `${PROMPT.cursor} ${message.content}`));
      lines.push(transcriptLine("blank", ""));
      continue;
    }

    if (message.role === "assistant") {
      const thinkingBlocks = getThinkingBlocks(message, liveThinkingText);
      for (const thinkingContent of thinkingBlocks) {
        lines.push(transcriptLine("thinking-header", `${MISC.thinking} Thinking…`));
        for (const line of thinkingContent.split("\n")) {
          if (line.trim()) {
            lines.push(transcriptLine("thinking-content", line, 1));
          }
        }
        lines.push(transcriptLine("blank", ""));
      }

      const timestamp = formatTranscriptTimestamp(message.timestamp);
      const modelLabel = message.modelId || modelId || "";
      if (modelLabel) {
        lines.push(transcriptLine("timestamp", `${timestamp} ${modelLabel}`));
      }

      if (message.content.trim()) {
        const contentLines = message.content.split("\n");
        const firstLine = contentLines[0]?.trim();
        if (firstLine) {
          lines.push(transcriptLine("assistant-bullet", `${STATUS.active} ${firstLine}`));
        }
        for (const contentLine of contentLines.slice(1)) {
          lines.push(transcriptLine("assistant-text", `  ${contentLine}`, 1));
        }
      }

      for (const toolCall of message.toolCalls ?? []) {
        const isHitlTool = toolCall.toolName === "AskUserQuestion"
          || toolCall.toolName === "question"
          || toolCall.toolName === "ask_user";
        const statusIcon = toolCall.status === "error"
          ? STATUS.error
          : toolCall.status === "pending"
            ? STATUS.pending
            : STATUS.active;

        if (isHitlTool) {
          lines.push(transcriptLine("tool-header", `${statusIcon} ${toolCall.toolName}`));

          const questions = toolCall.input.questions as Array<{ question?: string }> | undefined;
          const questionText = (toolCall.input.question as string) || questions?.[0]?.question || "";
          if (questionText) {
            lines.push(transcriptLine("tool-content", `  ${questionText}`, 1));
          }

          const hitlResponse = getHitlResponseRecord(toolCall);
          if (hitlResponse) {
            lines.push(transcriptLine("tool-content", `  ${PROMPT.cursor} ${hitlResponse.displayText}`, 1));
          }
          continue;
        }

        const toolTitle = formatToolTitle(toolCall.toolName, toolCall.input);
        lines.push(transcriptLine("tool-header", `${statusIcon} ${toolCall.toolName} ${toolTitle}`));

        const inputSummary = formatToolInput(toolCall.toolName, toolCall.input);
        if (inputSummary) {
          lines.push(transcriptLine("tool-content", `  ${inputSummary}`, 1));
        }

        if (toolCall.output !== undefined) {
          const outputString = typeof toolCall.output === "string"
            ? toolCall.output
            : JSON.stringify(toolCall.output);
          const outputLines = outputString.split("\n").filter((line) => line.trim());
          const previewCount = Math.min(outputLines.length, 8);
          for (const outputLine of outputLines.slice(0, previewCount)) {
            lines.push(transcriptLine("tool-content", `  ${outputLine}`, 1));
          }
          if (outputLines.length > previewCount) {
            lines.push(
              transcriptLine("tool-content", `  … ${outputLines.length - previewCount} more lines`, 1),
            );
          }
        }
      }

      if (!message.streaming && message.durationMs != null && message.durationMs >= 1000) {
        const duration = formatDuration(message.durationMs);
        const tokenLabel = message.outputTokens ? ` · ${message.outputTokens} tokens` : "";
        lines.push(transcriptLine("blank", ""));
        lines.push(transcriptLine("separator", `${SPINNER_COMPLETE} Worked for ${duration}${tokenLabel}`));
      }

      lines.push(transcriptLine("blank", ""));
      continue;
    }

    if (message.role === "system") {
      lines.push(transcriptLine("assistant-text", `⚠ ${message.content}`));
      lines.push(transcriptLine("blank", ""));
    }
  }

  if (isStreaming && streamingMeta) {
    const thinkingLabel = streamingMeta.thinkingMs > 0
      ? ` · thinking ${formatDuration(streamingMeta.thinkingMs)}`
      : "";
    const tokenLabel = streamingMeta.outputTokens > 0
      ? ` · ${streamingMeta.outputTokens} tokens`
      : "";
    lines.push(transcriptLine("separator", `${SPINNER_FRAMES[0]} Streaming…${thinkingLabel}${tokenLabel}`));
  }

  lines.push(transcriptLine("separator", SEPARATOR.line.repeat(25)));
  lines.push(transcriptLine("footer", "  Showing detailed transcript · ctrl+o to toggle"));

  return lines;
}
