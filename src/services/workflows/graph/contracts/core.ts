export interface Checkpointer<TState extends BaseState = BaseState> {
  save(executionId: string, state: TState, label?: string): Promise<void>;
  load(executionId: string): Promise<TState | null>;
  list(executionId: string): Promise<string[]>;
  delete(executionId: string, label?: string): Promise<void>;
}

export type NodeId = string;
export type ModelSpec = string | "inherit";
export type NodeType = "agent" | "tool" | "decision" | "wait" | "ask_user" | "subgraph" | "parallel";

export interface BaseState {
  executionId: string;
  lastUpdated: string;
  outputs: Record<NodeId, unknown>;
  /** Set automatically by the compiler when the user declines an askUserQuestion (ESC/Ctrl+C). */
  __userDeclined?: boolean;
  /** Set automatically by askUserQuestion nodes while waiting for user input. */
  __waitingForInput?: boolean;
}

export type Signal =
  | "checkpoint"
  | "human_input_required"
  | "debug_report_generated";

export interface SignalData {
  type: Signal;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ExecutionError {
  nodeId: NodeId;
  error: Error | string;
  timestamp: string;
  attempt: number;
}

export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryOn?: (error: Error) => boolean;
}

export type ErrorAction<TState extends BaseState = BaseState> =
  | { action: "retry"; delay?: number }
  | { action: "skip"; fallbackState?: Partial<TState> }
  | { action: "abort"; error?: Error }
  | { action: "goto"; nodeId: NodeId };

export interface DebugReport {
  errorSummary: string;
  stackTrace?: string;
  relevantFiles: string[];
  suggestedFixes: string[];
  generatedAt: string;
  nodeId?: NodeId;
  executionId?: string;
}
