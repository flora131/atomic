import type {
  BaseState,
  Checkpointer,
} from "@/services/workflows/graph/types.ts";

interface MemoryCheckpoint<TState extends BaseState = BaseState> {
  state: TState;
  label: string;
  timestamp: string;
}

export class MemorySaver<TState extends BaseState = BaseState>
  implements Checkpointer<TState>
{
  private storage: Map<string, MemoryCheckpoint<TState>[]> = new Map();

  async save(
    executionId: string,
    state: TState,
    label?: string,
  ): Promise<void> {
    const checkpoints = this.storage.get(executionId) ?? [];
    checkpoints.push({
      state: structuredClone(state),
      label: label ?? `checkpoint_${Date.now()}`,
      timestamp: new Date().toISOString(),
    });
    this.storage.set(executionId, checkpoints);
  }

  async load(executionId: string): Promise<TState | null> {
    const checkpoints = this.storage.get(executionId);
    if (!checkpoints || checkpoints.length === 0) {
      return null;
    }
    return structuredClone(checkpoints[checkpoints.length - 1]!.state);
  }

  async loadByLabel(
    executionId: string,
    label: string,
  ): Promise<TState | null> {
    const checkpoints = this.storage.get(executionId);
    if (!checkpoints) {
      return null;
    }
    const checkpoint = checkpoints.find((entry) => entry.label === label);
    return checkpoint ? structuredClone(checkpoint.state) : null;
  }

  async list(executionId: string): Promise<string[]> {
    return (this.storage.get(executionId) ?? []).map(
      (checkpoint) => checkpoint.label,
    );
  }

  async delete(executionId: string, label?: string): Promise<void> {
    if (!label) {
      this.storage.delete(executionId);
      return;
    }

    const checkpoints = this.storage.get(executionId);
    if (!checkpoints) {
      return;
    }

    this.storage.set(
      executionId,
      checkpoints.filter((checkpoint) => checkpoint.label !== label),
    );
  }

  clear(): void {
    this.storage.clear();
  }

  count(executionId: string): number {
    return this.storage.get(executionId)?.length ?? 0;
  }
}
