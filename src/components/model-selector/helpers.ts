import type { Model } from "@/services/models/model-transform.ts";

export interface GroupedModels {
  providerID: string;
  displayName: string;
  models: Model[];
}

export function groupModelsByProvider(models: Model[]): GroupedModels[] {
  const groups = new Map<string, Model[]>();

  for (const model of models) {
    const groupedModels = groups.get(model.providerID) ?? [];
    groupedModels.push(model);
    groups.set(model.providerID, groupedModels);
  }

  return Array.from(groups.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((providerID) => {
      const providerModels = groups.get(providerID) ?? [];
      return {
        providerID,
        displayName: providerModels[0]?.providerName ?? providerID,
        models: providerModels,
      };
    });
}

function formatContextSize(context: number): string {
  if (context >= 1_000_000) {
    return `${(context / 1_000_000).toFixed(1)}M`;
  }
  if (context >= 1_000) {
    return `${Math.round(context / 1_000)}k`;
  }
  return String(context);
}

export function getCapabilityInfo(model: Model): string | null {
  if (!model.limits?.context) {
    return null;
  }

  return formatContextSize(model.limits.context);
}
