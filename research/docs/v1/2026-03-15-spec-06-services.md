---
date: 2026-03-15 18:32:54 UTC
researcher: Claude Opus 4.6
git_commit: d3f22e2b5bf791dcc57580e001ac279c85390fce
branch: lavaman131/feature/code-cleanup
repository: code-cleanup
topic: "Spec 06: Services - Config, telemetry, agent discovery, models"
tags: [spec, services, config, telemetry, agent-discovery, models, v2]
status: complete
last_updated: 2026-03-15
last_updated_by: Claude Opus 4.6
parent: 2026-03-15-atomic-v2-rebuild-spec-index.md
---

# Spec 06: Services

## Current State

### Config Service (`services/config/`, 3,722 lines)

Manages configuration for three agent CLIs, each with different config locations:

| Agent    | Global Config                                  | Local Config |
| -------- | ---------------------------------------------- | ------------ |
| Claude   | `~/.claude/`                                   | `.claude/`   |
| OpenCode | `~/.opencode/` or `$XDG_CONFIG_HOME/.opencode` | `.opencode/` |
| Copilot  | `~/.copilot/` or `$XDG_CONFIG_HOME/.copilot`   | `.github/`   |

The config service handles:
- Reading/writing agent configs
- Merging global + local configs
- Config validation
- Settings schema (JSON schema at `assets/settings.schema.json`)

### Telemetry Service (`services/telemetry/`, 2,018 lines)

- OpenTelemetry-based (Azure Monitor backend)
- Traces, metrics, and logs
- Anonymous telemetry

Dependencies:
- `@azure/monitor-opentelemetry`
- `@opentelemetry/api`
- `@opentelemetry/api-logs`

### Agent Discovery (`services/agent-discovery/`, 521 lines)

- `discovery.ts` - Detects installed coding agents
- `session.ts` - Session management for discovered agents
- `types.ts` - Discovery types

Also: `commands/catalog/` has separate discovery logic for agents and skills with its own discovery-paths files.

### Models Service (`services/models/`, 821 lines)

- `model-operations/` - Model CRUD operations
- Provider registry for model metadata

### System Service (`services/system/`, 1,269 lines)

System-level utilities.

### Terminal Service (`services/terminal/`, 181 lines)

Terminal interaction utilities.

### Issues Documented

1. **Config Complexity**: 3,722 lines for reading config files from 3 providers. Each provider has different config formats, merge behaviors, and validation rules.

2. **Duplicate Discovery**: Agent discovery logic exists in both `services/agent-discovery/` and `commands/catalog/agents/`, with separate `discovery-paths.ts` files.

3. **Telemetry Size**: 2,018 lines is substantial for telemetry. The Azure Monitor integration adds significant dependency weight.

4. **Model Service Coupling**: Model operations are coupled to specific provider APIs for model listing and switching.

---

## V2 Spec: Services

### 1. Unified Config

```typescript
// services/config/types.ts

interface AtomicConfig {
  /** Active provider */
  provider: "claude" | "opencode" | "copilot";
  /** Model to use */
  model?: string;
  /** Permission mode */
  permissionMode?: "auto" | "prompt" | "deny";
  /** MCP servers */
  mcpServers?: McpServerConfig[];
  /** Custom workflows directory */
  workflowsDir?: string;
  /** Telemetry opt-out */
  telemetryDisabled?: boolean;
}

interface ProviderConfig {
  /** Path to the agent binary */
  binaryPath?: string;
  /** Additional provider-specific config */
  [key: string]: unknown;
}
```

```typescript
// services/config/loader.ts

interface ConfigLoader {
  /** Load merged config (global + local) */
  load(): Promise<AtomicConfig>;
  /** Load provider-specific config */
  loadProviderConfig(provider: AgentType): Promise<ProviderConfig>;
  /** Save config changes */
  save(config: Partial<AtomicConfig>): Promise<void>;
}

function createConfigLoader(cwd: string): ConfigLoader {
  return {
    async load() {
      // 1. Read Atomic's own config (.atomic/config.json)
      // 2. Read provider configs for detected agents
      // 3. Merge with defaults
      const atomicConfig = await readAtomicConfig(cwd);
      return mergeWithDefaults(atomicConfig);
    },

    async loadProviderConfig(provider) {
      switch (provider) {
        case "claude": return readClaudeConfig(cwd);
        case "opencode": return readOpenCodeConfig(cwd);
        case "copilot": return readCopilotConfig(cwd);
      }
    },

    async save(config) {
      await writeAtomicConfig(cwd, config);
    },
  };
}
```

**Key change**: Atomic has its OWN config format (`.atomic/config.json`) that references provider configs rather than directly managing three different config formats. Provider-specific config reading is isolated to `loadProviderConfig()`.

### 2. Agent Discovery

Consolidate discovery into a single module:

```typescript
// services/discovery/index.ts

interface DiscoveredAgent {
  type: AgentType;
  binaryPath: string;
  version?: string;
  configPath: string;
}

async function discoverAgents(cwd: string): Promise<DiscoveredAgent[]> {
  const agents: DiscoveredAgent[] = [];

  // Check for each agent binary
  for (const type of ["claude", "opencode", "copilot"] as AgentType[]) {
    const agent = await detectAgent(type, cwd);
    if (agent) agents.push(agent);
  }

  return agents;
}

async function detectAgent(type: AgentType, cwd: string): Promise<DiscoveredAgent | null> {
  const paths = getAgentPaths(type);
  for (const binaryPath of paths.binaryPaths) {
    if (await fileExists(binaryPath)) {
      return {
        type,
        binaryPath,
        version: await getAgentVersion(binaryPath),
        configPath: paths.configPath(cwd),
      };
    }
  }
  return null;
}
```

