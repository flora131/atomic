import type { BaseState, NodeId } from "./types.ts";
import type { ExecutionOptions, StepResult } from "./compiled.ts";

/**
 * Available stream projection modes.
 */
export type StreamMode = "values" | "updates" | "events" | "debug";

/**
 * Stream routing options layered on top of execution options.
 */
export interface StreamOptions<TState extends BaseState = BaseState>
  extends ExecutionOptions<TState> {
  modes?: StreamMode[];
}

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
 * Union of projected stream events returned by {@link StreamRouter}.
 */
export type StreamEvent<TState extends BaseState = BaseState> =
  | { mode: "values"; nodeId: NodeId; state: TState }
  | { mode: "updates"; nodeId: NodeId; update: Partial<TState> }
  | { mode: "events"; nodeId: NodeId; event: CustomEvent }
  | { mode: "debug"; nodeId: NodeId; trace: DebugTrace };

function normalizeModes(modes?: StreamMode[]): StreamMode[] {
  if (!modes || modes.length === 0) {
    return ["values"];
  }
  return Array.from(new Set(modes));
}

/**
 * Projects raw execution step output into typed stream modes.
 */
export class StreamRouter<TState extends BaseState = BaseState> {
  private readonly modes: StreamMode[];

  constructor(
    private readonly source: AsyncIterable<StepResult<TState>>,
    modes?: StreamMode[]
  ) {
    this.modes = normalizeModes(modes);
  }

  async *stream(): AsyncGenerator<StreamEvent<TState>> {
    for await (const step of this.source) {
      for (const mode of this.modes) {
        if (mode === "values") {
          yield {
            mode: "values",
            nodeId: step.nodeId,
            state: step.state,
          };
          continue;
        }

        if (mode === "updates") {
          if (step.result.stateUpdate) {
            yield {
              mode: "updates",
              nodeId: step.nodeId,
              update: step.result.stateUpdate,
            };
          }
          continue;
        }

        if (mode === "events") {
          for (const event of step.emittedEvents ?? []) {
            yield {
              mode: "events",
              nodeId: step.nodeId,
              event: {
                type: event.type,
                data: event.data,
                timestamp: event.timestamp,
              },
            };
          }
          continue;
        }

        yield {
          mode: "debug",
          nodeId: step.nodeId,
          trace: {
            nodeId: step.nodeId,
            executionTime: step.executionTime ?? 0,
            retryCount: step.retryCount ?? 0,
            modelUsed: step.modelUsed ?? "unknown",
            stateSnapshot: step.state,
          },
        };
      }
    }
  }
}

/**
 * Create a routed stream from step results with selected modes.
 */
export function routeStream<TState extends BaseState = BaseState>(
  source: AsyncIterable<StepResult<TState>>,
  modes?: StreamMode[]
): AsyncGenerator<StreamEvent<TState>> {
  return new StreamRouter(source, modes).stream();
}
