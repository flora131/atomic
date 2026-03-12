/**
 * Compatibility barrel for graph node factories and node contracts.
 *
 * Focused implementations now live under `graph/nodes/*`, while the historical
 * `graph/nodes.ts` path remains stable for the rest of the codebase.
 */

export * from "@/services/workflows/graph/nodes/index.ts";
