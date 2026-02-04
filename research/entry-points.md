# Entry Points - Model Config Loading System

## Application Entry Points

### Main CLI Entry Point
**File:** `src/cli.ts`
**Command:** `atomic [command]`

**Model System Initialization:**
```typescript
import { startModelsDevRefresh } from './models';

// Called at application startup
startModelsDevRefresh();
```

**Behavior:**
1. Starts background refresh immediately
2. Sets up 60-minute periodic refresh interval
3. Non-blocking (errors silently caught)
4. Runs throughout application lifetime

## API Entry Points

### Data Access API

#### `ModelsDev.get()`
**Location:** `src/models/models-dev.ts:183`

**Signature:**
```typescript
async function get(): Promise<Database>
```

**Purpose:** Get the complete models database

**Execution Flow:**
```
1. Call lazy loader: ModelsDev.Data()
2. If not cached:
   a. Try file cache
   b. Try snapshot
   c. Try API
   d. Return empty {}
3. Return cached result
```

**Used by:**
- `UnifiedModelOperations.listAvailableModels()`
- `ModelsDev.listModels()`
- `ModelsDev.getModel()`
- `ModelsDev.getProvider()`

#### `ModelsDev.refresh()`
**Location:** `src/models/models-dev.ts:214`

**Signature:**
```typescript
async function refresh(): Promise<void>
```

**Purpose:** Force refresh from API and update cache

**Execution Flow:**
```
1. Fetch from API (10s timeout)
2. Create cache directory if needed
3. Write JSON to cache file
4. Reset lazy loader (clears in-memory cache)
```

**Used by:**
- Background refresh timer (every 60 minutes)
- Manual refresh commands (if exposed to UI)

**Throws:**
- Network errors
- File system errors
- Validation errors

#### `ModelsDev.listModels()`
**Location:** `src/models/models-dev.ts:225`

**Signature:**
```typescript
async function listModels(): Promise<Array<{
  providerID: string;
  model: Model & { id: string }
}>>
```

**Purpose:** Get flattened list of all models

**Execution Flow:**
```
1. Call ModelsDev.get()
2. Iterate providers
3. Iterate models within each provider
4. Return flat array with providerID attached
```

**Used by:**
- `UnifiedModelOperations.listAvailableModels()`
- UI model selection dialogs

#### `ModelsDev.getModel(providerID, modelID)`
**Location:** `src/models/models-dev.ts:244`

**Signature:**
```typescript
async function getModel(
  providerID: string,
  modelID: string
): Promise<Model | undefined>
```

**Purpose:** Get specific model by coordinates

**Execution Flow:**
```
1. Call ModelsDev.get()
2. Lookup provider by ID
3. Lookup model within provider
4. Return model or undefined
```

**Used by:**
- Model validation
- Model details lookup
- Testing

#### `ModelsDev.getProvider(providerID)`
**Location:** `src/models/models-dev.ts:254`

**Signature:**
```typescript
async function getProvider(
  providerID: string
): Promise<Provider | undefined>
```

**Purpose:** Get provider metadata and all its models

**Execution Flow:**
```
1. Call ModelsDev.get()
2. Lookup provider by ID
3. Return provider or undefined
```

**Used by:**
- Provider details lookup
- Environment variable discovery
- NPM package resolution

### Unified Operations API

#### `UnifiedModelOperations.listAvailableModels()`
**Location:** `src/models/model-operations.ts:89`

**Signature:**
```typescript
async listAvailableModels(): Promise<Model[]>
```

**Purpose:** List all models in internal format

**Execution Flow:**
```
1. Call ModelsDev.get()
2. Iterate providers and models
3. Transform each model with fromModelsDevModel()
4. Return array of internal Model format
```

**Used by:**
- UI model selection
- Model capability queries
- Agent initialization

#### `UnifiedModelOperations.setModel(model)`
**Location:** `src/models/model-operations.ts:100`

**Signature:**
```typescript
async setModel(model: string): Promise<SetModelResult>
```

**Purpose:** Set the active model for the agent

**Execution Flow:**
```
1. Validate format (if contains '/')
2. Resolve alias (if applicable)
3. Check agent type:
   - Copilot: set pendingModel, return requiresNewSession=true
   - Others: call sdkSetModel, set currentModel
4. Return success result
```

