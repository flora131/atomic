/**
 * Graph Telemetry Integration
 *
 * Provides telemetry tracking for graph-based workflow execution.
 * Tracks node execution, workflow completion, and checkpoint operations.
 *
 * Reference: Feature 24 - Implement graph telemetry integration for workflow tracking
 */

import type {
  GraphConfig,
  BaseState,
  ProgressEvent,
} from "../graph/types.ts";
import type {
  TelemetryCollector,
  GraphEventProperties,
} from "./types.ts";
import { getGlobalCollector } from "./collector.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for graph telemetry integration.
 */
export interface GraphTelemetryConfig {
  /** Custom telemetry collector (defaults to global collector) */
  collector?: TelemetryCollector;
  /** Whether to track node events */
  trackNodes?: boolean;
  /** Whether to track checkpoint events */
  trackCheckpoints?: boolean;
  /** Additional properties to include in all events */
  additionalProperties?: GraphEventProperties;
}

/**
 * Execution tracker returned by trackGraphExecution.
 * Call these functions at appropriate points during workflow execution.
 */
export interface ExecutionTracker {
  /** Track execution start */
  started: (properties?: GraphEventProperties) => void;
  /** Track successful execution completion */
  completed: (properties?: GraphEventProperties) => void;
  /** Track execution failure */
  failed: (errorMessage: string, nodeId?: string, properties?: GraphEventProperties) => void;
  /** Track checkpoint saved */
  checkpointSaved: (label: string, properties?: GraphEventProperties) => void;
  /** Track checkpoint loaded */
  checkpointLoaded: (label: string, properties?: GraphEventProperties) => void;
  /** Track node started */
  nodeStarted: (nodeId: string, nodeType?: string, properties?: GraphEventProperties) => void;
  /** Track node completed */
  nodeCompleted: (nodeId: string, nodeType?: string, durationMs?: number, properties?: GraphEventProperties) => void;
  /** Track node failed */
  nodeFailed: (nodeId: string, errorMessage: string, nodeType?: string, properties?: GraphEventProperties) => void;
  /** Track node retried */
  nodeRetried: (nodeId: string, retryAttempt: number, properties?: GraphEventProperties) => void;
}

// ============================================================================
// PROGRESS EVENT HANDLER
// ============================================================================

/**
 * Create a progress event handler that tracks telemetry.
 *
 * @param collector - Telemetry collector to use
 * @param executionId - Execution ID for correlation
 * @param config - Telemetry configuration
 * @returns Progress event handler function
 */
export function createProgressHandler<TState extends BaseState>(
  collector: TelemetryCollector,
  executionId: string,
  config: GraphTelemetryConfig = {}
): (event: ProgressEvent<TState>) => void {
  const baseProperties: GraphEventProperties = {
    ...config.additionalProperties,
  };

  return (event: ProgressEvent<TState>) => {
    // Skip node events if disabled
    if (event.type.startsWith("node_") && config.trackNodes === false) {
      return;
    }

    // Skip checkpoint events if disabled
    if (event.type === "checkpoint_saved" && config.trackCheckpoints === false) {
      return;
    }

    switch (event.type) {
      case "node_started":
        collector.track(
          "graph.node.started",
          {
            ...baseProperties,
            nodeId: event.nodeId,
          },
          { executionId }
        );
        break;

      case "node_completed":
        collector.track(
          "graph.node.completed",
          {
            ...baseProperties,
            nodeId: event.nodeId,
          },
          { executionId }
        );
        break;

      case "node_error":
        collector.track(
          "graph.node.failed",
          {
            ...baseProperties,
            nodeId: event.nodeId,
            errorMessage: event.error?.error instanceof Error
              ? event.error.error.message
              : String(event.error?.error ?? "Unknown error"),
          },
          { executionId }
        );
        break;

      case "checkpoint_saved":
        collector.track(
          "graph.checkpoint.saved",
          {
            ...baseProperties,
            nodeId: event.nodeId,
          },
          { executionId }
        );
        break;
    }
  };
}

