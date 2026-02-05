import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { lazy } from '../util/lazy';

/** Path to cached models.json file */
export const CACHE_PATH: string =
  process.env.ATOMIC_MODELS_PATH ??
  path.join(process.env.HOME || '', '.atomic', 'cache', 'models.json');

/** Refresh interval for cache in milliseconds (60 minutes, same as OpenCode) */
export const REFRESH_INTERVAL: number = 60 * 1000 * 60;

/** Returns the models.dev URL, respecting ATOMIC_MODELS_URL env override */
export function url(): string {
  return process.env.ATOMIC_MODELS_URL ?? 'https://models.dev';
}

/** Source of the currently loaded models data */
export type DataSource = 'cache' | 'snapshot' | 'api' | 'offline';

/** Current data source (set during loading) */
let currentDataSource: DataSource = 'offline';

/**
 * models.dev Model Zod schema
 * Based on OpenCode's model definition structure
 * @see https://models.dev for comprehensive model metadata
 */
export namespace ModelsDev {
  /**
   * Interleaved content mode - either true for simple interleaving,
   * or an object specifying which field to use for reasoning content
   */
  export const Interleaved = z.union([
    z.literal(true),
    z.object({
      field: z.enum(['reasoning_content', 'reasoning_details'])
    }).strict()
  ]);

  /**
   * Cost information for model usage
   * All costs are per-token prices
   * Uses .passthrough() to allow additional cost fields from the evolving API
   * Note: context_over_200k can be either a number or an object with nested pricing
   */
  export const Cost = z.object({
    input: z.number(),
    output: z.number(),
    cache_read: z.number().optional(),
    cache_write: z.number().optional(),
    context_over_200k: z.union([z.number(), z.object({}).passthrough()]).optional(),
    reasoning: z.number().optional()
  }).passthrough();

  /**
   * Token limits for the model
   * Note: `input` is optional because not all models in models.dev API provide it
   */
  export const Limit = z.object({
    context: z.number(),
    input: z.number().optional(),
    output: z.number()
  });

  /**
   * Modalities supported by the model
   */
  export const Modalities = z.object({
    input: z.array(z.string()),
    output: z.array(z.string())
  });

  /**
   * Provider information for npm package (per-model)
   */
  export const ModelProvider = z.object({
    npm: z.string()
  });

  /**
   * Model status indicating stability level
   */
  export const Status = z.enum(['alpha', 'beta', 'deprecated']);