**Used by:**
- Model change commands
- Workflow initialization
- User model selection

**Throws:**
- Format validation errors: `"Invalid model format: 'X'. Expected 'providerID/modelID' format."`
- SDK errors (from underlying SDK)

#### `UnifiedModelOperations.getCurrentModel()`
**Location:** `src/models/model-operations.ts:135`

**Signature:**
```typescript
async getCurrentModel(): Promise<string | undefined>
```

**Purpose:** Get the currently active model

**Execution Flow:**
```
1. Return currentModel field
```

**Used by:**
- Status displays
- Debugging
- Logging

#### `UnifiedModelOperations.resolveAlias(alias)`
**Location:** `src/models/model-operations.ts:139`

**Signature:**
```typescript
resolveAlias(alias: string): string | undefined
```

**Purpose:** Resolve model alias to full identifier

**Execution Flow:**
```
1. Check agent type === 'claude'
2. Lookup alias in CLAUDE_ALIASES
3. Return resolved alias or undefined
```

**Used by:**
- `setModel()` internal resolution
- UI alias display
- Command parsing

**Claude Aliases:**
- `sonnet` → `sonnet`
- `opus` → `opus`
- `haiku` → `haiku`
- `default` → `sonnet`

## Background Processes

### Periodic Refresh Timer
**Location:** `src/models/models-dev.ts:265`

**Function:** `startModelsDevRefresh()`

**Execution Flow:**
```
1. Initial refresh: ModelsDev.refresh().catch(() => {})
2. Set interval (60,000 ms = 60 minutes)
3. Periodic refresh: ModelsDev.refresh().catch(() => {})
```

**Characteristics:**
- Non-blocking
- Silent failure handling
- Runs in background
- Started at application startup
- No explicit shutdown (process-lifetime)

**Interval:** 60 minutes (same as OpenCode)

## Event Handlers

No explicit event handlers in the model system. All operations are synchronous or promise-based.

## Initialization Sequence

### Application Startup
```
1. Application starts (atomic CLI)
2. Import model module: import { startModelsDevRefresh } from './models'
3. Call startModelsDevRefresh()
   a. Trigger initial refresh (async, non-blocking)
   b. Set up 60-minute interval timer
4. Continue with rest of application initialization
5. First access to ModelsDev.get() triggers lazy load:
   a. Check cache file
   b. Fallback to snapshot
   c. Fallback to API (if enabled)
   d. Fallback to empty database
```

**Timing:**
- Startup: Immediate, non-blocking
- First data access: ~1-500ms (depending on source)
- Background refresh: Every 60 minutes

### Agent Session Startup
```
1. Create UnifiedModelOperations instance
   new UnifiedModelOperations(agentType, sdkSetModel)
2. (Optional) Call listAvailableModels() for UI
3. (Optional) Call setModel() for explicit model selection
4. Agent session begins with configured model
```

## Command-Line Interface Entry Points

### Script Entry Points

#### Generate Models Snapshot
**File:** `scripts/generate-models-snapshot.ts`
**Command:** `pnpm run update-models-snapshot`

**Execution Flow:**
```
1. Fetch from https://models.dev/api.json
   - Headers: { 'User-Agent': 'atomic-cli' }
   - Timeout: 30 seconds
2. Parse JSON response
3. Generate TypeScript source file
4. Write to src/models/models-snapshot.ts
5. Exit
```

**Output:**
```typescript
/**
 * Bundled snapshot of models.dev data.
 * Generated at: 2026-02-04T12:34:56.789Z
 */
import type { ModelsDev } from './models-dev';
const snapshot: ModelsDev.Database = { /* data */ };
export default snapshot;
```

**Used by:** Developers to update bundled snapshot

## Test Entry Points

### Test Files
- `tests/models/models-dev.test.ts`
- `src/models/__tests__/model-operations.test.ts`
- `src/models/__tests__/model-transform.test.ts`

**Test Framework:** Bun Test

**Entry Point:** `bun test`

**Test Initialization:**
```typescript
beforeEach(() => {
  ModelsDev.Data.reset(); // Clear cache before each test
});
```

