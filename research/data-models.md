# Data Models and Schemas - Model Config Loading

## Overview

This document catalogs all data structures, schemas, and type definitions used in the model configuration loading system.

## External Schema (models.dev API)

### Database Structure

```typescript
type Database = Record<string, Provider>

// Example:
{
  "anthropic": { /* Provider */ },
  "openai": { /* Provider */ },
  "google": { /* Provider */ }
}
```

**Source:** `https://models.dev/api.json`

### Provider Schema

**Location:** `src/models/models-dev.ts:119`

```typescript
export const Provider = z.object({
  api: z.string().optional(),        // API type (e.g., 'anthropic', 'openai')
  name: z.string(),                  // Human-readable name
  env: z.array(z.string()),          // Required environment variables
  id: z.string(),                    // Provider identifier
  npm: z.string().optional(),        // NPM package for SDK (global)
  models: z.record(z.string(), Model) // Map of modelID → Model
});

export type Provider = z.infer<typeof Provider>;
```

**Fields:**

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `api` | string | No | API protocol/type | `"anthropic"` |
| `name` | string | Yes | Provider display name | `"Anthropic"` |
| `env` | string[] | Yes | Required env vars | `["ANTHROPIC_API_KEY"]` |
| `id` | string | Yes | Unique identifier | `"anthropic"` |
| `npm` | string | No | Global SDK package | `"@anthropic-ai/sdk"` |
| `models` | Record<string, Model> | Yes | Available models | `{ "claude-sonnet-4": {...} }` |

### Model Schema

**Location:** `src/models/models-dev.ts:86`

```typescript
export const Model = z.object({
  id: z.string(),                                  // Model identifier
  name: z.string(),                                // Display name
  family: z.string().optional(),                   // Model family
  release_date: z.string(),                        // ISO date string
  attachment: z.boolean(),                         // Supports file attachments
  reasoning: z.boolean(),                          // Has reasoning capabilities
  temperature: z.boolean(),                        // Supports temperature parameter
  tool_call: z.boolean(),                          // Supports function/tool calling
  interleaved: Interleaved.optional(),             // Interleaved content mode
  cost: Cost,                                      // Token costs
  limit: Limit,                                    // Token limits
  modalities: Modalities,                          // Input/output modalities
  experimental: z.boolean().optional(),            // Experimental status
  status: Status.optional(),                       // Model status
  options: z.record(z.string(), z.any()),          // Provider-specific options
  headers: z.record(z.string(), z.string()).optional(), // Custom headers
  provider: ModelProvider.optional(),              // Per-model provider info
  variants: z.record(z.string(), z.record(z.string(), z.any())).optional() // Model variants
});

export type Model = z.infer<typeof Model>;
```

**Fields:**

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `id` | string | Yes | Model ID (within provider) | `"claude-sonnet-4"` |
| `name` | string | Yes | Display name | `"Claude Sonnet 4"` |
| `family` | string | No | Model family grouping | `"claude"` |
| `release_date` | string | Yes | Release date (ISO 8601) | `"2025-01-01"` |
| `attachment` | boolean | Yes | Supports file uploads | `true` |
| `reasoning` | boolean | Yes | Has reasoning mode | `false` |
| `temperature` | boolean | Yes | Supports temperature | `true` |
| `tool_call` | boolean | Yes | Supports function calls | `true` |
| `interleaved` | Interleaved | No | Interleaved content support | `true` or `{ field: "..." }` |
| `cost` | Cost | Yes | Token pricing | `{ input: 0.003, ... }` |
| `limit` | Limit | Yes | Token limits | `{ context: 200000, ... }` |
| `modalities` | Modalities | Yes | Supported modalities | `{ input: ["text", "image"], ... }` |
| `experimental` | boolean | No | Experimental flag | `false` |
| `status` | Status | No | Stability status | `"beta"` |
| `options` | Record<string, any> | Yes | Provider options | `{ "max_tokens": 4096 }` |
| `headers` | Record<string, string> | No | Custom HTTP headers | `{ "X-API-Version": "2023-01" }` |
| `provider` | ModelProvider | No | Per-model provider info | `{ npm: "..." }` |
| `variants` | Record<...> | No | Model variants | `{ "extended": {...} }` |

### Nested Schemas

#### Interleaved Schema

**Location:** `src/models/models-dev.ts:35`

```typescript
export const Interleaved = z.union([
  z.literal(true),
  z.object({
    field: z.enum(['reasoning_content', 'reasoning_details'])
  }).strict()
]);

export type Interleaved = z.infer<typeof Interleaved>;
```

**Purpose:** Define interleaved content mode for models with reasoning capabilities.

**Values:**
- `true`: Simple interleaving enabled
- `{ field: "reasoning_content" }`: Use specific field for reasoning
- `{ field: "reasoning_details" }`: Use alternative reasoning field

#### Cost Schema

**Location:** `src/models/models-dev.ts:46`