  /**
   * Complete Model schema representing a model from models.dev
   * Uses .passthrough() to allow additional fields from the evolving API
   * Most fields are optional as the API doesn't always include all fields for all models
   */
  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string().optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    temperature: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    interleaved: Interleaved.optional(),
    cost: Cost.optional(),
    limit: Limit.optional(),
    modalities: Modalities.optional(),
    experimental: z.boolean().optional(),
    status: Status.optional(),
    options: z.record(z.string(), z.any()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    provider: ModelProvider.optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional()
  }).passthrough();

  export type Interleaved = z.infer<typeof Interleaved>;
  export type Cost = z.infer<typeof Cost>;
  export type Limit = z.infer<typeof Limit>;
  export type Modalities = z.infer<typeof Modalities>;
  export type ModelProvider = z.infer<typeof ModelProvider>;
  export type Status = z.infer<typeof Status>;
  export type Model = z.infer<typeof Model>;

  /**
   * Provider schema representing a provider from models.dev database
   * Based on OpenCode's provider definition structure
   * Uses .passthrough() to allow additional fields from the evolving API
   */
  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model)
  }).passthrough();

  export type Provider = z.infer<typeof Provider>;

  /**
   * Database type representing the full models.dev database structure
   */
  export type Database = Record<string, Provider>;

  /**
   * Lazy loader for models.dev data.
   * Load order:
   *   1. File cache at CACHE_PATH
   *   2. Bundled snapshot (models-snapshot.ts)
   *   3. Fetch from API (if not disabled via ATOMIC_DISABLE_MODELS_FETCH)
   * Returns empty database if all sources fail.
   */
  export const Data = lazy(async (): Promise<Database> => {
    // 1. Try file cache
    try {
      const content = await fs.readFile(CACHE_PATH, 'utf-8');
      const data = JSON.parse(content) as Database;
      if (Object.keys(data).length > 0) {
        currentDataSource = 'cache';
        return data;
      }
    } catch {}

    // 2. Try bundled snapshot
    try {
      const snapshot = await import('./models-snapshot');
      const data = snapshot.default as Database;
      if (Object.keys(data).length > 0) {
        currentDataSource = 'snapshot';
        return data;
      }
    } catch {}

    // 3. Fetch from API if not disabled
    if (!process.env.ATOMIC_DISABLE_MODELS_FETCH) {
      try {
        const response = await fetch(url() + '/api.json', {
          headers: { 'User-Agent': 'atomic-cli' },
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
          currentDataSource = 'api';
          return (await response.json()) as Database;
        }
      } catch {}
    }

    // Return empty database if all sources fail
    currentDataSource = 'offline';
    return {} as Database;
  });

  /**
   * Get models data (from lazy loader)
   */
  export async function get(): Promise<Database> {
    return Data();
  }

  /**
   * Get the source of the currently loaded models data
   */
  export function getDataSource(): DataSource {
    return currentDataSource;
  }

  /**
   * Fetch models data directly from the models.dev API
   * @throws Error if network request fails or response is not ok
   */
  async function fetchFromApi(): Promise<Database> {
    const response = await fetch(url() + '/api.json', {
      headers: { 'User-Agent': 'atomic-cli' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }
    return response.json() as Promise<Database>;
  }

  /**
   * Refresh the models cache by fetching from API and writing to cache file.
   * Resets the lazy loader so subsequent get() calls use fresh data.
   * @throws Error if network request fails or file write fails
   */
  export async function refresh(): Promise<void> {
    const data = await fetchFromApi();
    await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
    await fs.writeFile(CACHE_PATH, JSON.stringify(data, null, 2));
    Data.reset();
  }

  /**
   * List all models from all providers in a flat array
   * @returns Array of objects containing providerID and model with id field
   */
  export async function listModels(): Promise<Array<{ providerID: string; model: Model & { id: string } }>> {
    const data = await get();
    const result: Array<{ providerID: string; model: Model & { id: string } }> = [];

    for (const [providerID, provider] of Object.entries(data)) {
      for (const [modelID, model] of Object.entries(provider.models)) {
        result.push({ providerID, model: { ...model, id: modelID } });
      }
    }

    return result;
  }

  /**
   * Get a specific model by provider ID and model ID
   * @param providerID - The provider identifier (e.g., 'anthropic', 'openai')
   * @param modelID - The model identifier (e.g., 'claude-sonnet-4-5', 'gpt-4o')
   * @returns The model if found, undefined otherwise
   */
  export async function getModel(providerID: string, modelID: string): Promise<Model | undefined> {
    const data = await get();
    return data[providerID]?.models[modelID];
  }

  /**
   * Get a specific provider by ID
   * @param providerID - The provider identifier (e.g., 'anthropic', 'openai')
   * @returns The provider if found, undefined otherwise
   */
  export async function getProvider(providerID: string): Promise<Provider | undefined> {
    const data = await get();
    return data[providerID];
  }
}

/**
 * Start periodic refresh of models.dev data.
 * Performs an initial refresh, then refreshes every REFRESH_INTERVAL (60 minutes).
 * Errors are silently caught to prevent crashes in background refresh.
 */
export function startModelsDevRefresh(): void {
  // Initial refresh
  ModelsDev.refresh().catch(() => {});

  // Set up periodic refresh
  setInterval(() => {
    ModelsDev.refresh().catch(() => {});
  }, REFRESH_INTERVAL);
}
