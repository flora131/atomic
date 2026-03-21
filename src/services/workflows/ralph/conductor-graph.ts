/**
 * Ralph Conductor Graph
 *
 * A simplified graph for the conductor-based execution path. Unlike the
 * full Ralph graph (which includes tool nodes like `parse-tasks`,
 * `select-ready-tasks`, `prepare-fix-tasks` for the streaming executor),
 * this graph contains only the four agent nodes:
 *
 *   planner → orchestrator → reviewer → debugger
 *
 * The conductor's `StageDefinition` for each node handles prompt building,
 * output parsing, and inter-stage context threading via `StageContext`
 * and `StageOutput` records — replacing the tool nodes entirely.
 *
 * The debugger node's `shouldRun` stage condition controls whether it
 * executes, making the graph's edge unconditional.
 */

import type {
  BaseState,
  CompiledGraph,
  Edge,
  NodeDefinition,
  NodeResult,
} from "@/services/workflows/graph/types.ts";

/**
 * Create a no-op execute function for agent nodes.
 * The conductor never calls `node.execute()` for agent nodes — it uses
 * the matching `StageDefinition` instead. This placeholder satisfies
 * the `NodeDefinition` interface contract.
 */
function agentNoopExecute(): Promise<NodeResult<BaseState>> {
  return Promise.resolve({});
}

/**
 * Build the conductor-specific compiled graph for the Ralph workflow.
 *
 * Returns a `CompiledGraph<BaseState>` with four agent nodes in linear
 * sequence. No tool or decision nodes are included — all inter-stage
 * logic is handled by the stage definitions in `RALPH_STAGES`.
 */
export function createRalphConductorGraph(): CompiledGraph<BaseState> {
  const nodes = new Map<string, NodeDefinition<BaseState>>();

  nodes.set("planner", {
    id: "planner",
    type: "agent",
    name: "Planner",
    description: "Decomposes user prompt into a task list",
    execute: agentNoopExecute,
  });

  nodes.set("orchestrator", {
    id: "orchestrator",
    type: "agent",
    name: "Orchestrator",
    description: "Manages parallel task execution",
    execute: agentNoopExecute,
  });

  nodes.set("reviewer", {
    id: "reviewer",
    type: "agent",
    name: "Reviewer",
    description: "Reviews completed implementation",
    execute: agentNoopExecute,
  });

  nodes.set("debugger", {
    id: "debugger",
    type: "agent",
    name: "Debugger",
    description: "Applies fixes for review findings",
    execute: agentNoopExecute,
  });

  const edges: Edge<BaseState>[] = [
    { from: "planner", to: "orchestrator" },
    { from: "orchestrator", to: "reviewer" },
    { from: "reviewer", to: "debugger" },
  ];

  return {
    nodes,
    edges,
    startNode: "planner",
    endNodes: new Set(["debugger"]),
    config: {},
  };
}
