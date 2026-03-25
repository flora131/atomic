import type { CodingAgentClient, Session, SessionConfig } from "@/services/agents/types.ts";
import type { AgentProvider } from "@/services/workflows/graph/provider-registry.ts";
import { ProviderRegistry } from "@/services/workflows/graph/provider-registry.ts";

/**
 * SDK client types — imported as types only (erased at runtime).
 * Actual client modules are lazy-loaded inside each factory function
 * so that unused SDKs never incur their import cost (~55ms total
 * for all three: Claude 29ms, Copilot 18ms, OpenCode 8ms).
 */
import type { CopilotClientOptions } from "@/services/agents/clients/copilot.ts";
import type { OpenCodeClientOptions } from "@/services/agents/clients/opencode.ts";

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
export async function createClaudeAgentProvider(
  options: ClaudeAgentProviderOptions = {},
): Promise<AgentProvider> {
  const client = options.client
    ?? (await import("@/services/agents/clients/claude.ts")).createClaudeAgentClient();
  return new ClientBackedAgentProvider({
    name: "claude",
    client,
    supportedModels: options.supportedModels ?? DEFAULT_CLAUDE_MODELS,
  });
}

/**
 * Create an AgentProvider backed by the OpenCode client.
 */
export async function createOpenCodeAgentProvider(
  options: OpenCodeAgentProviderOptions = {},
): Promise<AgentProvider> {
  const client = options.client
    ?? (await import("@/services/agents/clients/opencode.ts")).createOpenCodeClient(options.clientOptions);
  return new ClientBackedAgentProvider({
    name: "opencode",
    client,
    supportedModels: options.supportedModels ?? [],
  });
}

/**
 * Create an AgentProvider backed by the Copilot client.
 */
export async function createCopilotAgentProvider(
  options: CopilotAgentProviderOptions = {},
): Promise<AgentProvider> {
  const client = options.client
    ?? (await import("@/services/agents/clients/copilot.ts")).createCopilotClient(options.clientOptions);
  return new ClientBackedAgentProvider({
    name: "copilot",
    client,
    supportedModels: options.supportedModels ?? [],
  });
}

/**
 * Create a ProviderRegistry with Claude, OpenCode, and Copilot providers.
 */
export async function createDefaultProviderRegistry(
  options: DefaultProviderRegistryOptions = {},
): Promise<ProviderRegistry> {
  const [claude, opencode, copilot] = await Promise.all([
    createClaudeAgentProvider(options.claude),
    createOpenCodeAgentProvider(options.opencode),
    createCopilotAgentProvider(options.copilot),
  ]);
  return new ProviderRegistry({ claude, opencode, copilot });
}
