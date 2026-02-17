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
import { CONNECTOR, STATUS, TREE } from "../../constants/icons.ts";
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
 * Displays a completed HITL response inline showing both the original
 * question and the user's answer in a clear tree hierarchy:
 *   ✓ ask_user
 *   ├ Question text here...
 *   └ User answered: "answer text"
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
  const responseColor = isDeclined ? colors.muted : colors.foreground;
  const hasQuestion = questionText.length > 0;

  return (
    <box flexDirection="column">
      {/* Header: status icon + tool label */}
      <text wrapMode="word">
        <span style={{ fg: statusColor }}>{statusIcon}</span>
        <span style={{ fg: colors.accent }}> ask_user</span>
      </text>

      {/* Question line — show the full original question */}
      {hasQuestion && (
        <text wrapMode="word">
          <span style={{ fg: colors.border }}>  {TREE.branch} </span>
          <span style={{ fg: colors.foreground }}>{questionText}</span>
        </text>
      )}

      {/* Response line — tree connector for visual hierarchy */}
      <text wrapMode="word">
        <span style={{ fg: colors.border }}>  {CONNECTOR.subStatus} </span>
        <span style={{ fg: responseColor }}>
          {isDeclined ? "Declined" : `User answered: "${hitlResponse.answerText}"`}
        </span>
      </text>
    </box>
  );
}

/**
 * Extracts the question text from a HITL tool's input parameters.
 * Handles both single-question format ({question: "..."}) and
 * multi-question array format ({questions: [{question: "..."}]}).
 */
function extractQuestionText(input: Record<string, unknown>): string {
  // Direct question field
  if (typeof input.question === "string" && input.question.length > 0) {
    return input.question;
  }

  // questions[] array format (AskUserQuestion from Claude SDK)
  if (Array.isArray(input.questions) && input.questions.length > 0) {
    const first = input.questions[0] as Record<string, unknown> | undefined;
    if (first && typeof first.question === "string") {
      return first.question;
    }
  }

  // Fallback fields
  const fallback = input.text ?? input.message ?? "";
  return String(fallback);
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
