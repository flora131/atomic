/**
 * Public API barrel for state/chat/.
 * All imports are at max depth 1 from this file.
 */

// ── Shared types & helpers (depth 0) ──────────────────────────────────
export * from "@/state/chat/shared/types/index.ts";
export * from "@/state/chat/shared/helpers/index.ts";

// ── Agent sub-module (depth 1) ────────────────────────────────────────
export type {
  UseChatAgentProjectionArgs,
  SetMessagesWindowed,
  TaskItemsSnapshot,
} from "@/state/chat/agent/types.ts";
export { useChatAgentMessageProjection } from "@/state/chat/agent/use-message-projection.ts";
export { useChatAgentOrderingMaintenance } from "@/state/chat/agent/use-ordering-maintenance.ts";
export { useChatAgentProjection } from "@/state/chat/agent/use-projection.ts";
export { useChatAgentStreamFinalization } from "@/state/chat/agent/use-stream-finalization.ts";

// ── Command sub-module (depth 1) ──────────────────────────────────────
export { createCommandContextState, createCommandContext, startCommandSpinner } from "@/state/chat/command/context-factory.ts";
export { applyCommandResult } from "@/state/chat/command/result-application.ts";
export { useCommandExecutor } from "@/state/chat/command/use-executor.ts";

// ── Composer sub-module (depth 1) ─────────────────────────────────────
export type {
  InputScrollbarState,
  UseComposerControllerArgs,
  ComposerAutocompleteSelectionArgs,
  ComposerBracketedPasteArgs,
} from "@/state/chat/composer/types.ts";
export {
  HLREF_COMMAND,
  HLREF_MENTION,
  isAtMentionBoundary,
  getComposerAutocompleteSuggestions,
  deriveComposerAutocompleteState,
} from "@/state/chat/composer/autocomplete.ts";
export {
  getCommandHistoryPath,
  loadCommandHistory,
  appendCommandHistory,
  clearCommandHistory,
} from "@/state/chat/composer/command-history.ts";
export { handleComposerSubmit } from "@/state/chat/composer/submit.ts";
export { useComposerController } from "@/state/chat/composer/use-controller.ts";
export { type UseComposerInputStateResult, useComposerInputState } from "@/state/chat/composer/use-input-state.ts";

// ── Controller sub-module (depth 1) ───────────────────────────────────
export type {
  UseChatShellStateArgs,
  UseChatShellStateResult,
  UseChatUiControllerStackArgs,
} from "@/state/chat/controller/types.ts";
export { useChatAppOrchestration } from "@/state/chat/controller/use-app-orchestration.ts";
export { useChatDispatchController } from "@/state/chat/controller/use-dispatch-controller.ts";
export { useChatRuntimeStack } from "@/state/chat/controller/use-runtime-stack.ts";
export { useChatShellState } from "@/state/chat/controller/use-shell-state.ts";
export { useChatUiControllerStack } from "@/state/chat/controller/use-ui-controller-stack.ts";
export { useWorkflowHitl } from "@/state/chat/controller/use-workflow-hitl.ts";

// ── Keyboard sub-module (depth 1) ─────────────────────────────────────
export * from "@/state/chat/keyboard/index.ts";

// ── Session sub-module (depth 1) ──────────────────────────────────────
export type { Session, SessionConfig, CreateSessionFn } from "@/state/chat/session/types.ts";

// ── Shell sub-module (depth 1) ────────────────────────────────────────
export type { ChatShellProps, ShellLayoutProps, ShellInputProps, ShellDialogProps, ShellScrollProps } from "@/state/chat/shell/types.ts";
export { ChatShell } from "@/state/chat/shell/ChatShell.tsx";
export { buildChatShellProps } from "@/state/chat/shell/props.ts";
export { useChatRenderModel, reorderStreamingMessageToEnd } from "@/state/chat/shell/use-render-model.tsx";

// ── Stream sub-module (depth 1) ───────────────────────────────────────
export type {
  UseChatStreamCompletionArgs,
  StreamCompletionContext,
  DeferredStreamCompletionContext,
  FinalizedStreamCompletionContext,
} from "@/state/chat/stream/completion-types.ts";
export type {
  UseChatStreamLifecycleArgs,
  UseChatStreamLifecycleResult,
} from "@/state/chat/stream/lifecycle-types.ts";
export type { UseStreamSubscriptionsArgs } from "@/state/chat/stream/subscription-types.ts";
export type { StreamPartBatch } from "@/state/chat/stream/part-batch.ts";
export { createStreamPartBatch, applyStreamPartBatchToMessages, applyWorkflowStepCompleteByNodeScan } from "@/state/chat/stream/part-batch.ts";
export { useChatStreamAgentOrdering } from "@/state/chat/stream/use-agent-ordering.ts";
export { useStreamAgentSubscriptions } from "@/state/chat/stream/use-agent-subscriptions.ts";
export { useChatBackgroundDispatch } from "@/state/chat/stream/use-background-dispatch.ts";
export { useChatStreamCompletion } from "@/state/chat/stream/use-completion.ts";
export { type UseChatStreamConsumerArgs, useChatStreamConsumer } from "@/state/chat/stream/use-consumer.ts";
export { useChatStreamDeferredCompletion } from "@/state/chat/stream/use-deferred-completion.ts";
export { useChatStreamErrors } from "@/state/chat/stream/use-errors.ts";
export { useChatStreamFinalizedCompletion } from "@/state/chat/stream/use-finalized-completion.ts";
export { useChatStreamInterruptedCompletion } from "@/state/chat/stream/use-interrupted-completion.ts";
export { useChatStreamLifecycle } from "@/state/chat/stream/use-lifecycle.ts";
export { useChatStreamRuntime } from "@/state/chat/stream/use-runtime.ts";
export { useChatRuntimeControls } from "@/state/chat/stream/use-runtime-controls.ts";
export { useChatRuntimeEffects } from "@/state/chat/stream/use-runtime-effects.ts";
export { useChatRunTracking } from "@/state/chat/stream/use-run-tracking.ts";
export { useStreamSessionSubscriptions } from "@/state/chat/stream/use-session-subscriptions.ts";
export { useChatStreamStartup } from "@/state/chat/stream/use-startup.ts";
export { useStreamSubscriptions } from "@/state/chat/stream/use-subscriptions.ts";
export { useChatStreamToolEvents } from "@/state/chat/stream/use-tool-events.ts";

// ── UI Components ─────────────────────────────────────────────────────
export { AtomicHeader } from "@/components/chat-header.tsx";
export {
  CompletionSummary,
  LoadingIndicator,
  StreamingBullet,
} from "@/components/chat-loading-indicator.tsx";
export { MessageBubble } from "@/components/chat-message-bubble.tsx";
