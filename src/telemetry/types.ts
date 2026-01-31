/**
 * Unified Telemetry Types for Cross-SDK Event Tracking
 *
 * Provides a unified interface for tracking events across:
 * - SDK operations (session creation, message sending, tool usage)
 * - Graph execution (node completion, workflow progress)
 * - Workflow events (feature completion, iteration tracking)
 * - UI events (chat interactions, theme changes)
 *
 * Reference: Feature 21 - Create unified TelemetryCollector interface
 */

// ============================================================================
// EVENT TYPE DEFINITIONS
// ============================================================================

/**
 * SDK-related event types for tracking coding agent interactions.
 */
export type SdkEventType =
  | "sdk.session.created"
  | "sdk.session.resumed"
  | "sdk.session.destroyed"
  | "sdk.message.sent"
  | "sdk.message.received"
  | "sdk.tool.started"
  | "sdk.tool.completed"
  | "sdk.tool.failed"
  | "sdk.error";

/**
 * Graph execution event types for tracking workflow progress.
 */
export type GraphEventType =
  | "graph.execution.started"
  | "graph.execution.completed"
  | "graph.execution.failed"
  | "graph.execution.paused"
  | "graph.execution.resumed"
  | "graph.node.started"
  | "graph.node.completed"
  | "graph.node.failed"
  | "graph.node.retried"
  | "graph.checkpoint.saved"
  | "graph.checkpoint.loaded";

/**
 * Workflow event types for tracking Ralph loop and feature progress.
 */
export type WorkflowEventType =
  | "workflow.iteration.started"
  | "workflow.iteration.completed"
  | "workflow.feature.started"
  | "workflow.feature.completed"
  | "workflow.feature.failed"
  | "workflow.loop.started"
  | "workflow.loop.completed"
  | "workflow.context.compacted";

/**
 * UI event types for tracking user interactions.
 */
export type UiEventType =
  | "ui.chat.opened"
  | "ui.chat.closed"
  | "ui.message.sent"
  | "ui.theme.changed"
  | "ui.error.displayed";

/**
 * Union of all telemetry event types.
 * Organized by category for easy filtering and aggregation.
 */
export type TelemetryEventType =
  | SdkEventType
  | GraphEventType
  | WorkflowEventType
  | UiEventType;

// ============================================================================
// EVENT PROPERTIES
// ============================================================================

/**
 * Base properties included in all telemetry events.
 */
export interface BaseTelemetryProperties {
  /** Operating system platform */
  platform?: NodeJS.Platform;
  /** Node.js version */
  nodeVersion?: string;
  /** Atomic CLI version */
  atomicVersion?: string;
  /** Anonymous user identifier */
  anonymousId?: string;
}

/**
 * Properties for SDK events.
 */
export interface SdkEventProperties extends BaseTelemetryProperties {
  /** Type of coding agent (claude, opencode, copilot) */
  agentType?: string;
  /** Model identifier used */
  model?: string;
  /** Tool name for tool events */
  toolName?: string;
  /** Whether the operation succeeded */
  success?: boolean;
  /** Error message if operation failed */
  errorMessage?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Input token count */
  inputTokens?: number;
  /** Output token count */
  outputTokens?: number;
}

/**
 * Properties for graph execution events.
 */
export interface GraphEventProperties extends BaseTelemetryProperties {
  /** Node identifier */
  nodeId?: string;
  /** Node type (agent, tool, decision, wait, parallel, subgraph) */
  nodeType?: string;
  /** Execution status */
  status?: string;
  /** Total number of nodes in the graph */
  nodeCount?: number;
  /** Number of completed nodes */
  completedNodeCount?: number;
  /** Retry attempt number */
  retryAttempt?: number;
  /** Checkpoint label */
  checkpointLabel?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Error message if execution failed */
  errorMessage?: string;
}

/**
 * Properties for workflow events.
 */
export interface WorkflowEventProperties extends BaseTelemetryProperties {
  /** Current iteration number */
  iteration?: number;
  /** Maximum allowed iterations */
  maxIterations?: number;
  /** Feature identifier */
  featureId?: string;
  /** Feature description */
  featureDescription?: string;
  /** Total number of features */
  totalFeatures?: number;
  /** Number of passing features */
  passingFeatures?: number;
  /** Whether all features are passing */
  allFeaturesPassing?: boolean;
  /** Duration in milliseconds */
  durationMs?: number;
}

