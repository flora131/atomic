/**
 * State Data-Flow Verification
 *
 * Property 5: Every state field a node reads has been written by a
 * preceding node on all execution paths.
 *
 * Encoding: Boolean `produced[field][node]` variables propagate output
 * declarations along graph edges. For each node that reads a field,
 * verify the field has been produced by a predecessor on all paths.
 */

import type { Bool } from "z3-solver";
import { init } from "z3-solver";
import type {
  EncodedGraph,
  PropertyResult,
} from "@/services/workflows/verification/types";

/**
 * Type-safe accessor for the produced variable map.
 * All entries are pre-populated during initialization, so lookups
 * within the known field/node sets are guaranteed to exist.
 */
function getProduced(
  produced: Map<string, Map<string, Bool<"main">>>,
  field: string,
  nodeId: string,
): Bool<"main"> {
  const fieldMap = produced.get(field);
  if (!fieldMap) {
    throw new Error(`Internal error: no produced map for field "${field}"`);
  }
  const boolVar = fieldMap.get(nodeId);
  if (!boolVar) {
    throw new Error(
      `Internal error: no produced variable for field "${field}" at node "${nodeId}"`,
    );
  }
  return boolVar;
}

export async function checkStateDataFlow(
  graph: EncodedGraph,
): Promise<PropertyResult> {
  // Collect all reads/outputs declarations
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

  // If no nodes declare reads, trivially passes
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

  const { Context } = await init();
  const ctx = Context("main");
  const solver = new ctx.Solver();

  // Build predecessor map
  const predecessors = new Map<string, string[]>();
  for (const node of graph.nodes) {
    predecessors.set(node.id, []);
  }
  for (const edge of graph.edges) {
    predecessors.get(edge.to)?.push(edge.from);
  }

  // Create produced[field][node] boolean variables
  // produced[field][node] is true if field has been produced
  // by the node or any predecessor on ALL paths
  const produced = new Map<string, Map<string, Bool<"main">>>();
  for (const field of allFields) {
    const fieldMap = new Map<string, Bool<"main">>();
    for (const node of graph.nodes) {
      fieldMap.set(
        node.id,
        ctx.Bool.const(`produced_${field}_${node.id}`),
      );
    }
    produced.set(field, fieldMap);
  }

  // Constraints for each field
  for (const field of allFields) {
    for (const node of graph.nodes) {
      const nodeProducesField =
        nodeOutputs.get(node.id)?.includes(field) ?? false;
      const nodeVar = getProduced(produced, field, node.id);

      if (node.id === graph.startNode) {
        // Start node: produced iff the start node outputs this field
        if (nodeProducesField) {
          solver.add(nodeVar);
        } else {
          solver.add(ctx.Not(nodeVar));
        }
      } else {
        const preds = predecessors.get(node.id);
        if (!preds || preds.length === 0) {
          // Unreachable node -- field not produced unless node itself produces it
          if (nodeProducesField) {
            solver.add(nodeVar);
          } else {
            solver.add(ctx.Not(nodeVar));
          }
        } else {
          // produced[field][node] = nodeProducesField OR AND(produced[field][pred] for all preds)
          // We use AND for predecessors because the field must be produced on ALL paths
          if (nodeProducesField) {
            // This node produces the field -- always true
            solver.add(nodeVar);
          } else {
            // Field is produced at this node iff ALL predecessors have it produced
            // (conservative: requires all paths to have written the field)
            const predProduced = preds.map((p) =>
              getProduced(produced, field, p),
            );
            if (predProduced.length === 1) {
              solver.add(ctx.Eq(nodeVar, predProduced[0]!));
            } else {
              solver.add(
                ctx.Eq(nodeVar, ctx.And(...predProduced)),
              );
            }
          }
        }
      }
    }
  }

  // Assert that all reads are satisfied
  const violations: Array<{ nodeId: string; field: string }> = [];

  for (const [nodeId, reads] of nodeReads) {
    for (const field of reads) {
      const fieldMap = produced.get(field);
      if (!fieldMap?.has(nodeId)) continue;

      const nodeVar = getProduced(produced, field, nodeId);

      solver.push();
      solver.add(ctx.Not(nodeVar));
      const result = await solver.check();
      solver.pop();

      if (result === "sat") {
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
