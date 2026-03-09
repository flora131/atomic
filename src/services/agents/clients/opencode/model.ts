import { stripProviderPrefix } from "@/services/agents/types.ts";

type ProviderConfigResult = {
  data?: {
    providers?: Array<{ id: string; models?: Record<string, { limit?: { context: number } }> }>;
    all?: Array<{ id: string; models?: Record<string, { limit?: { context: number } }> }>;
    default?: Record<string, string>;
  };
};

interface OpenCodeProviderConfigClient {
  config?: {
    providers?: () => Promise<ProviderConfigResult>;
  };
}

export interface OpenCodeResolvedPromptModel {
  providerID: string;
  modelID: string;
}

export function resolveOpenCodeModelForPrompt(
  model?: string,
): OpenCodeResolvedPromptModel | undefined {
  if (!model) return undefined;
  if (model.includes("/")) {
    const [providerID, ...rest] = model.split("/");
    const modelID = rest.join("/");
    if (!providerID || !modelID) {
      throw new Error(
        `Invalid model format: '${model}'. Must be 'providerID/modelID' (e.g., 'anthropic/claude-sonnet-4').`
      );
    }
    return { providerID, modelID };
  }
  throw new Error(
    `Model '${model}' is missing a provider prefix. Use 'providerID/modelID' format (e.g., 'anthropic/${model}').`
  );
}

export async function resolveOpenCodeModelContextWindow(
  sdkClient: unknown,
  modelHint?: string,
): Promise<number> {
  const configClient = sdkClient as OpenCodeProviderConfigClient;
  if (!configClient.config || typeof configClient.config.providers !== "function") {
    throw new Error(
      `Failed to resolve context window size from OpenCode provider.list() for model '${modelHint ?? "unknown"}'`
    );
  }

  const result = await configClient.config.providers();
  const data = result.data;
  if (!data) {
    throw new Error(
      `Failed to resolve context window size from OpenCode provider.list() for model '${modelHint ?? "unknown"}'`
    );
  }

  const providerList = data.providers ?? data.all ?? [];

  if (modelHint) {
    const parsed = resolveOpenCodeModelForPrompt(modelHint);
    if (parsed) {
      const provider = providerList.find((entry) => entry.id === parsed.providerID);
      const model = provider?.models?.[parsed.modelID];
      if (model?.limit?.context) {
        return model.limit.context;
      }
    }
  }

  const defaults = data.default;
  if (defaults) {
    const firstProvider = Object.keys(defaults)[0];
    if (firstProvider) {
      const defaultModelId = defaults[firstProvider];
      if (defaultModelId) {
        const provider = providerList.find((entry) => entry.id === firstProvider);
        const model = provider?.models?.[defaultModelId];
        if (model?.limit?.context) {
          return model.limit.context;
        }
      }
    }
  }

  throw new Error(
    `Failed to resolve context window size from OpenCode provider.list() for model '${modelHint ?? "unknown"}'`
  );
}

export async function lookupOpenCodeRawModelIdFromProviders(
  sdkClient: unknown,
): Promise<string | undefined> {
  try {
    const configClient = sdkClient as OpenCodeProviderConfigClient;
    if (!configClient.config || typeof configClient.config.providers !== "function") {
      return undefined;
    }

    const result = await configClient.config.providers();
    const data = result.data;
    if (!data) {
      return undefined;
    }

    const defaults = data.default;
    if (defaults) {
      const firstProvider = Object.keys(defaults)[0];
      if (firstProvider) {
        const modelId = defaults[firstProvider];
        if (modelId) {
          return modelId;
        }
      }
    }
  } catch {
    // Caller handles fallback when provider metadata is unavailable.
  }

  return undefined;
}

export async function getOpenCodeModelDisplayInfo(args: {
  modelHint?: string;
  activeContextWindow: number | null;
  isRunning: boolean;
  sdkClient: unknown;
  resolveModelContextWindow: (modelHint?: string) => Promise<number>;
  lookupRawModelIdFromProviders: () => Promise<string | undefined>;
}): Promise<{ model: string; tier: string; contextWindow?: number }> {
  let contextWindow = args.activeContextWindow ?? undefined;
  if (args.isRunning && args.sdkClient) {
    try {
      contextWindow = await args.resolveModelContextWindow(args.modelHint);
    } catch {
      // Keep cached value when provider metadata is temporarily unavailable.
    }
  }

  if (args.modelHint) {
    return {
      model: stripProviderPrefix(args.modelHint),
      tier: "OpenCode",
      contextWindow,
    };
  }

  if (args.isRunning && args.sdkClient) {
    const rawId = await args.lookupRawModelIdFromProviders();
    if (rawId) {
      return { model: rawId, tier: "OpenCode", contextWindow };
    }
  }

  return {
    model: "OpenCode",
    tier: "OpenCode",
    contextWindow,
  };
}