**What's consolidated**: `services/agent-discovery/` and `commands/catalog/agents/discovery.ts` and `commands/catalog/agents/discovery-paths.ts` merge into one module.

### 3. Lightweight Telemetry

```typescript
// services/telemetry/index.ts

interface Telemetry {
  trackEvent(name: string, properties?: Record<string, string | number | boolean>): void;
  trackError(error: Error, properties?: Record<string, string>): void;
  flush(): Promise<void>;
}

function createTelemetry(config: { enabled: boolean; endpoint?: string }): Telemetry {
  if (!config.enabled) {
    return { trackEvent: noop, trackError: noop, flush: async () => {} };
  }

  const queue: TelemetryEvent[] = [];

  return {
    trackEvent(name, properties) {
      queue.push({ name, properties, timestamp: Date.now() });
      if (queue.length >= 50) this.flush();
    },
    trackError(error, properties) {
      queue.push({ name: "error", properties: { ...properties, message: error.message }, timestamp: Date.now() });
    },
    async flush() {
      if (queue.length === 0) return;
      const batch = queue.splice(0);
      // Send to endpoint (fire and forget)
      fetch(config.endpoint ?? DEFAULT_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(batch),
      }).catch(() => {}); // Don't fail the app on telemetry errors
    },
  };
}
```

**What's removed**: Direct Azure Monitor / OpenTelemetry SDK dependency. If Azure Monitor is needed, it can be the backend endpoint, but the client-side code is a simple event queue with batch sending.

### 4. Model Operations

```typescript
// services/models/index.ts

interface ModelOperations {
  /** Get current model info */
  getModelInfo(): Promise<ModelInfo>;
  /** List available models for the active provider */
  listModels(): Promise<ModelInfo[]>;
  /** Switch model */
  setModel(model: string, options?: { reasoningEffort?: string }): Promise<void>;
}

interface ModelInfo {
  id: string;
  displayName: string;
  provider: AgentType;
  supportsReasoning: boolean;
  maxTokens?: number;
}
```

Model operations are provider-specific but surfaced through a common interface. The provider's `CodingAgentProvider.getModelInfo()` is the underlying implementation.

### 5. Module Structure

```
services/
├── config/
│   ├── types.ts             # AtomicConfig, ProviderConfig
│   ├── loader.ts            # ConfigLoader implementation
│   └── provider-configs.ts  # Provider-specific config readers
├── discovery/
│   ├── index.ts             # discoverAgents()
│   └── paths.ts             # Binary and config path resolution
├── telemetry/
│   └── index.ts             # Lightweight telemetry
├── models/
│   └── index.ts             # ModelOperations
├── providers/               # (from Spec 02)
│   ├── claude/
│   ├── opencode/
│   ├── copilot/
│   └── factory.ts
├── streaming/               # (from Spec 01)
│   ├── event-bus.ts
│   ├── orchestrator.ts
│   ├── interaction.ts
│   └── backpressure.ts
└── workflows/               # (from Spec 04)
    ├── engine/
    ├── ralph/
    ├── tasks.ts
    ├── registry.ts
    └── loader.ts
```

### 6. Startup Sequence

```typescript
// services/startup.ts

async function startApp(cwd: string): Promise<AppContext> {
  // 1. Load config
  const config = await createConfigLoader(cwd).load();

  // 2. Discover agents
  const agents = await discoverAgents(cwd);

  // 3. Create provider for active agent
  const provider = createProvider(config.provider);
  await provider.start();

  // 4. Create event bus
  const bus = createEventBus();

  // 5. Create store and wire to bus
  const store = createAppStore();
  wireStoreToBus(store, bus);

  // 6. Initialize telemetry
  const telemetry = createTelemetry({ enabled: !config.telemetryDisabled });

  // 7. Register workflows
  const workflowRegistry = new WorkflowRegistry();
  workflowRegistry.register(ralphWorkflowDefinition);
  // Load custom workflows
  const customWorkflows = await loadCustomWorkflows(config.workflowsDir ?? ".atomic/workflows");
  customWorkflows.forEach(w => workflowRegistry.register(w));

  return { config, provider, bus, store, telemetry, workflowRegistry, agents };
}
```

## Code References (Current)

- `src/services/config/` - Config service (3,722 lines)
- `src/services/telemetry/` - Telemetry (2,018 lines)
- `src/services/agent-discovery/` - Agent discovery (521 lines)
- `src/services/models/` - Model operations (821 lines)
- `src/services/system/` - System service (1,269 lines)
- `src/services/terminal/` - Terminal service (181 lines)
- `src/commands/catalog/agents/discovery.ts` - Duplicate discovery
- `src/commands/catalog/agents/discovery-paths.ts` - Duplicate paths

## Related Research

- `research/docs/2026-03-04-claude-sdk-discovery-and-atomic-config-sync.md`
- `research/docs/2026-01-21-anonymous-telemetry-implementation.md`
- `research/docs/2026-01-22-azure-app-insights-backend-integration.md`
- `research/docs/2026-01-24-copilot-agent-detection-findings.md`
- `research/docs/2026-01-24-copilot-agent-detection-refactoring.md`
- `research/docs/2026-02-25-global-config-sync-mechanism.md`
- `research/docs/2026-01-20-init-config-merge-behavior.md`
- `research/docs/2026-03-03-bun-migration-startup-optimization.md`
