import {
  type Model,
  fromClaudeModelInfo,
  fromCopilotModelInfo,
  fromOpenCodeModel,
  type OpenCodeModel,
} from './model-transform';

/**
 * Claude model aliases - passed to SDK which resolves to latest versions
 * The Claude SDK handles these aliases and maps them to the current latest model
 */
export const CLAUDE_ALIASES: Record<string, string> = {
  /** SDK resolves to latest Sonnet */
  sonnet: 'sonnet',
  /** SDK resolves to latest Opus */
  opus: 'opus',
  /** SDK resolves to latest Haiku */
  haiku: 'haiku',
};

const CLAUDE_CANONICAL_MODELS = ["opus", "sonnet", "haiku"] as const;
type ClaudeCanonicalModel = (typeof CLAUDE_CANONICAL_MODELS)[number];

function normalizeClaudeModelInput(model: string): string {
  const trimmed = model.trim();
  if (trimmed.toLowerCase() === "default") {
    return "opus";
  }
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length === 2 && parts[1]?.toLowerCase() === "default") {
      return `${parts[0]}/opus`;
    }
  }
  return trimmed;
}

function isClaudeCanonicalModel(model: string): model is ClaudeCanonicalModel {
  return (CLAUDE_CANONICAL_MODELS as readonly string[]).includes(model);
}

/**
 * Supported agent types for model operations
 */
export type AgentType = 'claude' | 'opencode' | 'copilot';

/**
 * Result of a setModel operation
 */
export interface SetModelResult {
  success: boolean;
  /** If true, a new session is required for the model change to take effect */
  requiresNewSession?: boolean;
}

/**
 * Unified interface for model operations across different agent types
 */
export interface ModelOperations {
  /**
   * List all available models for this agent type
   * @returns Promise resolving to array of available models
   */
  listAvailableModels(): Promise<Model[]>;

  /**
   * Set the model to use for subsequent operations
   * @param model - Model identifier (format varies by agent type)
   * @returns Promise resolving to result indicating success and whether new session is required
   */
  setModel(model: string): Promise<SetModelResult>;

  /**
   * Get the currently active model
   * @returns Promise resolving to current model identifier, or undefined if not set
   */
  getCurrentModel(): Promise<string | undefined>;

  /**
   * Resolve a model alias to its full identifier
   * @param alias - Model alias (e.g., 'opus', 'sonnet', 'haiku' for Claude)
   * @returns Full model identifier, or undefined if alias not recognized
   */
  resolveAlias(alias: string): string | undefined;

  /**
   * Get the pending model for agents that require new sessions (e.g., Copilot).
   * @returns The pending model identifier, or undefined if no model change is pending
   */
  getPendingModel?(): string | undefined;
}

type SdkSetModelFn = (
  model: string,
  options?: { reasoningEffort?: string }
) => Promise<void>;

/**
 * Unified implementation of model operations using SDKs as the source of truth
 *
 * This class provides a consistent interface for model operations across all agent types:
 * - Claude: Uses @anthropic-ai/claude-agent-sdk supportedModels()
 * - OpenCode: Uses @opencode-ai/sdk provider.list()
 * - Copilot: Uses @github/copilot-sdk listModels()
 */
export class UnifiedModelOperations implements ModelOperations {
  /** Currently active model identifier */
  private currentModel?: string;

  /** Pending model for agents that require new sessions (e.g., Copilot) */
  private pendingModel?: string;

  /** Pending reasoning effort for agents that require new sessions (e.g., Copilot) */
  private pendingReasoningEffort?: string;

  /** Cached available models for validation (opencode/copilot) */
  private cachedModels: Model[] | null = null;

  /**
   * Create a new UnifiedModelOperations instance
   * @param agentType - The type of agent (claude, opencode, copilot)
   * @param sdkSetModel - Optional SDK-specific function to set the model
   * @param sdkListModels - Optional SDK-specific function to list models (used for Claude supportedModels())
   * @param initialModel - Optional initial model ID so getCurrentModel() returns a value before any setModel() call
   */
  constructor(
    private agentType: AgentType,
    private sdkSetModel?: SdkSetModelFn,
    private sdkListModels?: () => Promise<Array<{ value: string; displayName: string; description: string }>>,
    initialModel?: string,
  ) {
    this.currentModel = this.agentType === "claude" && initialModel
      ? normalizeClaudeModelInput(initialModel)
      : initialModel;
  }

