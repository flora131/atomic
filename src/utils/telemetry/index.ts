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
export { trackAtomicCommand, getEventsFilePath } from "./telemetry-cli";
