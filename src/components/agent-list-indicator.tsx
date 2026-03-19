/**
 * AgentListIndicator Component
 *
 * Renders the /agents command output with themed, terminal-width-aware layout.
 * Groups agents by source (Project / Global) with truncated descriptions.
 */

import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useThemeColors } from "@/theme/index.tsx";
import { SPACING } from "@/theme/spacing.ts";
import { CONNECTOR } from "@/theme/icons.ts";
import type { AgentListView, AgentListItemView } from "@/lib/ui/agent-list-output.ts";

export interface AgentListIndicatorProps {
  view: AgentListView;
}

const BULLET = "\u2022"; // U+2022 Bullet
const INDENT = "  ";
const BULLET_PREFIX = `${INDENT}${BULLET} `;
const DESC_INDENT = `${INDENT}  `;

function truncateToWidth(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  const cut = text.slice(0, maxWidth - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxWidth - 1)}\u2026`;
}

function AgentSection({
  label,
  agents,
  contentWidth,
}: {
  label: string;
  agents: AgentListItemView[];
  contentWidth: number;
}): React.ReactNode {
  const colors = useThemeColors();

  if (agents.length === 0) return null;

  const nameMaxWidth = contentWidth - BULLET_PREFIX.length;
  const descMaxWidth = contentWidth - DESC_INDENT.length;

  return (
    <box flexDirection="column">
      <text fg={colors.accent} attributes={1}>{`${INDENT}${label}`}</text>
      {agents.map((agent) => (
        <box key={agent.name} flexDirection="column" marginBottom={SPACING.NONE}>
          <text fg={colors.foreground}>
            {`${BULLET_PREFIX}${truncateToWidth(agent.name, nameMaxWidth)}`}
          </text>
          <text fg={colors.muted}>
            {`${DESC_INDENT}${truncateToWidth(agent.description, descMaxWidth)}`}
          </text>
        </box>
      ))}
    </box>
  );
}

export function AgentListIndicator({ view }: AgentListIndicatorProps): React.ReactNode {
  const colors = useThemeColors();
  const { width: terminalWidth } = useTerminalDimensions();

  // Account for the 2-char bullet gutter from TextPartDisplay
  const contentWidth = terminalWidth - 2;

  const dividerWidth = Math.min(contentWidth - INDENT.length, 40);
  const divider = CONNECTOR.horizontal.repeat(Math.max(dividerWidth, 4));

  return (
    <box flexDirection="column">
      <text fg={colors.foreground} attributes={1}>
        {`${view.heading} (${view.totalCount})`}
      </text>
      <text>{""}</text>

      {view.totalCount === 0 && (
        <text fg={colors.muted}>{`${INDENT}No agents discovered.`}</text>
      )}

      <AgentSection label="Project" agents={view.projectAgents} contentWidth={contentWidth} />

      {view.projectAgents.length > 0 && view.globalAgents.length > 0 && (
        <box flexDirection="column" marginTop={SPACING.ELEMENT} marginBottom={SPACING.ELEMENT}>
          <text fg={colors.dim}>{`${INDENT}${divider}`}</text>
        </box>
      )}

      <AgentSection label="Global" agents={view.globalAgents} contentWidth={contentWidth} />
    </box>
  );
}
