/**
 * TranscriptView Component
 *
 * Full-screen scrollable transcript view showing thinking traces, tool call
 * details, agent prompts, and timestamps. Toggled via ctrl+o.
 */

import React, { useMemo } from "react";
import { useTheme } from "../theme.tsx";
import { formatTranscript, type TranscriptLine, type TranscriptLineType } from "../utils/transcript-formatter.ts";
import type { ChatMessage, StreamingMeta } from "../chat.tsx";
import type { ParallelAgent } from "./parallel-agents-tree.tsx";
import { SPACING } from "../constants/spacing.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface TranscriptViewProps {
  messages: ChatMessage[];
  liveThinkingText?: string;
  liveParallelAgents?: ParallelAgent[];
  modelId?: string;
  isStreaming: boolean;
  streamingMeta?: StreamingMeta | null;
}

// ============================================================================
// COLOR MAPPING
// ============================================================================

function getLineColor(type: TranscriptLineType, colors: ReturnType<typeof useTheme>["theme"]["colors"]): string {
  switch (type) {
    case "user-prompt":
      return colors.userMessage;
    case "file-read":
      return colors.muted;
    case "thinking-header":
      return colors.warning;
    case "thinking-content":
      return colors.dim;
    case "timestamp":
      return colors.muted;
    case "assistant-bullet":
      return colors.foreground;
    case "assistant-text":
      return colors.foreground;
    case "tool-header":
      return colors.accent;
    case "tool-content":
      return colors.muted;
    case "agent-header":
      return colors.accent;
    case "agent-row":
      return colors.foreground;
    case "agent-substatus":
      return colors.muted;
    case "separator":
      return colors.dim;
    case "footer":
      return colors.muted;
    case "blank":
      return colors.foreground;
    default:
      return colors.foreground;
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function TranscriptView({
  messages,
  liveThinkingText,
  liveParallelAgents,
  modelId,
  isStreaming,
  streamingMeta,
}: TranscriptViewProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;

  const transcriptLines = useMemo(() => formatTranscript({
    messages,
    liveThinkingText,
    liveParallelAgents,
    streamingMeta,
    isStreaming,
    modelId,
  }), [messages, liveThinkingText, liveParallelAgents, streamingMeta, isStreaming, modelId]);

  return (
    <scrollbox
      flexGrow={1}
      stickyScroll={true}
      stickyStart="bottom"
      scrollY={true}
      scrollX={false}
      viewportCulling={false}
      paddingLeft={SPACING.CONTAINER_PAD}
      paddingRight={SPACING.CONTAINER_PAD}
      verticalScrollbarOptions={{ visible: false }}
      horizontalScrollbarOptions={{ visible: false }}
    >
      {transcriptLines.map((tl: TranscriptLine, idx: number) => {
        if (tl.type === "blank") {
          return <text key={idx}>{" "}</text>;
        }
        const indent = tl.indent > 0 ? "  ".repeat(tl.indent) : "";
        const color = getLineColor(tl.type, colors);

        // Special rendering for thinking header with icon
        if (tl.type === "thinking-header") {
          return (
            <text key={idx} wrapMode="char" selectable style={{ fg: color }}>
              {indent}{tl.content}
            </text>
          );
        }

        // Special rendering for timestamp — right-aligned feel
        if (tl.type === "timestamp") {
          return (
            <box key={idx} flexDirection="row" justifyContent="flex-end" paddingRight={SPACING.CONTAINER_PAD}>
              <text selectable style={{ fg: color }}>{tl.content}</text>
            </box>
          );
        }

        return (
          <text key={idx} wrapMode="char" selectable style={{ fg: color }}>
            {indent}{tl.content}
          </text>
        );
      })}
    </scrollbox>
  );
}

export default TranscriptView;
