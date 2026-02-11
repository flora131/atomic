/**
 * Sub-Agent Type Registry
 *
 * A singleton registry that stores discovered sub-agent definitions and provides
 * name-based lookup. Enables workflow authors to reference built-in, user-global,
 * and project-local agents by name within subagentNode() and parallelSubagentNode().
 *
 * Follows the existing setClientProvider() / setWorkflowResolver() global setter pattern.
 */

import type { AgentDefinition, AgentSource } from "../ui/commands/agent-commands.ts";
import { discoverAgents, BUILTIN_AGENTS } from "../ui/commands/agent-commands.ts";

// ============================================================================
// Types
// ============================================================================

export interface SubagentEntry {
  name: string;
  definition: AgentDefinition;
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
 * Populate the SubagentTypeRegistry with built-in and discovered agents.
 * Built-in agents are registered first (lowest priority), then discovered
 * agents overwrite on name conflict (project > user > built-in).
 *
 * @returns Number of agents in the registry after population
 */
export async function populateSubagentRegistry(): Promise<number> {
  const registry = getSubagentRegistry();

  // Built-in agents (lowest priority, registered first)
  for (const agent of BUILTIN_AGENTS) {
    registry.register({
      name: agent.name,
      definition: agent,
      source: "builtin",
    });
  }

  // Discovered agents (project + user) — overwrites built-in on conflict
  const discovered = await discoverAgents();
  for (const agent of discovered) {
    registry.register({
      name: agent.name,
      definition: agent,
      source: agent.source,
    });
  }

  return registry.getAll().length;
}
