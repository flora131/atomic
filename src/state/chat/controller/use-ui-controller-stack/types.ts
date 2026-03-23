import type { Dispatch, SetStateAction } from "react";
import type { UseMessageQueueReturn } from "@/hooks/use-message-queue.ts";
import type { ChatAppProps, ChatMessage, StreamingMeta, WorkflowChatState } from "@/state/chat/shared/types/index.ts";
import type { UseChatStreamRuntimeResult } from "@/state/chat/shared/types/stream-runtime.ts";
import { useChatDispatchController } from "@/state/chat/controller/use-dispatch-controller.ts";
import type { UseChatShellStateResult } from "@/state/chat/controller/use-shell-state.ts";
import { useChatAppOrchestration } from "@/state/chat/controller/use-app-orchestration.ts";
import { useChatRuntimeStack } from "@/state/chat/controller/use-runtime-stack.ts";

type DispatchControllerArgs = Parameters<typeof useChatDispatchController>[0];
type OrchestrationResult = ReturnType<typeof useChatAppOrchestration>;
type RuntimeStackResult = ReturnType<typeof useChatRuntimeStack>;

export interface UseChatUiControllerStackArgs {
  agentType?: ChatAppProps["agentType"];
  app: Omit<Pick<
    ChatAppProps,
    | "createSubagentSession"
    | "streamWithSession"
    | "ensureSession"
    | "getModelDisplayInfo"
    | "getSession"
    | "initialModelId"
    | "initialPrompt"
    | "model"
    | "modelOps"
    | "onCommandExecutionTelemetry"
    | "onExit"
    | "onInterrupt"
    | "onModelChange"
    | "onResetSession"
    | "onSendMessage"
    | "onSessionMcpServersChange"
    | "onTerminateBackgroundAgents"
    | "setStreamingState"
  >, "model"> & {
    model: string;
    tier: string;
    version: string;
    workingDir: string;
  };
  hitl: RuntimeStackResult;
  isStreaming: boolean;
  messageQueue: UseMessageQueueReturn;
  messages: ChatMessage[];
  orchestration: OrchestrationResult;
  runtime: UseChatStreamRuntimeResult;
  deferredCommandQueueRef: DispatchControllerArgs["deferredCommandQueueRef"];
  eventBus: DispatchControllerArgs["eventBus"];
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setMessagesWindowed: (next: SetStateAction<ChatMessage[]>) => void;
  setStreamingMeta: Dispatch<SetStateAction<StreamingMeta | null>>;
  shellState: UseChatShellStateResult;
  streamingMeta: StreamingMeta | null;
  workflowState: WorkflowChatState;
}
