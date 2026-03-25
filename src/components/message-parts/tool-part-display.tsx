/**
 * ToolPartDisplay Component
 *
 * Renders a ToolPart with inline HITL (Human-in-the-Loop) support.
 * Shows tool execution status and inline HITL questions that appear
 * directly after the tool output, rather than as fixed overlays.
 */

import React from "react";
import { getToolStatusColorKey, ToolResult } from "@/components/tool-result.tsx";
import { isSdkAskQuestionToolName } from "@/components/tool-registry/registry/index.ts";
import { useThemeColors } from "@/theme/index.tsx";
import { CONNECTOR, STATUS } from "@/theme/icons.ts";
import type { ToolPart, ToolState } from "@/state/parts/types.ts";
import type { ToolExecutionStatus } from "@/state/parts/types.ts";
import { getHitlResponseRecord, type HitlResponseRecord } from "@/lib/ui/hitl-response.ts";
import {
  formatSubagentToolSummary,
  getSubagentToolDisplayName,
} from "@/components/message-parts/subagent-tool-summary.ts";
import { isHitlToolName } from "@/state/streaming/pipeline-tools/shared.ts";

export interface ToolPartDisplayProps {
  part: ToolPart;
  summaryOnly?: boolean;
}

/**
 * Converts ToolState (discriminated union) to ToolExecutionStatus (simple string).
 * This allows us to bridge between the parts model and the existing ToolResult component.
 */
function toolStateToStatus(state: ToolState): ToolExecutionStatus {
  return state.status;
}

/**
 * Displays a pending HITL question inline in the message parts.
 * Provides a visible footprint of the question in the chat history
 * while the interactive dialog handles the actual answering.
 */
function PendingHitlDisplay({ questionText }: {
  questionText: string;
}): React.ReactNode {
  const colors = useThemeColors();
  const hasQuestion = questionText.length > 0;

  return (
    <box flexDirection="column">
      <text wrapMode="word">
        <span fg={colors.accent}>{STATUS.active} ask_user</span>
      </text>
      {hasQuestion && (
        <text wrapMode="word">
          <span fg={colors.border}>  {CONNECTOR.subStatus} </span>
          <span fg={colors.muted}>{questionText}</span>
        </text>
      )}
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
    const raw = input.questions[0];
    const first = raw != null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined;
    if (first && typeof first.question === "string") {
      return first.question;
    }
  }

  // Fallback fields
  const fallback = input.text ?? input.message ?? "";
  return String(fallback);
}

/**
 * Synthesizes an HitlResponseRecord from a completed HITL tool's metadata/output
 * when the normal hitlResponse was never set (e.g. due to toolCallId mismatch
 * between stream.tool.start and stream.human_input_required).
 */
function synthesizeHitlResponse(part: ToolPart): HitlResponseRecord | null {
  if (part.state.status !== "completed") return null;

  const fromOutput = getHitlResponseRecord({ output: part.output });
  if (fromOutput) return fromOutput;

  // metadata.answers format from OpenCode SDK question tool: [[answer1], [answer2]]
  const rawAnswers = part.metadata?.answers;
  if (Array.isArray(rawAnswers) && rawAnswers.length > 0) {
    const answerText = rawAnswers
      .flatMap((a) => Array.isArray(a) ? a : [a])
      .filter((a): a is string => typeof a === "string")
      .join(", ");
    if (answerText) {
      return {
        cancelled: false,
        responseMode: "option",
        answerText,
        displayText: `User answered: "${answerText}"`,
      };
    }
  }

  // Fallback: extract from raw output string (e.g. "...\"Question\"=\"Answer\"...")
  if (typeof part.output === "string" && part.output.trim()) {
    const answerMatches = [...part.output.matchAll(/="([^"]+)"/g)];
    if (answerMatches.length > 0) {
      const answerText = answerMatches.map((m) => m[1]).join(", ");
      return {
        cancelled: false,
        responseMode: "option",
        answerText,
        displayText: `User answered: "${answerText}"`,
      };
    }
  }

  return null;
}

/**
 * Main ToolPartDisplay component.
 * Renders tool output with inline HITL overlay support.
 * HITL tools skip the standard ToolResult to avoid duplicate UI with the dialog.
 */
export function ToolPartDisplay({ part, summaryOnly = false }: ToolPartDisplayProps): React.ReactNode {
  const colors = useThemeColors();

  if (summaryOnly) {
    if (isSdkAskQuestionToolName(part.toolName)) {
      return (
        <ToolResult
          toolName={part.toolName}
          input={part.input}
          output={part.output}
          status={toolStateToStatus(part.state)}
        />
      );
    }

    const stateColor = colors[getToolStatusColorKey(part.state.status)];
    const toolLabel = getSubagentToolDisplayName(part.toolName);
    const summaryText = formatSubagentToolSummary(part.toolName, part.input);
    const suffix = summaryText.startsWith(toolLabel)
      ? summaryText.slice(toolLabel.length)
      : ` ${summaryText}`;
    return (
      <text wrapMode="word">
        <span fg={colors.accent} attributes={1}>{toolLabel}</span>
        <span fg={stateColor}>{suffix}</span>
      </text>
    );
  }

  const isHitlTool = isHitlToolName(part.toolName);

  if (isHitlTool) {
    const resolvedResponse = part.hitlResponse ?? synthesizeHitlResponse(part);
    const isCompleted = !part.pendingQuestion && resolvedResponse;
    const isPending = Boolean(part.pendingQuestion);
    const isRunning = part.state.status === "running" && !part.pendingQuestion && !resolvedResponse;

    // Completed HITL: render the Q&A inline on the tool part
    if (isCompleted) {
      const questionText = extractQuestionText(part.input);
      const answerText = resolvedResponse.answerText || resolvedResponse.displayText;
      const cancelled = resolvedResponse.cancelled;
      const statusIcon = cancelled ? STATUS.error : STATUS.success;
      const answerColor = cancelled ? colors.warning : colors.success;
      return (
        <box flexDirection="column">
          <text wrapMode="word">
            <span fg={colors.accent}>{statusIcon} ask_user</span>
          </text>
          {questionText.length > 0 && (
            <text wrapMode="word">
              <span fg={colors.border}>  {CONNECTOR.subStatus} </span>
              <span fg={colors.muted}>{questionText}</span>
            </text>
          )}
          <text wrapMode="word">
            <span fg={colors.border}>  {CONNECTOR.subStatus} </span>
            <span fg={answerColor}>{cancelled ? "Declined" : answerText}</span>
          </text>
        </box>
      );
    }

    // Pending HITL: inline footprint showing question while dialog is active
    if (isPending) {
      return <PendingHitlDisplay questionText={extractQuestionText(part.input)} />;
    }

    // Running HITL without pending dialog — show a minimal status line
    if (isRunning) {
      return (
        <text wrapMode="word">
          <span fg={colors.accent}>{STATUS.active} ask_user</span>
        </text>
      );
    }

    return null;
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
