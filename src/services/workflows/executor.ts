/**
 * Compatibility barrel for workflow execution orchestration.
 *
 * The implementation now lives under `workflows/runtime/executor.ts`, while
 * the historical `workflows/executor.ts` path remains stable.
 */

export * from "@/services/workflows/runtime/executor.ts";
