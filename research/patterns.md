# Coding Patterns and Conventions - Model Config Loading

## File Naming Conventions

### Source Files
- **Pattern:** `kebab-case.ts`
- **Examples:**
  - `models-dev.ts`
  - `model-transform.ts`
  - `model-operations.ts`
  - `generate-models-snapshot.ts`

### Test Files
- **Pattern:** `*.test.ts`
- **Location:** Co-located in `__tests__/` subdirectories or top-level `tests/` directory
- **Examples:**
  - `src/models/__tests__/model-operations.test.ts`
  - `tests/models/models-dev.test.ts`

### Generated Files
- **Pattern:** `*-snapshot.ts`
- **Indicator:** Header comment indicates generated content
- **Example:** `models-snapshot.ts`

## Code Organization Patterns

### Namespace Pattern
**Purpose:** Group related functionality under a single namespace

**Example:**
```typescript
export namespace ModelsDev {
  // Schemas
  export const Model = z.object({ ... });
  export const Provider = z.object({ ... });

  // Types
  export type Model = z.infer<typeof Model>;
  export type Provider = z.infer<typeof Provider>;
  export type Database = Record<string, Provider>;

  // Lazy loader
  export const Data = lazy(async () => { ... });

  // Functions
  export async function get(): Promise<Database> { ... }
  export async function refresh(): Promise<void> { ... }
}
```

**Location:** `src/models/models-dev.ts`

**Benefits:**
- Logical grouping of related code
- Clear module boundaries
- Prevents naming conflicts
- Self-documenting structure

### Lazy Initialization Pattern
**Purpose:** Defer expensive operations until needed

**Implementation:**
```typescript
import { lazy } from '../util/lazy';

export const Data = lazy(async (): Promise<Database> => {
  // Try cache
  try {
    const content = await fs.readFile(CACHE_PATH, 'utf-8');
    return JSON.parse(content) as Database;
  } catch {}

  // Try snapshot
  try {
    const snapshot = await import('./models-snapshot');
    return snapshot.default as Database;
  } catch {}

  // Try API
  // ...

  return {} as Database;
});

// Usage
const data = await Data(); // Computed once, cached
Data.reset(); // Clear cache for testing
```

**Location:** `src/models/models-dev.ts:143`

**Characteristics:**
- Computed on first access
- Cached for subsequent calls
- Resettable for testing
- Async-safe

### Fallback Chain Pattern
**Purpose:** Try multiple data sources until one succeeds

**Implementation:**
```typescript
// 1. Try file cache
try {
  const content = await fs.readFile(CACHE_PATH, 'utf-8');
  if (isValid(content)) return parseCache(content);
} catch {}

// 2. Try bundled snapshot
try {
  const snapshot = await import('./models-snapshot');
  if (isValid(snapshot)) return snapshot.default;
} catch {}

// 3. Try API fetch
if (!disabled) {
  try {
    const response = await fetch(url());
    if (response.ok) return await response.json();
  } catch {}
}

// 4. Return empty (graceful degradation)
return {};
```

**Location:** `src/models/models-dev.ts:143-178`

**Characteristics:**
- Each source tried in sequence
- Errors silently caught
- Graceful degradation to empty data
- No user interruption

### Transformation Layer Pattern
**Purpose:** Isolate external schema from internal representation

**Implementation:**
```typescript
// External schema (models.dev)
interface ModelsDevModel {
  tool_call: boolean;
  cache_read?: number;
  // ... snake_case fields
}

// Internal schema
interface Model {
  toolCall: boolean;
  cacheRead?: number;
  // ... camelCase fields
}

// Transformer
export function fromModelsDevModel(
  providerID: string,
  modelID: string,
  model: ModelsDev.Model,
  providerApi?: string
): Model {
  return {
    id: `${providerID}/${modelID}`, // Computed
    providerID,
    modelID,
    name: model.name,
    toolCall: model.tool_call,      // Rename
    cacheRead: model.cost?.cache_read, // Nested + rename
    status: model.status ?? 'active',  // Default
    // ...
  };
}
```

**Location:** `src/models/model-transform.ts`

**Benefits:**
- Decouples external API from internal code
- Allows API changes without breaking internal usage
- Normalizes naming conventions
- Adds computed fields

### Dependency Injection Pattern
**Purpose:** Allow runtime configuration of dependencies

**Implementation:**
```typescript
export class UnifiedModelOperations {
  constructor(
    private agentType: AgentType,
    private sdkSetModel?: (model: string) => Promise<void>
  ) {}

  async setModel(model: string): Promise<SetModelResult> {
    // Use injected SDK function if available
    if (this.sdkSetModel) {
      await this.sdkSetModel(model);
    }
    // ...
  }
}

// Usage with dependency
const ops = new UnifiedModelOperations('claude', claudeSdk.setModel);

// Usage without dependency (testing)
const ops = new UnifiedModelOperations('claude');
```

**Location:** `src/models/model-operations.ts:84`

**Benefits:**
- Testability (mock SDK easily)
- Flexibility (works with/without SDK)
- Loose coupling

