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
  TuiSessionStartEvent,
  TuiSessionEndEvent,
  TuiMessageSubmitEvent,
  TuiCommandExecutionEvent,
  TuiToolLifecycleEvent,
  TuiInterruptEvent,
  TuiCommandCategory,
  TuiCommandTrigger,
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
  getEventsFilePath,
} from "./telemetry-cli";

// Native TUI telemetry tracking
export {
  createTuiTelemetrySessionTracker,
  TuiTelemetrySessionTracker,
  type CreateTuiTelemetrySessionOptions,
  type TrackTuiMessageSubmitOptions,
  type TrackTuiCommandExecutionOptions,
  type TuiSessionSummary,
} from "./telemetry-tui";

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

// Graph workflow telemetry integration
export {
  trackWorkflowExecution,
  type WorkflowTracker,
  type WorkflowTelemetryConfig,
  type WorkflowTelemetryEvent,
} from "./graph-integration";
