/**
 * Stream projection types for the graph execution engine.
 *
 * The StreamRouter class and routeStream function have been removed along
 * with the legacy GraphExecutor. These type definitions are preserved for
 * any code that references them transitionally.
 */

import type { BaseState, NodeId } from "@/services/workflows/graph/types.ts";

/**
 * Available stream projection modes.
 */
export type StreamMode = "values" | "updates" | "events" | "debug";

/**
 * Event emitted from a node via `ctx.emit()`.
 */
export interface CustomEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/**
 * Debug metadata for a streamed node execution step.
 */
export interface DebugTrace {
  nodeId: NodeId;
  executionTime: number;
  retryCount: number;
  modelUsed: string;
  stateSnapshot: unknown;
}

/**
 * Union of projected stream events returned by the (removed) StreamRouter.
 */
export type StreamEvent<TState extends BaseState = BaseState> =
  | { mode: "values"; nodeId: NodeId; state: TState }
  | { mode: "updates"; nodeId: NodeId; update: Partial<TState> }
  | { mode: "events"; nodeId: NodeId; event: CustomEvent }
  | { mode: "debug"; nodeId: NodeId; trace: DebugTrace };
