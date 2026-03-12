import type { BaseState, CompiledGraph, GraphConfig, NodeDefinition } from "@/services/workflows/graph/types.ts";
import { SubagentTypeRegistry } from "@/services/workflows/graph/subagent-registry.ts";
import { discoverAgentInfos } from "@/commands/tui/agent-commands.ts";
import type { WorkflowGraphConfig } from "@/commands/tui/workflow-commands.ts";

export function compileGraphConfig<TState extends BaseState>(
  graphConfig: WorkflowGraphConfig<TState>,
): CompiledGraph<TState> {
  const nodeMap = new Map<string, NodeDefinition<TState>>();
  for (const node of graphConfig.nodes) {
    nodeMap.set(node.id, node);
  }

  const nodesWithOutgoing = new Set(graphConfig.edges.map((e) => e.from));
  const endNodes = new Set<string>();
  for (const nodeId of nodeMap.keys()) {
    if (!nodesWithOutgoing.has(nodeId)) {
      endNodes.add(nodeId);
    }
  }

  const config: GraphConfig<TState> = {};
  if (graphConfig.maxIterations !== undefined) {
    config.metadata = { maxIterations: graphConfig.maxIterations };
  }

  return {
    nodes: nodeMap,
    edges: [...graphConfig.edges],
    startNode: graphConfig.startNode,
    endNodes,
    config,
  };
}

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
