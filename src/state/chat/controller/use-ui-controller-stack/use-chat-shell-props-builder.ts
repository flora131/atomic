import type { ReactNode } from "react";
import { buildUiControllerChatShellProps } from "./chat-shell-props.ts";
import type { OrchestrationState } from "./use-orchestration-state.ts";
import type { useChatDispatchController } from "@/state/chat/controller/use-dispatch-controller.ts";
import type { useComposerController } from "@/state/chat/composer/index.ts";

/**
 * Assembles the final chatShellProps object from orchestrated state
 * and the results of all sub-hooks (dispatch, composer, keyboard, render).
 */
export function useChatShellPropsBuilder({
  o,
  dispatch,
  composer,
  ctrlCPressed,
  messageContent,
}: {
  o: OrchestrationState;
  dispatch: ReturnType<typeof useChatDispatchController>;
  composer: ReturnType<typeof useComposerController>;
  ctrlCPressed: boolean;
  messageContent: ReactNode;
}) {
  const chatShellProps = buildUiControllerChatShellProps({
    activeQuestion: o.activeQuestion,
    availableModels: o.availableModels,
    autocompleteInput: o.workflowState.autocompleteInput,
    autocompleteMode: o.workflowState.autocompleteMode,
    autocompleteSelectedIndex: o.workflowState.selectedSuggestionIndex,
    autocompleteSuggestions: composer.autocompleteSuggestions,
    argumentHint: o.workflowState.argumentHint,
    compactionSummary: o.compactionSummary,
    ctrlCPressed,
    currentModelId: o.currentModelId,
    currentReasoningEffort: o.currentReasoningEffort,
    displayModel: o.displayModel,
    dynamicPlaceholder: o.dynamicPlaceholder,
    handleAutocompleteIndexChange: composer.handleAutocompleteIndexChange,
    handleAutocompleteSelect: composer.handleAutocompleteSelect,
    handleBracketedPaste: composer.handleBracketedPaste,
    handleModelSelect: dispatch.handleModelSelect,
    handleModelSelectorCancel: dispatch.handleModelSelectorCancel,
    handleMouseUp: o.handleMouseUp,
    handleQuestionAnswer: o.handleQuestionAnswer,
    handleSubmit: composer.handleSubmit,
    handleTextareaContentChange: composer.handleTextareaContentChange,
    handleTextareaCursorChange: composer.handleTextareaCursorChange,
    historyBufferMessages: o.historyBufferMessages,
    initialModelId: o.initialModelId,
    inputSyntaxStyle: o.inputSyntaxStyle,
    inputFocused: o.inputFocused,
    inputScrollbar: composer.inputScrollbar,
    isEditingQueue: composer.isEditingQueue,
    isStreaming: o.isStreaming,
    messageContent,
    messageCount: o.messages.length,
    messageQueue: o.messageQueue,
    messages: o.messages,
    model: o.model,
    parallelAgents: o.parallelAgents,
    scrollAcceleration: o.scrollAcceleration,
    scrollboxRef: o.scrollboxRef,
    setIsEditingQueue: composer.setIsEditingQueue,
    showAutocomplete: o.workflowState.showAutocomplete,
    showCompactionHistory: o.showCompactionHistory,
    showModelSelector: o.showModelSelector,
    streamingMeta: o.streamingMeta,
    textareaKeyBindings: composer.textareaKeyBindings,
    textareaRef: composer.textareaRef,
    themeColors: o.themeColors,
    tier: o.tier,
    transcriptMode: o.transcriptMode,
    version: o.version,
    workingDir: o.workingDir,
    workflowState: o.workflowState,
  });

  return { chatShellProps };
}
