import type { BaseState, NodeId } from "@/services/workflows/graph/types.ts";

export function generateExecutionId(): string {
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function executionNow(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isLoopNode(nodeId: NodeId): boolean {
  return nodeId.includes("loop_start") || nodeId.includes("loop_check");
}

export function initializeExecutionState<TState extends BaseState>(
  executionId: string,
  initial?: Partial<TState>,
): TState {
  const baseState: BaseState = {
    executionId,
    lastUpdated: executionNow(),
    outputs: {},
  };

  const initialOutputs = initial?.outputs ?? {};

  return {
    ...baseState,
    ...initial,
    outputs: { ...baseState.outputs, ...initialOutputs },
    executionId,
    lastUpdated: executionNow(),
  } as TState;
}

export function mergeState<TState extends BaseState>(
  current: TState,
  update: Partial<TState>,
): TState {
  const outputs =
    update.outputs !== undefined
      ? { ...current.outputs, ...update.outputs }
      : current.outputs;

  return {
    ...current,
    ...update,
    outputs,
    lastUpdated: executionNow(),
  };
}
