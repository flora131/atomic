/**
 * FooterStatus Component
 *
 * Displays a status bar at the bottom of the chat UI showing:
 * - Streaming hints (esc to interrupt, enqueue keybind) when streaming
 * - Workflow hints (ctrl+c twice to exit) when workflow is active
 * - Background agent status (ctrl+f to kill) when background agents exist
 *
 * Reference: Task #4 - Create FooterStatus component
 */

import React from "react";
import { useTheme } from "../theme.tsx";
import { SPACING } from "../constants/spacing.ts";
import { MISC } from "../constants/icons.ts";
import type { ParallelAgent } from "./parallel-agents-tree.tsx";
import { formatBackgroundAgentFooterStatus } from "../utils/background-agent-footer.ts";
import { BACKGROUND_FOOTER_CONTRACT } from "../utils/background-agent-contracts.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface FooterStatusComponentProps {
  /** Whether streaming is active */
  isStreaming?: boolean;
  /** Whether a workflow is currently active */
  workflowActive?: boolean;
  /** Enqueue shortcut label (e.g. "ctrl+shift+enter") */
  enqueueShortcutLabel?: string;
  /** Active background agents */
  backgroundAgents?: readonly ParallelAgent[];
}

// ============================================================================
// FOOTER STATUS COMPONENT
// ============================================================================

export function FooterStatus({
  isStreaming = false,
  workflowActive = false,
  enqueueShortcutLabel = "ctrl+shift+enter",
  backgroundAgents = [],
}: FooterStatusComponentProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;

  const showStreamingHints = isStreaming && !workflowActive;
  const showWorkflowHints = workflowActive;
  const hasBackgroundAgents = backgroundAgents.length > 0;

  // Nothing to show when idle with no background agents
  if (!showStreamingHints && !showWorkflowHints && !hasBackgroundAgents) {
    return null;
  }

  return (
    <box
      flexDirection="row"
      paddingLeft={SPACING.CONTAINER_PAD}
      paddingRight={SPACING.CONTAINER_PAD}
      paddingTop={SPACING.NONE}
      paddingBottom={SPACING.NONE}
      gap={SPACING.ELEMENT}
      flexShrink={0}
    >
      {showWorkflowHints && (
        <>
          <text style={{ fg: colors.accent }}>workflow</text>
          <text style={{ fg: colors.muted }}>{MISC.separator}</text>
        </>
      )}
      {(showStreamingHints || showWorkflowHints) && (
        <>
          <text style={{ fg: colors.muted }}>esc to interrupt</text>
          <text style={{ fg: colors.muted }}>{MISC.separator}</text>
          <text style={{ fg: colors.muted }}>{enqueueShortcutLabel} enqueue</text>
        </>
      )}
      {showWorkflowHints && (
        <>
          <text style={{ fg: colors.muted }}>{MISC.separator}</text>
          <text style={{ fg: colors.muted }}>ctrl+c twice to exit workflow</text>
        </>
      )}
      {hasBackgroundAgents && (
        <>
          {(showStreamingHints || showWorkflowHints) && (
            <text style={{ fg: colors.muted }}>{MISC.separator}</text>
          )}
          <text style={{ fg: colors.accent }}>
            {formatBackgroundAgentFooterStatus(backgroundAgents)}
          </text>
          <text style={{ fg: colors.dim }}>
            {MISC.separator} {BACKGROUND_FOOTER_CONTRACT.terminateHintText}
          </text>
        </>
      )}
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default FooterStatus;
