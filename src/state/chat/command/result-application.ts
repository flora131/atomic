import { darkTheme, lightTheme } from "@/theme/index.tsx";
import type { CommandResult } from "@/commands/tui/registry.ts";
import { createMessage } from "@/state/chat/helpers.ts";
import { tryTrackLoadedSkill } from "@/lib/ui/skill-load-tracking.ts";
import type { MessageSkillLoad } from "@/state/chat/types.ts";
import type { UseCommandExecutorArgs } from "@/state/chat/command/executor-types.ts";

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
      currentNode: null,
      iteration: 0,
      maxIterations: undefined,
      featureProgress: null,
      pendingApproval: false,
      specApproved: false,
      feedback: null,
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
      currentNode: result.stateUpdate.currentNode !== undefined ? result.stateUpdate.currentNode : args.workflowState.currentNode,
      iteration: result.stateUpdate.iteration !== undefined ? result.stateUpdate.iteration : args.workflowState.iteration,
      maxIterations: result.stateUpdate.maxIterations !== undefined ? result.stateUpdate.maxIterations : args.workflowState.maxIterations,
      featureProgress: result.stateUpdate.featureProgress !== undefined ? result.stateUpdate.featureProgress : args.workflowState.featureProgress,
      pendingApproval: result.stateUpdate.pendingApproval !== undefined ? result.stateUpdate.pendingApproval : args.workflowState.pendingApproval,
      specApproved: result.stateUpdate.specApproved !== undefined ? result.stateUpdate.specApproved : args.workflowState.specApproved,
      feedback: result.stateUpdate.feedback !== undefined ? result.stateUpdate.feedback : args.workflowState.feedback,
      workflowConfig: result.stateUpdate.workflowConfig !== undefined ? result.stateUpdate.workflowConfig : args.workflowState.workflowConfig,
    });

    if (result.stateUpdate.isStreaming !== undefined) {
      args.setIsStreaming(result.stateUpdate.isStreaming);
    }

    const modelUpdate = (result.stateUpdate as Record<string, unknown>).model;
    if (typeof modelUpdate === "string") {
      args.setCurrentModelId(modelUpdate);
      args.setCurrentModelDisplayName(modelUpdate);
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
        return [
          ...previousMessages.slice(0, -1),
          { ...lastMessage, mcpSnapshot },
        ];
      }
      const message = createMessage("assistant", "");
      message.mcpSnapshot = mcpSnapshot;
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
