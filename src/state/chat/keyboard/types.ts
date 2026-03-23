import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { UseMessageQueueReturn } from "@/hooks/use-message-queue.ts";
import type { ClipboardAdapter } from "@/lib/ui/clipboard.ts";
import type {
  ChatMessage,
  CommandExecutionTrigger,
  StreamingMeta,
  TaskItem,
  UserQuestion,
  WorkflowChatState,
} from "@/state/chat/shared/types/index.ts";

export interface ChatAutocompleteSuggestion {
  name: string;
  category?: string;
  argumentHint?: string;
}

export interface UseChatKeyboardArgs {
  activeBackgroundAgentCountRef: RefObject<number>;
  activeQuestion: UserQuestion | null;
  activeHitlToolCallIdRef: RefObject<string | null>;
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  autocompleteSuggestions: ChatAutocompleteSuggestion[];
  awaitedStreamRunIdsRef: RefObject<Set<string>>;
  clipboard: ClipboardAdapter;
  clearDeferredCompletion: () => void;
  /** Set by the conductor executor. Called on single Ctrl+C/ESC during workflow streaming to abort the current stage. */
  conductorInterruptRef: RefObject<(() => void) | null>;
  continueQueuedConversation: () => void;
  emitMessageSubmitTelemetry: (event: {
    messageLength: number;
    queued: boolean;
    fromInitialPrompt: boolean;
    hasFileMentions: boolean;
    hasAgentMentions: boolean;
  }) => void;
  executeCommand: (commandName: string, args: string, trigger?: CommandExecutionTrigger) => Promise<boolean>;
  finalizeTaskItemsOnInterrupt: () => TaskItem[] | undefined;
  finalizeThinkingSourceTracking: () => void;
  getActiveStreamRunId: () => string | null;
  handleCopy: () => void | Promise<void>;
  handleInputChange: (rawValue: string, cursorOffset: number) => void;
  handleTextareaContentChange: () => void;
  hasRendererSelection: () => boolean;
  historyIndexRef: RefObject<number>;
  historyNavigatingRef: RefObject<boolean>;
  isEditingQueue: boolean;
  isStreaming: boolean;
  isStreamingRef: RefObject<boolean>;
  kittyKeyboardDetectedRef: RefObject<boolean>;
  lastStreamingContentRef: RefObject<string>;
  messageQueue: UseMessageQueueReturn;
  normalizePastedText: (text: string) => string;
  onExit?: () => void;
  onInterrupt?: () => void;
  onTerminateBackgroundAgents?: (agentIds?: string[]) => void | Promise<void>;
  parallelAgentsRef: RefObject<ParallelAgent[]>;
  parallelInterruptHandlerRef: RefObject<(() => void) | null>;
  promptHistoryRef: RefObject<string[]>;
  resetHitlState: () => void;
  resolveTrackedRun: (
    action: "complete" | "interrupt" | "fail",
    overrides?: { content?: string; wasInterrupted?: boolean; error?: unknown; wasCancelled?: boolean },
    options?: { runId?: string | null; clearActive?: boolean },
  ) => unknown;
  savedInputRef: RefObject<string>;
  scrollboxRef: RefObject<ScrollBoxRenderable | null>;
  separateAndInterruptAgents: (agents: ParallelAgent[]) => {
    interruptedAgents: ParallelAgent[];
    remainingLiveAgents: ParallelAgent[];
  };
  setActiveBackgroundAgentCount: Dispatch<SetStateAction<number>>;
  setIsEditingQueue: Dispatch<SetStateAction<boolean>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setShowTodoPanel: Dispatch<SetStateAction<boolean>>;
  setTranscriptMode: Dispatch<SetStateAction<boolean>>;
  shouldHideActiveStreamContent: () => boolean;
  showModelSelector: boolean;
  stopSharedStreamState: () => void;
  streamingMessageIdRef: RefObject<string | null>;
  streamingMetaRef: RefObject<StreamingMeta | null>;
  streamingStartRef: RefObject<number | null>;
  syncInputScrollbar: () => void;
  textareaRef: RefObject<TextareaRenderable | null>;
  toggleVerbose: () => void;
  updateWorkflowState: (updates: Partial<WorkflowChatState>) => void;
  wasInterruptedRef: RefObject<boolean>;
  waitForUserInputResolverRef: RefObject<{ reject: (error: Error) => void } | null>;
  workflowState: WorkflowChatState;
}