/**
 * Properties for UI events.
 */
export interface UiEventProperties extends BaseTelemetryProperties {
  /** Theme name */
  themeName?: string;
  /** Number of messages in chat */
  messageCount?: number;
  /** Chat session duration in milliseconds */
  sessionDurationMs?: number;
  /** Error message if applicable */
  errorMessage?: string;
}

/**
 * Union of all event property types.
 */
export type TelemetryProperties =
  | BaseTelemetryProperties
  | SdkEventProperties
  | GraphEventProperties
  | WorkflowEventProperties
  | UiEventProperties;

// ============================================================================
// TELEMETRY EVENT
// ============================================================================

/**
 * A unified telemetry event.
 *
 * Contains all information needed to track and analyze
 * events across the Atomic CLI ecosystem.
 */
export interface TelemetryEvent {
  /** Unique identifier for this event (UUID v4) */
  eventId: string;

  /** ISO 8601 timestamp when the event occurred */
  timestamp: string;

  /** Type of event from the TelemetryEventType union */
  eventType: TelemetryEventType;

  /** Session identifier for correlation (optional) */
  sessionId?: string;

  /** Graph execution identifier for correlation (optional) */
  executionId?: string;

  /** Event-specific properties */
  properties: TelemetryProperties;
}

// ============================================================================
// TELEMETRY COLLECTOR INTERFACE
// ============================================================================

/**
 * Configuration for the telemetry collector.
 */
export interface TelemetryCollectorConfig {
  /** Whether telemetry collection is enabled */
  enabled: boolean;

  /** Path for local JSONL log files */
  localLogPath?: string;

  /** Azure Application Insights connection string */
  appInsightsKey?: string;

  /** Number of events to buffer before auto-flush */
  batchSize?: number;

  /** Interval in milliseconds between auto-flushes */
  flushIntervalMs?: number;

  /** Anonymous user identifier */
  anonymousId?: string;
}

/**
 * Result of a flush operation.
 */
export interface FlushResult {
  /** Number of events successfully flushed */
  eventCount: number;

  /** Whether events were written to local log */
  localLogSuccess: boolean;

  /** Whether events were sent to remote endpoint */
  remoteSuccess: boolean;

  /** Error message if flush failed */
  error?: string;
}

/**
 * Unified interface for telemetry collection.
 *
 * Provides a consistent API for tracking events across
 * SDK, graph, workflow, and UI components.
 *
 * @example
 * ```typescript
 * const collector = createTelemetryCollector(config);
 *
 * // Track an SDK event
 * collector.track("sdk.session.created", {
 *   agentType: "claude",
 *   model: "claude-3-opus",
 * });
 *
 * // Flush events before shutdown
 * await collector.flush();
 * await collector.shutdown();
 * ```
 */
export interface TelemetryCollector {
  /**
   * Track a telemetry event.
   *
   * @param eventType - Type of event to track
   * @param properties - Event-specific properties
   * @param options - Optional event metadata
   */
  track(
    eventType: TelemetryEventType,
    properties?: TelemetryProperties,
    options?: {
      sessionId?: string;
      executionId?: string;
    }
  ): void;

  /**
   * Flush all buffered events to storage/remote.
   *
   * @returns Promise resolving to flush result
   */
  flush(): Promise<FlushResult>;

  /**
   * Check if telemetry collection is currently enabled.
   *
   * @returns True if telemetry is enabled
   */
  isEnabled(): boolean;

  /**
   * Shutdown the collector, flushing remaining events.
   *
   * Should be called before process exit to ensure
   * all events are properly persisted.
   *
   * @returns Promise resolving when shutdown is complete
   */
  shutdown(): Promise<void>;

  /**
   * Get the current event buffer count.
   *
   * @returns Number of events in the buffer
   */
  getBufferSize(): number;

