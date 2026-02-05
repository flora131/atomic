import {
  type Model,
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
  /** Account default - resolves to Sonnet */
  default: 'sonnet',
};

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
}

/**
 * Supported models for each agent type
 * For Claude, we use short aliases (sonnet, opus, haiku) as that's what the SDK expects
 */
const SUPPORTED_MODELS: Record<AgentType, Model[]> = {
  claude: [
    {
      id: 'anthropic/opus',
      providerID: 'anthropic',
      modelID: 'opus',
      name: 'opus',
      description: 'Most capable model for complex tasks',
      status: 'active',
      capabilities: { reasoning: true, attachment: true, temperature: true, toolCall: true },
      limits: { context: 200000, output: 16384 },
      options: {},
    },
    {
      id: 'anthropic/sonnet',
      providerID: 'anthropic',
      modelID: 'sonnet',
      name: 'sonnet',
      description: 'Fast and intelligent model, best for most tasks',
      status: 'active',
      capabilities: { reasoning: true, attachment: true, temperature: true, toolCall: true },
      limits: { context: 200000, output: 16384 },
      options: {},
    },
    {
      id: 'anthropic/haiku',
      providerID: 'anthropic',
      modelID: 'haiku',
      name: 'haiku',
      description: 'Fastest model for simple tasks',
      status: 'active',
      capabilities: { reasoning: true, attachment: true, temperature: true, toolCall: true },
      limits: { context: 200000, output: 16384 },
      options: {},
    },
  ],
  copilot: [
    {
      id: 'github-copilot/gpt-5.2',
      providerID: 'github-copilot',
      modelID: 'gpt-5.2',
      name: 'GPT-5.2',
      status: 'active',
      capabilities: { reasoning: true, attachment: true, temperature: true, toolCall: true },
      limits: { context: 128000, output: 16384 },
      options: {},
    },
    {
      id: 'github-copilot/claude-sonnet-4.5',
      providerID: 'github-copilot',
      modelID: 'claude-sonnet-4.5',
      name: 'Claude Sonnet 4.5',
      status: 'active',
      capabilities: { reasoning: true, attachment: true, temperature: true, toolCall: true },
      limits: { context: 200000, output: 16384 },
      options: {},
    },
    {
      id: 'github-copilot/gemini-3-pro',
      providerID: 'github-copilot',
      modelID: 'gemini-3-pro',
      name: 'Gemini 3 Pro',
      status: 'active',
      capabilities: { reasoning: true, attachment: true, temperature: true, toolCall: true },
      limits: { context: 128000, output: 8192 },
      options: {},
    },
  ],
  opencode: [
    {
      id: 'anthropic/claude-sonnet-4',
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4',
      name: 'Claude Sonnet 4',
      status: 'active',
      capabilities: { reasoning: true, attachment: true, temperature: true, toolCall: true },
      limits: { context: 200000, output: 16384 },
      options: {},
    },
    {
      id: 'openai/gpt-4.1',
      providerID: 'openai',
      modelID: 'gpt-4.1',
      name: 'GPT-4.1',
      status: 'active',
      capabilities: { reasoning: true, attachment: true, temperature: true, toolCall: true },
      limits: { context: 128000, output: 16384 },
      options: {},
    },
    {
      id: 'google/gemini-2.5-flash',
      providerID: 'google',
      modelID: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      status: 'active',
      capabilities: { reasoning: true, attachment: true, temperature: true, toolCall: true },
      limits: { context: 1000000, output: 8192 },
      options: {},
    },
  ],
};

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

  /**
   * Create a new UnifiedModelOperations instance
   * @param agentType - The type of agent (claude, opencode, copilot)
   * @param sdkSetModel - Optional SDK-specific function to set the model
   */
  constructor(
    private agentType: AgentType,
    private sdkSetModel?: (model: string) => Promise<void>
  ) {}

  /**
   * List available models for this agent type using the appropriate SDK.
   * Falls back to hardcoded models if SDK listing fails.
   */
  async listAvailableModels(): Promise<Model[]> {
    try {
      switch (this.agentType) {
        case 'claude':
          return await this.listModelsForClaude();
        case 'copilot':
          return await this.listModelsForCopilot();
        case 'opencode':
          return await this.listModelsForOpenCode();
        default:
          return SUPPORTED_MODELS[this.agentType] ?? [];
      }
    } catch {
      // Return fallback models on error
      return SUPPORTED_MODELS[this.agentType] ?? [];
    }
  }

  /**
   * List supported models for Claude
   * Uses the known model aliases that the Claude SDK accepts
   * @private
   */
  private async listModelsForClaude(): Promise<Model[]> {
    // Claude SDK accepts short aliases: opus, sonnet, haiku
    // These are the officially supported models
    return SUPPORTED_MODELS.claude;
  }

  /**
   * List models using Copilot SDK's listModels()
   * @private
   */
  private async listModelsForCopilot(): Promise<Model[]> {
    try {
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
      } catch {
        try {
          await client.stop();
        } catch {
          // Ignore stop errors
        }
        return SUPPORTED_MODELS.copilot;
      }
    } catch {
      // Return fallback if SDK fails
      return SUPPORTED_MODELS.copilot;
    }
  }

  /**
   * List models using OpenCode SDK's provider.list()
   * Only returns models from authenticated providers
   * @private
   */
  private async listModelsForOpenCode(): Promise<Model[]> {
    try {
      // Dynamic import to avoid loading SDK when not needed
      const { createOpencodeClient } = await import('@opencode-ai/sdk');
      // Must specify baseUrl for the SDK to work properly
      const client = createOpencodeClient({ baseUrl: 'http://localhost:4096' });

      const result = await client.provider.list();
      if (!result.data) {
        return SUPPORTED_MODELS.opencode;
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

          models.push(fromOpenCodeModel(provider.id, modelID, model as OpenCodeModel, provider.api));
        }
      }

      return models.length > 0 ? models : SUPPORTED_MODELS.opencode;
    } catch {
      // Return fallback if SDK fails
      return SUPPORTED_MODELS.opencode;
    }
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

    // Resolve alias if possible, otherwise use the original model
    let resolvedModel: string;
    try {
      resolvedModel = this.resolveAlias(modelId) ?? modelId;
    } catch {
      resolvedModel = modelId;
    }

    // Copilot limitation: model changes require a new session
    if (this.agentType === 'copilot') {
      this.pendingModel = resolvedModel;
      return { success: true, requiresNewSession: true };
    }

    // For other agents, call SDK if available
    // SDK handles actual model validation and will throw with clear error if invalid
    if (this.sdkSetModel) {
      await this.sdkSetModel(resolvedModel);
    }

    this.currentModel = resolvedModel;
    return { success: true };
  }

  async getCurrentModel(): Promise<string | undefined> {
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
}
