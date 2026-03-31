/**
 * State Data-Flow Verification
 *
 * Property 5: Every state field a node reads has been written by a
 * preceding node on all execution paths.
 *
 * Additionally validates that all referenced fields (reads and outputs)
 * exist in the declared globalState schema when stateFields is available.
 *
 * Algorithm: For each field, propagate a "produced" boolean forward
 * through the graph using AND at merge points (all paths must produce).
 * Then check that every node's reads are satisfied.
 */

import type {
  EncodedGraph,
  PropertyResult,
} from "@/services/workflows/verification/types.ts";

export async function checkStateDataFlow(
  graph: EncodedGraph,
): Promise<PropertyResult> {
  // Collect reads/outputs declarations
  const nodeReads = new Map<string, string[]>();
  const nodeOutputs = new Map<string, string[]>();

  for (const node of graph.nodes) {
    if (node.reads && node.reads.length > 0) {
      nodeReads.set(node.id, node.reads);
    }
    if (node.outputs && node.outputs.length > 0) {
      nodeOutputs.set(node.id, node.outputs);
    }
  }

  const violations: Array<{ nodeId: string; field: string; reason: string }> = [];

  // ── Phase 1: Validate referenced fields exist in globalState ──────────
  // When stateFields is populated (from globalState schema), every field
  // referenced in reads or outputs must exist in the schema. References
  // to undefined fields indicate a bug in the workflow definition.
  if (graph.stateFields.length > 0) {
    const validFields = new Set(graph.stateFields);

    for (const [nodeId, reads] of nodeReads) {
      for (const field of reads) {
        if (!validFields.has(field)) {
          violations.push({
            nodeId,
            field,
            reason: `reads undefined state field "${field}" (not declared in globalState)`,
          });
        }
      }
    }

    for (const [nodeId, outputs] of nodeOutputs) {
      for (const field of outputs) {
        if (!validFields.has(field)) {
          violations.push({
            nodeId,
            field,
            reason: `writes to undefined state field "${field}" (not declared in globalState)`,
          });
        }
      }
    }
  }

  // ── Phase 2: Data-flow reachability (existing check) ──────────────────
  // Verify that every field a node reads has been written by a preceding
  // node on ALL execution paths.
  if (nodeReads.size > 0) {
    // Collect all referenced fields
    const allFields = new Set<string>();
    for (const reads of nodeReads.values()) {
      for (const field of reads) allFields.add(field);
    }
    for (const outputs of nodeOutputs.values()) {
      for (const field of outputs) allFields.add(field);
    }

    // ── Detect back-edges via DFS ──────────────────────────────────────
    // Loops create back-edges (e.g., __loop_check → __loop_start) that
    // form cycles. Kahn's algorithm silently drops all nodes in cycles,
    // causing false-positive violations for every read inside a loop body.
    // We detect back-edges using DFS and exclude them so the graph
    // becomes a DAG that Kahn's algorithm can fully process.
    const backEdges = new Set<string>();
    {
      const visited = new Set<string>();
      const onStack = new Set<string>();
      const adjacency = new Map<string, string[]>();
      for (const node of graph.nodes) adjacency.set(node.id, []);
      for (const edge of graph.edges) adjacency.get(edge.from)?.push(edge.to);

      function dfs(nodeId: string): void {
        visited.add(nodeId);
        onStack.add(nodeId);
        for (const target of adjacency.get(nodeId) ?? []) {
          if (onStack.has(target)) {
            backEdges.add(`${nodeId}->${target}`);
          } else if (!visited.has(target)) {
            dfs(target);
          }
        }
        onStack.delete(nodeId);
      }

      dfs(graph.startNode);
      for (const node of graph.nodes) {
        if (!visited.has(node.id)) dfs(node.id);
      }
    }

    // Build predecessor map excluding back-edges
    const predecessors = new Map<string, string[]>();
    for (const node of graph.nodes) {
      predecessors.set(node.id, []);
    }
    for (const edge of graph.edges) {
      if (!backEdges.has(`${edge.from}->${edge.to}`)) {
        predecessors.get(edge.to)?.push(edge.from);
      }
    }

    // Topological order via BFS (Kahn's algorithm) on the DAG
    const inDegree = new Map<string, number>();
    for (const node of graph.nodes) {
      inDegree.set(node.id, 0);
    }
    for (const edge of graph.edges) {
      if (!backEdges.has(`${edge.from}->${edge.to}`)) {
        inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      }
    }
    const topoOrder: string[] = [];
    const topoQueue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) topoQueue.push(id);
    }
    while (topoQueue.length > 0) {
      const id = topoQueue.shift()!;
      topoOrder.push(id);
      for (const edge of graph.edges) {
        if (edge.from === id && !backEdges.has(`${edge.from}->${edge.to}`)) {
          const newDeg = (inDegree.get(edge.to) ?? 1) - 1;
          inDegree.set(edge.to, newDeg);
          if (newDeg === 0) topoQueue.push(edge.to);
        }
      }
    }

    // Set of fields already flagged as undefined in Phase 1
    const undefinedFields = graph.stateFields.length > 0
      ? new Set(violations.map((v) => v.field))
      : new Set<string>();

    // For each field, compute produced[node] in topological order
    for (const field of allFields) {
      // Skip fields already reported as undefined — no point checking
      // data-flow for fields that don't exist in the schema.
      if (undefinedFields.has(field)) continue;

      const produced = new Map<string, boolean>();

      for (const nodeId of topoOrder) {
        const nodeProduces = nodeOutputs.get(nodeId)?.includes(field) ?? false;

        if (nodeProduces) {
          produced.set(nodeId, true);
        } else {
          const preds = predecessors.get(nodeId) ?? [];
          if (preds.length === 0) {
            // Start node: globalState fields with defaults are always
            // available from workflow initialization, so treat them as
            // produced at the start.
            produced.set(nodeId, graph.stateFields.includes(field));
          } else {
            const allPredsProduced = preds.every((p) => produced.get(p) === true);
            produced.set(nodeId, allPredsProduced);
          }
        }
      }

      for (const [nodeId, reads] of nodeReads) {
        if (reads.includes(field) && produced.get(nodeId) !== true) {
          violations.push({
            nodeId,
            field,
            reason: `reads "${field}" which may not be written on all paths`,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    const desc = violations
      .map((v) => `node "${v.nodeId}" ${v.reason}`)
      .join("; ");
    return {
      verified: false,
      counterexample: desc,
      details: { violations },
    };
  }

  return { verified: true };
}
