import React, { useCallback, useMemo } from "react";
import { PROMPT, STATUS, CONNECTOR, MISC } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";
import { useThemeColors } from "@/theme/index.tsx";
import {
  getActiveBackgroundAgents,
  normalizeSkillTrackingKey,
  shouldShowCompletionSummary,
  shouldShowMessageLoadingIndicator,
} from "@/state/chat/shared/helpers/index.ts";
import { TaskListPanel } from "@/components/task-list-panel.tsx";
import { HitlResponseWidget } from "@/components/hitl-response-widget.tsx";
import { MessageBubbleParts } from "@/components/message-parts/message-bubble-parts.tsx";
import { CompletionSummary, LoadingIndicator } from "@/components/chat-loading-indicator.tsx";

import type {
  ChatMessage,
  MessageBubbleProps,
} from "@/state/chat/shared/types/index.ts";
import type {
  TruncationPart,
  Part,
  TextPart,
} from "@/state/parts/index.ts";
import {
  isToolPart,
  mergeParallelAgentsIntoParts,
} from "@/state/parts/index.ts";
import { HITL_DECLINED_MESSAGE } from "@/lib/ui/hitl-response.ts";

/** Extract first non-empty line and truncate to maxLen, appending "…" if needed. */
function truncateFirstLine(text: string, maxLen: number): string {
  const firstLine = text.split("\n").find((line) => line.trim())?.trim() ?? "";
  return firstLine.length > maxLen
    ? `${firstLine.slice(0, maxLen)}…`
    : firstLine;
}

function getRenderableAssistantParts(
  message: ChatMessage,
): Part[] {
  const skillIndicatorKeys = new Set(
    (message.skillLoads ?? [])
      .map((skillLoad) => normalizeSkillTrackingKey(skillLoad.skillName))
      .filter((key) => key.length > 0),
  );

  const shouldHideSkillToolIndicator = (
    toolName: string,
    input: Record<string, unknown>,
  ): boolean => {
    if (toolName.trim().toLowerCase() !== "skill") {
      return false;
    }
    if (skillIndicatorKeys.size === 0) {
      return false;
    }
    const rawSkillName = typeof input.skill === "string"
      ? input.skill
      : (typeof input.name === "string" ? input.name : "");
    const key = normalizeSkillTrackingKey(rawSkillName);
    if (key.length === 0) {
      return true;
    }
    return skillIndicatorKeys.has(key);
  };

  let parts = [...(message.parts ?? [])].filter((part) => {
    if (!isToolPart(part)) {
      return true;
    }
    return !shouldHideSkillToolIndicator(part.toolName, part.input);
  });

  const effectiveParallelAgents = message.parallelAgents;
  if (effectiveParallelAgents && effectiveParallelAgents.length > 0) {
    parts = mergeParallelAgentsIntoParts(
      parts,
      effectiveParallelAgents,
      message.timestamp,
    );
  }

  if (message.id.startsWith("compact_")) {
    const existingTruncationIdx = parts.findIndex(
      (part) => part.type === "truncation",
    );
    const truncationPart: TruncationPart = {
      id: existingTruncationIdx >= 0
        ? parts[existingTruncationIdx]!.id
        : `truncation-${message.id}`,
      type: "truncation",
      summary: message.content,
      createdAt: existingTruncationIdx >= 0
        ? parts[existingTruncationIdx]!.createdAt
        : message.timestamp,
    };
    if (existingTruncationIdx >= 0) {
      parts[existingTruncationIdx] = truncationPart;
    } else {
      parts.push(truncationPart);
    }
    return parts;
  }

  const hasTextPart = parts.some((part) => part.type === "text");
  if (!hasTextPart && message.content.trim()) {
    const textPart: TextPart = {
      id: `text-${message.id}`,
      type: "text",
      content: message.content,
      isStreaming: Boolean(message.streaming),
      createdAt: message.timestamp,
    };
    parts.push(textPart);
  }

  return parts;
}