  /**
   * List available models for this agent type using the appropriate SDK.
   * Results are cached for subsequent validation in setModel().
   * Errors propagate to the caller.
   */
  async listAvailableModels(): Promise<Model[]> {
    let models: Model[];
    switch (this.agentType) {
      case 'claude':
        models = await this.listModelsForClaude();
        break;
      case 'copilot':
        models = await this.listModelsForCopilot();
        break;
      case 'opencode':
        models = await this.listModelsForOpenCode();
        break;
      default:
        throw new Error(`Unsupported agent type: ${this.agentType}`);
    }
    this.cachedModels = models;
    return models;
  }

  /**
   * List supported models for Claude using the SDK's supportedModels() API.
   * Requires sdkListModels callback (from Query.supportedModels()) to be provided.
   * Uses a default context window of 200000 since the SDK's ModelInfo doesn't
   * include context window data — this is a known limitation.
   * @private
   */
  private async listModelsForClaude(): Promise<Model[]> {
    if (!this.sdkListModels) {
      throw new Error('Claude model listing requires an active session (sdkListModels callback not provided)');
    }
    const modelInfos = await this.sdkListModels();

    const canonicalInfo = new Map<ClaudeCanonicalModel, { value: string; displayName: string; description: string }>(
      CLAUDE_CANONICAL_MODELS.map((model) => [
        model,
        {
          value: model,
          displayName: model.charAt(0).toUpperCase() + model.slice(1),
          description: `Claude ${model} model alias`,
        },
      ])
    );
    const extraModels = new Map<string, { value: string; displayName: string; description: string }>();

    for (const info of modelInfos) {
      const value = info.value.trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (key === "default") {
        continue;
      }

      if (isClaudeCanonicalModel(key)) {
        const existing = canonicalInfo.get(key)!;
        canonicalInfo.set(key, {
          value: key,
          displayName: info.displayName || existing.displayName,
          description: info.description || existing.description,
        });
        continue;
      }

      if (!extraModels.has(key)) {
        extraModels.set(key, {
          value,
          displayName: info.displayName || value,
          description: info.description || "",
        });
      }
    }

    const orderedModelInfos = [
      ...CLAUDE_CANONICAL_MODELS.map((model) => canonicalInfo.get(model)!),
      ...Array.from(extraModels.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, info]) => info),
    ];

    // Default context window: SDK ModelInfo lacks this field pre-query
    return orderedModelInfos.map(info => fromClaudeModelInfo(info, 200000));
  }

  /**
   * List models using Copilot SDK's listModels()
   * @private
   */
  private async listModelsForCopilot(): Promise<Model[]> {
    // Dynamic import to avoid loading SDK when not needed
    const { CopilotClient } = await import('@github/copilot-sdk');
    const client = new CopilotClient();

    try {
      await client.start();
      const modelInfos = await client.listModels();
      await client.stop();

      // Map SDK ModelInfo directly - SDK returns correct model names
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return modelInfos.map((m: any) => fromCopilotModelInfo(m));
    } catch (error) {
      try {
        await client.stop();
      } catch {
        // Ignore stop errors
      }
      throw error;
    }
  }

  /**
   * List models using OpenCode SDK's provider.list()
   * Only returns models from authenticated providers
   * @private
   */
  private async listModelsForOpenCode(): Promise<Model[]> {
    // Dynamic import to avoid loading SDK when not needed
    const { createOpencodeClient } = await import('@opencode-ai/sdk');
    // Must specify baseUrl for the SDK to work properly
    const client = createOpencodeClient({ baseUrl: 'http://localhost:4096' });

    const result = await client.provider.list();
    if (!result.data) {
      throw new Error('OpenCode SDK returned no provider data');
    }

    const models: Model[] = [];

    // The response has 'all' array of providers and 'connected' array of provider IDs
    const data = result.data as {
      all?: Array<{ id: string; name: string; api?: string; models?: Record<string, OpenCodeModel> }>;
      connected?: string[];
    };
    const allProviders = data.all ?? [];
    const connectedIds = new Set(data.connected ?? []);

    // Only include models from connected providers
    const providers = allProviders.filter(p => connectedIds.has(p.id));

    for (const provider of providers) {
      if (!provider.models) continue;

      for (const [modelID, model] of Object.entries(provider.models)) {
        // Skip deprecated models
        if (model.status === 'deprecated') continue;

        models.push(fromOpenCodeModel(provider.id, modelID, model as OpenCodeModel, provider.api, provider.name));
      }
    }

    if (models.length === 0) {
      throw new Error('No models available from connected OpenCode providers');
    }

    return models;
  }

  async setModel(model: string): Promise<SetModelResult> {
    // Extract modelID from providerID/modelID format if present
    let modelId = model;
    if (model.includes('/')) {
      const parts = model.split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(
          `Invalid model format: '${model}'. Expected 'providerID/modelID' format (e.g., 'anthropic/claude-sonnet-4').`
        );
      }
      // For Claude, use just the modelID part (e.g., 'sonnet' from 'anthropic/sonnet')
      if (this.agentType === 'claude') {
        modelId = parts[1];
      }
    }

    if (this.agentType === "claude" && modelId.toLowerCase() === "default") {
      throw new Error("Model 'default' is not supported for Claude. Use one of: opus, sonnet, haiku.");
    }

    // Resolve alias if possible, otherwise use the original model
    let resolvedModel: string;
    try {
      resolvedModel = this.resolveAlias(modelId) ?? modelId;
    } catch {
      resolvedModel = modelId;
    }

    // Validate model exists for opencode and copilot
    if (this.agentType === 'opencode' || this.agentType === 'copilot') {
      await this.validateModelExists(resolvedModel);
    }

    // Prefer runtime SDK model switching when available.
    if (this.sdkSetModel) {
      await this.sdkSetModel(
        resolvedModel,
        this.agentType === "copilot"
          ? { reasoningEffort: this.pendingReasoningEffort }
          : undefined
      );
      this.pendingModel = undefined;
      this.currentModel = resolvedModel;
      return { success: true };
    }

    // Fallback for SDKs that cannot switch the active session model.
    if (this.agentType === 'copilot') {
      this.pendingModel = resolvedModel;
      return { success: true, requiresNewSession: true };
    }

    this.currentModel = resolvedModel;
    return { success: true };
  }

  /**
   * Validate that a model exists in the available models list.
   * Fetches and caches the model list if not already cached.
   * @param model - Model identifier to validate (full ID or modelID)
   * @throws Error if the model is not found
   */
  private async validateModelExists(model: string): Promise<void> {
    if (!this.cachedModels) {
      this.cachedModels = await this.listAvailableModels();
    }

    const found = this.cachedModels.some(
      m => m.id === model || m.modelID === model
    );
    if (!found) {
      throw new Error(
        `Model '${model}' is not available. Use /model to see available models.`
      );
    }
  }

  async getCurrentModel(): Promise<string | undefined> {
    if (this.agentType === "claude" && this.currentModel) {
      return normalizeClaudeModelInput(this.currentModel);
    }
    return this.currentModel;
  }

  resolveAlias(alias: string): string | undefined {
    if (this.agentType === 'claude') {
      return CLAUDE_ALIASES[alias.toLowerCase()];
    }
    return undefined;
  }

  /**
   * Get the pending model for agents that require new sessions (e.g., Copilot)
   * @returns The pending model identifier, or undefined if no model change is pending
   */
  getPendingModel(): string | undefined {
    return this.pendingModel;
  }

  /**
   * Set the pending reasoning effort for agents that require new sessions (e.g., Copilot)
   */
  setPendingReasoningEffort(effort: string | undefined): void {
    this.pendingReasoningEffort = effort;
  }

  /**
   * Get the pending reasoning effort for agents that require new sessions (e.g., Copilot)
   */
  getPendingReasoningEffort(): string | undefined {
    return this.pendingReasoningEffort;
  }
}
