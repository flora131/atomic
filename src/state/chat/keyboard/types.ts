import type { Dispatch, MutableRefObject, SetStateAction } from "react";
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
  activeBackgroundAgentCountRef: MutableRefObject<number>;
  activeQuestion: UserQuestion | null;
  activeHitlToolCallIdRef: MutableRefObject<string | null>;
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  autocompleteSuggestions: ChatAutocompleteSuggestion[];
  awaitedStreamRunIdsRef: MutableRefObject<Set<string>>;
  backgroundAgentMessageIdRef: MutableRefObject<string | null>;
  clipboard: ClipboardAdapter;
  clearDeferredCompletion: () => void;
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
  historyIndexRef: MutableRefObject<number>;
  historyNavigatingRef: MutableRefObject<boolean>;
  isEditingQueue: boolean;
  isStreaming: boolean;
  isStreamingRef: MutableRefObject<boolean>;
  kittyKeyboardDetectedRef: MutableRefObject<boolean>;
  lastStreamedMessageIdRef: MutableRefObject<string | null>;
  lastStreamingContentRef: MutableRefObject<string>;
  messageQueue: UseMessageQueueReturn;
  normalizePastedText: (text: string) => string;
  onExit?: () => void;
  onInterrupt?: () => void;
  onTerminateBackgroundAgents?: (agentIds?: string[]) => void | Promise<void>;
  parallelAgents: ParallelAgent[];
  parallelAgentsRef: MutableRefObject<ParallelAgent[]>;
  parallelInterruptHandlerRef: MutableRefObject<(() => void) | null>;
  promptHistoryRef: MutableRefObject<string[]>;
  resetHitlState: () => void;
  resolveTrackedRun: (
    action: "complete" | "interrupt" | "fail",
    overrides?: { content?: string; wasInterrupted?: boolean; error?: unknown; wasCancelled?: boolean },
    options?: { runId?: string | null; clearActive?: boolean },
  ) => unknown;
  savedInputRef: MutableRefObject<string>;
  scrollboxRef: MutableRefObject<ScrollBoxRenderable | null>;
  separateAndInterruptAgents: (agents: ParallelAgent[]) => {
    interruptedAgents: ParallelAgent[];
    remainingLiveAgents: ParallelAgent[];
  };
  setActiveBackgroundAgentCount: Dispatch<SetStateAction<number>>;
  setBackgroundAgentMessageId: (messageId: string | null) => void;
  setIsEditingQueue: Dispatch<SetStateAction<boolean>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setShowTodoPanel: Dispatch<SetStateAction<boolean>>;
  setTranscriptMode: Dispatch<SetStateAction<boolean>>;
  shouldHideActiveStreamContent: () => boolean;
  showModelSelector: boolean;
  stopSharedStreamState: () => void;
  streamingMessageIdRef: MutableRefObject<string | null>;
  streamingMetaRef: MutableRefObject<StreamingMeta | null>;
  streamingStartRef: MutableRefObject<number | null>;
  syncInputScrollbar: () => void;
  textareaRef: MutableRefObject<TextareaRenderable | null>;
  toggleVerbose: () => void;
  updateWorkflowState: (updates: Partial<WorkflowChatState>) => void;
  wasInterruptedRef: MutableRefObject<boolean>;
  waitForUserInputResolverRef: MutableRefObject<{ reject: (error: Error) => void } | null>;
  workflowActiveRef: MutableRefObject<boolean>;
  workflowState: WorkflowChatState;
}
