import { darkTheme, lightTheme } from "@/theme/index.tsx";
import type { CommandResult } from "@/commands/tui/registry.ts";
import { createMessage } from "@/state/chat/shared/helpers/index.ts";
import { tryTrackLoadedSkill } from "@/state/chat/shared/helpers/skill-load-tracking.ts";
import type { MessageSkillLoad } from "@/state/chat/shared/types/index.ts";
import type { UseCommandExecutorArgs } from "@/state/chat/command/executor-types.ts";
import { createPartId } from "@/state/parts/id.ts";
import type { McpSnapshotPart, AgentListPart } from "@/state/parts/types.ts";
import { defaultWorkflowChatState } from "@/state/chat/shared/types/workflow.ts";

export async function applyCommandResult(
  args: UseCommandExecutorArgs,
  result: CommandResult,
): Promise<void> {
  if (result.destroySession && args.onResetSession) {
    void Promise.resolve(args.onResetSession());
    args.updateWorkflowState({
      workflowActive: false,
      workflowType: null,
      initialPrompt: null,
      ralphState: { ...defaultWorkflowChatState.ralphState },
      workflowConfig: undefined,
    });
    args.setCompactionSummary(null);
    args.setShowCompactionHistory(false);
    args.setIsAutoCompacting(false);
    args.autoCompactionIndicatorRef.current = { status: "idle" };
    args.setParallelAgents([]);
    args.backgroundProgressSnapshotRef.current.clear();
    args.setTranscriptMode(false);
    args.clearHistoryBufferAndSync();
    args.resetLoadedSkillTracking({ resetSessionBinding: true });
    if (args.agentType === "copilot") {
      args.setWorkflowSessionDir(null);
      args.setWorkflowSessionId(null);
      args.workflowSessionDirRef.current = null;
      args.workflowSessionIdRef.current = null;
      args.workflowTaskIdsRef.current = new Set();
      args.todoItemsRef.current = [];
      args.setTodoItems([]);
    }
  }

  if (result.clearMessages) {
    const shouldResetHistory = result.destroySession || Boolean(result.compactionSummary);
    if (shouldResetHistory) {
      args.resetLoadedSkillTracking();
      if (result.compactionSummary) {
        args.appendCompactionSummaryAndSync(result.compactionSummary);
      } else {
        args.clearHistoryBufferAndSync();
      }
    } else {
      args.appendHistoryBufferAndSync(args.messages);
    }
    args.setMessagesWindowed([]);
  }

  if (result.compactionSummary) {
    args.setCompactionSummary(result.compactionSummary);
    args.setShowCompactionHistory(false);
  }

  if (result.stateUpdate) {
    args.updateWorkflowState({
      workflowActive: result.stateUpdate.workflowActive !== undefined ? result.stateUpdate.workflowActive : args.workflowState.workflowActive,
      workflowType: result.stateUpdate.workflowType !== undefined ? result.stateUpdate.workflowType : args.workflowState.workflowType,
      initialPrompt: result.stateUpdate.initialPrompt !== undefined ? result.stateUpdate.initialPrompt : args.workflowState.initialPrompt,
      workflowConfig: result.stateUpdate.workflowConfig !== undefined ? result.stateUpdate.workflowConfig : args.workflowState.workflowConfig,
    });

    if (result.stateUpdate.isStreaming !== undefined) {
      args.setIsStreaming(result.stateUpdate.isStreaming);
    }

    const modelUpdate = (result.stateUpdate as Record<string, unknown>).model;
    if (typeof modelUpdate === "string") {
      args.setCurrentModelId(modelUpdate);
      args.setCurrentModelDisplayName(modelUpdate);
      args.setCurrentReasoningEffort(undefined);
      args.onModelChange?.(modelUpdate);
    }
  }

  if (result.message) {
    args.addMessage("assistant", result.message);
  }

  if (result.mcpSnapshot) {
    const mcpSnapshot = result.mcpSnapshot;
    args.setMessagesWindowed((previousMessages) => {
      const lastMessage = previousMessages[previousMessages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        const nextParts = upsertMcpSnapshotPart(lastMessage.parts ?? [], mcpSnapshot, lastMessage.id);
        return [
          ...previousMessages.slice(0, -1),
          { ...lastMessage, mcpSnapshot, parts: nextParts },
        ];
      }
      const message = createMessage("assistant", "");
      message.mcpSnapshot = mcpSnapshot;
      message.parts = upsertMcpSnapshotPart(message.parts ?? [], mcpSnapshot, message.id);
      return [...previousMessages, message];
    });
  }

  if (result.agentListView) {
    const agentListView = result.agentListView;
    args.setMessagesWindowed((previousMessages) => {
      const lastMessage = previousMessages[previousMessages.length - 1];
      if (lastMessage && lastMessage.role === "assistant") {
        const nextParts = upsertAgentListPart(lastMessage.parts ?? [], agentListView);
        return [
          ...previousMessages.slice(0, -1),
          { ...lastMessage, agentListView, parts: nextParts },
        ];
      }
      const message = createMessage("assistant", "");
      message.agentListView = agentListView;
      message.parts = upsertAgentListPart(message.parts ?? [], agentListView);
      return [...previousMessages, message];
    });
  }

  if (result.skillLoaded && tryTrackLoadedSkill(args.loadedSkillsRef.current, result.skillLoaded)) {
    const skillLoad: MessageSkillLoad = {
      skillName: result.skillLoaded,
      status: result.skillLoadError ? "error" : "loaded",
      errorMessage: result.skillLoadError,
    };
    args.appendSkillLoadIndicator(skillLoad);
  }

  if (result.shouldExit) {
    setTimeout(() => {
      void args.onExit?.();
    }, 100);
  }

  if (result.showModelSelector) {
    args.modelOps?.invalidateModelCache?.();
    const models = await args.modelOps?.listAvailableModels() ?? [];
    const currentModel = await args.modelOps?.getCurrentModel();
    args.setAvailableModels(models);
    args.setCurrentModelId(currentModel);
    args.setShowModelSelector(true);
  }

  if (result.themeChange) {
    if (result.themeChange === "toggle") {
      args.toggleTheme();
    } else {
      args.setTheme(result.themeChange === "light" ? lightTheme : darkTheme);
    }
  }
}

