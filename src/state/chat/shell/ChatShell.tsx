import React, { useCallback, useMemo } from "react";
import { Autocomplete } from "@/components/autocomplete.tsx";
import { FooterStatus } from "@/components/footer-status.tsx";
import { ModelSelectorDialog } from "@/components/model-selector-dialog.tsx";
import { QueueIndicator } from "@/components/queue-indicator.tsx";
import { AtomicHeader } from "@/components/chat-header.tsx";
import { TranscriptView } from "@/components/transcript-view.tsx";
import { UserQuestionDialog } from "@/components/user-question-dialog.tsx";
import { SCROLLBAR, PROMPT } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";
import { getActiveBackgroundAgents } from "@/state/chat/shared/helpers/background-agent-footer.ts";
import type { ShellLayoutProps, ShellInputProps, ShellDialogProps, ShellScrollProps } from "./prop-interfaces.ts";

// Module-level constants for scrollbar options to avoid creating new object
// references on every render (prevents unnecessary re-renders of scrollbox).
const HIDDEN_VERTICAL_SCROLLBAR = { visible: false } as const;
const HIDDEN_HORIZONTAL_SCROLLBAR = { visible: false } as const;

/**
 * ChatShellProps — Composed from focused sub-interfaces.
 *
 * The sub-interfaces group related props by concern:
 * - {@link ShellLayoutProps} — Chrome, header, model display
 * - {@link ShellInputProps} — Textarea, composer, autocomplete
 * - {@link ShellDialogProps} — HITL question dialog
 * - {@link ShellScrollProps} — Scrollbox and scroll behavior
 */
export interface ChatShellProps extends ShellLayoutProps, ShellInputProps, ShellDialogProps, ShellScrollProps {}

