/**
 * Legacy Compatibility Barrel
 *
 * Re-exports from the new `types/` module so that existing imports
 * from `@/services/workflows/workflow-types.ts` continue to work.
 *
 * New code should import from `@/services/workflows/types/index.ts` instead.
 */

export * from "@/services/workflows/types/index.ts";
