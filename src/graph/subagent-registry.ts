/**
 * Sub-Agent Type Registry
 *
 * A singleton registry that stores discovered sub-agent info and provides
 * name-based lookup. Enables workflow authors to reference config-defined
 * agents by name within subagentNode() and parallelSubagentNode().
 *
 * Follows the existing setClientProvider() / setWorkflowResolver() global setter pattern.
 */

import type { AgentInfo, AgentSource } from "../ui/commands/agent-commands.ts";
import { discoverAgentInfos } from "../ui/commands/agent-commands.ts";

// ============================================================================
// Types
// ============================================================================

export interface SubagentEntry {
  name: string;
  info: AgentInfo;
  source: AgentSource;
}

// ============================================================================
// Registry
// ============================================================================

export class SubagentTypeRegistry {
  private agents = new Map<string, SubagentEntry>();

  register(entry: SubagentEntry): void {
    this.agents.set(entry.name, entry);
  }

  get(name: string): SubagentEntry | undefined {
    return this.agents.get(name);
  }

  has(name: string): boolean {
    return this.agents.has(name);
  }

  getAll(): SubagentEntry[] {
    return Array.from(this.agents.values());
  }

  clear(): void {
    this.agents.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let globalSubagentRegistry: SubagentTypeRegistry | null = null;

export function getSubagentRegistry(): SubagentTypeRegistry {
  if (!globalSubagentRegistry) {
    globalSubagentRegistry = new SubagentTypeRegistry();
  }
  return globalSubagentRegistry;
}

export function setSubagentRegistry(registry: SubagentTypeRegistry): void {
  globalSubagentRegistry = registry;
}

// ============================================================================
// Population
// ============================================================================

/**
 * Populate the SubagentTypeRegistry with discovered agents from config directories.
 * Project-local agents overwrite user-global on name conflict.
 *
 * @returns Number of agents in the registry after population
 */
export async function populateSubagentRegistry(): Promise<number> {
  const registry = getSubagentRegistry();

  const discovered = discoverAgentInfos();
  for (const agent of discovered) {
    registry.register({
      name: agent.name,
      info: agent,
      source: agent.source,
    });
  }

  return registry.getAll().length;
}
