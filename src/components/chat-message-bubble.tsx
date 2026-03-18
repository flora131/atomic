import React from "react";
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
import { TimestampDisplay } from "@/components/timestamp-display.tsx";
import type {
  ChatMessage,
  MessageBubbleProps,
} from "@/state/chat/shared/types/index.ts";
import type {
  CompactionPart,
  Part,
  TextPart,
  ToolPart,
} from "@/state/parts/index.ts";
import {
  mergeParallelAgentsIntoParts,
  syncToolCallsIntoParts,
} from "@/state/parts/index.ts";

function getRenderableAssistantParts(
  message: ChatMessage,
  _isLastMessage: boolean,
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
    if (part.type !== "tool") {
      return true;
    }
    const toolPart = part as ToolPart;
    return !shouldHideSkillToolIndicator(toolPart.toolName, toolPart.input);
  });

  const visibleToolCalls = (message.toolCalls ?? []).filter(
    (toolCall) => !shouldHideSkillToolIndicator(toolCall.toolName, toolCall.input),
  );
  parts = syncToolCallsIntoParts(parts, visibleToolCalls, message.timestamp, message.id);

  const effectiveParallelAgents = message.parallelAgents;
  if (effectiveParallelAgents && effectiveParallelAgents.length > 0) {
    parts = mergeParallelAgentsIntoParts(
      parts,
      effectiveParallelAgents,
      message.timestamp,
    );
  }

  if (message.id.startsWith("compact_")) {
    const existingCompactionIdx = parts.findIndex(
      (part) => part.type === "compaction",
    );
    const compactionPart: CompactionPart = {
      id: existingCompactionIdx >= 0
        ? parts[existingCompactionIdx]!.id
        : `compaction-${message.id}`,
      type: "compaction",
      summary: message.content,
      createdAt: existingCompactionIdx >= 0
        ? parts[existingCompactionIdx]!.createdAt
        : message.timestamp,
    };
    if (existingCompactionIdx >= 0) {
      parts[existingCompactionIdx] = compactionPart;
    } else {
      parts.push(compactionPart);
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
  activeHitlToolCallId,
  activeQuestion,
  message,
  isLast,
  isVerbose = false,
  syntaxStyle,
  hideLoading = false,
  handleQuestionAnswer,
  todoItems,
  tasksExpanded = false,
  workflowSessionDir,
  workflowActive = false,
  showTodoPanel = true,
  elapsedMs,
  collapsed = false,
  streamingMeta,
  onAgentDoneRendered,
}: MessageBubbleProps): React.ReactNode {
  const themeColors = useThemeColors();
  const persistentTaskPanelSessionDir = isLast && showTodoPanel && workflowSessionDir
    ? workflowSessionDir
    : null;
  const shouldShowPersistentTaskPanel = persistentTaskPanelSessionDir !== null;

  if (collapsed && !message.streaming) {
    const truncate = (text: string, maxLen: number) => {
      const firstLine = text.split("\n").find((line) => line.trim())?.trim() ?? "";
      return firstLine.length > maxLen
        ? `${firstLine.slice(0, maxLen)}…`
        : firstLine;
    };

    if (message.role === "user") {
      const collapsedLabel = message.hitlContext
        ? `${STATUS.success} ${truncate(message.hitlContext.question, 40)} → ${truncate(message.hitlContext.answer, 30)}`
        : truncate(message.content, 78);
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
      const toolCount = message.toolCalls?.length ?? 0;
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
              {truncate(message.content, 74)}
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
          {truncate(message.content, 80)}
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

        {persistentTaskPanelSessionDir && (
          <TaskListPanel
            sessionDir={persistentTaskPanelSessionDir}
            expanded={tasksExpanded}
            workflowActive={workflowActive}
          />
        )}
      </box>
    );
  }

  if (message.role === "assistant") {
    const assistantParts = getRenderableAssistantParts(
      message,
      Boolean(isLast),
    );
    const renderableMessage = {
      ...message,
      parts: shouldShowPersistentTaskPanel
        ? assistantParts.filter((part) => part.type !== "task-list")
        : assistantParts,
    };

    const effectiveParallelAgents = message.parallelAgents;
    const hasActiveBackgroundAgents = getActiveBackgroundAgents(
      effectiveParallelAgents ?? [],
    ).length > 0;
    const liveTaskItems = message.streaming ? todoItems : message.taskItems;
    const showLoadingIndicator = shouldShowMessageLoadingIndicator(
      message,
      liveTaskItems,
      activeBackgroundAgentCount,
    );

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
          activeHitlToolCallId={activeHitlToolCallId}
          activeQuestion={activeQuestion}
          handleQuestionAnswer={handleQuestionAnswer}
          onAgentDoneRendered={(marker) => {
            onAgentDoneRendered?.({
              messageId: message.id,
              agentId: marker.agentId,
              timestampMs: marker.timestampMs,
            });
          }}
        />

        {persistentTaskPanelSessionDir && (
          <TaskListPanel
            sessionDir={persistentTaskPanelSessionDir}
            expanded={tasksExpanded}
            workflowActive={workflowActive}
          />
        )}

        {message.wasInterrupted && !message.streaming && (
          <box marginTop={SPACING.ELEMENT}>
            <text fg={themeColors.warning}>
              {STATUS.active} Operation cancelled by user
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

        {isVerbose && !message.streaming && message.timestamp && (
          <box marginTop={SPACING.ELEMENT}>
            <TimestampDisplay
              timestamp={message.timestamp}
              durationMs={message.durationMs}
              modelId={message.modelId}
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
