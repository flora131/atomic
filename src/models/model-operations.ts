import { type Model, fromModelsDevModel } from './model-transform';
import { ModelsDev } from './models-dev';

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
 * Unified implementation of model operations using models.dev as the source of truth
 *
 * This class provides a consistent interface for model operations across all agent types:
 * - Claude: Supports aliases (opus, sonnet, haiku) which are passed directly to the SDK
 * - OpenCode: Uses provider/model format (e.g., 'anthropic/claude-sonnet-4-5')
 * - Copilot: Model changes require a new session due to SDK limitations
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

  async listAvailableModels(): Promise<Model[]> {
    const data = await ModelsDev.get();
    const models: Model[] = [];
    for (const [providerID, provider] of Object.entries(data)) {
      for (const [modelID, model] of Object.entries(provider.models)) {
        models.push(fromModelsDevModel(providerID, modelID, model, provider.api));
      }
    }
    return models;
  }

  async setModel(model: string): Promise<SetModelResult> {
    // Validate providerID/modelID format if model contains '/'
    if (model.includes('/')) {
      const parts = model.split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(
          `Invalid model format: '${model}'. Expected 'providerID/modelID' format (e.g., 'anthropic/claude-sonnet-4').`
        );
      }
    }

    // Resolve alias if possible, otherwise use the original model
    let resolvedModel: string;
    try {
      resolvedModel = this.resolveAlias(model) ?? model;
    } catch {
      resolvedModel = model;
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
