/**
 * Main chat tool preview truncation helpers.
 *
 * These helpers are UI-display only. They do not mutate stored tool data.
 */

export interface ToolPreviewTruncationLimits {
  maxLabelChars: number;
  maxTitleChars: number;
  maxSummaryChars: number;
  maxLines: number;
  maxLineChars: number;
}

export interface TruncateToolLinesOptions {
  maxLines: number;
  maxLineChars: number;
}

export interface TruncateToolLinesResult {
  lines: string[];
  truncatedLineCount: number;
  truncatedByCharCount: number;
  wasTruncated: boolean;
}

export const MAIN_CHAT_TOOL_PREVIEW_LIMITS: ToolPreviewTruncationLimits = {
  maxLabelChars: 60,
  maxTitleChars: 120,
  maxSummaryChars: 120,
  maxLines: 24,
  maxLineChars: 140,
};

export const TASK_TOOL_PREVIEW_MAX_LINES = 12;

export function truncateToolHeader(text: string, maxChars: number): string {
  return truncateToolText(text, maxChars);
}

export function truncateToolText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return "...".slice(0, maxChars);

  let keep = Math.max(1, maxChars - 1);
  let marker = "";

  // Two passes are enough to stabilize marker length for practical limits.
  for (let i = 0; i < 2; i++) {
    const hiddenChars = text.length - keep;
    marker = `… (+${hiddenChars} chars truncated)`;
    keep = maxChars - marker.length;
    if (keep <= 0) {
      return `${text.slice(0, maxChars - 3)}...`;
    }
  }

  return `${text.slice(0, keep)}${marker}`;
}

export function truncateToolLines(
  lines: string[],
  options: TruncateToolLinesOptions
): TruncateToolLinesResult {
  let truncatedByCharCount = 0;
  const lineCharLimited = lines.map((line) => {
    const truncated = truncateToolText(line, options.maxLineChars);
    if (truncated !== line) truncatedByCharCount++;
    return truncated;
  });

  const truncatedLineCount = Math.max(0, lineCharLimited.length - options.maxLines);
  const preview = truncatedLineCount > 0
    ? [
      ...lineCharLimited.slice(0, options.maxLines),
      `… truncated ${truncatedLineCount} line${truncatedLineCount === 1 ? "" : "s"}`,
    ]
    : lineCharLimited;

  return {
    lines: preview,
    truncatedLineCount,
    truncatedByCharCount,
    wasTruncated: truncatedLineCount > 0 || truncatedByCharCount > 0,
  };
}

export function getMainChatToolMaxLines(toolName: string): number {
  return toolName.toLowerCase() === "task"
    ? TASK_TOOL_PREVIEW_MAX_LINES
    : MAIN_CHAT_TOOL_PREVIEW_LIMITS.maxLines;
}
