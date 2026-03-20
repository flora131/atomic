/**
 * FooterStatus Component
 *
 * Displays a status bar at the bottom of the chat UI showing:
 * - Streaming hints (esc to interrupt, enqueue keybind) when streaming
 * - Workflow hints (ctrl+c twice to exit) when workflow is active
 *
 * Reference: Task #4 - Create FooterStatus component
 */

import React from "react";
import { useTheme } from "@/theme/index.tsx";
import { SPACING } from "@/theme/spacing.ts";
import { MISC } from "@/theme/icons.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface FooterStatusComponentProps {
  /** Whether streaming is active */
  isStreaming?: boolean;
  /** Whether a workflow is currently active */
  workflowActive?: boolean;
  /** Number of active background agents (running/pending/background status) */
  backgroundAgentCount?: number;
}

// ============================================================================
// FOOTER STATUS COMPONENT
// ============================================================================

export function FooterStatus({
  isStreaming = false,
  workflowActive = false,
  backgroundAgentCount = 0,
}: FooterStatusComponentProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;

  const showStreamingHints = isStreaming && !workflowActive;
  const showWorkflowHints = workflowActive;
  const showBackgroundHints = backgroundAgentCount > 0;

  if (!showStreamingHints && !showWorkflowHints && !showBackgroundHints) {
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
          <text fg={colors.accent}>workflow</text>
          <text fg={colors.muted}>{MISC.separator}</text>
        </>
      )}
      {(showStreamingHints || showWorkflowHints) && (
        <>
          <text fg={colors.muted}>esc to interrupt</text>
        </>
      )}
      {showWorkflowHints && (
        <>
          <text fg={colors.muted}>{MISC.separator}</text>
          <text fg={colors.muted}>ctrl+c twice to exit workflow</text>
        </>
      )}
      {showBackgroundHints && (
        <>
          {(showStreamingHints || showWorkflowHints) && (
            <text fg={colors.muted}>{MISC.separator}</text>
          )}
          <text fg={colors.accent}>
            [{backgroundAgentCount}] local agent{backgroundAgentCount !== 1 ? "s" : ""}
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
