import type { Session, SessionConfig } from "../../sdk/types.ts";

/**
 * Provider abstraction for creating agent sessions from workflow graph nodes.
 */
export interface AgentProvider {
  name: string;
  createSession(config: SessionConfig): Promise<Session>;
  supportedModels(): string[];
}

/**
 * Immutable registry of available agent providers.
 */
export class ProviderRegistry {
  private readonly providers: ReadonlyMap<string, AgentProvider>;

  constructor(providers: Record<string, AgentProvider>) {
    this.providers = new Map(Object.entries(providers));
  }

  get(name: string): AgentProvider | undefined {
    return this.providers.get(name);
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }
}
