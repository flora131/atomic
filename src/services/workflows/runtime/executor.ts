/**
 * Compatibility barrel for workflow execution orchestration.
 *
 * The implementation now lives under `workflows/runtime/executor/`, while
 * the historical `workflows/runtime/executor.ts` path remains stable.
 */

export * from "@/services/workflows/runtime/executor/index.ts";