export function ChatShell({
  activeQuestion,
  argumentHint,
  autocompleteInput,
  autocompleteMode,
  autocompleteSelectedIndex,
  autocompleteSuggestions,
  availableModels,
  compactionSummary,
  ctrlCPressed,
  currentModelId,
  currentReasoningEffort,
  displayModel,
  dynamicPlaceholder,
  handleAutocompleteIndexChange,
  handleAutocompleteSelect,
  handleBracketedPaste,
  handleModelSelect,
  handleModelSelectorCancel,
  handleMouseUp,
  handleQuestionAnswer,
  handleSubmit,
  handleTextareaContentChange,
  handleTextareaCursorChange,
  historyBufferMessages,
  initialModelId,
  inputSyntaxStyle,
  inputFocused,
  inputScrollbar,
  isEditingQueue,
  isStreaming,
  messageContent,
  messageCount,
  messageQueue,
  messages,
  model,
  parallelAgents,
  scrollAcceleration,
  scrollboxRef,
  setIsEditingQueue,
  showAutocomplete,
  showCompactionHistory,
  showModelSelector,
  streamingMeta,
  textareaKeyBindings,
  textareaRef,
  themeColors,
  tier,
  transcriptMode,
  version,
  workingDir,
  workflowState,
}: ChatShellProps): React.ReactNode {
  const backgroundAgentCount = useMemo(
    () => getActiveBackgroundAgents(parallelAgents).length,
    [parallelAgents],
  );

  const transcriptMessages = useMemo(
    () => [...historyBufferMessages, ...messages],
    [historyBufferMessages, messages],
  );

  const { setEditIndex } = messageQueue;
  const handleQueueEdit = useCallback(
    (index: number) => {
      setEditIndex(index);
      setIsEditingQueue(true);
    },
    [setEditIndex, setIsEditingQueue],
  );

  return (
    <box
      flexDirection="column"
      height="100%"
      width="100%"
      onMouseUp={handleMouseUp}
    >
      <AtomicHeader
        version={version}
        model={displayModel}
        tier={tier}
        workingDir={workingDir}
      />

      {transcriptMode ? (
        <TranscriptView
          messages={transcriptMessages}
          liveThinkingText={streamingMeta?.thinkingText}
          modelId={currentModelId ?? initialModelId ?? model}
          isStreaming={isStreaming}
          streamingMeta={streamingMeta}
        />
      ) : (
        <box flexDirection="column" flexGrow={1}>
          <scrollbox
            key="chat-window"
            ref={scrollboxRef}
            flexGrow={1}
            stickyScroll={true}
            stickyStart="bottom"
            scrollY={true}
            scrollX={false}
            viewportCulling={false}
            paddingLeft={SPACING.CONTAINER_PAD}
            paddingRight={SPACING.CONTAINER_PAD}
            verticalScrollbarOptions={HIDDEN_VERTICAL_SCROLLBAR}
            horizontalScrollbarOptions={HIDDEN_HORIZONTAL_SCROLLBAR}
            scrollAcceleration={scrollAcceleration}
          >
            {showCompactionHistory && compactionSummary && parallelAgents.length === 0 && (
              <box
                flexDirection="column"
                paddingLeft={SPACING.CONTAINER_PAD}
                paddingRight={SPACING.CONTAINER_PAD}
                marginTop={SPACING.ELEMENT}
                marginBottom={SPACING.ELEMENT}
              >
                <box
                  flexDirection="column"
                  border
                  borderStyle="rounded"
                  borderColor={themeColors.muted}
                  paddingLeft={SPACING.CONTAINER_PAD}
                  paddingRight={SPACING.CONTAINER_PAD}
                >
                  <text fg={themeColors.muted} attributes={1}>Compaction Summary</text>
                  <text fg={themeColors.foreground} wrapMode="char" selectable>{compactionSummary}</text>
                </box>
              </box>
            )}

            {messageContent}

            {showModelSelector && (
              <ModelSelectorDialog
                models={availableModels}
                currentModel={currentModelId}
                currentReasoningEffort={currentReasoningEffort}
                onSelect={handleModelSelect}
                onCancel={handleModelSelectorCancel}
                visible={true}
              />
            )}

            {messageQueue.count > 0 && (
              <box marginTop={SPACING.ELEMENT}>
                <QueueIndicator
                  count={messageQueue.count}
                  queue={messageQueue.queue}
                  compact={!isEditingQueue}
                  editable={!isStreaming}
                  editIndex={messageQueue.currentEditIndex}
                  onEdit={handleQueueEdit}
                />
              </box>
            )}

            {activeQuestion && handleQuestionAnswer && (
              <UserQuestionDialog
                question={activeQuestion}
                onAnswer={handleQuestionAnswer}
                visible={true}
              />
            )}

            <box
              visible={!activeQuestion && !showModelSelector}
              border
              borderStyle="rounded"
              borderColor={workflowState.workflowActive ? themeColors.accent : themeColors.inputFocus}
              paddingLeft={SPACING.CONTAINER_PAD}
              paddingRight={SPACING.CONTAINER_PAD}
              marginTop={messageCount > 0 ? SPACING.ELEMENT : SPACING.NONE}
              flexDirection="row"
              alignItems="flex-start"
              flexShrink={0}
            >
              <text flexShrink={0} fg={themeColors.accent}>{PROMPT.cursor}{" "}</text>
              <textarea
                ref={textareaRef}
                placeholder={messageCount === 0 ? dynamicPlaceholder : ""}
                focused={!activeQuestion && !showModelSelector && inputFocused}
                keyBindings={textareaKeyBindings}
                syntaxStyle={inputSyntaxStyle}
                onSubmit={handleSubmit}
                onPaste={handleBracketedPaste}
                onContentChange={handleTextareaContentChange}
                onCursorChange={handleTextareaCursorChange}
                wrapMode="word"
                flexGrow={argumentHint ? 0 : 1}
                flexShrink={1}
                flexBasis={argumentHint ? undefined : 0}
                minWidth={0}
                minHeight={1}
                maxHeight={8}
              />
              {argumentHint && (
                <text fg={themeColors.dim}>{argumentHint}</text>
              )}
              {argumentHint && <box flexGrow={1} />}
              {inputScrollbar.visible && (
                <box flexDirection="column" marginLeft={SPACING.ELEMENT}>
                  {Array.from({ length: inputScrollbar.viewportHeight }).map((_, i) => {
                    const inThumb = i >= inputScrollbar.thumbTop
                      && i < inputScrollbar.thumbTop + inputScrollbar.thumbSize;
                    return (
                      <text
                        key={`input-scroll-${i}`}
                        fg={inThumb ? themeColors.scrollbarFg : themeColors.scrollbarBg}
                      >
                        {inThumb ? SCROLLBAR.thumb : SCROLLBAR.track}
                      </text>
                    );
                  })}
                </box>
              )}
            </box>
            <box visible={!activeQuestion && !showModelSelector}>
              <FooterStatus
                isStreaming={isStreaming}
                workflowActive={workflowState.workflowActive}
                backgroundAgentCount={backgroundAgentCount}
              />
            </box>

            {showAutocomplete && (
              <box marginTop={SPACING.NONE} marginBottom={SPACING.NONE}>
                <Autocomplete
                  input={autocompleteInput}
                  visible={showAutocomplete}
                  selectedIndex={autocompleteSelectedIndex}
                  onSelect={handleAutocompleteSelect}
                  onIndexChange={handleAutocompleteIndexChange}
                  namePrefix={autocompleteMode === "mention" ? "@" : "/"}
                  externalSuggestions={autocompleteMode === "mention" ? autocompleteSuggestions : undefined}
                />
              </box>
            )}

            {ctrlCPressed && (
              <box paddingLeft={1} flexShrink={0}>
                <text fg={themeColors.muted}>
                  Press Ctrl-C again to exit
                </text>
              </box>
            )}
          </scrollbox>
        </box>
      )}

    </box>
  );
}

export default ChatShell;