// ============================================================================
// GRAPH CONFIG WRAPPER
// ============================================================================

/**
 * Wrap a GraphConfig with telemetry tracking.
 *
 * Adds an onProgress handler that tracks node execution and checkpoints.
 * Preserves any existing onProgress handler.
 *
 * @param config - Original graph configuration
 * @param telemetryConfig - Telemetry configuration
 * @returns Wrapped configuration with telemetry tracking
 *
 * @example
 * ```typescript
 * const graph = builder.compile(withGraphTelemetry({
 *   checkpointer: new MemorySaver(),
 *   autoCheckpoint: true,
 * }));
 * ```
 */
export function withGraphTelemetry<TState extends BaseState>(
  config: GraphConfig<TState> = {},
  telemetryConfig: GraphTelemetryConfig = {}
): GraphConfig<TState> {
  const collector = telemetryConfig.collector ?? getGlobalCollector();
  const executionId = config.metadata?.executionId as string ?? generateExecutionId();

  // Create telemetry progress handler
  const telemetryHandler = createProgressHandler<TState>(collector, executionId, telemetryConfig);

  // Get existing handler if any
  const existingHandler = config.onProgress;

  // Combine handlers
  const combinedHandler = (event: ProgressEvent<TState>) => {
    // Call telemetry handler first
    telemetryHandler(event);

    // Then call existing handler if present
    if (existingHandler) {
      existingHandler(event);
    }
  };

  return {
    ...config,
    onProgress: combinedHandler,
    metadata: {
      ...config.metadata,
      executionId,
    },
  };
}

// ============================================================================
// EXECUTION TRACKER FACTORY
// ============================================================================

/**
 * Create an execution tracker for tracking workflow execution events.
 *
 * Returns an object with methods to track various execution events.
 * Use this when you need fine-grained control over what events are tracked.
 *
 * @param executionId - Unique identifier for this execution
 * @param config - Telemetry configuration
 * @returns Execution tracker with tracking methods
 *
 * @example
 * ```typescript
 * const tracker = trackGraphExecution("exec-123");
 *
 * tracker.started({ nodeCount: 10 });
 *
 * for (const node of nodes) {
 *   tracker.nodeStarted(node.id, node.type);
 *   await executeNode(node);
 *   tracker.nodeCompleted(node.id, node.type, duration);
 * }
 *
 * tracker.completed({
 *   nodeCount: 10,
 *   completedNodeCount: 10,
 * });
 * ```
 */
