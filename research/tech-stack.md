# Tech Stack - Model Config Loading System

## Programming Language and Runtime

### TypeScript 5.9.3
- **Purpose:** Primary language for type-safe development
- **Configuration:** `tsconfig.json` with strict mode
- **Features used:**
  - Namespaces (`ModelsDev` namespace)
  - Type inference
  - Union types (`DataSource = 'cache' | 'snapshot' | 'api' | 'offline'`)
  - Generic functions (`lazy<T>`)
  - Async/await
  - Optional chaining
  - Nullish coalescing

### Bun (Runtime)
- **Purpose:** JavaScript runtime and package manager
- **Version:** Latest (specified in bun-types dependency)
- **Features used:**
  - `bun run` for script execution
  - `bun test` for test runner
  - `bun build --compile` for binary compilation
  - Native ESM support
  - Fast module resolution

## Core Dependencies

### Zod (Version: Not explicitly in package.json, likely transitive)
- **Purpose:** Runtime schema validation and type inference
- **Usage in model system:**
  - Define `ModelsDev.Model` schema
  - Define `ModelsDev.Provider` schema
  - Define `ModelsDev.Cost`, `Limit`, `Modalities` schemas
  - Runtime validation of API responses
  - Type inference for TypeScript types
- **Key patterns:**
  - `z.object()` for structured data
  - `z.enum()` for literal unions
  - `z.union()` for variant types
  - `z.optional()` for optional fields
  - `z.record()` for dynamic key-value pairs
  - `.strict()` for exact object matching

## Agent SDK Dependencies

### @anthropic-ai/claude-agent-sdk ^0.2.19
- **Purpose:** Claude AI agent integration
- **Model-related features:**
  - Model alias support (sonnet, opus, haiku)
  - SDK handles alias → latest version resolution
- **Integration point:** `UnifiedModelOperations` for Claude agent type

### @opencode-ai/sdk ^1.1.48
- **Purpose:** OpenCode AI agent integration
- **Model-related features:**
  - Requires `providerID/modelID` format
  - No alias support
- **Integration point:** `UnifiedModelOperations` for OpenCode agent type

### @github/copilot-sdk ^0.1.20
- **Purpose:** GitHub Copilot CLI integration
- **Model-related features:**
  - Model changes require new session
  - Pending model handling
- **Integration point:** `UnifiedModelOperations` for Copilot agent type

## Build Tools

### TypeScript Compiler (tsc)
- **Version:** 5.9.3
- **Usage:** Type checking only (`--noEmit`)
- **Command:** `pnpm run typecheck`
- **Configuration:** `tsconfig.json`

### Oxlint
- **Version:** ^1.41.0
- **Purpose:** Fast linter (Rust-based)
- **Configuration:** `oxlint.json`
- **Commands:**
  - `pnpm lint` - Check for issues
  - `pnpm lint:fix` - Auto-fix issues

### Bun Build
- **Purpose:** Bundle and compile to native executable
- **Command:** `bun build src/cli.ts --compile --outfile atomic`
- **Output:** Single executable binary

## Testing Framework

### Bun Test (Built-in)
- **Purpose:** Fast test runner with native Bun integration
- **Command:** `bun test`
- **Features used:**
  - `test()` - Define test cases
  - `describe()` - Group tests
  - `expect()` - Assertions
  - `beforeEach()`, `afterEach()` - Setup/teardown
  - `mock()` - Function mocking
  - `spyOn()` - Spy on methods

### Test Files
- `tests/models/models-dev.test.ts` - Integration tests
- `src/models/__tests__/model-operations.test.ts` - Unit tests
- `src/models/__tests__/model-transform.test.ts` - Unit tests

## Development Dependencies

### @types/bun ^1.3.6
- **Purpose:** TypeScript type definitions for Bun APIs
- **Usage:**
  - File system APIs (`fs/promises`)
  - Test framework types
  - `Bun.which()` for command resolution

### @types/react ^19.2.10
- **Purpose:** TypeScript types for React (UI components)
- **Relevance:** Indirect (UI layer may use model operations)

## Node.js Built-in Modules (via Bun)

### fs/promises
- **Purpose:** Async file system operations
- **Usage:**
  - Read cache file: `fs.readFile(CACHE_PATH)`
  - Write cache file: `fs.writeFile(CACHE_PATH, data)`
  - Create directories: `fs.mkdir(dirname, { recursive: true })`
  - Delete cache: `fs.unlink(CACHE_PATH)`

### path
- **Purpose:** Path manipulation
- **Usage:**
  - Join paths: `path.join(process.env.HOME, '.atomic', 'cache', 'models.json')`
  - Get directory: `path.dirname(CACHE_PATH)`
  - Import meta dirname: `import.meta.dirname`

### os
- **Purpose:** Operating system utilities
- **Usage:**
  - Temporary directory: `tmpdir()` (in tests)

## Network and HTTP

### fetch (Web API, native in Bun)
- **Purpose:** HTTP requests to models.dev API
- **Usage:**
  ```typescript
  fetch(url(), {
    headers: { 'User-Agent': 'atomic-cli' },
    signal: AbortSignal.timeout(10000)
  })
  ```
- **Features used:**
  - `AbortSignal.timeout()` for request timeouts
  - Custom headers
  - JSON response parsing

## Patterns and Utilities

### Lazy Loading Pattern
- **Location:** `src/util/lazy.ts`
- **Purpose:** Defer expensive computations until needed
- **API:**
  ```typescript
  const lazyValue = lazy(() => expensiveComputation());
  const value = lazyValue(); // Computed once
  lazyValue.reset(); // Clear cache
  ```
