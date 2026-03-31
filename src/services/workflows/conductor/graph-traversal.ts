/**
 * Graph traversal utilities used by the conductor.
 *
 * Extracted from the legacy `execution-ops.ts` module so the conductor
 * can function independently of the original BFS graph executor.
 */

import type {
  BaseState,
  CompiledGraph,
  Edge,
  NodeId,
  NodeResult,
} from "@/services/workflows/graph/types.ts";

/**
 * Determine the next nodes to execute by evaluating outgoing edge conditions.
 *
 * If the node result contains a `goto`, the conductor jumps directly to the
 * indicated node(s). Otherwise the function evaluates edge conditions against
 * the current state and returns the set of matching target nodes.
 */
export function getNextExecutableNodes<TState extends BaseState>(
  graph: CompiledGraph<TState>,
  currentNodeId: NodeId,
  state: TState,
  result: NodeResult<TState>,
): NodeId[] {
  if (result.goto) {
    return Array.isArray(result.goto) ? result.goto : [result.goto];
  }

  const outgoingEdges = graph.edges.filter((edge) => edge.from === currentNodeId);
  if (outgoingEdges.length === 0) {
    return [];
  }

  const matchingEdges: Edge<TState>[] = [];
  for (const edge of outgoingEdges) {
    if (!edge.condition || edge.condition(state)) {
      matchingEdges.push(edge);
    }
  }

  return Array.from(new Set(matchingEdges.map((edge) => edge.to)));
}
