/**
 * Compatibility barrel for the graph runtime executor.
 *
 * The implementation now lives under `graph/runtime/compiled.ts`, while the
 * historical `graph/compiled.ts` path remains stable.
 */

export * from "@/services/workflows/graph/runtime/compiled.ts";