- **Usage:** `ModelsDev.Data` lazy loader

### Singleton Pattern
- **Implementation:** Lazy loader with module-level state
- **Benefit:** Single instance of models database in memory
- **Reset capability:** `ModelsDev.Data.reset()` for testing

### Namespace Pattern
- **TypeScript feature:** `namespace ModelsDev`
- **Purpose:** Group related types and functions
- **Exports:** Types, schemas, functions under single namespace

## Data Formats

### JSON
- **Purpose:** Cache file format, API response format
- **Usage:**
  - models.json cache
  - API response from models.dev
- **Parsing:** `JSON.parse()`, `JSON.stringify()`
- **Serialization:** Pretty-printed with 2-space indent

### TypeScript Source (.ts)
- **Purpose:** Bundled snapshot format
- **Generation:** `scripts/generate-models-snapshot.ts`
- **Format:**
  ```typescript
  const snapshot: ModelsDev.Database = { /* data */ };
  export default snapshot;
  ```

## Environment Variables

### Model System Environment Variables

| Variable | Purpose | Default | Type |
|----------|---------|---------|------|
| `ATOMIC_MODELS_PATH` | Override cache file location | `~/.atomic/cache/models.json` | string (file path) |
| `ATOMIC_MODELS_URL` | Override models.dev API URL | `https://models.dev` | string (URL) |
| `ATOMIC_DISABLE_MODELS_FETCH` | Disable API fetching | (unset) | boolean (truthy check) |
| `HOME` | User home directory (Unix) | (required) | string (directory path) |

### Access Methods
- **TypeScript:** `process.env.VARIABLE_NAME`
- **Bash:** `export VARIABLE_NAME=value`
- **PowerShell:** `$env:VARIABLE_NAME = "value"`

## External Services

### models.dev API
- **URL:** `https://models.dev/api.json`
- **Protocol:** HTTPS GET
- **Authentication:** None (public API)
- **Rate limiting:** Unknown (handled gracefully)
- **Response format:** JSON
- **Timeout:** 10 seconds (configurable)
- **User-Agent:** `atomic-cli`

### API Response Schema
```typescript
{
  [providerID: string]: {
    id: string;
    name: string;
    api?: string;
    env: string[];
    npm?: string;
    models: {
      [modelID: string]: {
        id: string;
        name: string;
        family?: string;
        release_date: string;
        attachment: boolean;
        reasoning: boolean;
        temperature: boolean;
        tool_call: boolean;
        interleaved?: boolean | { field: string };
        cost: { input: number; output: number; ... };
        limit: { context: number; input: number; output: number };
        modalities: { input: string[]; output: string[] };
        experimental?: boolean;
        status?: 'alpha' | 'beta' | 'deprecated';
        options: Record<string, any>;
        headers?: Record<string, string>;
        provider?: { npm: string };
        variants?: Record<string, Record<string, any>>;
      }
    }
  }
}
```

## Version Control Integration

### Git (implicitly used)
- **Cache location:** `~/.atomic/cache/` (NOT version controlled)
- **Snapshot:** `src/models/models-snapshot.ts` (version controlled)
- **Purpose:** Snapshot provides fallback when cache unavailable

## Performance Characteristics

### Startup Time
- **Cold start (no cache):** ~10-30ms (snapshot import)
- **Warm start (cached):** ~1-5ms (file read)
- **With API fetch:** ~100-500ms (network latency)

### Memory Usage
- **Database size:** ~50-200KB (estimated, depends on model count)
- **Runtime overhead:** Minimal (lazy-loaded)
- **Cached in memory:** Yes (singleton pattern)

### Network Usage
- **Initial fetch:** ~50-200KB (one-time)
- **Periodic refresh:** Every 60 minutes
- **Bandwidth:** Negligible for typical usage

## Error Handling

### Network Errors
- **Fetch timeout:** 10 seconds
- **Failed responses:** Caught and ignored
- **Fallback:** Next source in chain

### File System Errors
- **Missing cache:** Ignored, fallback to snapshot
- **Permission denied:** Ignored, fallback to next source
- **Invalid JSON:** Caught, fallback to next source

### Validation Errors
- **Zod validation failure:** Reject data, try next source
- **Type mismatches:** Runtime error with clear message

## Security Considerations

### API Security
- **HTTPS:** All API requests use HTTPS
- **No authentication:** Public API, no credentials needed
- **Timeout:** Prevents hung requests
- **User-Agent:** Identifies client as `atomic-cli`

### Cache Security
- **File permissions:** Standard user-only (644)
- **No sensitive data:** Only public model metadata
- **User-controlled:** Cache location configurable

### Injection Prevention
- **No eval:** No dynamic code execution
- **Zod validation:** All external data validated
- **Type safety:** TypeScript prevents type confusion

## Compatibility

### Platform Support
- **macOS:** Full support
- **Linux:** Full support
- **Windows:** Full support (via Bun)

### Node.js API Compatibility
- **Bun:** Native compatibility layer
- **ESM:** All modules use ES modules
- **CommonJS:** Not used

## Future Technology Considerations

### Potential Upgrades
- **GraphQL endpoint:** If models.dev adds GraphQL support
- **WebSocket:** For real-time model availability updates
- **Local LLM support:** Custom provider definitions
- **Model marketplace:** User-contributed model configs

### Extensibility Points
- **Custom providers:** Add to snapshot or cache
- **Plugin system:** Dynamic model provider registration
- **Cost tracking:** Use existing cost fields
- **Usage analytics:** Leverage model metadata