function upsertMcpSnapshotPart(
  parts: import("@/state/parts/types.ts").Part[],
  snapshot: import("@/lib/ui/mcp-output.ts").McpSnapshotView,
  messageId: string,
): import("@/state/parts/types.ts").Part[] {
  const nextParts = [...parts];
  const existingIdx = nextParts.findIndex((part) => part.type === "mcp-snapshot");
  const mcpPart: McpSnapshotPart = {
    id: existingIdx >= 0 ? nextParts[existingIdx]!.id : createPartId(),
    type: "mcp-snapshot",
    snapshot,
    createdAt: existingIdx >= 0
      ? nextParts[existingIdx]!.createdAt
      : new Date().toISOString(),
  };
  if (existingIdx >= 0) {
    nextParts[existingIdx] = mcpPart;
  } else {
    nextParts.push(mcpPart);
  }
  return nextParts;
}

function upsertAgentListPart(
  parts: import("@/state/parts/types.ts").Part[],
  view: import("@/lib/ui/agent-list-output.ts").AgentListView,
): import("@/state/parts/types.ts").Part[] {
  const nextParts = [...parts];
  const existingIdx = nextParts.findIndex((part) => part.type === "agent-list");
  const agentPart: AgentListPart = {
    id: existingIdx >= 0 ? nextParts[existingIdx]!.id : createPartId(),
    type: "agent-list",
    view,
    createdAt: existingIdx >= 0
      ? nextParts[existingIdx]!.createdAt
      : new Date().toISOString(),
  };
  if (existingIdx >= 0) {
    nextParts[existingIdx] = agentPart;
  } else {
    nextParts.push(agentPart);
  }
  return nextParts;
}