```typescript
export const Cost = z.object({
  input: z.number(),                     // Cost per input token
  output: z.number(),                    // Cost per output token
  cache_read: z.number().optional(),     // Cost per cached token read
  cache_write: z.number().optional(),    // Cost per cached token write
  context_over_200k: z.number().optional() // Additional cost for large contexts
});

export type Cost = z.infer<typeof Cost>;
```

**Units:** USD per token (typically fractional, e.g., 0.003 = $0.003 per token)

**Example:**
```json
{
  "input": 0.003,
  "output": 0.015,
  "cache_read": 0.0003,
  "cache_write": 0.00375
}
```

#### Limit Schema

**Location:** `src/models/models-dev.ts:57`

```typescript
export const Limit = z.object({
  context: z.number(),  // Total context window size
  input: z.number(),    // Max input tokens
  output: z.number()    // Max output tokens
});

export type Limit = z.infer<typeof Limit>;
```

**Units:** Token count

**Example:**
```json
{
  "context": 200000,
  "input": 100000,
  "output": 100000
}
```

**Note:** `input + output ≤ context` typically

#### Modalities Schema

**Location:** `src/models/models-dev.ts:66`

```typescript
export const Modalities = z.object({
  input: z.array(z.string()),   // Supported input types
  output: z.array(z.string())   // Supported output types
});

export type Modalities = z.infer<typeof Modalities>;
```

**Common Values:**
- Input: `["text"]`, `["text", "image"]`, `["text", "image", "audio"]`
- Output: `["text"]`, `["text", "image"]`

**Example:**
```json
{
  "input": ["text", "image"],
  "output": ["text"]
}
```

#### ModelProvider Schema

**Location:** `src/models/models-dev.ts:74`

```typescript
export const ModelProvider = z.object({
  npm: z.string()  // NPM package for this specific model
});

export type ModelProvider = z.infer<typeof ModelProvider>;
```

**Purpose:** Override provider-level npm package for specific models

**Example:**
```json
{
  "npm": "@anthropic-ai/claude-special-sdk"
}
```

#### Status Schema

**Location:** `src/models/models-dev.ts:81`

```typescript
export const Status = z.enum(['alpha', 'beta', 'deprecated']);

export type Status = z.infer<typeof Status>;
```

**Values:**
- `"alpha"`: Early testing, unstable
- `"beta"`: Testing, may change
- `"deprecated"`: Will be removed, avoid use

**Note:** If not specified, model is considered stable/active

## Internal Schema (Application)

### Internal Model Interface

**Location:** `src/models/model-transform.ts:5`

```typescript
export interface Model {
  id: string;                          // Full ID: "providerID/modelID"
  providerID: string;                  // Provider identifier
  modelID: string;                     // Model identifier within provider
  name: string;                        // Human-readable name
  family?: string;                     // Model family
  api?: string;                        // API type
  status: 'alpha' | 'beta' | 'deprecated' | 'active';
  capabilities: {
    reasoning: boolean;
    attachment: boolean;
    temperature: boolean;
    toolCall: boolean;                 // Renamed from tool_call
  };
  limits: {
    context: number;
    input?: number;
    output: number;
  };
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;                // Renamed from cache_read
    cacheWrite?: number;               // Renamed from cache_write
  };
  modalities?: {
    input: string[];
    output: string[];
  };
  options: Record<string, unknown>;
  headers?: Record<string, string>;
}
```

**Differences from External Schema:**
- **Computed `id` field:** Combines `providerID/modelID`
- **Split provider info:** `providerID` and `modelID` separate
- **Default status:** `'active'` if not specified
- **Renamed fields:** `tool_call` → `toolCall`, `cache_read` → `cacheRead`, etc.
- **Nested capabilities:** Grouped boolean flags
- **Nested limits:** Grouped token limits
- **CamelCase:** Consistent naming convention

### Transformation Function

**Location:** `src/models/model-transform.ts:61`

```typescript
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
      reasoning: model.reasoning,
      attachment: model.attachment,
      temperature: model.temperature,
      toolCall: model.tool_call
    },
    limits: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output
    },
    cost: model.cost ? {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cache_read,
      cacheWrite: model.cost.cache_write
    } : undefined,
    modalities: model.modalities,
    options: model.options,
    headers: model.headers
  };
}
```

## Operation Types

### AgentType

**Location:** `src/models/model-operations.ts:22`

```typescript
export type AgentType = 'claude' | 'opencode' | 'copilot';
```

**Purpose:** Identify which agent SDK is being used

**Values:**
- `"claude"`: Claude Code (Anthropic)
- `"opencode"`: OpenCode AI
- `"copilot"`: GitHub Copilot CLI

### SetModelResult

**Location:** `src/models/model-operations.ts:27`

```typescript
export interface SetModelResult {
  success: boolean;
  requiresNewSession?: boolean;
}
```

**Purpose:** Result of `setModel()` operation

**Fields:**
- `success`: Whether operation succeeded
- `requiresNewSession`: If true, model change requires restart (Copilot)

**Examples:**
```typescript
{ success: true }                              // Claude, OpenCode
{ success: true, requiresNewSession: true }    // Copilot
```

