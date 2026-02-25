import type { AgentInfo } from "../../ui/commands/agent-commands.ts";
import type { CodingAgentClient } from "../../sdk/types.ts";
import { graph, type GraphBuilder } from "./builder.ts";
import type {
  BaseState,
  Checkpointer,
  CompiledGraph,
  GraphRuntimeDependencies,
  ModelSpec,
} from "./types.ts";
import type { ExecutionOptions, ExecutionResult } from "./compiled.ts";
import { createExecutor, executeGraph } from "./compiled.ts";
import { routeStream, type StreamEvent, type StreamOptions } from "./stream.ts";
import type { CheckpointerType, CreateCheckpointerOptions } from "./checkpointer.ts";
import { createCheckpointer } from "./checkpointer.ts";
import { ProviderRegistry } from "./provider-registry.ts";
import { ClientBackedAgentProvider } from "./agent-providers.ts";
import type { CompiledSubgraph } from "./nodes.ts";
import { SubagentGraphBridge } from "./subagent-bridge.ts";
import { SubagentTypeRegistry } from "./subagent-registry.ts";

/**
 * A workflow entry that can be registered with {@link WorkflowSDK}.
 */
export type WorkflowRegistration<TState extends BaseState = BaseState> =
  | CompiledSubgraph<TState>
  | CompiledGraph<TState>;

/**
 * Configuration used to initialize a {@link WorkflowSDK} instance.
 */
export interface WorkflowSDKConfig {
  providers: Record<string, CodingAgentClient>;
  workflows?: Map<string, WorkflowRegistration<BaseState>>;
  agents?: Map<string, AgentInfo>;
  checkpointer?: CheckpointerType;
  checkpointerOptions?: CreateCheckpointerOptions<BaseState>;
  validation?: boolean;
  defaultModel?: ModelSpec;
  maxSteps?: number;
  subagentProvider?: string;
  subagentSessionDir?: string;
}

function hasExecute<TState extends BaseState>(
  workflow: WorkflowRegistration<TState>,
): workflow is CompiledSubgraph<TState> {
  return "execute" in workflow && typeof workflow.execute === "function";
}

/**
 * High-level SDK facade for building, running, and streaming workflows.
 */
export class WorkflowSDK {
  readonly providerRegistry: ProviderRegistry;
  private readonly clients: ReadonlyMap<string, CodingAgentClient>;
  private readonly workflows: Map<string, WorkflowRegistration<BaseState>>;
  private readonly checkpointer: Checkpointer<BaseState> | undefined;
  private readonly validationEnabled: boolean;
  private readonly defaultModel: ModelSpec | undefined;
  private readonly maxSteps: number | undefined;
  private readonly subagentBridge: SubagentGraphBridge;
  private readonly subagentRegistry: SubagentTypeRegistry;
  private readonly runtimeDependencies: GraphRuntimeDependencies;

  private constructor(config: WorkflowSDKConfig) {
    const providerEntries = Object.entries(config.providers);
    if (providerEntries.length === 0) {
      throw new Error("WorkflowSDK.init() requires at least one provider.");
    }

    const agentProviders: Record<string, ClientBackedAgentProvider> = {};
    for (const [name, client] of providerEntries) {
      agentProviders[name] = new ClientBackedAgentProvider({ name, client });
    }

    this.providerRegistry = new ProviderRegistry(agentProviders);
    this.clients = new Map(providerEntries);
    this.workflows = new Map(config.workflows ?? []);
    this.checkpointer = config.checkpointer
      ? createCheckpointer(config.checkpointer, config.checkpointerOptions)
      : undefined;
    this.validationEnabled = config.validation ?? true;
    this.defaultModel = config.defaultModel;
    this.maxSteps = config.maxSteps;

    const subagentProviderName = this.resolveSubagentProviderName(
      config.subagentProvider,
      config.defaultModel,
    );

    this.subagentBridge = new SubagentGraphBridge({
      createSession: (sessionConfig = {}) => {
        const provider = this.providerRegistry.get(subagentProviderName);
        if (!provider) {
          throw new Error(`Sub-agent provider "${subagentProviderName}" is not registered.`);
        }
        return provider.createSession(sessionConfig);
      },
      sessionDir: config.subagentSessionDir,
    });

    this.subagentRegistry = new SubagentTypeRegistry();
    for (const [name, info] of config.agents ?? []) {
      this.subagentRegistry.register({
        name,
        info,
        source: info.source,
      });
    }

    this.runtimeDependencies = {
      clientProvider: (agentType) => this.clients.get(agentType) ?? null,
      subagentBridge: this.subagentBridge,
      subagentRegistry: this.subagentRegistry,
      workflowResolver: (name) => this.resolveWorkflow(name),
    };
  }

