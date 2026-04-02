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
} from "@/services/telemetry/types.ts";

// Constants
export { ATOMIC_COMMANDS, type AtomicCommand } from "@/services/telemetry/constants.ts";

// Core telemetry functions (public API only)
export {
  isTelemetryEnabled,
  isTelemetryEnabledSync,
  getOrCreateTelemetryState,
  setTelemetryEnabled,
  getTelemetryFilePath,
} from "@/services/telemetry/telemetry.ts";

// CLI telemetry tracking
export { trackAtomicCommand } from "@/services/telemetry/telemetry-cli.ts";

// File I/O utilities
export { getEventsFilePath } from "@/services/telemetry/telemetry-file-io.ts";

// Native TUI telemetry tracking
export {
  createTuiTelemetrySessionTracker,
  TuiTelemetrySessionTracker,
  type CreateTuiTelemetrySessionOptions,
  type TrackTuiMessageSubmitOptions,
  type TrackTuiCommandExecutionOptions,
  type TuiSessionSummary,
} from "@/services/telemetry/telemetry-tui.ts";

// Session telemetry tracking (for agent hooks)
export {
  trackAgentSession,
  extractCommandsFromTranscript,
  createSessionEvent,
} from "@/services/telemetry/telemetry-session.ts";

// Graph workflow telemetry integration
export {
  trackWorkflowExecution,
  type WorkflowTracker,
  type WorkflowTelemetryConfig,
  type WorkflowTelemetryEvent,
} from "@/services/telemetry/graph-integration.ts";
