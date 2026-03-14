import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { PasteEvent, TextareaRenderable } from "@opentui/core";
import type { ClipboardAdapter } from "@/lib/ui/clipboard.ts";
import type {
  ChatMessage,
  CommandExecutionTrigger,
  MessageSubmitTelemetry,
  StreamingMeta,
  TaskItem,
  WorkflowChatState,
} from "@/state/chat/shared/types/index.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { UseMessageQueueReturn } from "@/hooks/use-message-queue.ts";
import type { WorkflowInputResolver } from "@/services/workflows/helpers/workflow-input-resolver.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";

export type { ComposerAutocompleteSuggestion } from "@/state/chat/shared/types/composer.ts";

export interface InputScrollbarState {
  visible: boolean;
  viewportHeight: number;
  thumbTop: number;
  thumbSize: number;
}

export interface UseComposerControllerArgs {
  activeQuestion: unknown;
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  agentType?: string;
  clipboard: ClipboardAdapter;
  clearDeferredCompletion: () => void;
  commandStyleIdRef: MutableRefObject<number>;
  currentModelRef: MutableRefObject<string>;
  emitMessageSubmitTelemetry: (event: MessageSubmitTelemetry) => void;
  executeCommand: (commandName: string, args: string, trigger?: CommandExecutionTrigger) => Promise<boolean>;
  finalizeTaskItemsOnInterrupt: () => TaskItem[] | undefined;
  finalizeThinkingSourceTracking: () => void;
  getActiveStreamRunId: () => string | null;
  isStreamingRef: MutableRefObject<boolean>;
  lastStreamingContentRef: MutableRefObject<string>;
  messageQueue: UseMessageQueueReturn;
  onInterrupt?: () => void;
  parallelAgentsRef: MutableRefObject<ParallelAgent[]>;
  parallelInterruptHandlerRef: MutableRefObject<(() => void) | null>;
  resolveTrackedRun: (
    action: "complete" | "interrupt" | "fail",
    overrides?: { content?: string; wasInterrupted?: boolean; error?: unknown; wasCancelled?: boolean },
    options?: { runId?: string | null; clearActive?: boolean },
  ) => unknown;
  runningAskQuestionToolIdsRef: MutableRefObject<Set<string>>;
  sendMessage: (content: string, options?: { skipUserMessage?: boolean }) => void;
  separateAndInterruptAgents: (agents: ParallelAgent[]) => {
    interruptedAgents: ParallelAgent[];
    remainingLiveAgents: ParallelAgent[];
  };
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setTodoItems: Dispatch<SetStateAction<NormalizedTodoItem[]>>;
  setWorkflowSessionDir: Dispatch<SetStateAction<string | null>>;
  setWorkflowSessionId: Dispatch<SetStateAction<string | null>>;
  shouldHideActiveStreamContent: () => boolean;
  showModelSelector: boolean;
  stopSharedStreamState: () => void;
  streamingMessageIdRef: MutableRefObject<string | null>;
  streamingMetaRef: MutableRefObject<StreamingMeta | null>;
  streamingStartRef: MutableRefObject<number | null>;
  todoItemsRef: MutableRefObject<NormalizedTodoItem[]>;
  updateWorkflowState: (updates: Partial<WorkflowChatState>) => void;
  waitForUserInputResolverRef: MutableRefObject<WorkflowInputResolver | null>;
  workflowSessionDirRef: MutableRefObject<string | null>;
  workflowSessionIdRef: MutableRefObject<string | null>;
  workflowState: WorkflowChatState;
  workflowTaskIdsRef: MutableRefObject<Set<string>>;
}

export interface ComposerAutocompleteSelectionArgs {
  action: "complete" | "execute";
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  command: { name: string; category?: string; argumentHint?: string };
  executeCommand: (commandName: string, args: string, trigger?: CommandExecutionTrigger) => Promise<boolean>;
  textarea: TextareaRenderable;
  updateWorkflowState: (updates: Partial<WorkflowChatState>) => void;
  workflowState: WorkflowChatState;
}

export interface ComposerBracketedPasteArgs {
  clipboard: ClipboardAdapter;
  event: PasteEvent;
  handleTextareaContentChange: () => void;
  normalizePastedText: (text: string) => string;
  textarea: TextareaRenderable | null;
}