### ModelOperations Interface

**Location:** `src/models/model-operations.ts:36`

```typescript
export interface ModelOperations {
  listAvailableModels(): Promise<Model[]>;
  setModel(model: string): Promise<SetModelResult>;
  getCurrentModel(): Promise<string | undefined>;
  resolveAlias(alias: string): string | undefined;
}
```

**Purpose:** Contract for model operations

**Methods:**
- `listAvailableModels()`: Get all available models
- `setModel(model)`: Set active model
- `getCurrentModel()`: Get current model ID
- `resolveAlias(alias)`: Resolve model alias to full ID

### DataSource Type

**Location:** `src/models/models-dev.ts:20`

```typescript
export type DataSource = 'cache' | 'snapshot' | 'api' | 'offline';
```

**Purpose:** Track where models data was loaded from

**Values:**
- `"cache"`: Loaded from file cache (`~/.atomic/cache/models.json`)
- `"snapshot"`: Loaded from bundled snapshot
- `"api"`: Loaded from models.dev API
- `"offline"`: No data available (empty database)

## Constants

### Claude Aliases

**Location:** `src/models/model-operations.ts:8`

```typescript
export const CLAUDE_ALIASES: Record<string, string> = {
  sonnet: 'sonnet',    // SDK resolves to latest Sonnet
  opus: 'opus',        // SDK resolves to latest Opus
  haiku: 'haiku',      // SDK resolves to latest Haiku
  default: 'sonnet',   // Account default
};
```

**Purpose:** Map user-friendly aliases to SDK-recognized values

**Note:** Claude SDK handles version resolution (e.g., `sonnet` → `claude-sonnet-4.5`)

### Cache Path

**Location:** `src/models/models-dev.ts:7`

```typescript
export const CACHE_PATH: string =
  process.env.ATOMIC_MODELS_PATH ??
  path.join(process.env.HOME || '', '.atomic', 'cache', 'models.json');
```

**Purpose:** File system location for cached models data

**Default:** `~/.atomic/cache/models.json`

**Override:** `ATOMIC_MODELS_PATH` environment variable

### Refresh Interval

**Location:** `src/models/models-dev.ts:12`

```typescript
export const REFRESH_INTERVAL: number = 60 * 1000 * 60; // 60 minutes
```

**Purpose:** Background refresh frequency

**Value:** 3,600,000 milliseconds (60 minutes)

**Rationale:** Matches OpenCode behavior, balances freshness with network usage

## Type Relationships

### Schema → Type Flow

```
Zod Schema (runtime)
    ↓ (z.infer)
TypeScript Type (compile-time)
    ↓ (usage)
Application Code
```

**Example:**
```typescript
const Model = z.object({ ... });       // Schema
type Model = z.infer<typeof Model>;    // Type
const model: Model = { ... };          // Usage
```

### External → Internal Flow

```
models.dev API Response
    ↓ (JSON parse)
ModelsDev.Database
    ↓ (fromModelsDevModel)
Internal Model[]
    ↓ (usage)
Application
```

### Query Result Types

#### listModels() Result

```typescript
Array<{
  providerID: string;
  model: ModelsDev.Model & { id: string }
}>
```

**Example:**
```typescript
[
  {
    providerID: "anthropic",
    model: {
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
      // ... rest of ModelsDev.Model fields
    }
  }
]
```

#### listAvailableModels() Result

```typescript
Array<Model>  // Internal Model format
```

**Example:**
```typescript
[
  {
    id: "anthropic/claude-sonnet-4",
    providerID: "anthropic",
    modelID: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    // ... rest of internal Model fields
  }
]
```

## Validation Rules

### Model ID Format

**Pattern:** `providerID/modelID`

**Examples:**
- ✓ Valid: `anthropic/claude-sonnet-4`
- ✓ Valid: `openai/gpt-4o`
- ✗ Invalid: `anthropic/` (empty modelID)
- ✗ Invalid: `/claude-sonnet-4` (empty providerID)
- ✗ Invalid: `anthropic/claude/v4` (too many slashes)

**Validation Location:** `src/models/model-operations.ts:102-109`

### Zod Schema Validation

All external data validated against Zod schemas:
- `Model`: Complete model structure
- `Provider`: Provider with models
- `Database`: Record of providers

**Behavior on Failure:**
- Invalid data rejected
- Fallback to next data source
- No crashes, graceful degradation

## Key Takeaways

1. **Dual Schema:** External (models.dev) and internal (application) formats
2. **Zod Validation:** Runtime type safety for external data
3. **Transformation:** Clean boundary between external and internal
4. **Computed Fields:** Internal format adds `id` as `providerID/modelID`
5. **Naming Normalization:** snake_case → camelCase in internal format
6. **Default Values:** Missing `status` defaults to `'active'`
7. **Agent-Specific:** Claude aliases, Copilot session requirements
8. **Type Safety:** TypeScript + Zod = compile-time + runtime safety
9. **Clear Contracts:** Interfaces define expected operations
10. **Tracking:** DataSource type tracks data origin for debugging
