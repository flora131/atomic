/**
 * Standardized error handling for telemetry operations.
 * Telemetry must NEVER break user workflows - all errors are handled gracefully.
 */

const DEBUG_MODE = process.env.ATOMIC_TELEMETRY_DEBUG === "1";

/**
 * Handle telemetry errors with consistent silent-by-default behavior.
 * Enables debug logging when ATOMIC_TELEMETRY_DEBUG=1 is set.
 *
 * @param error - The error that occurred
 * @param context - Description of where the error occurred (e.g., "readTelemetryState", "appendEvent:cli")
 *
 * @example
 * try {
 *   // telemetry operation
 * } catch (error) {
 *   handleTelemetryError(error, 'writeSessionEvent');
 * }
 */
export function handleTelemetryError(error: unknown, context: string): void {
  if (DEBUG_MODE) {
    console.error(`[Telemetry Debug: ${context}]`, error);
  }
  // Otherwise, silent - telemetry must never break user workflows
}
