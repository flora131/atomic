import React, { useEffect, useState } from "react";
import { useThemeColors } from "@/theme/index.tsx";
import { ARROW, MISC, SPINNER_COMPLETE, SPINNER_FRAMES } from "@/theme/icons.ts";
import { formatDuration } from "@/lib/ui/format.ts";
import { getLoadingIndicatorText } from "@/state/chat/shared/helpers/index.ts";

interface LoadingIndicatorProps {
  speed?: number;
  verbOverride?: string;
  elapsedMs?: number;
  outputTokens?: number;
  thinkingMs?: number;
  isStreaming?: boolean;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return `${tokens}`;
}

function formatCompletionDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds <= 0) return "1s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function LoadingIndicator({
  speed = 100,
  verbOverride,
  elapsedMs,
  outputTokens,
  thinkingMs,
  isStreaming,
}: LoadingIndicatorProps): React.ReactNode {
  const themeColors = useThemeColors();
  const [frameIndex, setFrameIndex] = useState(0);
  const verb = getLoadingIndicatorText({
    isStreaming: isStreaming ?? true,
    verbOverride,
    thinkingMs,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, speed);

    return () => clearInterval(interval);
  }, [speed]);

  const spinChar = SPINNER_FRAMES[frameIndex] as string;
  const parts: string[] = [];
  if (elapsedMs != null && elapsedMs > 0) {
    parts.push(formatDuration(elapsedMs).text);
  }
  if (outputTokens != null && outputTokens > 0) {
    parts.push(`${ARROW.down} ${formatTokenCount(outputTokens)} tokens`);
  }
  if (thinkingMs != null && thinkingMs >= 1000) {
    parts.push(`thought for ${formatCompletionDuration(thinkingMs)}`);
  }
  const infoText = parts.length > 0
    ? ` (${parts.join(` ${MISC.separator} `)})`
    : "";

  return (
    <>
      <span fg={themeColors.accent}>{spinChar} </span>
      <span fg={themeColors.accent}>{verb}…</span>
      {infoText && (
        <span fg={themeColors.muted}>{infoText}</span>
      )}
    </>
  );
}

interface CompletionSummaryProps {
  durationMs: number;
  outputTokens?: number;
  thinkingMs?: number;
}

export function CompletionSummary({
  durationMs,
  outputTokens,
  thinkingMs,
}: CompletionSummaryProps): React.ReactNode {
  const themeColors = useThemeColors();
  const verb = thinkingMs != null && thinkingMs >= 1000
    ? "Reasoned"
    : "Composed";
  const [spinChar] = useState(() => SPINNER_COMPLETE);

  const parts: string[] = [`${verb} for ${formatCompletionDuration(durationMs)}`];
  if (outputTokens != null && outputTokens > 0) {
    parts.push(`${ARROW.down} ${formatTokenCount(outputTokens)} tokens`);
  }
  if (thinkingMs != null && thinkingMs >= 1000) {
    parts.push(`thought for ${formatCompletionDuration(thinkingMs)}`);
  }

  return (
    <box flexDirection="row">
      <text fg={themeColors.muted}>
        <span fg={themeColors.accent}>{spinChar} </span>
        <span>{parts.join(` ${MISC.separator} `)}</span>
      </text>
    </box>
  );
}

export function StreamingBullet({
  speed = 500,
}: {
  speed?: number;
}): React.ReactNode {
  const themeColors = useThemeColors();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, speed);
    return () => clearInterval(interval);
  }, [speed]);

  return (
    <text>
      <span fg={themeColors.accent}>
        {visible ? "\u25cf" : MISC.separator}{" "}
      </span>
    </text>
  );
}
