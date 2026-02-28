/**
 * Pipeline Diagnostic Logger
 *
 * Lightweight conditional logger for event pipeline chokepoints.
 * Activated by the ATOMIC_DEBUG=1 environment variable.
 *
 * Logs are prefixed with `[Pipeline:<stage>]` for easy filtering:
 *   [Pipeline:EventBus] Schema validation drop ...
 *   [Pipeline:Dispatcher] Coalesced event ...
 *   [Pipeline:Wire] Filtered unowned event ...
 *   [Pipeline:Consumer] Unmapped event type ...
 *   [Pipeline:Subagent] Stream started ...
 *
 * Usage:
 * ```typescript
 * import { pipelineLog } from "./pipeline-logger.ts";
 *
 * pipelineLog("EventBus", "schema_drop", { type: event.type, runId: event.runId });
 * pipelineLog("Dispatcher", "coalesce", { key, type: event.type });
 * ```
 */

type PipelineStage =
  | "EventBus"
  | "Dispatcher"
  | "Wire"
  | "Consumer"
  | "Subagent";

let _debugEnabled: boolean | null = null;

/**
 * Check if pipeline diagnostic logging is enabled.
 * Caches the result after first check for performance.
 */
export function isPipelineDebug(): boolean {
  if (_debugEnabled === null) {
    _debugEnabled = process.env.ATOMIC_DEBUG === "1";
  }
  return _debugEnabled;
}

/**
 * Reset the cached debug flag (for testing).
 */
export function resetPipelineDebugCache(): void {
  _debugEnabled = null;
}

/**
 * Log a diagnostic message from a specific pipeline stage.
 *
 * Only emits output when ATOMIC_DEBUG=1. Each log entry includes
 * the stage name, a short action tag, and optional structured data.
 *
 * @param stage - Pipeline stage identifier
 * @param action - Short action descriptor (e.g., "schema_drop", "coalesce", "flush")
 * @param data - Optional structured data to include in the log
 */
export function pipelineLog(
  stage: PipelineStage,
  action: string,
  data?: Record<string, unknown>,
): void {
  if (!isPipelineDebug()) return;
  const payload = data ? ` ${JSON.stringify(data)}` : "";
  console.debug(`[Pipeline:${stage}] ${action}${payload}`);
}
