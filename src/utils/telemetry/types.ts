/**
 * Telemetry types for anonymous usage tracking
 *
 * Schema follows the spec in Section 5.1 of the telemetry implementation document.
 */

/**
 * Persistent telemetry state stored in telemetry.json
 */
export interface TelemetryState {
  /** Master toggle for telemetry collection */
  enabled: boolean;
  /** Has user explicitly consented to telemetry? */
  consentGiven: boolean;
  /** Anonymous UUID v4 for session correlation */
  anonymousId: string;
  /** ISO 8601 timestamp when state was first created */
  createdAt: string;
  /** ISO 8601 timestamp of last ID rotation */
  rotatedAt: string;
}
