/**
 * Compatibility barrel for graph contracts.
 *
 * Focused internal modules live under `graph/contracts/*`, while the existing
 * `graph/types.ts` path remains stable for the rest of the codebase.
 */

export * from "@/services/workflows/graph/contracts/core.ts";
export * from "@/services/workflows/graph/contracts/runtime.ts";
export * from "@/services/workflows/graph/contracts/guards.ts";
export * from "@/services/workflows/graph/contracts/constants.ts";
