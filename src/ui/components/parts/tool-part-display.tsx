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
import { PROMPT, STATUS } from "../../constants/icons.ts";
import { SPACING } from "../../constants/spacing.ts";
import type { ToolPart, ToolState } from "../../parts/types.ts";
import type { ToolExecutionStatus } from "../../hooks/use-streaming-state.ts";
import type { HitlResponseRecord } from "../../utils/hitl-response.ts";

export interface ToolPartDisplayProps {
  part: ToolPart;
}

const HITL_TOOL_NAMES = new Set(["AskUserQuestion", "question", "ask_user"]);

/**
 * Converts ToolState (discriminated union) to ToolExecutionStatus (simple string).
 * This allows us to bridge between the parts model and the existing ToolResult component.
 */
function toolStateToStatus(state: ToolState): ToolExecutionStatus {
  return state.status as ToolExecutionStatus;
}

/**
 * Displays a completed HITL response inline with a compact, elegant style
 * matching the ToolResult header pattern: [status] [label] [question] / [answer].
 */
function CompletedHitlDisplay({ hitlResponse, questionText }: {
  hitlResponse: HitlResponseRecord;
  questionText: string;
  toolName: string;
}): React.ReactNode {
  const colors = useThemeColors();
  const isDeclined = hitlResponse.cancelled || hitlResponse.responseMode === "declined";
  const statusIcon = isDeclined ? STATUS.error : STATUS.success;
  const statusColor = isDeclined ? colors.warning : colors.success;

  return (
    <box flexDirection="column" marginBottom={SPACING.ELEMENT}>
      {/* Header: status icon + question text */}
      <text wrapMode="word">
        <span style={{ fg: statusColor }}>{statusIcon}</span>
        <span style={{ fg: colors.dim }}> ask_user</span>
        {questionText.length > 0 && (
          <span style={{ fg: colors.muted }}> {questionText}</span>
        )}
      </text>

      {/* Response line — indented under the header */}
      <text style={{ fg: isDeclined ? colors.muted : colors.dim }}>
        {"  "}{PROMPT.cursor} {hitlResponse.displayText}
      </text>
    </box>
  );
}

/**
 * Extracts the question text from a HITL tool's input parameters.
 */
function extractQuestionText(input: Record<string, unknown>): string {
  const question = input.question ?? input.text ?? input.message ?? "";
  return String(question);
}

/**
 * Main ToolPartDisplay component.
 * Renders tool output with inline HITL overlay support.
 * HITL tools skip the standard ToolResult to avoid duplicate UI with the dialog.
 */
export function ToolPartDisplay({ part }: ToolPartDisplayProps): React.ReactNode {
  const isHitlTool = HITL_TOOL_NAMES.has(part.toolName);

  if (isHitlTool) {
    return (
      <box flexDirection="column">
        {/* Active HITL: dialog handles rendering, show nothing here */}
        {part.pendingQuestion && (
          <UserQuestionInline
            question={part.pendingQuestion}
            onAnswer={(answer) => {
              part.pendingQuestion?.respond(answer);
            }}
          />
        )}

        {/* Completed HITL: transparent record with question + answer */}
        {part.hitlResponse && !part.pendingQuestion && (
          <CompletedHitlDisplay
            hitlResponse={part.hitlResponse}
            questionText={extractQuestionText(part.input)}
            toolName={part.toolName}
          />
        )}
      </box>
    );
  }

  return (
    <box flexDirection="column">
      {/* Standard tool output */}
      <ToolResult
        toolName={part.toolName}
        input={part.input}
        output={part.output}
        status={toolStateToStatus(part.state)}
      />
    </box>
  );
}

export default ToolPartDisplay;
