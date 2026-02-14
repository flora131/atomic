/**
 * ContextInfoDisplay Component
 *
 * Renders context window usage information with a visual bar and token breakdown.
 * Shows model, tier, usage percentage, and per-category token counts.
 *
 * Layout:
 *   Context Usage
 *
 *   ● claude-sonnet-4-20250514 · pro · 45.2k/200.0k tokens (23%)
 *   [████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
 *
 *   System/Tools     12.3k ( 6%)
 *   Messages         32.9k (16%)
 *   Free Space      147.1k (74%)
 *   Buffer           20.0k (10%)
 */

import React from "react";
import { useTheme } from "../theme.tsx";
import { STATUS, PROGRESS } from "../constants/icons.ts";
import type { ContextDisplayInfo } from "../commands/registry.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface ContextInfoDisplayProps {
  contextInfo: ContextDisplayInfo;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return `${tokens}`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function ContextInfoDisplay({
  contextInfo,
}: ContextInfoDisplayProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;

  const { model, tier, maxTokens, systemTools, messages, freeSpace, buffer } =
    contextInfo;
  const usedTokens = systemTools + messages;
  const usagePercent =
    maxTokens > 0 ? Math.round((usedTokens / maxTokens) * 100) : 0;

  // Visual bar: 40 characters
  const BAR_WIDTH = 40;
  const ratio = maxTokens > 0 ? usedTokens / maxTokens : 0;
  const filledCount = Math.min(BAR_WIDTH, Math.max(0, Math.round(ratio * BAR_WIDTH)));
  const emptyCount = Math.max(0, BAR_WIDTH - filledCount);

  let barColor: string;
  if (usagePercent < 60) {
    barColor = colors.success;
  } else if (usagePercent < 85) {
    barColor = colors.warning ?? "#FFFF00";
  } else {
    barColor = colors.error;
  }

  const filledBar = PROGRESS.filled.repeat(filledCount);
  const emptyBar = PROGRESS.empty.repeat(emptyCount);

  const categories = [
    { label: "System/Tools", value: systemTools },
    { label: "Messages", value: messages },
    { label: "Free Space", value: freeSpace },
    { label: "Buffer", value: buffer },
  ];

  return (
    <box flexDirection="column">
      <text style={{ fg: colors.foreground, attributes: 1 }}>
        Context Usage
      </text>
      <text>{""}</text>
      <text>
        <span style={{ fg: colors.success }}>{`  ${STATUS.active} `}</span>
        <span style={{ fg: colors.foreground, attributes: 1 }}>{model}</span>
        <span style={{ fg: colors.muted }}>{` · ${tier} · `}</span>
        <span style={{ fg: colors.foreground }}>
          {`${formatTokenCount(usedTokens)}/${formatTokenCount(maxTokens)} tokens (${usagePercent}%)`}
        </span>
      </text>
      <text>
        <span style={{ fg: colors.muted }}>{"  ["}</span>
        <span style={{ fg: barColor }}>{filledBar}</span>
        <span style={{ fg: colors.muted }}>{emptyBar}</span>
        <span style={{ fg: colors.muted }}>{"]"}</span>
      </text>
      <text>{""}</text>
      {categories.map((cat) => {
        const pct =
          maxTokens > 0 ? Math.round((cat.value / maxTokens) * 100) : 0;
        const padLabel = cat.label.padEnd(14);
        return (
          <text key={cat.label}>
            <span style={{ fg: colors.muted }}>{`  ${padLabel}`}</span>
            <span style={{ fg: colors.foreground }}>
              {`${formatTokenCount(cat.value).padStart(7)} (${String(pct).padStart(2)}%)`}
            </span>
          </text>
        );
      })}
    </box>
  );
}
