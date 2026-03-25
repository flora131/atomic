import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Theme } from "@/theme/index.tsx";
import type {
  ChatMessage,
  MessageSkillLoad,
  StreamingMeta,
} from "@/state/chat/shared/types/message.ts";
import type { CommandExecutionTelemetry } from "@/state/chat/shared/types/app.ts";
import type { WorkflowChatState } from "@/state/chat/shared/types/workflow.ts";
import type { ParallelAgent } from "@/types/parallel-agents.ts";
import type { NormalizedTodoItem } from "@/state/parts/helpers/task-status.ts";
import type { McpServerToggleMap } from "@/lib/ui/mcp-output.ts";
import type { WorkflowInputResolver } from "@/services/workflows/helpers/workflow-input-resolver.ts";
import type { Model } from "@/services/models/model-transform.ts";
import type { AgentType, ModelOperations } from "@/services/models/index.ts";
import type { CreateSessionFn } from "@/services/workflows/graph/types.ts";
import type { OwnershipTracker } from "@/services/events/consumers/wire-consumers.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type { StreamRunHandle } from "@/state/runtime/stream-run-runtime.ts";
import type {
  McpServerConfig,
  ModelDisplayInfo,
  Session,
} from "@/services/agents/types.ts";
import type { StreamMessageOptions } from "@/commands/tui/registry.ts";

export interface DeferredCommandMessage {
  content: string;
  skipUserMessage?: boolean;
}

export interface UseCommandExecutorArgs {
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  agentType?: AgentType;
  appendCompactionSummaryAndSync: (summary: string) => void;
  appendHistoryBufferAndSync: (messages: ChatMessage[]) => void;
  appendSkillLoadIndicator: (skillLoad: MessageSkillLoad) => void;
  autoCompactionIndicatorRef: RefObject<{ status: "idle" | "running" | "completed" | "error"; errorMessage?: string }>;
  backgroundProgressSnapshotRef: RefObject<Map<string, { toolUses: number; currentTool?: string }>>;
  clearHistoryBufferAndSync: () => void;
  /** Set by the conductor executor to expose conductor.interrupt() to the UI. */
  conductorInterruptRef: RefObject<(() => void) | null>;
  /** Set by the conductor executor to expose conductor.resume() to the UI. */
  conductorResumeRef: RefObject<((message: string | null) => void) | null>;
  createSubagentSession?: CreateSessionFn;
  /** Dequeue the next message from the message queue for conductor workflow stages. */
  dequeueMessage?: () => string | null;
  /**
   * Stream through a specific session using the real SDK adapter pipeline,
   * returning captured response text. Provided by chat-ui-controller.
   */
  streamWithSession?: (
    session: Session,
    prompt: string,
    options?: { abortSignal?: AbortSignal },
  ) => Promise<string>;
  currentModelRef: RefObject<string | undefined>;
  deferredCommandQueueRef: RefObject<DeferredCommandMessage[]>;
  ensureSession?: () => Promise<void>;
  eventBus: EventBus;
  getOwnershipTracker: () => OwnershipTracker | null;
  getModelDisplayInfo?: (modelHint?: string) => Promise<ModelDisplayInfo>;
  getSession?: () => Session | null;
  hasRunningToolRef: RefObject<boolean>;
  isAgentOnlyStreamRef: RefObject<boolean>;
  isStreaming: boolean;
  isStreamingRef: RefObject<boolean>;
  loadedSkillsRef: RefObject<Set<string>>;
  mcpServerToggles: McpServerToggleMap;
  messages: ChatMessage[];
  modelOps?: ModelOperations;
  onCommandExecutionTelemetry?: (event: CommandExecutionTelemetry) => void;
  onExit?: () => void | Promise<void>;
  onModelChange?: (model: string) => void;
  onResetSession?: () => void | Promise<void>;
  onSendMessage?: (content: string) => void | Promise<void>;
  onSessionMcpServersChange?: (servers: McpServerConfig[]) => void;
  pendingCompleteRef: RefObject<(() => void) | null>;
  parallelInterruptHandlerRef: RefObject<(() => void) | null>;
  resetLoadedSkillTracking: (options?: { resetSessionBinding?: boolean }) => void;
  runningAskQuestionToolIdsRef: RefObject<Set<string>>;
  sendMessageRef: RefObject<((content: string, options?: { skipUserMessage?: boolean }) => void) | null>;
  setAvailableModels: Dispatch<SetStateAction<Model[]>>;
  setCompactionSummary: Dispatch<SetStateAction<string | null>>;
  setCurrentModelDisplayName: Dispatch<SetStateAction<string | undefined>>;
  setCurrentModelId: Dispatch<SetStateAction<string | undefined>>;
  setCurrentReasoningEffort: Dispatch<SetStateAction<string | undefined>>;
  setIsAutoCompacting: Dispatch<SetStateAction<boolean>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setMcpServerToggles: Dispatch<SetStateAction<McpServerToggleMap>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setParallelAgents: Dispatch<SetStateAction<ParallelAgent[]>>;
  setShowCompactionHistory: Dispatch<SetStateAction<boolean>>;
  setShowModelSelector: Dispatch<SetStateAction<boolean>>;
  setStreamingMessageId: (messageId: string | null) => void;
  setStreamingMeta: Dispatch<SetStateAction<StreamingMeta | null>>;
  setStreamingState?: (isStreaming: boolean) => void;
  setTheme: (theme: Theme) => void;
  setTodoItems: Dispatch<SetStateAction<NormalizedTodoItem[]>>;
  setTranscriptMode: Dispatch<SetStateAction<boolean>>;
  setWorkflowSessionDir: Dispatch<SetStateAction<string | null>>;
  setWorkflowSessionId: Dispatch<SetStateAction<string | null>>;
  setStreamingWithFinalize: (streaming: boolean) => void;
  startAssistantStream: (
    content: string,
    options?: StreamMessageOptions,
  ) => StreamRunHandle | null;
  stopSharedStreamState: () => void;
  streamingMessageIdRef: RefObject<string | null>;
  streamingMetaRef: RefObject<StreamingMeta | null>;
  streamingStartRef: RefObject<number | null>;
  todoItemsRef: RefObject<NormalizedTodoItem[]>;
  toggleTheme: () => void;
  trackAwaitedRun: (handle: StreamRunHandle | null) => StreamRunHandle | null;
  updateWorkflowState: (updates: Partial<WorkflowChatState>) => void;
  waitForUserInputResolverRef: RefObject<WorkflowInputResolver | null>;
  workflowActiveRef: RefObject<boolean>;
  workflowSessionDirRef: RefObject<string | null>;
  workflowSessionIdRef: RefObject<string | null>;
  workflowState: WorkflowChatState;
  workflowTaskIdsRef: RefObject<Set<string>>;
}
