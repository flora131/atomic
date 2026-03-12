/**
 * Graph telemetry compatibility integration.
 *
 * This module provides the workflow telemetry tracker interface consumed by
 * the graph executor. It is intentionally fail-safe and callback-based:
 * - No-op when disabled
 * - Optional event callback for downstream consumers
 * - Never throws
 */

/**
 * Event emitted by the workflow telemetry tracker.
 */
export interface WorkflowTelemetryEvent {
  eventType:
    | "workflow_start"
    | "workflow_node_enter"
    | "workflow_node_exit"
    | "workflow_error"
    | "workflow_complete";
  executionId: string;
  timestamp: string;
  workflowName?: string;
  nodeId?: string;
  nodeType?: string;
  durationMs?: number;
  success?: boolean;
  errorMessage?: string;
  maxSteps?: number;
  resuming?: boolean;
}

/**
 * Runtime options for workflow telemetry tracking.
 */
export interface WorkflowTelemetryConfig {
  /**
   * When false, tracking is disabled.
   * Default: true
   */
  enabled?: boolean;
  /**
   * Sampling rate in [0, 1].
   * Default: 1
   */
  sampleRate?: number;
  /**
   * Optional callback invoked for each emitted event.
   */
  onEvent?: (event: WorkflowTelemetryEvent) => void;
}

/**
 * Workflow telemetry tracker contract used by CompiledGraph.
 */
export interface WorkflowTracker {
  start(workflowName: string, meta?: { maxSteps?: number; resuming?: boolean }): void;
  nodeEnter(nodeId: string, nodeType: string): void;
  nodeExit(nodeId: string, nodeType: string, durationMs: number): void;
  error(errorMessage: string, nodeId?: string): void;
  complete(success: boolean, durationMs: number): void;
}

const NOOP_TRACKER: WorkflowTracker = {
  start: () => {},
  nodeEnter: () => {},
  nodeExit: () => {},
  error: () => {},
  complete: () => {},
};

function clampSampleRate(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function shouldSample(sampleRate: number): boolean {
  if (sampleRate <= 0) {
    return false;
  }
  if (sampleRate >= 1) {
    return true;
  }
  return Math.random() < sampleRate;
}

function safeEmit(
  onEvent: ((event: WorkflowTelemetryEvent) => void) | undefined,
  event: WorkflowTelemetryEvent
): void {
  if (!onEvent) {
    return;
  }
  try {
    onEvent(event);
  } catch {
    // Fail-safe: telemetry must never affect workflow execution.
  }
}

/**
 * Create a workflow tracker instance for one execution.
 *
 * @param executionId - Unique execution identifier
 * @param config - Optional telemetry config
 * @returns A tracker that emits callback events or no-ops
 */
export function trackWorkflowExecution(
  executionId: string,
  config?: WorkflowTelemetryConfig
): WorkflowTracker {
  const enabled = config?.enabled !== false;
  const sampleRate = clampSampleRate(config?.sampleRate);

  if (!enabled || !shouldSample(sampleRate)) {
    return NOOP_TRACKER;
  }

  const onEvent = config?.onEvent;

  return {
    start: (workflowName, meta) => {
      safeEmit(onEvent, {
        eventType: "workflow_start",
        executionId,
        timestamp: new Date().toISOString(),
        workflowName,
        maxSteps: meta?.maxSteps,
        resuming: meta?.resuming,
      });
    },
    nodeEnter: (nodeId, nodeType) => {
      safeEmit(onEvent, {
        eventType: "workflow_node_enter",
        executionId,
        timestamp: new Date().toISOString(),
        nodeId,
        nodeType,
      });
    },
    nodeExit: (nodeId, nodeType, durationMs) => {
      safeEmit(onEvent, {
        eventType: "workflow_node_exit",
        executionId,
        timestamp: new Date().toISOString(),
        nodeId,
        nodeType,
        durationMs: Math.max(0, Math.floor(durationMs)),
      });
    },
    error: (errorMessage, nodeId) => {
      safeEmit(onEvent, {
        eventType: "workflow_error",
        executionId,
        timestamp: new Date().toISOString(),
        nodeId,
        errorMessage,
      });
    },
    complete: (success, durationMs) => {
      safeEmit(onEvent, {
        eventType: "workflow_complete",
        executionId,
        timestamp: new Date().toISOString(),
        success,
        durationMs: Math.max(0, Math.floor(durationMs)),
      });
    },
  };
}
