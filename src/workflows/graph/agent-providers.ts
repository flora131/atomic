import {
  createClaudeAgentClient,
  createCopilotClient,
  createOpenCodeClient,
  type CopilotClientOptions,
  type OpenCodeClientOptions,
} from "../../sdk/clients/index.ts";
import type { CodingAgentClient, Session, SessionConfig } from "../../sdk/types.ts";
import type { AgentProvider } from "./provider-registry.ts";
import { ProviderRegistry } from "./provider-registry.ts";

const DEFAULT_CLAUDE_MODELS = ["opus", "sonnet", "haiku"] as const;

interface ClientBackedProviderConfig {
  name: string;
  client: CodingAgentClient;
  supportedModels?: readonly string[];
}

/**
 * Wraps a CodingAgentClient as an AgentProvider.
 * Starts the client lazily when the first session is created.
 */
export class ClientBackedAgentProvider implements AgentProvider {
  readonly name: string;
  private readonly client: CodingAgentClient;
  private readonly models: readonly string[];
  private startPromise: Promise<void> | null = null;

  constructor(config: ClientBackedProviderConfig) {
    this.name = config.name;
    this.client = config.client;
    this.models = [...(config.supportedModels ?? [])];
  }

  async createSession(config: SessionConfig): Promise<Session> {
    await this.ensureStarted();
    return this.client.createSession(config);
  }

  supportedModels(): string[] {
    return [...this.models];
  }

  private async ensureStarted(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.client.start();
    }

    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }
}

/**
 * Options for constructing the Claude provider.
 */
export interface ClaudeAgentProviderOptions {
  client?: CodingAgentClient;
  supportedModels?: readonly string[];
}

/**
 * Options for constructing the OpenCode provider.
 */
export interface OpenCodeAgentProviderOptions {
  client?: CodingAgentClient;
  clientOptions?: OpenCodeClientOptions;
  supportedModels?: readonly string[];
}

/**
 * Options for constructing the Copilot provider.
 */
export interface CopilotAgentProviderOptions {
  client?: CodingAgentClient;
  clientOptions?: CopilotClientOptions;
  supportedModels?: readonly string[];
}

/**
 * Options for constructing the default provider registry.
 */
export interface DefaultProviderRegistryOptions {
  claude?: ClaudeAgentProviderOptions;
  opencode?: OpenCodeAgentProviderOptions;
  copilot?: CopilotAgentProviderOptions;
}

/**
 * Create an AgentProvider backed by the Claude client.
 */
export function createClaudeAgentProvider(
  options: ClaudeAgentProviderOptions = {},
): AgentProvider {
  return new ClientBackedAgentProvider({
    name: "claude",
    client: options.client ?? createClaudeAgentClient(),
    supportedModels: options.supportedModels ?? DEFAULT_CLAUDE_MODELS,
  });
}

/**
 * Create an AgentProvider backed by the OpenCode client.
 */
export function createOpenCodeAgentProvider(
  options: OpenCodeAgentProviderOptions = {},
): AgentProvider {
  return new ClientBackedAgentProvider({
    name: "opencode",
    client: options.client ?? createOpenCodeClient(options.clientOptions),
    supportedModels: options.supportedModels ?? [],
  });
}

/**
 * Create an AgentProvider backed by the Copilot client.
 */
export function createCopilotAgentProvider(
  options: CopilotAgentProviderOptions = {},
): AgentProvider {
  return new ClientBackedAgentProvider({
    name: "copilot",
    client: options.client ?? createCopilotClient(options.clientOptions),
    supportedModels: options.supportedModels ?? [],
  });
}

/**
 * Create a ProviderRegistry with Claude, OpenCode, and Copilot providers.
 */
export function createDefaultProviderRegistry(
  options: DefaultProviderRegistryOptions = {},
): ProviderRegistry {
  return new ProviderRegistry({
    claude: createClaudeAgentProvider(options.claude),
    opencode: createOpenCodeAgentProvider(options.opencode),
    copilot: createCopilotAgentProvider(options.copilot),
  });
}
