/**
 * Compatibility barrel for graph checkpoint persistence.
 *
 * The implementation now lives under `graph/persistence/checkpointer.ts`,
 * while the historical `graph/checkpointer.ts` path remains stable.
 */

export * from "@/services/workflows/graph/persistence/checkpointer.ts";