export function MessageBubble({
  activeBackgroundAgentCount,
  message,
  isLast,
  syntaxStyle,
  hideLoading = false,
  todoItems,
  tasksExpanded = false,
  workflowSessionId: _workflowSessionId,
  workflowActive = false,
  showTodoPanel = true,
  elapsedMs,
  collapsed = false,
  streamingMeta,
  onAgentDoneRendered,
}: MessageBubbleProps): React.ReactNode {
  const themeColors = useThemeColors();
  const showPersistentTaskPanel = Boolean(isLast && showTodoPanel && (todoItems?.length ?? 0) > 0);

  const handleAgentDoneRendered = useCallback((marker: { agentId: string; timestampMs: number }) => {
    onAgentDoneRendered?.({
      messageId: message.id,
      agentId: marker.agentId,
      timestampMs: marker.timestampMs,
    });
  }, [message.id, onAgentDoneRendered]);

  // Memoize assistant part computation — only recomputes when the message
  // reference or isLast changes, avoiding repeated array copies/filters
  // during high-frequency streaming re-renders (elapsedMs, streamingMeta).
  const assistantParts = useMemo(
    () => message.role === "assistant" ? getRenderableAssistantParts(message) : null,
    [message],
  );

  if (collapsed && !message.streaming) {
    if (message.role === "user") {
      const collapsedLabel = message.hitlContext
        ? `${STATUS.success} ${truncateFirstLine(message.hitlContext.question, 40)} → ${truncateFirstLine(message.hitlContext.answer, 30)}`
        : truncateFirstLine(message.content, 78);
      return (
        <box
          paddingLeft={SPACING.CONTAINER_PAD}
          paddingRight={SPACING.CONTAINER_PAD}
          marginBottom={SPACING.NONE}
        >
          <text wrapMode="char" selectable>
            <span fg={themeColors.dim}>{PROMPT.cursor} </span>
            <span fg={themeColors.muted}>
              {collapsedLabel}
            </span>
          </text>
        </box>
      );
    }

    if (message.role === "assistant") {
      const toolCount = (message.parts ?? []).filter((p) => p.type === "tool").length;
      const toolLabel = toolCount > 0
        ? ` ${MISC.separator} ${toolCount} tool${toolCount !== 1 ? "s" : ""}`
        : "";
      return (
        <box
          paddingLeft={SPACING.CONTAINER_PAD}
          paddingRight={SPACING.CONTAINER_PAD}
          marginBottom={isLast ? SPACING.NONE : SPACING.ELEMENT}
        >
          <text wrapMode="char">
            <span fg={themeColors.dim}>  {CONNECTOR.subStatus} </span>
            <span fg={themeColors.muted}>
              {truncateFirstLine(message.content, 74)}
            </span>
            <span fg={themeColors.dim}>{toolLabel}</span>
          </text>
        </box>
      );
    }

    const isCollapsedError = message.content.startsWith("[error]");
    return (
      <box
        paddingLeft={SPACING.CONTAINER_PAD}
        paddingRight={SPACING.CONTAINER_PAD}
        marginBottom={isLast ? SPACING.NONE : SPACING.ELEMENT}
      >
        <text wrapMode="char" fg={isCollapsedError ? themeColors.error : themeColors.muted}>
          {truncateFirstLine(message.content, 80)}
        </text>
      </box>
    );
  }

  if (message.role === "user") {
    return (
      <box
        flexDirection="column"
        marginBottom={isLast ? SPACING.NONE : SPACING.ELEMENT}
        paddingLeft={SPACING.CONTAINER_PAD}
        paddingRight={SPACING.CONTAINER_PAD}
      >
        {message.hitlContext ? (
          <HitlResponseWidget context={message.hitlContext} />
        ) : (
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            <text wrapMode="char">
              <span fg={themeColors.accent}>{PROMPT.cursor} </span>
              <span
                bg={themeColors.userBubbleBg}
                fg={themeColors.userBubbleFg}
              >
                {" "}{message.content}{" "}
              </span>
            </text>
          </box>
        )}

        {showPersistentTaskPanel && (
          <TaskListPanel
            items={todoItems ?? []}
            expanded={tasksExpanded}
            workflowActive={workflowActive}
          />
        )}
      </box>
    );
  }

  if (message.role === "assistant" && assistantParts) {
    const renderableMessage = {
      ...message,
      parts: showPersistentTaskPanel
        ? assistantParts.filter((part) => part.type !== "task-list")
        : assistantParts,
    };

    const effectiveParallelAgents = message.parallelAgents;
    const hasActiveBackgroundAgents = getActiveBackgroundAgents(
      effectiveParallelAgents ?? [],
    ).length > 0;
    const liveTaskItems = message.streaming ? todoItems : message.taskItems;
    const showLoadingIndicator = shouldShowMessageLoadingIndicator(message, {
      liveTodoItems: liveTaskItems,
      activeBackgroundAgentCount,
      keepAliveForWorkflow: workflowActive && isLast && !message.wasInterrupted,
    });

    return (
      <box
        flexDirection="column"
        marginBottom={isLast ? SPACING.NONE : SPACING.ELEMENT}
        paddingLeft={SPACING.CONTAINER_PAD}
        paddingRight={SPACING.CONTAINER_PAD}
      >
        <MessageBubbleParts
          message={renderableMessage}
          syntaxStyle={syntaxStyle}
          onAgentDoneRendered={handleAgentDoneRendered}
        />

        {showPersistentTaskPanel && (
          <TaskListPanel
            items={todoItems ?? []}
            expanded={tasksExpanded}
            workflowActive={workflowActive}
          />
        )}

        {message.wasInterrupted && !message.streaming && (
          <box marginTop={SPACING.ELEMENT}>
            <text fg={themeColors.warning}>
              {STATUS.active} {
                (message.parts ?? []).some((p) =>
                  isToolPart(p) && p.hitlResponse?.cancelled,
                )
                  ? HITL_DECLINED_MESSAGE
                  : "Operation cancelled by user"
              }
            </text>
          </box>
        )}

        {showLoadingIndicator && !hideLoading && (
          <box
            flexDirection="row"
            alignItems="flex-start"
            marginTop={renderableMessage.parts.length > 0
              ? SPACING.ELEMENT
              : SPACING.NONE}
          >
            <LoadingIndicator
              verbOverride={message.spinnerVerb}
              elapsedMs={elapsedMs}
              outputTokens={streamingMeta?.outputTokens ?? message.outputTokens}
              thinkingMs={streamingMeta?.thinkingMs ?? message.thinkingMs}
              isStreaming={Boolean(message.streaming)}
            />
          </box>
        )}

        {shouldShowCompletionSummary(message, hasActiveBackgroundAgents, activeBackgroundAgentCount) && (
          <box marginTop={SPACING.ELEMENT}>
            <CompletionSummary
              durationMs={message.durationMs!}
              outputTokens={message.outputTokens}
              thinkingMs={message.thinkingMs}
            />
          </box>
        )}


      </box>
    );
  }

  const isErrorMessage = message.content.startsWith("[error]");

  return (
    <box
      flexDirection="column"
      marginBottom={isLast ? SPACING.NONE : SPACING.ELEMENT}
      paddingLeft={SPACING.CONTAINER_PAD}
      paddingRight={SPACING.CONTAINER_PAD}
    >
      <text wrapMode="char" fg={isErrorMessage ? themeColors.error : themeColors.muted}>
        {message.content}
      </text>
    </box>
  );
}
