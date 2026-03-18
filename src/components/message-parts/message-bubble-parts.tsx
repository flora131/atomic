/**
 * MessageBubbleParts Component
 *
 * Renders a ChatMessage using the parts-based rendering system.
 * Each part is dispatched to its corresponding renderer via PART_REGISTRY.
 */

import React from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { ChatMessage } from "@/types/chat.ts";
import type { Part, ToolPart } from "@/state/parts/types.ts";
import type { QuestionAnswer, UserQuestion } from "@/components/user-question-dialog.tsx";
import { UserQuestionDialog } from "@/components/user-question-dialog.tsx";
import { PART_REGISTRY } from "@/components/message-parts/registry.tsx";
import { isCompletedHitlPart } from "@/components/message-parts/tool-part-display.tsx";
import { SPACING } from "@/theme/spacing.ts";

export function orderPartsForTaskOutputDisplay(parts: ReadonlyArray<Part>): Part[] {
  return [...parts];
}

/**
 * Legacy helper kept for API compatibility.
 *
 * Tool parts are no longer hidden behind a sub-agent tree, so no
 * toolCallIds are consumed.
 */
export function getConsumedTaskToolCallIds(parts: ReadonlyArray<Part>): Set<string> {
  void parts;
  return new Set<string>();
}

export interface MessageBubblePartsProps {
  message: ChatMessage;
  syntaxStyle?: SyntaxStyle;
  activeHitlToolCallId?: string | null;
  activeQuestion?: UserQuestion | null;
  handleQuestionAnswer?: (answer: QuestionAnswer) => void;
  onAgentDoneRendered?: (marker: { agentId: string; timestampMs: number }) => void;
}

function getReasoningSourceKey(part: Part): string {
  if (part.type !== "reasoning") {
    return "";
  }

  const sourceKey = part.thinkingSourceKey;
  if (typeof sourceKey !== "string") {
    return "";
  }

  return sourceKey.trim();
}

function getPartRenderKeyBase(part: Part): string {
  const sourceKey = getReasoningSourceKey(part);
  if (sourceKey.length > 0) {
    return `reasoning-source:${sourceKey}`;
  }

  return part.id;
}

export function buildPartRenderKeys(parts: ReadonlyArray<Part>): string[] {
  const seen = new Map<string, number>();

  return parts.map((part) => {
    const baseKey = getPartRenderKeyBase(part);
    const existingCount = seen.get(baseKey) ?? 0;
    seen.set(baseKey, existingCount + 1);

    if (existingCount === 0) {
      return baseKey;
    }

    return `${baseKey}#${existingCount}`;
  });
}

/**
 * Renders a message from its parts array using the PART_REGISTRY.
 * Returns null if the message has no parts.
 *
 * Spacing principle: the parent container owns all inter-part spacing
 * via `gap`. Child part components must NOT add their own marginBottom
 * to avoid double-spacing. Parts that need extra section-level
 * separation can add marginTop internally.
 */
export function MessageBubbleParts({
  message,
  syntaxStyle,
  activeHitlToolCallId,
  activeQuestion,
  handleQuestionAnswer,
  onAgentDoneRendered,
}: MessageBubblePartsProps): React.ReactNode {
  const allParts = orderPartsForTaskOutputDisplay(message.parts ?? []);
  // Filter out completed HITL tool parts — their Q&A is already rendered by
  // HitlResponseWidget in the preceding user message. Removing them here
  // avoids phantom gap slots in the flex container.
  const parts = allParts.filter(
    (p) => !(p.type === "tool" && isCompletedHitlPart(p)),
  );
  const renderKeys = buildPartRenderKeys(parts);

  if (parts.length === 0) {
    return null;
  }

  return (
    <box flexDirection="column" gap={SPACING.ELEMENT}>
      {parts.map((part, index) => {
        const Renderer = PART_REGISTRY[part.type];
        if (!Renderer) return null;

        const isActiveHitlTool = part.type === "tool"
          && activeHitlToolCallId != null
          && (part as ToolPart).toolCallId === activeHitlToolCallId
          && (part as ToolPart).pendingQuestion != null;

        if (isActiveHitlTool && activeQuestion && handleQuestionAnswer) {
          return (
            <React.Fragment key={renderKeys[index] ?? part.id}>
              <Renderer
                part={part}
                isLast={index === parts.length - 1}
                syntaxStyle={syntaxStyle}
                onAgentDoneRendered={onAgentDoneRendered}
              />
              <UserQuestionDialog
                question={activeQuestion}
                onAnswer={handleQuestionAnswer}
                visible={true}
              />
            </React.Fragment>
          );
        }

        return (
          <Renderer
            key={renderKeys[index] ?? part.id}
            part={part}
            isLast={index === parts.length - 1}
            syntaxStyle={syntaxStyle}
            onAgentDoneRendered={onAgentDoneRendered}
          />
        );
      })}
    </box>
  );
}