  /**
   * Get the collector configuration.
   *
   * @returns Current configuration
   */
  getConfig(): TelemetryCollectorConfig;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard to check if a string is a valid SDK event type.
 */
export function isSdkEventType(value: string): value is SdkEventType {
  const sdkTypes: SdkEventType[] = [
    "sdk.session.created",
    "sdk.session.resumed",
    "sdk.session.destroyed",
    "sdk.message.sent",
    "sdk.message.received",
    "sdk.tool.started",
    "sdk.tool.completed",
    "sdk.tool.failed",
    "sdk.error",
  ];
  return sdkTypes.includes(value as SdkEventType);
}

/**
 * Type guard to check if a string is a valid graph event type.
 */
export function isGraphEventType(value: string): value is GraphEventType {
  const graphTypes: GraphEventType[] = [
    "graph.execution.started",
    "graph.execution.completed",
    "graph.execution.failed",
    "graph.execution.paused",
    "graph.execution.resumed",
    "graph.node.started",
    "graph.node.completed",
    "graph.node.failed",
    "graph.node.retried",
    "graph.checkpoint.saved",
    "graph.checkpoint.loaded",
  ];
  return graphTypes.includes(value as GraphEventType);
}

/**
 * Type guard to check if a string is a valid workflow event type.
 */
export function isWorkflowEventType(value: string): value is WorkflowEventType {
  const workflowTypes: WorkflowEventType[] = [
    "workflow.iteration.started",
    "workflow.iteration.completed",
    "workflow.feature.started",
    "workflow.feature.completed",
    "workflow.feature.failed",
    "workflow.loop.started",
    "workflow.loop.completed",
    "workflow.context.compacted",
  ];
  return workflowTypes.includes(value as WorkflowEventType);
}

/**
 * Type guard to check if a string is a valid UI event type.
 */
export function isUiEventType(value: string): value is UiEventType {
  const uiTypes: UiEventType[] = [
    "ui.chat.opened",
    "ui.chat.closed",
    "ui.message.sent",
    "ui.theme.changed",
    "ui.error.displayed",
  ];
  return uiTypes.includes(value as UiEventType);
}

/**
 * Type guard to check if a string is a valid telemetry event type.
 */
export function isTelemetryEventType(value: string): value is TelemetryEventType {
  return (
    isSdkEventType(value) ||
    isGraphEventType(value) ||
    isWorkflowEventType(value) ||
    isUiEventType(value)
  );
}

/**
 * Type guard to check if an object is a valid TelemetryEvent.
 */
export function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;

  return (
    typeof event.eventId === "string" &&
    typeof event.timestamp === "string" &&
    typeof event.eventType === "string" &&
    isTelemetryEventType(event.eventType) &&
    typeof event.properties === "object" &&
    event.properties !== null
  );
}

/**
 * Type guard to check if an object is a valid FlushResult.
 */
export function isFlushResult(value: unknown): value is FlushResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const result = value as Record<string, unknown>;

  return (
    typeof result.eventCount === "number" &&
    typeof result.localLogSuccess === "boolean" &&
    typeof result.remoteSuccess === "boolean"
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the category prefix from an event type.
 *
 * @param eventType - The telemetry event type
 * @returns The category (sdk, graph, workflow, ui)
 */
export function getEventCategory(eventType: TelemetryEventType): string {
  const parts = eventType.split(".");
  return parts[0] ?? eventType;
}

/**
 * Generate a UUID v4.
 * Uses crypto.randomUUID() if available, falls back to custom implementation.
 */
function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 generation
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Create a new telemetry event with auto-generated ID and timestamp.
 *
 * @param eventType - Type of event
 * @param properties - Event properties
 * @param options - Optional session/execution IDs
 * @returns A complete TelemetryEvent
 */
export function createTelemetryEvent(
  eventType: TelemetryEventType,
  properties: TelemetryProperties = {},
  options?: {
    sessionId?: string;
    executionId?: string;
  }
): TelemetryEvent {
  const event: TelemetryEvent = {
    eventId: generateUUID(),
    timestamp: new Date().toISOString(),
    eventType,
    properties,
  };

  if (options?.sessionId) {
    event.sessionId = options.sessionId;
  }

  if (options?.executionId) {
    event.executionId = options.executionId;
  }

  return event;
}

/**
 * Default telemetry collector configuration.
 */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryCollectorConfig = {
  enabled: true,
  batchSize: 100,
  flushIntervalMs: 30000, // 30 seconds
};