export function trackGraphExecution(
  executionId: string,
  config: GraphTelemetryConfig = {}
): ExecutionTracker {
  const collector = config.collector ?? getGlobalCollector();
  const baseProperties: GraphEventProperties = {
    ...config.additionalProperties,
  };

  return {
    started(properties?: GraphEventProperties): void {
      collector.track(
        "graph.execution.started",
        { ...baseProperties, ...properties },
        { executionId }
      );
    },

    completed(properties?: GraphEventProperties): void {
      collector.track(
        "graph.execution.completed",
        {
          ...baseProperties,
          ...properties,
          status: "completed",
        },
        { executionId }
      );
    },

    failed(
      errorMessage: string,
      nodeId?: string,
      properties?: GraphEventProperties
    ): void {
      collector.track(
        "graph.execution.failed",
        {
          ...baseProperties,
          ...properties,
          errorMessage,
          nodeId,
          status: "failed",
        },
        { executionId }
      );
    },

    checkpointSaved(label: string, properties?: GraphEventProperties): void {
      if (config.trackCheckpoints === false) {
        return;
      }
      collector.track(
        "graph.checkpoint.saved",
        {
          ...baseProperties,
          ...properties,
          checkpointLabel: label,
        },
        { executionId }
      );
    },

    checkpointLoaded(label: string, properties?: GraphEventProperties): void {
      if (config.trackCheckpoints === false) {
        return;
      }
      collector.track(
        "graph.checkpoint.loaded",
        {
          ...baseProperties,
          ...properties,
          checkpointLabel: label,
        },
        { executionId }
      );
    },

    nodeStarted(
      nodeId: string,
      nodeType?: string,
      properties?: GraphEventProperties
    ): void {
      if (config.trackNodes === false) {
        return;
      }
      collector.track(
        "graph.node.started",
        {
          ...baseProperties,
          ...properties,
          nodeId,
          nodeType,
        },
        { executionId }
      );
    },

    nodeCompleted(
      nodeId: string,
      nodeType?: string,
      durationMs?: number,
      properties?: GraphEventProperties
    ): void {
      if (config.trackNodes === false) {
        return;
      }
      collector.track(
        "graph.node.completed",
        {
          ...baseProperties,
          ...properties,
          nodeId,
          nodeType,
          durationMs,
        },
        { executionId }
      );
    },

    nodeFailed(
      nodeId: string,
      errorMessage: string,
      nodeType?: string,
      properties?: GraphEventProperties
    ): void {
      if (config.trackNodes === false) {
        return;
      }
      collector.track(
        "graph.node.failed",
        {
          ...baseProperties,
          ...properties,
          nodeId,
          nodeType,
          errorMessage,
        },
        { executionId }
      );
    },

    nodeRetried(
      nodeId: string,
      retryAttempt: number,
      properties?: GraphEventProperties
    ): void {
      if (config.trackNodes === false) {
        return;
      }
      collector.track(
        "graph.node.retried",
        {
          ...baseProperties,
          ...properties,
          nodeId,
          retryAttempt,
        },
        { executionId }
      );
    },
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a unique execution ID.
 */
function generateExecutionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 9);
  return `exec_${timestamp}_${random}`;
}

/**
 * Track workflow execution with automatic start/complete/fail tracking.
 *
 * This is a convenience wrapper that handles the common execution pattern.
 *
 * @param executionId - Unique identifier for this execution
 * @param fn - Async function to execute
 * @param config - Telemetry configuration
 * @returns The result of the execution function
 *
 * @example
 * ```typescript
 * const result = await withExecutionTracking(
 *   "exec-123",
 *   async (tracker) => {
 *     // Execute workflow
 *     return await executeWorkflow();
 *   }
 * );
 * ```
 */
export async function withExecutionTracking<T>(
  executionId: string,
  fn: (tracker: ExecutionTracker) => Promise<T>,
  config: GraphTelemetryConfig = {}
): Promise<T> {
  const tracker = trackGraphExecution(executionId, config);
  const startTime = Date.now();

  tracker.started();

  try {
    const result = await fn(tracker);

    tracker.completed({
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (error) {
    tracker.failed(
      error instanceof Error ? error.message : String(error),
      undefined,
      { durationMs: Date.now() - startTime }
    );
    throw error;
  }
}

/**
 * Create a checkpointer wrapper that tracks checkpoint operations.
 *
 * @param checkpointer - Original checkpointer
 * @param executionId - Execution ID for correlation
 * @param config - Telemetry configuration
 * @returns Wrapped checkpointer with telemetry tracking
 */
export function withCheckpointTelemetry<TState extends BaseState>(
  checkpointer: NonNullable<GraphConfig<TState>["checkpointer"]>,
  executionId: string,
  config: GraphTelemetryConfig = {}
): NonNullable<GraphConfig<TState>["checkpointer"]> {
  const tracker = trackGraphExecution(executionId, config);

  return {
    async save(execId: string, state: TState, label?: string): Promise<void> {
      await checkpointer.save(execId, state, label);
      tracker.checkpointSaved(label ?? "auto");
    },

    async load(execId: string): Promise<TState | null> {
      const result = await checkpointer.load(execId);
      if (result) {
        tracker.checkpointLoaded("latest");
      }
      return result;
    },

    async list(execId: string): Promise<string[]> {
      return checkpointer.list(execId);
    },

    async delete(execId: string, label?: string): Promise<void> {
      return checkpointer.delete(execId, label);
    },
  };
}
