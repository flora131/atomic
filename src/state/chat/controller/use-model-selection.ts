import { useCallback, type Dispatch, type SetStateAction } from "react";
import { saveModelPreference, saveReasoningEffortPreference, clearReasoningEffortPreference } from "@/services/config/settings.ts";
import type { Model } from "@/services/models/model-transform.ts";
import type { AgentType, ModelOperations } from "@/services/models/index.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface UseModelSelectionArgs {
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  agentType?: AgentType;
  modelOps?: ModelOperations;
  onModelChange?: (model: string) => void;
  setCurrentModelDisplayName: Dispatch<SetStateAction<string | undefined>>;
  setCurrentModelId: Dispatch<SetStateAction<string | undefined>>;
  setCurrentReasoningEffort: Dispatch<SetStateAction<string | undefined>>;
  setShowModelSelector: Dispatch<SetStateAction<boolean>>;
}

export interface UseModelSelectionResult {
  handleModelSelect: (selectedModel: Model, reasoningEffort?: string) => Promise<void>;
  handleModelSelectorCancel: () => void;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Sub-hook encapsulating model selection and persistence logic.
 *
 * Handles model switching (via `modelOps`), user feedback messages,
 * display name updates, and reasoning-effort preference persistence.
 */
export function useModelSelection({
  addMessage,
  agentType,
  modelOps,
  onModelChange,
  setCurrentModelDisplayName,
  setCurrentModelId,
  setCurrentReasoningEffort,
  setShowModelSelector,
}: UseModelSelectionArgs): UseModelSelectionResult {
  const handleModelSelect = useCallback(async (selectedModel: Model, reasoningEffort?: string) => {
    setShowModelSelector(false);

    try {
      if (modelOps && "setPendingReasoningEffort" in modelOps) {
        (modelOps as { setPendingReasoningEffort: (effort: string | undefined) => void })
          .setPendingReasoningEffort(reasoningEffort);
      }

      const result = await modelOps?.setModel(selectedModel.id);
      const effectiveModel =
        modelOps?.getPendingModel?.()
        ?? await modelOps?.getCurrentModel?.()
        ?? selectedModel.id;
      const effortSuffix = reasoningEffort ? ` (${reasoningEffort})` : "";
      if (result?.requiresNewSession) {
        addMessage("assistant", `Model **${selectedModel.modelID}**${effortSuffix} will be used for the next session.`);
      } else {
        addMessage("assistant", `Switched to model **${selectedModel.modelID}**${effortSuffix}`);
      }

      setCurrentModelId(effectiveModel);
      setCurrentReasoningEffort(reasoningEffort);
      onModelChange?.(effectiveModel);
      const displaySuffix =
        (agentType === "copilot" || agentType === "opencode" || agentType === "claude") && reasoningEffort
          ? ` (${reasoningEffort})`
          : "";
      setCurrentModelDisplayName(`${selectedModel.modelID}${displaySuffix}`);
      if (agentType) {
        saveModelPreference(agentType, effectiveModel);
        if (reasoningEffort) {
          saveReasoningEffortPreference(agentType, reasoningEffort);
        } else {
          clearReasoningEffortPreference(agentType);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      addMessage("assistant", `Failed to switch model: ${errorMessage}`);
    }
  }, [
    addMessage,
    agentType,
    modelOps,
    onModelChange,
    setCurrentModelDisplayName,
    setCurrentModelId,
    setCurrentReasoningEffort,
    setShowModelSelector,
  ]);

  const handleModelSelectorCancel = useCallback(() => {
    setShowModelSelector(false);
  }, [setShowModelSelector]);

  return { handleModelSelect, handleModelSelectorCancel };
}
