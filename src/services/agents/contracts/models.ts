export type OpenCodeAgentMode = "build" | "plan" | "general" | "explore";

export interface ModelDisplayInfo {
  model: string;
  tier: string;
  supportsReasoning?: boolean;
  defaultReasoningEffort?: string;
  contextWindow?: number;
}

export function stripProviderPrefix(modelId: string): string {
  return modelId.includes("/") ? modelId.split("/").slice(1).join("/") : modelId;
}

export function formatModelDisplayName(modelId: string): string {
  if (!modelId) {
    return "";
  }

  return stripProviderPrefix(modelId);
}
