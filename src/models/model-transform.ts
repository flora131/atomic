/**
 * Internal Model representation for unified model handling across agents.
 * Transforms the models.dev format into a normalized internal format.
 */
export interface Model {
  /** Full ID in format: providerID/modelID */
  id: string;
  /** Provider identifier (e.g., 'anthropic', 'openai') */
  providerID: string;
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
}

import { ModelsDev } from './models-dev';

/**
 * Transform a models.dev Model to internal Model format
 * @param providerID - Provider identifier (e.g., 'anthropic', 'openai')
 * @param modelID - Model identifier within provider (e.g., 'claude-sonnet-4-5', 'gpt-4o')
 * @param model - The models.dev Model to transform
 * @param providerApi - Optional API type from provider (e.g., 'anthropic', 'openai')
 * @returns Internal Model format
 */
export function fromModelsDevModel(
  providerID: string,
  modelID: string,
  model: ModelsDev.Model,
  providerApi?: string
): Model {
  return {
    id: `${providerID}/${modelID}`,
    providerID,
    modelID,
    name: model.name,
    family: model.family,
    api: providerApi,
    status: model.status ?? 'active',
    capabilities: {
      reasoning: model.reasoning ?? false,
      attachment: model.attachment ?? false,
      temperature: model.temperature ?? false,
      toolCall: model.tool_call ?? false
    },
    limits: {
      context: model.limit?.context ?? 0,
      input: model.limit?.input,
      output: model.limit?.output ?? 0
    },
    cost: model.cost ? {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cache_read,
      cacheWrite: model.cost.cache_write
    } : undefined,
    modalities: model.modalities,
    options: model.options ?? {},
    headers: model.headers
  };
}

/**
 * Transform a models.dev Provider to array of internal Model format
 * @param providerID - Provider identifier (e.g., 'anthropic', 'openai')
 * @param provider - The models.dev Provider to transform
 * @returns Array of internal Model format
 */
export function fromModelsDevProvider(
  providerID: string,
  provider: ModelsDev.Provider
): Model[] {
  return Object.entries(provider.models).map(([modelID, model]) =>
    fromModelsDevModel(providerID, modelID, model, provider.api)
  );
}