### Schema Validation Pattern
**Purpose:** Runtime type safety with Zod

**Implementation:**
```typescript
import { z } from 'zod';

// Define schema
export const Cost = z.object({
  input: z.number(),
  output: z.number(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
  context_over_200k: z.number().optional()
});

// Infer TypeScript type from schema
export type Cost = z.infer<typeof Cost>;

// Runtime validation
const validated = Cost.parse(unknownData); // Throws if invalid
```

**Location:** `src/models/models-dev.ts:46-52`

**Benefits:**
- Runtime type safety
- Self-documenting
- Validation and types from single source
- Clear error messages

## Error Handling Patterns

### Silent Failure with Fallback
**Pattern:** Catch and ignore errors, proceed to next option

**Implementation:**
```typescript
try {
  return await primarySource();
} catch {}

try {
  return await secondarySource();
} catch {}

return defaultValue;
```

**Location:** All data loading paths in `models-dev.ts`

**When to use:**
- Non-critical operations
- Multiple fallback options available
- User experience should not be interrupted

### Explicit Validation Errors
**Pattern:** Validate input and throw clear error messages

**Implementation:**
```typescript
if (model.includes('/')) {
  const parts = model.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid model format: '${model}'. Expected 'providerID/modelID' format (e.g., 'anthropic/claude-sonnet-4').`
    );
  }
}
```

**Location:** `src/models/model-operations.ts:102-109`

**When to use:**
- User input validation
- Immediate feedback required
- Recoverable errors

### SDK Error Surfacing
**Pattern:** Let SDK errors propagate with context

**Implementation:**
```typescript
// SDK handles actual model validation and will throw with clear error if invalid
if (this.sdkSetModel) {
  await this.sdkSetModel(resolvedModel); // May throw
}
```

**Location:** `src/models/model-operations.ts:127-129`

**When to use:**
- SDK provides better error messages
- Error context already clear
- Don't want to swallow important errors

## Logging Conventions

### No Explicit Logging
The model system uses **silent error handling** and does not include console logs.

**Rationale:**
- Background operations should not spam console
- Errors are handled via fallback chain
- User-facing errors thrown explicitly
- Data source tracking available via `getDataSource()`

**Debug Approach:**
```typescript
// For debugging, check data source
const source = ModelsDev.getDataSource();
console.log(`Models loaded from: ${source}`); // 'cache' | 'snapshot' | 'api' | 'offline'
```

## API Design Patterns

### Async-First API
**Pattern:** All I/O operations are async

**Implementation:**
```typescript
// All public methods return Promise
export async function get(): Promise<Database>
export async function refresh(): Promise<void>
export async function listModels(): Promise<...>
export async function getModel(...): Promise<...>
```

**Benefits:**
- Non-blocking I/O
- Consistent API surface
- Composable with async/await

### Optional Parameters with Defaults
**Pattern:** Environment variables provide defaults

**Implementation:**
```typescript
export const CACHE_PATH: string =
  process.env.ATOMIC_MODELS_PATH ??
  path.join(process.env.HOME || '', '.atomic', 'cache', 'models.json');

export function url(): string {
  return process.env.ATOMIC_MODELS_URL ?? 'https://models.dev';
}
```

**Location:** `src/models/models-dev.ts:7-16`

**Benefits:**
- Zero-config defaults
- Environment-based overrides
- Testability

### Fluent Result Types
**Pattern:** Return structured results instead of throwing

**Implementation:**
```typescript
export interface SetModelResult {
  success: boolean;
  requiresNewSession?: boolean; // Optional flag for specific cases
}

async setModel(model: string): Promise<SetModelResult> {
  // ...
  if (this.agentType === 'copilot') {
    return { success: true, requiresNewSession: true };
  }
  return { success: true };
}
```

**Location:** `src/models/model-operations.ts:27-31`

**Benefits:**
- Avoids exceptions for expected cases
- Provides additional context
- Easier to handle programmatically

## Naming Conventions

### Constants
**Pattern:** `SCREAMING_SNAKE_CASE`

**Examples:**
```typescript
export const CACHE_PATH: string
export const REFRESH_INTERVAL: number
export const CLAUDE_ALIASES: Record<string, string>
```

### Functions
**Pattern:** `camelCase` with verb prefix

**Examples:**
```typescript
get()
refresh()
listModels()
getModel()
getProvider()
setModel()
resolveAlias()
```

### Types and Interfaces
**Pattern:** `PascalCase`

**Examples:**
```typescript
interface Model
interface Provider
type Database
type AgentType
interface SetModelResult
```

### Private Fields
**Pattern:** `camelCase` with no prefix (TypeScript `private` keyword)

**Examples:**
```typescript
private agentType: AgentType
private currentModel?: string
private pendingModel?: string
```

## Import/Export Patterns

### Barrel Exports
**Pattern:** Re-export from index.ts for clean public API

**Implementation:**
```typescript
// src/models/index.ts
export * from './models-dev';
export * from './model-transform';
export * from './model-operations';
export { startModelsDevRefresh } from './models-dev';
```

**Benefits:**
- Clean import paths for consumers
- Centralized export management
- Hide internal implementation details

### Named Exports
**Pattern:** Always use named exports, never default exports (except generated snapshot)

**Implementation:**
```typescript
// ✓ Good
export function get(): Promise<Database>
export const CACHE_PATH: string

