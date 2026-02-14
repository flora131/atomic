/**
 * Telemetry module public API
 *
 * Exports only the functions and types needed by consumers.
 * Internal implementation details are not exposed.
 *
 * Reference: Spec Section 5 - Interface Segregation Principle
 */

// Types
export type {
  TelemetryState,
  AtomicCommandType,
  AgentType,
  AtomicCommandEvent,
  CliCommandEvent,
  AgentSessionEvent,
  TelemetryEvent,
} from "./types";

// Constants
export { ATOMIC_COMMANDS, type AtomicCommand } from "./constants";

// Core telemetry functions (public API only)
export {
  isTelemetryEnabled,
  isTelemetryEnabledSync,
  getOrCreateTelemetryState,
  setTelemetryEnabled,
  getTelemetryFilePath,
} from "./telemetry";

// CLI telemetry tracking
export {
  trackAtomicCommand,
  trackCliInvocation,
  extractCommandsFromArgs,
  getEventsFilePath,
} from "./telemetry-cli";

// Session telemetry tracking (for agent hooks)
export {
  trackAgentSession,
  extractCommandsFromTranscript,
  createSessionEvent,
} from "./telemetry-session";

// Consent flow
export {
  isFirstRun,
  promptTelemetryConsent,
  handleTelemetryConsent,
} from "./telemetry-consent";

// Telemetry upload
export {
  handleTelemetryUpload,
  readEventsFromJSONL,
  filterStaleEvents,
  splitIntoBatches,
  TELEMETRY_UPLOAD_CONFIG,
  type UploadResult,
} from "./telemetry-upload";