/**
 * State Data-Flow Verification
 *
 * Property 5: Every state field a node reads has been written by a
 * preceding node on all execution paths.
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

  if (nodeReads.size === 0) {
    return { verified: true };
  }

  // Collect all referenced fields
  const allFields = new Set<string>();
  for (const reads of nodeReads.values()) {
    for (const field of reads) allFields.add(field);
  }
  for (const outputs of nodeOutputs.values()) {
    for (const field of outputs) allFields.add(field);
  }

  // Build predecessor map
  const predecessors = new Map<string, string[]>();
  for (const node of graph.nodes) {
    predecessors.set(node.id, []);
  }
  for (const edge of graph.edges) {
    predecessors.get(edge.to)?.push(edge.from);
  }

  // Topological order via BFS (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
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
      if (edge.from === id) {
        const newDeg = (inDegree.get(edge.to) ?? 1) - 1;
        inDegree.set(edge.to, newDeg);
        if (newDeg === 0) topoQueue.push(edge.to);
      }
    }
  }

  // For each field, compute produced[node] in topological order
  // produced[node] = true if:
  //   - node itself outputs the field, OR
  //   - ALL predecessors have produced[pred] = true
  const violations: Array<{ nodeId: string; field: string }> = [];

  for (const field of allFields) {
    const produced = new Map<string, boolean>();

    for (const nodeId of topoOrder) {
      const nodeProduces = nodeOutputs.get(nodeId)?.includes(field) ?? false;

      if (nodeProduces) {
        produced.set(nodeId, true);
      } else {
        const preds = predecessors.get(nodeId) ?? [];
        if (preds.length === 0) {
          produced.set(nodeId, false);
        } else {
          // AND over predecessors: field must be produced on ALL paths
          const allPredsProduced = preds.every((p) => produced.get(p) === true);
          produced.set(nodeId, allPredsProduced);
        }
      }
    }

    // Check reads
    for (const [nodeId, reads] of nodeReads) {
      if (reads.includes(field) && produced.get(nodeId) !== true) {
        violations.push({ nodeId, field });
      }
    }
  }

  if (violations.length > 0) {
    const desc = violations
      .map(
        (v) =>
          `node "${v.nodeId}" reads "${v.field}" which may not be written on all paths`,
      )
      .join("; ");
    return {
      verified: false,
      counterexample: desc,
      details: { violations },
    };
  }

  return { verified: true };
}