  /**
   * Create a new SDK instance.
   */
  static init(config: WorkflowSDKConfig): WorkflowSDK {
    return new WorkflowSDK(config);
  }

  /**
   * Create a typed graph builder.
   */
  graph<TState extends BaseState = BaseState>(): GraphBuilder<TState> {
    return graph<TState>();
  }

  /**
   * Execute a compiled workflow and return the final result.
   */
  execute<TState extends BaseState = BaseState>(
    compiled: CompiledGraph<TState>,
    options?: ExecutionOptions<TState>,
  ): Promise<ExecutionResult<TState>> {
    const graphWithDefaults = this.applyGraphDefaults(compiled);
    const executionOptions = this.applyExecutionDefaults(options);
    return executeGraph(graphWithDefaults, executionOptions);
  }

  /**
   * Stream workflow execution events in one or more stream modes.
   */
  stream<TState extends BaseState = BaseState>(
    compiled: CompiledGraph<TState>,
    options: StreamOptions<TState> = {},
  ): AsyncGenerator<StreamEvent<TState>> {
    const { modes, ...executionOptions } = options;
    const graphWithDefaults = this.applyGraphDefaults(compiled);
    const executor = createExecutor(graphWithDefaults);
    return routeStream(executor.stream(this.applyExecutionDefaults(executionOptions)), modes);
  }

  /**
   * Register a named workflow for subgraph resolution.
   */
  registerWorkflow(name: string, workflow: WorkflowRegistration<BaseState>): void {
    this.workflows.set(name, workflow);
  }

  /**
   * Stop all managed provider clients.
   */
  async destroy(): Promise<void> {
    await Promise.all(Array.from(this.clients.values()).map((client) => client.stop()));
  }

  /**
   * Access the sub-agent bridge used for subagent nodes.
   */
  getSubagentBridge(): SubagentGraphBridge {
    return this.subagentBridge;
  }

  private resolveSubagentProviderName(
    explicitProvider: string | undefined,
    defaultModel: ModelSpec | undefined,
  ): string {
    if (explicitProvider) {
      return explicitProvider;
    }

    if (typeof defaultModel === "string" && defaultModel.includes("/")) {
      const [provider] = defaultModel.split("/");
      if (provider && this.providerRegistry.has(provider)) {
        return provider;
      }
    }

    return this.providerRegistry.list()[0]!;
  }

  private resolveWorkflow(name: string): CompiledSubgraph<BaseState> | null {
    const workflow = this.workflows.get(name);
    if (!workflow) {
      return null;
    }

    if (hasExecute(workflow)) {
      return workflow;
    }

    return {
      execute: async (state) => {
        const result = await this.execute(workflow, { initialState: state });
        return result.state;
      },
    };
  }

  private applyGraphDefaults<TState extends BaseState>(
    compiled: CompiledGraph<TState>,
  ): CompiledGraph<TState> {
    let changed = false;
    const nextConfig = { ...compiled.config };

    if (!nextConfig.checkpointer && this.checkpointer) {
      nextConfig.checkpointer = this.checkpointer as Checkpointer<TState>;
      changed = true;
    }

    if (!nextConfig.defaultModel && this.defaultModel) {
      nextConfig.defaultModel = this.defaultModel;
      changed = true;
    }

    if (!this.validationEnabled && nextConfig.outputSchema) {
      delete nextConfig.outputSchema;
      changed = true;
    }

    const runtime = nextConfig.runtime;
    const runtimeWithDefaults: GraphRuntimeDependencies = {
      clientProvider: runtime?.clientProvider ?? this.runtimeDependencies.clientProvider,
      workflowResolver: runtime?.workflowResolver ?? this.runtimeDependencies.workflowResolver,
      subagentBridge: runtime?.subagentBridge ?? this.runtimeDependencies.subagentBridge,
      subagentRegistry: runtime?.subagentRegistry ?? this.runtimeDependencies.subagentRegistry,
    };

    if (
      runtime?.clientProvider !== runtimeWithDefaults.clientProvider ||
      runtime?.workflowResolver !== runtimeWithDefaults.workflowResolver ||
      runtime?.subagentBridge !== runtimeWithDefaults.subagentBridge ||
      runtime?.subagentRegistry !== runtimeWithDefaults.subagentRegistry
    ) {
      nextConfig.runtime = runtimeWithDefaults;
      changed = true;
    }

    if (!changed) {
      return compiled;
    }

    return {
      ...compiled,
      config: nextConfig,
    };
  }

  private applyExecutionDefaults<TState extends BaseState>(
    options?: ExecutionOptions<TState>,
  ): ExecutionOptions<TState> | undefined {
    if (this.maxSteps === undefined) {
      return options;
    }

    return {
      ...options,
      maxSteps: options?.maxSteps ?? this.maxSteps,
    };
  }
}
