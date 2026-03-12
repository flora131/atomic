/**
 * Pipeline Diagnostic Logger
 *
 * Lightweight conditional logger for event pipeline chokepoints.
 * Activated by the DEBUG=1 environment variable.
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
 * import { pipelineLog } from "@/services/events/pipeline-logger.ts";
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
  | "Subagent"
  | "Workflow";

let _debugEnabled: boolean | null = null;

/**
 * Check if pipeline diagnostic logging is enabled.
 * Caches the result after first check for performance.
 */
export function isPipelineDebug(): boolean {
  if (_debugEnabled === null) {
    const debugValue = process.env.DEBUG?.trim().toLowerCase();
    _debugEnabled = !!debugValue && (debugValue === "1" || debugValue === "true" || debugValue === "on");
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
 * Only emits output when DEBUG=1. Each log entry includes
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

/**
 * Log an error-level diagnostic message from a specific pipeline stage.
 *
 * Only emits output when DEBUG=1. Uses console.error so error messages
 * are visible even in environments that suppress console.debug output.
 *
 * @param stage - Pipeline stage identifier
 * @param action - Short action descriptor (e.g., "schema_drop", "handler_error")
 * @param data - Optional structured data to include in the log
 */
export function pipelineError(
  stage: PipelineStage,
  action: string,
  data?: Record<string, unknown>,
): void {
  if (!isPipelineDebug()) return;
  const payload = data ? ` ${JSON.stringify(data)}` : "";
  console.error(`[Pipeline:${stage}] ${action}${payload}`);
}
