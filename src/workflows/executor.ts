/**
 * Generic workflow executor that replaces both createRalphCommand() and WorkflowSDK.
 * Handles graph compilation, session initialization, state construction,
 * bridge/registry setup, graph streaming with progress, and error handling.
 */

import type { BaseState, CompiledGraph, NodeDefinition, Edge, GraphConfig } from "./graph/types.ts";
import { SubagentTypeRegistry } from "./graph/subagent-registry.ts";
import { discoverAgentInfos } from "../ui/commands/agent-commands.ts";
import type { WorkflowGraphConfig } from "../ui/commands/workflow-commands.ts";

/**
 * Result of a workflow execution.
 */
export interface WorkflowExecutionResult {
    success: boolean;
    message?: string;
    error?: Error;
}

/**
 * Compiles a declarative WorkflowGraphConfig into a CompiledGraph.
 * Converts node array to Map, detects end nodes, and builds the config.
 */
export function compileGraphConfig<TState extends BaseState>(
    graphConfig: WorkflowGraphConfig<TState>,
): CompiledGraph<TState> {
    const nodeMap = new Map<string, NodeDefinition<TState>>();
    for (const node of graphConfig.nodes) {
        nodeMap.set(node.id, node);
    }

    // Detect end nodes: nodes with no outgoing edges
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

/**
 * Infers whether the compiled graph uses subagent nodes.
 * Checks node types and IDs for subagent-related patterns.
 */
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

/**
 * Infers whether the compiled graph's state schema includes a tasks field.
 * Used to determine if the workflow supports task list UI updates.
 */
export function inferHasTaskList<TState extends BaseState>(
    compiled: CompiledGraph<TState>,
): boolean {
    return compiled.config.metadata?.hasTaskList === true;
}

/**
 * Creates and populates a SubagentTypeRegistry with discovered agent infos.
 */
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
