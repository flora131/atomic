import type { BaseState, CompiledGraph, NodeDefinition } from "@/services/workflows/graph/types.ts";
import { SubagentTypeRegistry } from "@/services/workflows/graph/subagent-registry.ts";
import { discoverAgentInfos } from "@/services/agent-discovery/index.ts";

export function inferHasSubagentNodes<TState extends BaseState>(
  compiled: CompiledGraph<TState>,
): boolean {
  for (const node of compiled.nodes.values()) {
    if (
      (node as NodeDefinition<TState>).type === "agent" ||
      node.id.includes("subagent")
    ) {
      return true;
    }
  }
  return false;
}

export function inferHasTaskList<TState extends BaseState>(
  compiled: CompiledGraph<TState>,
): boolean {
  return compiled.config.metadata?.hasTaskList === true;
}

export function createSubagentRegistry(): SubagentTypeRegistry {
  const registry = new SubagentTypeRegistry();
  for (const agent of discoverAgentInfos()) {
    registry.register({
      name: agent.name,
      info: agent,
      source: agent.source,
    });
  }
  return registry;
}
