import type { CliRenderer } from "@opentui/core";
import type { Root } from "@opentui/react";
import type { AgentType } from "@/services/models/index.ts";
import type { UnifiedModelOperations } from "@/services/models/model-operations.ts";
import type {
  CodingAgentClient,
  Session,
  SessionConfig,
} from "@/services/agents/types.ts";
import type { TuiTelemetrySessionTracker } from "@/services/telemetry/index.ts";
import type { EventBus } from "@/services/events/event-bus.ts";
import type { BatchDispatcher } from "@/services/events/batch-dispatcher.ts";
import type { attachDebugSubscriber } from "@/services/events/debug-subscriber.ts";

export interface ChatUIState {
  renderer: CliRenderer | null;
  root: Root | null;
  session: Session | null;
  startTime: number;
  messageCount: number;
  cleanupHandlers: Array<() => void>;
  interruptCount: number;
  interruptTimeout: ReturnType<typeof setTimeout> | null;
  streamAbortController: AbortController | null;
  pendingAbortPromise: Promise<void> | null;
  isStreaming: boolean;
  ownedSessionIds: Set<string>;
  sessionCreationPromise: Promise<void> | null;
  runCounter: number;
  currentRunId: number | null;
  telemetryTracker: TuiTelemetrySessionTracker | null;
  bus: EventBus;
  dispatcher: BatchDispatcher;
  backgroundAgentsTerminated: boolean;
}

export type ChatUIDebugSubscription = Awaited<
  ReturnType<typeof attachDebugSubscriber>
>;

export interface CreateChatUIRuntimeStateArgs {
  resolvedAgentType?: AgentType;
  workflowEnabled: boolean;
  initialPrompt?: string;
}

export interface CreateChatUIControllerArgs {
  client: CodingAgentClient;
  resolvedAgentType?: AgentType;
  sessionConfig?: SessionConfig;
  clientStartPromise?: Promise<void>;
  modelOps?: UnifiedModelOperations;
  state: ChatUIState;
  debugSub: ChatUIDebugSubscription;
  onExitResolved: (result: { messageCount: number; duration: number }) => void;
}
