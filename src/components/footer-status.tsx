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
}

// ============================================================================
// FOOTER STATUS COMPONENT
// ============================================================================

export function FooterStatus({
  isStreaming = false,
  workflowActive = false,
}: FooterStatusComponentProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;

  const showStreamingHints = isStreaming && !workflowActive;
  const showWorkflowHints = workflowActive;

  if (!showStreamingHints && !showWorkflowHints) {
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
        </>
      )}
      {showWorkflowHints && (
        <>
          <text style={{ fg: colors.muted }}>{MISC.separator}</text>
          <text style={{ fg: colors.muted }}>ctrl+c twice to exit workflow</text>
        </>
      )}
    </box>
  );
}

// ============================================================================
// EXPORTS
// ============================================================================

export default FooterStatus;