// ✗ Avoid (except for generated files)
export default something
```

**Exception:** `models-snapshot.ts` uses default export for generated data

### Type-Only Imports
**Pattern:** Import types separately when needed

**Implementation:**
```typescript
import type { Model, Provider } from './models-dev';
import { ModelsDev } from './models-dev';
```

**Benefits:**
- Clear distinction between types and runtime values
- Better tree-shaking

## Testing Patterns

### Test Isolation
**Pattern:** Reset shared state before each test

**Implementation:**
```typescript
import { ModelsDev } from '../../src/models/models-dev';

beforeEach(() => {
  ModelsDev.Data.reset(); // Clear lazy-loaded cache
});
```

**Location:** All test files

**Benefits:**
- Tests don't interfere with each other
- Predictable test behavior
- Easy to reason about test state

### Mock Global APIs
**Pattern:** Mock global `fetch` for API tests

**Implementation:**
```typescript
import { mock } from 'bun:test';

const originalFetch = globalThis.fetch;
globalThis.fetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve(mockData)
  } as Response)
) as unknown as typeof fetch;

try {
  // Test code
} finally {
  globalThis.fetch = originalFetch; // Restore
}
```

**Location:** `tests/models/models-dev.test.ts`

### Cache Backup/Restore
**Pattern:** Preserve user cache during tests

**Implementation:**
```typescript
let originalCacheContent: string | null = null;

beforeEach(async () => {
  try {
    originalCacheContent = await fs.readFile(CACHE_PATH, 'utf-8');
  } catch {
    originalCacheContent = null;
  }
});

afterEach(async () => {
  if (originalCacheContent !== null) {
    await fs.writeFile(CACHE_PATH, originalCacheContent);
  } else {
    await fs.unlink(CACHE_PATH).catch(() => {});
  }
});
```

**Location:** `tests/models/models-dev.test.ts`

## Documentation Patterns

### JSDoc Comments
**Pattern:** Document public APIs with JSDoc

**Implementation:**
```typescript
/**
 * Lazy loader for models.dev data.
 * Load order:
 *   1. File cache at CACHE_PATH
 *   2. Bundled snapshot (models-snapshot.ts)
 *   3. Fetch from API (if not disabled via ATOMIC_DISABLE_MODELS_FETCH)
 * Returns empty database if all sources fail.
 */
export const Data = lazy(async (): Promise<Database> => {
  // ...
});
```

**Location:** Throughout codebase

**Contents:**
- Brief description
- Parameter explanations
- Return value description
- Important behaviors
- Examples (when helpful)

### Inline Comments
**Pattern:** Explain non-obvious logic with inline comments

**Implementation:**
```typescript
// Copilot limitation: model changes require a new session
if (this.agentType === 'copilot') {
  this.pendingModel = resolvedModel;
  return { success: true, requiresNewSession: true };
}
```

**When to use:**
- Non-obvious behavior
- Workarounds for SDK limitations
- Complex logic
- Important assumptions

### Section Comments
**Pattern:** Use comment headers to separate logical sections

**Implementation:**
```typescript
// ============================================================================
// AGENT NODE
// ============================================================================

export interface AgentNodeConfig { ... }
export function agentNode() { ... }
```

**Location:** Large files with multiple concerns

## Type Safety Patterns

### Branded Types
**Pattern:** Use distinct types even when structurally identical

**Implementation:**
```typescript
export type NodeId = string; // Branded type for node identifiers
export type AgentType = 'claude' | 'opencode' | 'copilot'; // Literal union
```

**Benefits:**
- Self-documenting
- Prevents mixing incompatible values
- IDE autocomplete

### Strict Zod Schemas
**Pattern:** Use `.strict()` for exact object matching

**Implementation:**
```typescript
export const Interleaved = z.union([
  z.literal(true),
  z.object({
    field: z.enum(['reasoning_content', 'reasoning_details'])
  }).strict() // No extra properties allowed
]);
```

**Location:** `src/models/models-dev.ts:35-40`

**Benefits:**
- Catch unexpected fields
- Prevent silent data loss
- Clear API contract

## Key Takeaways

1. **Namespaces:** Group related functionality (ModelsDev namespace)
2. **Lazy Loading:** Defer expensive operations until needed
3. **Fallback Chains:** Multiple data sources for resilience
4. **Transformation Layer:** Isolate external schemas
5. **Dependency Injection:** Enable testability and flexibility
6. **Silent Failures:** Non-critical errors caught and ignored
7. **Explicit Validation:** User input validated with clear errors
8. **Async-First:** All I/O operations are async
9. **Named Exports:** Consistent export style (except generated files)
10. **Test Isolation:** Reset state, mock globals, preserve user data
