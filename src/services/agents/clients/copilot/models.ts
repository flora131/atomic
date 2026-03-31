import type {
  CopilotClient as SdkCopilotClient,
  CopilotClientOptions as SdkClientOptions,
  SessionConfig as SdkSessionConfig,
} from "@github/copilot-sdk";

import {
  stripProviderPrefix,
  type SessionConfig,
} from "@/services/agents/types.ts";

import type { CopilotSdkModelRecord } from "@/services/agents/clients/copilot/types.ts";

function getModelCapabilities(model: CopilotSdkModelRecord | undefined): Record<string, unknown> | undefined {
  return model?.capabilities as Record<string, unknown> | undefined;
}

function getModelContextWindow(model: CopilotSdkModelRecord | undefined): number | undefined {
  const capabilities = getModelCapabilities(model);
  const limits = capabilities?.limits as Record<string, unknown> | undefined;
  return typeof limits?.max_context_window_tokens === "number"
    ? limits.max_context_window_tokens
    : undefined;
}

function modelSupportsReasoning(model: CopilotSdkModelRecord | undefined): boolean {
  const capabilities = getModelCapabilities(model);
  const supports = capabilities?.supports as Record<string, unknown> | undefined;
  return supports?.reasoningEffort === true;
}

function toModelDisplayInfo(model: CopilotSdkModelRecord): {
  model: string;
  tier: string;
  supportsReasoning?: boolean;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  contextWindow?: number;
} {
  const supportsReasoning = modelSupportsReasoning(model);
  return {
    model: model.id ?? "Copilot",
    tier: "GitHub Copilot",
    supportsReasoning,
    supportedReasoningEfforts: supportsReasoning && Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts.filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        )
      : undefined,
    defaultReasoningEffort: supportsReasoning && typeof model.defaultReasoningEffort === "string"
      ? model.defaultReasoningEffort
      : undefined,
    contextWindow: getModelContextWindow(model),
  };
}

export async function listCopilotSdkModelsFresh(
  sdkClient: SdkCopilotClient,
): Promise<unknown[]> {
  const rawSdkClient = sdkClient as unknown as {
    connection?: {
      sendRequest: (
        method: string,
        params: Record<string, never>,
      ) => Promise<{ models?: unknown[] }>;
    };
    modelsCache?: unknown[] | null;
    listModels: () => Promise<unknown[]>;
  };

  rawSdkClient.modelsCache = null;

  if (rawSdkClient.connection) {
    const result = await rawSdkClient.connection.sendRequest("models.list", {});
    if (Array.isArray(result.models)) {
      rawSdkClient.modelsCache = result.models;
      return result.models;
    }
  }

  return await rawSdkClient.listModels();
}

export async function listCopilotSdkModelsFromFreshClient(args: {
  buildSdkOptions: () => Promise<SdkClientOptions>;
  createSdkClientInstance: (options: SdkClientOptions) => SdkCopilotClient;
}): Promise<unknown[]> {
  const sdkOptions = await args.buildSdkOptions();
  const tempClient = args.createSdkClientInstance(sdkOptions);

  try {
    await tempClient.start();
    const rawTempClient = tempClient as unknown as {
      connection?: {
        sendRequest: (
          method: string,
          params: Record<string, never>,
        ) => Promise<{ models?: unknown[] }>;
      };
      listModels: () => Promise<unknown[]>;
    };

    if (rawTempClient.connection) {
      const result = await rawTempClient.connection.sendRequest("models.list", {});
      if (Array.isArray(result.models)) {
        return result.models;
      }
    }

    return await rawTempClient.listModels();
  } finally {
    try {
      await tempClient.stop();
    } catch {
      // Best-effort cleanup for temporary model-discovery clients.
    }
  }
}

export async function resolveCreateSessionModelConfig(args: {
  config: SessionConfig;
  listModelsFresh: () => Promise<CopilotSdkModelRecord[]>;
}): Promise<{
  resolvedModel?: string;
  contextWindow: number | null;
  sanitizedReasoningEffort?: SdkSessionConfig["reasoningEffort"];
}> {
  const resolvedModel = args.config.model
    ? stripProviderPrefix(args.config.model)
    : undefined;
  let contextWindow: number | null = null;
  let sanitizedReasoningEffort: SdkSessionConfig["reasoningEffort"] | undefined;

  try {
    const models = await args.listModelsFresh();
    if (models.length > 0) {
      const matchedModel = resolvedModel
        ? models.find((model) => model.id === resolvedModel)
        : undefined;
      const targetModel = matchedModel ?? models[0];
      contextWindow = getModelContextWindow(targetModel) ?? null;

      if (modelSupportsReasoning(targetModel) && args.config.reasoningEffort) {
        sanitizedReasoningEffort = args.config.reasoningEffort as SdkSessionConfig["reasoningEffort"];
      }
    }
  } catch {
    // Fall through - caller preserves prior behavior and throws if contextWindow stays null.
  }

  return {
    resolvedModel,
    contextWindow,
    sanitizedReasoningEffort,
  };
}

export async function resolveModelContextWindow(args: {
  resolvedModel: string;
  listModelsFresh: () => Promise<CopilotSdkModelRecord[]>;
}): Promise<number> {
  const models = await args.listModelsFresh();
  const matched = models.find((model) => model.id === args.resolvedModel);
  const contextWindow = getModelContextWindow(matched);
  if (contextWindow === undefined) {
    throw new Error(
      `Failed to resolve context window for model "${args.resolvedModel}"`,
    );
  }
  return contextWindow;
}

export async function resolveModelSwitchReasoningEffort(args: {
  resolvedModel: string;
  requestedReasoningEffort?: string;
  listModelsFresh: () => Promise<CopilotSdkModelRecord[]>;
}): Promise<string | undefined> {
  let sanitizedReasoningEffort = args.requestedReasoningEffort;
  if (sanitizedReasoningEffort === undefined) {
    return undefined;
  }

  try {
    const models = await args.listModelsFresh();
    const matchedModel = models.find((entry) => entry.id === args.resolvedModel);
    if (!modelSupportsReasoning(matchedModel)) {
      sanitizedReasoningEffort = undefined;
    }
  } catch {
    // If model metadata lookup fails, preserve the explicit user request.
  }

  return sanitizedReasoningEffort;
}

export function buildCopilotModelDisplayInfo(
  models: CopilotSdkModelRecord[],
  modelHint?: string,
): {
  model: string;
  tier: string;
  supportsReasoning?: boolean;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string;
  contextWindow?: number;
} | null {
  if (models.length === 0) {
    return null;
  }

  if (modelHint) {
    const hintModelId = stripProviderPrefix(modelHint);
    const matched = models.find((model) => model.id === hintModelId || model.id === modelHint);
    if (matched) {
      return toModelDisplayInfo(matched);
    }
  }

  const firstModel = models[0];
  return firstModel ? toModelDisplayInfo(firstModel) : null;
}
