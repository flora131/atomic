/**
 * Sub-Agent Type Registry
 *
 * A singleton registry that stores discovered sub-agent info and provides
 * name-based lookup. Enables workflow authors to reference config-defined
 * agents by name within subagentNode() and parallelSubagentNode().
 *
 */

import type { AgentInfo, AgentSource } from "../../ui/commands/agent-commands.ts";
import { discoverAgentInfos } from "../../ui/commands/agent-commands.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Registry entry for a discovered sub-agent.
 */
export interface SubagentEntry {
  name: string;
  info: AgentInfo;
  source: AgentSource;
}

// ============================================================================
// Registry
// ============================================================================

/**
 * In-memory registry for sub-agent definitions keyed by name.
 */
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

/**
 * Populate the SubagentTypeRegistry with discovered agents from config directories.
 * Project-local agents overwrite user-global on name conflict.
 *
 * @param registry - Registry instance to populate
 * @returns Number of agents in the registry after population
 */
export async function populateSubagentRegistry(registry: SubagentTypeRegistry): Promise<number> {
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
