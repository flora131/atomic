# Architecture - Model Config Loading from models.dev

## System Overview

Atomic implements a unified model configuration system that loads model metadata from models.dev, providing a single source of truth for model capabilities across different AI agent types (Claude, OpenCode, Copilot).

## Purpose

- Provide centralized model metadata (capabilities, limits, costs, modalities)
- Support offline-first architecture with multiple fallback layers
- Enable unified model operations across heterogeneous agent SDKs
- Allow environment-based configuration for testing and customization

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│  (Commands, UI, Graph Nodes)                                 │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Model Operations Layer                          │
│  UnifiedModelOperations (src/models/model-operations.ts)     │
│  - listAvailableModels()                                     │
│  - setModel(model: string)                                   │
│  - getCurrentModel()                                         │
│  - resolveAlias(alias: string)                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│               Data Access Layer                              │
│  ModelsDev Namespace (src/models/models-dev.ts)             │
│  - get(): Database                                           │
│  - refresh(): void                                           │
│  - listModels()                                              │
│  - getModel(providerID, modelID)                            │
│  - getProvider(providerID)                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Data Loading Strategy                           │
│  Lazy-loaded with fallback chain:                           │
│  1. File cache (~/.atomic/cache/models.json)                │
│  2. Bundled snapshot (models-snapshot.ts)                   │
│  3. API fetch (https://models.dev/api.json)                 │
│  4. Empty database (offline fallback)                        │
└─────────────────────────────────────────────────────────────┘
```

## Key Architectural Patterns

### 1. **Lazy Loading with Fallback Chain**
- Data is loaded on first access, not at initialization
- Multiple fallback sources ensure availability
- Explicit data source tracking for debugging

### 2. **Namespace Organization**
- `ModelsDev` namespace encapsulates all models.dev interactions
- Clean separation between data schemas (Zod) and operations
- Type safety through Zod schema validation

### 3. **Transformation Layer**
- models.dev format → Internal Model format transformation
- Isolates external API schema changes from internal usage
- Located in `src/models/model-transform.ts`

### 4. **Agent Type Abstraction**
- `UnifiedModelOperations` provides consistent interface across agent types
- Handles agent-specific quirks (e.g., Claude aliases, Copilot session requirements)
- Dependency injection for SDK-specific model setters

## Component Boundaries and Responsibilities

### `src/models/models-dev.ts`
**Responsibility:** Data access layer for models.dev metadata
- Schema definitions (Zod)
- Lazy data loading with fallback chain
- Cache management (read/write)
- Data source tracking
- Query operations (get, list, filter)

### `src/models/model-transform.ts`
**Responsibility:** Format transformation
- Convert models.dev format → internal Model interface
- Normalize field names (snake_case → camelCase)
- Add computed fields (full id format: `providerID/modelID`)
- Default value handling (status defaults to 'active')

### `src/models/model-operations.ts`
**Responsibility:** Unified model operations across agent types
- Agent-specific behavior (aliases, session requirements)
- Model validation and setting
- Current model tracking
- Pending model tracking (for Copilot)

### `scripts/generate-models-snapshot.ts`
**Responsibility:** Build-time snapshot generation
- Fetch fresh data from models.dev API
- Generate TypeScript source file
- Provide offline fallback data

## Data Flow

### Loading Flow (First Access)
```
1. Application calls ModelsDev.get()
2. Lazy loader checks: cached = false?
3. Try file cache: fs.readFile(CACHE_PATH)
   ✓ Success → return data, set source='cache'
   ✗ Fail → continue
4. Try bundled snapshot: import('./models-snapshot')
   ✓ Success → return data, set source='snapshot'
   ✗ Fail → continue
5. Try API fetch: fetch('https://models.dev/api.json')
   ✓ Success → return data, set source='api'
   ✗ Fail → continue
6. Return empty database, set source='offline'
```

### Refresh Flow (Background Update)
```
1. startModelsDevRefresh() called at app startup
2. Initial refresh: ModelsDev.refresh()
   a. fetchFromApi() with timeout
   b. Write to CACHE_PATH
   c. Reset lazy loader (clears cache)
3. Set interval timer (60 minutes)
4. Repeat refresh on timer
5. Errors silently caught (non-blocking)
```

### Model Selection Flow
```
1. User/agent calls setModel('anthropic/claude-sonnet-4')
2. UnifiedModelOperations validates format
3. Resolve alias if applicable (Claude only)
4. Check agent-specific behavior:
   - Copilot: store as pendingModel, return requiresNewSession
   - Others: call SDK setModel, store as currentModel
5. SDK validates model exists and is accessible
```

## External Dependencies and Integrations

### External Services
- **models.dev API** (`https://models.dev/api.json`)
  - Public API, no authentication
  - Provides comprehensive model metadata
  - Updated regularly with new models
  - 10-second timeout for fetch requests

### Agent SDKs
- **Claude SDK** (`@anthropic-ai/claude-agent-sdk`)
  - Supports model aliases (sonnet, opus, haiku)
  - SDK handles alias resolution to latest versions

- **OpenCode SDK** (`@opencode-ai/sdk`)
  - Requires `providerID/modelID` format
  - No alias support

- **Copilot SDK** (`@github/copilot-sdk`)
  - Model changes require new session
  - Stored as pending until session restart

### File System
- **Cache location:** `~/.atomic/cache/models.json`
  - Override: `ATOMIC_MODELS_PATH` env var
  - Auto-created on first refresh
  - JSON format, human-readable

### Environment Variables
- `ATOMIC_MODELS_PATH`: Override cache file location
- `ATOMIC_MODELS_URL`: Override models.dev URL (for testing)
- `ATOMIC_DISABLE_MODELS_FETCH`: Disable API fetching

## Design Decisions

### Why Lazy Loading?
- Avoids startup penalty if models data not needed
- Allows app to function without network access
- Supports testing without real API calls

### Why Multiple Fallbacks?
- **Cache**: Fast, offline-capable, survives restarts
- **Snapshot**: Zero-config fallback, bundled in binary
- **API**: Always fresh data, handles new models
- **Empty**: Graceful degradation when all else fails

### Why Periodic Refresh?
- Keeps cache fresh without user intervention
- 60-minute interval matches OpenCode behavior
- Silent failures prevent user interruption
- Background operation doesn't block UI

### Why Transform Layer?
- Decouples external schema from internal usage
- Allows API changes without breaking internal code
- Normalizes naming conventions (snake_case → camelCase)
- Adds computed fields without modifying source data

## Error Handling Strategy

### Non-Blocking Failures
- All refresh operations catch and suppress errors
- No crashes from network issues
- Graceful fallback to stale/empty data

### Validation Errors
- Zod schemas validate API responses
- Invalid data rejected, next fallback attempted
- Type safety at runtime

### User-Facing Errors
- Invalid model format: immediate validation, clear error message
- SDK errors (invalid model): surfaced directly to user
- Format: `"Invalid model format: 'X'. Expected 'providerID/modelID' format."`

## Future Extensibility

The architecture supports future enhancements:
- **Custom model providers**: Add to snapshot or cache
- **Local model servers**: Override URL with env var
- **Model filtering**: Query operations support all use cases
- **Cost tracking**: Schema includes per-token costs
- **Capability queries**: Rich model metadata available
