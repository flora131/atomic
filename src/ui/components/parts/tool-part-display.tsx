/**
 * ToolPartDisplay Component
 *
 * Renders a ToolPart with inline HITL (Human-in-the-Loop) support.
 * Shows tool execution status and inline HITL questions that appear
 * directly after the tool output, rather than as fixed overlays.
 */

import React from "react";
import { ToolResult } from "../tool-result.tsx";
import { UserQuestionInline } from "./user-question-inline.tsx";
import { useThemeColors } from "../../theme.tsx";
import { PROMPT } from "../../constants/icons.ts";
import type { ToolPart, ToolState } from "../../parts/types.ts";
import type { ToolExecutionStatus } from "../../hooks/use-streaming-state.ts";
import type { HitlResponseRecord } from "../../utils/hitl-response.ts";

export interface ToolPartDisplayProps {
  part: ToolPart;
  isLast: boolean;
}

/**
 * Converts ToolState (discriminated union) to ToolExecutionStatus (simple string).
 * This allows us to bridge between the parts model and the existing ToolResult component.
 */
function toolStateToStatus(state: ToolState): ToolExecutionStatus {
  return state.status as ToolExecutionStatus;
}

/**
 * Displays a completed HITL response inline.
 * Shows what the user answered in the chat history as a compact record.
 */
function CompletedHitlDisplay({ hitlResponse }: { hitlResponse: HitlResponseRecord }): React.ReactNode {
  const themeColors = useThemeColors();
  return (
    <box flexDirection="column" marginBottom={1}>
      <text style={{ fg: hitlResponse.cancelled ? themeColors.muted : themeColors.accent }}>
        {PROMPT.cursor} {hitlResponse.displayText}
      </text>
    </box>
  );
}

/**
 * Main ToolPartDisplay component.
 * Renders tool output with inline HITL overlay support.
 */
export function ToolPartDisplay({ part, isLast }: ToolPartDisplayProps): React.ReactNode {
  return (
    <box flexDirection="column">
      {/* Tool output using existing ToolResult component */}
      <ToolResult
        toolName={part.toolName}
        input={part.input}
        output={part.output}
        status={toolStateToStatus(part.state)}
      />

      {/* Active HITL: inline question (NOT a fixed dialog) */}
      {part.pendingQuestion && (
        <UserQuestionInline
          question={part.pendingQuestion}
          onAnswer={(answer) => {
            part.pendingQuestion?.respond(answer);
          }}
        />
      )}

      {/* Completed HITL: compact record */}
      {part.hitlResponse && !part.pendingQuestion && (
        <CompletedHitlDisplay hitlResponse={part.hitlResponse} />
      )}
    </box>
  );
}

export default ToolPartDisplay;
