/**
 * Internal Model representation for unified model handling across agents.
 * This interface is used consistently across Claude, Copilot, and OpenCode agents.
 */
export interface Model {
  /** Full ID in format: providerID/modelID */
  id: string;
  /** Provider identifier (e.g., 'anthropic', 'openai', 'github-copilot') */
  providerID: string;
  /** Human-readable provider name from SDK (e.g., 'Anthropic', 'OpenAI') */
  providerName?: string;
  /** Model identifier within provider (e.g., 'claude-sonnet-4-5', 'gpt-4o') */
  modelID: string;
  /** Human-readable model name */
  name: string;
  /** Model family (e.g., 'claude', 'gpt') */
  family?: string;
  /** API type (e.g., 'anthropic', 'openai') */
  api?: string;
  /** Model status indicating stability level */
  status: 'alpha' | 'beta' | 'deprecated' | 'active';
  /** Model capabilities */
  capabilities: {
    reasoning: boolean;
    attachment: boolean;
    temperature: boolean;
    toolCall: boolean;
  };
  /** Token limits */
  limits: {
    context: number;
    input?: number;
    output: number;
  };
  /** Cost per token (if available) */
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  /** Supported modalities */
  modalities?: {
    input: string[];
    output: string[];
  };
  /** Provider-specific options */
  options: Record<string, unknown>;
  /** Custom headers for API requests */
  headers?: Record<string, string>;
  /** Model description (from SDK) */
  description?: string;
  /** Supported reasoning effort levels (Copilot SDK models only) */
  supportedReasoningEfforts?: string[];
  /** Default reasoning effort level (Copilot SDK models only) */
  defaultReasoningEffort?: string;
}

/**
 * Default model capabilities for when not provided by SDK
 */
const DEFAULT_CAPABILITIES = {
  reasoning: false,
  attachment: false,
  temperature: true,
  toolCall: true,
};

/**
 * Create a Model from Claude Agent SDK's ModelInfo
 * @param modelInfo - ModelInfo from Claude Agent SDK (supportedModels())
 * @param contextWindow - Context window size in tokens (required since SDK doesn't provide it)
 * @returns Internal Model format
 */
export function fromClaudeModelInfo(modelInfo: {
  value: string;
  displayName: string;
  description: string;
}, contextWindow: number): Model {
  return {
    id: `anthropic/${modelInfo.value}`,
    providerID: 'anthropic',
    modelID: modelInfo.value,
    name: modelInfo.displayName,
    description: modelInfo.description,
    status: 'active',
    capabilities: DEFAULT_CAPABILITIES,
    limits: {
      context: contextWindow,
      output: 16384,
    },
    options: {},
  };
}

/**
 * Create a Model from Copilot SDK's ModelInfo
 * Passes through SDK model data directly - SDK returns correct model names
 * @param modelInfo - ModelInfo from Copilot SDK (listModels())
 * @returns Internal Model format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromCopilotModelInfo(modelInfo: any): Model {
  const limits = modelInfo.capabilities?.limits ?? {};
  const supports = modelInfo.capabilities?.supports ?? {};

  // Handle supports as either an array or an object
  const supportsArray = Array.isArray(supports);
  const hasReasoning = supportsArray
    ? supports.includes("reasoning") || supports.includes("reasoningEffort")
    : (supports.reasoningEffort ?? supports.reasoning ?? false);
  const hasAttachment = supportsArray
    ? supports.includes("vision") || supports.includes("attachment")
    : (supports.vision ?? supports.attachment ?? false);
  const hasTools = supportsArray
    ? supports.includes("tools")
    : (supports.tools ?? true);

  return {
    id: `github-copilot/${modelInfo.id}`,
    providerID: 'github-copilot',
    modelID: modelInfo.id,
    name: modelInfo.name,
    status: 'active',
    capabilities: {
      reasoning: hasReasoning,
      attachment: hasAttachment,
      temperature: true,
      toolCall: hasTools,
    },
    limits: (() => {
      const context = limits.maxContextWindowTokens ?? limits.max_context_window_tokens;
      if (!context) {
        throw new Error(`Copilot model '${modelInfo.id}' missing context window in capabilities.limits`);
      }
      return {
        context,
        output: limits.maxPromptTokens ?? limits.output ?? 16384,
      };
    })(),
    options: {},
    supportedReasoningEfforts: hasReasoning ? (modelInfo.supportedReasoningEfforts ?? undefined) : undefined,
    defaultReasoningEffort: hasReasoning ? (modelInfo.defaultReasoningEffort ?? undefined) : undefined,
  };
}

/**
 * OpenCode Provider type from SDK
 */
export interface OpenCodeProvider {
  id: string;
  name: string;
  api?: string;
  models: Record<string, OpenCodeModel>;
}

/**
 * OpenCode Model type from SDK
 */
export interface OpenCodeModel {
  id?: string;
  name?: string;
  status?: 'alpha' | 'beta' | 'deprecated';
  reasoning?: boolean;
  attachment?: boolean;
  temperature?: boolean;
  tool_call?: boolean;
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  cost?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
  };
  modalities?: {
    input: string[];
    output: string[];
  };
  options?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * Create a Model from OpenCode SDK's Provider and Model
 * @param providerID - Provider identifier
 * @param modelID - Model identifier
 * @param model - Model from OpenCode SDK (provider.list())
 * @param providerApi - Optional API type from provider
 * @returns Internal Model format
 */
export function fromOpenCodeModel(
  providerID: string,
  modelID: string,
  model: OpenCodeModel,
  providerApi?: string,
  providerName?: string
): Model {
  return {
    id: `${providerID}/${modelID}`,
    providerID,
    providerName,
    modelID,
    name: model.name ?? modelID,
    api: providerApi,
    status: model.status ?? 'active',
    capabilities: {
      reasoning: model.reasoning ?? false,
      attachment: model.attachment ?? false,
      temperature: model.temperature ?? true,
      toolCall: model.tool_call ?? true,
    },
    limits: (() => {
      if (!model.limit?.context) {
        throw new Error(`OpenCode model '${modelID}' from provider '${providerID}' missing context window in limit`);
      }
      return {
        context: model.limit.context,
        input: model.limit.input,
        output: model.limit.output ?? 16384,
      };
    })(),
    cost: model.cost ? {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cache_read,
      cacheWrite: model.cost.cache_write,
    } : undefined,
    modalities: model.modalities,
    options: model.options ?? {},
    headers: model.headers,
  };
}

/**
 * Create Models from OpenCode SDK's Provider
 * @param providerID - Provider identifier
 * @param provider - Provider from OpenCode SDK
 * @returns Array of internal Model format
 */
export function fromOpenCodeProvider(
  providerID: string,
  provider: OpenCodeProvider
): Model[] {
  return Object.entries(provider.models).map(([modelID, model]) =>
    fromOpenCodeModel(providerID, modelID, model, provider.api, provider.name)
  );
}