## Module Exports

### Public API (`src/models/index.ts`)
```typescript
export * from './models-dev';          // ModelsDev namespace
export * from './model-transform';     // Model interface, transformers
export * from './model-operations';    // UnifiedModelOperations
export { startModelsDevRefresh } from './models-dev';
```

### Internal Exports

#### `models-dev.ts`
```typescript
export namespace ModelsDev {
  // Schemas
  export const Model: z.ZodType
  export const Provider: z.ZodType
  export const Cost: z.ZodType
  export const Limit: z.ZodType
  export const Modalities: z.ZodType
  export const Interleaved: z.ZodType
  export const Status: z.ZodType

  // Types
  export type Model = z.infer<typeof Model>
  export type Provider = z.infer<typeof Provider>
  export type Database = Record<string, Provider>
  export type DataSource = 'cache' | 'snapshot' | 'api' | 'offline'

  // Functions
  export const Data: LazyLoader<Database>
  export async function get(): Promise<Database>
  export async function refresh(): Promise<void>
  export async function listModels(): Promise<...>
  export async function getModel(...): Promise<...>
  export async function getProvider(...): Promise<...>
  export function getDataSource(): DataSource
}

export const CACHE_PATH: string
export const REFRESH_INTERVAL: number
export function url(): string
export function startModelsDevRefresh(): void
```

#### `model-transform.ts`
```typescript
export interface Model {
  id: string;
  providerID: string;
  modelID: string;
  name: string;
  family?: string;
  api?: string;
  status: 'alpha' | 'beta' | 'deprecated' | 'active';
  capabilities: { ... };
  limits: { ... };
  cost?: { ... };
  modalities?: { ... };
  options: Record<string, unknown>;
  headers?: Record<string, string>;
}

export function fromModelsDevModel(...): Model
export function fromModelsDevProvider(...): Model[]
```

#### `model-operations.ts`
```typescript
export const CLAUDE_ALIASES: Record<string, string>
export type AgentType = 'claude' | 'opencode' | 'copilot'

export interface SetModelResult {
  success: boolean;
  requiresNewSession?: boolean;
}

export interface ModelOperations {
  listAvailableModels(): Promise<Model[]>
  setModel(model: string): Promise<SetModelResult>
  getCurrentModel(): Promise<string | undefined>
  resolveAlias(alias: string): string | undefined
}

export class UnifiedModelOperations implements ModelOperations {
  constructor(agentType: AgentType, sdkSetModel?: ...)
  async listAvailableModels(): Promise<Model[]>
  async setModel(model: string): Promise<SetModelResult>
  async getCurrentModel(): Promise<string | undefined>
  resolveAlias(alias: string): string | undefined
  getPendingModel(): string | undefined
}
```

## Import Patterns

### Consumer Usage
```typescript
// Import from public API
import {
  ModelsDev,
  UnifiedModelOperations,
  startModelsDevRefresh,
  type Model,
  type AgentType
} from '@bastani/atomic/models';

// Or relative import
import { ModelsDev } from './models';
```

### Internal Usage
```typescript
// Within model system
import { ModelsDev } from './models-dev';
import { fromModelsDevModel } from './model-transform';
import { lazy } from '../util/lazy';
```

## Execution Context

### Process Type
- **Main process:** All operations run in main Node.js/Bun process
- **No workers:** No web workers or child processes
- **Single-threaded:** JavaScript event loop

### Async Pattern
- **All I/O:** Async/await pattern
- **No blocking:** Non-blocking file system and network operations
- **Error handling:** Try-catch with fallback chain

### Lifecycle
- **Startup:** Background refresh initiated
- **Runtime:** Lazy-loaded on first access
- **Shutdown:** No explicit cleanup (process terminates)
- **Persistence:** Cache file persists across restarts

## Key Takeaways

1. **Lazy Initialization:** Data only loaded on first access
2. **Background Refresh:** 60-minute timer keeps cache fresh
3. **Non-Blocking:** All operations async, errors caught
4. **Multiple Entry Points:** CLI, API, tests all use same core
5. **Clear Exports:** Public API surface well-defined in index.ts
6. **Testability:** Reset capability enables clean test isolation
