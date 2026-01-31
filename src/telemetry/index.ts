/**
 * Unified Telemetry Module
 *
 * Provides cross-SDK event tracking for:
 * - SDK operations (session, message, tool events)
 * - Graph execution (node, checkpoint events)
 * - Workflow events (iteration, feature events)
 * - UI events (chat, theme events)
 *
 * Reference: Feature 21 - Create unified TelemetryCollector interface
 */

// Types
export type {
  // Event types
  SdkEventType,
  GraphEventType,
  WorkflowEventType,
  UiEventType,
  TelemetryEventType,
  // Property types
  BaseTelemetryProperties,
  SdkEventProperties,
  GraphEventProperties,
  WorkflowEventProperties,
  UiEventProperties,
  TelemetryProperties,
  // Event and config types
  TelemetryEvent,
  TelemetryCollectorConfig,
  FlushResult,
  TelemetryCollector,
} from "./types.ts";

// Type guards
export {
  isSdkEventType,
  isGraphEventType,
  isWorkflowEventType,
  isUiEventType,
  isTelemetryEventType,
  isTelemetryEvent,
  isFlushResult,
} from "./types.ts";

// Helper functions
export {
  getEventCategory,
  createTelemetryEvent,
  DEFAULT_TELEMETRY_CONFIG,
} from "./types.ts";
